import { describe, expect, it } from "vitest";
import {
  addAgent,
  createSfmWorld,
  FIXED_DT_MS,
  removeAgent,
  stepSocialForce,
  type DesiredMotion,
  type SfmWorld,
} from "./socialForce";
import { AGENT_RADIUS, SFM_SPEED_FACTOR, SFM_TAU } from "./presets";
import type { WallSegment } from "./corridors";

function runSeconds(
  world: SfmWorld,
  desired: Map<string, DesiredMotion>,
  seconds: number,
  maxSpeed: number,
  onTick?: () => void
): void {
  const ticks = Math.round((seconds * 1000) / FIXED_DT_MS);
  for (let t = 0; t < ticks; t++) {
    stepSocialForce(world, desired, FIXED_DT_MS, maxSpeed);
    onTick?.();
  }
}

describe("driving force", () => {
  it("relaxes a lone agent to >=95% of desired speed within 3τ, never above the cap", () => {
    const world = createSfmWorld();
    const agent = addAgent(world, "a", 0, 0);
    const speed = 25;
    const desired = new Map<string, DesiredMotion>([["a", { ex: 1, ey: 0, speed }]]);

    let maxObservedSpeed = 0;
    runSeconds(world, desired, 3 * SFM_TAU, speed, () => {
      maxObservedSpeed = Math.max(
        maxObservedSpeed,
        Math.hypot(agent.velocity.x, agent.velocity.y)
      );
    });

    expect(agent.velocity.x).toBeGreaterThanOrEqual(0.95 * speed);
    expect(Math.abs(agent.velocity.y)).toBeLessThan(1e-9);
    expect(maxObservedSpeed).toBeLessThanOrEqual(SFM_SPEED_FACTOR * speed + 1e-9);
  });

  it("brakes an agent with no desired motion", () => {
    const world = createSfmWorld();
    const agent = addAgent(world, "a", 0, 0);
    agent.velocity.x = 25;
    runSeconds(world, new Map(), 3 * SFM_TAU, 25);
    expect(Math.abs(agent.velocity.x)).toBeLessThan(0.05 * 25);
  });
});

describe("agent-agent repulsion", () => {
  it("is symmetric: two identical agents end up mirror images", () => {
    const world = createSfmWorld();
    const a = addAgent(world, "a", -8, 0);
    const b = addAgent(world, "b", 8, 0);
    stepSocialForce(world, new Map(), FIXED_DT_MS, 25);
    expect(a.position.x).toBeCloseTo(-b.position.x, 10);
    expect(a.position.y).toBeCloseTo(b.position.y, 10);
    expect(a.velocity.x).toBeCloseTo(-b.velocity.x, 10);
  });

  it("decays monotonically with distance", () => {
    const speedAfterOneStep = (gapCenters: number): number => {
      const world = createSfmWorld();
      const a = addAgent(world, "a", 0, 0);
      addAgent(world, "b", gapCenters, 0);
      stepSocialForce(world, new Map(), FIXED_DT_MS, 25);
      return Math.hypot(a.velocity.x, a.velocity.y);
    };
    const near = speedAfterOneStep(12);
    const mid = speedAfterOneStep(20);
    const far = speedAfterOneStep(40);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it("body force keeps head-on driven agents from interpenetrating", () => {
    const world = createSfmWorld();
    const a = addAgent(world, "a", -30, 0);
    const b = addAgent(world, "b", 30, 0);
    const speed = 200;
    const desired = new Map<string, DesiredMotion>([
      ["a", { ex: 1, ey: 0, speed }],
      ["b", { ex: -1, ey: 0, speed }],
    ]);

    let worstOverlap = 0;
    runSeconds(world, desired, 5, speed, () => {
      const dist = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
      worstOverlap = Math.max(worstOverlap, a.radius + b.radius - dist);
    });

    expect(worstOverlap).toBeLessThan(1);
  });

  it("separates exactly-stacked agents deterministically", () => {
    const world = createSfmWorld();
    const a = addAgent(world, "a", 50, 50);
    const b = addAgent(world, "b", 50, 50);
    runSeconds(world, new Map(), 0.5, 25);
    const dist = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    expect(dist).toBeGreaterThan(1);
    expect(Number.isFinite(a.position.x)).toBe(true);
    expect(Number.isFinite(b.position.x)).toBe(true);
  });
});

describe("wall repulsion", () => {
  const horizontalWall: WallSegment = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };

  it("pushes an agent along the wall normal, away from the wall", () => {
    const world = createSfmWorld();
    world.walls = [horizontalWall];
    const agent = addAgent(world, "a", 50, 6); // 6px below the wall (y grows downward-agnostic)
    stepSocialForce(world, new Map(), FIXED_DT_MS, 25);
    expect(agent.velocity.y).toBeGreaterThan(0);
    expect(Math.abs(agent.velocity.x)).toBeLessThan(1e-9);
  });

  it("stops an agent driven straight at a wall from crossing it", () => {
    const world = createSfmWorld();
    world.walls = [horizontalWall];
    const agent = addAgent(world, "a", 50, 20);
    const speed = 50;
    const desired = new Map<string, DesiredMotion>([["a", { ex: 0, ey: -1, speed }]]);

    let minY = agent.position.y;
    runSeconds(world, desired, 5, speed, () => {
      minY = Math.min(minY, agent.position.y);
    });

    expect(minY).toBeGreaterThan(0);
  });
});

describe("stability soak", () => {
  it("100 agents crammed into one narrow corridor stay finite and speed-capped", () => {
    const world = createSfmWorld();
    // Corridor strip: y ∈ [-10, 10], x ∈ [0, 500], walls on both sides and
    // a closed left end so the spawn crush can't extrude anyone out of it.
    world.walls = [
      { a: { x: 0, y: -10 }, b: { x: 500, y: -10 } },
      { a: { x: 0, y: 10 }, b: { x: 500, y: 10 } },
      { a: { x: 0, y: -10 }, b: { x: 0, y: 10 } },
    ];
    const speed = 25;
    const desired = new Map<string, DesiredMotion>();
    // Deterministic jittered spawn pile at the corridor's left end.
    for (let i = 0; i < 100; i++) {
      const id = `a${i}`;
      const x = 10 + (i % 10) * 1.5;
      const y = -6 + Math.floor(i / 10) * 1.3;
      addAgent(world, id, x, y);
      desired.set(id, { ex: 1, ey: 0, speed });
    }

    runSeconds(world, desired, 10, speed);

    const cap = SFM_SPEED_FACTOR * speed + 1e-9;
    for (const agent of world.agents.values()) {
      expect(Number.isFinite(agent.position.x)).toBe(true);
      expect(Number.isFinite(agent.position.y)).toBe(true);
      expect(Math.hypot(agent.velocity.x, agent.velocity.y)).toBeLessThanOrEqual(cap);
      // Nobody was squeezed through a side wall by crowd pressure.
      expect(agent.position.y).toBeGreaterThan(-10 - AGENT_RADIUS);
      expect(agent.position.y).toBeLessThan(10 + AGENT_RADIUS);
    }
  });
});

describe("world management", () => {
  it("add/remove agents round-trips", () => {
    const world = createSfmWorld();
    addAgent(world, "a", 1, 2);
    expect(world.agents.get("a")?.position).toEqual({ x: 1, y: 2 });
    removeAgent(world, "a");
    expect(world.agents.has("a")).toBe(false);
  });
});
