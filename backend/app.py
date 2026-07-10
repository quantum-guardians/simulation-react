import graph_builder
import solver_service
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from schemas import (
    HealthResponse,
    OrientedEdgeDto,
    SolutionDto,
    SolveOrientRequest,
    SolveOrientResponse,
    SolverInfo,
    SolversResponse,
)

app = FastAPI(title="MR2S Corridor Simulation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    try:
        import mr2s_module  # noqa: F401

        module_available = True
    except ImportError:
        module_available = False
    return HealthResponse(ok=True, moduleAvailable=module_available)


@app.get("/api/solve/solvers", response_model=SolversResponse)
async def list_solvers() -> SolversResponse:
    solvers = []
    for key, label in solver_service.SOLVER_LABELS.items():
        available, reason = solver_service.probe_solver_availability(key)
        solvers.append(SolverInfo(key=key, label=label, available=available, reason=reason))
    return SolversResponse(solvers=solvers)


@app.post("/api/solve/orient", response_model=SolveOrientResponse)
async def solve_orient(req: SolveOrientRequest) -> SolveOrientResponse:
    try:
        built = graph_builder.build_mr2s_graph(req.graph)
    except ImportError:
        raise HTTPException(500, "mr2s_module is not installed on the server")
    except ValueError as e:
        raise HTTPException(400, f"invalid graph: {e}")

    try:
        bridge_edge_ids = graph_builder.detect_bridge_edge_ids(built)
    except ImportError:
        raise HTTPException(500, "mr2s_module is not installed on the server")

    warnings: list[str] = []
    if bridge_edge_ids:
        warnings.append(
            f"{len(bridge_edge_ids)} bridge edge(s) detected; a bridge can never "
            "be part of a directed cycle, so no solver can produce a strongly "
            "connected orientation while they remain in the graph."
        )

    if req.solver == "robbin" and bridge_edge_ids:
        warnings.append(
            "Robbin cannot orient a graph containing bridges and would raise "
            "an error; returning the graph unoriented instead. Choose 'ils', "
            "'sa', or a qubo/dnc solver to still get an orientation."
        )
        return SolveOrientResponse(
            solution=SolutionDto(
                orientedEdges=[],
                score=None,
                unorientedEdgeIds=list(built.pair_to_edge_id.values()),
            ),
            warnings=warnings,
            bridgeDetected=True,
            bridgeEdgeIds=bridge_edge_ids,
        )

    try:
        solution = solver_service.run_orient_solver(
            req.solver, built, req.options.model_dump()
        )
    except ImportError:
        raise HTTPException(500, "mr2s_module is not installed on the server")
    except ValueError as e:
        raise HTTPException(400, f"solver error: {e}")
    except RuntimeError as e:
        raise HTTPException(400, f"solver unavailable: {e}")
    except Exception as e:  # noqa: BLE001 - surfaced to the client, not silently swallowed
        raise HTTPException(500, f"solver failed: {e}")

    oriented = [
        OrientedEdgeDto(
            edgeId=built.pair_to_edge_id[frozenset({u, v})],
            **{"from": built.vertex_to_id[u], "to": built.vertex_to_id[v]},
        )
        for (u, v) in solution.edges
    ]
    return SolveOrientResponse(
        solution=SolutionDto(
            orientedEdges=oriented,
            score=solver_service.sanitize_score(solution.score),
        ),
        warnings=warnings,
        bridgeDetected=bool(bridge_edge_ids),
        bridgeEdgeIds=bridge_edge_ids,
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
