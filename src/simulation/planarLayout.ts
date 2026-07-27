import type { Point, RawEdge } from "./graph";
import {
  buildUndirectedAdjacency,
  embedPlanarGraph,
  findConnectedComponents,
  RotationSystem,
} from "./planarEmbedding";

export type LayoutMode = "force" | "planar";

export interface PlanarLayoutOptions {
  width: number;
  height: number;
  padding?: number;
}

export type PlanarLayoutResult =
  | { ok: true; positions: Map<string, Point> }
  | { ok: false; reason: string };

const DEFAULT_PADDING = 40;
const RELAXATION_ROUNDS = 200;
const RELAXATION_CONVERGENCE = 1e-3;
const MAX_STEP_FRACTION = 0.35;
const RELAXATION_BACKOFFS = 6;

/**
 * Straight-line planar layout: embed the graph combinatorially, triangulate the
 * embedding so it becomes 3-connected, then place vertices with Tutte's
 * barycentric mapping. Tutte's theorem guarantees a crossing-free drawing for a
 * 3-connected planar graph whose outer face is drawn as a convex polygon; edges
 * added only for triangulation are dropped afterwards, which cannot introduce
 * crossings. The result is verified before it is returned.
 */
export function computePlanarLayout(
  nodeIds: string[],
  edges: RawEdge[],
  options: PlanarLayoutOptions
): PlanarLayoutResult {
  const { width, height, padding = DEFAULT_PADDING } = options;
  const adjacency = buildUndirectedAdjacency(nodeIds, edges);
  const allNodeIds = Array.from(adjacency.keys());
  if (allNodeIds.length === 0) return { ok: true, positions: new Map() };

  const embedding = embedPlanarGraph(allNodeIds, edges);
  if (!embedding.ok) return { ok: false, reason: embedding.reason };

  const originalEdgeKeys = new Set(edges.map((edge) => edgeKey(edge.source, edge.target)));
  const components = findConnectedComponents(allNodeIds, adjacency);
  const normalizedComponents: Array<Map<string, Point>> = [];
  for (const component of components) {
    const componentNodes = new Set(component);
    const componentEdges = edges.filter((edge) => componentNodes.has(edge.source));
    const placed = layoutComponent(component, componentEdges, embedding.rotation, originalEdgeKeys);
    if (!placed) return { ok: false, reason: "planar coordinates could not be solved" };
    normalizedComponents.push(placed);
  }

  const positions = packComponents(normalizedComponents, { width, height, padding });
  const crossings = countEdgeCrossings(edges, positions);
  if (crossings > 0) {
    return { ok: false, reason: `planar layout still had ${crossings} edge crossing(s)` };
  }
  return { ok: true, positions };
}

/**
 * Number of edge pairs that overlap visually: non-adjacent segments that touch
 * or cross, plus adjacent segments that run along each other instead of only
 * meeting at their shared node.
 */
export function countEdgeCrossings(edges: RawEdge[], positions: Map<string, Point>): number {
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (edgesOverlap(edges[i], edges[j], positions)) crossings++;
    }
  }
  return crossings;
}

function edgesOverlap(a: RawEdge, b: RawEdge, positions: Map<string, Point>): boolean {
  const sharedNode = findSharedNode(a, b);
  if (sharedNode) {
    const shared = positions.get(sharedNode);
    const endA = positions.get(a.source === sharedNode ? a.target : a.source);
    const endB = positions.get(b.source === sharedNode ? b.target : b.source);
    if (!shared || !endA || !endB) return false;
    return raysOverlap(shared, endA, endB);
  }
  const p1 = positions.get(a.source);
  const p2 = positions.get(a.target);
  const p3 = positions.get(b.source);
  const p4 = positions.get(b.target);
  if (!p1 || !p2 || !p3 || !p4) return false;
  return segmentsIntersect(p1, p2, p3, p4);
}

function findSharedNode(a: RawEdge, b: RawEdge): string | null {
  if (a.source === b.source || a.source === b.target) return a.source;
  if (a.target === b.source || a.target === b.target) return a.target;
  return null;
}

/** True when two segments leaving the same node run in the same direction. */
function raysOverlap(shared: Point, endA: Point, endB: Point): boolean {
  const ax = endA.x - shared.x;
  const ay = endA.y - shared.y;
  const bx = endB.x - shared.x;
  const by = endB.y - shared.y;
  const lengthA = Math.hypot(ax, ay);
  const lengthB = Math.hypot(bx, by);
  if (lengthA < 1e-12 || lengthB < 1e-12) return true;
  const cross = (ax * by - ay * bx) / (lengthA * lengthB);
  const dot = (ax * bx + ay * by) / (lengthA * lengthB);
  return Math.abs(cross) < 1e-9 && dot > 0;
}

function edgeKey(from: string, to: string): string {
  return from < to ? `${from} ${to}` : `${to} ${from}`;
}

/** Coordinates in the unit square for one connected component. */
function layoutComponent(
  component: string[],
  componentEdges: RawEdge[],
  rotation: RotationSystem,
  originalEdgeKeys: Set<string>
): Map<string, Point> | null {
  if (component.length === 1) {
    return new Map([[component[0], { x: 0.5, y: 0.5 }]]);
  }
  if (component.length === 2) {
    return new Map([
      [component[0], { x: 0, y: 0.5 }],
      [component[1], { x: 1, y: 0.5 }],
    ]);
  }

  const triangulated = rotation.subsystem(component);
  triangulateEmbedding(triangulated);

  const outerFace = chooseOuterFace(triangulated.traceFaces(), originalEdgeKeys);
  if (!outerFace) return null;

  const coordinates = solveTutteCoordinates(triangulated, component, outerFace);
  if (!coordinates) return null;
  return spreadWithoutCrossings(normalizeToUnitSquare(coordinates), componentEdges);
}

/**
 * Tutte coordinates are crossing-free but crowd towards the barycentre, which
 * gets unreadable past ~15 nodes. Each node is nudged along a spring/repulsion
 * force one at a time, and a nudge is kept only when the edges touching that
 * node still cross nothing, so spacing never costs planarity.
 */
function spreadWithoutCrossings(
  positions: Map<string, Point>,
  componentEdges: RawEdge[]
): Map<string, Point> {
  const nodeIds = Array.from(positions.keys()).sort();
  if (nodeIds.length < 3 || componentEdges.length === 0) return positions;

  const incidentEdges = new Map<string, RawEdge[]>(nodeIds.map((id) => [id, []]));
  for (const edge of componentEdges) {
    incidentEdges.get(edge.source)?.push(edge);
    incidentEdges.get(edge.target)?.push(edge);
  }

  const idealDistance = Math.sqrt(1 / nodeIds.length);
  const current = new Map(positions);
  for (let round = 0; round < RELAXATION_ROUNDS; round++) {
    let longestMove = 0;
    for (const id of nodeIds) {
      const displacement = nodeDisplacement(id, current, incidentEdges.get(id)!, idealDistance);
      const length = Math.hypot(displacement.x, displacement.y);
      if (length < 1e-12) continue;

      const origin = current.get(id)!;
      let stepLength = Math.min(length, idealDistance * MAX_STEP_FRACTION);
      for (let attempt = 0; attempt < RELAXATION_BACKOFFS; attempt++) {
        current.set(id, {
          x: origin.x + (displacement.x / length) * stepLength,
          y: origin.y + (displacement.y / length) * stepLength,
        });
        if (!nodeOverlapsAnything(incidentEdges.get(id)!, componentEdges, current)) {
          longestMove = Math.max(longestMove, stepLength);
          break;
        }
        current.set(id, origin);
        stepLength *= 0.5;
      }
    }
    if (longestMove < idealDistance * RELAXATION_CONVERGENCE) break;
  }
  return normalizeToUnitSquare(current);
}

/** Repulsion from every other node plus spring attraction along incident edges. */
function nodeDisplacement(
  nodeId: string,
  positions: Map<string, Point>,
  incidentEdges: RawEdge[],
  idealDistance: number
): Point {
  const self = positions.get(nodeId)!;
  const displacement = { x: 0, y: 0 };

  for (const [otherId, other] of positions) {
    if (otherId === nodeId) continue;
    const dx = self.x - other.x;
    const dy = self.y - other.y;
    const distance = Math.max(Math.hypot(dx, dy), 1e-9);
    const repulsion = (idealDistance * idealDistance) / distance;
    displacement.x += (dx / distance) * repulsion;
    displacement.y += (dy / distance) * repulsion;
  }

  for (const edge of incidentEdges) {
    const otherId = edge.source === nodeId ? edge.target : edge.source;
    const other = positions.get(otherId);
    if (!other) continue;
    const dx = self.x - other.x;
    const dy = self.y - other.y;
    const distance = Math.max(Math.hypot(dx, dy), 1e-9);
    const attraction = (distance * distance) / idealDistance;
    displacement.x -= (dx / distance) * attraction;
    displacement.y -= (dy / distance) * attraction;
  }

  return displacement;
}

/** Only edges touching the moved node can have started overlapping. */
function nodeOverlapsAnything(
  incidentEdges: RawEdge[],
  componentEdges: RawEdge[],
  positions: Map<string, Point>
): boolean {
  for (const edge of incidentEdges) {
    for (const other of componentEdges) {
      if (other === edge) continue;
      if (edgesOverlap(edge, other, positions)) return true;
    }
  }
  return false;
}

/**
 * Adds chords inside faces until no face admits one. A chord placed in a face
 * corner keeps the embedding planar, and every addition raises the edge count,
 * so the loop terminates at (or near) a maximal planar graph. Faces of graphs
 * with bridges or cut vertices repeat vertices; chords remove those repeats,
 * which is what makes the embedding biconnected.
 */
function triangulateEmbedding(rotation: RotationSystem): void {
  for (;;) {
    const chord = findChord(rotation);
    if (!chord) return;
    const [from, via, to] = chord;
    rotation.insertClockwiseBefore(from, via, to);
    rotation.insertClockwiseAfter(to, via, from);
  }
}

function findChord(rotation: RotationSystem): [string, string, string] | null {
  for (const face of rotation.traceFaces()) {
    if (face.length < 3) continue;
    for (let index = 0; index < face.length; index++) {
      const from = face[index];
      const via = face[(index + 1) % face.length];
      const to = face[(index + 2) % face.length];
      if (from === to || rotation.hasEdge(from, to)) continue;
      return [from, via, to];
    }
  }
  return null;
}

/**
 * Outer face for the Tutte drawing. Preferring the face with the most original
 * edges keeps the user's own graph on the convex hull instead of pushing
 * triangulation chords outwards.
 */
function chooseOuterFace(faces: string[][], originalEdgeKeys: Set<string>): string[] | null {
  let best: string[] | null = null;
  let bestScore = -1;
  for (const face of faces) {
    if (face.length < 3) continue;
    if (new Set(face).size !== face.length) continue;
    let originalEdges = 0;
    for (let index = 0; index < face.length; index++) {
      const key = edgeKey(face[index], face[(index + 1) % face.length]);
      if (originalEdgeKeys.has(key)) originalEdges++;
    }
    const score = originalEdges * 1000 + face.length;
    if (score > bestScore) {
      bestScore = score;
      best = face;
    }
  }
  return best;
}

/**
 * Tutte barycentric embedding: outer face on a regular polygon, every other
 * vertex at the average of its neighbours. Solves the resulting linear system
 * for x and y at once.
 */
function solveTutteCoordinates(
  rotation: RotationSystem,
  component: string[],
  outerFace: string[]
): Map<string, Point> | null {
  const positions = new Map<string, Point>();
  outerFace.forEach((vertex, index) => {
    const angle = (2 * Math.PI * index) / outerFace.length;
    positions.set(vertex, { x: Math.cos(angle), y: Math.sin(angle) });
  });

  const fixed = new Set(outerFace);
  const free = component.filter((vertex) => !fixed.has(vertex));
  if (free.length === 0) return positions;

  const indexOfFree = new Map(free.map((vertex, index) => [vertex, index]));
  const matrix: number[][] = free.map(() => new Array<number>(free.length).fill(0));
  const rightHandSide: number[][] = free.map(() => [0, 0]);

  free.forEach((vertex, row) => {
    const neighbors = rotation.neighbors(vertex);
    if (neighbors.length === 0) return;
    matrix[row][row] = neighbors.length;
    for (const neighbor of neighbors) {
      const column = indexOfFree.get(neighbor);
      if (column === undefined) {
        const anchor = positions.get(neighbor)!;
        rightHandSide[row][0] += anchor.x;
        rightHandSide[row][1] += anchor.y;
        continue;
      }
      matrix[row][column] -= 1;
    }
  });

  const solution = solveLinearSystem(matrix, rightHandSide);
  if (!solution) return null;
  free.forEach((vertex, row) => {
    positions.set(vertex, { x: solution[row][0], y: solution[row][1] });
  });
  return positions;
}

/** Gaussian elimination with partial pivoting for a small dense system. */
function solveLinearSystem(matrix: number[][], rightHandSide: number[][]): number[][] | null {
  const size = matrix.length;
  const columns = rightHandSide[0]?.length ?? 0;
  const a = matrix.map((row) => [...row]);
  const b = rightHandSide.map((row) => [...row]);

  for (let pivot = 0; pivot < size; pivot++) {
    let pivotRow = pivot;
    for (let row = pivot + 1; row < size; row++) {
      if (Math.abs(a[row][pivot]) > Math.abs(a[pivotRow][pivot])) pivotRow = row;
    }
    if (Math.abs(a[pivotRow][pivot]) < 1e-12) return null;
    [a[pivot], a[pivotRow]] = [a[pivotRow], a[pivot]];
    [b[pivot], b[pivotRow]] = [b[pivotRow], b[pivot]];

    for (let row = pivot + 1; row < size; row++) {
      const factor = a[row][pivot] / a[pivot][pivot];
      if (factor === 0) continue;
      for (let column = pivot; column < size; column++) a[row][column] -= factor * a[pivot][column];
      for (let column = 0; column < columns; column++) b[row][column] -= factor * b[pivot][column];
    }
  }

  const solution: number[][] = Array.from({ length: size }, () => new Array<number>(columns).fill(0));
  for (let row = size - 1; row >= 0; row--) {
    for (let column = 0; column < columns; column++) {
      let value = b[row][column];
      for (let k = row + 1; k < size; k++) value -= a[row][k] * solution[k][column];
      solution[row][column] = value / a[row][row];
      if (!Number.isFinite(solution[row][column])) return null;
    }
  }
  return solution;
}

function normalizeToUnitSquare(positions: Map<string, Point>): Map<string, Point> {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of positions.values()) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return new Map();
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const normalized = new Map<string, Point>();
  for (const [vertex, point] of positions) {
    normalized.set(vertex, { x: (point.x - minX) / spanX, y: (point.y - minY) / spanY });
  }
  return normalized;
}

/**
 * Places each component in its own grid cell. Disjoint cells mean edges of
 * different components can never cross.
 */
function packComponents(
  components: Array<Map<string, Point>>,
  options: { width: number; height: number; padding: number }
): Map<string, Point> {
  const { width, height, padding } = options;
  const positions = new Map<string, Point>();
  const columns = Math.ceil(Math.sqrt(components.length));
  const rows = Math.ceil(components.length / columns);
  const cellWidth = (width - 2 * padding) / columns;
  const cellHeight = (height - 2 * padding) / rows;
  const insetX = Math.min(cellWidth * 0.08, padding);
  const insetY = Math.min(cellHeight * 0.08, padding);

  components.forEach((component, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = padding + column * cellWidth + insetX;
    const top = padding + row * cellHeight + insetY;
    const usableWidth = Math.max(cellWidth - 2 * insetX, 1);
    const usableHeight = Math.max(cellHeight - 2 * insetY, 1);
    const single = component.size === 1;
    for (const [vertex, point] of component) {
      positions.set(vertex, {
        x: single ? left + usableWidth / 2 : left + point.x * usableWidth,
        y: single ? top + usableHeight / 2 : top + point.y * usableHeight,
      });
    }
  });

  return positions;
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const scale = Math.max(
    1,
    Math.abs(p1.x),
    Math.abs(p1.y),
    Math.abs(p2.x),
    Math.abs(p2.y),
    Math.abs(p3.x),
    Math.abs(p3.y),
    Math.abs(p4.x),
    Math.abs(p4.y)
  );
  const epsilon = 1e-9 * scale * scale;
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const sign = (value: number) => (value > epsilon ? 1 : value < -epsilon ? -1 : 0);
  const onSegment = (a: Point, b: Point, c: Point) =>
    Math.min(a.x, b.x) - epsilon <= c.x &&
    c.x <= Math.max(a.x, b.x) + epsilon &&
    Math.min(a.y, b.y) - epsilon <= c.y &&
    c.y <= Math.max(a.y, b.y) + epsilon;

  const d1 = sign(cross(p3, p4, p1));
  const d2 = sign(cross(p3, p4, p2));
  const d3 = sign(cross(p1, p2, p3));
  const d4 = sign(cross(p1, p2, p4));

  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}
