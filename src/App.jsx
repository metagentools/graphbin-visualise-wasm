import React, { useEffect } from "react";
import { initApp } from "./app.js";

export default function App() {
  useEffect(() => {
    initApp();
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>GraphBin Visualise Wasm</h1>
        <p className="subtitle">
          Visualise and compare metagenomic binning results and improved binning
          results from GraphBin directly in your browser.
          <br />
          You can load your own data and click <b>Plot binning results</b>, or
          click <b>Run example data</b> to see how it works on the example data
          provided.
        </p>
      </header>

      <section className="panel">
        <div id="config-two-col">
          <div id="input-files-col">
            <h3>Input Files</h3>

            <div className="form-grid">
              <div className="form-row">
                <label htmlFor="assembler">Assembler</label>
                <div className="control">
                  <select id="assembler" defaultValue="spades">
                    <option value="spades">SPAdes</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="graph">GFA file</label>
                <div className="control">
                  <input id="graph" type="file" />
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="contigs">Contigs file</label>
                <div className="control">
                  <input id="contigs" type="file" />
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="paths">Paths file</label>
                <div className="control">
                  <input id="paths" type="file" />
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="initial">Initial binning result</label>
                <div className="control">
                  <input id="initial" type="file" />
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="graphbin">GraphBin result</label>
                <div className="control">
                  <input id="graphbin" type="file" />
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="setting-delimiter">Delimiter </label>
                <div className="control">
                  <select id="setting-delimiter" defaultValue=",">
                    <option value=",">Comma (,)</option>
                    <option value="\t">Tab (\t)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div id="settings-panel">
            <h3>Plot Settings</h3>

            <div className="form-grid">
              <div className="form-row">
                <label htmlFor="setting-dpi">DPI</label>
                <div className="control">
                  <input type="number" id="setting-dpi" defaultValue="300" />
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="setting-width">Width (px)</label>
                <div className="control">
                  <input type="number" id="setting-width" defaultValue="2000" />
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="setting-height">Height (px)</label>
                <div className="control">
                  <input type="number" id="setting-height" defaultValue="2000" />
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="setting-vsize">Vertex Size</label>
                <div className="control">
                  <input type="number" id="setting-vsize" defaultValue="50" />
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="setting-lsize">Label Size</label>
                <div className="control">
                  <input type="number" id="setting-lsize" defaultValue="2" />
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="setting-imgtype">Image Type</label>
                <div className="control">
                  <select id="setting-imgtype" defaultValue="png">
                    <option value="png">PNG</option>
                    <option value="svg">SVG</option>
                    <option value="pdf">PDF</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="button-row">
          <button id="run-btn" className="btn primary">
            Plot binning results
          </button>
          <button id="example-btn" className="btn secondary">
            Run example data
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Output</h2>
        <div id="output">(logs will appear here)</div>
      </section>

      <section className="panel">
        <h2>Plots</h2>
        <div id="plots-row">
          <div className="plot-block" id="initial-block" style={{ display: "none" }}>
            <img id="initial-img" alt="Initial binning plot" />
            <button id="download-initial" className="btn tertiary">
              Download initial binning result plot
            </button>
          </div>

          <div className="plot-block" id="final-block" style={{ display: "none" }}>
            <img id="final-img" alt="GraphBin binning plot" />
            <button id="download-final" className="btn tertiary">
              Download GraphBin binning result plot
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Interactive View</h2>

        <div className="interactive-grid">
          <div className="interactive-controls">
            <div className="form-grid">
              <div className="form-row">
                <label htmlFor="view-mode">Binning to display</label>
                <div className="control">
                  <select id="view-mode" defaultValue="final">
                    <option value="initial">Initial</option>
                    <option value="final">GraphBin</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="bin-filter">Show only bin</label>
                <div className="control">
                  <select id="bin-filter">
                    <option value="">(all bins)</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="toggle-hide-unbinned">Hide unbinned</label>
                <div className="control">
                  <label className="cb">
                    <input id="toggle-hide-unbinned" type="checkbox" />
                    <span className="cb-box" aria-hidden="true"></span>
                  </label>
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="toggle-only-changed">Show only changed</label>
                <div className="control">
                  <label className="cb">
                    <input id="toggle-only-changed" type="checkbox" />
                    <span className="cb-box" aria-hidden="true"></span>
                  </label>
                </div>
              </div>

              <div className="form-row">
                <label></label>
                <div className="control">
                  <button id="reset-view" className="btn secondary">
                    Reset view
                  </button>
                </div>
              </div>
            </div>

            <div className="legend-hint">
              <div>
                <b>Controls</b>
              </div>
              <div>Wheel: zoom</div>
              <div>Drag: pan</div>
              <div>Hover: tooltip</div>
              <div>Click: lock selection</div>
            </div>

            <div className="legend-title">Bin legend</div>
            <div id="bin-legend" className="bin-legend"></div>
          </div>

          <div className="interactive-canvas-wrap">
            <svg id="graph-svg" role="img" aria-label="Interactive assembly graph"></svg>
            <div id="hover-tooltip" className="tooltip" style={{ display: "none" }}></div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Contig flow between binnings</h2>

        <div className="sankey-controls">
          <div className="sankey-controls-left">
            <label className="cb">
              <input id="sankey-only-changed" type="checkbox" />
              <span className="cb-box" aria-hidden="true"></span>
              <span className="cb-text">Only contigs that changed bin</span>
            </label>

            <label className="cb">
              <input id="sankey-hide-unbinned" type="checkbox" />
              <span className="cb-box" aria-hidden="true"></span>
              <span className="cb-text">Hide unbinned</span>
            </label>
          </div>

          <div className="sankey-controls-right">
            <div className="sankey-hint">Click a flow to highlight it.</div>
          </div>
        </div>

        <div className="sankey-wrap">
          <div className="sankey-title-row">
            <div id="sankey-left-title" className="sankey-title">
              Binning 1
            </div>
            <div id="sankey-right-title" className="sankey-title">
              Binning 2
            </div>
          </div>
          <svg
            id="sankey-svg"
            role="img"
            aria-label="Sankey diagram showing contig bin changes"
          ></svg>
          <div id="sankey-tooltip" className="tooltip" style={{ display: "none" }}></div>
        </div>
      </section>
    </div>
  );
}
