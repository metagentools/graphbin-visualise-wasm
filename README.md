# GraphBin `visualise` WebAssembly App

A **browser-based interactive visualisation tool** for comparing **initial metagenomic binning results** and **[GraphBin](https://github.com/metagentools/GraphBin)-refined binning results** on assembly graphs.

This project uses Pyodide (Python compiled to WebAssembly) to run `igraph`, GraphBin’s graph visualisation code, and the plotting code entirely in the browser — no backend needed.

## Web App (Anyone can use)

Please go to [metagentools.github.io/graphbin-visualise-wasm-app/](https://metagentools.github.io/graphbin-visualise-wasm-app/) for a live demo hosted on GitHub Pages. 

No installation needed! Python **not required**. Node.js **not required**. You only need a modern browser such as Chrome, Firefox, Safari or Edge.

## Features

* Run GraphBin plotting fully in the browser using WebAssembly
* Supports SPAdes assembler layout (GFA, contigs FASTA, contig paths). Support for MEGAHIT and Flye is coming soon.
* Upload your initial binning + GraphBin binning results
* Adjustable plot settings:
* Automatically renders two plots: 1) initial binning plot and 2) GraphBin-refined binning plot
* Client-side file handling — your data never leaves your computer
* Download generated plots
* Built-in test data for immediate demonstration
* Pure static site — works on GitHub Pages.

## Technologies Used

* Pyodide (Python → WebAssembly)
* igraph (graph processing + plotting)
* matplotlib (Pyodide backend) for image generation
* JavaScript for UI + FS bridging
* HTML/CSS user interface
* [GraphBin plotting logic](https://github.com/metagentools/GraphBin/tree/develop/src/graphbin/support)

## Running the App Locally (Advanced)

Clone the repository:

```shell
git clone https://github.com/metagentools/graphbin-visualise-wasm-app.git
cd graphbin-visualise-wasm-app
```

Because the browser cannot fetch local files with `file:///`, you must serve it with a lightweight local server. You will need Python for this step.

```shell
python -m http.server 8000
```

Then copy and paste the following link in your web browser.
```shell
http://localhost:8000
```

## Citation

If you use this in your work, please cite GraphBin, GraphBin-Tk (full citation below) and and the Wasm ABABCS2025 Workshop (doi: https://doi.org/10.5281/zenodo.17743837).

> Vijini Mallawaarachchi, Anuradha Wickramarachchi, Yu Lin. GraphBin: Refined binning of metagenomic contigs using assembly graphs. Bioinformatics, Volume 36, Issue 11, June 2020, Pages 3307–3313, DOI: https://doi.org/10.1093/bioinformatics/btaa180

> Mallawaarachchi et al., (2025). GraphBin-Tk: assembly graph-based metagenomic binning toolkit. Journal of Open Source Software, 10(109), 7713, https://doi.org/10.21105/joss.07713