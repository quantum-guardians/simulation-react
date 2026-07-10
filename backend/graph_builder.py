from dataclasses import dataclass, field
from typing import Any

from schemas import GraphPayload


@dataclass
class BuiltGraph:
    graph: Any  # mr2s_module.domain.Graph
    id_to_vertex: dict[str, int]
    vertex_to_id: dict[int, str] = field(default_factory=dict)
    pair_to_edge_id: dict[frozenset, str] = field(default_factory=dict)


def build_mr2s_graph(payload: GraphPayload) -> BuiltGraph:
    """Convert a string-keyed GraphPayload into an mr2s_module.domain.Graph.

    mr2s_module vertices are plain ints with no geometry, so we map node ids
    to a dense 0..n-1 int range (sorted for determinism) and keep the
    reverse mapping to translate solver output back to our ids.
    """
    from mr2s_module.domain import Edge, Graph

    declared_ids = {n.id for n in payload.nodes}
    if not payload.edges:
        raise ValueError("graph must contain at least one edge")

    sorted_ids = sorted(declared_ids)
    id_to_vertex = {node_id: index for index, node_id in enumerate(sorted_ids)}
    vertex_to_id = {index: node_id for node_id, index in id_to_vertex.items()}

    pair_to_edge_id: dict[frozenset, str] = {}
    seen_edge_ids: set[str] = set()
    edges = []

    for e in payload.edges:
        if e.source not in declared_ids:
            raise ValueError(f"edge '{e.id}' references undeclared node '{e.source}'")
        if e.target not in declared_ids:
            raise ValueError(f"edge '{e.id}' references undeclared node '{e.target}'")
        if e.source == e.target:
            raise ValueError(f"edge '{e.id}' is a self-loop ('{e.source}')")
        if e.id in seen_edge_ids:
            raise ValueError(f"duplicate edge id '{e.id}'")
        seen_edge_ids.add(e.id)

        u, v = id_to_vertex[e.source], id_to_vertex[e.target]
        pair = frozenset({u, v})
        if pair in pair_to_edge_id:
            raise ValueError(
                f"edge '{e.id}' duplicates the vertex pair already used by "
                f"edge '{pair_to_edge_id[pair]}' ('{e.source}'-'{e.target}'); "
                "mr2s_module.Graph dedups edges by unordered vertex pair and "
                "would silently drop one of them"
            )
        pair_to_edge_id[pair] = e.id
        edges.append(Edge(u, v, max(e.weight, 0.01), False))

    graph = Graph(edges=edges)
    return BuiltGraph(
        graph=graph,
        id_to_vertex=id_to_vertex,
        vertex_to_id=vertex_to_id,
        pair_to_edge_id=pair_to_edge_id,
    )


def detect_bridge_edge_ids(built: BuiltGraph) -> list[str]:
    """Return the edgeIds of every bridge (cut-edge) in the graph.

    Robbin's edge-orientation algorithm cannot fully orient a graph that
    contains bridges (a bridge can never be part of a directed cycle), so
    callers use this to warn the user and/or short-circuit before invoking
    the robbin solver, which raises ValueError on such graphs.
    """
    import networkx as nx

    from mr2s_module.util import domain_graph_to_networkx

    nx_graph = domain_graph_to_networkx(built.graph)
    bridge_ids: list[str] = []
    for u, v in nx.bridges(nx_graph):
        pair = frozenset({u, v})
        edge_id = built.pair_to_edge_id.get(pair)
        if edge_id is not None:
            bridge_ids.append(edge_id)
    return bridge_ids
