/**
 * Map overlay drawing utilities for missions and squads.
 *
 * All drawing functions accept the canvas 2D context, the current
 * viewport transform (cx, cy, scale, offset), and the data to render.
 */

import type { Mission, Zone, Squad } from '@/lib/api';

// --- Color helpers ---

const MISSION_STATUS_COLORS: Record<string, string> = {
  pending: '#F59E0B',   // amber
  active: '#10B981',    // green
  paused: '#6B7280',    // gray
  completed: '#3B82F6', // blue
  failed: '#EF4444',    // red
  cancelled: '#9CA3AF', // light gray
};

const SQUAD_COLORS = [
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#F97316', // orange
  '#06B6D4', // cyan
  '#84CC16', // lime
  '#F43F5E', // rose
  '#14B8A6', // teal
  '#A855F7', // purple
];

function missionColor(status: string): string {
  return MISSION_STATUS_COLORS[status] ?? '#6B7280';
}

function squadColor(squad: Squad, index: number): string {
  return squad.color ?? SQUAD_COLORS[index % SQUAD_COLORS.length];
}

// --- Coordinate conversion ---

interface Viewport {
  cx: number; // canvas center x
  cy: number; // canvas center y
  scale: number;
  offsetX: number;
  offsetY: number;
}

function worldToScreen(vp: Viewport, wx: number, wz: number): [number, number] {
  return [
    vp.cx + wx * vp.scale + vp.offsetX,
    vp.cy + wz * vp.scale + vp.offsetY,
  ];
}

// --- Zone overlay drawing ---

/**
 * Draw a zone as a semi-transparent filled region with a border.
 */
function drawZone(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  zone: Zone,
  fillColor: string,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;

  if (zone.shape === 'rect' && zone.x1 != null && zone.z1 != null && zone.x2 != null && zone.z2 != null) {
    const [sx1, sy1] = worldToScreen(vp, Math.min(zone.x1, zone.x2), Math.min(zone.z1, zone.z2));
    const [sx2, sy2] = worldToScreen(vp, Math.max(zone.x1, zone.x2), Math.max(zone.z1, zone.z2));
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
    const [sx, sy] = worldToScreen(vp, zone.cx, zone.cz);
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

/**
 * Get the label anchor point (screen coords) for a zone.
 */
function zoneLabelPos(vp: Viewport, zone: Zone): [number, number] | null {
  if (zone.shape === 'rect' && zone.x1 != null && zone.z1 != null && zone.x2 != null && zone.z2 != null) {
    return worldToScreen(vp, (zone.x1 + zone.x2) / 2, Math.min(zone.z1, zone.z2));
  }
  if (zone.shape === 'circle' && zone.cx != null && zone.cz != null && zone.radius != null) {
    return worldToScreen(vp, zone.cx, zone.cz - zone.radius);
  }
  return null;
}

// --- Public drawing functions ---

/**
 * Draw mission zone overlays on the map.
 * For each active mission that references a zone, draw the zone with mission status coloring.
 */
export function drawMissionOverlays(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  missions: Mission[],
  zones: Zone[],
) {
  const zoneMap = new Map(zones.map((z) => [z.id, z]));

  for (const mission of missions) {
    // Only draw missions that reference a zone
    const zoneId = mission.params?.zoneId;
    const isPatrolType = mission.type === 'patrol_zone';
    if (!zoneId && !isPatrolType) continue;

    const zone = zoneId ? zoneMap.get(zoneId) : undefined;
    if (!zone) continue;

    // Skip completed/cancelled for cleaner visuals (unless they're the only ones)
    if (mission.status === 'completed' || mission.status === 'cancelled') continue;

    const color = missionColor(mission.status);

    // Draw zone fill
    drawZone(ctx, vp, zone, color, 0.15);

    // Draw zone label
    const labelPos = zoneLabelPos(vp, zone);
    if (labelPos) {
      const [lx, ly] = labelPos;
      ctx.save();
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 3;

      // Mission label
      const label = mission.label || mission.type.replace(/_/g, ' ');
      ctx.fillStyle = color;
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, lx, ly - 14);

      // Zone name
      ctx.fillStyle = '#ffffffb0';
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillText(zone.name, lx, ly - 3);

      // Status badge
      ctx.fillStyle = color + '90';
      ctx.font = '8px system-ui, sans-serif';
      ctx.fillText(`[${mission.status.toUpperCase()}]`, lx, ly + 8);

      // Assignee bot name
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
  vp: Viewport,
  squads: Squad[],
  botPositions: Map<string, { x: number; z: number }>,
) {
  for (let i = 0; i < squads.length; i++) {
    const squad = squads[i];
    if (!squad.members || squad.members.length === 0) continue;

    // Collect screen positions for squad members that have positions
    const points: { wx: number; wz: number; sx: number; sy: number }[] = [];
    for (const member of squad.members) {
      const pos = botPositions.get(member) ?? botPositions.get(member.toLowerCase());
      if (pos) {
        const [sx, sy] = worldToScreen(vp, pos.x, pos.z);
        points.push({ wx: pos.x, wz: pos.z, sx, sy });
      }
    }

    if (points.length === 0) continue;

    const color = squadColor(squad, i);
    const padding = 20; // screen-space padding around bounding box

    if (points.length === 1) {
      // Single member: draw a circle around the bot
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

      // Label
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

    // Multiple members: compute bounding box in screen space
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

    // Semi-transparent fill
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, cornerR);
    ctx.fill();

    // Dashed border
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, cornerR);
    ctx.stroke();
    ctx.setLineDash([]);

    // Squad name label at top center
    ctx.globalAlpha = 1;
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 3;
    ctx.fillStyle = color;
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const labelX = bx + bw / 2;
    const labelY = by - 6;
    ctx.fillText(squad.name, labelX, labelY);

    // Member count
    ctx.fillStyle = color + '90';
    ctx.font = '8px system-ui, sans-serif';
    ctx.fillText(`${points.length}/${squad.members.length} online`, labelX, labelY + 10);

    ctx.restore();
  }
}
