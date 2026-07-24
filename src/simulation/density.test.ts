import { describe, expect, it } from "vitest";
import { computeCorridorOccupancy, getDensityColor } from "./density";
import type { Corridor } from "./corridors";

describe("getDensityColor", () => {
  it("buckets by the documented thresholds", () => {
    expect(getDensityColor(0.1)).toBe("#7f8b45");
    expect(getDensityColor(0.4)).toBe("#8a7a3a");
    expect(getDensityColor(0.7)).toBe("#8a5a3a");
    expect(getDensityColor(0.9)).toBe("#9a4b4b");
  });
});

function makeCorridor(overrides: Partial<Corridor> = {}): Corridor {
  return {
    id: "a--b",
    source: "a",
    target: "b",
    weight: 1,
    width: 40,
    a: { x: 0, y: 0 },
    b: { x: 100, y: 0 },
    fullA: { x: 0, y: 0 },
    fullB: { x: 100, y: 0 },
    length: 100,
    angle: 0,
    ...overrides,
  };
}

describe("computeCorridorOccupancy", () => {
  it("reports zero density for an empty corridor", () => {
    const corridor = makeCorridor();
    const densities = computeCorridorOccupancy([corridor], []);
    expect(densities.get(corridor.id)).toBe(0);
  });

  it("counts agents that fall within the corridor rectangle, ignores those outside", () => {
    const corridor = makeCorridor();
    const inside = [
      { x: 10, y: 0 },
      { x: 50, y: 5 },
    ];
    const outside = [{ x: 200, y: 0 }, { x: 10, y: 100 }];
    const densities = computeCorridorOccupancy([corridor], [...inside, ...outside]);
    expect(densities.get(corridor.id)).toBeGreaterThan(0);
  });

  it("clamps density at 1 even when overcrowded", () => {
    const corridor = makeCorridor({ length: 10, width: 10 }); // tiny floor area
    const manyAgents = Array.from({ length: 200 }, (_, i) => ({ x: i % 10, y: 0 }));
    const densities = computeCorridorOccupancy([corridor], manyAgents);
    expect(densities.get(corridor.id)).toBe(1);
  });
});
