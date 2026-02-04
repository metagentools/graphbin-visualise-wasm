export function initApp() {
  if (window.__graphbinAppInitialized) return;
  window.__graphbinAppInitialized = true;

const outputEl = document.getElementById("output");

const NODE_RADIUS = {
  base: 4.5,     // default node radius (was ~3)
  hover: 6.5,    // on hover
  locked: 7.5,   // on click
};

// Initial placeholder when page loads
outputEl.textContent = "(logs will appear here)\n\n";

function log(msg) {
  outputEl.textContent += msg + "\n";
}

// store Pyodide init promise here, but don't start it yet
let pyodideReady = null;

// Track last generated plot paths for download
let lastInitialImgPath = null;
let lastFinalImgPath = null;

/* =========================
   Interactive graph globals
   ========================= */
let graphModel = null;

let graphSvg = null;
let graphG = null;
let zoomBehavior = null;
let currentTransform = null;

let hoverNodeId = null;
let lockedNodeId = null;

// sankey state
let sankeyLocked = null; // {srcBin, dstBin} or null

// filters
let filters = {
  mode: "final", // "initial" or "final"
  binOnly: "", // "" = all
  hideUnbinned: false,
  onlyChanged: false,
  khopFrom: null, // node id or null
  khopK: 0,
  collapseTips: false,
};

// bin -> color (stable palette per dataset)
let binColorMap = new Map();


document.getElementById("sankey-left-title").textContent =
  (window.binningNames?.left) || "Initial binning";

document.getElementById("sankey-right-title").textContent =
  (window.binningNames?.right) || "GraphBin";


function resetInteractiveViews() {
  /* =============================
   * Reset global interaction state
   * ============================= */
  window.selectedNode = null;
  window.selectedBin = null;
  window.hoveredNode = null;
  window.lockedSelection = false;

  // Sankey-specific state
  window.sankeyLocked = false;
  window.sankeyLockedKey = null;

  // Zoom / pan state (if used)
  window.currentTransform = null;
  currentTransform = null;

  /* =============================
   * Clear interactive D3 plot
   * ============================= */
  const svg = document.getElementById("graph-svg");
  if (svg) {
    svg.replaceChildren();
  }
  graphSvg = null;
  graphG = null;
  zoomBehavior = null;

  /* =============================
   * Clear bin legend
   * ============================= */
  const legend = document.getElementById("bin-legend");
  if (legend) {
    legend.innerHTML = "";
  }

  /* =============================
   * Hide interactive tooltip
   * ============================= */
  const tooltip = document.getElementById("hover-tooltip");
  if (tooltip) {
    tooltip.style.display = "none";
    tooltip.innerHTML = "";
  }

  /* =============================
   * Clear Sankey diagram
   * ============================= */
  const sankeySvg = document.getElementById("sankey-svg");
  if (sankeySvg) {
    sankeySvg.replaceChildren(); // removes all nodes, links, labels
  }

  const sankeyTooltip = document.getElementById("sankey-tooltip");
  if (sankeyTooltip) {
    sankeyTooltip.style.display = "none";
    sankeyTooltip.innerHTML = "";
  }

  // Only contigs that changed bin → unchecked
  const sankeyOnlyChanged = document.getElementById("sankey-only-changed");
  if (sankeyOnlyChanged) {
    sankeyOnlyChanged.checked = false;
  }

  // Hide unbinned → unchecked
  const sankeyHideUnbinned = document.getElementById("sankey-hide-unbinned");
  if (sankeyHideUnbinned) {
    sankeyHideUnbinned.checked = false;
  }

  /* =============================
   * Reset controls to defaults
   * ============================= */

  // Binning to display → GraphBin (final)
  const viewMode = document.getElementById("view-mode");
  if (viewMode) {
    viewMode.value = "final";
  }

  // Bin filter → (all bins)
  const binFilter = document.getElementById("bin-filter");
  if (binFilter) {
    binFilter.value = "";
  }

  // Hide unbinned → unchecked
  const hideUnbinned = document.getElementById("toggle-hide-unbinned");
  if (hideUnbinned) {
    hideUnbinned.checked = false;
  }

  // Show only changed → unchecked
  const onlyChanged = document.getElementById("toggle-only-changed");
  if (onlyChanged) {
    onlyChanged.checked = false;
  }
}




/* =========================
   File size checks
   ========================= */
document.getElementById("graph").addEventListener("change", function () {
  const file = this.files[0];
  const MAX_SIZE = 500 * 1024 * 1024; // 500MB
  if (file && file.size > MAX_SIZE) {
    alert("GFA file is too large! Maximum allowed size is 500 MB.");
    this.value = "";
  }
});

document.getElementById("contigs").addEventListener("change", function () {
  const file = this.files[0];
  const MAX_SIZE = 500 * 1024 * 1024; // 500MB
  if (file && file.size > MAX_SIZE) {
    alert("Contigs file is too large! Maximum allowed size is 500 MB.");
    this.value = "";
  }
});

/* =========================
   Pyodide init
   ========================= */
async function getPyodide() {
  if (pyodideReady) return pyodideReady;

  pyodideReady = (async () => {
    log("Loading Pyodide...");
    const pyodide = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.0/full/",
    });

    log("Loading igraph + matplotlib...");
    await pyodide.loadPackage(["igraph", "matplotlib"]);

    // Directories in the Pyodide FS
    try {
      pyodide.FS.mkdir("/py");
    } catch (e) {}
    try {
      pyodide.FS.mkdir("/data");
    } catch (e) {}
    try {
      pyodide.FS.mkdir("/out");
    } catch (e) {}

    // Fetch Python files and write them into Pyodide’s filesystem
    const files = ["spades_plot.py", "bidictmap.py", "interactive_export.py"];
    for (const f of files) {
      log("Loading " + f + " into Pyodide FS...");
      const text = await (await fetch("py/" + f)).text();
      pyodide.FS.writeFile("/py/" + f, text);
    }

    // Make Pyodide import from /py
    await pyodide.runPythonAsync(`
import sys
if "/py" not in sys.path:
    sys.path.append("/py")
    `);

    return pyodide;
  })();

  return pyodideReady;
}

/* =========================
   Helpers: FS read/write
   ========================= */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
}

async function writeUploadedFile(pyodide, inputFile, destPath) {
  const buf = await readFileAsArrayBuffer(inputFile);
  const data = new Uint8Array(buf);
  pyodide.FS.writeFile(destPath, data);
  return destPath;
}

async function writeServerFile(pyodide, url, destPath) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
  }
  const buf = await resp.arrayBuffer();
  const data = new Uint8Array(buf);
  pyodide.FS.writeFile(destPath, data);
  return destPath;
}

function readJsonFromPyodide(pyodide, path) {
  const data = pyodide.FS.readFile(path, { encoding: "utf8" });
  return JSON.parse(data);
}

function fileToImgSrc(pyodide, path) {
  const data = pyodide.FS.readFile(path); // Uint8Array
  const blob = new Blob([data], { type: "image/png" });
  return URL.createObjectURL(blob);
}

/* =========================
   Main: Run user inputs
   ========================= */
async function runInputPlot() {
  // clear old logs and hide old plots
  outputEl.textContent = "";
  const initialBlock = document.getElementById("initial-block");
  const finalBlock = document.getElementById("final-block");
  if (initialBlock) initialBlock.style.display = "none";
  if (finalBlock) finalBlock.style.display = "none";

  const graph = document.getElementById("graph").files[0];
  const contigs = document.getElementById("contigs").files[0];
  const paths = document.getElementById("paths").files[0];
  const initial = document.getElementById("initial").files[0];
  const graphbin = document.getElementById("graphbin").files[0];

  const setDpi = parseInt(document.getElementById("setting-dpi").value);
  const setWidth = parseInt(document.getElementById("setting-width").value);
  const setHeight = parseInt(document.getElementById("setting-height").value);
  const setVsize = parseInt(document.getElementById("setting-vsize").value);
  const setLsize = parseInt(document.getElementById("setting-lsize").value);
  const setImgtype = document.getElementById("setting-imgtype").value;
  const setDelimiter = document.getElementById("setting-delimiter").value;

  if (!graph || !contigs || !paths || !initial || !graphbin) {
    log("Please pick all input files (graph, contigs, paths, initial, graphbin).");
    return;
  }

  const pyodide = await getPyodide();

  log("Writing input files into Pyodide FS...");

  const graphPath = await writeUploadedFile(pyodide, graph, "/data/assembly_graph.gfa");
  const contigsPath = await writeUploadedFile(pyodide, contigs, "/data/contigs.fasta");
  const pathsPath = await writeUploadedFile(pyodide, paths, "/data/contigs.paths");
  const initialPath = await writeUploadedFile(pyodide, initial, "/data/initial_binning.tsv");
  const finalPath = await writeUploadedFile(pyodide, graphbin, "/data/final_binning.tsv");

  const args = {
    initial: initialPath,
    final: finalPath,
    graph: graphPath,
    paths: pathsPath,
    contigs: contigsPath, // needed for exporter (len/gc)
    output: "/out/",
    prefix: "",
    dpi: setDpi,
    width: setWidth,
    height: setHeight,
    vsize: setVsize,
    lsize: setLsize,
    margin: 10,
    imgtype: setImgtype,
    delimiter: setDelimiter,
  };

  log("Running GraphBin visualise in Pyodide...");

  await pyodide.runPythonAsync(`
import json
from types import SimpleNamespace
import spades_plot
import interactive_export

args_dict = json.loads(${JSON.stringify(JSON.stringify(args))})
args_ns = SimpleNamespace(**args_dict)

spades_plot.run(args_ns)
interactive_export.export(args_ns, "/out/interactive_graph.json")
  `);

  log("Python finished, reading plots from /out...");

  const pngs = pyodide.FS.readdir("/out").filter((f) => f.endsWith(".png"));
  log("Output files: " + pngs.join(", "));

  const initialFile = pngs.find((f) => f.includes("initial_binning_result"));
  const finalFile = pngs.find((f) => f.includes("final_GraphBin_binning_result"));

  lastInitialImgPath = null;
  lastFinalImgPath = null;

  if (initialFile) {
    const fullPath = "/out/" + initialFile;
    document.getElementById("initial-img").src = fileToImgSrc(pyodide, fullPath);
    if (initialBlock) initialBlock.style.display = "flex";
    lastInitialImgPath = fullPath;
  } else {
    log("Initial plot not found in /out.");
  }

  if (finalFile) {
    const fullPath = "/out/" + finalFile;
    document.getElementById("final-img").src = fileToImgSrc(pyodide, fullPath);
    if (finalBlock) finalBlock.style.display = "flex";
    lastFinalImgPath = fullPath;
  } else {
    log("Final plot not found in /out.");
  }

  // Load interactive model
  try {
    graphModel = readJsonFromPyodide(pyodide, "/out/interactive_graph.json");
    prepareInteractiveModel(graphModel);
    buildBinColorMap();
    renderBinLegend();
    initInteractiveUI();
    initSankeyUI();

    // Ensure first layout uses actual DOM sizes
    requestAnimationFrame(() => {
      fitToView(graphModel);
      render();
      renderSankey();
    });

    log(`Interactive graph loaded (nodes=${graphModel.nodes.length}, edges=${graphModel.edges.length}).`);
  } catch (e) {
    console.error(e);
    log("Interactive graph JSON not found or failed to load: " + e);
  }

  log("Done!");
}

/* =========================
   Main: Run example inputs
   ========================= */
async function runExamplePlot() {
  outputEl.textContent = "";
  const initialBlock = document.getElementById("initial-block");
  const finalBlock = document.getElementById("final-block");
  if (initialBlock) initialBlock.style.display = "none";
  if (finalBlock) finalBlock.style.display = "none";

  const setDpi = parseInt(document.getElementById("setting-dpi").value);
  const setWidth = parseInt(document.getElementById("setting-width").value);
  const setHeight = parseInt(document.getElementById("setting-height").value);
  const setVsize = parseInt(document.getElementById("setting-vsize").value);
  const setLsize = parseInt(document.getElementById("setting-lsize").value);
  const setImgtype = document.getElementById("setting-imgtype").value;
  const setDelimiter = document.getElementById("setting-delimiter").value;

  const pyodide = await getPyodide();

  log("Loading example data files into Pyodide FS...");

  const graphPath = await writeServerFile(
    pyodide,
    "data/assembly_graph_with_scaffolds.gfa",
    "/data/assembly_graph.gfa"
  );
  const contigsPath = await writeServerFile(pyodide, "data/contigs.fasta", "/data/contigs.fasta");
  const pathsPath = await writeServerFile(pyodide, "data/contigs.paths", "/data/contigs.paths");
  const initialPath = await writeServerFile(
    pyodide,
    "data/initial_binning_res.csv",
    "/data/initial_binning.csv"
  );
  const finalPath = await writeServerFile(pyodide, "data/graphbin_res.csv", "/data/final_binning.csv");

  const args = {
    initial: initialPath,
    final: finalPath,
    graph: graphPath,
    paths: pathsPath,
    contigs: contigsPath, // exporter needs this
    output: "/out/",
    prefix: "",
    dpi: setDpi,
    width: setWidth,
    height: setHeight,
    vsize: setVsize,
    lsize: setLsize,
    margin: 10,
    imgtype: setImgtype,
    delimiter: setDelimiter,
  };

  log("Running GraphBin visualise on example data in Pyodide...");

  await pyodide.runPythonAsync(`
import json
from types import SimpleNamespace
import spades_plot
import interactive_export

args_dict = json.loads(${JSON.stringify(JSON.stringify(args))})
args_ns = SimpleNamespace(**args_dict)

spades_plot.run(args_ns)
interactive_export.export(args_ns, "/out/interactive_graph.json")
  `);

  log("Python finished, reading example plots from /out...");

  const pngs = pyodide.FS.readdir("/out").filter((f) => f.endsWith(".png"));
  log("Output files: " + pngs.join(", "));

  const initialFile = pngs.find((f) => f.includes("initial_binning_result"));
  const finalFile = pngs.find((f) => f.includes("final_GraphBin_binning_result"));

  lastInitialImgPath = null;
  lastFinalImgPath = null;

  if (initialFile) {
    const fullPath = "/out/" + initialFile;
    document.getElementById("initial-img").src = fileToImgSrc(pyodide, fullPath);
    if (initialBlock) initialBlock.style.display = "flex";
    lastInitialImgPath = fullPath;
  } else {
    log("Initial plot not found in /out.");
  }

  if (finalFile) {
    const fullPath = "/out/" + finalFile;
    document.getElementById("final-img").src = fileToImgSrc(pyodide, fullPath);
    if (finalBlock) finalBlock.style.display = "flex";
    lastFinalImgPath = fullPath;
  } else {
    log("Final plot not found in /out.");
  }

  // Load interactive model
  try {
    graphModel = readJsonFromPyodide(pyodide, "/out/interactive_graph.json");
    prepareInteractiveModel(graphModel);
    buildBinColorMap();
    renderBinLegend();
    initInteractiveUI();
    initSankeyUI();

    requestAnimationFrame(() => {
      fitToView(graphModel);
      render();
      renderSankey();
    });

    log(`Interactive graph loaded (nodes=${graphModel.nodes.length}, edges=${graphModel.edges.length}).`);
  } catch (e) {
    console.error(e);
    log("Interactive graph JSON not found or failed to load: " + e);
  }

  log("Done (example data)!");
}

/* =========================
   Buttons
   ========================= */
document.getElementById("run-btn").addEventListener("click", () => {
  resetInteractiveViews();
  runInputPlot().catch((err) => {
    console.error(err);
    log("Error: " + err);
  });
});

document.getElementById("example-btn").addEventListener("click", () => {
  resetInteractiveViews();
  runExamplePlot().catch((err) => {
    console.error(err);
    log("Error (example): " + err);
  });
});

document.getElementById("download-initial").addEventListener("click", () => {
  downloadImage("initial").catch((err) => {
    console.error(err);
    log("Download error: " + err);
  });
});

document.getElementById("download-final").addEventListener("click", () => {
  downloadImage("final").catch((err) => {
    console.error(err);
    log("Download error: " + err);
  });
});

/* =========================
   Download plot images
   ========================= */
async function downloadImage(which) {
  const pyodide = await getPyodide();

  let path = null;
  if (which === "initial") path = lastInitialImgPath;
  if (which === "final") path = lastFinalImgPath;

  if (!path) {
    alert("No image available. Run the plot first.");
    return;
  }

  const data = pyodide.FS.readFile(path);
  const blob = new Blob([data], { type: "image/png" });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = which + "_plot.png";
  a.style.display = "none";
  document.body.appendChild(a);

  a.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 2000);
}

/* =========================
   Interactive: model prep
   ========================= */
function prepareInteractiveModel(model) {
  // nodesById
  model.nodesById = new Map();
  for (const n of model.nodes) model.nodesById.set(n.id, n);

  // adjacency list
  model.adj = new Map();
  for (const n of model.nodes) model.adj.set(n.id, []);
  for (const [u, v] of model.edges) {
    if (model.adj.has(u)) model.adj.get(u).push(v);
    if (model.adj.has(v)) model.adj.get(v).push(u);
  }

  model.khopSet = null;
}

/* =========================
   Bin colours (palette)
   ========================= */
function buildBinColorMap() {
  binColorMap.clear();
  if (!graphModel) return;

  // Prefer the exact palette exported from Python (matches PNG plots)
  if (graphModel.bin_colors) {
    for (const [bin, color] of Object.entries(graphModel.bin_colors)) {
      binColorMap.set(bin, color); // color is hex string from matplotlib
    }
    return;
  }

  // Fallback (shouldn't happen once exporter is updated)
  const bins = new Set();
  for (const n of graphModel.nodes) {
    if (n.initial_bin) bins.add(n.initial_bin);
    if (n.final_bin) bins.add(n.final_bin);
  }
  const sorted = [...bins].sort();
  const total = sorted.length;
  for (let i = 0; i < total; i++) {
    const hue = (i * 360) / Math.max(1, total);
    binColorMap.set(sorted[i], `hsl(${hue}, 65%, 55%)`);
  }
}

function colorForBin(bin) {
  if (!bin) return (graphModel?.unbinned_color || "#d3d3d3"); // match PNG plots
  return binColorMap.get(bin) || "#6b7280";
}

function renderBinLegend() {
  const el = document.getElementById("bin-legend");
  if (!el) return;

  el.innerHTML = "";

  // Add unbinned
  el.appendChild(makeLegendRow("(unbinned)", "#d3d3d3"));

  // bins in sorted order for consistency
  const entries = [...binColorMap.entries()].sort((a, b) =>
    String(a[0]).localeCompare(String(b[0]))
  );

  for (const [bin, color] of entries) {
    el.appendChild(makeLegendRow(bin, color));
  }
}

function makeLegendRow(label, color) {
  const row = document.createElement("div");
  row.className = "bin-legend-item";

  const sw = document.createElement("div");
  sw.className = "bin-legend-swatch";
  sw.style.background = color;

  const txt = document.createElement("div");
  txt.className = "bin-legend-label";
  txt.textContent = label;

  row.appendChild(sw);
  row.appendChild(txt);
  return row;
}


/* =========================
   Interactive: UI + D3
   ========================= */
function initInteractiveUI() {
  const svgEl = document.getElementById("graph-svg");
  if (!svgEl || !window.d3) return; // interactive panel not present

  if (!graphSvg) {
    graphSvg = svgEl;
    const svg = d3.select(graphSvg);
    svg.selectAll("*").remove();
    graphG = svg.append("g").attr("class", "graph-layer");

    zoomBehavior = d3
      .zoom()
      .scaleExtent([0.05, 20])
      .on("zoom", (event) => {
        currentTransform = event.transform;
        graphG.attr("transform", currentTransform);
      });

    svg.call(zoomBehavior);

    if (!svgEl.dataset._resizeBound) {
      window.addEventListener("resize", () => {
        if (!graphModel) return;
        render();
      });
      svgEl.dataset._resizeBound = "1";
    }
  }

  // Controls (attach once)
  attachControl("view-mode", "change", (e) => {
    filters.mode = e.target.value;
    invalidateDerived();
    render();
  });

  attachControl("bin-filter", "change", (e) => {
    filters.binOnly = e.target.value;
    invalidateDerived();
    render();
  });

  attachControl("toggle-hide-unbinned", "change", (e) => {
    filters.hideUnbinned = e.target.checked;
    invalidateDerived();
    render();
  });

  attachControl("toggle-only-changed", "change", (e) => {
    filters.onlyChanged = e.target.checked;
    invalidateDerived();
    render();
  });

  attachControl("toggle-collapse-tips", "change", (e) => {
    filters.collapseTips = e.target.checked;
    invalidateDerived();
    render();
  });

  attachControl("apply-khop", "click", () => {
    const kEl = document.getElementById("k-hops");
    const k = parseInt((kEl && kEl.value) || "0", 10);
    filters.khopK = Math.max(0, k);
    filters.khopFrom = lockedNodeId || hoverNodeId || null;
    invalidateDerived();
    render();
  });

  attachControl("clear-khop", "click", () => {
    filters.khopFrom = null;
    filters.khopK = 0;
    invalidateDerived();
    render();
  });

  attachControl("reset-view", "click", () => {
    if (!graphModel) return;
    fitToView(graphModel);
    render();
  });

  populateBinFilter();
}

/* =========================
   Sankey: UI + rendering
   ========================= */
function initSankeyUI() {
  const svg = document.getElementById("sankey-svg");
  if (!svg) return;

  // controls
  attachControl("sankey-only-changed", "change", () => {
    sankeyLocked = null;
    renderSankey();
  });

  attachControl("sankey-hide-unbinned", "change", () => {
    sankeyLocked = null;
    renderSankey();
  });

  // resize
  if (!svg.dataset._resizeBound) {
    window.addEventListener("resize", () => {
      renderSankey();
    });
    svg.dataset._resizeBound = "1";
  }
}

function getSankeyOptions() {
  const onlyChanged = !!document.getElementById("sankey-only-changed")?.checked;
  const hideUnbinned = !!document.getElementById("sankey-hide-unbinned")?.checked;
  return { onlyChanged, hideUnbinned };
}

function buildSankeyData(model, opts) {
  const UN = "(unbinned)";
  const flows = new Map(); // key: init\tfin -> count
  const srcBins = new Set();
  const dstBins = new Set();

  for (const n of model.nodes) {
    if (opts.onlyChanged && !n.changed) continue;
    const s = (n.initial_bin == null || n.initial_bin === "") ? UN : String(n.initial_bin);
    const t = (n.final_bin == null || n.final_bin === "") ? UN : String(n.final_bin);
    if (opts.hideUnbinned && (s === UN || t === UN)) continue;

    srcBins.add(s);
    dstBins.add(t);
    const key = s + "\t" + t;
    flows.set(key, (flows.get(key) || 0) + 1);
  }

  // stable order
  const src = [...srcBins].sort((a, b) => a.localeCompare(b));
  const dst = [...dstBins].sort((a, b) => a.localeCompare(b));

  const nodes = [];
  const idx = new Map();

  for (const b of src) {
    const name = "Initial: " + b;
    idx.set(name, nodes.length);
    nodes.push({ name, side: "initial", bin: b });
  }
  for (const b of dst) {
    const name = "GraphBin: " + b;
    idx.set(name, nodes.length);
    nodes.push({ name, side: "final", bin: b });
  }

  const links = [];
  for (const [key, value] of flows.entries()) {
    const [s, t] = key.split("\t");
    const sName = "Initial: " + s;
    const tName = "GraphBin: " + t;
    links.push({
      source: idx.get(sName),
      target: idx.get(tName),
      value,
      srcBin: s,
      dstBin: t,
    });
  }

  return { nodes, links };
}

function renderSankey() {
  const svgEl = document.getElementById("sankey-svg");
  if (!svgEl || !window.d3 || !window.d3.sankey || !graphModel) return;

  const opts = getSankeyOptions();
  const tooltip = document.getElementById("sankey-tooltip");

  // Clear any stale tooltip
  if (tooltip) tooltip.style.display = "none";

  const wrap = svgEl.parentElement;
  const width = Math.max(320, wrap?.clientWidth || 900);
  const height = svgEl.clientHeight || 520;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const data = buildSankeyData(graphModel, opts);
  if (data.links.length === 0 || data.nodes.length === 0) {
    svg.append("text")
      .attr("x", 16)
      .attr("y", 24)
      .attr("font-size", 14)
      .attr("fill", "#6b7280")
      .text("No contigs match the current Sankey filters.");
    return;
  }

  const sankey = d3.sankey()
    .nodeWidth(16)
    .nodePadding(12)
    .extent([[16, 16], [width - 16, height - 16]]);

  // d3-sankey mutates in-place; use shallow clones
  const graph = sankey({
    nodes: data.nodes.map((d) => ({ ...d })),
    links: data.links.map((d) => ({ ...d })),
  });

  const linkKey = (l) => `${l.srcBin}\t${l.dstBin}`;

  // links
  const linkG = svg.append("g").attr("fill", "none");

  const linkSel = linkG
    .selectAll("path")
    .data(graph.links)
    .join("path")
    .attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke-width", (d) => Math.max(1, d.width))
    .attr("stroke", (d) => colorForBin(d.srcBin === "(unbinned)" ? null : d.srcBin))
    .attr("stroke-opacity", (d) => {
      if (!sankeyLocked) return 0.35;
      return (d.srcBin === sankeyLocked.srcBin && d.dstBin === sankeyLocked.dstBin) ? 0.85 : 0.08;
    })
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      event.preventDefault();
      const hit = { srcBin: d.srcBin, dstBin: d.dstBin };
      if (sankeyLocked && sankeyLocked.srcBin === hit.srcBin && sankeyLocked.dstBin === hit.dstBin) {
        sankeyLocked = null;
      } else {
        sankeyLocked = hit;
      }
      renderSankey();
    });

  // tooltip
  linkSel
    .on("mousemove", (event, d) => {
      if (!tooltip) return;
      const rect = wrap.getBoundingClientRect();
      tooltip.style.display = "block";
      tooltip.style.left = (event.clientX - rect.left + 12) + "px";
      tooltip.style.top = (event.clientY - rect.top + 12) + "px";
      const s = d.srcBin;
      const t = d.dstBin;
      tooltip.innerHTML = `
        <div><b>${escapeHtml(s)}</b> → <b>${escapeHtml(t)}</b></div>
        <div>contigs: ${d.value}</div>
      `;
    })
    .on("mouseleave", () => {
      if (tooltip) tooltip.style.display = "none";
    });

  // nodes
  const node = svg
    .append("g")
    .selectAll("g")
    .data(graph.nodes)
    .join("g");

  node
    .append("rect")
    .attr("x", (d) => d.x0)
    .attr("y", (d) => d.y0)
    .attr("height", (d) => Math.max(1, d.y1 - d.y0))
    .attr("width", (d) => d.x1 - d.x0)
    .attr("rx", 3)
    .attr("ry", 3)
    .attr("fill", (d) => colorForBin(d.bin === "(unbinned)" ? null : d.bin))
    .attr("stroke", "rgba(0,0,0,0.25)");

  node
    .append("text")
    .attr("x", (d) => (d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6))
    .attr("y", (d) => (d.y0 + d.y1) / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", (d) => (d.x0 < width / 2 ? "start" : "end"))
    .attr("font-size", 12)
    .attr("fill", "#111827")
    .text((d) => {
      // strip the side prefix for the label to keep it compact
      const s = d.name.includes(": ") ? d.name.split(": ")[1] : d.name;
      return s;
    });
}

function attachControl(id, event, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.dataset._bound === "1") return;
  el.addEventListener(event, handler);
  el.dataset._bound = "1";
}

function populateBinFilter() {
  const sel = document.getElementById("bin-filter");
  if (!sel || !graphModel) return;

  // remove all but first option
  while (sel.options.length > 1) sel.remove(1);

  const bins = new Set();
  for (const n of graphModel.nodes) {
    if (n.initial_bin) bins.add(n.initial_bin);
    if (n.final_bin) bins.add(n.final_bin);
  }
  [...bins].sort().forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b;
    opt.textContent = b;
    sel.appendChild(opt);
  });
}

/* =========================
   Interactive: math / view
   ========================= */
function getSvgSize() {
  if (!graphSvg) return { width: 900, height: 700 };
  const rect = graphSvg.getBoundingClientRect();
  const width = Math.max(1, rect.width || 900);
  const height = Math.max(1, rect.height || 700);
  return { width, height };
}

function fitToView(model) {
  if (!graphSvg || !model || !zoomBehavior || !window.d3) return;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const n of model.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }

  const w = maxX - minX || 1;
  const h = maxY - minY || 1;

  const padding = 40;
  const { width, height } = getSvgSize();

  const sx = (width - padding * 2) / w;
  const sy = (height - padding * 2) / h;
  const s = Math.min(sx, sy);

  const tx = padding - minX * s;
  const ty = padding - minY * s;

  const t = d3.zoomIdentity.translate(tx, ty).scale(s);
  d3.select(graphSvg).call(zoomBehavior.transform, t);
  currentTransform = t;
}

/* =========================
   Interactive: filters
   ========================= */
function invalidateDerived() {
  if (graphModel) graphModel.khopSet = null;
}

function nodeBin(n, mode) {
  return mode === "initial" ? n.initial_bin : n.final_bin;
}

function isNodeVisible(n) {
  const b = nodeBin(n, filters.mode);

  if (filters.hideUnbinned && (b == null || b === "")) return false;
  if (filters.onlyChanged && !n.changed) return false;
  if (filters.binOnly && b !== filters.binOnly) return false;

  if (filters.khopFrom && filters.khopK >= 0) {
    if (!graphModel.khopSet) graphModel.khopSet = computeKHop(filters.khopFrom, filters.khopK);
    if (!graphModel.khopSet.has(n.id)) return false;
  }

  if (filters.collapseTips) {
    const deg = (graphModel.adj.get(n.id) || []).length;
    if (deg <= 1 && n.id !== lockedNodeId && n.id !== hoverNodeId) return false;
  }

  return true;
}

function computeKHop(startId, k) {
  if (!graphModel.adj || !graphModel.adj.has(startId)) return new Set();
  const seen = new Set([startId]);
  let frontier = [startId];

  for (let d = 0; d < k; d++) {
    const next = [];
    for (const u of frontier) {
      for (const v of graphModel.adj.get(u) || []) {
        if (!seen.has(v)) {
          seen.add(v);
          next.push(v);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return seen;
}

function adjacentBinMix(nodeId, mode) {
  const adj = graphModel.adj.get(nodeId) || [];
  const counts = new Map();

  for (const v of adj) {
    const nb = nodeBin(getNode(v), mode) ?? "(unbinned)";
    counts.set(nb, (counts.get(nb) || 0) + 1);
  }

  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return entries.map(([k, c]) => `${k}:${c}`).join(", ");
}

/* =========================
   Interactive: tooltip
   ========================= */
function getNode(id) {
  return graphModel.nodesById.get(id);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[c];
  });
}

function formatTooltip(n) {
  const init = n.initial_bin ?? "(unbinned)";
  const fin = n.final_bin ?? "(unbinned)";
  const shown = nodeBin(n, filters.mode) ?? "(unbinned)";

  const deg = (graphModel.adj.get(n.id) || []).length;
  const mix = adjacentBinMix(n.id, filters.mode);

  return `
    <div><b>${escapeHtml(n.id)}</b></div>
    <div>length: ${n.len ?? 0}bp</div>
    <div>GC%: ${n.gc == null ? "n/a" : Number(n.gc).toFixed(2)}</div>
    <div>coverage: ${n.cov == null ? "n/a" : Number(n.cov).toFixed(2)}</div>
    <div>degree: ${deg}</div>
    <div>initial: ${escapeHtml(init)}</div>
    <div>final: ${escapeHtml(fin)}</div>
    <div>shown: ${escapeHtml(shown)}</div>
    <div>adj bins: ${escapeHtml(mix || "n/a")}</div>
  `;
}

function showTooltip(tooltip, wrap, event, n) {
  if (!tooltip || !wrap) return;
  const rect = wrap.getBoundingClientRect();
  tooltip.style.display = "block";
  tooltip.style.left = event.clientX - rect.left + 12 + "px";
  tooltip.style.top = event.clientY - rect.top + 12 + "px";
  tooltip.innerHTML = formatTooltip(n);
}

function hideTooltip(tooltip) {
  if (!tooltip) return;
  tooltip.style.display = "none";
  tooltip.innerHTML = "";
}

/* =========================
   Interactive: drawing
   ========================= */
function render() {
  if (!graphModel || !graphSvg || !graphG || !window.d3) return;

  // compute khop set if needed
  if (filters.khopFrom && filters.khopK >= 0) {
    if (
      !graphModel.khopSet ||
      graphModel.khopSet._start !== filters.khopFrom ||
      graphModel.khopSet._k !== filters.khopK
    ) {
      const s = computeKHop(filters.khopFrom, filters.khopK);
      s._start = filters.khopFrom;
      s._k = filters.khopK;
      graphModel.khopSet = s;
    }
  } else {
    graphModel.khopSet = null;
  }

  const { width, height } = getSvgSize();
  const svg = d3.select(graphSvg);
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const visibleNodes = graphModel.nodes.filter((n) => isNodeVisible(n));
  const visibleIds = new Set(visibleNodes.map((n) => n.id));

  if (hoverNodeId && !visibleIds.has(hoverNodeId)) hoverNodeId = null;
  if (lockedNodeId && !visibleIds.has(lockedNodeId)) lockedNodeId = null;

  const edgeData = graphModel.edges
    .map(([u, v]) => ({ u, v }))
    .filter((e) => visibleIds.has(e.u) && visibleIds.has(e.v));

  const edgeSel = graphG
    .selectAll("line.edge")
    .data(edgeData, (d) => `${d.u}->${d.v}`);

  edgeSel
    .enter()
    .append("line")
    .attr("class", "edge")
    .attr("stroke", "#111827")
    .attr("stroke-opacity", 0.25)
    .attr("stroke-width", 1)
    .merge(edgeSel)
    .attr("x1", (d) => getNode(d.u).x)
    .attr("y1", (d) => getNode(d.u).y)
    .attr("x2", (d) => getNode(d.v).x)
    .attr("y2", (d) => getNode(d.v).y);

  edgeSel.exit().remove();

  const tooltip = document.getElementById("hover-tooltip");
  const wrap = graphSvg.parentElement;

  const nodeSel = graphG
    .selectAll("circle.node")
    .data(visibleNodes, (d) => d.id);

  nodeSel
    .enter()
    .append("circle")
    .attr("class", "node")
    .style("cursor", "pointer")
    .on("mouseenter", (event, d) => {
      hoverNodeId = d.id;
      showTooltip(tooltip, wrap, event, d);
      render();
    })
    .on("mousemove", (event, d) => {
      showTooltip(tooltip, wrap, event, d);
    })
    .on("mouseleave", () => {
      hoverNodeId = null;
      hideTooltip(tooltip);
      render();
    })
    .on("click", (event, d) => {
      event.stopPropagation();
      lockedNodeId = lockedNodeId === d.id ? null : d.id;
      render();
    })
    .merge(nodeSel)
    .attr("cx", (d) => d.x)
    .attr("cy", (d) => d.y)
    .attr("r", (d) => {
      if (d.id === lockedNodeId) return NODE_RADIUS.locked;
      if (d.id === hoverNodeId) return NODE_RADIUS.hover;
      return NODE_RADIUS.base;
    })
    .attr("fill", (d) => colorForBin(nodeBin(d, filters.mode)))
    .attr("stroke", (d) => {
      if (d.id === lockedNodeId) return "#2563eb";
      if (d.id === hoverNodeId) return "#111827";
      if (d.changed) return "#000000";
      const b = nodeBin(d, filters.mode);
      return b ? "rgba(0,0,0,0.15)" : "#9ca3af";
    })
    .attr("stroke-width", (d) => {
      if (d.id === lockedNodeId) return 3;
      if (d.id === hoverNodeId) return 2;
      if (d.changed) return 3;
      const b = nodeBin(d, filters.mode);
      return b ? 0.8 : 1.2;
    });

  nodeSel.exit().remove();
}

}
