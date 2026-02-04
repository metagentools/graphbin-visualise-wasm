# py/interactive_export.py
import csv
import json
import re
from collections import defaultdict
from types import SimpleNamespace

from igraph import Graph
from bidictmap import BidirectionalMap

# IMPORTANT: reuse the exact colour generator used by spades_plot.py
from spades_plot import generate_distinct_colours


# -----------------------------
# helpers copied/aligned from spades_plot.py
# -----------------------------

def _rev_orient(seg: str) -> str:
    if seg.endswith("+"):
        return seg[:-1] + "-"
    if seg.endswith("-"):
        return seg[:-1] + "+"
    return seg


def _extract_contig_num(label: str) -> int:
    """
    Matches spades_plot.py logic:
    NODE_<num>_length_...
    """
    m = re.search(r"NODE_(.*)_length_", label)
    if not m:
        raise ValueError(f"Could not parse contig number from {label}")
    return int(m.group(1))


def _read_paths(contig_paths_file):
    paths = {}
    segment_contigs = {}
    node_count = 0
    contigs_map = BidirectionalMap()
    current_contig = ""

    with open(contig_paths_file, "r", encoding="utf-8", errors="ignore") as f:
        name = f.readline()
        path = f.readline()

        while name != "\n" and path != "":
            while ";" in path:
                path = path[:-2] + "," + f.readline()

            contig_num = str(_extract_contig_num(name))

            segments = path.rstrip().split(",")

            if current_contig != contig_num:
                contigs_map[node_count] = int(contig_num)
                current_contig = contig_num
                node_count += 1

            if contig_num not in paths:
                paths[contig_num] = [segments[0], segments[-1]]

            for seg in segments:
                segment_contigs.setdefault(seg, set()).add(contig_num)

            name = f.readline()
            path = f.readline()

    return node_count, contigs_map, contigs_map.inverse, paths, segment_contigs


def _read_links_map(gfa_file):
    links_map = defaultdict(set)
    with open(gfa_file, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith("L"):
                parts = line.strip().split("\t")
                if len(parts) >= 5:
                    f1 = parts[1] + parts[2]
                    f2 = parts[3] + parts[4]
                    links_map[f1].add(f2)
                    links_map[f2].add(f1)
    return links_map


def _build_graph(node_count, contigs_map, contigs_map_rev,
                 paths, segment_contigs, links_map):

    g = Graph()
    g.add_vertices(node_count)

    for i in range(node_count):
        g.vs[i]["label"] = "NODE_" + str(contigs_map[i])

    edges = []

    for i in range(len(paths)):
        contig_num = str(contigs_map[i])
        segs = paths.get(contig_num)
        if not segs:
            continue

        start, end = segs
        start_r = _rev_orient(start)
        end_r = _rev_orient(end)

        neighbours = []
        for s in (start, start_r, end, end_r):
            neighbours.extend(list(links_map.get(s, [])))

        for nb in neighbours:
            if nb in segment_contigs:
                for other in segment_contigs[nb]:
                    j = contigs_map_rev[int(other)]
                    if i != j:
                        edges.append((i, j))

    g.add_edges(edges)
    g.simplify(multiple=True, loops=False)
    return g


def _read_binning(path, delimiter, contigs_map_rev):
    bins = {}
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        reader = csv.reader(f, delimiter=delimiter)
        for row in reader:
            if not row or len(row) < 2:
                continue
            try:
                contig_num = _extract_contig_num(row[0])
            except Exception:
                continue
            bins[contigs_map_rev[int(contig_num)]] = row[1]
    return bins


def _read_fasta_len_gc(contigs_fasta, contigs_map_rev):
    lengths = {}
    gcs = {}
    covs = {}

    name = None
    seq = []

    def flush():
        nonlocal name, seq
        if name is None:
            return
        try:
            contig_num = _extract_contig_num(name)
            v = contigs_map_rev[int(contig_num)]
        except Exception:
            name, seq = None, []
            return

        # parse coverage from header like: NODE_1_length_..._cov_16.379288
        m = re.search(r"_cov_([0-9eE.+-]+)", name)
        covs[v] = float(m.group(1)) if m else None

        s = "".join(seq).upper()
        L = len(s)
        lengths[v] = L
        gcs[v] = None if L == 0 else 100.0 * (s.count("G") + s.count("C")) / L

        name, seq = None, []

    with open(contigs_fasta, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if line.startswith(">"):
                flush()
                name = line[1:]
                seq = []
            else:
                seq.append(line)
    flush()

    return lengths, gcs, covs



# -----------------------------
# MAIN EXPORT FUNCTION
# -----------------------------

def export(args_ns: SimpleNamespace, out_json="/out/interactive_graph.json"):
    gfa = args_ns.graph
    paths_file = args_ns.paths
    contigs_fasta = args_ns.contigs
    initial_path = args_ns.initial
    final_path = args_ns.final
    delimiter = args_ns.delimiter

    # graph construction (identical to spades_plot.py)
    node_count, contigs_map, contigs_map_rev, paths, segment_contigs = _read_paths(paths_file)
    links_map = _read_links_map(gfa)
    g = _build_graph(node_count, contigs_map, contigs_map_rev,
                     paths, segment_contigs, links_map)

    # bins
    initial_bins = _read_binning(initial_path, delimiter, contigs_map_rev)
    final_bins = _read_binning(final_path, delimiter, contigs_map_rev)

    # lengths + GC + coverage
    lengths, gcs, covs = _read_fasta_len_gc(contigs_fasta, contigs_map_rev)

    # layout (same algorithm)
    layout = g.layout_fruchterman_reingold()
    deg = g.degree()

    # --- EXACT SAME BIN COLOURS AS PNG PLOTS ---
    all_bins = []
    with open(initial_path, "r", encoding="utf-8", errors="ignore") as f:
        reader = csv.reader(f, delimiter=delimiter)
        for row in reader:
            if row and len(row) >= 2:
                all_bins.append(row[1])

    bins_list = sorted(set(all_bins))
    colours = generate_distinct_colours(len(bins_list))
    bin_colors = {bins_list[i]: colours[i] for i in range(len(bins_list))}

    # nodes
    nodes = []
    for v in range(node_count):
        node_id = "NODE_" + str(contigs_map[v])
        init_bin = initial_bins.get(v)
        fin_bin = final_bins.get(v)

        nodes.append({
            "id": node_id,
            "x": float(layout.coords[v][0]),
            "y": float(layout.coords[v][1]),
            "len": int(lengths.get(v, 0)),
            "gc": float(gcs[v]) if v in gcs and gcs[v] is not None else None,
            "initial_bin": init_bin,
            "final_bin": fin_bin,
            "changed": init_bin != fin_bin,
            "degree": int(deg[v]),
            "cov": float(covs[v]) if v in covs and covs[v] is not None else None,
        })

    # edges (use NODE_ ids, not vertex indices)
    edges = [
        ["NODE_" + str(contigs_map[u]), "NODE_" + str(contigs_map[v])]
        for (u, v) in g.get_edgelist()
    ]

    out = {
        "nodes": nodes,
        "edges": edges,
        "bin_colors": bin_colors,        # EXACT match to PNG plots
        "unbinned_color": "#d3d3d3"         # same as spades_plot.py
    }

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(out, f)
