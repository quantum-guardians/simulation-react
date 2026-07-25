import type { AgentRuntimeState } from "./agents";
import type { Point } from "./graph";
import {
  PRESSURE_CONTACT_RANGE_PX,
  PRESSURE_DEATH_SECONDS,
  PRESSURE_DEATH_THRESHOLD,
  PRESSURE_RECOVERY_RATE,
} from "./presets";
import type { SfmWorld } from "./socialForce";

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

/**
 * Estimates local compressive pressure from simultaneous close contacts
 * with pedestrians and walls. A normal queue stays below the fatal
 * threshold, while a tightly packed body with several contacts does not.
 */
export function computeAgentPressures(world: SfmWorld): Map<string, number> {
  const bodies = Array.from(world.agents.values());
  const pressures = new Map(bodies.map((body) => [body.id, 0]));

  for (let i = 0; i < bodies.length; i++) {
    const first = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const second = bodies[j];
      const distance = Math.hypot(
        first.position.x - second.position.x,
        first.position.y - second.position.y
      );
      const compression = compressionFromGap(distance - first.radius - second.radius);
      if (compression === 0) continue;
      pressures.set(first.id, (pressures.get(first.id) ?? 0) + compression);
      pressures.set(second.id, (pressures.get(second.id) ?? 0) + compression);
    }
  }

  for (const body of bodies) {
    let maximumWallCompression = 0;
    for (const wall of world.walls) {
      const closest = closestPointOnSegment(body.position, wall.a, wall.b);
      const distance = Math.hypot(
        body.position.x - closest.x,
        body.position.y - closest.y
      );
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
 */
export function updatePressureDeaths(
  agents: AgentRuntimeState[],
  world: SfmWorld
): PressureUpdateResult {
  const pressures = computeAgentPressures(world);
  const newlyDeadIds: string[] = [];

  for (const agent of agents) {
    agent.pressure = pressures.get(agent.id) ?? 0;
    if (agent.state === "dead") continue;

    agent.highPressureTicks =
      agent.pressure >= PRESSURE_DEATH_THRESHOLD
        ? (agent.highPressureTicks ?? 0) + 1
        : Math.max(0, (agent.highPressureTicks ?? 0) - PRESSURE_RECOVERY_RATE);

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
