import random
import re
import csv
from collections import defaultdict

from igraph import *
from bidictmap import BidirectionalMap

import matplotlib
matplotlib.use("Agg")  # non-interactive backend
import matplotlib.pyplot as plt

from igraph import plot as ig_plot

def draw_graph_with_matplotlib(graph, out_name, visual_style, dpi=300, width=2000, height=2000):
    """
    Draw an igraph graph using matplotlib backend instead of cairo.

    width/height are in pixels; we convert to inches for matplotlib's figsize.
    """
    # px -> inches
    fig_width_in = width / dpi
    fig_height_in = height / dpi

    fig, ax = plt.subplots(figsize=(fig_width_in, fig_height_in), dpi=dpi)
    ig_plot(graph, target=ax, **visual_style)
    fig.savefig(out_name, dpi=dpi, bbox_inches="tight")
    plt.close(fig)

def run(args):

    initial_binning_result = args.initial
    final_binning_result = args.final
    assembly_graph_file = args.graph
    contig_paths = args.paths
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

    # Get the number of bins from the initial binning result
    # ---------------------------------------------------

    all_bins_list = []
    n_bins = 0

    with open(initial_binning_result, mode="r") as csvfile:
        readCSV = csv.reader(csvfile, delimiter=delimiter)
        for row in readCSV:
            all_bins_list.append(row[1])

    bins_list = list(set(all_bins_list))
    bins_list.sort()

    n_bins = len(bins_list)

    # Get contig paths from contigs.paths
    # -------------------------------------

    paths = {}
    segment_contigs = {}
    node_count = 0

    my_map = BidirectionalMap()

    current_contig_num = ""

    with open(contig_paths, mode="r") as file:
        name = file.readline()
        path = file.readline()

        while name != "" and path != "":
            while ";" in path:
                path = path[:-2] + "," + file.readline()

            start = "NODE_"
            end = "_length_"
            contig_num = str(
                int(re.search("%s(.*)%s" % (start, end), name).group(1))
            )

            segments = path.rstrip().split(",")

            if current_contig_num != contig_num:
                my_map[node_count] = int(contig_num)
                current_contig_num = contig_num
                node_count += 1

            if contig_num not in paths:
                paths[contig_num] = [segments[0], segments[-1]]

            for segment in segments:
                if segment not in segment_contigs:
                    segment_contigs[segment] = set([contig_num])
                else:
                    segment_contigs[segment].add(contig_num)

            name = file.readline()
            path = file.readline()

    contigs_map = my_map
    contigs_map_rev = my_map.inverse

    ## Construct the assembly graph
    # -------------------------------

    links = []
    links_map = defaultdict(set)

    # Get links from assembly_graph_with_scaffolds.gfa
    with open(assembly_graph_file, mode="r") as file:
        for line in file.readlines():
            line = line.strip()

            # Identify lines with link information
            if line.startswith("L"):
                strings = line.split("\t")
                f1, f2 = strings[1] + strings[2], strings[3] + strings[4]
                links_map[f1].add(f2)
                links_map[f2].add(f1)
                links.append(
                    strings[1] + strings[2] + " " + strings[3] + strings[4]
                )

    # Create graph
    assembly_graph = Graph()

    # Add vertices
    assembly_graph.add_vertices(node_count)

    # Create list of edges
    edge_list = []

    # Name vertices
    for i in range(node_count):
        assembly_graph.vs[i]["id"] = i
        assembly_graph.vs[i]["label"] = "NODE_" + str(contigs_map[i])

    for i in range(len(paths)):
        segments = paths[str(contigs_map[i])]

        start = segments[0]
        start_rev = ""

        if start.endswith("+"):
            start_rev = start[:-1] + "-"
        else:
            start_rev = start[:-1] + "+"

        end = segments[1]
        end_rev = ""

        if end.endswith("+"):
            end_rev = end[:-1] + "-"
        else:
            end_rev = end[:-1] + "+"

        new_links = []

        if start in links_map:
            new_links.extend(list(links_map[start]))
        if start_rev in links_map:
            new_links.extend(list(links_map[start_rev]))
        if end in links_map:
            new_links.extend(list(links_map[end]))
        if end_rev in links_map:
            new_links.extend(list(links_map[end_rev]))

        for new_link in new_links:
            if new_link in segment_contigs:
                for contig in segment_contigs[new_link]:
                    if i != contigs_map_rev[int(contig)]:
                        # Add edge to list of edges
                        edge_list.append((i, contigs_map_rev[int(contig)]))

    # Add edges to the graph
    assembly_graph.add_edges(edge_list)
    assembly_graph.simplify(multiple=True, loops=False, combine_edges=None)


    # Get the number of bins from the initial binning result
    # ---------------------------------------------------

    n_bins = 0

    all_bins_list = []

    with open(initial_binning_result, mode="r") as csvfile:
        readCSV = csv.reader(csvfile, delimiter=delimiter)
        for row in readCSV:
            all_bins_list.append(row[1])

    bins_list = list(set(all_bins_list))
    bins_list.sort()

    n_bins = len(bins_list)


    # Get initial binning result
    # ----------------------------

    bins = [[] for x in range(n_bins)]

    with open(initial_binning_result, mode="r") as contig_bins:
        readCSV = csv.reader(contig_bins, delimiter=delimiter)
        for row in readCSV:
            start = "NODE_"
            end = "_length_"
            contig_num = contigs_map_rev[
                int(re.search("%s(.*)%s" % (start, end), row[0]).group(1))
            ]

            bin_num = bins_list.index(row[1])
            bins[bin_num].append(contig_num)

    for i in range(n_bins):
        bins[i].sort()


    # Get list of colours according to number of bins
    # -------------------------------------------------

    my_colours = [
        "#e6194b",
        "#3cb44b",
        "#ffe119",
        "#4363d8",
        "#f58231",
        "#911eb4",
        "#46f0f0",
        "#f032e6",
        "#bcf60c",
        "#fabebe",
        "#008080",
        "#e6beff",
        "#9a6324",
        "#fffac8",
        "#800000",
        "#aaffc3",
        "#808000",
        "#ffd8b1",
        "#000075",
        "#808080",
        "#ffffff",
        "#000000",
    ]

    # Visualise the initial assembly graph
    # --------------------------------------

    initial_out_fig_name = f"{output_path}{prefix}initial_binning_result.{image_type}"

    node_colours = []

    for i in range(node_count):
        no_bin = True
        for j in range(n_bins):
            if i in bins[j]:
                node_colours.append(my_colours[j])
                no_bin = False

        if no_bin:
            node_colours.append("white")

    assembly_graph.vs["color"] = node_colours

    visual_style = {}

    # Set bbox and margin
    visual_style["bbox"] = (width, height)
    visual_style["margin"] = margin

    # Set vertex size
    visual_style["vertex_size"] = vsize

    # Set vertex lable size
    visual_style["vertex_label_size"] = lsize

    # Don't curve the edges
    visual_style["edge_curved"] = False

    # Set the layout
    my_layout = assembly_graph.layout_fruchterman_reingold()
    visual_style["layout"] = my_layout

    # Plot the graph
    draw_graph_with_matplotlib(
        assembly_graph,
        initial_out_fig_name,
        visual_style,
        dpi=dpi,
        width=width,
        height=height,
    )

    # Get the final GraphBin binning result
    # ---------------------------------------

    bins = [[] for x in range(n_bins)]

    with open(final_binning_result, mode="r") as contig_bins:
        readCSV = csv.reader(contig_bins, delimiter=delimiter)
        for row in readCSV:
            if row[1] != "unbinned":
                bin_num = bins_list.index(row[1])

                start = "NODE_"
                end = "_length_"
                contig_num = contigs_map_rev[
                    int(re.search("%s(.*)%s" % (start, end), row[0]).group(1))
                ]

                bins[bin_num].append(contig_num)

    for i in range(n_bins):
        bins[i].sort()


    # Visualise the final assembly graph
    # ------------------------------------

    final_out_fig_name = final_out_fig_name = (
        f"{output_path}{prefix}final_GraphBin_binning_result.{image_type}"
    )

    node_colours = []

    for i in range(node_count):
        no_bin = True
        for j in range(n_bins):
            if i in bins[j]:
                node_colours.append(my_colours[j])
                no_bin = False

        if no_bin:
            node_colours.append("white")

    assembly_graph.vs["color"] = node_colours

    visual_style = {}

    # Set bbox and margin
    visual_style["bbox"] = (width, height)
    visual_style["margin"] = margin

    # Set vertex size
    visual_style["vertex_size"] = vsize

    # Set vertex lable size
    visual_style["vertex_label_size"] = lsize

    # Don't curve the edges
    visual_style["edge_curved"] = False

    # Set the layout
    visual_style["layout"] = my_layout

    # Plot the graph
    draw_graph_with_matplotlib(
        assembly_graph,
        final_out_fig_name,
        visual_style,
        dpi=args.dpi,
        width=args.width,
        height=args.height,
    )