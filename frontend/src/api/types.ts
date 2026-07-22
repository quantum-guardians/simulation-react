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

/**
 * Solver keys double as the external mr2s-backend endpoint segments:
 * POST /api/v1/{solver}. See BACKEND_REFERENCE.md.
 */
export type SolverType = "mr2s" | "raw-sa" | "brute-force";

/** External wire format: one undirected weighted edge (vertices as ints). */
export interface WeightedEdgeDto {
  vertices: [number, number];
  weight: number;
}

export interface WeightedRequestDto {
  edges: WeightedEdgeDto[];
}

/** External wire format: solver response. `_from` avoids the JS reserved word. */
export interface V1ResponseDto {
  edges: { _from: number; to: number }[];
  optimized_graph_score: number;
  bidirectional_graph_score: number;
}

/**
 * Adapted score. The external API returns -1 for "not (strongly) connected";
 * the adapter maps that to null so the UI can't mistake it for a real sum.
 */
export interface OrientationScore {
  optimizedApsp: number | null;
  bidirectionalApsp: number | null;
  stronglyConnected: boolean;
}

/** What solveOrientation resolves to after adapting the v1 response. */
export interface SolveResult {
  orientedEdges: OrientedEdge[];
  score: OrientationScore;
  warnings: string[];
}

export interface HealthResponse {
  message: string;
}
