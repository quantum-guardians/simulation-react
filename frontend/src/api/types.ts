export type NodeId = string;
export type EdgeId = string;

export interface GraphNode {
  id: NodeId;
}

export interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  weight: number;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface OrientedEdge {
  edgeId: EdgeId;
  from: NodeId;
  to: NodeId;
}

export interface ScorePayload {
  apsp_sum: number | null;
  strong_connect_rate: number | null;
  flow_score: number | null;
  sample_score: number | null;
}

export interface SolutionPayload {
  orientedEdges: OrientedEdge[];
  score: ScorePayload | null;
  unorientedEdgeIds: EdgeId[];
}

export type SolverType =
  | "robbin"
  | "ils"
  | "sa"
  | "qubo"
  | "qubo_sa"
  | "qubo_qa"
  | "dnc_sa"
  | "dnc_qubo"
  | "dnc_qubo_sa"
  | "dnc_qubo_qa";

export interface SolveOrientOptions {
  max_iter?: number;
  patience?: number;
  is_relaxed?: boolean;
  perturb_strength?: number;
  sweeps_per_temperature?: number;
  num_restarts?: number;
  random_seed?: number;
  apsp_weight?: number;
  flow_weight?: number;
  disconnected_pair_penalty?: number;
  max_vertices?: number;
}

export interface SolveOrientRequest {
  solver: SolverType;
  graph: GraphPayload;
  options?: SolveOrientOptions;
}

export interface SolveOrientResponse {
  solution: SolutionPayload;
  warnings: string[];
  bridgeDetected: boolean;
  bridgeEdgeIds: EdgeId[];
}

export interface HealthResponse {
  ok: boolean;
  module: string;
  moduleAvailable: boolean;
  version: string;
}

export interface SolverInfo {
  key: SolverType;
  label: string;
  available: boolean;
  reason: string | null;
}

export interface SolversResponse {
  solvers: SolverInfo[];
}
