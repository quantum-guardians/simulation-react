import pytest

import solver_service
from graph_builder import build_mr2s_graph
from schemas import GraphEdge, GraphNode, GraphPayload

mr2s_module = pytest.importorskip("mr2s_module")


def _triangle():
    payload = GraphPayload(
        nodes=[GraphNode(id=n) for n in ["A", "B", "C"]],
        edges=[
            GraphEdge(id="e1", source="A", target="B", weight=1.0),
            GraphEdge(id="e2", source="B", target="C", weight=1.0),
            GraphEdge(id="e3", source="A", target="C", weight=1.0),
        ],
    )
    return build_mr2s_graph(payload)


def test_robbin_orients_triangle_fully():
    built = _triangle()
    solution = solver_service.run_orient_solver("robbin", built, {})
    assert len(solution.edges) == 3
    assert solution.score.strong_connect_rate == 1.0


def test_unknown_solver_raises_value_error():
    built = _triangle()
    with pytest.raises(ValueError, match="unknown solver type"):
        solver_service.run_orient_solver("not-a-real-solver", built, {})


def test_irrelevant_option_keys_are_filtered_out():
    built = _triangle()
    # max_iter only makes sense for "ils"; passing it for "robbin" must not
    # raise TypeError, since ALLOWED_OPTION_KEYS["robbin"] is empty and the
    # key should be silently dropped before the factory call.
    solution = solver_service.run_orient_solver(
        "robbin", built, {"max_iter": 999, "patience": 5}
    )
    assert len(solution.edges) == 3


def test_sanitize_score_converts_inf_to_none():
    class FakeScore:
        apsp_sum = float("inf")
        strong_connect_rate = 0.0
        flow_score = 1.0
        sample_score = 0.0

    cleaned = solver_service.sanitize_score(FakeScore())
    assert cleaned["apsp_sum"] is None
    assert cleaned["strong_connect_rate"] == 0.0


def test_sanitize_score_handles_none():
    assert solver_service.sanitize_score(None) is None
