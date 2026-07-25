import { describe, expect, it } from "vitest";
import type { AgentRuntimeState } from "./agents";
import {
  computeAgentPressures,
  PRESSURE_DEATH_TICKS,
  updatePressureDeaths,
} from "./pressure";
import { PRESSURE_DEATH_THRESHOLD } from "./presets";
import { addAgent, createSfmWorld } from "./socialForce";

function runtimeAgent(id: string): AgentRuntimeState {
  return {
    id,
    waypoints: [],
    waypointIndex: 0,
    startLeaf: "A",
    targetLeaf: "B",
    state: "moving",
  };
}

describe("crowd pressure deaths", () => {
  it("reports no pressure for an isolated pedestrian", () => {
    const world = createSfmWorld();
    addAgent(world, "solo", 10, 10, 4);
    expect(computeAgentPressures(world).get("solo")).toBe(0);
  });

  it("detects multi-directional compression in a tightly packed group", () => {
    const world = createSfmWorld();
    addAgent(world, "center", 50, 50, 4);
    addAgent(world, "left", 42, 50, 4);
    addAgent(world, "right", 58, 50, 4);
    addAgent(world, "top", 50, 42, 4);
    addAgent(world, "bottom", 50, 58, 4);

    expect(computeAgentPressures(world).get("center")).toBeGreaterThan(
      PRESSURE_DEATH_THRESHOLD
    );
  });

  it("requires sustained high pressure before marking a death", () => {
    const world = createSfmWorld();
    const ids = ["center", "left", "right", "top", "bottom"];
    addAgent(world, "center", 50, 50, 4);
    addAgent(world, "left", 42, 50, 4);
    addAgent(world, "right", 58, 50, 4);
    addAgent(world, "top", 50, 42, 4);
    addAgent(world, "bottom", 50, 58, 4);
    const agents = ids.map(runtimeAgent);

    for (let tick = 0; tick < PRESSURE_DEATH_TICKS - 1; tick++) {
      updatePressureDeaths(agents, world);
    }
    expect(agents[0].state).toBe("moving");

    const result = updatePressureDeaths(agents, world);
    expect(agents[0].state).toBe("dead");
    expect(result.newlyDeadIds).toContain("center");
  });

  it("quickly recovers exposure when pressure is released", () => {
    const world = createSfmWorld();
    const center = addAgent(world, "center", 50, 50, 4);
    addAgent(world, "left", 42, 50, 4);
    addAgent(world, "right", 58, 50, 4);
    addAgent(world, "top", 50, 42, 4);
    addAgent(world, "bottom", 50, 58, 4);
    const agents = ["center", "left", "right", "top", "bottom"].map(runtimeAgent);

    for (let tick = 0; tick < 60; tick++) updatePressureDeaths(agents, world);
    const exposureBeforeRelease = agents[0].highPressureTicks ?? 0;
    center.position.x = 200;
    center.position.y = 200;
    for (let tick = 0; tick < 20; tick++) updatePressureDeaths(agents, world);

    expect(agents[0].highPressureTicks).toBeLessThan(exposureBeforeRelease);
    expect(agents[0].state).toBe("moving");
  });
});
