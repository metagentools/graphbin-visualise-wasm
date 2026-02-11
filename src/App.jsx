import React, { useEffect, useState } from "react";
import { initApp } from "./app.js";

export default function App() {
  const [activeTab, setActiveTab] = useState("output");

  useEffect(() => {
    initApp();

    const root = document.documentElement;
    const toggleButton = document.getElementById("theme-toggle");
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const storageKey = "graphbin-theme";

    const getSystemTheme = () => (media.matches ? "dark" : "light");

    const applyTheme = (theme) => {
      root.dataset.theme = theme;
      root.style.colorScheme = theme;

      if (toggleButton) {
        toggleButton.setAttribute(
          "aria-label",
          theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
        );
        toggleButton.setAttribute("aria-pressed", theme === "dark");
      }
    };

    const storedTheme = localStorage.getItem(storageKey);
    applyTheme(storedTheme || getSystemTheme());

    const handleToggle = () => {
      const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem(storageKey, nextTheme);
      applyTheme(nextTheme);
    };

    const handleDocClick = (event) => {
      const target = event.target;
      if (target && target.closest && target.closest("details.help")) {
        return;
      }
      document.querySelectorAll("details.help[open]").forEach((detail) => {
        detail.open = false;
      });
    };

    const handleSystemChange = () => {
      if (!localStorage.getItem(storageKey)) {
        applyTheme(getSystemTheme());
      }
    };

    if (toggleButton) {
      toggleButton.addEventListener("click", handleToggle);
    }

    document.addEventListener("click", handleDocClick);

    if (media.addEventListener) {
      media.addEventListener("change", handleSystemChange);
    } else {
      media.addListener(handleSystemChange);
    }

    return () => {
      if (toggleButton) {
        toggleButton.removeEventListener("click", handleToggle);
      }
      document.removeEventListener("click", handleDocClick);
      if (media.removeEventListener) {
        media.removeEventListener("change", handleSystemChange);
      } else {
        media.removeListener(handleSystemChange);
      }
    };
  }, []);

  useEffect(() => {
    const syncFlowPanelHeight = () => {
      if (activeTab !== "interactive") {
        return;
      }
      const panel = document.getElementById("panel-interactive");
      if (!panel) return;
      const h = panel.getBoundingClientRect().height;
      if (h > 0) {
        document.documentElement.style.setProperty(
          "--flow-panel-height",
          `${Math.round(h)}px`
        );
      }
    };

    const handleResize = () => {
      syncFlowPanelHeight();
    };

    window.addEventListener("resize", handleResize);

    let frame = null;
    if (activeTab !== "output") {
      frame = requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
        syncFlowPanelHeight();
      });
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [activeTab]);

  return (
    <div className="app">
      <button
        id="theme-toggle"
        className="theme-toggle"
        type="button"
        aria-label="Switch to dark mode"
        aria-pressed="false"
      >
        <svg className="icon sun" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4.5a1 1 0 0 1 1 1V7a1 1 0 1 1-2 0V5.5a1 1 0 0 1 1-1Zm0 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.5-3.5a1 1 0 0 1 1 1v.1a1 1 0 0 1-1 1h-1.4a1 1 0 1 1 0-2h1.4ZM5.9 12a1 1 0 0 1-1 1H3.5a1 1 0 1 1 0-2h1.4a1 1 0 0 1 1 1Zm10.25-5.6a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1-1.4 1.4l-1-1a1 1 0 0 1 0-1.4ZM6.45 16.3a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1-1.4 1.4l-1-1a1 1 0 0 1 0-1.4ZM18.55 16.3a1 1 0 0 1 0 1.4l-1 1a1 1 0 1 1-1.4-1.4l1-1a1 1 0 0 1 1.4 0ZM7.85 5.1a1 1 0 0 1 0 1.4l-1 1A1 1 0 1 1 5.45 6.1l1-1a1 1 0 0 1 1.4 0Z" />
        </svg>
        <svg className="icon moon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.2 15.3a8.2 8.2 0 0 1-11.5-11 1 1 0 0 0-1.5-1.1 10 10 0 1 0 14.1 13.9 1 1 0 0 0-1.1-1.8Z" />
        </svg>
      </button>
      <header className="app-header">
        <h1>GraphBin Visualise Wasm</h1>
        <p className="subtitle">
          Visualise and compare metagenomic binning results and improved binning
          results from GraphBin (or a similar bin-improvement tool) directly in your browser. 
          All processing happens locally on your device, and no data ever leaves it.
          <br />
          You can load your own data (click on the tooltips for more information about the files 
          to be uploaded) and click <b>Plot binning results</b>, or
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
                <div className="label-with-help">
                  <label htmlFor="assembler">Assembler</label>
                  <details className="help" role="group">
                    <summary aria-label="Assembler help">?</summary>
                    <span className="help-tooltip" role="tooltip">
                      The assembler used to assemble your metagenomic sample
                    </span>
                  </details>
                </div>
                <div className="control">
                  <select id="assembler" defaultValue="spades">
                    <option value="spades">SPAdes</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="label-with-help">
                  <label htmlFor="graph">GFA file</label>
                  <details className="help" role="group">
                    <summary aria-label="GFA file help">?</summary>
                    <span className="help-tooltip" role="tooltip">
                      The GFA file output from the assembler (&lt; 200 MB)
                    </span>
                  </details>
                </div>
                <div className="control">
                  <input id="graph" type="file" />
                </div>
              </div>

              <div className="form-row">
                <div className="label-with-help">
                  <label htmlFor="contigs">Contigs file</label>
                  <details className="help" role="group">
                    <summary aria-label="Contigs file help">?</summary>
                    <span className="help-tooltip" role="tooltip">
                      The contigs file (e.g., contigs.fasta from SPAdes)  (&lt; 200 MB)
                    </span>
                  </details>
                </div>
                <div className="control">
                  <input id="contigs" type="file" />
                </div>
              </div>

              <div className="form-row">
                <div className="label-with-help">
                  <label htmlFor="paths">Paths file</label>
                  <details className="help" role="group">
                    <summary aria-label="Paths file help">?</summary>
                    <span className="help-tooltip" role="tooltip">
                      The paths file of the contigs (e.g., contigs.paths from SPAdes)
                    </span>
                  </details>
                </div>
                <div className="control">
                  <input id="paths" type="file" />
                </div>
              </div>

              <div className="form-row">
                <div className="label-with-help">
                  <label htmlFor="initial">Initial binning result</label>
                  <details className="help" role="group">
                    <summary aria-label="Initial binning result help">?</summary>
                    <span className="help-tooltip" role="tooltip">
                      The binning result from any existing metagenomic binning
                      tool in CSV or TSV format (contig name, bin ID)
                    </span>
                  </details>
                </div>
                <div className="control">
                  <input id="initial" type="file" />
                </div>
              </div>

              <div className="form-row">
                <div className="label-with-help">
                  <label htmlFor="graphbin">GraphBin result</label>
                  <details className="help" role="group">
                    <summary aria-label="GraphBin result help">?</summary>
                    <span className="help-tooltip" role="tooltip">
                      Improved binning result from GraphBin or similar
                      bin-improvement tool in CSV or TSV format. Currently
                      supports same bin names as the initial binning result.
                    </span>
                  </details>
                </div>
                <div className="control">
                  <input id="graphbin" type="file" />
                </div>
              </div>

              <div className="form-row">
                <div className="label-with-help">
                  <label htmlFor="setting-delimiter">Delimiter</label>
                  <details className="help" role="group">
                    <summary aria-label="Delimiter help">?</summary>
                    <span className="help-tooltip" role="tooltip">
                      Delimiter used in the binning results
                    </span>
                  </details>
                </div>
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
          <button
            id="run-btn"
            className="btn primary"
            type="button"
            onClick={() => setActiveTab("output")}
          >
            Plot binning results
          </button>
          <button
            id="example-btn"
            className="btn secondary"
            type="button"
            onClick={() => setActiveTab("output")}
          >
            Run example data
          </button>
        </div>
      </section>

      <section className="panel tab-shell">
        <div className="tab-header">
          <div className="tab-buttons" role="tablist" aria-label="Views">
            <button
              id="tab-output"
              className={`tab-btn ${activeTab === "output" ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === "output"}
              aria-controls="panel-output"
              onClick={() => setActiveTab("output")}
            >
              Output + Plots
            </button>
            <button
              id="tab-interactive"
              className={`tab-btn ${activeTab === "interactive" ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === "interactive"}
              aria-controls="panel-interactive"
              onClick={() => setActiveTab("interactive")}
            >
              Interactive View
            </button>
            <button
              id="tab-flow"
              className={`tab-btn ${activeTab === "flow" ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === "flow"}
              aria-controls="panel-flow"
              onClick={() => setActiveTab("flow")}
            >
              Contig Flow
            </button>
          </div>
        </div>

        <div className="tab-panels">
          <div
            id="panel-output"
            className={`tab-panel ${activeTab === "output" ? "active" : ""}`}
            role="tabpanel"
            aria-labelledby="tab-output"
          >
            <div className="tab-section">
              <h2>Output</h2>
              <div id="output">(logs will appear here)</div>
            </div>

            <div className="tab-section">
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
            </div>
          </div>

          <div
            id="panel-interactive"
            className={`tab-panel ${activeTab === "interactive" ? "active" : ""}`}
            role="tabpanel"
            aria-labelledby="tab-interactive"
          >
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
                    <label htmlFor="toggle-hide-isolated">Hide isolated contigs</label>
                    <div className="control">
                      <label className="cb">
                        <input id="toggle-hide-isolated" type="checkbox" />
                        <span className="cb-box" aria-hidden="true"></span>
                      </label>
                    </div>
                  </div>

                  <div className="form-row">
                    <label htmlFor="node-size">Node size</label>
                    <div className="control">
                      <div className="range-row">
                        <input
                          id="node-size"
                          type="range"
                          min="2"
                          max="16"
                          step="0.5"
                          defaultValue="5.5"
                        />
                        <span id="node-size-value" className="range-value">
                          5.5
                        </span>
                      </div>
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
                <canvas id="graph-canvas" width="900" height="700"></canvas>
                <div id="hover-tooltip" className="tooltip" style={{ display: "none" }}></div>
              </div>
            </div>
          </div>

          <div
            id="panel-flow"
            className={`tab-panel ${activeTab === "flow" ? "active" : ""}`}
            role="tabpanel"
            aria-labelledby="tab-flow"
          >
            <h2>Contig flow between binnings</h2>

            <div className="flow-body">
              <div className="flow-stats">
                <div className="flow-stat">
                  <div className="flow-stat-label">Total contigs that changed bin</div>
                  <div id="flow-stat-changed" className="flow-stat-value">—</div>
                </div>
                <div className="flow-stat">
                  <div className="flow-stat-label">Number of contigs re-assigned</div>
                  <div id="flow-stat-reassigned" className="flow-stat-value">—</div>
                </div>
                <div className="flow-stat">
                  <div className="flow-stat-label">Number of initially unbinned contigs binned</div>
                  <div id="flow-stat-unbinned-to-binned" className="flow-stat-value">—</div>
                </div>
                <div className="flow-stat">
                  <div className="flow-stat-label">Number of initially binned contigs unbinned</div>
                  <div id="flow-stat-binned-to-unbinned" className="flow-stat-value">—</div>
                </div>
              </div>

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
            </div>
          </div>
        </div>
      </section>

      <footer className="app-footer">
        Made by{" "}
        <a
          href="https://vijinimallawaarachchi.com/"
          target="_blank"
          rel="noreferrer"
        >
          Vijini M
        </a>{" "}
        @ Flinders University
      </footer>
    </div>
  );
}
