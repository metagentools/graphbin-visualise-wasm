import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const MANIFEST_PATH = path.resolve(
  process.cwd(),
  process.env.BENCHMARK_MANIFEST || "tests/bench/datasets.manifest.json"
);
const OUTPUT_PATH = path.resolve(
  process.cwd(),
  process.env.BENCHMARK_OUTPUT || "tests/bench/results/benchmark-results.csv"
);
const WAIT_TIMEOUT_MS = Number.parseInt(
  process.env.BENCHMARK_WAIT_TIMEOUT_MS || "900000",
  10
);

const CSV_HEADERS = [
  "timestamp",
  "dataset",
  "assembler",
  "source",
  "run_type",
  "run_index",
  "status",
  "total_ms",
  "pyodide_init_ms",
  "input_load_ms",
  "graphbin_ms",
  "visualize_ms",
  "layout_ms",
  "interactive_prepare_ms",
  "interactive_render_ready_ms",
  "graph_size_bytes",
  "contigs_size_bytes",
  "paths_size_bytes",
  "initial_size_bytes",
  "nodes",
  "edges",
  "delimiter",
  "browser",
  "host",
  "commit",
  "error",
];

const GIT_COMMIT = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch (e) {
    return "unknown";
  }
})();

function csvEscape(value) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function ensureOutputFile(outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (!fs.existsSync(outputPath)) {
    fs.writeFileSync(outputPath, `${CSV_HEADERS.join(",")}\n`, "utf8");
  }
}

function appendCsvRow(outputPath, row) {
  const line = CSV_HEADERS.map((header) => csvEscape(row[header])).join(",");
  fs.appendFileSync(outputPath, `${line}\n`, "utf8");
}

function asPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Benchmark manifest not found: ${manifestPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const datasets = Array.isArray(parsed.datasets)
    ? parsed.datasets.filter((dataset) => dataset?.enabled !== false)
    : [];

  if (datasets.length === 0) {
    throw new Error("Benchmark manifest must include at least one enabled dataset.");
  }

  const coldRuns = asPositiveInt(parsed.runs?.cold, 1);
  const warmRuns = asPositiveInt(parsed.runs?.warm, 3);

  return {
    datasets,
    coldRuns,
    warmRuns,
  };
}

function resolveDatasetFiles(dataset, manifestDir) {
  if (dataset.mode === "example") return null;

  const assembler = dataset.assembler || "spades";
  const required = assembler === "spades"
    ? ["graph", "contigs", "paths", "initial"]
    : ["graph", "contigs", "initial"];
  for (const key of required) {
    if (!dataset[key]) {
      throw new Error(`Dataset "${dataset.name}" is missing required field "${key}".`);
    }
  }

  const resolvePath = (p) => (path.isAbsolute(p) ? p : path.resolve(manifestDir, p));
  return {
    graph: resolvePath(dataset.graph),
    contigs: resolvePath(dataset.contigs),
    paths: dataset.paths ? resolvePath(dataset.paths) : null,
    initial: resolvePath(dataset.initial),
  };
}

async function triggerBenchmarkRun(page, dataset, files) {
  const assembler = dataset.assembler || "spades";
  await page.locator("#assembler").selectOption(assembler);

  if (dataset.mode === "example") {
    await page.locator("#example-btn").click();
    return;
  }

  await page.locator("#graph").setInputFiles(files.graph);
  await page.locator("#contigs").setInputFiles(files.contigs);
  if (assembler === "spades" && files.paths) {
    await page.locator("#paths").setInputFiles(files.paths);
  }
  await page.locator("#initial").setInputFiles(files.initial);
  await page.locator("#setting-delimiter").selectOption(dataset.delimiter || ",");
  await page.locator("#run-btn").click();
}

async function waitForBenchmarkResult(page, previousRunId) {
  await page.waitForFunction(
    (prevId) => {
      const result = window.__lastBenchmark;
      return (
        result &&
        result.run_id > prevId &&
        result.status &&
        result.status !== "running" &&
        result.completed_at
      );
    },
    previousRunId,
    { timeout: WAIT_TIMEOUT_MS }
  );

  return page.evaluate(() => window.__lastBenchmark);
}

function buildCsvRow(result, dataset, runType, runIndex, browserName) {
  return {
    timestamp: result.completed_at,
    dataset: dataset.name || result.dataset,
    assembler: result.assembler || dataset.assembler || "spades",
    source: result.source,
    run_type: runType,
    run_index: runIndex,
    status: result.status,
    total_ms: result.total_ms,
    pyodide_init_ms: result.phase_ms?.pyodide_init ?? "",
    input_load_ms: result.phase_ms?.input_load ?? "",
    graphbin_ms: result.phase_ms?.graphbin ?? "",
    visualize_ms: result.phase_ms?.visualize ?? "",
    layout_ms: result.phase_ms?.layout ?? "",
    interactive_prepare_ms: result.phase_ms?.interactive_prepare ?? "",
    interactive_render_ready_ms: result.phase_ms?.interactive_render_ready ?? "",
    graph_size_bytes: result.file_sizes_bytes?.graph ?? "",
    contigs_size_bytes: result.file_sizes_bytes?.contigs ?? "",
    paths_size_bytes: result.file_sizes_bytes?.paths ?? "",
    initial_size_bytes: result.file_sizes_bytes?.initial ?? "",
    nodes: result.counts?.nodes ?? "",
    edges: result.counts?.edges ?? "",
    delimiter: result.delimiter ?? "",
    browser: browserName,
    host: os.hostname(),
    commit: GIT_COMMIT,
    error: result.error ?? "",
  };
}

test.describe.configure({ mode: "serial" });

test("benchmark datasets and write CSV", async ({ page, browserName }) => {
  const manifest = loadManifest(MANIFEST_PATH);
  const totalRunsPerDataset = manifest.coldRuns + manifest.warmRuns;
  const expectedMaxTime =
    Math.max(1, manifest.datasets.length) *
    Math.max(1, totalRunsPerDataset) *
    WAIT_TIMEOUT_MS;
  test.setTimeout(expectedMaxTime + 120_000);

  ensureOutputFile(OUTPUT_PATH);
  const manifestDir = path.dirname(MANIFEST_PATH);

  for (const dataset of manifest.datasets) {
    const mode = dataset.mode || "upload";
    const normalizedDataset = { ...dataset, mode, assembler: dataset.assembler || "spades" };
    const files = resolveDatasetFiles(normalizedDataset, manifestDir);

    for (let i = 0; i < totalRunsPerDataset; i += 1) {
      const runType = i < manifest.coldRuns ? "cold" : "warm";
      const runIndex = i + 1;

      if (runType === "cold" || i === 0) {
        await page.goto("/");
        await expect(
          page.getByRole("heading", { name: /GraphBin-Viz/i })
        ).toBeVisible();
      }

      const previousRunId = await page.evaluate(
        () => window.__lastBenchmark?.run_id ?? 0
      );

      await triggerBenchmarkRun(page, normalizedDataset, files);
      const result = await waitForBenchmarkResult(page, previousRunId);

      appendCsvRow(
        OUTPUT_PATH,
        buildCsvRow(result, normalizedDataset, runType, runIndex, browserName)
      );
    }
  }
});
