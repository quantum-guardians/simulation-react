import { describe, expect, it } from "vitest";
import {
  buildAdjacency,
  enforceContainment,
  orientedEdgesToLookup,
  pickRandomEndpointPair,
  shortestPath,
  updateAgentSteering,
  type AgentRuntimeState,
} from "./agents";
import { buildCorridors } from "./corridors";
import type { Point } from "./graph";
import { addAgentBody, createPhysicsWorld } from "./physics";

describe("shortestPath (Dijkstra)", () => {
  // Diamond: a-b-d costs 1+1=2, a-c-d costs 5+5=10 -> cheaper route via b.
  const adjacency = buildAdjacency(
    ["a", "b", "c", "d"],
    [
      { source: "a", target: "b", weight: 1 },
      { source: "b", target: "d", weight: 1 },
      { source: "a", target: "c", weight: 5 },
      { source: "c", target: "d", weight: 5 },
    ]
  );

  it("picks the cheaper route on a diamond graph", () => {
    const path = shortestPath(adjacency, "a", "d");
    expect(path).toEqual(["a", "b", "d"]);
  });

  it("makes an oriented edge one-way and leaves unoriented edges bidirectional", () => {
    const edges = [
      { source: "a", target: "b", weight: 1 },
      { source: "b", target: "c", weight: 1 },
    ];
    // Only a--b is oriented (a -> b); b--c has no entry, so stays two-way.
    const lookup = orientedEdgesToLookup([{ edgeId: "a--b", from: "a", to: "b" }]);
    const directed = buildAdjacency(["a", "b", "c"], edges, lookup);

    expect(directed.get("a")).toEqual([{ to: "b", weight: 1 }]);
    expect(directed.get("b")).toEqual(
      expect.arrayContaining([{ to: "c", weight: 1 }])
    );
    expect(directed.get("b")).not.toEqual(
      expect.arrayContaining([{ to: "a", weight: 1 }])
    );
    expect(directed.get("c")).toEqual(
      expect.arrayContaining([{ to: "b", weight: 1 }])
    );

    // a -> b is now impossible in reverse: no path back from b/c to a.
    expect(shortestPath(directed, "a", "b")).toEqual(["a", "b"]);
    expect(shortestPath(directed, "b", "a")).toBeNull();
    expect(shortestPath(directed, "c", "a")).toBeNull();
  });

  it("returns null across disconnected components", () => {
    const disconnected = buildAdjacency(
      ["a", "b", "c", "d"],
      [{ source: "a", target: "b", weight: 1 }]
    );
    expect(shortestPath(disconnected, "a", "d")).toBeNull();
    expect(shortestPath(disconnected, "c", "d")).toBeNull();
  });

  it("returns a single-node path when start equals end", () => {
    expect(shortestPath(adjacency, "a", "a")).toEqual(["a"]);
  });
});

describe("pickRandomEndpointPair", () => {
  it("picks two distinct leaves when at least 2 exist", () => {
    const rng = (() => {
      let calls = 0;
      const seq = [0, 0.99];
      return () => seq[calls++ % seq.length];
    })();
    const pair = pickRandomEndpointPair(["hub", "a", "b", "c"], ["a", "b", "c"], rng);
    expect(pair).not.toBeNull();
    expect(pair![0]).not.toBe(pair![1]);
  });

  it("falls back to any two nodes when fewer than 2 leaves exist", () => {
    const rng = (() => {
      let calls = 0;
      const seq = [0.1, 0.9];
      return () => seq[calls++ % seq.length];
    })();
    const pair = pickRandomEndpointPair(["a", "b", "c"], [], rng);
    expect(pair).not.toBeNull();
    expect(pair![0]).not.toBe(pair![1]);
  });

  it("returns null when fewer than 2 nodes exist at all", () => {
    expect(pickRandomEndpointPair(["a"], [], () => 0)).toBeNull();
    expect(pickRandomEndpointPair([], [], () => 0)).toBeNull();
  });
});

describe("updateAgentSteering", () => {
  it("advances waypointIndex once the body is within arrival radius", () => {
    const world = createPhysicsWorld();
    const body = addAgentBody(world, "agent-1", 0, 0);
    // Body is essentially at the first waypoint already (within radius),
    // so steering should immediately advance to waypoint index 1.
    body.position.x = 0;
    body.position.y = 0;

    const agent: AgentRuntimeState = {
      id: "agent-1",
      waypoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      waypointIndex: 0,
      startLeaf: "a",
      targetLeaf: "b",
      state: "moving",
    };

    updateAgentSteering([agent], world, 60, 10);
    expect(agent.waypointIndex).toBe(1);
    expect(agent.state).toBe("moving");
  });

  it("marks the agent arrived once the final waypoint is reached", () => {
    const world = createPhysicsWorld();
    const body = addAgentBody(world, "agent-2", 100, 0);
    body.position.x = 100;
    body.position.y = 0;

    const agent: AgentRuntimeState = {
      id: "agent-2",
      waypoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      waypointIndex: 1,
      startLeaf: "a",
      targetLeaf: "b",
      state: "moving",
    };

    updateAgentSteering([agent], world, 60, 10);
    expect(agent.state).toBe("arrived");
  });
});

describe("enforceContainment", () => {
  const positions = new Map<string, Point>([
    ["a", { x: 0, y: 100 }],
    ["b", { x: 200, y: 100 }],
  ]);
  const edges = [{ source: "a", target: "b", weight: 1 }];
  const { corridors, hubs } = buildCorridors(positions, edges, {
    minWidth: 20,
    maxWidth: 100,
    widthScale: 6,
  });

  it("records the last valid position while an agent stays on the floor", () => {
    const world = createPhysicsWorld();
    addAgentBody(world, "inside", 100, 100);
    const lastValid = new Map<string, Point>();

    enforceContainment(world, corridors, hubs, lastValid);
    expect(lastValid.get("inside")).toEqual({ x: 100, y: 100 });
  });

  it("snaps an agent found outside the floor back to its last valid position with zero velocity", () => {
    const world = createPhysicsWorld();
    const body = addAgentBody(world, "escapee", 100, 100);
    const lastValid = new Map<string, Point>();
    enforceContainment(world, corridors, hubs, lastValid); // records (100, 100)

    // Teleport far outside the corridor (simulating a solver ejection).
    body.position.x = 100;
    body.position.y = 400;
    enforceContainment(world, corridors, hubs, lastValid);

    expect(body.position.x).toBeCloseTo(100);
    expect(body.position.y).toBeCloseTo(100);
    expect(body.velocity.x).toBeCloseTo(0);
    expect(body.velocity.y).toBeCloseTo(0);
  });

  it("leaves an outside agent untouched when no last valid position is known", () => {
    const world = createPhysicsWorld();
    const body = addAgentBody(world, "unknown", 500, 500);
    const lastValid = new Map<string, Point>();

    enforceContainment(world, corridors, hubs, lastValid);
    expect(body.position.x).toBe(500);
    expect(body.position.y).toBe(500);
  });
});
