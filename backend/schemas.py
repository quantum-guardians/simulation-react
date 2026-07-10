from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

NodeId = str
EdgeId = str

SolverType = Literal[
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
]


class GraphNode(BaseModel):
    id: NodeId


class GraphEdge(BaseModel):
    id: EdgeId
    source: NodeId
    target: NodeId
    weight: float = 1.0


class GraphPayload(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class SolveOrientOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")

    max_iter: Optional[int] = None
    patience: Optional[int] = None
    is_relaxed: Optional[bool] = None
    perturb_strength: Optional[int] = None
    sweeps_per_temperature: Optional[int] = None
    num_restarts: Optional[int] = None
    random_seed: Optional[int] = None
    apsp_weight: Optional[float] = None
    flow_weight: Optional[float] = None
    disconnected_pair_penalty: Optional[float] = None
    max_vertices: Optional[int] = None


class SolveOrientRequest(BaseModel):
    solver: SolverType
    graph: GraphPayload
    options: SolveOrientOptions = SolveOrientOptions()


class OrientedEdgeDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    edgeId: EdgeId
    from_: NodeId = Field(alias="from")
    to: NodeId


class ScoreDto(BaseModel):
    apsp_sum: Optional[float] = None
    strong_connect_rate: Optional[float] = None
    flow_score: Optional[float] = None
    sample_score: Optional[float] = None


class SolutionDto(BaseModel):
    orientedEdges: list[OrientedEdgeDto]
    score: Optional[ScoreDto] = None
    unorientedEdgeIds: list[EdgeId] = Field(default_factory=list)


class SolveOrientResponse(BaseModel):
    solution: SolutionDto
    warnings: list[str] = Field(default_factory=list)
    bridgeDetected: bool = False
    bridgeEdgeIds: list[EdgeId] = Field(default_factory=list)


class HealthResponse(BaseModel):
    ok: bool
    module: str = "mr2s_module"
    moduleAvailable: bool
    version: str = "dev"


class SolverInfo(BaseModel):
    key: SolverType
    label: str
    available: bool
    reason: Optional[str] = None


class SolversResponse(BaseModel):
    solvers: list[SolverInfo]


class PartitionRequest(BaseModel):
    strategy: Literal["face-cluster"] = "face-cluster"
    graph: GraphPayload
    target_k: Optional[int] = None


class PartitionInfo(BaseModel):
    id: str
    nodeIds: list[NodeId]
    edgeIds: list[EdgeId]


class PartitionResponse(BaseModel):
    partitions: list[PartitionInfo]
    boundaryEdges: list[EdgeId] = Field(default_factory=list)
