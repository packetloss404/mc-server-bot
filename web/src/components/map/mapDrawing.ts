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
