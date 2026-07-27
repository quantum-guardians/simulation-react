import type { AgentRuntimeState } from "./agents";
import type { Point } from "./graph";
import {
  PRESSURE_CONTACT_RANGE_PX,
  PRESSURE_DEATH_SECONDS,
  PRESSURE_DEATH_THRESHOLD,
  PRESSURE_RECOVERY_RATE,
} from "./presets";
import type { SfmWorld } from "./socialForce";
import {
  buildSpatialGrid,
  createSpatialGrid,
  forEachNeighborPair,
} from "./spatialGrid";

const PHYSICS_TICKS_PER_SECOND = 60;
export const PRESSURE_DEATH_TICKS = PRESSURE_DEATH_SECONDS * PHYSICS_TICKS_PER_SECOND;

function closestPointOnSegment(point: Point, a: Point, b: Point): Point {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared < 1e-12) return a;
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared)
  );
  return { x: a.x + abx * t, y: a.y + aby * t };
}

function compressionFromGap(gap: number): number {
  return Math.max(
    0,
    Math.min(2, (PRESSURE_CONTACT_RANGE_PX - gap) / PRESSURE_CONTACT_RANGE_PX)
  );
}

/** Reused across calls - pressure runs on the hot tick path. */
const scratch = {
  posX: new Float64Array(0),
  posY: new Float64Array(0),
  grid: createSpatialGrid(),
};

/**
 * Estimates local compressive pressure from simultaneous close contacts
 * with pedestrians and walls. A normal queue stays below the fatal
 * threshold, while a tightly packed body with several contacts does not.
 * Candidate pairs come from a spatial grid - compression only exists
 * within PRESSURE_CONTACT_RANGE_PX of body contact, so almost all of the
 * O(n²) pairs are irrelevant.
 */
export function computeAgentPressures(world: SfmWorld): Map<string, number> {
  const bodies = Array.from(world.agents.values());
  const n = bodies.length;
  const pressures = new Map(bodies.map((body) => [body.id, 0]));
  if (n === 0) return pressures;

  if (scratch.posX.length < n) {
    scratch.posX = new Float64Array(Math.max(n, 64));
    scratch.posY = new Float64Array(Math.max(n, 64));
  }
  const { posX, posY, grid } = scratch;
  let maxRadius = 0;
  for (let i = 0; i < n; i++) {
    posX[i] = bodies[i].position.x;
    posY[i] = bodies[i].position.y;
    if (bodies[i].radius > maxRadius) maxRadius = bodies[i].radius;
  }
  buildSpatialGrid(grid, posX, posY, n, 2 * maxRadius + PRESSURE_CONTACT_RANGE_PX);

  forEachNeighborPair(grid, (i, j) => {
    const first = bodies[i];
    const second = bodies[j];
    const contact = first.radius + second.radius + PRESSURE_CONTACT_RANGE_PX;
    const dx = first.position.x - second.position.x;
    const dy = first.position.y - second.position.y;
    if (dx > contact || dx < -contact || dy > contact || dy < -contact) return;
    const distSq = dx * dx + dy * dy;
    if (distSq > contact * contact) return;
    const distance = Math.sqrt(distSq);
    const compression = compressionFromGap(distance - first.radius - second.radius);
    if (compression === 0) return;
    pressures.set(first.id, (pressures.get(first.id) ?? 0) + compression);
    pressures.set(second.id, (pressures.get(second.id) ?? 0) + compression);
  });

  for (const body of bodies) {
    let maximumWallCompression = 0;
    const reach = body.radius + PRESSURE_CONTACT_RANGE_PX;
    const x = body.position.x;
    const y = body.position.y;
    for (const wall of world.walls) {
      // Cheap AABB reject before the segment projection.
      if (
        x < Math.min(wall.a.x, wall.b.x) - reach ||
        x > Math.max(wall.a.x, wall.b.x) + reach ||
        y < Math.min(wall.a.y, wall.b.y) - reach ||
        y > Math.max(wall.a.y, wall.b.y) + reach
      ) {
        continue;
      }
      const closest = closestPointOnSegment(body.position, wall.a, wall.b);
      const dx = x - closest.x;
      const dy = y - closest.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      maximumWallCompression = Math.max(
        maximumWallCompression,
        compressionFromGap(distance - body.radius)
      );
    }
    // Several corridor wall segments can meet at one junction and describe
    // the same physical boundary. Only the strongest wall contact counts,
    // preventing a graph node with many incident edges from creating fake
    // pressure by double-counting coincident wall endpoints.
    pressures.set(
      body.id,
      (pressures.get(body.id) ?? 0) + maximumWallCompression
    );
  }

  return pressures;
}

export interface PressureUpdateResult {
  pressures: Map<string, number>;
  newlyDeadIds: string[];
}

/**
 * Accumulates sustained high-pressure exposure and marks deaths. Exposure
 * decays quickly below the threshold, so separate brief bumps do not add
 * up to a death much later.
 *
 * `elapsedTicks` lets callers sample pressure at a lower cadence than the
 * physics tick (death needs seconds of sustained exposure, so 60 Hz
 * sampling buys nothing): a call covering 4 ticks accumulates/decays 4
 * ticks' worth of exposure.
 */
export function updatePressureDeaths(
  agents: AgentRuntimeState[],
  world: SfmWorld,
  elapsedTicks: number = 1
): PressureUpdateResult {
  const pressures = computeAgentPressures(world);
  const newlyDeadIds: string[] = [];

  for (const agent of agents) {
    agent.pressure = pressures.get(agent.id) ?? 0;
    if (agent.state === "dead") continue;

    agent.highPressureTicks =
      agent.pressure >= PRESSURE_DEATH_THRESHOLD
        ? (agent.highPressureTicks ?? 0) + elapsedTicks
        : Math.max(
            0,
            (agent.highPressureTicks ?? 0) - PRESSURE_RECOVERY_RATE * elapsedTicks
          );

    if (agent.highPressureTicks < PRESSURE_DEATH_TICKS) continue;
    agent.state = "dead";
    newlyDeadIds.push(agent.id);
    const body = world.agents.get(agent.id);
    if (body) {
      body.velocity.x = 0;
      body.velocity.y = 0;
    }
  }

  return { pressures, newlyDeadIds };
}
