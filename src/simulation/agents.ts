import type { Point, RawEdge } from "./graph";
import { isPointInWalkableArea, type Corridor, type JunctionHub } from "./corridors";
import { addAgent, removeAgent, type DesiredMotion, type SfmWorld } from "./socialForce";
import {
  AGENT_MAX_SPEED,
  AGENT_LANE_OFFSET,
  AGENT_SPEED_VARIANCE_MAX,
  AGENT_SPEED_VARIANCE_MIN,
  ARRIVAL_RADIUS,
  RESPAWN_BATCH_SIZE,
  STUCK_BOOST_MAX,
  STUCK_JITTER_MAX_RAD,
  STUCK_PATIENCE_TICKS,
  STUCK_RAMP_TICKS,
  STUCK_SOCIAL_FORCE_MIN,
} from "./presets";

/** Rotates a unit direction by `theta` radians. */
function rotateDirection(ex: number, ey: number, theta: number): { ex: number; ey: number } {
  if (theta === 0) return { ex, ey };
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return { ex: ex * cos - ey * sin, ey: ex * sin + ey * cos };
}

/** Returns the next node shifted to the right of the directed path segment.
 * Since the reverse direction has the opposite normal, opposing flows get
 * separate physical lanes while still sharing the same graph edge. */
function rightLaneTarget(from: Point | undefined, to: Point): Point {
  if (!from) return to;
  const sx = to.x - from.x;
  const sy = to.y - from.y;
  const length = Math.hypot(sx, sy);
  if (length <= 1e-9) return to;
  return {
    x: to.x - (sy / length) * AGENT_LANE_OFFSET,
    y: to.y + (sx / length) * AGENT_LANE_OFFSET,
  };
}

function rightNormal(from: Point, to: Point): Point {
  const sx = to.x - from.x;
  const sy = to.y - from.y;
  const length = Math.hypot(sx, sy);
  if (length <= 1e-9) return { x: 0, y: 0 };
  return { x: -sy / length, y: sx / length };
}

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
  state: "moving" | "arrived" | "dead";
  /** Multiplier on the base max speed, fixed for this agent's lifetime, so
   * a crowd doesn't all cruise at one identical speed. spawnAgent assigns
   * one in [AGENT_SPEED_VARIANCE_MIN, AGENT_SPEED_VARIANCE_MAX); treated as
   * 1 (no variance) when omitted, e.g. for runtime states built by hand. */
  speedFactor?: number;
  /** Accumulated ticks without meaningful distance reduction toward the
   * current waypoint - see computeDesiredDirections. */
  stuckTicks?: number;
  /** Distance to the current waypoint on the previous fixed tick. Used to
   * detect real positional progress instead of trusting velocity, which can
   * be non-zero while collision correction keeps the body in one place. */
  lastWaypointDistance?: number;
  /** Current normalized crowd-compression estimate. */
  pressure?: number;
  /** Consecutive-equivalent physics ticks spent above fatal pressure. */
  highPressureTicks?: number;
}

export interface SpawnAgentDeps {
  world: SfmWorld;
  nodePositions: Map<string, Point>;
  adjacency: Map<string, AdjacencyEntry[]>;
  nodeIds: string[];
  leaves: string[];
  rng?: () => number;
  /** When provided, the spawn position is recorded as the agent's first
   * known-valid position, so enforceContainment can recover it even if
   * the very first physics step ejects it (stacked spawns overlap heavily
   * and the overlap resolution can shove agents outside before any
   * position was recorded). */
  lastValidPositions?: Map<string, Point>;
}

const MAX_SPAWN_PAIR_ATTEMPTS = 30;

// Spread new pedestrians along the beginning of their first directed lane.
// This avoids building a dense pile at the node center before steering has
// even had one physics tick to separate it.
const SPAWN_FORWARD_SPREAD_PX = 10;
const SPAWN_LATERAL_JITTER_PX = 1;

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

  const secondWaypoint = waypoints[1];
  const normal = secondWaypoint
    ? rightNormal(waypoints[0], secondWaypoint)
    : { x: 0, y: 0 };
  const segmentLength = secondWaypoint
    ? Math.hypot(secondWaypoint.x - waypoints[0].x, secondWaypoint.y - waypoints[0].y)
    : 0;
  const forward = secondWaypoint
    ? {
        x: (secondWaypoint.x - waypoints[0].x) / Math.max(segmentLength, 1e-9),
        y: (secondWaypoint.y - waypoints[0].y) / Math.max(segmentLength, 1e-9),
      }
    : { x: 0, y: 0 };
  const forwardDistance = rng() * Math.min(SPAWN_FORWARD_SPREAD_PX, segmentLength * 0.2);
  const lateralDistance =
    AGENT_LANE_OFFSET + (rng() * 2 - 1) * SPAWN_LATERAL_JITTER_PX;
  const startPos: Point = {
    x: waypoints[0].x + forward.x * forwardDistance + normal.x * lateralDistance,
    y: waypoints[0].y + forward.y * forwardDistance + normal.y * lateralDistance,
  };
  addAgent(world, id, startPos.x, startPos.y);
  deps.lastValidPositions?.set(id, { x: startPos.x, y: startPos.y });

  const speedFactor =
    AGENT_SPEED_VARIANCE_MIN + rng() * (AGENT_SPEED_VARIANCE_MAX - AGENT_SPEED_VARIANCE_MIN);

  return {
    id,
    waypoints,
    waypointIndex: Math.min(1, waypoints.length - 1),
    startLeaf: start,
    targetLeaf: target,
    state: waypoints.length > 1 ? "moving" : "arrived",
    speedFactor,
  };
}

/**
 * Computes each moving agent's desired direction + speed toward its current
 * waypoint (the "e_i · v0_i" input of the social force model), advancing
 * waypoints and arrival state as a side effect. The returned map feeds
 * stepSocialForce, which turns it into a driving force — actual velocities
 * emerge from that force combined with agent/wall repulsion, so this
 * function never writes velocities for moving agents.
 *
 * IMPORTANT: call this once per fixed physics tick (inside the same
 * accumulator loop as stepSocialForce), not once per rendered frame -
 * otherwise waypoint-arrival is only checked at frame cadence, and a slow
 * frame can let an agent overshoot several ticks past a waypoint before
 * the next check, which reads as the agent doubling back.
 */
export function computeDesiredDirections(
  agents: AgentRuntimeState[],
  world: SfmWorld,
  maxSpeed: number = AGENT_MAX_SPEED,
  arrivalRadius: number = ARRIVAL_RADIUS
): Map<string, DesiredMotion> {
  const desired = new Map<string, DesiredMotion>();

  for (const agent of agents) {
    if (agent.state !== "moving") continue;
    const sfmAgent = world.agents.get(agent.id);
    if (!sfmAgent) continue;

    const waypoint = agent.waypoints[agent.waypointIndex];
    if (!waypoint) {
      agent.state = "arrived";
      continue;
    }

    const baseSpeed = maxSpeed * (agent.speedFactor ?? 1);

    let previousWaypoint = agent.waypoints[agent.waypointIndex - 1];
    let laneTarget = rightLaneTarget(previousWaypoint, waypoint);
    let dx = laneTarget.x - sfmAgent.position.x;
    let dy = laneTarget.y - sfmAgent.position.y;
    let dist = Math.hypot(dx, dy);

    // A crowded junction can shove an agent just beyond a waypoint without
    // ever putting its center inside the arrival circle. Treat crossing the
    // plane through the waypoint, perpendicular to the incoming path, as an
    // arrival too. Otherwise it turns around toward a point now behind it
    // and can oscillate forever in the middle of the junction.
    const passedWaypoint =
      previousWaypoint !== undefined &&
      (sfmAgent.position.x - waypoint.x) * (waypoint.x - previousWaypoint.x) +
        (sfmAgent.position.y - waypoint.y) * (waypoint.y - previousWaypoint.y) >=
        0;

    if (dist < arrivalRadius || passedWaypoint) {
      if (agent.waypointIndex >= agent.waypoints.length - 1) {
        agent.state = "arrived";
        continue;
      }
      agent.waypointIndex += 1;
      agent.lastWaypointDistance = undefined;
      // Emit this tick's desired motion toward the NEXT waypoint so the
      // agent doesn't coast (undriven) for a tick at every corner.
      const next = agent.waypoints[agent.waypointIndex];
      previousWaypoint = agent.waypoints[agent.waypointIndex - 1];
      laneTarget = rightLaneTarget(previousWaypoint, next);
      dx = laneTarget.x - sfmAgent.position.x;
      dy = laneTarget.y - sfmAgent.position.y;
      dist = Math.hypot(dx, dy);
      if (dist <= 1e-9) continue;
    }

    const goalEx = dx / dist;
    const goalEy = dy / dist;

    // Impatience: track progress toward the goal (velocity component along
    // goalEx/goalEy), not raw speed - a jammed agent can still be bouncing
    // at full speed sideways/backward off neighbors while making no actual
    // headway, which a raw-speed check would miss entirely. Past a patience
    // window, low progress ramps up both the desired speed (push harder)
    // and a consistent rightward deviation from the straight line - the model's
    // fluctuation term, needed to break a geometric arch at a bottleneck
    // that a straight-line push alone can't (the forces holding a stable
    // arch together are already balanced regardless of magnitude; only a
    // change of angle breaks it). Recovers instantly once progress resumes.
    const expectedProgressPerTick = baseSpeed / 60;
    const actualProgress =
      agent.lastWaypointDistance === undefined
        ? expectedProgressPerTick
        : agent.lastWaypointDistance - dist;
    agent.lastWaypointDistance = dist;
    const isMakingProgress = actualProgress >= expectedProgressPerTick * 0.1;
    // Decay instead of resetting immediately. In a real jam an agent often
    // makes one good tick of progress between many blocked ticks; resetting
    // here prevented impatience from ever activating in exactly that case.
    agent.stuckTicks =
      isMakingProgress
        ? Math.max(0, (agent.stuckTicks ?? 0) - 4)
        : (agent.stuckTicks ?? 0) + 1;
    const ticksPastPatience = Math.max(0, agent.stuckTicks - STUCK_PATIENCE_TICKS);
    const impatience = Math.min(1, ticksPastPatience / STUCK_RAMP_TICKS);
    const speed = baseSpeed * (1 + impatience * STUCK_BOOST_MAX);
    const socialScale = 1 - impatience * (1 - STUCK_SOCIAL_FORCE_MIN);

    // Always bias to the agent's right (positive rotation in canvas
    // coordinates). Two head-on agents then choose opposite physical sides
    // of the corridor. Random left/right choices can put both on the same
    // side and recreate a perfectly stable face-to-face deadlock.
    const theta = impatience * STUCK_JITTER_MAX_RAD;

    desired.set(agent.id, {
      ...rotateDirection(goalEx, goalEy, theta),
      speed,
      socialScale,
      minForwardSpeed: baseSpeed * (0.4 + impatience * 0.4),
    });
  }

  return desired;
}

/**
 * Advances the live canvas population with route-priority motion.
 *
 * The Social Force solver remains available as a separately tested model,
 * but dense bidirectional crowds can reach a mathematically stable force
 * equilibrium where nobody moves. The product requirement is stronger:
 * every agent with a route must keep making progress. This integrator makes
 * the desired route velocity authoritative, while the right-hand lane and
 * hard floor containment still keep movement inside the drawn network.
 */
export function stepRouteMotion(
  world: SfmWorld,
  desired: Map<string, DesiredMotion>,
  dtMs: number
): void {
  const dt = dtMs / 1000;
  for (const body of world.agents.values()) {
    const motion = desired.get(body.id);
    if (!motion) {
      body.velocity.x = 0;
      body.velocity.y = 0;
      continue;
    }

    body.velocity.x = motion.ex * motion.speed;
    body.velocity.y = motion.ey * motion.speed;
    body.position.x += body.velocity.x * dt;
    body.position.y += body.velocity.y * dt;
  }
}

/** Keeps Social Force lateral motion near the current directed lane without
 * rewinding longitudinal progress. Unlike last-valid-position containment,
 * projection to the nearest point on the current lane cannot pin an agent
 * at a hub entrance. */
export function constrainAgentsToRoutes(
  agents: AgentRuntimeState[],
  world: SfmWorld,
  maxLateralDistance = 8
): void {
  for (const agent of agents) {
    if (agent.state !== "moving") continue;
    const body = world.agents.get(agent.id);
    const from = agent.waypoints[agent.waypointIndex - 1];
    const to = agent.waypoints[agent.waypointIndex];
    if (!body || !from || !to) continue;

    const normal = rightNormal(from, to);
    const laneStart = {
      x: from.x + normal.x * AGENT_LANE_OFFSET,
      y: from.y + normal.y * AGENT_LANE_OFFSET,
    };
    const laneEnd = {
      x: to.x + normal.x * AGENT_LANE_OFFSET,
      y: to.y + normal.y * AGENT_LANE_OFFSET,
    };
    const sx = laneEnd.x - laneStart.x;
    const sy = laneEnd.y - laneStart.y;
    const lengthSq = sx * sx + sy * sy;
    if (lengthSq <= 1e-9) continue;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((body.position.x - laneStart.x) * sx +
          (body.position.y - laneStart.y) * sy) /
          lengthSq
      )
    );
    const nearest = {
      x: laneStart.x + sx * t,
      y: laneStart.y + sy * t,
    };
    const dx = body.position.x - nearest.x;
    const dy = body.position.y - nearest.y;
    const lateralDistance = Math.hypot(dx, dy);
    if (lateralDistance <= maxLateralDistance) continue;
    const scale = maxLateralDistance / lateralDistance;
    body.position.x = nearest.x + dx * scale;
    body.position.y = nearest.y + dy * scale;
  }
}

// Slack for the physics solver's positional slop; an agent's center may sit
// a hair outside the floor while pressed against a wall without being "out".
const CONTAINMENT_TOLERANCE = 2;

/**
 * Hard "never visibly tunnel" guarantee, independent of solver behavior:
 * any agent whose center has ended up outside the walkable floor (corridor
 * rectangles + hub disks) is snapped back to the last position where it was
 * inside, with velocity zeroed. Wall repulsion, substepping, and the
 * crossing checks in stepSocialForce make escapes rare; this catches
 * whatever slips through anyway (e.g. a shove past the end of a wall
 * segment under heavy crowd pressure). Call once per fixed tick, after
 * stepSocialForce.
 */
export function enforceContainment(
  world: SfmWorld,
  corridors: Corridor[],
  hubs: JunctionHub[],
  lastValidPositions: Map<string, Point>
): void {
  for (const [id, agent] of world.agents) {
    if (isPointInWalkableArea(agent.position, corridors, hubs, CONTAINMENT_TOLERANCE)) {
      lastValidPositions.set(id, { x: agent.position.x, y: agent.position.y });
      continue;
    }
    const lastValid = lastValidPositions.get(id);
    if (!lastValid) continue; // spawned at a node center, so this shouldn't occur
    agent.position.x = lastValid.x;
    agent.position.y = lastValid.y;
    agent.velocity.x = 0;
    agent.velocity.y = 0;
  }
}

/** Gives arrived agents a new reachable destination from their current
 * destination node, preserving position and velocity. This makes movement
 * continuous: reaching a node ends one trip and starts the next instead of
 * entering a stationary state and teleporting elsewhere.
 *
 * A directed graph may contain a sink with no reachable destination. Only
 * in that case do we fall back to a fresh spawn from another valid pair. */
export function continueArrivedAgents(
  agents: AgentRuntimeState[],
  deps: SpawnAgentDeps,
  maxAssignments: number = RESPAWN_BATCH_SIZE
): AgentRuntimeState[] {
  const rng = deps.rng ?? Math.random;
  let assigned = 0;

  return agents.map((agent) => {
    if (agent.state !== "arrived" || assigned >= maxAssignments) return agent;
    assigned++;

    const destinationPool = deps.leaves.length >= 2 ? deps.leaves : deps.nodeIds;
    for (let attempt = 0; attempt < MAX_SPAWN_PAIR_ATTEMPTS; attempt++) {
      const target = destinationPool[Math.floor(rng() * destinationPool.length)];
      if (!target || target === agent.targetLeaf) continue;
      const path = shortestPath(deps.adjacency, agent.targetLeaf, target);
      if (!path || path.length < 2) continue;
      const waypoints = path
        .map((nodeId) => deps.nodePositions.get(nodeId))
        .filter((point): point is Point => point !== undefined);
      if (waypoints.length !== path.length) continue;

      agent.waypoints = waypoints;
      agent.waypointIndex = 1;
      agent.startLeaf = agent.targetLeaf;
      agent.targetLeaf = target;
      agent.state = "moving";
      agent.stuckTicks = 0;
      agent.lastWaypointDistance = undefined;
      return agent;
    }

    const oldBody = deps.world.agents.get(agent.id);
    const oldPosition = oldBody ? { ...oldBody.position } : null;
    const oldVelocity = oldBody ? { ...oldBody.velocity } : null;
    const oldRadius = oldBody?.radius;
    removeAgent(deps.world, agent.id);
    const replacement = spawnAgent(agent.id, deps);
    if (replacement) return replacement;

    // Keep state and physics world consistent if even the fallback cannot
    // find a directed route. The next tick can retry after graph changes.
    if (oldPosition) {
      const restored = addAgent(
        deps.world,
        agent.id,
        oldPosition.x,
        oldPosition.y,
        oldRadius
      );
      if (oldVelocity) restored.velocity = oldVelocity;
    }
    return agent;
  });
}
