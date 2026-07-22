import { describe, expect, it } from "vitest";
import {
  buildCorridors,
  buildHubRimWalls,
  buildWallSegments,
  computeCorridorWidth,
  isPointInWalkableArea,
  type CorridorWidthOptions,
} from "./corridors";
import type { Point } from "./graph";

const OPTS: CorridorWidthOptions = { minWidth: 20, maxWidth: 100, widthScale: 6 };

describe("computeCorridorWidth", () => {
  it("returns exactly minWidth for zero weight", () => {
    expect(computeCorridorWidth(0, OPTS)).toBe(20);
  });

  it("clamps to maxWidth for very large weight", () => {
    expect(computeCorridorWidth(1000, OPTS)).toBe(100);
  });

  it("scales linearly in between", () => {
    // minWidth(20) + widthScale(6) * weight(5) = 50
    expect(computeCorridorWidth(5, OPTS)).toBe(50);
  });
});

describe("buildCorridors", () => {
  it("keeps every hub radius >= half-width of its incident corridors", () => {
    const positions = new Map<string, Point>([
      ["hub", { x: 100, y: 100 }],
      ["a", { x: 200, y: 100 }],
      ["b", { x: 100, y: 200 }],
      ["c", { x: 0, y: 100 }],
    ]);
    const edges = [
      { source: "hub", target: "a", weight: 1 },
      { source: "hub", target: "b", weight: 10 },
      { source: "hub", target: "c", weight: 3 },
    ];
    const { corridors, hubs } = buildCorridors(positions, edges, OPTS);
    const hubByNode = new Map(hubs.map((h) => [h.nodeId, h]));

    for (const corridor of corridors) {
      const sourceHub = hubByNode.get(corridor.source)!;
      const targetHub = hubByNode.get(corridor.target)!;
      expect(sourceHub.radius).toBeGreaterThanOrEqual(corridor.width / 2);
      expect(targetHub.radius).toBeGreaterThanOrEqual(corridor.width / 2);
    }
  });

  it("never produces a negative corridor length even for very close nodes", () => {
    const positions = new Map<string, Point>([
      ["a", { x: 100, y: 100 }],
      ["b", { x: 105, y: 100 }], // 5px apart, but weight implies a wide corridor
    ]);
    const edges = [{ source: "a", target: "b", weight: 50 }];
    const { corridors } = buildCorridors(positions, edges, OPTS);
    expect(corridors[0].length).toBeGreaterThanOrEqual(0);
  });

  it("produces one corridor per edge with matching endpoints", () => {
    const positions = new Map<string, Point>([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 100, y: 0 }],
    ]);
    const edges = [{ source: "a", target: "b", weight: 2 }];
    const { corridors, hubs } = buildCorridors(positions, edges, OPTS);
    expect(corridors).toHaveLength(1);
    expect(hubs).toHaveLength(2);
    expect(corridors[0].source).toBe("a");
    expect(corridors[0].target).toBe("b");
  });
});

describe("isPointInWalkableArea", () => {
  const positions = new Map<string, Point>([
    ["a", { x: 0, y: 100 }],
    ["b", { x: 200, y: 100 }],
  ]);
  const edges = [{ source: "a", target: "b", weight: 1 }];
  const { corridors, hubs } = buildCorridors(positions, edges, OPTS);

  it("accepts a point mid-corridor", () => {
    expect(isPointInWalkableArea({ x: 100, y: 100 }, corridors, hubs)).toBe(true);
  });

  it("accepts a point inside a hub disk", () => {
    expect(isPointInWalkableArea({ x: 0, y: 100 }, corridors, hubs)).toBe(true);
  });

  it("rejects a point outside both, unless within tolerance", () => {
    // Corridor half-width is 13 (weight 1 -> width 26); 100,130 is 30px off
    // the centerline, well outside.
    const outside = { x: 100, y: 130 };
    expect(isPointInWalkableArea(outside, corridors, hubs)).toBe(false);
    expect(isPointInWalkableArea(outside, corridors, hubs, 20)).toBe(true);
  });
});

describe("buildHubRimWalls", () => {
  it("leaves openings at corridor attachment angles and covers elsewhere", () => {
    // 3-way junction at the origin: corridors leaving east, north, west.
    const positions = new Map<string, Point>([
      ["hub", { x: 0, y: 0 }],
      ["e", { x: 200, y: 0 }],
      ["n", { x: 0, y: -200 }],
      ["w", { x: -200, y: 0 }],
    ]);
    const edges = [
      { source: "hub", target: "e", weight: 1 },
      { source: "hub", target: "n", weight: 1 },
      { source: "hub", target: "w", weight: 1 },
    ];
    const { corridors, hubs } = buildCorridors(positions, edges, OPTS);
    const hub = hubs.find((h) => h.nodeId === "hub")!;
    const segments = buildHubRimWalls([hub], corridors);

    expect(segments.length).toBeGreaterThan(0);

    const angleOf = (p: Point) => Math.atan2(p.y - hub.center.y, p.x - hub.center.x);
    const angularDist = (a: number, b: number) => {
      const d = Math.abs(a - b) % (2 * Math.PI);
      return Math.min(d, 2 * Math.PI - d);
    };

    // No segment may sit at an attachment angle (east=0, north=-PI/2,
    // west=PI); the south side (PI/2) must be walled.
    for (const attachment of [0, -Math.PI / 2, Math.PI]) {
      for (const segment of segments) {
        expect(angularDist(angleOf(segment.center), attachment)).toBeGreaterThan(0.2);
      }
    }
    const southWalled = segments.some((s) => angularDist(angleOf(s.center), Math.PI / 2) < 0.3);
    expect(southWalled).toBe(true);
  });

  it("does not error when a corridor is as wide as the hub itself", () => {
    const positions = new Map<string, Point>([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 300, y: 0 }],
    ]);
    // Max-width corridor: asin ratio clamps to 1 (half-angle PI/2).
    const edges = [{ source: "a", target: "b", weight: 100 }];
    const { corridors, hubs } = buildCorridors(positions, edges, OPTS);
    expect(() => buildHubRimWalls(hubs, corridors)).not.toThrow();
    // The half of each rim facing away from the corridor is still walled.
    const segments = buildHubRimWalls(hubs, corridors);
    expect(segments.length).toBeGreaterThan(0);
  });
});

describe("buildWallSegments", () => {
  const positions = new Map<string, Point>([
    ["a", { x: 0, y: 100 }],
    ["b", { x: 300, y: 100 }],
  ]);
  const edges = [{ source: "a", target: "b", weight: 1 }]; // width 26
  const { corridors, hubs } = buildCorridors(positions, edges, OPTS);

  it("emits two side walls per corridor at exactly ±width/2", () => {
    const corridor = corridors[0];
    const segments = buildWallSegments([corridor], []);
    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      // Horizontal corridor along y=100: side walls sit at y = 100 ± 13.
      expect(Math.abs(segment.a.y - 100)).toBeCloseTo(corridor.width / 2, 6);
      expect(segment.a.y).toBeCloseTo(segment.b.y, 6);
      expect(Math.abs(segment.b.x - segment.a.x)).toBeCloseTo(corridor.length, 6);
    }
  });

  it("skips degenerate (zero-length) corridors", () => {
    const closePositions = new Map<string, Point>([
      ["a", { x: 100, y: 100 }],
      ["b", { x: 105, y: 100 }],
    ]);
    const degenerate = buildCorridors(closePositions, [{ source: "a", target: "b", weight: 50 }], OPTS);
    const segments = buildWallSegments(degenerate.corridors, []);
    expect(segments).toHaveLength(0);
  });

  it("places hub rim chords with midpoints on the hub-radius circle", () => {
    const segments = buildWallSegments([], hubs);
    expect(segments.length).toBeGreaterThan(0);
    const hubByCenter = hubs.map((h) => h);
    for (const segment of segments) {
      const mid = {
        x: (segment.a.x + segment.b.x) / 2,
        y: (segment.a.y + segment.b.y) / 2,
      };
      const onSomeRim = hubByCenter.some(
        (h) => Math.abs(Math.hypot(mid.x - h.center.x, mid.y - h.center.y) - h.radius) < 1e-6
      );
      expect(onSomeRim).toBe(true);
    }
  });
});
