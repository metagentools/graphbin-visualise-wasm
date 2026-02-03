# GraphBin `visualise` WASM

A **browser-based interactive visualisation tool** for comparing **initial metagenomic binning results** and **[GraphBin](https://github.com/metagentools/GraphBin)-refined binning results** on assembly graphs, including both static plots and a fully interactive graph view.

This project uses Pyodide (Python compiled to WebAssembly) to run `igraph`, GraphBin’s graph visualisation code, and the plotting code entirely in the browser — no backend needed.

## Web App (Anyone can use)

🌐 Live demo:
[metagentools.github.io/graphbin-visualise-wasm/](https://metagentools.github.io/graphbin-visualise-wasm/)

No installation needed! Python **not required**. Node.js **not required**. You only need a modern browser such as Chrome, Firefox, Safari or Edge.

## Features

### Static Graph Plots

* Run GraphBin plotting fully in the browser using WebAssembly
* Supports SPAdes assembler layout (GFA, contigs FASTA, contig paths)
* Upload initial binning and GraphBin-refined binning results
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
* Zoom, pan, and explore complex graphs visually
* Toggle visibility of bins and contigs
* Designed for exploratory analysis and quality assessment

### General

* Built-in test data for instant demonstration
* Client-side file handling - your data never leaves your computer
* Pure static site — works on GitHub Pages


## Technologies Used

* Pyodide (Python → WebAssembly)
* igraph (graph processing + plotting)
* matplotlib (Pyodide backend) for static image generation
* JavaScript (ES6) application logic
* HTML5/CSS3 user interface
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

If you use this in your work, please cite GraphBin, GraphBin-Tk (full citations below) and the Wasm ABABCS2025 Workshop (doi: https://doi.org/10.5281/zenodo.17743837).

> Vijini Mallawaarachchi, Anuradha Wickramarachchi, Yu Lin. GraphBin: Refined binning of metagenomic contigs using assembly graphs. Bioinformatics, Volume 36, Issue 11, June 2020, Pages 3307–3313, DOI: https://doi.org/10.1093/bioinformatics/btaa180

> Mallawaarachchi et al., (2025). GraphBin-Tk: assembly graph-based metagenomic binning toolkit. Journal of Open Source Software, 10(109), 7713, https://doi.org/10.21105/joss.07713

## Funding

This work is funded by an [Essential Open Source Software for Science 
Grant](https://chanzuckerberg.com/eoss/proposals/cogent3-python-apis-for-iq-tree-and-graphbin-via-a-plug-in-architecture/) 
from the Chan Zuckerberg Initiative.

<p align="left">
  <img src="https://chanzuckerberg.com/wp-content/themes/czi/img/logo.svg" width="300">
</p>
