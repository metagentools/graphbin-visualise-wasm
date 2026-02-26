#!/usr/bin/env python3

import csv
import logging
import os

from igraph import *

from bidictmap import BidirectionalMap


__author__ = "Vijini Mallawaarachchi"
__copyright__ = "Copyright 2019-2022, GraphBin Project"
__credits__ = ["Vijini Mallawaarachchi", "Anuradha Wickramarachchi", "Yu Lin"]
__license__ = "BSD-3"
__version__ = "1.7.4"
__maintainer__ = "Vijini Mallawaarachchi"
__email__ = "viji.mallawaarachchi@gmail.com"
__status__ = "Production"


logger = logging.getLogger(f"GraphBin {__version__}")


def _minimal_fasta_parser(path):
    header = None
    seq_parts = []

    def flush():
        nonlocal header, seq_parts
        if header is None:
            return
        seq = "".join(seq_parts).replace(" ", "").replace("\t", "")
        yield header, seq
        header = None
        seq_parts = []

    with open(path, "r", encoding="utf-8", errors="ignore") as handle:
        for raw in handle:
            line = raw.strip()
            if not line:
                continue
            if line.startswith(">"):
                yield from flush()
                header = line[1:].strip()
                seq_parts = []
            else:
                seq_parts.append(line)
        if header is not None:
            yield from flush()


def get_initial_binning_result(
    n_bins,
    bins_list,
    contig_bins_file,
    contigs_map_rev,
    graph_to_contig_map_rev,
    delimiter,
):
    logger.info("Obtaining the initial binning result")

    bins = [[] for x in range(n_bins)]
    missing_contig_ids = []
    max_examples = 5

    try:
        with open(contig_bins_file) as contig_bins:
            readCSV = csv.reader(contig_bins, delimiter=delimiter)
            for row in readCSV:
                if not row or len(row) < 2:
                    continue

                contig_name = row[0].strip()
                bin_name = row[1].strip()

                if contig_name not in graph_to_contig_map_rev:
                    if len(missing_contig_ids) < max_examples:
                        missing_contig_ids.append(contig_name)
                    continue

                graph_contig_num = graph_to_contig_map_rev[contig_name]
                if graph_contig_num not in contigs_map_rev:
                    if len(missing_contig_ids) < max_examples:
                        missing_contig_ids.append(contig_name)
                    continue

                contig_num = contigs_map_rev[graph_contig_num]

                bin_num = bins_list.index(bin_name)
                bins[bin_num].append(contig_num)

        if missing_contig_ids:
            examples = ", ".join(missing_contig_ids)
            msg = (
                "Input mismatch: some contig IDs in the initial binning result were not found "
                "in the provided MEGAHIT contigs/GFA mapping. "
                f"Example IDs: {examples}. Please check inputs."
            )
            logger.error(msg)
            raise RuntimeError(msg)

    except BaseException as err:
        if isinstance(err, RuntimeError):
            raise
        logger.error(f"Unexpected {err}")
        logger.error(
            "Please make sure that you have provided the correct assembler type and the correct path to the binning result file in the correct format."
        )
        logger.info("Exiting GraphBin... Bye...!")
        raise RuntimeError("Failed to read initial binning result.")

    return bins


def parse_graph(assembly_graph_file, original_contigs):
    node_count = 0

    graph_contigs = {}

    links = []

    my_map = BidirectionalMap()

    try:
        # Get links from .gfa file
        with open(assembly_graph_file) as file:
            for line in file.readlines():
                line = line.strip()

                # Identify lines with link information
                if line.startswith("L"):
                    link = []

                    strings = line.split("\t")

                    link1 = strings[1]
                    link2 = strings[3]

                    link.append(link1)
                    link.append(link2)
                    links.append(link)

                elif line.startswith("S"):
                    strings = line.split()
                    contig_num = strings[1]

                    my_map[node_count] = contig_num

                    graph_contigs[contig_num] = strings[2]

                    node_count += 1

        logger.info(f"Total number of contigs available: {node_count}")

        contigs_map = my_map
        contigs_map_rev = my_map.inverse

        # Create graph
        assembly_graph = Graph()

        # Add vertices
        assembly_graph.add_vertices(node_count)

        # Create list of edges
        edge_list = []

        for i in range(node_count):
            assembly_graph.vs[i]["id"] = i
            assembly_graph.vs[i]["label"] = str(contigs_map[i])

        # Iterate links
        for link in links:
            # Remove self loops
            if link[0] != link[1]:
                # Add edge to list of edges
                    edge_list.append((contigs_map_rev[link[0]], contigs_map_rev[link[1]]))

        # Add edges to the graph
        assembly_graph.add_edges(edge_list)
        assembly_graph.simplify(multiple=True, loops=False, combine_edges=None)

    except BaseException as err:
        logger.error(f"Unexpected {err}")
        logger.error(
            "Please make sure that the correct path to the assembly graph file is provided."
        )
        logger.info("Exiting GraphBin... Bye...!")
        raise RuntimeError("Failed to parse assembly graph.")

    logger.info(f"Total number of edges in the assembly graph: {len(edge_list)}")

    # Map original contig IDs to contig IDS of assembly graph
    # --------------------------------------------------------

    graph_to_contig_map = BidirectionalMap()

    for (n, m), (n2, m2) in zip(graph_contigs.items(), original_contigs.items()):
        if m == m2:
            graph_to_contig_map[n] = n2

    return assembly_graph, graph_to_contig_map, contigs_map, node_count


def write_output(
    output_path,
    prefix,
    final_bins,
    contigs_file,
    graph_to_contig_map,
    bins,
    contigs_map,
    bins_list,
    delimiter,
    node_count,
    remove_labels,
    non_isolated,
):
    logger.info("Writing the Final Binning result to file")

    output_bins = []
    graph_to_contig_map_rev = graph_to_contig_map.inverse
    contigs_map_rev = contigs_map.inverse

    output_bins_path = f"{output_path}{prefix}bins/"
    output_file = f"{output_path}{prefix}graphbin_output.csv"

    os.makedirs(output_bins_path, exist_ok=True)

    bin_files = {}

    for bin_name in set(final_bins.values()):
        bin_files[bin_name] = open(
            f"{output_bins_path}{prefix}bin_{bin_name}.fasta", "w+"
        )

    for label, seq in _minimal_fasta_parser(contigs_file):
        label_name = label.split()[0]
        if label_name not in graph_to_contig_map_rev:
            continue
        contig_num = contigs_map_rev[graph_to_contig_map_rev[label_name]]

        if contig_num in final_bins:
            bin_files[final_bins[contig_num]].write(f">{label_name}\n{seq}\n")

    # Close output files
    for c in set(final_bins.values()):
        bin_files[c].close()

    for b in range(len(bins)):
        for contig in bins[b]:
            line = []
            line.append(graph_to_contig_map[contigs_map[contig]])
            line.append(bins_list[b])
            output_bins.append(line)

    with open(output_file, mode="w") as out_file:
        output_writer = csv.writer(
            out_file, delimiter=delimiter, quotechar='"', quoting=csv.QUOTE_MINIMAL
        )
        for row in output_bins:
            output_writer.writerow(row)

    logger.info(f"Final binning results can be found in {output_bins_path}")

    unbinned_contigs = []

    for i in range(node_count):
        if i in remove_labels or i not in non_isolated:
            line = []
            line.append(graph_to_contig_map[contigs_map[i]])
            unbinned_contigs.append(line)

    if len(unbinned_contigs) != 0:
        unbinned_file = f"{output_path}{prefix}graphbin_unbinned.csv"

        with open(unbinned_file, mode="w") as out_file:
            output_writer = csv.writer(
                out_file, delimiter=delimiter, quotechar='"', quoting=csv.QUOTE_MINIMAL
            )

            for row in unbinned_contigs:
                output_writer.writerow(row)

        logger.info(f"Unbinned contigs can be found at {unbinned_file}")


def get_contig_descriptors(contigs_file):
    original_contigs = {}

    for label, seq in _minimal_fasta_parser(contigs_file):
        name = label.split()[0]
        original_contigs[name] = seq

    return original_contigs
