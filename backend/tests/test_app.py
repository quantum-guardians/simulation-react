import json

import pytest
from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def _triangle_payload(solver="robbin"):
    return {
        "solver": solver,
        "graph": {
            "nodes": [{"id": "A"}, {"id": "B"}, {"id": "C"}],
            "edges": [
                {"id": "e1", "source": "A", "target": "B", "weight": 1.0},
                {"id": "e2", "source": "B", "target": "C", "weight": 1.0},
                {"id": "e3", "source": "A", "target": "C", "weight": 1.0},
            ],
        },
    }


def _bridge_path_payload(solver="robbin"):
    return {
        "solver": solver,
        "graph": {
            "nodes": [{"id": "A"}, {"id": "B"}, {"id": "C"}],
            "edges": [
                {"id": "e1", "source": "A", "target": "B", "weight": 1.0},
                {"id": "e2", "source": "B", "target": "C", "weight": 1.0},
            ],
        },
    }


def test_health_returns_200_regardless_of_module_availability():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert isinstance(body["moduleAvailable"], bool)


def test_triangle_robbin_orients_cleanly():
    pytest.importorskip("mr2s_module")
    resp = client.post("/api/solve/orient", json=_triangle_payload("robbin"))
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["solution"]["orientedEdges"]) == 3
    assert body["warnings"] == []
    assert body["bridgeDetected"] is False


def test_bridge_robbin_returns_200_not_500():
    pytest.importorskip("mr2s_module")
    resp = client.post("/api/solve/orient", json=_bridge_path_payload("robbin"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["bridgeDetected"] is True
    assert body["solution"]["orientedEdges"] == []
    assert any("bridge" in w.lower() for w in body["warnings"])


def test_bridge_sa_still_orients_all_edges():
    pytest.importorskip("mr2s_module")
    resp = client.post("/api/solve/orient", json=_bridge_path_payload("sa"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["bridgeDetected"] is True
    assert len(body["solution"]["orientedEdges"]) == 2


def test_invalid_graph_returns_400():
    payload = _triangle_payload("robbin")
    payload["graph"]["edges"][0]["source"] = "does-not-exist"
    resp = client.post("/api/solve/orient", json=payload)
    assert resp.status_code == 400


def test_inf_score_serializes_as_json_null():
    pytest.importorskip("mr2s_module")
    resp = client.post("/api/solve/orient", json=_bridge_path_payload("sa"))
    assert resp.status_code == 200
    # If apsp_sum were the raw float('inf'), Python's json would have emitted
    # the bare token `Infinity`, which json.loads still accepts by default,
    # so assert on the raw response text instead of the parsed body to
    # actually catch a regression back to unsanitized infinities.
    assert "Infinity" not in resp.text
    score = resp.json()["solution"]["score"]
    assert score["apsp_sum"] is None
