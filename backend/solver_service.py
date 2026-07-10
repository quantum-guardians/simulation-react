from typing import Any, Callable, Optional

from graph_builder import BuiltGraph

SOLVER_LABELS: dict[str, str] = {
    "robbin": "Robbin (fast, requires a 2-edge-connected graph)",
    "ils": "Iterated Local Search",
    "sa": "Simulated Annealing",
    "qubo": "QUBO (simulated-annealing backend, alias of qubo_sa)",
    "qubo_sa": "QUBO - Simulated Annealing",
    "qubo_qa": "QUBO - D-Wave Quantum Annealing",
    "dnc_sa": "Divide & Conquer - Simulated Annealing",
    "dnc_qubo": "Divide & Conquer - QUBO (alias of dnc_qubo_sa)",
    "dnc_qubo_sa": "Divide & Conquer - QUBO Simulated Annealing",
    "dnc_qubo_qa": "Divide & Conquer - QUBO D-Wave Quantum Annealing",
}

ALLOWED_OPTION_KEYS: dict[str, set[str]] = {
    "robbin": set(),
    "ils": {"max_iter", "patience", "is_relaxed", "perturb_strength"},
    "sa": {
        "sweeps_per_temperature",
        "num_restarts",
        "random_seed",
        "apsp_weight",
        "flow_weight",
        "disconnected_pair_penalty",
    },
    "qubo": set(),
    "qubo_sa": set(),
    "qubo_qa": set(),
    "dnc_sa": {
        "max_vertices",
        "sweeps_per_temperature",
        "num_restarts",
        "random_seed",
        "apsp_weight",
        "flow_weight",
        "disconnected_pair_penalty",
    },
    "dnc_qubo": {"max_vertices"},
    "dnc_qubo_sa": {"max_vertices"},
    "dnc_qubo_qa": {"max_vertices"},
}

# Solvers that take a keyword-only max_vertices/target_graph split; kept in
# one place so run_orient_solver doesn't need per-solver special casing
# beyond the keyword filtering already done via ALLOWED_OPTION_KEYS.


def get_solver_factories() -> dict[str, Callable[..., Any]]:
    from mr2s_module.solver.predefined import (
        create_dnc_qubo_qa_solver,
        create_dnc_qubo_sa_solver,
        create_dnc_qubo_solver,
        create_dnc_sa_solver,
        create_ils_solver,
        create_qubo_qa_solver,
        create_qubo_sa_solver,
        create_qubo_solver,
        create_robbin_solver,
        create_sa_solver,
    )

    return {
        "robbin": create_robbin_solver,
        "ils": create_ils_solver,
        "sa": create_sa_solver,
        "qubo": create_qubo_solver,
        "qubo_sa": create_qubo_sa_solver,
        "qubo_qa": create_qubo_qa_solver,
        "dnc_sa": create_dnc_sa_solver,
        "dnc_qubo": create_dnc_qubo_solver,
        "dnc_qubo_sa": create_dnc_qubo_sa_solver,
        "dnc_qubo_qa": create_dnc_qubo_qa_solver,
    }


def run_orient_solver(solver_type: str, built: BuiltGraph, options: dict[str, Any]) -> Any:
    """Build the requested solver and run it on built.graph, returning a Solution."""
    factories = get_solver_factories()
    if solver_type not in factories:
        raise ValueError(f"unknown solver type: {solver_type}")

    allowed = ALLOWED_OPTION_KEYS[solver_type]
    kwargs = {k: v for k, v in options.items() if k in allowed and v is not None}
    solver = factories[solver_type](**kwargs)
    return solver.run(built.graph)


def _clean_float(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    if value == float("inf") or value == float("-inf"):
        return None
    return value


def sanitize_score(score: Any) -> Optional[dict[str, Optional[float]]]:
    """Convert an mr2s_module Score into a JSON-safe dict.

    Score.apsp_sum can be float('inf') when the graph isn't strongly
    connected; Python's json module would emit the bare (invalid JSON)
    token `Infinity` for that, breaking JSON.parse in the browser, so we
    normalize inf/-inf to None here instead.
    """
    if score is None:
        return None
    return {
        "apsp_sum": _clean_float(score.apsp_sum),
        "strong_connect_rate": _clean_float(score.strong_connect_rate),
        "flow_score": _clean_float(score.flow_score),
        "sample_score": _clean_float(score.sample_score),
    }


def probe_solver_availability(solver_type: str) -> tuple[bool, Optional[str]]:
    """Try constructing (not running) a solver to check e.g. D-Wave creds.

    Used by GET /api/solve/solvers so the frontend can grey out solvers
    that would fail immediately (qubo_qa/dnc_qubo_qa without credentials)
    without needing to attempt a full solve first.
    """
    try:
        factories = get_solver_factories()
    except ImportError as e:
        return False, f"mr2s_module not installed: {e}"

    try:
        factories[solver_type]()
    except Exception as e:  # noqa: BLE001 - genuinely any construction failure disables the option
        return False, str(e)
    return True, None
