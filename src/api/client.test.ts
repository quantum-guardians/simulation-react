import { describe, expect, it } from "vitest";
import {
  buildEdgePairLookup,
  buildVertexMapping,
  fromSolverResponse,
  toWeightedRequest,
} from "./client";
import type { GraphPayload, SolverResponseDto } from "./types";

function makeGraph(): GraphPayload {
  return {
    nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
    edges: [
      { id: "A--B", source: "A", target: "B", weight: 1 },
      { id: "B--C", source: "B", target: "C", weight: 2 },
    ],
  };
}

describe("buildVertexMapping", () => {
  it("assigns 1-based ints in node order and round-trips", () => {
    const mapping = buildVertexMapping(makeGraph().nodes);
    expect(mapping.toInt.get("A")).toBe(1);
    expect(mapping.toInt.get("C")).toBe(3);
    for (const [id, i] of mapping.toInt) {
      expect(mapping.toId[i - 1]).toBe(id);
    }
  });

  it("ignores duplicate node ids", () => {
    const mapping = buildVertexMapping([{ id: "A" }, { id: "A" }, { id: "B" }]);
    expect(mapping.toId).toEqual(["A", "B"]);
  });
});

describe("toWeightedRequest", () => {
  it("converts edges to integer vertex pairs", () => {
    const graph = makeGraph();
    const { request, warnings } = toWeightedRequest(graph, buildVertexMapping(graph.nodes));
    expect(request.edges).toEqual([
      { vertices: [1, 2], weight: 1 },
      { vertices: [2, 3], weight: 2 },
    ]);
    expect(warnings).toEqual([]);
  });

  it("rounds fractional weights with a warning", () => {
    const graph: GraphPayload = {
      nodes: [{ id: "A" }, { id: "B" }],
      edges: [{ id: "A--B", source: "A", target: "B", weight: 1.4 }],
    };
    const { request, warnings } = toWeightedRequest(graph, buildVertexMapping(graph.nodes));
    expect(request.edges[0].weight).toBe(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("rounded");
  });

  it("drops duplicate unordered pairs with a warning", () => {
    const graph: GraphPayload = {
      nodes: [{ id: "A" }, { id: "B" }],
      edges: [
        { id: "A--B", source: "A", target: "B", weight: 1 },
        { id: "B--A", source: "B", target: "A", weight: 3 },
      ],
    };
    const { request, warnings } = toWeightedRequest(graph, buildVertexMapping(graph.nodes));
    expect(request.edges).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("duplicate");
  });
});

describe("fromSolverResponse", () => {
  it("recovers the original edgeId even when the solver reverses direction", () => {
    const graph = makeGraph();
    const mapping = buildVertexMapping(graph.nodes);
    const response: SolverResponseDto = {
      // B→A reverses the "A--B" edge; C→B reverses "B--C".
      edges: [
        { _from: 2, to: 1 },
        { _from: 3, to: 2 },
      ],
      optimized_graph_score: 12,
      bidirectional_graph_score: 10,
    };
    const result = fromSolverResponse(response, mapping, buildEdgePairLookup(graph));
    expect(result.orientedEdges).toEqual([
      { edgeId: "A--B", from: "B", to: "A" },
      { edgeId: "B--C", from: "C", to: "B" },
    ]);
    expect(result.score).toEqual({
      optimizedApsp: 12,
      bidirectionalApsp: 10,
      stronglyConnected: true,
    });
    expect(result.warnings).toEqual([]);
  });

  it("maps score -1 to null and warns about missing strong connectivity", () => {
    const graph = makeGraph();
    const mapping = buildVertexMapping(graph.nodes);
    const response: SolverResponseDto = {
      edges: [{ _from: 1, to: 2 }],
      optimized_graph_score: -1,
      bidirectional_graph_score: 10,
    };
    const result = fromSolverResponse(response, mapping, buildEdgePairLookup(graph));
    expect(result.score.optimizedApsp).toBeNull();
    expect(result.score.stronglyConnected).toBe(false);
    expect(result.warnings.some((w) => w.includes("not strongly connected"))).toBe(true);
  });

  it("skips edges the solver returns that were never in the input", () => {
    const graph = makeGraph();
    const mapping = buildVertexMapping(graph.nodes);
    const response: SolverResponseDto = {
      edges: [
        { _from: 1, to: 3 }, // A--C does not exist in the input graph
        { _from: 99, to: 1 }, // unknown vertex
      ],
      optimized_graph_score: 5,
      bidirectional_graph_score: 5,
    };
    const result = fromSolverResponse(response, mapping, buildEdgePairLookup(graph));
    expect(result.orientedEdges).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });
});
