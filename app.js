const outputEl = document.getElementById("output");

// Initial placeholder when page loads
outputEl.textContent = "(logs will appear here)\n\n";

function log(msg) {
  outputEl.textContent += msg + "\n";
}

// store Pyodide init promise here, but don't start it yet
let pyodideReady = null;

async function getPyodide() {
  // if already starting/ready, reuse
  if (pyodideReady) {
    return pyodideReady;
  }

  // first time: start loading and log progress
  pyodideReady = (async () => {
    log("Loading Pyodide...");
    const pyodide = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.0/full/",
    });

    log("Loading igraph + matplotlib...");
    await pyodide.loadPackage(["igraph", "matplotlib"]);

    // Directories in the Pyodide FS
    try { pyodide.FS.mkdir("/py"); }   catch (e) {}
    try { pyodide.FS.mkdir("/data"); } catch (e) {}
    try { pyodide.FS.mkdir("/out"); }  catch (e) {}

    // Fetch the Python files and write them into Pyodide’s filesystem
    const files = ["spades_plot.py", "bidictmap.py"]; // adjust names if needed
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

// Helper: read file as ArrayBuffer (so we can write binary files)
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
}

// Helper: write uploaded file into Pyodide FS
async function writeUploadedFile(pyodide, inputFile, destPath) {
  const buf = await readFileAsArrayBuffer(inputFile);
  const data = new Uint8Array(buf);
  pyodide.FS.writeFile(destPath, data);
  return destPath;
}

// Helper: fetch an existing file from the server (e.g. data/ folder)
// and write it into Pyodide FS at destPath
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

async function runInputPlot() {
  // clear old logs and hide old plots
  outputEl.textContent = "";
  const initialBlock = document.getElementById("initial-block");
  const finalBlock = document.getElementById("final-block");
  if (initialBlock) initialBlock.style.display = "none";
  if (finalBlock) finalBlock.style.display = "none";

  const graph    = document.getElementById("graph").files[0];
  const contigs  = document.getElementById("contigs").files[0];
  const paths    = document.getElementById("paths").files[0];
  const initial  = document.getElementById("initial").files[0];
  const graphbin = document.getElementById("graphbin").files[0];
  const setDpi      = parseInt(document.getElementById("setting-dpi").value);
  const setWidth    = parseInt(document.getElementById("setting-width").value);
  const setHeight   = parseInt(document.getElementById("setting-height").value);
  const setVsize    = parseInt(document.getElementById("setting-vsize").value);
  const setLsize    = parseInt(document.getElementById("setting-lsize").value);
  const setImgtype  = document.getElementById("setting-imgtype").value;
  const setDelimiter= document.getElementById("setting-delimiter").value;

  if (!graph || !contigs || !paths || !initial || !graphbin) {
    log("Please pick all input files (graph, contigs, paths, initial, graphbin).");
    return;
  }

  // 👉 Pyodide + packages + Python files only start loading now
  const pyodide = await getPyodide();

  log("Writing input files into Pyodide FS...");

  // Write files into /data with fixed filenames
  const graphPath    = await writeUploadedFile(pyodide, graph,    "/data/assembly_graph.gfa");
  const contigsPath  = await writeUploadedFile(pyodide, contigs,  "/data/contigs.fasta");
  const pathsPath    = await writeUploadedFile(pyodide, paths,    "/data/contigs.paths");
  const initialPath  = await writeUploadedFile(pyodide, initial,  "/data/initial_binning.tsv");
  const finalPath    = await writeUploadedFile(pyodide, graphbin, "/data/final_binning.tsv");

  // Build args dict for the Python script (these are *paths* now)
  const args = {
    initial: initialPath,
    final: finalPath,
    graph: graphPath,
    paths: pathsPath,
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

  // Run spades_plot.run(args)
  await pyodide.runPythonAsync(`
import json
from types import SimpleNamespace
import spades_plot

args_dict = json.loads(${JSON.stringify(JSON.stringify(args))})
args_ns = SimpleNamespace(**args_dict)

spades_plot.run(args_ns)
  `);

  log("Python finished, reading plots from /out...");

  // List files in /out
  const files = pyodide.FS.readdir("/out").filter((f) => f.endsWith(".png"));
  log("Output files: " + files.join(", "));

  const initialFile = files.find((f) => f.includes("initial_binning_result"));
  const finalFile   = files.find((f) => f.includes("final_GraphBin_binning_result"));

  function fileToImgSrc(path) {
    const data = pyodide.FS.readFile(path); // Uint8Array
    const blob = new Blob([data], { type: "image/png" });
    return URL.createObjectURL(blob);
  }

  // if you’re tracking paths for download, keep your variables here:
  lastInitialImgPath = null;
  lastFinalImgPath = null;

  if (initialFile) {
    const fullPath = "/out/" + initialFile;
    const src = fileToImgSrc(fullPath);
    document.getElementById("initial-img").src = src;
    if (initialBlock) initialBlock.style.display = "flex";
    lastInitialImgPath = fullPath;
  } else {
    log("Initial plot not found in /out.");
  }

  if (finalFile) {
    const fullPath = "/out/" + finalFile;
    const src = fileToImgSrc(fullPath);
    document.getElementById("final-img").src = src;
    if (finalBlock) finalBlock.style.display = "flex";
    lastFinalImgPath = fullPath;
  } else {
    log("Final plot not found in /out.");
  }

  log("Done!");
}

async function runExamplePlot() {
  // clear old logs and hide old plots
  outputEl.textContent = "";
  const initialBlock = document.getElementById("initial-block");
  const finalBlock = document.getElementById("final-block");
  if (initialBlock) initialBlock.style.display = "none";
  if (finalBlock) finalBlock.style.display = "none";

  // Read settings (same as runInputPlot)
  const setDpi       = parseInt(document.getElementById("setting-dpi").value);
  const setWidth     = parseInt(document.getElementById("setting-width").value);
  const setHeight    = parseInt(document.getElementById("setting-height").value);
  const setVsize     = parseInt(document.getElementById("setting-vsize").value);
  const setLsize     = parseInt(document.getElementById("setting-lsize").value);
  const setImgtype   = document.getElementById("setting-imgtype").value;
  const setDelimiter = document.getElementById("setting-delimiter").value;

  const pyodide = await getPyodide();

  log("Loading example data files into Pyodide FS...");

  // ⚠️ Adjust these URLs to match your real test data filenames
  const graphPath   = await writeServerFile(pyodide, "data/assembly_graph_with_scaffolds.gfa", "/data/assembly_graph.gfa");
  const contigsPath = await writeServerFile(pyodide, "data/contigs.fasta",       "/data/contigs.fasta");
  const pathsPath   = await writeServerFile(pyodide, "data/contigs.paths",       "/data/contigs.paths");
  const initialPath = await writeServerFile(pyodide, "data/initial_binning_res.csv", "/data/initial_binning.csv");
  const finalPath   = await writeServerFile(pyodide, "data/graphbin_res.csv","/data/final_binning.csv");

  // Build args dict for the Python script (paths into Pyodide FS)
  const args = {
    initial: initialPath,
    final: finalPath,
    graph: graphPath,
    paths: pathsPath,
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

args_dict = json.loads(${JSON.stringify(JSON.stringify(args))})
args_ns = SimpleNamespace(**args_dict)

spades_plot.run(args_ns)
  `);

  log("Python finished, reading example plots from /out...");

  // List files in /out
  const files = pyodide.FS.readdir("/out").filter((f) => f.endsWith(".png"));
  log("Output files: " + files.join(", "));

  const initialFile = files.find((f) => f.includes("initial_binning_result"));
  const finalFile   = files.find((f) => f.includes("final_GraphBin_binning_result"));

  function fileToImgSrc(path) {
    const data = pyodide.FS.readFile(path); // Uint8Array
    const blob = new Blob([data], { type: "image/png" });
    return URL.createObjectURL(blob);
  }

  // if you’re tracking paths for download, keep your variables here:
  lastInitialImgPath = null;
  lastFinalImgPath = null;

  if (initialFile) {
    const fullPath = "/out/" + initialFile;
    const src = fileToImgSrc(fullPath);
    document.getElementById("initial-img").src = src;
    if (initialBlock) initialBlock.style.display = "flex";
    lastInitialImgPath = fullPath;
  } else {
    log("Initial plot not found in /out.");
  }

  if (finalFile) {
    const fullPath = "/out/" + finalFile;
    const src = fileToImgSrc(fullPath);
    document.getElementById("final-img").src = src;
    if (finalBlock) finalBlock.style.display = "flex";
    lastFinalImgPath = fullPath;
  } else {
    log("Final plot not found in /out.");
  }

  log("Done (example data)!");
}


document.getElementById("run-btn").addEventListener("click", () => {
  runInputPlot().catch((err) => {
    console.error(err);
    log("Error: " + err);
  });
});

document.getElementById("example-btn").addEventListener("click", () => {
  runExamplePlot().catch((err) => {
    console.error(err);
    log("Error (example): " + err);
  });
});


document.getElementById("download-initial").addEventListener("click", () => {
  downloadImage("initial").catch(err => {
    console.error(err);
    log("Download error: " + err);
  });
});

document.getElementById("download-final").addEventListener("click", () => {
  downloadImage("final").catch(err => {
    console.error(err);
    log("Download error: " + err);
  });
});

async function downloadImage(which) {
  const pyodide = await getPyodide();  // or pyodideReady

  let path = null;
  if (which === "initial") path = lastInitialImgPath;
  if (which === "final")   path = lastFinalImgPath;

  if (!path) {
    alert("No image available. Run the plot first.");
    return;
  }

  // Read file from Pyodide
  const data = pyodide.FS.readFile(path);
  const blob = new Blob([data], { type: "image/png" });

  // Create a temporary download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = which + "_plot.png";
  a.style.display = "none";
  document.body.appendChild(a);

  a.click();  // trigger download

  // Safari needs it to stay in DOM for a moment
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 2000);
}
