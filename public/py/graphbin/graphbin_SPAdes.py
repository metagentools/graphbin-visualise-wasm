#!/usr/bin/env python3

"""graphbin_SPAdes.py: Refined binning of metagenomic contigs using SPAdes assembly graphs.

GraphBin is a metagenomic contig binning tool that makes use of the contig 
connectivity information from the assembly graph to bin contigs. It utilizes 
the binning result of an existing binning tool and a label propagation algorithm 
to correct mis-binned contigs and predict the labels of contigs which are 
discarded due to short length.

graphbin_SPAdes.py makes use of the assembly graphs produced by SPAdes.
"""

import logging
import time

try:
    import js  # type: ignore
except Exception:
    js = None

from graphbin_Func import graphbin_main
from parsers import get_initial_bin_count
from parsers.spades_parser import (
    get_initial_binning_result,
    parse_graph,
    write_output,
)


__author__ = "Vijini Mallawaarachchi"
__copyright__ = "Copyright 2019-2022, GraphBin Project"
__credits__ = ["Vijini Mallawaarachchi", "Anuradha Wickramarachchi", "Yu Lin"]
__license__ = "BSD-3"
__version__ = "1.7.4"
__maintainer__ = "Vijini Mallawaarachchi"
__email__ = "viji.mallawaarachchi@gmail.com"
__status__ = "Production"


def run(args):
    start_time = time.time()

    assembly_graph_file = args.graph
    contigs_file = args.contigs
    contig_paths = args.paths
    contig_bins_file = args.binned
    output_path = args.output
    prefix = args.prefix
    delimiter = args.delimiter
    max_iteration = args.max_iteration
    diff_threshold = args.diff_threshold
    min_bin_size = getattr(args, "min_bin_size", 5)
    show_lp_log = getattr(args, "show_lp_log", False)

    # Setup logger
    logger = logging.getLogger(f"GraphBin {__version__}")
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

    if logger.handlers:
        for h in list(logger.handlers):
            logger.removeHandler(h)

    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")

    consoleHeader = logging.StreamHandler()
    consoleHeader.setFormatter(formatter)
    consoleHeader.setLevel(logging.INFO)
    logger.addHandler(consoleHeader)

    fileHandler = logging.FileHandler(f"{output_path}{prefix}graphbin.log")
    fileHandler.setLevel(logging.DEBUG)
    fileHandler.setFormatter(formatter)
    logger.addHandler(fileHandler)

    if js is not None and hasattr(js, "graphbinLog"):
        class _JsLogHandler(logging.Handler):
            def emit(self, record):
                try:
                    msg = self.format(record)
                    js.graphbinLog(msg)
                except Exception:
                    pass

        js_handler = _JsLogHandler()
        js_handler.setLevel(logging.INFO)
        js_handler.setFormatter(formatter)
        logger.addHandler(js_handler)

    logger.info(
        "Welcome to GraphBin: Refined Binning of Metagenomic Contigs using Assembly Graphs."
    )
    logger.info(
        "This version of GraphBin makes use of the assembly graph produced by SPAdes which is based on the de Bruijn graph approach."
    )

    logger.info("Input arguments:")
    logger.info(f"Assembly graph file: {assembly_graph_file}")
    logger.info(f"Contig paths file: {contig_paths}")
    logger.info(f"Existing binning output file: {contig_bins_file}")
    logger.info(f"Final binning output file: {output_path}")
    logger.info(f"Maximum number of iterations: {max_iteration}")
    logger.info(f"Difference threshold: {diff_threshold}")
    logger.info(f"Minimum bin size: {min_bin_size}")
    logger.info(f"Show label propagation log: {show_lp_log}")

    logger.info("GraphBin started")

    def _is_unbinned(value):
        if value is None:
            return True
        s = str(value).strip()
        if s == "":
            return True
        return s.lower() == "unbinned"

    # Get the number of bins from the initial binning result
    # ---------------------------------------------------

    n_bins, bins_list = get_initial_bin_count(contig_bins_file, delimiter)

    # Get assembly graph
    # --------------------

    assembly_graph, contigs_map, contig_names, node_count = parse_graph(
        assembly_graph_file, contig_paths
    )

    # Get initial binning result
    # ----------------------------

    bins = get_initial_binning_result(
        n_bins, bins_list, contig_bins_file, contigs_map.inverse, delimiter
    )

    initial_bin_by_contig = {}
    for idx, contigs in enumerate(bins):
        label = bins_list[idx]
        for contig in contigs:
            initial_bin_by_contig[contig] = label

    # Run GraphBin logic
    # -------------------------------------

    final_bins, remove_labels, non_isolated, _lp_misbinned, ambiguous = graphbin_main(
        n_bins,
        bins,
        bins_list,
        assembly_graph,
        node_count,
        diff_threshold,
        max_iteration,
        min_bin_size,
        show_lp_log,
    )

    elapsed_time = time.time() - start_time

    # Print elapsed time for the process
    logger.info(f"Elapsed time: {elapsed_time} seconds")

    # Write misbinned contigs (changed bin between initial and final)
    misbinned = []
    for contig, init_label in initial_bin_by_contig.items():
        if _is_unbinned(init_label):
            continue
        final_label = final_bins.get(contig)
        if _is_unbinned(final_label):
            continue
        if final_label != init_label:
            misbinned.append(contig)

    misbinned_path = f"{output_path}{prefix}graphbin_misbinned.csv"
    try:
        with open(misbinned_path, "w", encoding="utf-8") as f:
            for contig in sorted(set(misbinned)):
                f.write(f"{contig_names[contig]}\n")
        logger.info(f"Misbinned contigs can be found at {misbinned_path}")
    except Exception as err:
        logger.warning(f"Failed to write misbinned contigs file: {err}")

    # Write ambiguous contigs (>=2 labelled neighbours in different bins, not misbinned)
    ambiguous_path = f"{output_path}{prefix}graphbin_ambiguous.csv"
    try:
        with open(ambiguous_path, "w", encoding="utf-8") as f:
            for contig in sorted(set(ambiguous)):
                f.write(f"{contig_names[contig]}\n")
        logger.info(f"Ambiguous contigs can be found at {ambiguous_path}")
    except Exception as err:
        logger.warning(f"Failed to write ambiguous contigs file: {err}")

    # Write result to output file
    # -----------------------------

    write_output(
        output_path,
        prefix,
        final_bins,
        contigs_file,
        contig_names.inverse,
        bins,
        contig_names,
        bins_list,
        delimiter,
        node_count,
        remove_labels,
        non_isolated,
    )


def main(args):
    run(args)


if __name__ == "__main__":
    main()
