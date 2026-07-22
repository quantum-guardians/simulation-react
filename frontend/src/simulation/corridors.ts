import type { Point, RawEdge } from "./graph";

export interface CorridorWidthOptions {
  minWidth: number;
  maxWidth: number;
  widthScale: number;
}

export const DEFAULT_CORRIDOR_WIDTH_OPTIONS: CorridorWidthOptions = {
  minWidth: 20,
  maxWidth: 100,
  widthScale: 6,
};

const HUB_PADDING = 2;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

export function computeCorridorWidth(weight: number, opts: CorridorWidthOptions): number {
  return clamp(opts.minWidth + opts.widthScale * weight, opts.minWidth, opts.maxWidth);
}

export interface Corridor {
  id: string;
  source: string;
  target: string;
  weight: number;
  width: number;
  /** Endpoints shortened to sit just outside each node's junction hub. */
  a: Point;
  b: Point;
  /** Original (unshortened) node centers, kept for reference/debugging. */
  fullA: Point;
  fullB: Point;
  length: number;
  angle: number;
}

export interface JunctionHub {
  nodeId: string;
  center: Point;
  radius: number;
}

export interface BuildCorridorsResult {
  corridors: Corridor[];
  hubs: JunctionHub[];
}

/**
 * Turn a graph + node positions into a corridor floor plan: each edge
 * becomes a rectangular strip whose width is proportional to its weight,
 * and each node becomes a "hub" disk sized to the widest incident corridor
 * so corridors never leave a visible gap where they meet. Hub rims are
 * closed off with tessellated wall segments (buildHubRimWalls) except
 * where corridors attach.
 */
export function buildCorridors(
  nodePositions: Map<string, Point>,
  edges: RawEdge[],
  widthOpts: CorridorWidthOptions = DEFAULT_CORRIDOR_WIDTH_OPTIONS
): BuildCorridorsResult {
  const widths = edges.map((e) => computeCorridorWidth(e.weight, widthOpts));

  const maxHalfWidthByNode = new Map<string, number>();
  edges.forEach((edge, i) => {
    const halfWidth = widths[i] / 2;
    maxHalfWidthByNode.set(
      edge.source,
      Math.max(maxHalfWidthByNode.get(edge.source) ?? 0, halfWidth)
    );
    maxHalfWidthByNode.set(
      edge.target,
      Math.max(maxHalfWidthByNode.get(edge.target) ?? 0, halfWidth)
    );
  });

  const hubs: JunctionHub[] = [];
  for (const [nodeId, halfWidth] of maxHalfWidthByNode) {
    const center = nodePositions.get(nodeId);
    if (!center) continue;
    hubs.push({ nodeId, center, radius: halfWidth + HUB_PADDING });
  }
  const hubByNode = new Map(hubs.map((h) => [h.nodeId, h]));

  const corridors: Corridor[] = [];
  edges.forEach((edge, i) => {
    const fullA = nodePositions.get(edge.source);
    const fullB = nodePositions.get(edge.target);
    if (!fullA || !fullB) return;

    const width = widths[i];
    const dx = fullB.x - fullA.x;
    const dy = fullB.y - fullA.y;
    const fullLength = Math.hypot(dx, dy) || 1e-6;
    const angle = Math.atan2(dy, dx);
    const ux = dx / fullLength;
    const uy = dy / fullLength;

    const radiusA = hubByNode.get(edge.source)?.radius ?? 0;
    const radiusB = hubByNode.get(edge.target)?.radius ?? 0;
    const shortenedLength = Math.max(fullLength - radiusA - radiusB, 0);

    const a: Point = { x: fullA.x + ux * radiusA, y: fullA.y + uy * radiusA };
    const b: Point = { x: fullB.x - ux * radiusB, y: fullB.y - uy * radiusB };

    corridors.push({
      id: `${edge.source}--${edge.target}`,
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
      width,
      a,
      b,
      fullA,
      fullB,
      length: shortenedLength,
      angle,
    });
  });

  return { corridors, hubs };
}

/** True if `point` lies inside the corridor's (rotated) floor rectangle,
 * optionally inflated by `tolerance` on every side. */
export function pointInCorridor(point: Point, corridor: Corridor, tolerance = 0): boolean {
  const dx = point.x - corridor.a.x;
  const dy = point.y - corridor.a.y;
  const cos = Math.cos(-corridor.angle);
  const sin = Math.sin(-corridor.angle);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return (
    localX >= -tolerance &&
    localX <= corridor.length + tolerance &&
    Math.abs(localY) <= corridor.width / 2 + tolerance
  );
}

/** True if `point` is on the walkable floor: inside any corridor rectangle
 * or any hub disk (inflated by `tolerance`). */
export function isPointInWalkableArea(
  point: Point,
  corridors: Corridor[],
  hubs: JunctionHub[],
  tolerance = 0
): boolean {
  for (const hub of hubs) {
    if (Math.hypot(point.x - hub.center.x, point.y - hub.center.y) <= hub.radius + tolerance) {
      return true;
    }
  }
  for (const corridor of corridors) {
    if (pointInCorridor(point, corridor, tolerance)) return true;
  }
  return false;
}

/** A wall as a bare line segment, for the social-force wall repulsion. */
export interface WallSegment {
  a: Point;
  b: Point;
}

export interface HubRimSegment {
  center: Point;
  angle: number;
  length: number;
}

/**
 * Flattens the corridor floor plan into bare wall segments for the social
 * force model: two side walls per corridor (offset ±width/2 along the
 * perpendicular — the force repels from the line itself, so no thickness)
 * plus the hub rim chords from buildHubRimWalls with zero thickness so they
 * sit exactly on each hub's radius.
 */
export function buildWallSegments(corridors: Corridor[], hubs: JunctionHub[]): WallSegment[] {
  const segments: WallSegment[] = [];

  for (const corridor of corridors) {
    if (corridor.length <= 0) continue;
    const halfWidth = corridor.width / 2;
    const perpX = -Math.sin(corridor.angle);
    const perpY = Math.cos(corridor.angle);
    for (const side of [1, -1]) {
      segments.push({
        a: { x: corridor.a.x + perpX * halfWidth * side, y: corridor.a.y + perpY * halfWidth * side },
        b: { x: corridor.b.x + perpX * halfWidth * side, y: corridor.b.y + perpY * halfWidth * side },
      });
    }
  }

  for (const rim of buildHubRimWalls(hubs, corridors, 0)) {
    const dx = Math.cos(rim.angle) * (rim.length / 2);
    const dy = Math.sin(rim.angle) * (rim.length / 2);
    segments.push({
      a: { x: rim.center.x - dx, y: rim.center.y - dy },
      b: { x: rim.center.x + dx, y: rim.center.y + dy },
    });
  }

  return segments;
}

const RIM_ANGULAR_STEP = (12 * Math.PI) / 180;
const RIM_OPENING_MARGIN = 0.08; // rad, keeps agents from clipping segment ends
const RIM_OPENING_GAP_PX = 3; // widens each opening by ~an agent radius on each side
const RIM_SEGMENT_OVERLAP = 1.15; // slight overlength so adjacent chords overlap

function normalizeAngle(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a;
}

function angleInOpenSector(angle: number, sectorCenter: number, halfAngle: number): boolean {
  const diff = Math.abs(normalizeAngle(angle - sectorCenter));
  return Math.min(diff, 2 * Math.PI - diff) <= halfAngle;
}

/**
 * Tessellates each hub's rim into short tangential wall segments, leaving
 * openings only in the angular sectors where corridors attach. Segments
 * sit just OUTSIDE the rim radius (offset by wallThickness/2) so the full
 * hub disk remains walkable floor. This closes the junction leak where
 * crowd pressure squeezed agents out through the previously open rim.
 */
export function buildHubRimWalls(
  hubs: JunctionHub[],
  corridors: Corridor[],
  wallThickness = 14
): HubRimSegment[] {
  const segments: HubRimSegment[] = [];

  for (const hub of hubs) {
    const wallRadius = hub.radius + wallThickness / 2;

    const openSectors: { center: number; halfAngle: number }[] = [];
    for (const corridor of corridors) {
      let attachmentAngle: number | null = null;
      if (corridor.source === hub.nodeId) attachmentAngle = corridor.angle;
      else if (corridor.target === hub.nodeId) attachmentAngle = corridor.angle + Math.PI;
      if (attachmentAngle === null) continue;

      // The opening must admit the corridor mouth where its strip crosses
      // the WALL circle (radius + thickness/2), not the smaller hub rim -
      // using the rim radius would give asin(~1) = 90-degree half-openings
      // that erase the entire rim on any multi-way junction.
      const ratio = Math.min(1, (corridor.width / 2 + RIM_OPENING_GAP_PX) / wallRadius);
      openSectors.push({
        center: normalizeAngle(attachmentAngle),
        halfAngle: Math.asin(ratio) + RIM_OPENING_MARGIN,
      });
    }

    const chordLength = 2 * wallRadius * Math.tan(RIM_ANGULAR_STEP / 2) * RIM_SEGMENT_OVERLAP;

    for (let phi = 0; phi < 2 * Math.PI - 1e-9; phi += RIM_ANGULAR_STEP) {
      const mid = phi + RIM_ANGULAR_STEP / 2;
      // A segment spans +-step/2 around its midpoint; treat it as blocked if
      // ANY part of that span reaches into an opening, so no chord end can
      // poke into a corridor mouth.
      const blocked = openSectors.some((s) =>
        angleInOpenSector(mid, s.center, s.halfAngle + RIM_ANGULAR_STEP / 2)
      );
      if (blocked) continue;
      segments.push({
        center: {
          x: hub.center.x + wallRadius * Math.cos(mid),
          y: hub.center.y + wallRadius * Math.sin(mid),
        },
        angle: mid + Math.PI / 2,
        length: chordLength,
      });
    }
  }

  return segments;
}
