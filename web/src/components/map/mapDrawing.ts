/**
 * Map drawing utilities and mode types for the world map canvas.
 */

export type MapMode = 'navigate' | 'draw-zone' | 'draw-route';

export interface RouteWaypoint {
  /** World X coordinate */
  x: number;
  /** World Z coordinate */
  z: number;
  /** Index in the waypoint sequence */
  index: number;
}

// ── Zone drawing types (agent 2-3) ──

export type ZoneShape = 'rectangular' | 'circular';

/** Describes an in-progress zone drawing on the canvas. */
export interface DrawingState {
  /** Whether the user is currently dragging. */
  active: boolean;
  /** Shape being drawn (rectangle by default, circle when Alt is held). */
  shape: ZoneShape;
  /** Canvas pixel where the drag started. */
  startX: number;
  startY: number;
  /** Canvas pixel of the current mouse position. */
  currentX: number;
  currentY: number;
}

/** The finalized zone geometry in Minecraft world coordinates. */
export interface DrawnZone {
  shape: ZoneShape;
  /** For rectangular zones: opposing corners. */
  x1?: number;
  z1?: number;
  x2?: number;
  z2?: number;
  /** For circular zones: center + radius. */
  cx?: number;
  cz?: number;
  radius?: number;
}

/** Convert a canvas pixel position to Minecraft world coordinates. */
export function canvasToWorld(
  canvasX: number,
  canvasY: number,
  viewportWidth: number,
  viewportHeight: number,
  offset: { x: number; y: number },
  scale: number,
): { x: number; z: number } {
  const cx = viewportWidth / 2;
  const cy = viewportHeight / 2;
  return {
    x: (canvasX - cx - offset.x) / scale,
    z: (canvasY - cy - offset.y) / scale,
  };
}

// ── Route drawing types (agent 2-4) ──

export interface DrawRouteState {
  waypoints: RouteWaypoint[];
  /** Whether the route is finalized (waiting for name dialog) */
  finalized: boolean;
}

export function createDrawRouteState(): DrawRouteState {
  return { waypoints: [], finalized: false };
}

/** Convert screen coordinates to world coordinates. */
export function screenToWorld(
  screenX: number,
  screenY: number,
  canvasWidth: number,
  canvasHeight: number,
  offset: { x: number; y: number },
  scale: number,
): { x: number; z: number } {
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  return {
    x: (screenX - cx - offset.x) / scale,
    z: (screenY - cy - offset.y) / scale,
  };
}

/** Convert world coordinates to screen coordinates. */
export function worldToScreen(
  worldX: number,
  worldZ: number,
  canvasWidth: number,
  canvasHeight: number,
  offset: { x: number; y: number },
  scale: number,
): { sx: number; sy: number } {
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  return {
    sx: cx + worldX * scale + offset.x,
    sy: cy + worldZ * scale + offset.y,
  };
}

const WAYPOINT_RADIUS = 6;
const WAYPOINT_COLOR = '#F59E0B'; // amber
const WAYPOINT_ACTIVE_COLOR = '#FBBF24';
const LINE_COLOR = '#F59E0B';
const LINE_WIDTH = 2.5;
const PREVIEW_LINE_ALPHA = '60';

/**
 * Draw the in-progress route on the canvas.
 * Call this from the main draw loop when mode === 'draw-route'.
 */
export function drawRouteOverlay(
  ctx: CanvasRenderingContext2D,
  state: DrawRouteState,
  canvasWidth: number,
  canvasHeight: number,
  offset: { x: number; y: number },
  scale: number,
  mouseWorld: { x: number; z: number } | null,
): void {
  const { waypoints } = state;
  if (waypoints.length === 0 && !mouseWorld) return;

  // Draw connecting lines between waypoints
  if (waypoints.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const first = worldToScreen(waypoints[0].x, waypoints[0].z, canvasWidth, canvasHeight, offset, scale);
    ctx.moveTo(first.sx, first.sy);

    for (let i = 1; i < waypoints.length; i++) {
      const pt = worldToScreen(waypoints[i].x, waypoints[i].z, canvasWidth, canvasHeight, offset, scale);
      ctx.lineTo(pt.sx, pt.sy);
    }
    ctx.stroke();
  }

  // Draw preview line from last waypoint to mouse cursor
  if (!state.finalized && mouseWorld && waypoints.length > 0) {
    const last = waypoints[waypoints.length - 1];
    const from = worldToScreen(last.x, last.z, canvasWidth, canvasHeight, offset, scale);
    const to = worldToScreen(mouseWorld.x, mouseWorld.z, canvasWidth, canvasHeight, offset, scale);

    ctx.beginPath();
    ctx.strokeStyle = LINE_COLOR + PREVIEW_LINE_ALPHA;
    ctx.lineWidth = LINE_WIDTH;
    ctx.setLineDash([6, 4]);
    ctx.moveTo(from.sx, from.sy);
    ctx.lineTo(to.sx, to.sy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw waypoint dots
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const { sx, sy } = worldToScreen(wp.x, wp.z, canvasWidth, canvasHeight, offset, scale);

    // Outer glow
    ctx.beginPath();
    ctx.arc(sx, sy, WAYPOINT_RADIUS + 3, 0, Math.PI * 2);
    ctx.fillStyle = WAYPOINT_COLOR + '30';
    ctx.fill();

    // Main dot
    ctx.beginPath();
    ctx.arc(sx, sy, WAYPOINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? '#34D399' : WAYPOINT_ACTIVE_COLOR; // green for first
    ctx.fill();
    ctx.strokeStyle = '#ffffffb0';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Index label
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), sx, sy);

    // Coordinate label
    ctx.fillStyle = '#ffffff80';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${Math.round(wp.x)}, ${Math.round(wp.z)}`, sx, sy + WAYPOINT_RADIUS + 4);
  }

  // Reset textBaseline
  ctx.textBaseline = 'alphabetic';

  // Draw preview waypoint at mouse cursor
  if (!state.finalized && mouseWorld) {
    const { sx, sy } = worldToScreen(mouseWorld.x, mouseWorld.z, canvasWidth, canvasHeight, offset, scale);
    ctx.beginPath();
    ctx.arc(sx, sy, WAYPOINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = WAYPOINT_COLOR + '50';
    ctx.fill();
    ctx.strokeStyle = '#ffffff50';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/**
 * Draw the status bar at the top of the canvas during route drawing.
 */
export function drawRouteStatusBar(
  ctx: CanvasRenderingContext2D,
  state: DrawRouteState,
  canvasWidth: number,
): void {
  if (state.finalized) return;

  const text = state.waypoints.length === 0
    ? 'Click to place waypoints. Double-click or press Enter to finish.'
    : `${state.waypoints.length} waypoint${state.waypoints.length !== 1 ? 's' : ''} placed. Double-click or Enter to finish. Ctrl+Z to undo.`;

  const barHeight = 32;
  ctx.fillStyle = '#F59E0B18';
  ctx.fillRect(0, 0, canvasWidth, barHeight);
  ctx.fillStyle = '#F59E0B';
  ctx.fillRect(0, barHeight - 1, canvasWidth, 1);

  ctx.fillStyle = '#F59E0B';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvasWidth / 2, barHeight / 2 + 4);
}

// ═══════════════════════════════════════
//  MAP OVERLAY DRAWING (missions, squads)
// ═══════════════════════════════════════

import type { MapOverlayMission, MapOverlayZone, MapOverlaySquad } from '@/lib/api';

const MISSION_STATUS_COLORS: Record<string, string> = {
  pending: '#F59E0B',   // amber
  active: '#10B981',    // green
  paused: '#6B7280',    // gray
  completed: '#3B82F6', // blue
  failed: '#EF4444',    // red
  cancelled: '#9CA3AF', // light gray
};

const SQUAD_COLORS = [
  '#8B5CF6', '#EC4899', '#F97316', '#06B6D4',
  '#84CC16', '#F43F5E', '#14B8A6', '#A855F7',
];

function missionColor(status: string): string {
  return MISSION_STATUS_COLORS[status] ?? '#6B7280';
}

function squadColor(squad: MapOverlaySquad, index: number): string {
  return (squad as any).color ?? SQUAD_COLORS[index % SQUAD_COLORS.length];
}

interface OverlayViewport {
  cx: number;
  cy: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

function overlayWorldToScreen(vp: OverlayViewport, wx: number, wz: number): [number, number] {
  return [
    vp.cx + wx * vp.scale + vp.offsetX,
    vp.cy + wz * vp.scale + vp.offsetY,
  ];
}

function drawOverlayZone(
  ctx: CanvasRenderingContext2D,
  vp: OverlayViewport,
  zone: MapOverlayZone,
  fillColor: string,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;

  if (zone.shape === 'rect' && zone.x1 != null && zone.z1 != null && zone.x2 != null && zone.z2 != null) {
    const [sx1, sy1] = overlayWorldToScreen(vp, Math.min(zone.x1, zone.x2), Math.min(zone.z1, zone.z2));
    const [sx2, sy2] = overlayWorldToScreen(vp, Math.max(zone.x1, zone.x2), Math.max(zone.z1, zone.z2));
    const w = sx2 - sx1;
    const h = sy2 - sy1;

    ctx.fillStyle = fillColor;
    ctx.fillRect(sx1, sy1, w, h);

    ctx.globalAlpha = Math.min(alpha * 2, 0.8);
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(sx1, sy1, w, h);
    ctx.setLineDash([]);
  } else if (zone.shape === 'circle' && zone.cx != null && zone.cz != null && zone.radius != null) {
    const [sx, sy] = overlayWorldToScreen(vp, zone.cx, zone.cz);
    const sr = zone.radius * vp.scale;

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = Math.min(alpha * 2, 0.8);
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function overlayZoneLabelPos(vp: OverlayViewport, zone: MapOverlayZone): [number, number] | null {
  if (zone.shape === 'rect' && zone.x1 != null && zone.z1 != null && zone.x2 != null && zone.z2 != null) {
    return overlayWorldToScreen(vp, (zone.x1 + zone.x2) / 2, Math.min(zone.z1, zone.z2));
  }
  if (zone.shape === 'circle' && zone.cx != null && zone.cz != null && zone.radius != null) {
    return overlayWorldToScreen(vp, zone.cx, zone.cz - zone.radius);
  }
  return null;
}

/**
 * Draw mission zone overlays on the map.
 * For each active mission that references a zone, draw the zone with mission status coloring.
 */
export function drawMissionOverlays(
  ctx: CanvasRenderingContext2D,
  vp: OverlayViewport,
  missions: MapOverlayMission[],
  zones: MapOverlayZone[],
) {
  const zoneMap = new Map(zones.map((z) => [z.id, z]));

  for (const mission of missions) {
    const zoneId = mission.params?.zoneId;
    const isPatrolType = mission.type === 'patrol_zone';
    if (!zoneId && !isPatrolType) continue;

    const zone = zoneId ? zoneMap.get(zoneId) : undefined;
    if (!zone) continue;

    if (mission.status === 'completed' || mission.status === 'cancelled') continue;

    const color = missionColor(mission.status);

    drawOverlayZone(ctx, vp, zone, color, 0.15);

    const labelPos = overlayZoneLabelPos(vp, zone);
    if (labelPos) {
      const [lx, ly] = labelPos;
      ctx.save();
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 3;

      const label = mission.label || mission.type.replace(/_/g, ' ');
      ctx.fillStyle = color;
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, lx, ly - 14);

      ctx.fillStyle = '#ffffffb0';
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillText(zone.name, lx, ly - 3);

      ctx.fillStyle = color + '90';
      ctx.font = '8px system-ui, sans-serif';
      ctx.fillText(`[${mission.status.toUpperCase()}]`, lx, ly + 8);

      if (mission.assignee) {
        ctx.fillStyle = '#ffffffd0';
        ctx.font = '9px system-ui, sans-serif';
        ctx.fillText(mission.assignee, lx, ly + 20);
      }

      ctx.restore();
    }
  }
}

/**
 * Draw squad overlays: a bounding box around all bot positions in each squad,
 * labeled with the squad name.
 */
export function drawSquadOverlays(
  ctx: CanvasRenderingContext2D,
  vp: OverlayViewport,
  squads: MapOverlaySquad[],
  botPositions: Map<string, { x: number; z: number }>,
) {
  for (let i = 0; i < squads.length; i++) {
    const squad = squads[i];
    if (!squad.members || squad.members.length === 0) continue;

    const points: { wx: number; wz: number; sx: number; sy: number }[] = [];
    for (const member of squad.members) {
      const pos = botPositions.get(member) ?? botPositions.get(member.toLowerCase());
      if (pos) {
        const [sx, sy] = overlayWorldToScreen(vp, pos.x, pos.z);
        points.push({ wx: pos.x, wz: pos.z, sx, sy });
      }
    }

    if (points.length === 0) continue;

    const color = squadColor(squad, i);
    const padding = 20;

    if (points.length === 1) {
      const p = points[0];
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, padding, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = 1;
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 3;
      ctx.fillStyle = color;
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(squad.name, p.sx, p.sy - padding - 6);
      ctx.restore();
      continue;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.sx < minX) minX = p.sx;
      if (p.sy < minY) minY = p.sy;
      if (p.sx > maxX) maxX = p.sx;
      if (p.sy > maxY) maxY = p.sy;
    }

    const bx = minX - padding;
    const by = minY - padding;
    const bw = maxX - minX + padding * 2;
    const bh = maxY - minY + padding * 2;
    const cornerR = 8;

    ctx.save();

    ctx.globalAlpha = 0.08;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, cornerR);
    ctx.fill();

    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, cornerR);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 1;
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 3;
    ctx.fillStyle = color;
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const labelX = bx + bw / 2;
    const labelY = by - 6;
    ctx.fillText(squad.name, labelX, labelY);

    ctx.fillStyle = color + '90';
    ctx.font = '8px system-ui, sans-serif';
    ctx.fillText(`${points.length}/${squad.members.length} online`, labelX, labelY + 10);

    ctx.restore();
  }
}
