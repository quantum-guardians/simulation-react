import type {
  GraphEdge,
  GraphPayload,
  HealthResponse,
  NodeId,
  OrientationScore,
  SolveResult,
  SolverType,
  V1ResponseDto,
  WeightedRequestDto,
} from "./types";

// Dev default "/mr2s-api" goes through the Vite proxy (vite.config.ts) because
// the external backend's CORS allowlist has no localhost origin. Production
// builds set VITE_API_BASE_URL to the deployed backend (must be hosted on an
// allowlisted origin).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/mr2s-api";

export class ApiError extends Error {
  /** HTTP status, or null when the request never reached the server. */
  status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError("backend unreachable - is the mr2s-backend up?", null);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body;
    try {
      detail = (JSON.parse(body) as { detail?: string }).detail ?? body;
    } catch {
      // non-JSON error body; keep raw text
    }
    throw new ApiError(describeHttpError(res.status, detail), res.status);
  }
  return res.json() as Promise<T>;
}

function describeHttpError(status: number, detail: string): string {
  if (status === 408) {
    return "solver timed out (10 s server limit) - try a smaller graph or a non-brute-force solver";
  }
  if (status === 400) {
    return detail || "invalid graph input";
  }
  if (status >= 500) {
    return `solver failed on the server${detail ? `: ${detail}` : ""}`;
  }
  return `request failed (${status})${detail ? `: ${detail}` : ""}`;
}

export function getHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>("/");
}

// ---------------------------------------------------------------------------
// Adapter: frontend graph (string node ids, edgeId "src--tgt")
//        ↔ external v1 wire format (1-based integer vertices)
// ---------------------------------------------------------------------------

export interface VertexMapping {
  toInt: Map<NodeId, number>;
  /** toId[i - 1] is the node id for integer vertex i. */
  toId: NodeId[];
}

export function buildVertexMapping(nodes: { id: NodeId }[]): VertexMapping {
  const toInt = new Map<NodeId, number>();
  const toId: NodeId[] = [];
  for (const node of nodes) {
    if (toInt.has(node.id)) continue;
    toId.push(node.id);
    toInt.set(node.id, toId.length);
  }
  return { toInt, toId };
}

/** Canonical unordered-pair key in string-id space. */
function pairKey(a: NodeId, b: NodeId): string {
  return a < b ? `${a}--${b}` : `${b}--${a}`;
}

export function toWeightedRequest(
  graph: GraphPayload,
  mapping: VertexMapping
): { request: WeightedRequestDto; warnings: string[] } {
  const warnings: string[] = [];
  const seenPairs = new Set<string>();
  const edges: WeightedRequestDto["edges"] = [];

  for (const edge of graph.edges) {
    const u = mapping.toInt.get(edge.source);
    const v = mapping.toInt.get(edge.target);
    if (u === undefined || v === undefined) {
      warnings.push(`edge ${edge.id} references an unknown node; skipped`);
      continue;
    }
    // The server sorts each vertex pair ascending, so two parallel edges
    // between the same nodes cannot be told apart in the response.
    const key = pairKey(edge.source, edge.target);
    if (seenPairs.has(key)) {
      warnings.push(
        `duplicate edge between ${edge.source} and ${edge.target}; only the first was sent to the solver`
      );
      continue;
    }
    seenPairs.add(key);

    let weight = edge.weight;
    if (!Number.isInteger(weight)) {
      weight = Math.round(weight);
      warnings.push(
        `edge ${edge.id} weight ${edge.weight} rounded to ${weight} (solver requires integer weights)`
      );
    }
    edges.push({ vertices: [u, v], weight });
  }

  return { request: { edges }, warnings };
}

/** Maps canonical pair key → original edge, to recover edgeId from the response. */
export function buildEdgePairLookup(graph: GraphPayload): Map<string, GraphEdge> {
  const lookup = new Map<string, GraphEdge>();
  for (const edge of graph.edges) {
    const key = pairKey(edge.source, edge.target);
    if (!lookup.has(key)) lookup.set(key, edge);
  }
  return lookup;
}

function adaptScore(response: V1ResponseDto): OrientationScore {
  const optimized = response.optimized_graph_score;
  const bidirectional = response.bidirectional_graph_score;
  return {
    optimizedApsp: optimized === -1 ? null : optimized,
    bidirectionalApsp: bidirectional === -1 ? null : bidirectional,
    stronglyConnected: optimized !== -1,
  };
}

export function fromV1Response(
  response: V1ResponseDto,
  mapping: VertexMapping,
  pairLookup: Map<string, GraphEdge>
): SolveResult {
  const warnings: string[] = [];
  const orientedEdges: SolveResult["orientedEdges"] = [];

  for (const { _from, to } of response.edges) {
    const fromId = mapping.toId[_from - 1];
    const toId = mapping.toId[to - 1];
    if (fromId === undefined || toId === undefined) {
      warnings.push(`solver returned unknown vertex pair (${_from}, ${to}); skipped`);
      continue;
    }
    const original = pairLookup.get(pairKey(fromId, toId));
    if (!original) {
      warnings.push(`solver returned an edge ${fromId} → ${toId} not present in the input; skipped`);
      continue;
    }
    orientedEdges.push({ edgeId: original.id, from: fromId, to: toId });
  }

  const score = adaptScore(response);
  if (!score.stronglyConnected) {
    warnings.push(
      "resulting orientation is not strongly connected - some agent routes may be impossible"
    );
  }

  return { orientedEdges, score, warnings };
}

export async function solveOrientation(
  graph: GraphPayload,
  solver: SolverType
): Promise<SolveResult> {
  const mapping = buildVertexMapping(graph.nodes);
  const { request, warnings: requestWarnings } = toWeightedRequest(graph, mapping);
  const response = await requestJson<V1ResponseDto>(`/api/v1/${solver}`, {
    method: "POST",
    body: JSON.stringify(request),
  });
  const result = fromV1Response(response, mapping, buildEdgePairLookup(graph));
  return { ...result, warnings: [...requestWarnings, ...result.warnings] };
}
