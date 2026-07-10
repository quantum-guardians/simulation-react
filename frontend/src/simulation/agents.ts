import Matter from "matter-js";
import type { Point, RawEdge } from "./graph";
import { isPointInWalkableArea, type Corridor, type JunctionHub } from "./corridors";
import { addAgentBody, removeAgentBody, FIXED_DT_MS, type PhysicsWorld } from "./physics";
import { AGENT_MAX_SPEED, ARRIVAL_RADIUS } from "./presets";

const { Body } = Matter;

export interface AdjacencyEntry {
  to: string;
  weight: number;
}

export interface OrientedEdgeDirection {
  from: string;
  to: string;
}

/** Builds a lookup from edgeId (`${source}--${target}`, matching the id
 * synthesized when POSTing to /api/solve/orient) to its solved direction,
 * for edges the solver actually oriented. Edges absent from this map
 * (never solved, or left unoriented - e.g. a bridge under Robbin) are
 * bridge/undetermined and should stay bidirectional. */
export function orientedEdgesToLookup(
  orientedEdges: { edgeId: string; from: string; to: string }[]
): Map<string, OrientedEdgeDirection> {
  return new Map(orientedEdges.map((oe) => [oe.edgeId, { from: oe.from, to: oe.to }]));
}

/**
 * Builds the adjacency used for pathfinding/steering. When
 * `orientedEdgesById` is given, an edge with a solved direction becomes a
 * one-way link (agents may only walk it from -> to); an edge with no
 * entry there (not yet solved, or left undetermined, e.g. a bridge under
 * Robbin) stays bidirectional - "if the direction is determined, only
 * move that way; if not, still free either way."
 */
export function buildAdjacency(
  nodeIds: string[],
  edges: RawEdge[],
  orientedEdgesById?: Map<string, OrientedEdgeDirection>
): Map<string, AdjacencyEntry[]> {
  const adjacency = new Map<string, AdjacencyEntry[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) {
    const edgeId = `${edge.source}--${edge.target}`;
    const oriented = orientedEdgesById?.get(edgeId);
    if (oriented) {
      adjacency.get(oriented.from)?.push({ to: oriented.to, weight: edge.weight });
    } else {
      adjacency.get(edge.source)?.push({ to: edge.target, weight: edge.weight });
      adjacency.get(edge.target)?.push({ to: edge.source, weight: edge.weight });
    }
  }
  return adjacency;
}

/** Plain-array Dijkstra - fine at the node counts this app targets (tens to
 * low hundreds); returns null if startId/endId are disconnected. */
export function shortestPath(
  adjacency: Map<string, AdjacencyEntry[]>,
  startId: string,
  endId: string
): string[] | null {
  if (!adjacency.has(startId) || !adjacency.has(endId)) return null;

  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  for (const id of adjacency.keys()) dist.set(id, Infinity);
  dist.set(startId, 0);

  for (;;) {
    let currentId: string | null = null;
    let currentDist = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < currentDist) {
        currentDist = d;
        currentId = id;
      }
    }
    if (currentId === null || currentId === endId) break;
    visited.add(currentId);

    for (const { to, weight } of adjacency.get(currentId) ?? []) {
      if (visited.has(to)) continue;
      const alt = currentDist + weight;
      if (alt < (dist.get(to) ?? Infinity)) {
        dist.set(to, alt);
        prev.set(to, currentId);
      }
    }
  }

  if ((dist.get(endId) ?? Infinity) === Infinity) return null;

  const path: string[] = [];
  let cur: string | undefined = endId;
  while (cur !== undefined) {
    path.unshift(cur);
    if (cur === startId) break;
    cur = prev.get(cur);
  }
  return path[0] === startId ? path : null;
}

/** Picks a random start/target pair from the leaf set; falls back to any
 * two distinct nodes when fewer than 2 leaves exist (e.g. a pure cycle). */
export function pickRandomEndpointPair(
  nodeIds: string[],
  leaves: string[],
  rng: () => number = Math.random
): [string, string] | null {
  const pool = leaves.length >= 2 ? leaves : nodeIds;
  if (pool.length < 2) return null;

  const first = pool[Math.floor(rng() * pool.length)];
  let second = first;
  let guard = 0;
  while (second === first && guard < 50) {
    second = pool[Math.floor(rng() * pool.length)];
    guard++;
  }
  return second === first ? null : [first, second];
}

export interface AgentRuntimeState {
  id: string;
  waypoints: Point[];
  waypointIndex: number;
  startLeaf: string;
  targetLeaf: string;
  state: "moving" | "arrived";
}

export interface SpawnAgentDeps {
  world: PhysicsWorld;
  nodePositions: Map<string, Point>;
  adjacency: Map<string, AdjacencyEntry[]>;
  nodeIds: string[];
  leaves: string[];
  rng?: () => number;
  /** When provided, the spawn position is recorded as the agent's first
   * known-valid position, so enforceContainment can recover it even if
   * the very first physics step ejects it (stacked spawns overlap heavily
   * and Matter's overlap resolution can shove bodies outside before any
   * position was recorded). */
  lastValidPositions?: Map<string, Point>;
}

const MAX_SPAWN_PAIR_ATTEMPTS = 30;

// Stacked spawns at the exact same point make Matter's overlap resolution
// violently eject bodies; a small random scatter keeps the initial pile
// loose enough to settle gently. Must stay under the smallest hub radius
// (minWidth/2 + padding = 12) so scattered spawns are still on the floor.
const SPAWN_JITTER_PX = 6;

export function spawnAgent(id: string, deps: SpawnAgentDeps): AgentRuntimeState | null {
  const { world, nodePositions, adjacency, nodeIds, leaves, rng = Math.random } = deps;

  // With one-way (solver-oriented) edges, a random leaf pair often has no
  // valid directed path even though the graph overall is fine - retry a
  // handful of pairs before giving up, so the population doesn't quietly
  // shrink just because a strict direction was just applied.
  let start: string | undefined;
  let target: string | undefined;
  let path: string[] | null = null;
  for (let attempt = 0; attempt < MAX_SPAWN_PAIR_ATTEMPTS; attempt++) {
    const pair = pickRandomEndpointPair(nodeIds, leaves, rng);
    if (!pair) return null; // fewer than 2 nodes exist at all - retrying can't help
    path = shortestPath(adjacency, pair[0], pair[1]);
    if (path) {
      [start, target] = pair;
      break;
    }
  }
  if (!path || !start || !target) return null;

  const waypoints = path
    .map((nodeId) => nodePositions.get(nodeId))
    .filter((p): p is Point => p !== undefined);
  if (waypoints.length === 0) return null;

  const jitterAngle = rng() * 2 * Math.PI;
  const jitterDist = rng() * SPAWN_JITTER_PX;
  const startPos: Point = {
    x: waypoints[0].x + Math.cos(jitterAngle) * jitterDist,
    y: waypoints[0].y + Math.sin(jitterAngle) * jitterDist,
  };
  addAgentBody(world, id, startPos.x, startPos.y);
  deps.lastValidPositions?.set(id, { x: startPos.x, y: startPos.y });

  return {
    id,
    waypoints,
    waypointIndex: Math.min(1, waypoints.length - 1),
    startLeaf: start,
    targetLeaf: target,
    state: waypoints.length > 1 ? "moving" : "arrived",
  };
}

/**
 * Direct velocity-setting steering toward the current waypoint.
 *
 * An earlier version of this function used a proportional force
 * (Body.applyForce) instead, on the theory that hard-overwriting velocity
 * every tick would fight Matter's collision response. In practice that
 * produced the opposite problem: a pure proportional controller on
 * velocity error has no damping term, and combined with per-tick collision
 * impulses from a crowded corridor it overshot and oscillated - visible as
 * heavy jitter, especially for agents pressed against a wall ("stuck"
 * agents were actually vibrating in place, not stationary). A direct,
 * deterministic velocity set has no such feedback loop to destabilize;
 * Matter's own positional correction still keeps bodies from overlapping
 * walls/each other (restitution is 0, so no bounce-back either), it just
 * does so smoothly instead of via a fighting force.
 *
 * IMPORTANT: call this once per fixed physics tick (inside the same
 * accumulator loop as stepPhysicsFixed), not once per rendered frame -
 * otherwise waypoint-arrival is only checked at frame cadence, and a slow
 * frame can let an agent overshoot several ticks past a waypoint before
 * the next check, which also reads as the agent doubling back.
 */
export function updateAgentSteering(
  agents: AgentRuntimeState[],
  world: PhysicsWorld,
  maxSpeed: number = AGENT_MAX_SPEED,
  arrivalRadius: number = ARRIVAL_RADIUS
): void {
  const speedPerTick = maxSpeed * (FIXED_DT_MS / 1000);

  for (const agent of agents) {
    if (agent.state === "arrived") continue;
    const body = world.agentBodies.get(agent.id);
    if (!body) continue;

    const waypoint = agent.waypoints[agent.waypointIndex];
    if (!waypoint) {
      agent.state = "arrived";
      Body.setVelocity(body, { x: 0, y: 0 });
      continue;
    }

    const dx = waypoint.x - body.position.x;
    const dy = waypoint.y - body.position.y;
    const dist = Math.hypot(dx, dy);

    if (dist < arrivalRadius) {
      if (agent.waypointIndex >= agent.waypoints.length - 1) {
        agent.state = "arrived";
        Body.setVelocity(body, { x: 0, y: 0 });
      } else {
        agent.waypointIndex += 1;
      }
      continue;
    }

    Body.setVelocity(body, {
      x: (dx / dist) * speedPerTick,
      y: (dy / dist) * speedPerTick,
    });
  }
}

// Slack for the physics solver's positional slop; an agent's center may sit
// a hair outside the floor while pressed against a wall without being "out".
const CONTAINMENT_TOLERANCE = 2;

/**
 * Hard "never visibly tunnel" guarantee, independent of solver behavior:
 * any agent whose center has ended up outside the walkable floor (corridor
 * rectangles + hub disks) is snapped back to the last position where it was
 * inside, with velocity zeroed. Wall bodies, substepping, and rim segments
 * make escapes rare; this catches whatever slips through anyway (e.g. an
 * overlap-resolution shove past a thin wall's midplane under heavy crowd
 * pressure). Call once per fixed tick, after stepPhysicsFixed.
 */
export function enforceContainment(
  world: PhysicsWorld,
  corridors: Corridor[],
  hubs: JunctionHub[],
  lastValidPositions: Map<string, Point>
): void {
  for (const [id, body] of world.agentBodies) {
    if (isPointInWalkableArea(body.position, corridors, hubs, CONTAINMENT_TOLERANCE)) {
      lastValidPositions.set(id, { x: body.position.x, y: body.position.y });
      continue;
    }
    const lastValid = lastValidPositions.get(id);
    if (!lastValid) continue; // spawned at a node center, so this shouldn't occur
    Body.setPosition(body, lastValid);
    Body.setVelocity(body, { x: 0, y: 0 });
  }
}

/** Replaces every arrived agent with a freshly spawned one at a new random
 * leaf pair, keeping the standing population count steady. Agents that
 * fail to respawn (e.g. spawnAgent returns null) are left as "arrived". */
export function respawnArrivedAgents(
  agents: AgentRuntimeState[],
  deps: SpawnAgentDeps
): AgentRuntimeState[] {
  return agents.map((agent) => {
    if (agent.state !== "arrived") return agent;
    removeAgentBody(deps.world, agent.id);
    return spawnAgent(agent.id, deps) ?? agent;
  });
}
