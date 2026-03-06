<p align="center">
  <img src="https://raw.githubusercontent.com/metagentools/graphbin-viz/main/public/GraphBin-Viz_logo_light.png#gh-light-mode-only" width="400" title="GraphBin-Viz logo" alt="GraphBin-Viz logo">
  <img src="https://raw.githubusercontent.com/metagentools/graphbin-viz/main/public/GraphBin-Viz_logo_dark.png#gh-dark-mode-only" width="400" title="GraphBin-Viz logo" alt="GraphBin-Viz logo">
</p>

# GraphBin-Viz: Interactive Visual Analytics for Exploring Graph-based Metagenomic Binning

![GitHub License](https://img.shields.io/github/license/metagentools/graphbin-viz)
[![Unit Testing](https://github.com/metagentools/graphbin-viz/actions/workflows/vitest.yml/badge.svg)](https://github.com/metagentools/graphbin-viz/actions/workflows/vitest.yml)
[![E2E Testing](https://github.com/metagentools/graphbin-viz/actions/workflows/playwright.yml/badge.svg)](https://github.com/metagentools/graphbin-viz/actions/workflows/playwright.yml)

GraphBin-Viz is a **browser-based interactive visual analytics framework** for exploring and comparing **initial metagenomic binning results** and **[GraphBin](https://github.com/metagentools/GraphBin)-refined binning results** on assembly graphs. It runs [GraphBin](https://github.com/metagentools/GraphBin) locally on your device using your provided data, and no data ever leaves your device.


This project uses Pyodide (Python compiled to WebAssembly) to run GraphBin, visualisation, and plotting code entirely in the browser — no backend needed.

## Web App (Anyone can use)

🌐 Live demo:
[metagentools.github.io/graphbin-viz/](https://metagentools.github.io/graphbin-viz/)

No installation needed! Python **not required**. Node.js **not required**. You only need a modern browser such as Chrome, Firefox, Safari or Edge.

## Features

### GraphBin bin-refinement

* Run GraphBin on your device using WebAssembly
* No shell installations needed
* Upload your own data and run
* Supports SPAdes assemblies (GFA, contigs FASTA and contig paths) and MEGAHIT assemblies (converted GFA, contigs FASTA)
* Upload initial binning result and assembly files
* Adjust GraphBin settings

### Static Graph Plots

* Run GraphBin plotting fully in the browser using WebAssembly
* Adjustable plot settings:
  * DPI
  * Width / height
  * Vertex size
  * Label size
  * Image type
* Automatically renders:
  * Initial binning plot
  * GraphBin-refined binning plot
* Download generated plots

### Interactive Assembly Graph Visualisation

* Interactive assembly graph with binning results
* Hover tooltips per contig showing:
  * Contig ID
  * Length
  * GC content
  * Coverage
  * Degree
  * Bin assignments
  * Likely misbinned or ambigous
* Zoom, pan, and explore complex graphs visually
* Toggle visibility of bins and contigs
* Designed for exploratory analysis and quality assessment

### Binning Comparison Sankey Diagram

* Sankey diagram showing how contigs move between:
  * Initial binning results
  * GraphBin-refined binning results
* Each flow represents the number of contigs transferred between bins
* Unbinned contigs are shown explicitly (light grey) to highlight recovery or loss
* Supports interactive exploration:
  * Hover to inspect contig flow between specific bins
  * Click to lock/highlight a bin-to-bin transition
* Filters to:
  * Show only contigs that changed bin
  * Hide unbinned contigs
* Automatically updates when new binning results are plotted

This view provides a high-level summary of bin refinement behavior, complementing the detailed interactive assembly graph.


### General

* Built-in test data for instant demonstration
* Client-side file handling - your data never leaves your computer
* Pure static site — works on GitHub Pages


## Technologies Used

* Pyodide (Python → WebAssembly)
* igraph (GraphBin + graph processing + plotting)
* matplotlib (Pyodide backend) for static image generation
* React (UI framework)
* Vite (build tooling)
* D3.js (interactive visualization + Sankey)
* HTML5/CSS3 user interface
* Vitest (unit testing)
* Playwright (E2E testing)

## Running the App Locally (Advanced)

Clone the repository:

```shell
git clone https://github.com/metagentools/graphbin-viz.git
cd graphbin-viz
```

Because the browser cannot fetch local files with `file:///`, you must serve it with a local server. You will need Node.js for this step. Check here for instructions to setup [Node.js](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm). Then run the following commands.

```shell
npm install
npm run build
npm run preview 
```

Then copy and paste the link shown as "Local:" in your web browser. It will look something like this.
```shell
http://localhost:4173/graphbin-viz/
```

## Benchmarking Different Datasets

This repo includes a Playwright benchmark pipeline that records timing metrics per dataset run to CSV.

### Configure datasets and run counts

Edit `tests/bench/datasets.manifest.json` file and add your datasets.

```json
{
  "runs": { "cold": 1, "warm": 3 },
  "datasets": [
    { "name": "bundled-example", "mode": "example", "assembler": "spades" },
    {
      "name": "my-upload-dataset",
      "mode": "upload",
      "assembler": "spades",
      "graph": "/absolute/or/relative/path/to/assembly_graph.gfa",
      "contigs": "/absolute/or/relative/path/to/contigs.fasta",
      "paths": "/absolute/or/relative/path/to/contigs.paths",
      "initial": "/absolute/or/relative/path/to/initial_binning.csv",
      "delimiter": ","
    }
  ]
}
```

`cold` runs start from a fresh page load; `warm` runs repeat without reloading.
Set `assembler` to `spades` or `megahit`. For `megahit`, `paths` is not required.

### Run benchmark

```shell
npm run test:e2e:bench
```

### Output

Results are appended to: `tests/bench/results/benchmark-results.csv`

Each row includes:
* dataset metadata
* assembler
* phase timings (`pyodide_init`, `input_load`, `graphbin`, `visualize`, `layout`, `interactive_prepare`, `interactive_render_ready`)
* total time
* graph size / contig count metadata
* browser, host, commit hash, and errors (if any)

Optional environment overrides:

* `BENCHMARK_MANIFEST` (default: `tests/bench/datasets.manifest.json`)
* `BENCHMARK_OUTPUT` (default: `tests/bench/results/benchmark-results.csv`)
* `BENCHMARK_WAIT_TIMEOUT_MS` (default: `900000`)

### Plot benchmark CSV

Use the included plotting script to visualize timing against `nodes`, `graph_size_bytes`, and `contigs_size_bytes`:

```shell
python3 tests/bench/plot_benchmark_results.py \
  --input tests/bench/results/benchmark-results.csv \
  --output-dir tests/bench/results/plots
```

Generated files:
* `tests/bench/results/plots/run_level_total_vs_features.png`
* `tests/bench/results/plots/phase_timings_vs_features.png`
* `tests/bench/results/plots/dataset_medians.csv`

## Acknowledgement

The development of this app was motivated by concepts described in the Wasm ABABCS2025 Workshop (doi: https://doi.org/10.5281/zenodo.17743837).

## Citation

If you use this in your work, please cite GraphBin and GraphBin-Tk (full citations below).

> Vijini Mallawaarachchi, Anuradha Wickramarachchi, Yu Lin. GraphBin: Refined binning of metagenomic contigs using assembly graphs. Bioinformatics, Volume 36, Issue 11, June 2020, Pages 3307–3313, DOI: https://doi.org/10.1093/bioinformatics/btaa180

> Mallawaarachchi et al., (2025). GraphBin-Tk: assembly graph-based metagenomic binning toolkit. Journal of Open Source Software, 10(109), 7713, https://doi.org/10.21105/joss.07713

## Funding

This work is funded by an [Essential Open Source Software for Science 
Grant](https://chanzuckerberg.com/eoss/proposals/cogent3-python-apis-for-iq-tree-and-graphbin-via-a-plug-in-architecture/) 
from the Chan Zuckerberg Initiative.

<p align="left">
  <img src="https://chanzuckerberg.com/wp-content/themes/czi/img/logo.svg" width="300">
</p>
