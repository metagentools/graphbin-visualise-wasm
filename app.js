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

let canvas = null;
let ctx = null;

// pan/zoom state
let view = { tx: 0, ty: 0, scale: 1 };
let dragging = false;
let lastMouse = { x: 0, y: 0 };

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

// spatial index (grid hash in world coords)
let spatial = { cell: 20, map: new Map() };

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

  /* =============================
   * Clear interactive canvas plot
   * ============================= */
  const canvas = document.getElementById("graph-canvas");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset zoom/pan
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

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
      resizeCanvasToDisplaySize();
      fitToView(graphModel);
      rebuildSpatialIndex();
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
      resizeCanvasToDisplaySize();
      fitToView(graphModel);
      rebuildSpatialIndex();
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
   Interactive: UI + canvas
   ========================= */
function initInteractiveUI() {
  const c = document.getElementById("graph-canvas");
  if (!c) return; // interactive panel not present

  if (!canvas) {
    canvas = c;
    ctx = canvas.getContext("2d");

    // Resize on window resize
    window.addEventListener("resize", () => {
      if (!graphModel) return;
      resizeCanvasToDisplaySize();
      // keep view stable on resize: no fitToView here
      rebuildSpatialIndex();
      render();
    });

    // Pointer interactions
    canvas.addEventListener("mousedown", (e) => {
      dragging = true;
      lastMouse = { x: e.offsetX, y: e.offsetY };
    });

    window.addEventListener("mouseup", () => {
      dragging = false;
    });

    canvas.addEventListener("mousemove", (e) => {
      const x = e.offsetX,
        y = e.offsetY;

      if (dragging) {
        const dx = x - lastMouse.x;
        const dy = y - lastMouse.y;
        view.tx += dx;
        view.ty += dy;
        lastMouse = { x, y };
        render();
        return;
      }

      hoverNodeId = pickNode(x, y);

      const tooltip = document.getElementById("hover-tooltip");
      if (tooltip) {
        if (hoverNodeId) {
          const n = getNode(hoverNodeId);
          tooltip.style.display = "block";
          tooltip.style.left = x + 12 + "px";
          tooltip.style.top = y + 12 + "px";
          tooltip.innerHTML = formatTooltip(n);
        } else {
          tooltip.style.display = "none";
        }
      }

      render();
    });

    canvas.addEventListener("click", (e) => {
      const nodeId = pickNode(e.offsetX, e.offsetY);
      lockedNodeId = lockedNodeId === nodeId ? null : nodeId;
      render();
    });

    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const mouseX = e.offsetX;
        const mouseY = e.offsetY;

        const zoom = Math.exp(-e.deltaY * 0.001);
        const oldScale = view.scale;
        const newScale = clamp(oldScale * zoom, 0.05, 20);

        const wx = (mouseX - view.tx) / oldScale;
        const wy = (mouseY - view.ty) / oldScale;

        view.scale = newScale;
        view.tx = mouseX - wx * newScale;
        view.ty = mouseY - wy * newScale;

        render();
      },
      { passive: false }
    );
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
    resizeCanvasToDisplaySize();
    fitToView(graphModel);
    rebuildSpatialIndex();
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

function resizeCanvasToDisplaySize() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr); // draw using CSS pixel coords
  }
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
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function fitToView(model) {
  if (!canvas || !model) return;

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
  const cw = canvas.clientWidth || 900;
  const ch = canvas.clientHeight || 700;

  const sx = (cw - padding * 2) / w;
  const sy = (ch - padding * 2) / h;
  const s = Math.min(sx, sy);

  view.scale = s;
  view.tx = padding - minX * s;
  view.ty = padding - minY * s;
}

function worldToScreen(x, y) {
  return { x: x * view.scale + view.tx, y: y * view.scale + view.ty };
}

function screenToWorld(x, y) {
  return { x: (x - view.tx) / view.scale, y: (y - view.ty) / view.scale };
}

/* =========================
   Interactive: spatial index
   ========================= */
function rebuildSpatialIndex() {
  if (!graphModel) return;
  spatial.map.clear();
  const cell = spatial.cell;

  for (const n of graphModel.nodes) {
    const cx = Math.floor(n.x / cell);
    const cy = Math.floor(n.y / cell);
    const key = cx + "," + cy;
    if (!spatial.map.has(key)) spatial.map.set(key, []);
    spatial.map.get(key).push(n.id);
  }
}

function pickNode(screenX, screenY) {
  if (!graphModel) return null;
  const w = screenToWorld(screenX, screenY);

  const rScreen = 8; // px
  const rWorld = rScreen / view.scale;

  const cell = spatial.cell;
  const cx = Math.floor(w.x / cell);
  const cy = Math.floor(w.y / cell);

  let best = null;
  let bestD2 = Infinity;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = cx + dx + "," + (cy + dy);
      const list = spatial.map.get(key);
      if (!list) continue;

      for (const id of list) {
        const n = getNode(id);
        if (!isNodeVisible(n)) continue;

        const ddx = n.x - w.x;
        const ddy = n.y - w.y;
        const d2 = ddx * ddx + ddy * ddy;

        if (d2 < bestD2 && d2 <= rWorld * rWorld) {
          bestD2 = d2;
          best = id;
        }
      }
    }
  }
  return best;
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

/* =========================
   Interactive: drawing
   ========================= */
function render() {
  if (!graphModel || !canvas || !ctx) return;

  resizeCanvasToDisplaySize();

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

  // clear in CSS pixel coords
  const w = canvas.clientWidth || 900;
  const h = canvas.clientHeight || 700;
  ctx.clearRect(0, 0, w, h);

  // edges
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "#111827";

  for (const [u, v] of graphModel.edges) {
    const nu = getNode(u);
    const nv = getNode(v);
    if (!isNodeVisible(nu) || !isNodeVisible(nv)) continue;

    const a = worldToScreen(nu.x, nu.y);
    const b = worldToScreen(nv.x, nv.y);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // nodes
  ctx.globalAlpha = 1.0;

  for (const n of graphModel.nodes) {
    if (!isNodeVisible(n)) continue;

    const p = worldToScreen(n.x, n.y);
    const isHover = n.id === hoverNodeId;
    const isLocked = n.id === lockedNodeId;

    let r = NODE_RADIUS.base;
    if (n.id === hoverNodeId) r = NODE_RADIUS.hover;
    if (n.id === lockedNodeId) r = NODE_RADIUS.locked;

    // fill by bin (current mode)
    const b = nodeBin(n, filters.mode);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = colorForBin(b);
    ctx.fill();

    if (!b) { // unbinned
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#9ca3af";
      ctx.stroke();
    }

    // changed ring (keep bin colour visible)
    if (n.changed) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
    }

    // hover/locked outline
    if (isLocked) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#2563eb";
      ctx.stroke();
    } else if (isHover) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#111827";
      ctx.stroke();
    }
  }
}
