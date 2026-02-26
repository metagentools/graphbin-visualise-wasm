#!/usr/bin/env python3

"""Visualise binning results on a MEGAHIT assembly graph."""

import csv
import json
import logging
import math
import os
import re
from collections import defaultdict

from igraph import Graph
from igraph import plot as ig_plot

import matplotlib

matplotlib.use("Agg")
import matplotlib.colors as mcolors
import matplotlib.pyplot as plt

from bidictmap import BidirectionalMap

logger = logging.getLogger("megahit_plot")


def generate_distinct_colours(bins):
    if bins <= 0:
        return []

    if bins <= 10:
        cmap = plt.get_cmap("tab10")
        return [mcolors.to_hex(cmap(i)) for i in range(bins)]

    if bins <= 20:
        cmap = plt.get_cmap("tab20")
        order = list(range(0, 20, 2)) + list(range(1, 20, 2))
        return [mcolors.to_hex(cmap(i)) for i in order[:bins]]

    colours = []
    for i in range(bins):
        hue = i / bins
        rgb = mcolors.hsv_to_rgb((hue, 0.75, 0.95))
        colours.append(mcolors.to_hex(rgb))
    return colours


def draw_graph_with_matplotlib(
    graph, out_name, visual_style, dpi=300, width=2000, height=2000
):
    fig_width_in = width / dpi
    fig_height_in = height / dpi
    fig, ax = plt.subplots(figsize=(fig_width_in, fig_height_in), dpi=dpi)
    ig_plot(graph, target=ax, **visual_style)
    fig.savefig(out_name, dpi=dpi, bbox_inches="tight")
    plt.close(fig)


def write_layout_json(layout, graph, output_path, prefix):
    coords = {}
    for i in range(len(graph.vs)):
        node_id = graph.vs[i]["name"]
        coords[node_id] = [
            float(layout.coords[i][0]),
            float(layout.coords[i][1]),
        ]

    with open(f"{output_path}{prefix}layout.json", "w", encoding="utf-8") as f:
        json.dump({"coords": coords}, f)


def reverse_complement(seq):
    table = str.maketrans("ACGTNacgtn", "TGCANtgcan")
    return seq.translate(table)[::-1]


def parse_fasta_with_coverage(contigs_file):
    contig_order = []
    contig_sequences = {}
    contig_coverage = {}

    header = None
    seq_chunks = []

    def flush_entry():
        nonlocal header, seq_chunks
        if header is None:
            return

        contig_id = header.split()[0]
        sequence = "".join(seq_chunks).strip()
        contig_order.append(contig_id)
        contig_sequences[contig_id] = sequence

        cov_match = re.search(r"(?:^|\s)multi=([0-9eE.+-]+)", header)
        if cov_match:
            try:
                contig_coverage[contig_id] = float(cov_match.group(1))
            except ValueError:
                contig_coverage[contig_id] = None
        else:
            contig_coverage[contig_id] = None

        header = None
        seq_chunks = []

    with open(contigs_file, "r", encoding="utf-8", errors="ignore") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith(">"):
                flush_entry()
                header = line[1:]
                seq_chunks = []
            else:
                seq_chunks.append(line)
    flush_entry()

    return contig_order, contig_sequences, contig_coverage


def parse_gfa(gfa_file):
    segments = {}
    links = []

    with open(gfa_file, "r", encoding="utf-8", errors="ignore") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue

            if line.startswith("S\t"):
                parts = line.split("\t")
                if len(parts) < 3:
                    continue
                segment_id = parts[1]
                sequence = parts[2]
                segments[segment_id] = sequence

            elif line.startswith("L\t"):
                parts = line.split("\t")
                if len(parts) < 5:
                    continue
                links.append((parts[1], parts[3]))

    return segments, links


def map_segments_to_contigs(segments, contig_order, contig_sequences):
    sequence_to_segments = defaultdict(list)
    for segment_id, seq in segments.items():
        sequence_to_segments[seq].append(segment_id)

    segment_to_contig = BidirectionalMap()

    for contig_id in contig_order:
        seq = contig_sequences.get(contig_id)
        if not seq:
            continue

        matched_segment = None
        for seq_candidate in (seq, reverse_complement(seq)):
            segment_list = sequence_to_segments.get(seq_candidate)
            if segment_list:
                matched_segment = segment_list.pop()
                break

        if matched_segment is None:
            continue

        try:
            segment_to_contig[matched_segment] = contig_id
        except Exception:
            continue

    return segment_to_contig


def build_graph(segments, links, segment_to_contig, contig_coverage):
    graph = Graph()
    node_count = len(segments)
    graph.add_vertices(node_count)

    segment_index = BidirectionalMap()
    for idx, segment_id in enumerate(segments.keys()):
        segment_index[idx] = segment_id

    segment_index_rev = segment_index.inverse

    contig_to_vertex = {}
    for idx in range(node_count):
        segment_id = segment_index[idx]
        contig_id = segment_to_contig.get(segment_id, segment_id)
        graph.vs[idx]["id"] = idx
        graph.vs[idx]["segment"] = segment_id
        graph.vs[idx]["name"] = contig_id
        graph.vs[idx]["label"] = contig_id
        graph.vs[idx]["coverage"] = contig_coverage.get(contig_id)
        contig_to_vertex[contig_id] = idx

    edge_list = []
    for left_segment, right_segment in links:
        if left_segment == right_segment:
            continue
        if left_segment not in segment_index_rev or right_segment not in segment_index_rev:
            continue
        edge_list.append((segment_index_rev[left_segment], segment_index_rev[right_segment]))

    if edge_list:
        graph.add_edges(edge_list)
    graph.simplify(multiple=True, loops=False)

    return graph, segment_index, segment_index_rev, contig_to_vertex


def get_bins_list(path, delimiter):
    all_bins = []
    with open(path, "r", encoding="utf-8", errors="ignore") as csvfile:
        reader = csv.reader(csvfile, delimiter=delimiter)
        for row in reader:
            if len(row) < 2:
                continue
            all_bins.append(row[1])
    bins_list = sorted(set(all_bins))
    return bins_list


def read_binning(path, delimiter, bins_list, contig_to_vertex, segment_index_rev):
    bins = [[] for _ in range(len(bins_list))]

    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        reader = csv.reader(f, delimiter=delimiter)
        for row in reader:
            if len(row) < 2:
                continue

            contig_id = row[0].strip()
            bin_id = row[1].strip()
            if bin_id not in bins_list:
                continue

            vertex = None
            if contig_id in contig_to_vertex:
                vertex = contig_to_vertex[contig_id]
            elif contig_id in segment_index_rev:
                vertex = segment_index_rev[contig_id]

            if vertex is None:
                continue

            bins[bins_list.index(bin_id)].append(vertex)

    return bins


def vertex_sizes_from_coverage(graph, base_size):
    coverages = [
        v["coverage"]
        for v in graph.vs
        if v["coverage"] is not None and isinstance(v["coverage"], (int, float))
    ]
    if not coverages:
        return base_size

    positive = [c for c in coverages if c > 0]
    if not positive:
        return base_size

    cmin = min(positive)
    cmax = max(positive)
    if cmin == cmax:
        return [base_size for _ in graph.vs]

    log_min = math.log10(cmin)
    log_max = math.log10(cmax)
    denom = log_max - log_min

    sizes = []
    for v in graph.vs:
        cov = v["coverage"]
        if cov is None or not isinstance(cov, (int, float)) or cov <= 0:
            sizes.append(base_size)
            continue
        norm = (math.log10(cov) - log_min) / denom
        sizes.append(base_size * (0.65 + (0.85 * norm)))

    return sizes


def colour_nodes(graph, bins, colours):
    node_colours = []
    for idx in range(len(graph.vs)):
        assigned = False
        for bin_idx, contigs in enumerate(bins):
            if idx in contigs:
                node_colours.append(colours[bin_idx])
                assigned = True
                break
        if not assigned:
            node_colours.append("#d3d3d3")
    graph.vs["color"] = node_colours


def run(args):
    logging.basicConfig(level=logging.INFO)

    initial_binning_result = args.initial
    final_binning_result = getattr(args, "final", None)
    assembly_graph_file = args.graph
    contigs_file = args.contigs
    output_path = args.output
    prefix = args.prefix
    dpi = args.dpi
    width = args.width
    height = args.height
    vsize = args.vsize
    lsize = args.lsize
    margin = args.margin
    image_type = args.imgtype
    delimiter = args.delimiter

    if final_binning_result and not os.path.exists(final_binning_result):
        final_binning_result = None
    if not final_binning_result:
        final_binning_result = initial_binning_result

    if prefix and not prefix.endswith("_"):
        prefix = prefix + "_"
    elif not prefix:
        prefix = ""

    if image_type.startswith("."):
        image_type = image_type[1:]

    if output_path[-1:] != "/":
        output_path += "/"
    os.makedirs(output_path, exist_ok=True)

    bins_list = get_bins_list(initial_binning_result, delimiter)
    logger.info("Detected %s bins from initial result", len(bins_list))

    contig_order, contig_sequences, contig_coverage = parse_fasta_with_coverage(contigs_file)
    segments, links = parse_gfa(assembly_graph_file)
    segment_to_contig = map_segments_to_contigs(segments, contig_order, contig_sequences)

    logger.info("Segments in GFA: %s", len(segments))
    logger.info("Contigs in FASTA: %s", len(contig_order))
    logger.info("Mapped segment->contig IDs: %s", len(segment_to_contig))

    (
        assembly_graph,
        _segment_index,
        segment_index_rev,
        contig_to_vertex,
    ) = build_graph(segments, links, segment_to_contig, contig_coverage)

    initial_bins = read_binning(
        initial_binning_result,
        delimiter,
        bins_list,
        contig_to_vertex,
        segment_index_rev,
    )
    final_bins = read_binning(
        final_binning_result,
        delimiter,
        bins_list,
        contig_to_vertex,
        segment_index_rev,
    )

    colours = generate_distinct_colours(len(bins_list))
    layout = assembly_graph.layout_fruchterman_reingold()
    write_layout_json(layout, assembly_graph, output_path, prefix)

    visual_style = {
        "bbox": (width, height),
        "margin": margin,
        "vertex_size": vertex_sizes_from_coverage(assembly_graph, vsize),
        "vertex_label_size": lsize,
        "edge_curved": False,
        "layout": layout,
    }

    colour_nodes(assembly_graph, initial_bins, colours)
    initial_out_fig_name = f"{output_path}{prefix}initial_binning_result.{image_type}"
    draw_graph_with_matplotlib(
        assembly_graph,
        initial_out_fig_name,
        visual_style,
        dpi=dpi,
        width=width,
        height=height,
    )

    colour_nodes(assembly_graph, final_bins, colours)
    final_out_fig_name = f"{output_path}{prefix}final_GraphBin_binning_result.{image_type}"
    draw_graph_with_matplotlib(
        assembly_graph,
        final_out_fig_name,
        visual_style,
        dpi=dpi,
        width=width,
        height=height,
    )

    logger.info("Initial plot: %s", initial_out_fig_name)
    logger.info("Final plot: %s", final_out_fig_name)


def main(args):
    run(args)


if __name__ == "__main__":
    main()
