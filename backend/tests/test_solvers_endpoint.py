import pytest
from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_list_solvers_returns_all_ten_keys():
    resp = client.get("/api/solve/solvers")
    assert resp.status_code == 200
    keys = {s["key"] for s in resp.json()["solvers"]}
    assert keys == {
        "robbin",
        "ils",
        "sa",
        "qubo",
        "qubo_sa",
        "qubo_qa",
        "dnc_sa",
        "dnc_qubo",
        "dnc_qubo_sa",
        "dnc_qubo_qa",
    }


def test_qubo_qa_degrades_to_unavailable_without_dwave_credentials():
    pytest.importorskip("mr2s_module")
    resp = client.get("/api/solve/solvers")
    solvers = {s["key"]: s for s in resp.json()["solvers"]}
    # Absent D-Wave credentials in this environment/CI, qubo_qa must report
    # available=False with a reason rather than the endpoint crashing.
    assert solvers["qubo_qa"]["available"] is False
    assert solvers["qubo_qa"]["reason"]
