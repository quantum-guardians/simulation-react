import type { Point, RawEdge } from "./graph";
import { buildHubRimWalls, type Corridor, type JunctionHub } from "./corridors";
import { getDensityColor } from "./density";

const NODE_RADIUS = 10;

export function drawCorridorFloor(
  ctx: CanvasRenderingContext2D,
  corridors: Corridor[],
  hubs: JunctionHub[],
  densityByCorridor?: Map<string, number>
): void {
  ctx.save();
  ctx.strokeStyle = "#3c4150";
  ctx.lineWidth = 1;

  for (const corridor of corridors) {
    const density = densityByCorridor?.get(corridor.id);
    ctx.fillStyle = density !== undefined ? getDensityColor(density) : "#2b2f3a";
    ctx.save();
    ctx.translate(corridor.a.x, corridor.a.y);
    ctx.rotate(corridor.angle);
    ctx.beginPath();
    ctx.rect(0, -corridor.width / 2, corridor.length, corridor.width);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Hub disks sized to the widest incident corridor cover the corner gaps
  // where corridors meet.
  ctx.fillStyle = "#2b2f3a";
  for (const hub of hubs) {
    ctx.beginPath();
    ctx.arc(hub.center.x, hub.center.y, hub.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Rim wall segments (same geometry the physics walls are built from) so
  // the closed hub boundary is visible; openings mark corridor attachments.
  ctx.strokeStyle = "#4a5064";
  ctx.lineWidth = 3;
  for (const segment of buildHubRimWalls(hubs, corridors)) {
    const half = segment.length / 2;
    const dx = Math.cos(segment.angle) * half;
    const dy = Math.sin(segment.angle) * half;
    ctx.beginPath();
    ctx.moveTo(segment.center.x - dx, segment.center.y - dy);
    ctx.lineTo(segment.center.x + dx, segment.center.y + dy);
    ctx.stroke();
  }
  ctx.restore();
}

export function clearCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.fillStyle = "#1c1f26";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export function drawGraphOverlay(
  ctx: CanvasRenderingContext2D,
  nodeIds: string[],
  edges: RawEdge[],
  positions: Map<string, Point>,
  draggingNodeId: string | null
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(200, 210, 230, 0.5)";
  ctx.lineWidth = 1.5;
  for (const edge of edges) {
    const a = positions.get(edge.source);
    const b = positions.get(edge.target);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  for (const id of nodeIds) {
    const p = positions.get(id);
    if (!p) continue;
    const isDragging = id === draggingNodeId;
    ctx.beginPath();
    ctx.arc(p.x, p.y, isDragging ? NODE_RADIUS + 2 : NODE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = isDragging ? "#ffd166" : "#7f9cf5";
    ctx.fill();
    ctx.strokeStyle = "#0f1115";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#0f1115";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(id, p.x, p.y - NODE_RADIUS - 8);
  }
  ctx.restore();
}

export function drawOrientedArrows(
  ctx: CanvasRenderingContext2D,
  positions: Map<string, Point>,
  orientedEdges: { from: string; to: string }[]
): void {
  ctx.save();
  ctx.strokeStyle = "#ef476f";
  ctx.fillStyle = "#ef476f";
  ctx.lineWidth = 2;
  for (const oe of orientedEdges) {
    const a = positions.get(oe.from);
    const b = positions.get(oe.to);
    if (!a || !b) continue;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const headLength = 8;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(
      mx - headLength * Math.cos(angle - Math.PI / 6),
      my - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      mx - headLength * Math.cos(angle + Math.PI / 6),
      my - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawAgents(
  ctx: CanvasRenderingContext2D,
  agentPositions: {
    x: number;
    y: number;
    vx?: number;
    vy?: number;
    id?: string;
    targetLabel?: string;
    isStuck?: boolean;
  }[],
  radius: number
): void {
  ctx.save();
  for (const p of agentPositions) {
    const targetColor = p.isStuck ? "#ff3b30" : colorForLabel(p.targetLabel ?? "");
    ctx.fillStyle = "#ffe66d";
    ctx.strokeStyle = targetColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const speed = Math.hypot(p.vx ?? 0, p.vy ?? 0);
    if (speed > 0.5) {
      const ux = (p.vx ?? 0) / speed;
      const uy = (p.vy ?? 0) / speed;
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + ux * (radius + 4), p.y + uy * (radius + 4));
      ctx.stroke();
    }

    if (p.targetLabel) {
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.fillStyle = targetColor;
      const label = p.isStuck && p.id ? `${p.id} → ${p.targetLabel}` : p.targetLabel;
      ctx.fillText(label, p.x + radius + 3, p.y - radius - 2);
    }
  }
  ctx.restore();
}

function colorForLabel(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 82% 66%)`;
}

export function hitTestNode(
  positions: Map<string, Point>,
  x: number,
  y: number,
  hitRadius = 14
): string | null {
  for (const [id, p] of positions) {
    if (Math.hypot(p.x - x, p.y - y) <= hitRadius) return id;
  }
  return null;
}
