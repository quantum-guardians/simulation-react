import type { Point } from "./graph";
import { pointInCorridor, type Corridor } from "./corridors";
import { AGENT_RADIUS } from "./presets";

export function getDensityColor(density: number): string {
  if (density < 0.2) return "#7f8b45"; // low: green
  if (density < 0.6) return "#8a7a3a"; // medium: yellow/brown
  if (density < 0.85) return "#8a5a3a"; // high: brown
  return "#9a4b4b"; // critical: red-brown
}

/**
 * Corridor-occupancy density: for each corridor, what fraction of its
 * floor area is covered by agent footprints (clamped to [0, 1]). Intended
 * to be recomputed on a low-frequency cadence (~every 250ms), not per
 * physics tick - see plan.
 */
export function computeCorridorOccupancy(
  corridors: Corridor[],
  agentPositions: Point[],
  agentFootprintArea: number = Math.PI * AGENT_RADIUS * AGENT_RADIUS
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const corridor of corridors) counts.set(corridor.id, 0);

  for (const point of agentPositions) {
    for (const corridor of corridors) {
      if (pointInCorridor(point, corridor)) {
        counts.set(corridor.id, (counts.get(corridor.id) ?? 0) + 1);
        break;
      }
    }
  }

  const densities = new Map<string, number>();
  for (const corridor of corridors) {
    const floorArea = Math.max(corridor.length * corridor.width, 1);
    const count = counts.get(corridor.id) ?? 0;
    densities.set(corridor.id, Math.min((count * agentFootprintArea) / floorArea, 1));
  }
  return densities;
}
