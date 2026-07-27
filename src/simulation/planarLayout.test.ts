import { describe, expect, it } from "vitest";
import type { RawEdge } from "./graph";
import { computePlanarLayout, countEdgeCrossings } from "./planarLayout";
import { embedPlanarGraph } from "./planarEmbedding";

const CANVAS = { width: 960, height: 560 };

function edgesFrom(pairs: Array<[string, string]>): RawEdge[] {
  return pairs.map(([source, target]) => ({ source, target, weight: 1 }));
}

function nodesOf(edges: RawEdge[]): string[] {
  const ids = new Set<string>();
  for (const edge of edges) {
    ids.add(edge.source);
    ids.add(edge.target);
  }
  return Array.from(ids);
}

function completeGraph(size: number): RawEdge[] {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) pairs.push([`n${i}`, `n${j}`]);
  }
  return edgesFrom(pairs);
}

function completeBipartiteGraph(left: number, right: number): RawEdge[] {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < left; i++) {
    for (let j = 0; j < right; j++) pairs.push([`l${i}`, `r${j}`]);
  }
  return edgesFrom(pairs);
}

function gridGraph(columns: number, rows: number): RawEdge[] {
  const pairs: Array<[string, string]> = [];
  const id = (column: number, row: number) => `c${column}r${row}`;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (column + 1 < columns) pairs.push([id(column, row), id(column + 1, row)]);
      if (row + 1 < rows) pairs.push([id(column, row), id(column, row + 1)]);
    }
  }
  return edgesFrom(pairs);
}

const PLANAR_CASES: Array<{ name: string; edges: RawEdge[] }> = [
  { name: "single edge", edges: edgesFrom([["a", "b"]]) },
  { name: "path", edges: edgesFrom([["a", "b"], ["b", "c"], ["c", "d"]]) },
  {
    name: "star with leaves",
    edges: edgesFrom([["hub", "a"], ["hub", "b"], ["hub", "c"], ["hub", "d"]]),
  },
  { name: "triangle", edges: edgesFrom([["a", "b"], ["b", "c"], ["c", "a"]]) },
  { name: "K4", edges: completeGraph(4) },
  {
    name: "bowtie (cut vertex between two cycles)",
    edges: edgesFrom([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["c", "d"],
      ["d", "e"],
      ["e", "c"],
    ]),
  },
  {
    name: "two cycles joined by a bridge with leaves",
    edges: edgesFrom([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["c", "d"],
      ["d", "e"],
      ["e", "f"],
      ["f", "d"],
      ["e", "leaf1"],
      ["a", "leaf2"],
    ]),
  },
  {
    name: "wheel",
    edges: edgesFrom([
      ["hub", "a"],
      ["hub", "b"],
      ["hub", "c"],
      ["hub", "d"],
      ["hub", "e"],
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["d", "e"],
      ["e", "a"],
    ]),
  },
  {
    name: "cube",
    edges: edgesFrom([
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["d", "a"],
      ["e", "f"],
      ["f", "g"],
      ["g", "h"],
      ["h", "e"],
      ["a", "e"],
      ["b", "f"],
      ["c", "g"],
      ["d", "h"],
    ]),
  },
  { name: "4x4 grid", edges: gridGraph(4, 4) },
  {
    name: "two disconnected triangles",
    edges: edgesFrom([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["x", "y"],
      ["y", "z"],
      ["z", "x"],
    ]),
  },
  {
    name: "K5 minus one edge",
    edges: completeGraph(5).filter((edge) => !(edge.source === "n0" && edge.target === "n1")),
  },
];

describe("computePlanarLayout", () => {
  it.each(PLANAR_CASES)("draws $name without edge crossings", ({ edges }) => {
    const result = computePlanarLayout(nodesOf(edges), edges, CANVAS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(countEdgeCrossings(edges, result.positions)).toBe(0);
    expect(result.positions.size).toBe(nodesOf(edges).length);
  });

  it("keeps every node inside the canvas", () => {
    const edges = gridGraph(4, 4);
    const result = computePlanarLayout(nodesOf(edges), edges, CANVAS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const point of result.positions.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(CANVAS.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(CANVAS.height);
    }
  });

  it("separates disconnected components into disjoint regions", () => {
    const edges = edgesFrom([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["x", "y"],
      ["y", "z"],
      ["z", "x"],
    ]);
    const result = computePlanarLayout(nodesOf(edges), edges, CANVAS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = ["a", "b", "c"].map((id) => result.positions.get(id)!);
    const second = ["x", "y", "z"].map((id) => result.positions.get(id)!);
    const firstRight = Math.max(...first.map((p) => p.x));
    const secondLeft = Math.min(...second.map((p) => p.x));
    expect(firstRight).toBeLessThan(secondLeft);
  });

  it("keeps nodes far enough apart to stay draggable on a 12-node graph", () => {
    const edges = gridGraph(4, 3);
    const result = computePlanarLayout(nodesOf(edges), edges, CANVAS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const points = Array.from(result.positions.values());
    let minimumDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        minimumDistance = Math.min(
          minimumDistance,
          Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)
        );
      }
    }
    expect(minimumDistance).toBeGreaterThan(20);
  });

  it("is deterministic for the same input", () => {
    const edges = gridGraph(3, 3);
    const first = computePlanarLayout(nodesOf(edges), edges, CANVAS);
    const second = computePlanarLayout(nodesOf(edges), edges, CANVAS);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    for (const [id, point] of first.positions) {
      expect(second.positions.get(id)).toEqual(point);
    }
  });

  it("reports failure instead of drawing K5", () => {
    const edges = completeGraph(5);
    const result = computePlanarLayout(nodesOf(edges), edges, CANVAS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/planar/);
  });

  it("reports failure instead of drawing K3,3", () => {
    const edges = completeBipartiteGraph(3, 3);
    const result = computePlanarLayout(nodesOf(edges), edges, CANVAS);
    expect(result.ok).toBe(false);
  });

  it("reports failure for a graph containing a non-planar block", () => {
    const edges = [...completeGraph(5), ...edgesFrom([["n0", "tail"], ["tail", "tip"]])];
    const result = computePlanarLayout(nodesOf(edges), edges, CANVAS);
    expect(result.ok).toBe(false);
  });

  it("handles an empty graph", () => {
    const result = computePlanarLayout([], [], CANVAS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.positions.size).toBe(0);
  });

  it("places isolated nodes that have no edges", () => {
    const edges = edgesFrom([["a", "b"]]);
    const result = computePlanarLayout(["a", "b", "lonely"], edges, CANVAS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.positions.has("lonely")).toBe(true);
  });
});

describe("embedPlanarGraph", () => {
  it.each(PLANAR_CASES)("embeds $name", ({ edges }) => {
    expect(embedPlanarGraph(nodesOf(edges), edges).ok).toBe(true);
  });

  it("rejects the Petersen graph", () => {
    const edges = edgesFrom([
      ["o0", "o1"],
      ["o1", "o2"],
      ["o2", "o3"],
      ["o3", "o4"],
      ["o4", "o0"],
      ["i0", "i2"],
      ["i2", "i4"],
      ["i4", "i1"],
      ["i1", "i3"],
      ["i3", "i0"],
      ["o0", "i0"],
      ["o1", "i1"],
      ["o2", "i2"],
      ["o3", "i3"],
      ["o4", "i4"],
    ]);
    expect(embedPlanarGraph(nodesOf(edges), edges).ok).toBe(false);
  });

  it("produces faces that satisfy Euler's formula for the icosahedron", () => {
    const pairs: Array<[string, string]> = [
      ["1", "2"],
      ["1", "3"],
      ["1", "4"],
      ["1", "5"],
      ["1", "6"],
      ["2", "3"],
      ["3", "4"],
      ["4", "5"],
      ["5", "6"],
      ["6", "2"],
      ["2", "8"],
      ["3", "9"],
      ["4", "10"],
      ["5", "11"],
      ["6", "7"],
      ["2", "7"],
      ["3", "8"],
      ["4", "9"],
      ["5", "10"],
      ["6", "11"],
      ["7", "8"],
      ["8", "9"],
      ["9", "10"],
      ["10", "11"],
      ["11", "7"],
      ["12", "7"],
      ["12", "8"],
      ["12", "9"],
      ["12", "10"],
      ["12", "11"],
    ];
    const edges = edgesFrom(pairs);
    const result = embedPlanarGraph(nodesOf(edges), edges);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const faces = result.rotation.traceFaces();
    expect(12 - 30 + faces.length).toBe(2);
    expect(faces.every((face) => face.length === 3)).toBe(true);
  });
});

/** Grows a random maximal planar graph by splitting a random face into three. */
function randomPlanarTriangulation(nodeCount: number, random: () => number): RawEdge[] {
  const faces: Array<[string, string, string]> = [
    ["v0", "v1", "v2"],
    ["v0", "v2", "v1"],
  ];
  const pairs: Array<[string, string]> = [
    ["v0", "v1"],
    ["v1", "v2"],
    ["v2", "v0"],
  ];
  for (let index = 3; index < nodeCount; index++) {
    const vertex = `v${index}`;
    const faceIndex = Math.min(faces.length - 1, Math.floor(random() * faces.length));
    const [a, b, c] = faces[faceIndex];
    faces.splice(faceIndex, 1, [a, b, vertex], [b, c, vertex], [c, a, vertex]);
    pairs.push([a, vertex], [b, vertex], [c, vertex]);
  }
  return edgesFrom(pairs);
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

describe("computePlanarLayout on generated planar graphs", () => {
  it.each([3, 5, 8, 12, 20])("draws a random %i-node triangulation without crossings", (size) => {
    const random = seededRandom(size * 7919 + 11);
    const edges = randomPlanarTriangulation(size, random);
    const result = computePlanarLayout(nodesOf(edges), edges, CANVAS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(countEdgeCrossings(edges, result.positions)).toBe(0);
  });

  it.each([1, 2, 3, 4, 5])("draws a thinned random triangulation (seed %i) without crossings", (seed) => {
    const random = seededRandom(seed * 104729 + 3);
    const full = randomPlanarTriangulation(14, random);
    const edges = full.filter(() => random() > 0.35);
    if (edges.length === 0) return;
    const result = computePlanarLayout(nodesOf(edges), edges, CANVAS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(countEdgeCrossings(edges, result.positions)).toBe(0);
  });
});

describe("countEdgeCrossings", () => {
  it("counts a crossing pair of segments", () => {
    const edges = edgesFrom([
      ["a", "b"],
      ["c", "d"],
    ]);
    const positions = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 10, y: 10 }],
      ["c", { x: 0, y: 10 }],
      ["d", { x: 10, y: 0 }],
    ]);
    expect(countEdgeCrossings(edges, positions)).toBe(1);
  });

  it("ignores edges that only share an endpoint", () => {
    const edges = edgesFrom([
      ["a", "b"],
      ["b", "c"],
    ]);
    const positions = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 10, y: 0 }],
      ["c", { x: 10, y: 10 }],
    ]);
    expect(countEdgeCrossings(edges, positions)).toBe(0);
  });

  it("counts a node lying on top of an unrelated edge", () => {
    const edges = edgesFrom([
      ["a", "b"],
      ["c", "d"],
    ]);
    const positions = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 10, y: 0 }],
      ["c", { x: 5, y: 0 }],
      ["d", { x: 5, y: 10 }],
    ]);
    expect(countEdgeCrossings(edges, positions)).toBe(1);
  });
});
