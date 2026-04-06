/**
 * Map drawing utilities: coordinate transforms and overlay rendering.
 */
import type { Marker, Zone, Route, Mission, Squad } from './api';

// Zone type -> color mapping
const ZONE_COLORS: Record<string, string> = {
  guard: '#4A90D9',
  build: '#1ABC9C',
  farm: '#F39C12',
  restricted: '#EF4444',
  custom: '#8B5CF6',
};

const ROUTE_DEFAULT_COLOR = '#F59E0B';
const MARKER_DEFAULT_COLOR = '#FFFFFF';

// ── Coordinate transforms ──

export function worldToScreen(
  wx: number,
  wz: number,
  cx: number,
  cy: number,
  scale: number,
  offset: { x: number; y: number },
): { sx: number; sy: number } {
  return {
    sx: cx + wx * scale + offset.x,
    sy: cy + wz * scale + offset.y,
  };
}

export function screenToWorld(
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  scale: number,
  offset: { x: number; y: number },
): { wx: number; wz: number } {
  return {
    wx: (sx - cx - offset.x) / scale,
    wz: (sy - cy - offset.y) / scale,
  };
}

// ── Marker rendering ──

export function drawMarkers(
  ctx: CanvasRenderingContext2D,
  markers: Marker[],
  cx: number,
  cy: number,
  scale: number,
  offset: { x: number; y: number },
) {
  for (const marker of markers) {
    const { sx, sy } = worldToScreen(marker.x, marker.z, cx, cy, scale, offset);

    const color = marker.color || MARKER_DEFAULT_COLOR;

    // Diamond shape
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx, sy - 7);
    ctx.lineTo(sx + 5, sy);
    ctx.lineTo(sx, sy + 7);
    ctx.lineTo(sx - 5, sy);
    ctx.closePath();
    ctx.fillStyle = color + 'CC';
    ctx.fill();
    ctx.strokeStyle = '#000000AA';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 3;
    ctx.fillStyle = '#ffffffCC';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(marker.name, sx, sy - 11);
    ctx.restore();
  }
}

// ── Zone rendering ──

export function drawZones(
  ctx: CanvasRenderingContext2D,
  zones: Zone[],
  cx: number,
  cy: number,
  scale: number,
  offset: { x: number; y: number },
) {
  for (const zone of zones) {
    const color = zone.color || ZONE_COLORS[zone.type] || '#6B7280';
    const tl = worldToScreen(zone.x1, zone.z1, cx, cy, scale, offset);
    const br = worldToScreen(zone.x2, zone.z2, cx, cy, scale, offset);
    const w = br.sx - tl.sx;
    const h = br.sy - tl.sy;

    ctx.save();
    ctx.fillStyle = color + '18';
    ctx.fillRect(tl.sx, tl.sy, w, h);
    ctx.strokeStyle = color + '80';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(tl.sx, tl.sy, w, h);
    ctx.setLineDash([]);

    // Zone label
    ctx.fillStyle = color + 'CC';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 3;
    ctx.fillText(zone.name, tl.sx + 4, tl.sy + 13);
    ctx.fillStyle = color + '80';
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillText(zone.type.toUpperCase(), tl.sx + 4, tl.sy + 24);
    ctx.restore();
  }
}

// ── Route rendering ──

export function drawRoutes(
  ctx: CanvasRenderingContext2D,
  routes: Route[],
  cx: number,
  cy: number,
  scale: number,
  offset: { x: number; y: number },
) {
  for (const route of routes) {
    if (route.waypoints.length < 2) continue;
    const color = route.color || ROUTE_DEFAULT_COLOR;

    ctx.save();
    ctx.strokeStyle = color + 'B0';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    const first = worldToScreen(route.waypoints[0].x, route.waypoints[0].z, cx, cy, scale, offset);
    ctx.moveTo(first.sx, first.sy);
    for (let i = 1; i < route.waypoints.length; i++) {
      const pt = worldToScreen(route.waypoints[i].x, route.waypoints[i].z, cx, cy, scale, offset);
      ctx.lineTo(pt.sx, pt.sy);
    }
    if (route.loop) {
      ctx.lineTo(first.sx, first.sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Waypoint dots
    for (let i = 0; i < route.waypoints.length; i++) {
      const pt = worldToScreen(route.waypoints[i].x, route.waypoints[i].z, cx, cy, scale, offset);
      ctx.beginPath();
      ctx.arc(pt.sx, pt.sy, 3, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#10B981' : color;
      ctx.fill();
      ctx.strokeStyle = '#000000AA';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Route label at first point
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 3;
    ctx.fillStyle = color + 'CC';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(route.name, first.sx + 6, first.sy - 6);
    ctx.restore();
  }
}

// ── Zone draw preview ──

export function drawZonePreview(
  ctx: CanvasRenderingContext2D,
  start: { x: number; z: number },
  end: { x: number; z: number },
  cx: number,
  cy: number,
  scale: number,
  offset: { x: number; y: number },
) {
  const tl = worldToScreen(
    Math.min(start.x, end.x),
    Math.min(start.z, end.z),
    cx, cy, scale, offset,
  );
  const br = worldToScreen(
    Math.max(start.x, end.x),
    Math.max(start.z, end.z),
    cx, cy, scale, offset,
  );
  const w = br.sx - tl.sx;
  const h = br.sy - tl.sy;

  ctx.save();
  ctx.fillStyle = '#8B5CF620';
  ctx.fillRect(tl.sx, tl.sy, w, h);
  ctx.strokeStyle = '#8B5CF6A0';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);
  ctx.strokeRect(tl.sx, tl.sy, w, h);
  ctx.setLineDash([]);

  // Dimension label
  const dimW = Math.abs(Math.round(end.x - start.x));
  const dimH = Math.abs(Math.round(end.z - start.z));
  ctx.fillStyle = '#ffffffB0';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 3;
  ctx.fillText(`${dimW} x ${dimH}`, tl.sx + w / 2, tl.sy + h / 2 + 4);
  ctx.restore();
}

// ── Route draw preview ──

export function drawRoutePreview(
  ctx: CanvasRenderingContext2D,
  waypoints: { x: number; y: number; z: number }[],
  cx: number,
  cy: number,
  scale: number,
  offset: { x: number; y: number },
) {
  if (waypoints.length === 0) return;

  ctx.save();
  ctx.strokeStyle = '#F59E0BA0';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.beginPath();
  const first = worldToScreen(waypoints[0].x, waypoints[0].z, cx, cy, scale, offset);
  ctx.moveTo(first.sx, first.sy);
  for (let i = 1; i < waypoints.length; i++) {
    const pt = worldToScreen(waypoints[i].x, waypoints[i].z, cx, cy, scale, offset);
    ctx.lineTo(pt.sx, pt.sy);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Waypoint dots
  for (let i = 0; i < waypoints.length; i++) {
    const pt = worldToScreen(waypoints[i].x, waypoints[i].z, cx, cy, scale, offset);
    ctx.beginPath();
    ctx.arc(pt.sx, pt.sy, 4, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? '#10B981' : '#F59E0B';
    ctx.fill();
    ctx.strokeStyle = '#ffffffB0';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Number label
    ctx.fillStyle = '#ffffffCC';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), pt.sx, pt.sy - 8);
  }
  ctx.restore();
}

// ── Mission overlays ──

export function drawMissionOverlays(
  ctx: CanvasRenderingContext2D,
  missions: Mission[],
  cx: number,
  cy: number,
  scale: number,
  offset: { x: number; y: number },
  botPositions: Map<string, { x: number; z: number }>,
) {
  const activeMissions = missions.filter((m) => m.status === 'running');
  for (const mission of activeMissions) {
    const pos = botPositions.get(mission.botName.toLowerCase());
    if (!pos) continue;

    const { sx, sy } = worldToScreen(pos.x, pos.z, cx, cy, scale, offset);

    // Pulsing ring around bot on active mission
    ctx.save();
    const t = (Date.now() % 2000) / 2000;
    const pulseR = 14 + t * 8;
    const alpha = Math.floor((1 - t) * 60).toString(16).padStart(2, '0');
    ctx.beginPath();
    ctx.arc(sx, sy, pulseR, 0, Math.PI * 2);
    ctx.strokeStyle = '#10B981' + alpha;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Mission label
    ctx.fillStyle = '#10B981A0';
    ctx.font = '8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 2;
    ctx.fillText(mission.name || mission.type, sx, sy + 22);
    ctx.restore();
  }
}

// ── Squad overlays ──

export function drawSquadOverlays(
  ctx: CanvasRenderingContext2D,
  squads: Squad[],
  cx: number,
  cy: number,
  scale: number,
  offset: { x: number; y: number },
  botPositions: Map<string, { x: number; z: number }>,
) {
  for (const squad of squads) {
    const positions: { sx: number; sy: number }[] = [];
    for (const member of squad.members) {
      const pos = botPositions.get(member.toLowerCase());
      if (pos) {
        positions.push(worldToScreen(pos.x, pos.z, cx, cy, scale, offset));
      }
    }
    if (positions.length < 2) continue;

    const color = squad.color || '#60A5FA';

    // Draw connecting lines between squad members
    ctx.save();
    ctx.strokeStyle = color + '30';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        ctx.beginPath();
        ctx.moveTo(positions[i].sx, positions[i].sy);
        ctx.lineTo(positions[j].sx, positions[j].sy);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Squad label at centroid
    const avgX = positions.reduce((s, p) => s + p.sx, 0) / positions.length;
    const avgY = positions.reduce((s, p) => s + p.sy, 0) / positions.length;
    ctx.fillStyle = color + '80';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 3;
    ctx.fillText(`[${squad.name}]`, avgX, avgY - 20);
    ctx.restore();
  }
}
