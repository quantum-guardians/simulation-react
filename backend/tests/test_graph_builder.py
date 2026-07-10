import pytest

from graph_builder import build_mr2s_graph, detect_bridge_edge_ids
from schemas import GraphEdge, GraphNode, GraphPayload

mr2s_module = pytest.importorskip("mr2s_module")


def _payload(node_ids, edge_tuples):
    return GraphPayload(
        nodes=[GraphNode(id=n) for n in node_ids],
        edges=[
            GraphEdge(id=eid, source=s, target=t, weight=w)
            for eid, s, t, w in edge_tuples
        ],
    )


def test_id_round_trip():
    payload = _payload(
        ["A", "B", "C"],
        [("e1", "A", "B", 1.0), ("e2", "B", "C", 1.0), ("e3", "A", "C", 1.0)],
    )
    built = build_mr2s_graph(payload)
    for node_id, vertex in built.id_to_vertex.items():
        assert built.vertex_to_id[vertex] == node_id


def test_rejects_undeclared_node_reference():
    payload = _payload(["A", "B"], [("e1", "A", "Z", 1.0)])
    with pytest.raises(ValueError, match="undeclared node"):
        build_mr2s_graph(payload)


def test_rejects_self_loop():
    payload = _payload(["A", "B"], [("e1", "A", "A", 1.0)])
    with pytest.raises(ValueError, match="self-loop"):
        build_mr2s_graph(payload)


def test_rejects_duplicate_edge_id():
    payload = _payload(["A", "B", "C"], [("e1", "A", "B", 1.0), ("e1", "B", "C", 1.0)])
    with pytest.raises(ValueError, match="duplicate edge id"):
        build_mr2s_graph(payload)


def test_rejects_duplicate_vertex_pair():
    payload = _payload(["A", "B"], [("e1", "A", "B", 1.0), ("e2", "A", "B", 2.0)])
    with pytest.raises(ValueError, match="duplicates the vertex pair"):
        build_mr2s_graph(payload)


def test_rejects_empty_edge_list():
    payload = _payload(["A", "B"], [])
    with pytest.raises(ValueError, match="at least one edge"):
        build_mr2s_graph(payload)


def test_detect_bridges_on_path_graph():
    payload = _payload(["A", "B", "C"], [("e1", "A", "B", 1.0), ("e2", "B", "C", 1.0)])
    built = build_mr2s_graph(payload)
    bridges = detect_bridge_edge_ids(built)
    assert set(bridges) == {"e1", "e2"}


def test_no_bridges_on_triangle():
    payload = _payload(
        ["A", "B", "C"],
        [("e1", "A", "B", 1.0), ("e2", "B", "C", 1.0), ("e3", "A", "C", 1.0)],
    )
    built = build_mr2s_graph(payload)
    assert detect_bridge_edge_ids(built) == []
