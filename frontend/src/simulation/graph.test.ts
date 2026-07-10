import { describe, expect, it } from "vitest";
import {
  computeForceDirectedLayout,
  findLeafNodes,
  parseEdgeListCsv,
} from "./graph";

describe("parseEdgeListCsv", () => {
  it("parses a valid 3-line CSV", () => {
    const result = parseEdgeListCsv("A,B,1\nB,C,2.5\nC,D,3");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.graph.nodeIds.sort()).toEqual(["A", "B", "C", "D"]);
      expect(result.graph.edges).toHaveLength(3);
      expect(result.graph.warnings).toHaveLength(0);
    }
  });

  it("rejects a row with the wrong number of columns", () => {
    const result = parseEdgeListCsv("A,B,1\nA,B,C,2");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/3 fields/);
    }
  });

  it("rejects a non-numeric weight", () => {
    const result = parseEdgeListCsv("A,B,heavy");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/positive number/);
    }
  });

  it("rejects a non-positive weight", () => {
    const result = parseEdgeListCsv("A,B,0\nB,C,-1");
    expect(result.ok).toBe(false);
  });

  it("rejects a self-loop", () => {
    const result = parseEdgeListCsv("A,A,1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/self-loop/);
    }
  });

  it("warns and drops a duplicate unordered pair, keeping the first weight", () => {
    const result = parseEdgeListCsv("A,B,1\nB,A,5");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.graph.edges).toHaveLength(1);
      expect(result.graph.edges[0].weight).toBe(1);
      expect(result.graph.warnings.length).toBeGreaterThan(0);
    }
  });

  it("rejects empty input", () => {
    const result = parseEdgeListCsv("   \n  ");
    expect(result.ok).toBe(false);
  });
});

describe("findLeafNodes", () => {
  it("finds the two endpoints of a star graph's outer points as leaves, hub excluded", () => {
    const edges = [
      { source: "hub", target: "a", weight: 1 },
      { source: "hub", target: "b", weight: 1 },
      { source: "hub", target: "c", weight: 1 },
    ];
    const leaves = findLeafNodes(["hub", "a", "b", "c"], edges);
    expect(leaves.sort()).toEqual(["a", "b", "c"]);
  });

  it("returns no leaves for a pure cycle", () => {
    const edges = [
      { source: "a", target: "b", weight: 1 },
      { source: "b", target: "c", weight: 1 },
      { source: "c", target: "a", weight: 1 },
    ];
    const leaves = findLeafNodes(["a", "b", "c"], edges);
    expect(leaves).toEqual([]);
  });
});

describe("computeForceDirectedLayout", () => {
  it("produces finite, non-collapsed positions for a 20-node random graph", () => {
    const nodeIds = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const edges = nodeIds.slice(1).map((id, i) => ({
      source: nodeIds[i],
      target: id,
      weight: 1,
    }));
    const positions = computeForceDirectedLayout(nodeIds, edges, {
      width: 800,
      height: 400,
      iterations: 100,
    });

    expect(positions.size).toBe(20);
    for (const [, p] of positions) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }

    let minDist = Infinity;
    const pts = Array.from(positions.values());
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        minDist = Math.min(minDist, d);
      }
    }
    expect(minDist).toBeGreaterThan(0.5);
  });

  it("handles coincident starting nodes without producing NaN", () => {
    const nodeIds = ["a", "b"];
    const edges = [{ source: "a", target: "b", weight: 1 }];
    const positions = computeForceDirectedLayout(nodeIds, edges, {
      width: 100,
      height: 100,
      iterations: 50,
      seed: 1,
    });
    for (const [, p] of positions) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});
