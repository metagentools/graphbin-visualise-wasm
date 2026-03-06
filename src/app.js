export function initApp() {
  if (window.__graphbinAppInitialized) return;
  window.__graphbinAppInitialized = true;

const outputEl = document.getElementById("output");
const graphbinStatusEl = document.getElementById("graphbin-status");
let graphbinStatusBuffer = [];
let graphbinStatusHasLog = false;

const NODE_RADIUS = {
  base: 5.5,     // default node radius
  hover: 7.5,    // on hover
  locked: 8.5,   // on click
};

const NODE_RADIUS_DELTA = {
  hover: NODE_RADIUS.hover - NODE_RADIUS.base,
  locked: NODE_RADIUS.locked - NODE_RADIUS.base,
};

const GRAPHBIN_DEFAULTS = {
  max_iteration: 50,
  diff_threshold: 0.00001,
  min_bin_size: 5,
};

// Initial placeholder when page loads
outputEl.textContent = "(logs will appear here)\n\n";

function log(msg) {
  outputEl.textContent += msg + "\n";
}

function mapGraphbinError(statusText, fallbackErr) {
  const text = String(statusText || "");
  if (text.toLowerCase().includes("input mismatch")) {
    return new Error(
      "Input mismatch between initial binning results and provided assembly/contig files. Please check inputs."
    );
  }
  return fallbackErr;
}

function setGraphbinStatus(msg) {
  if (!graphbinStatusEl) return;
  graphbinStatusEl.textContent = msg;
}

function resetGraphbinStatus(msg) {
  graphbinStatusBuffer = [];
  graphbinStatusHasLog = false;
  setGraphbinStatus(msg);
}

function appendGraphbinStatus(msg) {
  if (!graphbinStatusEl) return;
  const lines = String(msg ?? "").split("\n");
  for (const line of lines) {
    graphbinStatusBuffer.push(line);
  }
  if (graphbinStatusBuffer.length > 2000) {
    graphbinStatusBuffer = graphbinStatusBuffer.slice(-2000);
  }
  graphbinStatusHasLog = true;
  graphbinStatusEl.textContent = graphbinStatusBuffer.join("\n");
  graphbinStatusEl.scrollTop = graphbinStatusEl.scrollHeight;
}

window.graphbinLog = appendGraphbinStatus;

// store Pyodide init promise here, but don't start it yet
let pyodideReady = null;

// Track last generated plot paths for download
let lastInitialImgPath = null;
let lastFinalImgPath = null;
let lastGraphbinZipPath = null;
let benchmarkRunId = 0;

window.__lastBenchmark = null;
window.__benchmarkHistory = [];

function nowMs() {
  if (window.performance && typeof window.performance.now === "function") {
    return window.performance.now();
  }
  return Date.now();
}

function roundMs(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function publishRunningBenchmark(run) {
  window.__lastBenchmark = {
    run_id: run.run_id,
    status: "running",
    source: run.source,
    dataset: run.dataset,
    assembler: run.assembler,
    started_at: run.started_at,
  };
}

function startBenchmarkRun({ source, dataset, assembler, delimiter, fileSizes }) {
  benchmarkRunId += 1;
  const run = {
    run_id: benchmarkRunId,
    source,
    dataset,
    assembler: assembler || "spades",
    delimiter,
    started_at: new Date().toISOString(),
    user_agent: navigator.userAgent,
    file_sizes_bytes: fileSizes || {},
    counts: { nodes: null, edges: null },
    phase_ms: {
      pyodide_init: null,
      input_load: null,
      graphbin: null,
      visualize: null,
      layout: null,
      interactive_prepare: null,
      interactive_render_ready: null,
    },
    error: null,
    _started_perf_ms: nowMs(),
  };
  publishRunningBenchmark(run);
  return run;
}

function finishBenchmarkRun(run, { status, error = null } = {}) {
  const completedAt = new Date().toISOString();
  const totalMs = roundMs(nowMs() - run._started_perf_ms);
  const result = {
    run_id: run.run_id,
    source: run.source,
    dataset: run.dataset,
    assembler: run.assembler,
    delimiter: run.delimiter,
    status: status || "success",
    started_at: run.started_at,
    completed_at: completedAt,
    total_ms: totalMs,
    user_agent: run.user_agent,
    file_sizes_bytes: run.file_sizes_bytes,
    counts: run.counts,
    phase_ms: run.phase_ms,
    error: error || run.error || null,
  };

  window.__lastBenchmark = result;
  if (!Array.isArray(window.__benchmarkHistory)) {
    window.__benchmarkHistory = [];
  }
  window.__benchmarkHistory.push(result);
  if (window.__benchmarkHistory.length > 200) {
    window.__benchmarkHistory = window.__benchmarkHistory.slice(-200);
  }
  return result;
}

function waitForRenderFrame(drawFn) {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      drawFn();
      resolve();
    });
  });
}

function getPyodideFileSize(pyodide, path) {
  try {
    return pyodide.FS.stat(path).size;
  } catch (e) {
    return null;
  }
}

/* =========================
   Interactive graph globals
   ========================= */
let graphModel = null;

let canvas = null;
let ctx = null;
let zoomBehavior = null;
let currentTransform = null;

let hoverNodeId = null;
let lockedNodeId = null;

let baseNodeRadius = NODE_RADIUS.base;

// sankey state
let sankeyLocked = null; // {srcBin, dstBin} or null

// filters
let filters = {
  mode: "initial", // "initial" or "final"
  binOnly: "", // "" = all
  hideUnbinned: false,
  onlyChanged: false,
  hideIsolated: false,
  showAmbiguousOutline: false,
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
  currentTransform = null;
  hoverNodeId = null;
  lockedNodeId = null;

  /* =============================
   * Clear interactive canvas plot
   * ============================= */
  const c = document.getElementById("graph-canvas");
  if (c) {
    const cctx = c.getContext("2d");
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(0, 0, c.width, c.height);
  }
  canvas = null;
  ctx = null;
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

  // Reset flow stats
  setFlowStat("flow-stat-changed", "—");
  setFlowStat("flow-stat-reassigned", "—");
  setFlowStat("flow-stat-unbinned-to-binned", "—");
  setFlowStat("flow-stat-binned-to-unbinned", "—");

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

  // Binning to display → Initial
  const viewMode = document.getElementById("view-mode");
  if (viewMode) {
    viewMode.value = "initial";
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

  // Node size slider → default
  const nodeSize = document.getElementById("node-size");
  if (nodeSize) {
    nodeSize.value = String(NODE_RADIUS.base);
  }
  setBaseNodeRadius(NODE_RADIUS.base);

  // Hide isolated contigs → unchecked
  const hideIsolated = document.getElementById("toggle-hide-isolated");
  if (hideIsolated) {
    hideIsolated.checked = false;
  }

  // Show ambiguous → unchecked
  const showAmbiguousOutline = document.getElementById("toggle-show-ambiguous");
  if (showAmbiguousOutline) {
    showAmbiguousOutline.checked = false;
  }
}




/* =========================
   File size checks
   ========================= */
const MAX_CONTIGS = 10000;

function countFastaContigs(text) {
  let count = 0;
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith(">")) count += 1;
  }
  return count;
}

async function validateContigsCount(file) {
  const text = await file.text();
  const contigCount = countFastaContigs(text);
  return {
    ok: contigCount <= MAX_CONTIGS,
    count: contigCount,
  };
}

document.getElementById("graph").addEventListener("change", function () {
  const file = this.files[0];
  const MAX_SIZE = 200 * 1024 * 1024; // 200MB
  if (file && !file.name.toLowerCase().endsWith(".gfa")) {
    alert("Please upload a valid GFA file ending with .gfa.");
    this.value = "";
    return;
  }
  if (file && file.size > MAX_SIZE) {
    alert("GFA file is too large! Maximum allowed size is 200 MB.");
    this.value = "";
  }
});

document.getElementById("contigs").addEventListener("change", async function () {
  const file = this.files[0];
  const MAX_SIZE = 200 * 1024 * 1024; // 200MB
  const ALLOWED_EXTENSIONS = [".fasta", ".fa", ".fna"];
  delete this.dataset.contigCount;

  if (
    file &&
    !ALLOWED_EXTENSIONS.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    )
  ) {
    alert("Please upload a contigs file ending with .fasta, .fa, or .fna.");
    this.value = "";
    return;
  }

  if (file && file.size > MAX_SIZE) {
    alert("Contigs file is too large! Maximum allowed size is 200 MB.");
    this.value = "";
    return;
  }

  if (!file) return;

  try {
    const result = await validateContigsCount(file);
    if (!result.ok) {
      alert(
        `Contigs file has ${result.count.toLocaleString()} contigs. Maximum allowed is ${MAX_CONTIGS.toLocaleString()}.`
      );
      this.value = "";
      return;
    }
    this.dataset.contigCount = String(result.count);
  } catch (e) {
    alert("Failed to read contigs file. Please upload a valid FASTA file.");
    this.value = "";
  }
});

document.getElementById("initial").addEventListener("change", function () {
  const file = this.files[0];
  const ALLOWED_EXTENSIONS = [".csv", ".tsv"];
  if (
    file &&
    !ALLOWED_EXTENSIONS.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    )
  ) {
    alert("Please upload an initial binning result file ending with .csv or .tsv.");
    this.value = "";
  }
});

const assemblerSelect = document.getElementById("assembler");
const pathsInput = document.getElementById("paths");
const pathsRow = document.getElementById("paths-row");
const pathsLabel = document.querySelector('label[for="paths"]');

function syncAssemblerInputs() {
  const assembler = assemblerSelect ? assemblerSelect.value : "spades";
  const isSpades = assembler === "spades";

  if (pathsInput) {
    pathsInput.disabled = !isSpades;
    if (!isSpades) {
      pathsInput.value = "";
    }
  }

  if (pathsRow) {
    pathsRow.style.opacity = "1";
  }

  if (pathsLabel) {
    pathsLabel.textContent = isSpades
      ? "Paths file"
      : "Paths file";
  }
}

if (assemblerSelect) {
  assemblerSelect.addEventListener("change", syncAssemblerInputs);
  syncAssemblerInputs();
}

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
      pyodide.FS.mkdir("/py/graphbin");
    } catch (e) {}
    try {
      pyodide.FS.mkdir("/py/graphbin/parsers");
    } catch (e) {}
    try {
      pyodide.FS.mkdir("/py/graphbin/labelpropagation");
    } catch (e) {}
    try {
      pyodide.FS.mkdir("/data");
    } catch (e) {}
    try {
      pyodide.FS.mkdir("/out");
    } catch (e) {}

    // Fetch Python files and write them into Pyodide’s filesystem
    const files = [
      "spades_plot.py",
      "megahit_plot.py",
      "bidictmap.py",
      "interactive_export.py",
      "interactive_export_megahit.py",
      "graphbin/graphbin_SPAdes.py",
      "graphbin/graphbin_MEGAHIT.py",
      "graphbin/graphbin_Func.py",
      "graphbin/labelpropagation/__init__.py",
      "graphbin/labelpropagation/labelprop.py",
      "graphbin/parsers/__init__.py",
      "graphbin/parsers/spades_parser.py",
      "graphbin/parsers/megahit_parser.py",
    ];
    log("Loading Python files into Pyodide FS...");
    for (const f of files) {
      const text = await (await fetch("py/" + f)).text();
      pyodide.FS.writeFile("/py/" + f, text);
    }

    // Make Pyodide import from /py
    await pyodide.runPythonAsync(`
import sys
if "/py" not in sys.path:
    sys.path.append("/py")
if "/py/graphbin" not in sys.path:
    sys.path.append("/py/graphbin")
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

function readTextFromPyodide(pyodide, path) {
  return pyodide.FS.readFile(path, { encoding: "utf8" });
}

function readLayoutTimingFromPyodide(pyodide, path = "/out/layout_timing.json") {
  try {
    const data = readJsonFromPyodide(pyodide, path);
    const layoutMs = Number(data?.layout_ms);
    return Number.isFinite(layoutMs) ? roundMs(layoutMs) : null;
  } catch (e) {
    return null;
  }
}

function getFileExtension(path) {
  const match = String(path || "").match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

function mimeForExtension(ext) {
  if (ext === "png") return "image/png";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

function fileToObjectUrl(pyodide, path) {
  const ext = getFileExtension(path);
  const data = pyodide.FS.readFile(path); // Uint8Array
  const blob = new Blob([data], { type: mimeForExtension(ext) });
  return URL.createObjectURL(blob);
}

function setPlotMedia(pyodide, which, path) {
  const ext = getFileExtension(path);
  const img = document.getElementById(`${which}-img`);
  const pdf = document.getElementById(`${which}-pdf`);
  const url = fileToObjectUrl(pyodide, path);
  if (ext === "pdf") {
    if (img) img.style.display = "none";
    if (pdf) {
      pdf.style.display = "block";
      pdf.src = url;
    }
  } else {
    if (pdf) {
      pdf.style.display = "none";
      pdf.src = "";
    }
    if (img) {
      img.style.display = "block";
      img.src = url;
    }
  }
}

/* =========================
   Main: Run user inputs
   ========================= */
async function runInputPlot() {
  // clear old logs and hide old plots
  outputEl.textContent = "";
  resetGraphbinStatus("(GraphBin logs will appear here)");
  const initialBlock = document.getElementById("initial-block");
  const finalBlock = document.getElementById("final-block");
  if (initialBlock) initialBlock.style.display = "none";
  if (finalBlock) finalBlock.style.display = "none";

  const graph = document.getElementById("graph").files[0];
  const contigs = document.getElementById("contigs").files[0];
  const assembler = document.getElementById("assembler").value;
  const requiresPaths = assembler === "spades";
  const paths = document.getElementById("paths").files[0];
  const initial = document.getElementById("initial").files[0];

  const setDpi = parseInt(document.getElementById("setting-dpi").value);
  const setWidth = parseInt(document.getElementById("setting-width").value);
  const setHeight = parseInt(document.getElementById("setting-height").value);
  const setVsize = parseInt(document.getElementById("setting-vsize").value);
  const setLsize = parseInt(document.getElementById("setting-lsize").value);
  const setImgtype = document.getElementById("setting-imgtype").value;
  const setDelimiter = document.getElementById("setting-delimiter").value;
  const setMaxIterRaw = parseInt(document.getElementById("setting-max-iter").value, 10);
  const setMinBinRaw = parseInt(
    document.getElementById("setting-min-bin-size").value,
    10
  );
  const setDiffRaw = parseFloat(
    document.getElementById("setting-diff-threshold").value
  );
  const showLpLogValue = document.getElementById("setting-show-lp-log").value;
  const setMaxIter =
    Number.isFinite(setMaxIterRaw) && setMaxIterRaw > 0
      ? setMaxIterRaw
      : GRAPHBIN_DEFAULTS.max_iteration;
  const setMinBinSize =
    Number.isFinite(setMinBinRaw) && setMinBinRaw > 0
      ? setMinBinRaw
      : GRAPHBIN_DEFAULTS.min_bin_size;
  const setDiffThreshold =
    Number.isFinite(setDiffRaw) && setDiffRaw >= 0
      ? setDiffRaw
      : GRAPHBIN_DEFAULTS.diff_threshold;
  const setShowLpLog = showLpLogValue === "true";

  if (!graph || !contigs || !initial || (requiresPaths && !paths)) {
    if (requiresPaths) {
      log("Please pick all input files (graph, contigs, paths, initial).");
    } else {
      log("Please pick all input files (graph, contigs, initial).");
    }
    return;
  }

  const benchmark = startBenchmarkRun({
    source: "upload",
    dataset: graph.name || "uploaded-dataset",
    assembler,
    delimiter: setDelimiter,
    fileSizes: {
      graph: graph.size ?? null,
      contigs: contigs.size ?? null,
      paths: requiresPaths && paths ? paths.size ?? null : null,
      initial: initial.size ?? null,
    },
  });

  try {
    const pyodideStart = nowMs();
    const pyodide = await getPyodide();
    benchmark.phase_ms.pyodide_init = roundMs(nowMs() - pyodideStart);

    log("Writing input files into Pyodide FS... This step can take a while for large files. Please be patient!");

    const inputLoadStart = nowMs();
    const graphPath = await writeUploadedFile(pyodide, graph, "/data/assembly_graph.gfa");
    const contigsPath = await writeUploadedFile(pyodide, contigs, "/data/contigs.fasta");
    const pathsPath = requiresPaths
      ? await writeUploadedFile(pyodide, paths, "/data/contigs.paths")
      : null;
    const initialPath = await writeUploadedFile(pyodide, initial, "/data/initial_binning.tsv");
    benchmark.phase_ms.input_load = roundMs(nowMs() - inputLoadStart);
    let finalPath = "/out/graphbin_output.csv";

    if (requiresPaths) {
      const graphbinArgs = {
        graph: graphPath,
        contigs: contigsPath,
        paths: pathsPath,
        binned: initialPath,
        output: "/out/",
        prefix: "",
        delimiter: setDelimiter,
        max_iteration: setMaxIter,
        min_bin_size: setMinBinSize,
        diff_threshold: setDiffThreshold,
        show_lp_log: setShowLpLog,
      };

      log("Running GraphBin in Pyodide... This step can take a while for large files.");
      resetGraphbinStatus("Running GraphBin...");

      const graphbinStart = nowMs();
      try {
        await pyodide.runPythonAsync(`
import json
from types import SimpleNamespace
import graphbin_SPAdes

args_dict = json.loads(${JSON.stringify(JSON.stringify(graphbinArgs))})
args_ns = SimpleNamespace(**args_dict)

graphbin_SPAdes.run(args_ns)
  `);
        benchmark.phase_ms.graphbin = roundMs(nowMs() - graphbinStart);
      } catch (err) {
        benchmark.phase_ms.graphbin = roundMs(nowMs() - graphbinStart);
        let status = "GraphBin failed. ";
        try {
          const logText = readTextFromPyodide(pyodide, "/out/graphbin.log");
          status += logText ? "\n" + logText : String(err);
        } catch (e) {
          status += String(err);
        }
        setGraphbinStatus(status.trim());
        throw mapGraphbinError(status, err);
      }

      if (!graphbinStatusHasLog) {
        try {
          const logText = readTextFromPyodide(pyodide, "/out/graphbin.log");
          if (logText && logText.trim().length > 0) {
            setGraphbinStatus(logText);
          } else {
            setGraphbinStatus("GraphBin finished. Log file was empty.");
          }
        } catch (e) {
          setGraphbinStatus("GraphBin finished. Log file not available.");
        }
      }
    } else {
      const graphbinArgs = {
        graph: graphPath,
        contigs: contigsPath,
        binned: initialPath,
        output: "/out/",
        prefix: "",
        delimiter: setDelimiter,
        max_iteration: setMaxIter,
        min_bin_size: setMinBinSize,
        diff_threshold: setDiffThreshold,
        show_lp_log: setShowLpLog,
      };

      log("Running GraphBin in Pyodide... This step can take a while for large files.");
      resetGraphbinStatus("Running GraphBin...");

      const graphbinStart = nowMs();
      try {
        await pyodide.runPythonAsync(`
import json
from types import SimpleNamespace
import graphbin_MEGAHIT

args_dict = json.loads(${JSON.stringify(JSON.stringify(graphbinArgs))})
args_ns = SimpleNamespace(**args_dict)

graphbin_MEGAHIT.run(args_ns)
  `);
        benchmark.phase_ms.graphbin = roundMs(nowMs() - graphbinStart);
      } catch (err) {
        benchmark.phase_ms.graphbin = roundMs(nowMs() - graphbinStart);
        let status = "GraphBin failed. ";
        try {
          const logText = readTextFromPyodide(pyodide, "/out/graphbin.log");
          status += logText ? "\n" + logText : String(err);
        } catch (e) {
          status += String(err);
        }
        setGraphbinStatus(status.trim());
        throw mapGraphbinError(status, err);
      }

      if (!graphbinStatusHasLog) {
        try {
          const logText = readTextFromPyodide(pyodide, "/out/graphbin.log");
          if (logText && logText.trim().length > 0) {
            setGraphbinStatus(logText);
          } else {
            setGraphbinStatus("GraphBin finished. Log file was empty.");
          }
        } catch (e) {
          setGraphbinStatus("GraphBin finished. Log file not available.");
        }
      }
    }

    const args = {
      initial: initialPath,
      final: finalPath,
      graph: graphPath,
      paths: pathsPath,
      contigs: contigsPath,
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

    log("Running GraphBin visualise in Pyodide... This step can take a while for large files. Please be patient!");

    const visualizeStart = nowMs();
    if (requiresPaths) {
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
    } else {
      await pyodide.runPythonAsync(`
import json
from types import SimpleNamespace
import megahit_plot
import interactive_export_megahit

args_dict = json.loads(${JSON.stringify(JSON.stringify(args))})
args_ns = SimpleNamespace(**args_dict)

megahit_plot.run(args_ns)
interactive_export_megahit.export(args_ns, "/out/interactive_graph.json")
  `);
    }
    benchmark.phase_ms.visualize = roundMs(nowMs() - visualizeStart);
    benchmark.phase_ms.layout = readLayoutTimingFromPyodide(pyodide);

    log("Python finished, reading plots from /out...");

    const ext = (setImgtype || "png").toLowerCase();
    const images = pyodide.FS.readdir("/out").filter((f) => f.endsWith("." + ext));
    log("Output files: " + images.join(", "));

    const initialFile = images.find((f) => f.includes("initial_binning_result"));
    const finalFile = images.find((f) => f.includes("final_GraphBin_binning_result"));

    lastInitialImgPath = null;
    lastFinalImgPath = null;

    if (initialFile) {
      const fullPath = "/out/" + initialFile;
      setPlotMedia(pyodide, "initial", fullPath);
      if (initialBlock) initialBlock.style.display = "flex";
      lastInitialImgPath = fullPath;
    } else {
      log("Initial plot not found in /out.");
    }

    if (finalFile) {
      const fullPath = "/out/" + finalFile;
      setPlotMedia(pyodide, "final", fullPath);
      if (finalBlock) finalBlock.style.display = "flex";
      lastFinalImgPath = fullPath;
    } else {
      log("Final plot not found in /out.");
    }

    let interactiveError = null;
    try {
      const interactivePrepareStart = nowMs();
      graphModel = readJsonFromPyodide(pyodide, "/out/interactive_graph.json");
      prepareInteractiveModel(graphModel);
      rebuildSpatialIndex();
      buildBinColorMap();
      renderBinLegend();
      initInteractiveUI();
      initSankeyUI();
      updateFlowStats();
      benchmark.phase_ms.interactive_prepare = roundMs(
        nowMs() - interactivePrepareStart
      );

      const interactiveRenderStart = nowMs();
      await waitForRenderFrame(() => {
        fitToView(graphModel, true);
        render();
        renderSankey();
      });
      benchmark.phase_ms.interactive_render_ready = roundMs(
        nowMs() - interactiveRenderStart
      );

      benchmark.counts.nodes = graphModel.nodes.length;
      benchmark.counts.edges = graphModel.edges.length;

      log(`Interactive graph loaded (nodes=${graphModel.nodes.length}, edges=${graphModel.edges.length}).`);
    } catch (e) {
      console.error(e);
      interactiveError = String(e);
      benchmark.error = interactiveError;
      log("Interactive graph JSON not found or failed to load: " + e);
    }

    const benchmarkStatus = interactiveError ? "partial" : "success";
    const result = finishBenchmarkRun(benchmark, {
      status: benchmarkStatus,
      error: benchmark.error,
    });
    log("Done!");
  } catch (err) {
    benchmark.error = String(err);
    const result = finishBenchmarkRun(benchmark, {
      status: "failed",
      error: benchmark.error,
    });
    throw err;
  }
}

/* =========================
   Main: Run example inputs
   ========================= */
async function runExamplePlot() {
  outputEl.textContent = "";
  resetGraphbinStatus("(GraphBin logs will appear here)");
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
  const setMaxIterRaw = parseInt(document.getElementById("setting-max-iter").value, 10);
  const setMinBinRaw = parseInt(
    document.getElementById("setting-min-bin-size").value,
    10
  );
  const setDiffRaw = parseFloat(
    document.getElementById("setting-diff-threshold").value
  );
  const showLpLogValue = document.getElementById("setting-show-lp-log").value;
  const setMaxIter =
    Number.isFinite(setMaxIterRaw) && setMaxIterRaw > 0
      ? setMaxIterRaw
      : GRAPHBIN_DEFAULTS.max_iteration;
  const setMinBinSize =
    Number.isFinite(setMinBinRaw) && setMinBinRaw > 0
      ? setMinBinRaw
      : GRAPHBIN_DEFAULTS.min_bin_size;
  const setDiffThreshold =
    Number.isFinite(setDiffRaw) && setDiffRaw >= 0
      ? setDiffRaw
      : GRAPHBIN_DEFAULTS.diff_threshold;
  const setShowLpLog = showLpLogValue === "true";

  const benchmark = startBenchmarkRun({
    source: "example",
    dataset: "example-data",
    assembler: "spades",
    delimiter: setDelimiter,
    fileSizes: {
      graph: null,
      contigs: null,
      paths: null,
      initial: null,
    },
  });

  try {
    const pyodideStart = nowMs();
    const pyodide = await getPyodide();
    benchmark.phase_ms.pyodide_init = roundMs(nowMs() - pyodideStart);

    log("Loading example data files into Pyodide FS...");

    const inputLoadStart = nowMs();
    const graphPath = await writeServerFile(
      pyodide,
      "data/assembly_graph_with_scaffolds.gfa",
      "/data/assembly_graph.gfa"
    );
    const contigsPath = await writeServerFile(
      pyodide,
      "data/contigs.fasta",
      "/data/contigs.fasta"
    );
    const pathsPath = await writeServerFile(pyodide, "data/contigs.paths", "/data/contigs.paths");
    const initialPath = await writeServerFile(
      pyodide,
      "data/initial_binning_res.csv",
      "/data/initial_binning.csv"
    );
    benchmark.phase_ms.input_load = roundMs(nowMs() - inputLoadStart);

    benchmark.file_sizes_bytes.graph = getPyodideFileSize(pyodide, graphPath);
    benchmark.file_sizes_bytes.contigs = getPyodideFileSize(pyodide, contigsPath);
    benchmark.file_sizes_bytes.paths = getPyodideFileSize(pyodide, pathsPath);
    benchmark.file_sizes_bytes.initial = getPyodideFileSize(pyodide, initialPath);

    const finalPath = "/out/graphbin_output.csv";

    const graphbinArgs = {
      graph: graphPath,
      contigs: contigsPath,
      paths: pathsPath,
      binned: initialPath,
      output: "/out/",
      prefix: "",
      delimiter: setDelimiter,
      max_iteration: setMaxIter,
      min_bin_size: setMinBinSize,
      diff_threshold: setDiffThreshold,
      show_lp_log: setShowLpLog,
    };

    log("Running GraphBin on example data in Pyodide...");
    resetGraphbinStatus("Running GraphBin...");

    const graphbinStart = nowMs();
    try {
      await pyodide.runPythonAsync(`
import json
from types import SimpleNamespace
import graphbin_SPAdes

args_dict = json.loads(${JSON.stringify(JSON.stringify(graphbinArgs))})
args_ns = SimpleNamespace(**args_dict)

graphbin_SPAdes.run(args_ns)
  `);
      benchmark.phase_ms.graphbin = roundMs(nowMs() - graphbinStart);
    } catch (err) {
      benchmark.phase_ms.graphbin = roundMs(nowMs() - graphbinStart);
      let status = "GraphBin failed. ";
      try {
        const logText = readTextFromPyodide(pyodide, "/out/graphbin.log");
        status += logText ? "\n" + logText : String(err);
      } catch (e) {
        status += String(err);
      }
      setGraphbinStatus(status.trim());
      throw mapGraphbinError(status, err);
    }

    if (!graphbinStatusHasLog) {
      try {
        const logText = readTextFromPyodide(pyodide, "/out/graphbin.log");
        if (logText && logText.trim().length > 0) {
          setGraphbinStatus(logText);
        } else {
          setGraphbinStatus("GraphBin finished. Log file was empty.");
        }
      } catch (e) {
        setGraphbinStatus("GraphBin finished. Log file not available.");
      }
    }

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

    const visualizeStart = nowMs();
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
    benchmark.phase_ms.visualize = roundMs(nowMs() - visualizeStart);
    benchmark.phase_ms.layout = readLayoutTimingFromPyodide(pyodide);

    log("Python finished, reading example plots from /out...");

    const ext = (setImgtype || "png").toLowerCase();
    const images = pyodide.FS.readdir("/out").filter((f) => f.endsWith("." + ext));
    log("Output files: " + images.join(", "));

    const initialFile = images.find((f) => f.includes("initial_binning_result"));
    const finalFile = images.find((f) => f.includes("final_GraphBin_binning_result"));

    lastInitialImgPath = null;
    lastFinalImgPath = null;

    if (initialFile) {
      const fullPath = "/out/" + initialFile;
      setPlotMedia(pyodide, "initial", fullPath);
      if (initialBlock) initialBlock.style.display = "flex";
      lastInitialImgPath = fullPath;
    } else {
      log("Initial plot not found in /out.");
    }

    if (finalFile) {
      const fullPath = "/out/" + finalFile;
      setPlotMedia(pyodide, "final", fullPath);
      if (finalBlock) finalBlock.style.display = "flex";
      lastFinalImgPath = fullPath;
    } else {
      log("Final plot not found in /out.");
    }

    let interactiveError = null;
    try {
      const interactivePrepareStart = nowMs();
      graphModel = readJsonFromPyodide(pyodide, "/out/interactive_graph.json");
      prepareInteractiveModel(graphModel);
      rebuildSpatialIndex();
      buildBinColorMap();
      renderBinLegend();
      initInteractiveUI();
      initSankeyUI();
      updateFlowStats();
      benchmark.phase_ms.interactive_prepare = roundMs(nowMs() - interactivePrepareStart);

      const interactiveRenderStart = nowMs();
      await waitForRenderFrame(() => {
        fitToView(graphModel, true);
        render();
        renderSankey();
      });
      benchmark.phase_ms.interactive_render_ready = roundMs(
        nowMs() - interactiveRenderStart
      );

      benchmark.counts.nodes = graphModel.nodes.length;
      benchmark.counts.edges = graphModel.edges.length;

      log(`Interactive graph loaded (nodes=${graphModel.nodes.length}, edges=${graphModel.edges.length}).`);
    } catch (e) {
      console.error(e);
      interactiveError = String(e);
      benchmark.error = interactiveError;
      log("Interactive graph JSON not found or failed to load: " + e);
    }

    const benchmarkStatus = interactiveError ? "partial" : "success";
    const result = finishBenchmarkRun(benchmark, {
      status: benchmarkStatus,
      error: benchmark.error,
    });
    log("Done (example data)!");
  } catch (err) {
    benchmark.error = String(err);
    const result = finishBenchmarkRun(benchmark, {
      status: "failed",
      error: benchmark.error,
    });
    throw err;
  }
}

/* =========================
   Buttons
   ========================= */
document.getElementById("run-btn").addEventListener("click", () => {
  resetGraphbinStatus("(GraphBin logs will appear here)");
  resetInteractiveViews();
  runInputPlot().catch((err) => {
    console.error(err);
    log("Error: " + err);
  });
});

document.getElementById("example-btn").addEventListener("click", () => {
  resetGraphbinStatus("(GraphBin logs will appear here)");
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

document.getElementById("download-graphbin").addEventListener("click", () => {
  downloadGraphbinOutputZip().catch((err) => {
    console.error(err);
    log("Download error: " + err);
  });
});

initCollapseToggles();

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

  const ext = getFileExtension(path) || "png";
  const data = pyodide.FS.readFile(path);
  const blob = new Blob([data], { type: mimeForExtension(ext) });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = which + "_plot." + ext;
  a.style.display = "none";
  document.body.appendChild(a);

  a.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 2000);
}

async function downloadGraphbinOutputZip() {
  const pyodide = await getPyodide();
  const zipPath = "/out/graphbin_output.zip";
  lastGraphbinZipPath = zipPath;

  try {
    const files = pyodide.FS.readdir("/out").filter((f) => ![".", ".."].includes(f));
    if (files.length === 0) {
      alert("GraphBin output not available. Run GraphBin first.");
      return;
    }
  } catch (e) {
    alert("GraphBin output not available. Run GraphBin first.");
    return;
  }

  await pyodide.runPythonAsync(`
import os, zipfile
out_dir = "/out"
zip_path = "${zipPath}"
if os.path.exists(zip_path):
    os.remove(zip_path)
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(out_dir):
        for name in files:
            full = os.path.join(root, name)
            if full == zip_path:
                continue
            arc = os.path.relpath(full, out_dir)
            z.write(full, arcname=arc)
  `);

  const data = pyodide.FS.readFile(zipPath);
  const blob = new Blob([data], { type: "application/zip" });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "graphbin_output.zip";
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
  el.appendChild(makeLegendRow("Likely misbinned", "#ef4444", "misbinned"));
  el.appendChild(makeLegendRow("Ambiguous", "#111827", "ambiguous"));

  // bins in sorted order for consistency
  const entries = [...binColorMap.entries()].sort((a, b) =>
    String(a[0]).localeCompare(String(b[0]))
  );

  for (const [bin, color] of entries) {
    el.appendChild(makeLegendRow(bin, color));
  }
}

function makeLegendRow(label, color, variant = "solid") {
  const row = document.createElement("div");
  row.className = "bin-legend-item";

  const sw = document.createElement("div");
  sw.className = "bin-legend-swatch";
  if (variant === "misbinned") {
    sw.classList.add("legend-misbinned");
    sw.style.borderColor = color;
  } else if (variant === "ambiguous") {
    sw.classList.add("legend-ambiguous");
    sw.style.borderColor = color;
  } else {
    sw.style.background = color;
  }

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
  const c = document.getElementById("graph-canvas");
  if (!c || !window.d3) return; // interactive panel not present

  if (!canvas) {
    canvas = c;
    ctx = canvas.getContext("2d");

    zoomBehavior = d3
      .zoom()
      .scaleExtent([0.05, 200])
      .on("zoom", (event) => {
        currentTransform = event.transform;
        render();
      });

    d3.select(canvas).call(zoomBehavior);

    canvas.addEventListener("mousemove", (e) => {
      const x = e.offsetX;
      const y = e.offsetY;

      hoverNodeId = pickNode(x, y);
      const tooltip = document.getElementById("hover-tooltip");
      if (tooltip) {
        if (hoverNodeId) {
          const n = getNode(hoverNodeId);
          showTooltip(tooltip, canvas, e, n);
        } else {
          hideTooltip(tooltip);
        }
      }
      render();
    });

    canvas.addEventListener("mouseleave", () => {
      hoverNodeId = null;
      hideTooltip(document.getElementById("hover-tooltip"));
      render();
    });

    canvas.addEventListener("click", (e) => {
      const nodeId = pickNode(e.offsetX, e.offsetY);
      lockedNodeId = lockedNodeId === nodeId ? null : nodeId;
      render();
    });

    if (!canvas.dataset._resizeBound) {
      window.addEventListener("resize", () => {
        if (!graphModel) return;
        render();
      });
      canvas.dataset._resizeBound = "1";
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

  attachControl("node-size", "input", (e) => {
    setBaseNodeRadius(e.target.value);
    render();
  });

  attachControl("toggle-hide-isolated", "change", (e) => {
    filters.hideIsolated = e.target.checked;
    invalidateDerived();
    render();
  });

  attachControl("toggle-show-ambiguous", "change", (e) => {
    filters.showAmbiguousOutline = e.target.checked;
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
    fitToView(graphModel, true);
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

function setFlowStat(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function isUnbinned(bin) {
  return bin == null || bin === "" || bin === "unbinned";
}

function updateFlowStats() {
  if (!graphModel) return;
  let reassigned = 0;
  let unbinnedToBinned = 0;
  let binnedToUnbinned = 0;
  let changed = 0;

  for (const n of graphModel.nodes) {
    const initBin = n.initial_bin;
    const finalBin = n.final_bin;
    const initUnbinned = isUnbinned(initBin);
    const finalUnbinned = isUnbinned(finalBin);

    if (initBin !== finalBin) {
      changed += 1;
    }
    if (!initUnbinned && !finalUnbinned && initBin !== finalBin) {
      reassigned += 1;
    }
    if (initUnbinned && !finalUnbinned) {
      unbinnedToBinned += 1;
    }
    if (!initUnbinned && finalUnbinned) {
      binnedToUnbinned += 1;
    }
  }

  setFlowStat("flow-stat-changed", String(changed));
  setFlowStat("flow-stat-reassigned", String(reassigned));
  setFlowStat("flow-stat-unbinned-to-binned", String(unbinnedToBinned));
  setFlowStat("flow-stat-binned-to-unbinned", String(binnedToUnbinned));
}

function attachControl(id, event, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.dataset._bound === "1") return;
  el.addEventListener(event, handler);
  el.dataset._bound = "1";
}

function initCollapseToggles() {
  if (window.__collapseTogglesInitialized) return;
  window.__collapseTogglesInitialized = true;
  const storageKey = "graphbin-collapse-state";
  const loadState = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  };
  const saveState = (state) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (e) {}
  };

  const applyInitialState = () => {
    const state = loadState();
    const buttons = document.querySelectorAll(".collapse-toggle");
    buttons.forEach((btn) => {
      const section = btn.closest(".tab-section");
      if (!section) return;
      const target = btn.dataset.target || "";
      const collapsed = target === "section-output" ? false : !!state[target];
      section.classList.toggle("collapsed", collapsed);
      btn.textContent = collapsed ? "Expand" : "Collapse";
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  };

  applyInitialState();

  document.addEventListener("click", (event) => {
    const btn = event.target?.closest?.(".collapse-toggle");
    if (!btn) return;
    const section = btn.closest(".tab-section");
    if (!section) return;
    const collapsed = section.classList.toggle("collapsed");
    btn.textContent = collapsed ? "Expand" : "Collapse";
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");

    const target = btn.dataset.target || "";
    const state = loadState();
    state[target] = collapsed;
    saveState(state);
  });
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

function setBaseNodeRadius(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  baseNodeRadius = v;
  const label = document.getElementById("node-size-value");
  if (label) {
    const text = v % 1 === 0 ? String(v) : v.toFixed(1);
    label.textContent = text;
  }
}

/* =========================
   Interactive: math / view
   ========================= */
function getCanvasSize() {
  if (!canvas) return { width: 900, height: 700 };
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width || 900);
  const height = Math.max(1, rect.height || 700);
  return { width, height };
}

function fitToView(model, animate = false) {
  if (!canvas || !model || !zoomBehavior || !window.d3) return;

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
  const { width, height } = getCanvasSize();

  const sx = (width - padding * 2) / w;
  const sy = (height - padding * 2) / h;
  const s = Math.min(sx, sy);

  const tx = padding - minX * s;
  const ty = padding - minY * s;

  const t = d3.zoomIdentity.translate(tx, ty).scale(s);
  if (animate) {
    d3.select(canvas)
      .transition()
      .duration(450)
      .call(zoomBehavior.transform, t);
  } else {
    d3.select(canvas).call(zoomBehavior.transform, t);
  }
  currentTransform = t;
}

function worldToScreen(x, y) {
  const t = currentTransform || { x: 0, y: 0, k: 1 };
  return { x: x * t.k + t.x, y: y * t.k + t.y };
}

function screenToWorld(x, y) {
  const t = currentTransform || { x: 0, y: 0, k: 1 };
  return { x: (x - t.x) / t.k, y: (y - t.y) / t.k };
}

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
  const t = currentTransform || { k: 1 };
  const rWorld = rScreen / t.k;

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

  if (filters.hideIsolated) {
    const deg = (graphModel.adj.get(n.id) || []).length;
    if (deg === 0) return false;
  }


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
    <div>length: ${Number(n.len ?? 0).toLocaleString()}bp</div>
    <div>GC%: ${n.gc == null ? "n/a" : Number(n.gc).toFixed(2)}</div>
    <div>coverage: ${n.cov == null ? "n/a" : Number(n.cov).toFixed(2)}</div>
    <div>degree: ${deg}</div>
    <div>initial: ${escapeHtml(init)}</div>
    <div>final: ${escapeHtml(fin)}</div>
    <div>shown: ${escapeHtml(shown)}</div>
    ${n.misbinned ? "<div>misbinned: yes</div>" : ""}
    ${n.ambiguous_multi ? "<div>ambiguous: yes</div>" : ""}
    <div>adj bins: ${escapeHtml(mix || "n/a")}</div>
  `;
}

function showTooltip(tooltip, anchorEl, event, n) {
  if (!tooltip || !anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
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

  const { width, height } = getCanvasSize();
  const t = currentTransform || { x: 0, y: 0, k: 1 };

  // Clear
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Apply DPR + zoom transform
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.transform(t.k, 0, 0, t.k, t.x, t.y);

  const visibleNodes = graphModel.nodes.filter((n) => isNodeVisible(n));
  const visibleIds = new Set(visibleNodes.map((n) => n.id));

  if (hoverNodeId && !visibleIds.has(hoverNodeId)) hoverNodeId = null;
  if (lockedNodeId && !visibleIds.has(lockedNodeId)) lockedNodeId = null;

  const activeNodeId = lockedNodeId || hoverNodeId || null;
  const activeAdj = activeNodeId
    ? new Set([activeNodeId, ...(graphModel.adj.get(activeNodeId) || [])])
    : null;

  // View bounds in world coords for culling
  const pad = 80;
  const minW = screenToWorld(-pad, -pad);
  const maxW = screenToWorld(width + pad, height + pad);

  const inBounds = (n) =>
    n.x >= minW.x && n.x <= maxW.x && n.y >= minW.y && n.y <= maxW.y;

  // edges
  ctx.lineWidth = 1 / t.k;
  ctx.strokeStyle = "#111827";

  for (const [u, v] of graphModel.edges) {
    const nu = getNode(u);
    const nv = getNode(v);
    if (!visibleIds.has(u) || !visibleIds.has(v)) continue;

    const minX = Math.min(nu.x, nv.x);
    const maxX = Math.max(nu.x, nv.x);
    const minY = Math.min(nu.y, nv.y);
    const maxY = Math.max(nu.y, nv.y);
    if (maxX < minW.x || minX > maxW.x || maxY < minW.y || minY > maxW.y) continue;

    if (!activeNodeId) ctx.globalAlpha = 0.25;
    else ctx.globalAlpha = (u === activeNodeId || v === activeNodeId) ? 0.85 : 0.05;

    ctx.beginPath();
    ctx.moveTo(nu.x, nu.y);
    ctx.lineTo(nv.x, nv.y);
    ctx.stroke();
  }

  // nodes
  ctx.globalAlpha = 1.0;
  for (const n of visibleNodes) {
    if (!inBounds(n)) continue;

    const isHover = n.id === hoverNodeId;
    const isLocked = n.id === lockedNodeId;

    let r = baseNodeRadius;
    if (isHover) r = baseNodeRadius + NODE_RADIUS_DELTA.hover;
    if (isLocked) r = baseNodeRadius + NODE_RADIUS_DELTA.locked;
    r = r / t.k;

    if (activeAdj && !activeAdj.has(n.id)) ctx.globalAlpha = 0.25;
    else ctx.globalAlpha = 1.0;

    const b = nodeBin(n, filters.mode);
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = colorForBin(b);
    ctx.fill();

    if (!b) {
      ctx.lineWidth = 1 / t.k;
      ctx.strokeStyle = "#9ca3af";
      ctx.stroke();
    }

    if (n.changed) {
      ctx.lineWidth = 2 / t.k;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.lineWidth = 3 / t.k;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
    }

    if (isLocked) {
      ctx.lineWidth = 3 / t.k;
      ctx.strokeStyle = "#2563eb";
      ctx.stroke();
    } else if (isHover) {
      ctx.lineWidth = 2 / t.k;
      ctx.strokeStyle = "#111827";
      ctx.stroke();
    }

    if (filters.mode === "initial" && n.misbinned) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + (2 / t.k), 0, Math.PI * 2);
      ctx.lineWidth = 3 / t.k;
      ctx.setLineDash([2 / t.k, 2 / t.k]);
      ctx.strokeStyle = "#ef4444";
      ctx.stroke();
      ctx.restore();
    }

    if (filters.mode === "initial" && n.ambiguous_multi && filters.showAmbiguousOutline) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + (5 / t.k), 0, Math.PI * 2);
      ctx.lineWidth = 2 / t.k;
      ctx.setLineDash([1 / t.k, 3 / t.k]);
      ctx.strokeStyle = "#111827";
      ctx.stroke();
      ctx.restore();
    }

  }
}

}
