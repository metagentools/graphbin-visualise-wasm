#!/usr/bin/env python3

import argparse
import csv
import os
import statistics
from collections import defaultdict

import matplotlib.pyplot as plt


NUMERIC_COLUMNS = [
    "total_ms",
    "input_load_ms",
    "graphbin_ms",
    "visualize_ms",
    "interactive_prepare_ms",
    "interactive_render_ready_ms",
    "nodes",
    "graph_size_bytes",
    "contigs_size_bytes",
]

X_SPECS = [
    ("nodes", "Nodes", lambda v: v),
    ("graph_size_bytes", "Graph size (MB)", lambda v: v / (1024 * 1024)),
    ("contigs_size_bytes", "Contigs size (MB)", lambda v: v / (1024 * 1024)),
]

Y_SPECS = [
    ("total_ms", "Total time (ms)"),
    ("input_load_ms", "Input load time (ms)"),
    ("graphbin_ms", "GraphBin time (ms)"),
    ("visualize_ms", "Visualize time (ms)"),
]


def parse_float(value):
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def load_rows(csv_path):
    rows = []
    with open(csv_path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            parsed = dict(row)
            parsed["dataset"] = (row.get("dataset") or "unknown").strip()
            parsed["assembler"] = (row.get("assembler") or "unknown").strip()
            parsed["status"] = (row.get("status") or "").strip().lower()

            for col in NUMERIC_COLUMNS:
                parsed[col] = parse_float(row.get(col))

            rows.append(parsed)
    return rows


def keep_valid_rows(rows):
    return [r for r in rows if r["status"] in {"success", "partial"}]


def median_by_dataset(rows):
    groups = defaultdict(list)
    for row in rows:
        key = (row["dataset"], row["assembler"])
        groups[key].append(row)

    aggregated = []
    for (dataset, assembler), values in groups.items():
        agg = {"dataset": dataset, "assembler": assembler, "run_count": len(values)}
        for col in NUMERIC_COLUMNS:
            col_values = [v[col] for v in values if v[col] is not None]
            agg[col] = statistics.median(col_values) if col_values else None
        aggregated.append(agg)

    return aggregated


def _median(values):
    return statistics.median(values) if values else None


def _std(values):
    if len(values) <= 1:
        return 0.0
    return statistics.stdev(values)


def _dedup_legend_items(handles, labels):
    dedup = {}
    for handle, label in zip(handles, labels):
        if label not in dedup:
            dedup[label] = handle
    return list(dedup.values()), list(dedup.keys())


def summarize_metric_with_error(rows, metric_col):
    groups = defaultdict(list)
    for row in rows:
        key = (row["dataset"], row["assembler"])
        groups[key].append(row)

    summarized = []
    for (dataset, assembler), values in groups.items():
        summary = {
            "dataset": dataset,
            "assembler": assembler,
            "run_count": len(values),
        }

        metric_values = [v[metric_col] for v in values if v[metric_col] is not None]
        summary[f"{metric_col}_median"] = _median(metric_values)
        summary[f"{metric_col}_error"] = _std(metric_values)

        for x_col, _, _ in X_SPECS:
            x_values = [v[x_col] for v in values if v[x_col] is not None]
            summary[f"{x_col}_median"] = _median(x_values)
            summary[f"{x_col}_error"] = _std(x_values)

        summarized.append(summary)

    return summarized


def summarize_phase_with_error(rows):
    groups = defaultdict(list)
    for row in rows:
        key = (row["dataset"], row["assembler"])
        groups[key].append(row)

    summarized = []
    for (dataset, assembler), values in groups.items():
        summary = {
            "dataset": dataset,
            "assembler": assembler,
            "run_count": len(values),
        }

        for y_col, _ in Y_SPECS:
            y_values = [v[y_col] for v in values if v[y_col] is not None]
            summary[f"{y_col}_median"] = _median(y_values)
            summary[f"{y_col}_error"] = _std(y_values)

        for x_col, _, _ in X_SPECS:
            x_values = [v[x_col] for v in values if v[x_col] is not None]
            summary[f"{x_col}_median"] = _median(x_values)
            summary[f"{x_col}_error"] = _std(x_values)

        summarized.append(summary)

    return summarized


def plot_run_level_total(rows, output_path):
    fig, axes = plt.subplots(1, len(X_SPECS), figsize=(15, 5), constrained_layout=True)
    assemblers = sorted({row["assembler"] for row in rows})
    colors = {asm: plt.get_cmap("tab10")(i % 10) for i, asm in enumerate(assemblers)}

    for col_idx, (x_col, x_label, x_transform) in enumerate(X_SPECS):
        ax = axes[col_idx]
        for assembler in assemblers:
            subset = [r for r in rows if r["assembler"] == assembler]
            for dataset_row in subset:
                x_median_raw = dataset_row.get(f"{x_col}_median")
                y_median = dataset_row.get("total_ms_median")
                if x_median_raw is None or y_median is None:
                    continue

                x_median = x_transform(x_median_raw)
                x_err_raw = dataset_row.get(f"{x_col}_error") or 0.0
                x_err = x_transform(x_err_raw) if x_err_raw > 0 else 0.0
                y_err = dataset_row.get("total_ms_error") or 0.0

                ax.errorbar(
                    x_median,
                    y_median,
                    xerr=x_err if x_err > 0 else None,
                    yerr=y_err if y_err > 0 else None,
                    fmt="o",
                    markersize=6,
                    capsize=3,
                    alpha=0.85,
                    color=colors[assembler],
                    label=assembler,
                )
                ax.annotate(
                    dataset_row["dataset"], (x_median, y_median), fontsize=8, alpha=0.85
                )

        ax.set_title(f"Total time vs {x_label}")
        ax.set_xlabel(x_label)
        ax.set_ylabel("Total time (ms)")
        ax.grid(alpha=0.3)

    all_handles = []
    all_labels = []
    for ax in axes:
        handles, labels = ax.get_legend_handles_labels()
        all_handles.extend(handles)
        all_labels.extend(labels)
    handles, labels = _dedup_legend_items(all_handles, all_labels)
    if handles:
        axes[-1].legend(handles, labels, loc="upper right", title="Assembler", frameon=True)
    fig.suptitle("Dataset-level total benchmark results")
    fig.savefig(output_path, dpi=300)
    plt.close(fig)


def plot_phase_grid_with_error(rows, output_path, annotate=True):
    fig, axes = plt.subplots(
        len(Y_SPECS),
        len(X_SPECS),
        figsize=(15, 12),
        constrained_layout=True,
    )
    assemblers = sorted({r["assembler"] for r in rows})
    colors = {asm: plt.get_cmap("tab10")(i % 10) for i, asm in enumerate(assemblers)}

    for yi, (y_col, y_label) in enumerate(Y_SPECS):
        for xi, (x_col, x_label, x_transform) in enumerate(X_SPECS):
            ax = axes[yi][xi]
            for assembler in assemblers:
                subset = [r for r in rows if r["assembler"] == assembler]
                for dataset_row in subset:
                    x_median_raw = dataset_row.get(f"{x_col}_median")
                    y_median = dataset_row.get(f"{y_col}_median")
                    if x_median_raw is None or y_median is None:
                        continue

                    x_median = x_transform(x_median_raw)

                    ax.scatter(
                        x_median,
                        y_median,
                        s=40,
                        alpha=0.85,
                        color=colors[assembler],
                        label=assembler,
                    )
                    if annotate:
                        ax.annotate(
                            dataset_row["dataset"],
                            (x_median, y_median),
                            fontsize=8,
                            alpha=0.85,
                        )

            if yi == 0:
                ax.set_title(x_label)
            if xi == 0:
                ax.set_ylabel(y_label)
            ax.set_xlabel(x_label)
            ax.grid(alpha=0.3)

    all_handles = []
    all_labels = []
    for row_axes in axes:
        for ax in row_axes:
            handles, labels = ax.get_legend_handles_labels()
            all_handles.extend(handles)
            all_labels.extend(labels)
    handles, labels = _dedup_legend_items(all_handles, all_labels)
    if handles:
        axes[-1][-1].legend(
            handles,
            labels,
            loc="upper right",
            title="Assembler",
            frameon=True,
        )
    fig.suptitle("Phase timings vs features")
    fig.savefig(output_path, dpi=300)
    plt.close(fig)


def write_aggregated_csv(rows, output_path):
    fields = ["dataset", "assembler", "run_count"] + NUMERIC_COLUMNS
    with open(output_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in sorted(rows, key=lambda x: (x["assembler"], x["dataset"])):
            writer.writerow({field: row.get(field) for field in fields})


def main():
    parser = argparse.ArgumentParser(
        description="Plot benchmark timing results against graph scale features."
    )
    parser.add_argument(
        "--input",
        default="tests/bench/results/benchmark-results.csv",
        help="Path to benchmark CSV file",
    )
    parser.add_argument(
        "--output-dir",
        default="tests/bench/results/plots",
        help="Directory for generated plots",
    )
    parser.add_argument(
        "--no-annotations",
        action="store_true",
        help="Disable dataset labels on phase plots",
    )
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    rows = load_rows(args.input)
    valid_rows = keep_valid_rows(rows)

    if not valid_rows:
        raise SystemExit("No successful/partial benchmark rows found to plot.")

    median_rows = median_by_dataset(valid_rows)
    phase_rows = summarize_phase_with_error(valid_rows)

    run_level_plot = os.path.join(args.output_dir, "run_level_total_vs_features.png")
    phase_plot = os.path.join(args.output_dir, "phase_timings_vs_features.png")
    median_csv = os.path.join(args.output_dir, "dataset_medians.csv")

    run_level_summary = summarize_metric_with_error(valid_rows, "total_ms")
    plot_run_level_total(run_level_summary, run_level_plot)
    plot_phase_grid_with_error(phase_rows, phase_plot, annotate=not args.no_annotations)
    write_aggregated_csv(median_rows, median_csv)

    print(f"Wrote: {run_level_plot}")
    print(f"Wrote: {phase_plot}")
    print(f"Wrote: {median_csv}")


if __name__ == "__main__":
    main()
