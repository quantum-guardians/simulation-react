import type { Point } from "./graph";
import {
  buildWallSegments,
  type Corridor,
  type JunctionHub,
  type WallSegment,
} from "./corridors";
import {
  buildSpatialGrid,
  createSpatialGrid,
  forEachNeighborPair,
} from "./spatialGrid";
import {
  AGENT_MAX_SPEED,
  AGENT_RADIUS,
  SFM_A_AGENT,
  SFM_A_WALL,
  SFM_ANISOTROPY_LAMBDA,
  SFM_B_AGENT,
  SFM_B_WALL,
  SFM_CUTOFF_FACTOR,
  SFM_K_BODY,
  SFM_KAPPA,
  SFM_MAX_ACCEL,
  SFM_SPEED_FACTOR,
  SFM_TAU,
} from "./presets";

/**
 * Social Force Model (Helbing & Molnár) crowd dynamics.
 *
 * Each agent experiences:
 *  - a driving force relaxing its velocity toward `desired speed × desired
 *    direction` over SFM_TAU seconds;
 *  - social repulsion from nearby agents, exponential in the gap
 *    (A·exp((r_ij − d)/B)·n), weighted per-agent by an anisotropic factor
 *    (full strength ahead, SFM_ANISOTROPY_LAMBDA behind - see presets.ts)
 *    so nobody dodges what's behind them as hard as what's ahead, plus —
 *    only while bodies actually overlap — a body-contact spring (k·g·n)
 *    and tangential sliding friction (κ·g·Δv_t·t), the Helbing (2000)
 *    granular terms that make dense crowds shove and squeeze realistically;
 *  - the same repulsion/contact terms from the nearest point of each wall
 *    segment.
 *
 * Mass is normalized to 1, so forces are accelerations (px/s²). Integration
 * is semi-implicit Euler with substepping and a velocity cap, which keeps
 * the stiff contact terms stable at 60 Hz.
 */

export interface SfmAgent {
  id: string;
  position: Point;
  velocity: Point;
  radius: number;
}

export interface SfmWorld {
  walls: WallSegment[];
  agents: Map<string, SfmAgent>;
}

/** Unit direction + desired speed toward the current waypoint. Agents with
 * no entry (arrived, or unknown) get a zero desired velocity and brake. */
export interface DesiredMotion {
  ex: number;
  ey: number;
  speed: number;
  /** Route-priority floor applied after all Social Force acceleration. */
  minForwardSpeed?: number;
  /** Multiplier for long-range agent repulsion. Contact forces are never
   * scaled, so values below 1 help break a jam without allowing overlap. */
  socialScale?: number;
}

export const FIXED_DT_MS = 1000 / 60;

// Max distance any agent may travel within a single substep. The exponential
// repulsion varies on the SFM_B (~4 px) scale, so per-substep displacement
// must stay well below it or a fast agent can overshoot past a wall's force
// peak before ever feeling it.
const MAX_STEP_DISPLACEMENT_PX = 3;

// Even at low speeds, contact forces from a dense pile need at least two
// force evaluations per 60 Hz tick to relax without popping.
const MIN_SUBSTEPS = 2;

export function createSfmWorld(): SfmWorld {
  return { walls: [], agents: new Map() };
}

/** Replaces the wall set from the current corridor floor plan. Cheap (plain
 * arrays), safe to call on every floor-plan edit. */
export function rebuildWalls(world: SfmWorld, corridors: Corridor[], hubs: JunctionHub[]): void {
  // Hub-rim chords look like a safe enclosure, but their endpoints create
  // tiny collision wedges exactly where a directed lane enters a corridor.
  // Under pressure, agents become permanently pinned in those wedges. The
  // hard walkable-area containment pass already prevents escapes from hub
  // disks, so runtime physics only needs the two side walls of each
  // corridor. Keep `hubs` in the signature because callers rebuild both
  // parts of the floor plan together.
  void hubs;
  world.walls = buildWallSegments(corridors, []);
}

export function addAgent(
  world: SfmWorld,
  id: string,
  x: number,
  y: number,
  radius: number = AGENT_RADIUS
): SfmAgent {
  const agent: SfmAgent = {
    id,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    radius,
  };
  world.agents.set(id, agent);
  return agent;
}

export function removeAgent(world: SfmWorld, id: string): void {
  world.agents.delete(id);
}

function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq < 1e-12) return a;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** Deterministic unit vector for the d≈0 singularity, so exactly-stacked
 * agents separate reproducibly instead of dividing by zero. */
function separationDirection(i: number, j: number): { x: number; y: number } {
  const seed = Math.abs((i + 1) * 73856093 + (j + 1) * 19349663);
  const angle = (seed % 6283) / 1000;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

// Per-substep bound on positional correction, so a deeply-overlapped spawn
// pile inflates gradually over a few ticks instead of chain-pushing an agent
// tens of pixels in one substep — a jump that large can leap diagonally past
// a wall corner, outside every segment's span, and dodge crossing detection.
const MAX_OVERLAP_CORRECTION_PX = 2.5;

/**
 * Scratch buffers reused across stepSocialForce calls. The step runs at
 * 60 Hz × substeps, so per-call Float64Array/closure allocation shows up
 * directly as GC pauses; everything sized by agent/wall count lives here
 * and only grows. Safe as module state because steps never run
 * concurrently or reentrantly.
 */
const scratch = {
  capacity: 0,
  ax: new Float64Array(0),
  ay: new Float64Array(0),
  previousX: new Float64Array(0),
  previousY: new Float64Array(0),
  posX: new Float64Array(0),
  posY: new Float64Array(0),
  pushX: new Float64Array(0),
  pushY: new Float64Array(0),
  /** Per-agent interaction radius (radius × socialScale, see below). */
  effRadius: new Float64Array(0),
  socialScale: new Float64Array(0),
  desiredEx: new Float64Array(0),
  desiredEy: new Float64Array(0),
  hasDesired: new Uint8Array(0),
  agents: [] as SfmAgent[],
  grid: createSpatialGrid(),
  wallCapacity: 0,
  wallMinX: new Float64Array(0),
  wallMinY: new Float64Array(0),
  wallMaxX: new Float64Array(0),
  wallMaxY: new Float64Array(0),
  /** Extra AABB slack per wall covering the ±5% span tolerance used by
   * resolveWallCollisions' crossing check. */
  wallSpanSlack: new Float64Array(0),
};

function ensureAgentCapacity(n: number): void {
  if (scratch.capacity >= n) return;
  const capacity = Math.max(n, scratch.capacity * 2, 64);
  scratch.capacity = capacity;
  scratch.ax = new Float64Array(capacity);
  scratch.ay = new Float64Array(capacity);
  scratch.previousX = new Float64Array(capacity);
  scratch.previousY = new Float64Array(capacity);
  scratch.posX = new Float64Array(capacity);
  scratch.posY = new Float64Array(capacity);
  scratch.pushX = new Float64Array(capacity);
  scratch.pushY = new Float64Array(capacity);
  scratch.effRadius = new Float64Array(capacity);
  scratch.socialScale = new Float64Array(capacity);
  scratch.desiredEx = new Float64Array(capacity);
  scratch.desiredEy = new Float64Array(capacity);
  scratch.hasDesired = new Uint8Array(capacity);
}

function ensureWallCapacity(count: number): void {
  if (scratch.wallCapacity >= count) return;
  scratch.wallCapacity = count;
  scratch.wallMinX = new Float64Array(count);
  scratch.wallMinY = new Float64Array(count);
  scratch.wallMaxX = new Float64Array(count);
  scratch.wallMaxY = new Float64Array(count);
  scratch.wallSpanSlack = new Float64Array(count);
}

/**
 * Positional overlap resolution, run after force integration each substep.
 * The contact spring alone cannot stop a fast head-on approach within one
 * substep (a stiff-enough spring would need a far smaller dt), so any
 * remaining interpenetration is removed geometrically: each agent of an
 * overlapping pair is pushed out by half the overlap. Corrections are
 * accumulated per agent and applied once, clamped to
 * MAX_OVERLAP_CORRECTION_PX. Symmetric per pair, so it preserves the
 * model's momentum symmetry. Candidate pairs come from the spatial grid
 * (rebuilt here because integration just moved everyone).
 */
function resolveAgentOverlaps(
  agents: SfmAgent[],
  n: number,
  maxEffRadius: number
): void {
  const { posX, posY, pushX, pushY, effRadius, grid } = scratch;
  pushX.fill(0, 0, n);
  pushY.fill(0, 0, n);
  for (let i = 0; i < n; i++) {
    posX[i] = agents[i].position.x;
    posY[i] = agents[i].position.y;
  }
  buildSpatialGrid(grid, posX, posY, n, Math.max(2 * maxEffRadius, 1));

  forEachNeighborPair(grid, (i, j) => {
    // Canonical order so separationDirection stays deterministic
    // regardless of grid visit order.
    if (i > j) {
      const swap = i;
      i = j;
      j = swap;
    }
    const ai = agents[i];
    const aj = agents[j];
    const rij = effRadius[i] + effRadius[j];
    let dx = ai.position.x - aj.position.x;
    let dy = ai.position.y - aj.position.y;
    if (dx > rij || dx < -rij || dy > rij || dy < -rij) return;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= rij) return;
    if (dist < 1e-6) {
      const dir = separationDirection(i, j);
      dx = dir.x;
      dy = dir.y;
      dist = 1;
    }
    const push = (rij - dist) / 2;
    const nx = dx / dist;
    const ny = dy / dist;
    pushX[i] += nx * push;
    pushY[i] += ny * push;
    pushX[j] -= nx * push;
    pushY[j] -= ny * push;
  });

  for (let i = 0; i < n; i++) {
    let cx = pushX[i];
    let cy = pushY[i];
    if (cx === 0 && cy === 0) continue;
    const magnitude = Math.sqrt(cx * cx + cy * cy);
    if (magnitude > MAX_OVERLAP_CORRECTION_PX) {
      const scale = MAX_OVERLAP_CORRECTION_PX / magnitude;
      cx *= scale;
      cy *= scale;
    }
    agents[i].position.x += cx;
    agents[i].position.y += cy;
  }
}

/**
 * Keeps agents on their own side of every wall, run last each substep (so
 * walls win over agent-agent pushes). Handles two cases the repulsive force
 * cannot: (a) residual penetration — projected back out to exactly the
 * agent radius; (b) an agent whose center was shoved across the wall line
 * within one substep — without this, the wall normal flips and the "wall"
 * force ejects the agent out the far side. Crossing is detected by the sign
 * flip of the cross product against the segment, and the agent is snapped
 * back to its previous side. Inward normal velocity is zeroed on contact so
 * the next substep doesn't immediately re-penetrate.
 */
function resolveWallCollisions(
  agent: SfmAgent,
  walls: WallSegment[],
  previousX: number,
  previousY: number
): void {
  const { wallMinX, wallMinY, wallMaxX, wallMaxY, wallSpanSlack } = scratch;
  for (let w = 0; w < walls.length; w++) {
    // Cheap AABB reject (position re-read per wall - an earlier wall in
    // this loop may have just snapped the agent). Slack covers the agent
    // radius, one substep of travel plus overlap correction, and the ±5%
    // span tolerance of the crossing check below.
    const x = agent.position.x;
    const y = agent.position.y;
    const reject = agent.radius + 8 + wallSpanSlack[w];
    if (
      x < wallMinX[w] - reject ||
      x > wallMaxX[w] + reject ||
      y < wallMinY[w] - reject ||
      y > wallMaxY[w] + reject
    ) {
      continue;
    }
    const wall = walls[w];
    const wx = wall.b.x - wall.a.x;
    const wy = wall.b.y - wall.a.y;
    const lengthSq = wx * wx + wy * wy;
    if (lengthSq < 1e-12) continue;

    const crossPrevious = wx * (previousY - wall.a.y) - wy * (previousX - wall.a.x);
    const crossCurrent = wx * (agent.position.y - wall.a.y) - wy * (agent.position.x - wall.a.x);
    const t =
      ((agent.position.x - wall.a.x) * wx + (agent.position.y - wall.a.y) * wy) / lengthSq;
    const withinSpan = t >= -0.05 && t <= 1.05;

    const crossed = withinSpan && crossPrevious * crossCurrent < 0;
    const closest = closestPointOnSegment(agent.position, wall.a, wall.b);
    const dx = agent.position.x - closest.x;
    const dy = agent.position.y - closest.y;
    const dist = Math.hypot(dx, dy);

    if (!crossed && dist >= agent.radius) continue;

    // Outward normal, taken from the side the agent came from.
    let nx: number;
    let ny: number;
    if (crossed) {
      const previousClosest = closestPointOnSegment({ x: previousX, y: previousY }, wall.a, wall.b);
      const pdx = previousX - previousClosest.x;
      const pdy = previousY - previousClosest.y;
      const pdist = Math.hypot(pdx, pdy);
      if (pdist > 1e-9) {
        nx = pdx / pdist;
        ny = pdy / pdist;
      } else {
        // Previous position sat exactly on the line; use its cross sign.
        const invLength = 1 / Math.sqrt(lengthSq);
        const sign = crossPrevious >= 0 ? 1 : -1;
        nx = -wy * invLength * sign;
        ny = wx * invLength * sign;
      }
    } else {
      if (dist < 1e-9) continue;
      nx = dx / dist;
      ny = dy / dist;
    }

    agent.position.x = closest.x + nx * agent.radius;
    agent.position.y = closest.y + ny * agent.radius;

    const inwardSpeed = agent.velocity.x * nx + agent.velocity.y * ny;
    if (inwardSpeed < 0) {
      agent.velocity.x -= inwardSpeed * nx;
      agent.velocity.y -= inwardSpeed * ny;
    }
  }
}

/**
 * Advances the world by one fixed tick of `dtMs`, internally subdivided so
 * no agent moves more than MAX_STEP_DISPLACEMENT_PX per force evaluation.
 * `desired` supplies each moving agent's waypoint direction and speed
 * (see computeDesiredDirections in agents.ts); `maxSpeed` bounds the
 * substep count and caps agents that have no desired entry.
 */
export function stepSocialForce(
  world: SfmWorld,
  desired: Map<string, DesiredMotion>,
  dtMs: number = FIXED_DT_MS,
  maxSpeed: number = AGENT_MAX_SPEED
): void {
  const agents = scratch.agents;
  agents.length = 0;
  for (const agent of world.agents.values()) agents.push(agent);
  const n = agents.length;
  if (n === 0) return;
  ensureAgentCapacity(n);

  const displacementPerStep = (maxSpeed * dtMs) / 1000;
  const substeps = Math.max(
    MIN_SUBSTEPS,
    Math.ceil(displacementPerStep / MAX_STEP_DISPLACEMENT_PX)
  );
  const dt = dtMs / 1000 / substeps;
  // Friction acts as damping with coefficient κ·g; cap it so one substep can
  // never overshoot and reverse a tangential velocity difference (which
  // would inject energy instead of dissipating it).
  const maxFrictionCoefficient = 0.5 / dt;

  const agentCutoff = SFM_CUTOFF_FACTOR * SFM_B_AGENT;
  const wallCutoff = SFM_CUTOFF_FACTOR * SFM_B_WALL;

  // Repulsive (social + contact) acceleration accumulators, plus each
  // agent's pre-integration position for wall-crossing detection.
  const {
    ax,
    ay,
    previousX,
    previousY,
    posX,
    posY,
    effRadius,
    socialScale,
    desiredEx,
    desiredEy,
    hasDesired,
    grid,
  } = scratch;

  // Hoist the per-agent Map lookups out of the O(pairs) loop: desired
  // motion (and thus socialScale / interaction radius) is fixed for the
  // whole tick. A fully jammed pedestrian's socialScale can reach 0 -
  // a "ghost" to other pedestrians - but its full radius is still used
  // for every wall interaction, so deadlock recovery cannot tunnel
  // through the corridor boundary.
  let maxEffRadius = 0;
  for (let i = 0; i < n; i++) {
    const motion = desired.get(agents[i].id);
    const scale = motion?.socialScale ?? 1;
    socialScale[i] = scale;
    effRadius[i] = agents[i].radius * scale;
    if (effRadius[i] > maxEffRadius) maxEffRadius = effRadius[i];
    if (motion) {
      hasDesired[i] = 1;
      desiredEx[i] = motion.ex;
      desiredEy[i] = motion.ey;
    } else {
      hasDesired[i] = 0;
      desiredEx[i] = 0;
      desiredEy[i] = 0;
    }
  }
  // Grid cells must cover the largest possible pair cutoff.
  const pairCellSize = 2 * maxEffRadius + agentCutoff;

  // Wall AABBs for the force loop and resolveWallCollisions rejects.
  const walls = world.walls;
  ensureWallCapacity(walls.length);
  const { wallMinX, wallMinY, wallMaxX, wallMaxY, wallSpanSlack } = scratch;
  for (let w = 0; w < walls.length; w++) {
    const wall = walls[w];
    wallMinX[w] = Math.min(wall.a.x, wall.b.x);
    wallMaxX[w] = Math.max(wall.a.x, wall.b.x);
    wallMinY[w] = Math.min(wall.a.y, wall.b.y);
    wallMaxY[w] = Math.max(wall.a.y, wall.b.y);
    wallSpanSlack[w] =
      0.05 * Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
  }

  // Symmetric pair force kernel; candidate pairs come from the grid.
  const pairKernel = (i: number, j: number) => {
    // Canonical order so separationDirection stays deterministic
    // regardless of grid visit order.
    if (i > j) {
      const swap = i;
      i = j;
      j = swap;
    }
    const ai = agents[i];
    const aj = agents[j];
    const rij = effRadius[i] + effRadius[j];
    const cutoff = rij + agentCutoff;
    let dx = ai.position.x - aj.position.x;
    let dy = ai.position.y - aj.position.y;
    if (dx > cutoff || dx < -cutoff || dy > cutoff || dy < -cutoff) return;
    const distSq = dx * dx + dy * dy;
    if (distSq > cutoff * cutoff) return;

    let dist = Math.sqrt(distSq);
    if (dist < 1e-6) {
      const dir = separationDirection(i, j);
      dx = dir.x;
      dy = dir.y;
      dist = 1;
    }
    const nx = dx / dist;
    const ny = dy / dist;

    // Anisotropic weighting of the long-range social term only: each
    // agent perceives the other relative to its own facing (nx, ny
    // points from j to i). Full strength ahead, SFM_ANISOTROPY_LAMBDA
    // behind. Agents with no desired motion (e.g. arrived) stay
    // isotropic. The hard body-contact spring/friction below is
    // deliberately left unweighted - actual touch is felt regardless of
    // facing, and asymmetric weighting there would let a "blind side"
    // approach interpenetrate.
    const social = SFM_A_AGENT * Math.exp((rij - dist) / SFM_B_AGENT);
    const wi = hasDesired[i]
      ? SFM_ANISOTROPY_LAMBDA +
        (1 - SFM_ANISOTROPY_LAMBDA) * (1 - (desiredEx[i] * nx + desiredEy[i] * ny)) / 2
      : 1;
    const wj = hasDesired[j]
      ? SFM_ANISOTROPY_LAMBDA +
        (1 - SFM_ANISOTROPY_LAMBDA) * (1 + (desiredEx[j] * nx + desiredEy[j] * ny)) / 2
      : 1;

    let fxi = social * wi * socialScale[i] * nx;
    let fyi = social * wi * socialScale[i] * ny;
    let fxj = -social * wj * socialScale[j] * nx;
    let fyj = -social * wj * socialScale[j] * ny;

    const overlap = rij - dist;
    if (overlap > 0) {
      const contactX = SFM_K_BODY * overlap * nx;
      const contactY = SFM_K_BODY * overlap * ny;
      fxi += contactX;
      fyi += contactY;
      fxj -= contactX;
      fyj -= contactY;
      // Sliding friction along the tangent t = (-ny, nx).
      const tx = -ny;
      const ty = nx;
      const relTangentialSpeed =
        (aj.velocity.x - ai.velocity.x) * tx + (aj.velocity.y - ai.velocity.y) * ty;
      const coefficient = Math.min(SFM_KAPPA * overlap, maxFrictionCoefficient);
      const frictionX = coefficient * relTangentialSpeed * tx;
      const frictionY = coefficient * relTangentialSpeed * ty;
      fxi += frictionX;
      fyi += frictionY;
      fxj -= frictionX;
      fyj -= frictionY;
    }

    ax[i] += fxi;
    ay[i] += fyi;
    ax[j] += fxj;
    ay[j] += fyj;
  };

  for (let s = 0; s < substeps; s++) {
    ax.fill(0, 0, n);
    ay.fill(0, 0, n);

    // Agent-agent forces, applied symmetrically per pair.
    for (let i = 0; i < n; i++) {
      posX[i] = agents[i].position.x;
      posY[i] = agents[i].position.y;
    }
    buildSpatialGrid(grid, posX, posY, n, pairCellSize);
    forEachNeighborPair(grid, pairKernel);

    // Wall forces.
    for (let i = 0; i < n; i++) {
      const ai = agents[i];
      const cutoff = ai.radius + wallCutoff;
      const x = ai.position.x;
      const y = ai.position.y;
      for (let w = 0; w < walls.length; w++) {
        if (
          x < wallMinX[w] - cutoff ||
          x > wallMaxX[w] + cutoff ||
          y < wallMinY[w] - cutoff ||
          y > wallMaxY[w] + cutoff
        ) {
          continue;
        }
        const wall = walls[w];
        const closest = closestPointOnSegment(ai.position, wall.a, wall.b);
        const dx = x - closest.x;
        const dy = y - closest.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > cutoff * cutoff || distSq < 1e-12) continue;
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;

        let f = SFM_A_WALL * Math.exp((ai.radius - dist) / SFM_B_WALL);
        const overlap = ai.radius - dist;
        if (overlap > 0) {
          f += SFM_K_BODY * overlap;
          const tx = -ny;
          const ty = nx;
          // The wall is static, so the relative tangential speed is -v_i·t.
          const relTangentialSpeed = -(ai.velocity.x * tx + ai.velocity.y * ty);
          const coefficient = Math.min(SFM_KAPPA * overlap, maxFrictionCoefficient);
          ax[i] += coefficient * relTangentialSpeed * tx;
          ay[i] += coefficient * relTangentialSpeed * ty;
        }
        ax[i] += f * nx;
        ay[i] += f * ny;
      }
    }

    // Integrate: clamp repulsion, add driving force, semi-implicit Euler.
    for (let i = 0; i < n; i++) {
      const agent = agents[i];
      previousX[i] = agent.position.x;
      previousY[i] = agent.position.y;
      let rx = ax[i];
      let ry = ay[i];
      const repulsionMagnitude = Math.sqrt(rx * rx + ry * ry);
      if (repulsionMagnitude > SFM_MAX_ACCEL) {
        const scale = SFM_MAX_ACCEL / repulsionMagnitude;
        rx *= scale;
        ry *= scale;
      }

      const motion = desired.get(agent.id);
      const targetVx = motion ? motion.ex * motion.speed : 0;
      const targetVy = motion ? motion.ey * motion.speed : 0;
      const driveX = (targetVx - agent.velocity.x) / SFM_TAU;
      const driveY = (targetVy - agent.velocity.y) / SFM_TAU;

      agent.velocity.x += (driveX + rx) * dt;
      agent.velocity.y += (driveY + ry) * dt;

      const speedCap = SFM_SPEED_FACTOR * (motion ? motion.speed : maxSpeed);
      const speed = Math.sqrt(
        agent.velocity.x * agent.velocity.x + agent.velocity.y * agent.velocity.y
      );
      if (speed > speedCap && speed > 0) {
        const scale = speedCap / speed;
        agent.velocity.x *= scale;
        agent.velocity.y *= scale;
      }

      // Hybrid route guarantee: Social Force still determines lateral
      // avoidance, spacing, contact and speed above this floor, but it may
      // not cancel forward route progress forever. This is applied inside
      // every substep so geometric overlap resolution cannot leave the next
      // force evaluation starting from a stationary equilibrium.
      if (motion?.minForwardSpeed !== undefined) {
        const forwardSpeed =
          agent.velocity.x * motion.ex + agent.velocity.y * motion.ey;
        if (forwardSpeed < motion.minForwardSpeed) {
          const correction = motion.minForwardSpeed - forwardSpeed;
          agent.velocity.x += correction * motion.ex;
          agent.velocity.y += correction * motion.ey;
        }
      }

      agent.position.x += agent.velocity.x * dt;
      agent.position.y += agent.velocity.y * dt;
    }

    // Geometric cleanup: pairs first, walls last so walls always win.
    resolveAgentOverlaps(agents, n, maxEffRadius);
    for (let i = 0; i < n; i++) {
      resolveWallCollisions(agents[i], walls, previousX[i], previousY[i]);
    }

    // Overlap correction is positional and can undo the forward velocity
    // floor applied above. Enforce the same guarantee on actual displacement
    // after every force/contact/wall phase. This leaves all lateral Social
    // Force motion intact and only restores missing progress along the route.
    for (let i = 0; i < n; i++) {
      const motion = desired.get(agents[i].id);
      if (motion?.minForwardSpeed === undefined) continue;
      const forwardDisplacement =
        (agents[i].position.x - previousX[i]) * motion.ex +
        (agents[i].position.y - previousY[i]) * motion.ey;
      const minimumDisplacement = motion.minForwardSpeed * dt;
      if (forwardDisplacement < minimumDisplacement) {
        const correction = minimumDisplacement - forwardDisplacement;
        agents[i].position.x += correction * motion.ex;
        agents[i].position.y += correction * motion.ey;
      }
    }
  }

  // Don't retain references to removed agents between ticks.
  agents.length = 0;
}
