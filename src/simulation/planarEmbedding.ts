import type { RawEdge } from "./graph";

/**
 * Combinatorial planar embedding: for every vertex, the clockwise order of its
 * neighbours (a rotation system). A rotation system plus the convention below
 * fully determines the faces of a planar drawing, so the geometric layout step
 * only has to turn faces into coordinates.
 *
 * Face convention: the half-edge that follows (v, w) along a face is
 * (w, clockwiseAfter(w, v)). Walking that successor from every half-edge
 * enumerates each face exactly once.
 */
export class RotationSystem {
  private readonly order = new Map<string, string[]>();

  constructor(rotations?: Iterable<[string, string[]]>) {
    if (!rotations) return;
    for (const [vertex, neighbors] of rotations) {
      this.order.set(vertex, [...neighbors]);
    }
  }

  nodeIds(): string[] {
    return Array.from(this.order.keys());
  }

  neighbors(vertex: string): readonly string[] {
    return this.order.get(vertex) ?? [];
  }

  hasEdge(from: string, to: string): boolean {
    return this.order.get(from)?.includes(to) ?? false;
  }

  edgeCount(): number {
    let halfEdges = 0;
    for (const neighbors of this.order.values()) halfEdges += neighbors.length;
    return halfEdges / 2;
  }

  /** Neighbour that follows `reference` in the clockwise order around `vertex`. */
  clockwiseAfter(vertex: string, reference: string): string {
    const neighbors = this.requireNeighbors(vertex);
    const index = neighbors.indexOf(reference);
    if (index < 0) throw new Error(`"${reference}" is not a neighbour of "${vertex}"`);
    return neighbors[(index + 1) % neighbors.length];
  }

  insertClockwiseAfter(vertex: string, reference: string, neighbor: string): void {
    const neighbors = this.requireNeighbors(vertex);
    const index = neighbors.indexOf(reference);
    if (index < 0) throw new Error(`"${reference}" is not a neighbour of "${vertex}"`);
    neighbors.splice(index + 1, 0, neighbor);
  }

  insertClockwiseBefore(vertex: string, reference: string, neighbor: string): void {
    const neighbors = this.requireNeighbors(vertex);
    const index = neighbors.indexOf(reference);
    if (index < 0) throw new Error(`"${reference}" is not a neighbour of "${vertex}"`);
    neighbors.splice(index, 0, neighbor);
  }

  /** Copy holding only `vertices` and the edges between them. */
  subsystem(vertices: string[]): RotationSystem {
    const kept = new Set(vertices);
    const copy = new RotationSystem();
    for (const vertex of vertices) {
      copy.order.set(
        vertex,
        this.neighbors(vertex).filter((neighbor) => kept.has(neighbor))
      );
    }
    return copy;
  }

  /** Every face as the cyclic sequence of vertices along its boundary walk. */
  traceFaces(): string[][] {
    const visited = new Map<string, Set<string>>();
    const isVisited = (from: string, to: string) => visited.get(from)?.has(to) ?? false;
    const markVisited = (from: string, to: string) => {
      const targets = visited.get(from) ?? new Set<string>();
      targets.add(to);
      visited.set(from, targets);
    };

    const faces: string[][] = [];
    for (const [vertex, neighbors] of this.order) {
      for (const neighbor of neighbors) {
        if (isVisited(vertex, neighbor)) continue;
        const face: string[] = [];
        let from = vertex;
        let to = neighbor;
        while (!isVisited(from, to)) {
          markVisited(from, to);
          face.push(from);
          const next = this.clockwiseAfter(to, from);
          from = to;
          to = next;
        }
        faces.push(face);
      }
    }
    return faces;
  }

  private requireNeighbors(vertex: string): string[] {
    const neighbors = this.order.get(vertex);
    if (!neighbors) throw new Error(`unknown vertex "${vertex}"`);
    return neighbors;
  }
}

export type PlanarEmbeddingResult =
  | { ok: true; rotation: RotationSystem }
  | { ok: false; reason: string };

type EdgePair = readonly [string, string];

export function buildUndirectedAdjacency(
  nodeIds: string[],
  edges: RawEdge[]
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const ensure = (id: string) => {
    const existing = adjacency.get(id);
    if (existing) return existing;
    const created = new Set<string>();
    adjacency.set(id, created);
    return created;
  };
  for (const id of nodeIds) ensure(id);
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    ensure(edge.source).add(edge.target);
    ensure(edge.target).add(edge.source);
  }
  return adjacency;
}

export function findConnectedComponents(
  nodeIds: string[],
  adjacency: Map<string, Set<string>>
): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const start of nodeIds) {
    if (seen.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const vertex = queue.shift()!;
      component.push(vertex);
      for (const neighbor of adjacency.get(vertex) ?? []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * Planar embedding of the whole graph.
 *
 * The graph is split into biconnected blocks, each block is embedded on its own
 * with the DMP (Demoucron-Malgrange-Pertuiset) path-addition algorithm, and the
 * per-block rotations are concatenated at the cut vertices they share. Gluing
 * planar embeddings at a cut vertex always stays planar, so the concatenation
 * needs no extra checks beyond the Euler formula assertion at the end.
 */
export function embedPlanarGraph(nodeIds: string[], edges: RawEdge[]): PlanarEmbeddingResult {
  const adjacency = buildUndirectedAdjacency(nodeIds, edges);
  const allNodeIds = Array.from(adjacency.keys());
  const rotations = new Map<string, string[]>();
  for (const id of allNodeIds) rotations.set(id, []);

  for (const block of findBiconnectedBlocks(allNodeIds, adjacency)) {
    const faces = embedBlockFaces(block);
    if (!faces) return { ok: false, reason: "graph is not planar" };
    const blockRotations = rotationsFromFaces(faces);
    if (!blockRotations) return { ok: false, reason: "graph is not planar" };
    for (const [vertex, blockOrder] of blockRotations) {
      rotations.get(vertex)!.push(...blockOrder);
    }
  }

  const rotation = new RotationSystem(rotations);
  const eulerError = findEulerViolation(allNodeIds, adjacency, rotation);
  if (eulerError) return { ok: false, reason: eulerError };
  return { ok: true, rotation };
}

/** Euler's formula per connected component: V - E + F = 2 iff the embedding is planar. */
function findEulerViolation(
  nodeIds: string[],
  adjacency: Map<string, Set<string>>,
  rotation: RotationSystem
): string | null {
  const componentOf = new Map<string, number>();
  const components = findConnectedComponents(nodeIds, adjacency);
  components.forEach((component, index) => {
    for (const vertex of component) componentOf.set(vertex, index);
  });

  const faceCounts = components.map(() => 0);
  for (const face of rotation.traceFaces()) {
    faceCounts[componentOf.get(face[0])!] += 1;
  }

  for (let index = 0; index < components.length; index++) {
    const component = components[index];
    if (component.length === 1) continue;
    let halfEdges = 0;
    for (const vertex of component) halfEdges += rotation.neighbors(vertex).length;
    const vertices = component.length;
    const edgeCount = halfEdges / 2;
    if (vertices - edgeCount + faceCounts[index] !== 2) {
      return "embedding failed Euler's formula check";
    }
  }
  return null;
}

/** Hopcroft-Tarjan biconnected components, returned as edge lists. */
function findBiconnectedBlocks(
  nodeIds: string[],
  adjacency: Map<string, Set<string>>
): EdgePair[][] {
  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const edgeStack: EdgePair[] = [];
  const blocks: EdgePair[][] = [];
  let counter = 0;

  const visit = (vertex: string, parent: string | null) => {
    discovery.set(vertex, counter);
    low.set(vertex, counter);
    counter++;
    for (const neighbor of adjacency.get(vertex) ?? []) {
      if (!discovery.has(neighbor)) {
        edgeStack.push([vertex, neighbor]);
        visit(neighbor, vertex);
        low.set(vertex, Math.min(low.get(vertex)!, low.get(neighbor)!));
        if (low.get(neighbor)! >= discovery.get(vertex)!) {
          const block: EdgePair[] = [];
          while (edgeStack.length > 0) {
            const edge = edgeStack.pop()!;
            block.push(edge);
            if (edge[0] === vertex && edge[1] === neighbor) break;
          }
          blocks.push(block);
        }
      } else if (neighbor !== parent && discovery.get(neighbor)! < discovery.get(vertex)!) {
        edgeStack.push([vertex, neighbor]);
        low.set(vertex, Math.min(low.get(vertex)!, discovery.get(neighbor)!));
      }
    }
  };

  for (const id of nodeIds) {
    if (!discovery.has(id)) visit(id, null);
  }
  return blocks;
}

function edgeKey(from: string, to: string): string {
  return from < to ? `${from} ${to}` : `${to} ${from}`;
}

interface Fragment {
  attachments: string[];
  /** Vertices of the fragment that are not embedded yet. */
  interior: Set<string>;
  edges: EdgePair[];
}

/**
 * DMP path addition for one biconnected block. Starts from a cycle (two faces)
 * and repeatedly embeds a path of an unembedded fragment into a face that
 * contains all of the fragment's attachment vertices, splitting that face in
 * two. A fragment with no admissible face proves non-planarity.
 */
function embedBlockFaces(blockEdges: EdgePair[]): string[][] | null {
  const adjacency = new Map<string, Set<string>>();
  for (const [from, to] of blockEdges) {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
  }

  if (blockEdges.length === 1) {
    // A bridge has a single face whose boundary walk uses the edge twice.
    return [[blockEdges[0][0], blockEdges[0][1]]];
  }

  const cycle = findCycle(adjacency);
  if (!cycle) return null;

  let faces: string[][] = [cycle, [...cycle].reverse()];
  const embeddedVertices = new Set(cycle);
  const embeddedEdges = new Set<string>();
  for (let index = 0; index < cycle.length; index++) {
    embeddedEdges.add(edgeKey(cycle[index], cycle[(index + 1) % cycle.length]));
  }

  while (embeddedEdges.size < blockEdges.length) {
    const fragments = collectFragments(blockEdges, adjacency, embeddedVertices, embeddedEdges);
    if (fragments.length === 0) return null;

    let chosenFragment: Fragment | null = null;
    let chosenFace: string[] | null = null;
    let fewestAdmissible = Number.POSITIVE_INFINITY;
    for (const fragment of fragments) {
      const admissible = faces.filter((face) =>
        fragment.attachments.every((attachment) => face.includes(attachment))
      );
      if (admissible.length === 0) return null;
      if (admissible.length < fewestAdmissible) {
        fewestAdmissible = admissible.length;
        chosenFragment = fragment;
        chosenFace = admissible[0];
      }
    }
    if (!chosenFragment || !chosenFace) return null;

    const path = findAttachmentPath(chosenFragment);
    if (!path) return null;

    const [faceA, faceB] = splitFace(chosenFace, path);
    faces = faces.filter((face) => face !== chosenFace);
    faces.push(faceA, faceB);

    for (let index = 0; index < path.length - 1; index++) {
      embeddedEdges.add(edgeKey(path[index], path[index + 1]));
      embeddedVertices.add(path[index]);
    }
    embeddedVertices.add(path[path.length - 1]);
  }

  return faces;
}

function findCycle(adjacency: Map<string, Set<string>>): string[] | null {
  const parents = new Map<string, string | null>();
  const start = adjacency.keys().next().value;
  if (start === undefined) return null;

  const stack: string[] = [start];
  parents.set(start, null);
  while (stack.length > 0) {
    const vertex = stack.pop()!;
    for (const neighbor of adjacency.get(vertex) ?? []) {
      if (!parents.has(neighbor)) {
        parents.set(neighbor, vertex);
        stack.push(neighbor);
        continue;
      }
      if (neighbor === parents.get(vertex)) continue;
      // Back edge: walk both endpoints up to their common ancestor.
      const ancestry = new Set<string>();
      for (let node: string | null = vertex; node; node = parents.get(node) ?? null) {
        ancestry.add(node);
      }
      let meeting: string | null = neighbor;
      while (meeting && !ancestry.has(meeting)) meeting = parents.get(meeting) ?? null;
      if (!meeting) continue;

      const upward: string[] = [];
      for (let node: string | null = vertex; node && node !== meeting; node = parents.get(node) ?? null) {
        upward.push(node);
      }
      const downward: string[] = [];
      for (let node: string | null = neighbor; node && node !== meeting; node = parents.get(node) ?? null) {
        downward.push(node);
      }
      const cycle = [meeting, ...upward.reverse(), ...downward];
      if (cycle.length >= 3) return cycle;
    }
  }
  return null;
}

function collectFragments(
  blockEdges: EdgePair[],
  adjacency: Map<string, Set<string>>,
  embeddedVertices: Set<string>,
  embeddedEdges: Set<string>
): Fragment[] {
  const fragments: Fragment[] = [];
  const unembedded = blockEdges.filter(([from, to]) => !embeddedEdges.has(edgeKey(from, to)));

  for (const [from, to] of unembedded) {
    if (embeddedVertices.has(from) && embeddedVertices.has(to)) {
      fragments.push({ attachments: [from, to], interior: new Set(), edges: [[from, to]] });
    }
  }

  const assigned = new Set<string>();
  for (const [from, to] of unembedded) {
    for (const endpoint of [from, to]) {
      if (embeddedVertices.has(endpoint) || assigned.has(endpoint)) continue;
      const interior = new Set<string>();
      const attachments = new Set<string>();
      const edges: EdgePair[] = [];
      const queue = [endpoint];
      assigned.add(endpoint);
      interior.add(endpoint);
      while (queue.length > 0) {
        const vertex = queue.shift()!;
        for (const neighbor of adjacency.get(vertex) ?? []) {
          if (embeddedEdges.has(edgeKey(vertex, neighbor))) continue;
          edges.push([vertex, neighbor]);
          if (embeddedVertices.has(neighbor)) {
            attachments.add(neighbor);
            continue;
          }
          if (assigned.has(neighbor)) continue;
          assigned.add(neighbor);
          interior.add(neighbor);
          queue.push(neighbor);
        }
      }
      fragments.push({ attachments: Array.from(attachments), interior, edges });
    }
  }

  return fragments;
}

/** Path through a fragment connecting two of its attachment vertices. */
function findAttachmentPath(fragment: Fragment): string[] | null {
  if (fragment.interior.size === 0) {
    return fragment.attachments.length === 2 ? [...fragment.attachments] : null;
  }
  if (fragment.attachments.length < 2) return null;

  const neighbors = new Map<string, string[]>();
  for (const [from, to] of fragment.edges) {
    if (!neighbors.has(from)) neighbors.set(from, []);
    if (!neighbors.has(to)) neighbors.set(to, []);
    neighbors.get(from)!.push(to);
    neighbors.get(to)!.push(from);
  }

  const start = fragment.attachments[0];
  const cameFrom = new Map<string, string>();
  const queue = [start];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const vertex = queue.shift()!;
    for (const neighbor of neighbors.get(vertex) ?? []) {
      if (seen.has(neighbor)) continue;
      seen.add(neighbor);
      cameFrom.set(neighbor, vertex);
      if (!fragment.interior.has(neighbor)) {
        const path = [neighbor];
        for (let node = vertex; node !== start; node = cameFrom.get(node)!) path.push(node);
        path.push(start);
        return path.reverse();
      }
      queue.push(neighbor);
    }
  }
  return null;
}

/**
 * Splits `face` along `path`, whose endpoints both lie on the face. Both halves
 * keep the traversal direction of the original face, which is what makes the
 * face set convertible into a rotation system.
 */
function splitFace(face: string[], path: string[]): [string[], string[]] {
  const startIndex = face.indexOf(path[0]);
  const endIndex = face.indexOf(path[path.length - 1]);
  const arc = (from: number, to: number): string[] => {
    const walk: string[] = [];
    for (let index = from; index !== to; index = (index + 1) % face.length) {
      walk.push(face[index]);
    }
    walk.push(face[to]);
    return walk;
  };
  const interior = path.slice(1, -1);
  return [
    [...arc(startIndex, endIndex), ...[...interior].reverse()],
    [...arc(endIndex, startIndex), ...interior],
  ];
}

/**
 * Turns a face set into clockwise neighbour orders. For a boundary walk
 * (..., previous, vertex, next, ...) the corner at `vertex` means `next`
 * directly follows `previous` clockwise around `vertex`.
 */
function rotationsFromFaces(faces: string[][]): Map<string, string[]> | null {
  const successors = new Map<string, Map<string, string>>();
  for (const face of faces) {
    for (let index = 0; index < face.length; index++) {
      const previous = face[(index - 1 + face.length) % face.length];
      const vertex = face[index];
      const next = face[(index + 1) % face.length];
      if (!successors.has(vertex)) successors.set(vertex, new Map());
      successors.get(vertex)!.set(previous, next);
    }
  }

  const rotations = new Map<string, string[]>();
  for (const [vertex, successor] of successors) {
    const first = successor.keys().next().value as string;
    const order: string[] = [];
    let current = first;
    do {
      order.push(current);
      const next = successor.get(current);
      if (next === undefined) return null;
      current = next;
    } while (current !== first && order.length <= successor.size);
    // A vertex whose corners do not form a single cycle is not consistently embedded.
    if (order.length !== successor.size) return null;
    rotations.set(vertex, order);
  }
  return rotations;
}
