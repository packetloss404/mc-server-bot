/**
 * Map drawing utilities for zone creation on the HTML5 Canvas map.
 *
 * Supports two zone shapes:
 *   - Rectangle: click-and-drag draws a rectangular zone
 *   - Circle: Alt+click-and-drag draws a circle from center outward
 *
 * Canvas coordinates are converted to Minecraft world coordinates using the
 * current viewport offset and scale.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type MapMode = 'navigate' | 'draw-zone';

export type ZoneShape = 'rectangular' | 'circular';

/** Describes an in-progress drawing on the canvas. */
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

// ── Coordinate conversion ────────────────────────────────────────────────────

/** Convert a canvas pixel position to Minecraft world coordinates. */
export function canvasToWorld(
  canvasX: number,
  canvasY: number,
  viewportWidth: number,
  viewportHeight: number,
  offset: { x: number; y: number },
  scale: number,
): { wx: number; wz: number } {
  const cx = viewportWidth / 2;
  const cy = viewportHeight / 2;
  const wx = (canvasX - cx - offset.x) / scale;
  const wz = (canvasY - cy - offset.y) / scale;
  return { wx, wz };
}

// ── Drawing handlers ─────────────────────────────────────────────────────────

export function startDrawing(
  canvasX: number,
  canvasY: number,
  altKey: boolean,
): DrawingState {
  return {
    active: true,
    shape: altKey ? 'circular' : 'rectangular',
    startX: canvasX,
    startY: canvasY,
    currentX: canvasX,
    currentY: canvasY,
  };
}

export function updateDrawing(
  state: DrawingState,
  canvasX: number,
  canvasY: number,
): DrawingState {
  return { ...state, currentX: canvasX, currentY: canvasY };
}

export function finalizeDrawing(
  state: DrawingState,
  viewportWidth: number,
  viewportHeight: number,
  offset: { x: number; y: number },
  scale: number,
): DrawnZone | null {
  if (!state.active) return null;

  // Require minimum drag distance (10px) to avoid accidental clicks
  const dx = state.currentX - state.startX;
  const dy = state.currentY - state.startY;
  if (Math.sqrt(dx * dx + dy * dy) < 10) return null;

  if (state.shape === 'circular') {
    const center = canvasToWorld(
      state.startX,
      state.startY,
      viewportWidth,
      viewportHeight,
      offset,
      scale,
    );
    const edge = canvasToWorld(
      state.currentX,
      state.currentY,
      viewportWidth,
      viewportHeight,
      offset,
      scale,
    );
    const radius = Math.sqrt(
      (edge.wx - center.wx) ** 2 + (edge.wz - center.wz) ** 2,
    );
    return {
      shape: 'circular',
      cx: Math.round(center.wx),
      cz: Math.round(center.wz),
      radius: Math.round(radius),
    };
  }

  // Rectangular
  const corner1 = canvasToWorld(
    state.startX,
    state.startY,
    viewportWidth,
    viewportHeight,
    offset,
    scale,
  );
  const corner2 = canvasToWorld(
    state.currentX,
    state.currentY,
    viewportWidth,
    viewportHeight,
    offset,
    scale,
  );
  return {
    shape: 'rectangular',
    x1: Math.round(Math.min(corner1.wx, corner2.wx)),
    z1: Math.round(Math.min(corner1.wz, corner2.wz)),
    x2: Math.round(Math.max(corner1.wx, corner2.wx)),
    z2: Math.round(Math.max(corner1.wz, corner2.wz)),
  };
}

// ── Canvas overlay rendering ─────────────────────────────────────────────────

const ZONE_FILL = 'rgba(59, 130, 246, 0.15)';
const ZONE_STROKE = 'rgba(59, 130, 246, 0.6)';
const ZONE_DASH = [6, 4];

/**
 * Render the in-progress zone overlay on the canvas.
 * Call this from the draw loop when a drawing is active.
 */
export function renderDrawingOverlay(
  ctx: CanvasRenderingContext2D,
  state: DrawingState,
): void {
  if (!state.active) return;

  ctx.save();
  ctx.setLineDash(ZONE_DASH);
  ctx.strokeStyle = ZONE_STROKE;
  ctx.fillStyle = ZONE_FILL;
  ctx.lineWidth = 2;

  if (state.shape === 'circular') {
    const dx = state.currentX - state.startX;
    const dy = state.currentY - state.startY;
    const radius = Math.sqrt(dx * dx + dy * dy);

    ctx.beginPath();
    ctx.arc(state.startX, state.startY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw crosshair at center
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(state.startX - 6, state.startY);
    ctx.lineTo(state.startX + 6, state.startY);
    ctx.moveTo(state.startX, state.startY - 6);
    ctx.lineTo(state.startX, state.startY + 6);
    ctx.stroke();
  } else {
    const x = Math.min(state.startX, state.currentX);
    const y = Math.min(state.startY, state.currentY);
    const w = Math.abs(state.currentX - state.startX);
    const h = Math.abs(state.currentY - state.startY);

    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  ctx.restore();
}

/**
 * Render persisted zones on the map canvas.
 */
export function renderZones(
  ctx: CanvasRenderingContext2D,
  zones: Array<{
    id: string;
    name: string;
    type: string;
    shape: ZoneShape;
    x1?: number;
    z1?: number;
    x2?: number;
    z2?: number;
    cx?: number;
    cz?: number;
    radius?: number;
  }>,
  viewportWidth: number,
  viewportHeight: number,
  offset: { x: number; y: number },
  scale: number,
): void {
  const halfW = viewportWidth / 2;
  const halfH = viewportHeight / 2;

  const ZONE_COLORS: Record<string, { fill: string; stroke: string }> = {
    guard: { fill: 'rgba(239, 68, 68, 0.10)', stroke: 'rgba(239, 68, 68, 0.45)' },
    farm: { fill: 'rgba(34, 197, 94, 0.10)', stroke: 'rgba(34, 197, 94, 0.45)' },
    build: { fill: 'rgba(59, 130, 246, 0.10)', stroke: 'rgba(59, 130, 246, 0.45)' },
    mine: { fill: 'rgba(234, 179, 8, 0.10)', stroke: 'rgba(234, 179, 8, 0.45)' },
    default: { fill: 'rgba(148, 163, 184, 0.10)', stroke: 'rgba(148, 163, 184, 0.45)' },
  };

  for (const zone of zones) {
    const colors = ZONE_COLORS[zone.type] ?? ZONE_COLORS.default;
    ctx.save();
    ctx.fillStyle = colors.fill;
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1.5;

    if (zone.shape === 'circular' && zone.cx != null && zone.cz != null && zone.radius != null) {
      const sx = halfW + zone.cx * scale + offset.x;
      const sy = halfH + zone.cz * scale + offset.y;
      const sr = zone.radius * scale;

      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Label
      ctx.fillStyle = colors.stroke;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(zone.name, sx, sy - sr - 4);
    } else if (zone.x1 != null && zone.z1 != null && zone.x2 != null && zone.z2 != null) {
      const sx = halfW + zone.x1 * scale + offset.x;
      const sy = halfH + zone.z1 * scale + offset.y;
      const sw = (zone.x2 - zone.x1) * scale;
      const sh = (zone.z2 - zone.z1) * scale;

      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeRect(sx, sy, sw, sh);

      // Label
      ctx.fillStyle = colors.stroke;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(zone.name, sx + 4, sy + 12);
    }

    ctx.restore();
  }
}
