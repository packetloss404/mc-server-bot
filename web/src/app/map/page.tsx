'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useBotStore } from '@/lib/store';
import { useControlStore } from '@/lib/controlStore';
import { api } from '@/lib/api';
import type { Zone, Route, Marker } from '@/lib/api';
import { getPersonalityColor, PLAYER_COLOR, STATE_COLORS } from '@/lib/constants';
import { getBlockColor } from '@/lib/blockColors';
import { MapContextMenu, type ContextMenuTarget, type ContextMenuAction } from '@/components/map/MapContextMenu';
import { ZoneDetailPanel, RouteDetailPanel, MarkerDetailPanel, ZONE_TYPE_COLORS } from '@/components/map/MapEntitySidebar';

const MIN_SCALE = 0.5;
const MAX_SCALE = 10;
const TRAIL_LENGTH = 80;
const TERRAIN_RADIUS = 96;
const TERRAIN_STEP = 2;
const ZOOM_SENSITIVITY = 0.002; // Normalized zoom speed

interface MapEntity {
  name: string;
  x: number;
  z: number;
  color: string;
  type: 'bot' | 'player';
  state?: string;
  personality?: string;
}

export default function MapPage() {
  const bots = useBotStore((s) => s.botList);
  const players = useBotStore((s) => s.playerList);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use refs for all values the draw loop needs — avoids effect restarts
  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(3);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const showRef = useRef({ bots: true, players: true, trails: true, grid: true, coords: true, terrain: true });
  const botsRef = useRef(bots);
  const playersRef = useRef(players);
  const trails = useRef<Map<string, { x: number; z: number }[]>>(new Map());
  const entityPositions = useRef<Map<string, { sx: number; sy: number; radius: number }>>(new Map());
  const terrainCanvas = useRef<OffscreenCanvas | null>(null);
  const terrainMeta = useRef<{ cx: number; cz: number; radius: number } | null>(null);
  const initializedRef = useRef(false);

  // Control store
  const controlStore = useControlStore();
  const zones = useControlStore((s) => s.zones);
  const markers = useControlStore((s) => s.markers);
  const routes = useControlStore((s) => s.routes);
  const missions = useControlStore((s) => s.missions);
  const selectedBotIds = useControlStore((s) => s.selectedBotIds);
  const controlLoaded = useControlStore((s) => s.loaded);
  const zonesRef = useRef(zones);
  const markersRef = useRef(markers);
  const routesRef = useRef(routes);
  const missionsRef = useRef(missions);
  zonesRef.current = zones;
  markersRef.current = markers;
  routesRef.current = routes;
  missionsRef.current = missions;

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: ContextMenuTarget;
  } | null>(null);

  // Sidebar detail selection
  const [sidebarDetail, setSidebarDetail] = useState<
    | { kind: 'zone'; zone: Zone }
    | { kind: 'route'; route: Route }
    | { kind: 'marker'; marker: Marker }
    | null
  >(null);

  // Show overlays toggles (state + refs so draw loop can read them)
  const [showZones, setShowZones] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const showZonesRef = useRef(showZones);
  const showMarkersRef = useRef(showMarkers);
  const showRoutesRef = useRef(showRoutes);
  showZonesRef.current = showZones;
  showMarkersRef.current = showMarkers;
  showRoutesRef.current = showRoutes;

  // Hit-test refs for zones/markers on canvas
  const zoneHitAreas = useRef<Map<string, { zone: Zone; screenBounds: { x: number; y: number; w: number; h: number } }>>(new Map());
  const markerHitAreas = useRef<Map<string, { marker: Marker; sx: number; sy: number; radius: number }>>(new Map());
  const routeHitAreas = useRef<Map<string, { route: Route; segments: { sx1: number; sy1: number; sx2: number; sy2: number }[] }>>(new Map());

  // State just for UI re-renders (toolbar, sidebar)
  const [, forceRender] = useState(0);
  const kick = () => forceRender((n) => n + 1);

  const [terrainStatus, setTerrainStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  // Keep refs in sync with zustand
  botsRef.current = bots;
  playersRef.current = players;

  // Load terrain
  const loadTerrain = useCallback(async (centerX: number, centerZ: number) => {
    const cx = Math.round(centerX);
    const cz = Math.round(centerZ);

    if (terrainMeta.current) {
      const dx = Math.abs(terrainMeta.current.cx - cx);
      const dz = Math.abs(terrainMeta.current.cz - cz);
      if (dx < TERRAIN_RADIUS / 2 && dz < TERRAIN_RADIUS / 2) return;
    }

    setTerrainStatus('loading');
    try {
      const data = await api.getTerrain(cx, cz, TERRAIN_RADIUS, TERRAIN_STEP);
      const size = data.size;
      const offscreen = new OffscreenCanvas(size, size);
      const octx = offscreen.getContext('2d');
      if (octx) {
        for (let z = 0; z < size; z++) {
          for (let x = 0; x < size; x++) {
            octx.fillStyle = getBlockColor(data.blocks[z * size + x]);
            octx.fillRect(x, z, 1, 1);
          }
        }
      }
      terrainCanvas.current = offscreen;
      terrainMeta.current = { cx, cz, radius: data.radius };
      setTerrainStatus('loaded');
    } catch {
      setTerrainStatus('error');
    }
  }, []);

  // Load control data (zones, markers, routes, missions)
  useEffect(() => {
    if (!controlLoaded) {
      controlStore.fetchAll();
    }
  }, [controlLoaded, controlStore]);

  // Track position history
  useEffect(() => {
    for (const e of [...bots, ...players.filter((p) => p.isOnline)]) {
      if (!e.position) continue;
      const trail = trails.current.get(e.name) || [];
      const last = trail[trail.length - 1];
      if (!last || Math.abs(last.x - e.position.x) > 0.5 || Math.abs(last.z - e.position.z) > 0.5) {
        trail.push({ x: e.position.x, z: e.position.z });
        if (trail.length > TRAIL_LENGTH) trail.shift();
        trails.current.set(e.name, trail);
      }
    }
  }, [bots, players]);

  // Center on first entity once
  useEffect(() => {
    if (initializedRef.current) return;
    const allEntities = [...bots, ...players.filter((p) => p.isOnline)];
    const first = allEntities.find((e) => e.position);
    if (first?.position) {
      offsetRef.current = { x: -first.position.x * scaleRef.current, y: -first.position.z * scaleRef.current };
      initializedRef.current = true;
      loadTerrain(first.position.x, first.position.z);
      kick();
    }
  }, [bots, players, loadTerrain]);

  // Single stable draw loop — never restarts
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrame: number;
    let prevW = 0;
    let prevH = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;

      // Only resize canvas when container size changes
      if (w !== prevW || h !== prevH) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        prevW = w;
        prevH = h;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const offset = offsetRef.current;
      const scale = scaleRef.current;
      const show = showRef.current;
      const bots = botsRef.current;
      const players = playersRef.current;
      const hovered = hoveredRef.current;
      const selected = selectedRef.current;

      const cx = w / 2;
      const cy = h / 2;

      // Background
      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, w, h);

      // Terrain
      if (show.terrain && terrainCanvas.current && terrainMeta.current) {
        const tm = terrainMeta.current;
        const tc = terrainCanvas.current;
        const worldLeft = tm.cx - tm.radius;
        const worldTop = tm.cz - tm.radius;
        const screenX = cx + worldLeft * scale + offset.x;
        const screenY = cy + worldTop * scale + offset.y;
        const screenW = tc.width * TERRAIN_STEP * scale;
        const screenH = tc.height * TERRAIN_STEP * scale;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tc, screenX, screenY, screenW, screenH);
      }

      // Grid
      if (show.grid) {
        const gridSize = 16 * scale;
        if (gridSize > 4) {
          const hasTerrain = show.terrain && terrainCanvas.current;
          ctx.strokeStyle = hasTerrain ? '#00000030' : '#ffffff12';
          ctx.lineWidth = 1;
          const startX = ((cx + offset.x) % gridSize + gridSize) % gridSize;
          const startY = ((cy + offset.y) % gridSize + gridSize) % gridSize;
          for (let x = startX; x < w; x += gridSize) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
          }
          for (let y = startY; y < h; y += gridSize) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          }

          const originX = cx + offset.x;
          const originY = cy + offset.y;
          ctx.strokeStyle = hasTerrain ? '#00000050' : '#ffffff20';
          ctx.lineWidth = 1.5;
          if (originX >= 0 && originX <= w) {
            ctx.beginPath(); ctx.moveTo(originX, 0); ctx.lineTo(originX, h); ctx.stroke();
          }
          if (originY >= 0 && originY <= h) {
            ctx.beginPath(); ctx.moveTo(0, originY); ctx.lineTo(w, originY); ctx.stroke();
          }
        }
      }

      // Origin label
      if (show.coords) {
        const ox = cx + offset.x;
        const oy = cy + offset.y;
        if (ox >= 0 && ox <= w && oy >= 0 && oy <= h) {
          ctx.fillStyle = '#ffffff40';
          ctx.font = '10px monospace';
          ctx.textAlign = 'left';
          ctx.fillText('0, 0', ox + 4, oy - 4);
        }
      }

      // ── Zone overlays ──
      zoneHitAreas.current.clear();
      if (showZonesRef.current)
      for (const zone of zonesRef.current) {
        const zcx = cx + zone.center.x * scale + offset.x;
        const zcy = cy + zone.center.z * scale + offset.y;

        // Determine color from zone type or active mission
        const hasActiveMission = missionsRef.current.some(
          (m) => m.zoneId === zone.id && ['pending', 'active'].includes(m.status),
        );
        const baseColor = zone.color || ZONE_TYPE_COLORS[zone.type] || '#6B7280';

        if (zone.shape === 'rect' && zone.rx && zone.rz) {
          const sw = zone.rx * 2 * scale;
          const sh = zone.rz * 2 * scale;
          const sx = zcx - sw / 2;
          const sy = zcy - sh / 2;

          ctx.fillStyle = baseColor + (hasActiveMission ? '30' : '18');
          ctx.fillRect(sx, sy, sw, sh);
          ctx.strokeStyle = baseColor + (hasActiveMission ? '90' : '50');
          ctx.lineWidth = hasActiveMission ? 2 : 1;
          ctx.setLineDash(hasActiveMission ? [] : [4, 3]);
          ctx.strokeRect(sx, sy, sw, sh);
          ctx.setLineDash([]);

          zoneHitAreas.current.set(zone.id, { zone, screenBounds: { x: sx, y: sy, w: sw, h: sh } });

          // Zone label
          ctx.save();
          ctx.fillStyle = baseColor + 'CC';
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
          ctx.fillText(zone.name, zcx, sy + 12);
          ctx.restore();

          // Active mission indicator
          if (hasActiveMission) {
            ctx.fillStyle = '#10B981';
            ctx.beginPath();
            ctx.arc(zcx + sw / 2 - 8, sy + 8, 4, 0, Math.PI * 2);
            ctx.fill();
          }

          // Assignee icons near zone
          if (zone.assignedBots && zone.assignedBots.length > 0) {
            ctx.save();
            ctx.font = '9px system-ui';
            ctx.fillStyle = '#ffffff80';
            ctx.textAlign = 'left';
            zone.assignedBots.forEach((botName, i) => {
              ctx.fillText(botName, sx + 4, sy + sh - 4 - i * 12);
            });
            ctx.restore();
          }
        } else if (zone.shape === 'circle' && zone.radius) {
          const sr = zone.radius * scale;

          ctx.fillStyle = baseColor + (hasActiveMission ? '30' : '18');
          ctx.beginPath();
          ctx.arc(zcx, zcy, sr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = baseColor + (hasActiveMission ? '90' : '50');
          ctx.lineWidth = hasActiveMission ? 2 : 1;
          ctx.setLineDash(hasActiveMission ? [] : [4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);

          const bounds = { x: zcx - sr, y: zcy - sr, w: sr * 2, h: sr * 2 };
          zoneHitAreas.current.set(zone.id, { zone, screenBounds: bounds });

          ctx.save();
          ctx.fillStyle = baseColor + 'CC';
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
          ctx.fillText(zone.name, zcx, zcy - sr - 4);
          ctx.restore();

          if (hasActiveMission) {
            ctx.fillStyle = '#10B981';
            ctx.beginPath();
            ctx.arc(zcx + sr - 6, zcy - sr + 6, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // ── Route overlays ──
      routeHitAreas.current.clear();
      if (showRoutesRef.current)
      for (const route of routesRef.current) {
        if (route.waypoints.length < 2) continue;
        const color = route.color || '#A78BFA';
        const segments: { sx1: number; sy1: number; sx2: number; sy2: number }[] = [];

        ctx.strokeStyle = color + '80';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        for (let i = 0; i < route.waypoints.length; i++) {
          const wp = route.waypoints[i];
          const sx = cx + wp.x * scale + offset.x;
          const sy = cy + wp.z * scale + offset.y;
          if (i === 0) ctx.moveTo(sx, sy);
          else {
            ctx.lineTo(sx, sy);
            const prev = route.waypoints[i - 1];
            segments.push({
              sx1: cx + prev.x * scale + offset.x,
              sy1: cy + prev.z * scale + offset.y,
              sx2: sx, sy2: sy,
            });
          }
        }
        if (route.loop && route.waypoints.length > 2) {
          const first = route.waypoints[0];
          const last = route.waypoints[route.waypoints.length - 1];
          ctx.lineTo(cx + first.x * scale + offset.x, cy + first.z * scale + offset.y);
          segments.push({
            sx1: cx + last.x * scale + offset.x,
            sy1: cy + last.z * scale + offset.y,
            sx2: cx + first.x * scale + offset.x,
            sy2: cy + first.z * scale + offset.y,
          });
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Waypoint dots
        for (const wp of route.waypoints) {
          const sx = cx + wp.x * scale + offset.x;
          const sy = cy + wp.z * scale + offset.y;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, Math.PI * 2);
          ctx.fill();
        }

        // Route label
        const mid = route.waypoints[Math.floor(route.waypoints.length / 2)];
        const msx = cx + mid.x * scale + offset.x;
        const msy = cy + mid.z * scale + offset.y;
        ctx.save();
        ctx.fillStyle = color + 'CC';
        ctx.font = '9px system-ui';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
        ctx.fillText(route.name, msx, msy - 8);
        ctx.restore();

        routeHitAreas.current.set(route.id, { route, segments });
      }

      // ── Marker overlays ──
      markerHitAreas.current.clear();
      if (showMarkersRef.current)
      for (const marker of markersRef.current) {
        const sx = cx + marker.x * scale + offset.x;
        const sy = cy + marker.z * scale + offset.y;
        if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;

        const mColor = marker.color || '#F59E0B';
        // Pin shape
        ctx.save();
        ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
        ctx.fillStyle = mColor;
        ctx.beginPath();
        ctx.arc(sx, sy - 6, 5, Math.PI, 0);
        ctx.lineTo(sx, sy + 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(sx, sy - 6, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Label
        ctx.save();
        ctx.fillStyle = mColor + 'DD';
        ctx.font = '9px system-ui';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
        ctx.fillText(marker.name, sx, sy - 16);
        ctx.restore();

        markerHitAreas.current.set(marker.id, { marker, sx, sy: sy - 4, radius: 10 });
      }

      // Collect entities
      const entities: MapEntity[] = [];
      const drawnNames = new Set<string>();
      if (show.bots) {
        for (const bot of bots) {
          if (!bot.position) continue;
          drawnNames.add(bot.name.toLowerCase());
          entities.push({ name: bot.name, x: bot.position.x, z: bot.position.z, color: getPersonalityColor(bot.personality), type: 'bot', state: bot.state, personality: bot.personality });
        }
      }
      if (show.players) {
        for (const player of players) {
          if (!player.isOnline || !player.position || drawnNames.has(player.name.toLowerCase())) continue;
          entities.push({ name: player.name, x: player.position.x, z: player.position.z, color: PLAYER_COLOR, type: 'player' });
        }
      }

      entityPositions.current.clear();

      // Trails
      if (show.trails) {
        for (const entity of entities) {
          const trail = trails.current.get(entity.name) || [];
          if (trail.length > 1) {
            for (let i = 1; i < trail.length; i++) {
              const alpha = Math.floor((i / trail.length) * 80).toString(16).padStart(2, '0');
              ctx.beginPath();
              ctx.strokeStyle = entity.color + alpha;
              ctx.lineWidth = entity.type === 'player' ? 1.5 : 2;
              ctx.moveTo(cx + trail[i - 1].x * scale + offset.x, cy + trail[i - 1].z * scale + offset.y);
              ctx.lineTo(cx + trail[i].x * scale + offset.x, cy + trail[i].z * scale + offset.y);
              ctx.stroke();
            }
          }
        }
      }

      // Entity markers
      for (const entity of entities) {
        const sx = cx + entity.x * scale + offset.x;
        const sy = cy + entity.z * scale + offset.y;
        if (sx < -30 || sx > w + 30 || sy < -30 || sy > h + 30) continue;

        const isHovered = hovered === entity.name;
        const isSelected = selected === entity.name;
        const baseR = entity.type === 'bot' ? 8 : 6;
        const r = isHovered || isSelected ? baseR + 2 : baseR;

        entityPositions.current.set(entity.name, { sx, sy, radius: r + 4 });

        if (isSelected || isHovered) {
          ctx.beginPath(); ctx.arc(sx, sy, r + 6, 0, Math.PI * 2); ctx.fillStyle = entity.color + '20'; ctx.fill();
        }
        if (entity.type === 'bot' && entity.state && !['IDLE', 'DISCONNECTED'].includes(entity.state)) {
          ctx.beginPath(); ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = (STATE_COLORS[entity.state] ?? entity.color) + '50'; ctx.lineWidth = 1.5; ctx.stroke();
        }

        ctx.shadowColor = '#000000'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
        if (entity.type === 'player') {
          const half = r / 1.4;
          ctx.fillStyle = entity.color; ctx.fillRect(sx - half, sy - half, half * 2, half * 2);
          ctx.strokeStyle = '#ffffffb0'; ctx.lineWidth = 2; ctx.strokeRect(sx - half, sy - half, half * 2, half * 2);
        } else {
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fillStyle = entity.color; ctx.fill();
          ctx.strokeStyle = '#ffffffb0'; ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

        ctx.save();
        ctx.shadowColor = '#000000'; ctx.shadowBlur = 3;
        ctx.fillStyle = '#ffffff'; ctx.font = `${isHovered || isSelected ? 'bold ' : ''}11px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.fillText(entity.name, sx, sy - r - 6);
        ctx.restore();

        if (isHovered || isSelected) {
          ctx.save(); ctx.shadowColor = '#000000'; ctx.shadowBlur = 3;
          ctx.fillStyle = '#ffffff90'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
          ctx.fillText(`${Math.round(entity.x)}, ${Math.round(entity.z)}`, sx, sy + r + 14);
          if (entity.state) { ctx.fillStyle = STATE_COLORS[entity.state] ?? '#6B7280'; ctx.font = '9px system-ui'; ctx.fillText(entity.state, sx, sy + r + 26); }
          ctx.restore();
        }
      }

      // HUD overlays
      if (show.coords) {
        ctx.fillStyle = '#00000080'; ctx.fillRect(8, h - 28, 130, 20);
        ctx.fillStyle = '#ffffff80'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
        ctx.fillText(`Center: ${Math.round(-offset.x / scale)}, ${Math.round(-offset.y / scale)}`, 14, h - 14);
      }
      ctx.fillStyle = '#00000080'; ctx.fillRect(w - 50, h - 28, 42, 20);
      ctx.fillStyle = '#ffffff60'; ctx.font = '10px monospace'; ctx.textAlign = 'right';
      ctx.fillText(`${scale.toFixed(1)}x`, w - 12, h - 14);

      animFrame = requestAnimationFrame(draw);
    };

    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
  }, []); // Empty deps — loop runs forever, reads from refs

  // Helper: screen coords to world coords
  const screenToWorld = useCallback((screenX: number, screenY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, z: 0 };
    const w = container.clientWidth;
    const h = container.clientHeight;
    const cx = w / 2;
    const cy = h / 2;
    const worldX = (screenX - cx - offsetRef.current.x) / scaleRef.current;
    const worldZ = (screenY - cy - offsetRef.current.y) / scaleRef.current;
    return { x: worldX, z: worldZ };
  }, []);

  // Hit-test for zones/markers/routes
  const hitTestOverlays = useCallback((mx: number, my: number): ContextMenuTarget | null => {
    // Markers first (smallest targets)
    for (const [, hit] of markerHitAreas.current) {
      const dx = mx - hit.sx;
      const dy = my - hit.sy;
      if (dx * dx + dy * dy < hit.radius * hit.radius) {
        return { kind: 'marker', markerId: hit.marker.id, markerName: hit.marker.name, worldX: hit.marker.x, worldZ: hit.marker.z };
      }
    }
    // Zones
    for (const [, hit] of zoneHitAreas.current) {
      const b = hit.screenBounds;
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        return { kind: 'zone', zoneId: hit.zone.id, zoneName: hit.zone.name, zoneType: hit.zone.type };
      }
    }
    // Routes (proximity to segments)
    for (const [, hit] of routeHitAreas.current) {
      for (const seg of hit.segments) {
        const dist = pointToSegmentDist(mx, my, seg.sx1, seg.sy1, seg.sx2, seg.sy2);
        if (dist < 8) {
          return { kind: 'route', routeId: hit.route.id, routeName: hit.route.name };
        }
      }
    }
    return null;
  }, []);

  // Context menu handler (right-click)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check if right-clicked on an entity
    for (const [name, pos] of entityPositions.current) {
      const dx = mx - pos.sx;
      const dy = my - pos.sy;
      if (dx * dx + dy * dy < pos.radius * pos.radius) {
        const entity = [...botsRef.current, ...playersRef.current].find((e) => e.name === name);
        if (entity && entity.position) {
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            target: { kind: 'bot', name, worldX: entity.position.x, worldZ: entity.position.z },
          });
          return;
        }
      }
    }

    // Check overlays
    const overlayHit = hitTestOverlays(mx, my);
    if (overlayHit) {
      setContextMenu({ x: e.clientX, y: e.clientY, target: overlayHit });
      return;
    }

    // Canvas right-click
    const world = screenToWorld(mx, my);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target: { kind: 'canvas', worldX: world.x, worldZ: world.z },
    });
  }, [hitTestOverlays, screenToWorld]);

  // Input handlers — all mutate refs directly, no state updates during drag/hover
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return; // handled by contextMenu
    setContextMenu(null); // close any open context menu

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check entity click
    for (const [name, pos] of entityPositions.current) {
      const dx = mx - pos.sx;
      const dy = my - pos.sy;
      if (dx * dx + dy * dy < pos.radius * pos.radius) {
        selectedRef.current = selectedRef.current === name ? null : name;
        // Ctrl+click to toggle bot selection
        if (e.ctrlKey || e.metaKey) {
          const bot = botsRef.current.find((b) => b.name === name);
          if (bot) {
            useControlStore.getState().toggleBotSelection(name);
          }
        }
        kick();
        return;
      }
    }

    // Check overlay click for sidebar detail
    const overlayHit = hitTestOverlays(mx, my);
    if (overlayHit) {
      if (overlayHit.kind === 'zone') {
        const zone = zonesRef.current.find((z) => z.id === overlayHit.zoneId);
        if (zone) { setSidebarDetail({ kind: 'zone', zone }); kick(); return; }
      } else if (overlayHit.kind === 'route') {
        const route = routesRef.current.find((r) => r.id === overlayHit.routeId);
        if (route) { setSidebarDetail({ kind: 'route', route }); kick(); return; }
      } else if (overlayHit.kind === 'marker') {
        const marker = markersRef.current.find((m) => m.id === overlayHit.markerId);
        if (marker) { setSidebarDetail({ kind: 'marker', marker }); kick(); return; }
      }
    }

    setSidebarDetail(null);
    draggingRef.current = true;
    dragStartRef.current = { x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingRef.current) {
      offsetRef.current = { x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y };
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let found: string | null = null;
    for (const [name, pos] of entityPositions.current) {
      const dx = mx - pos.sx;
      const dy = my - pos.sy;
      if (dx * dx + dy * dy < pos.radius * pos.radius) { found = name; break; }
    }
    hoveredRef.current = found;
  };

  const handleMouseUp = () => {
    if (draggingRef.current) {
      draggingRef.current = false;
      // Trigger terrain reload check after drag ends
      if (showRef.current.terrain) {
        const viewCenterX = -offsetRef.current.x / scaleRef.current;
        const viewCenterZ = -offsetRef.current.y / scaleRef.current;
        loadTerrain(viewCenterX, viewCenterZ);
      }
      kick();
    }
  };

  // Zoom toward cursor with normalized sensitivity
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Normalize delta across browsers/devices
      const rawDelta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const zoomFactor = Math.exp(-rawDelta * ZOOM_SENSITIVITY);

      const oldScale = scaleRef.current;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * zoomFactor));
      const ratio = newScale / oldScale;

      // Adjust offset so the world point under the cursor stays fixed
      const cw = rect.width / 2;
      const ch = rect.height / 2;
      offsetRef.current = {
        x: mouseX - cw - (mouseX - cw - offsetRef.current.x) * ratio,
        y: mouseY - ch - (mouseY - ch - offsetRef.current.y) * ratio,
      };
      scaleRef.current = newScale;
      kick();
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  // Reload terrain after zoom settles
  useEffect(() => {
    if (!showRef.current.terrain || !initializedRef.current) return;
    const timer = setTimeout(() => {
      const viewCenterX = -offsetRef.current.x / scaleRef.current;
      const viewCenterZ = -offsetRef.current.y / scaleRef.current;
      loadTerrain(viewCenterX, viewCenterZ);
    }, 500);
    return () => clearTimeout(timer);
  });

  // ── Mission/command action handlers ──

  const sendBotsToCoords = useCallback(async (botNames: string[], x: number, z: number) => {
    for (const name of botNames) {
      try {
        await api.walkTo(name, Math.round(x), null, Math.round(z));
      } catch {
        // If walkTo endpoint not available, fall back to task queue
        await api.queueTask(name, `Walk to coordinates ${Math.round(x)}, ${Math.round(z)}`).catch(() => {});
      }
    }
  }, []);

  const assignZoneMission = useCallback(async (type: string, botName: string, zoneId: string) => {
    const zone = zonesRef.current.find((z) => z.id === zoneId);
    if (!zone) return;
    try {
      await api.createMission({
        type,
        status: 'pending',
        botName,
        description: `${type} zone "${zone.name}"`,
        zoneId,
      });
      useControlStore.getState().fetchMissions();
    } catch {
      // Fallback to task queue
      await api.queueTask(botName, `${type} the ${zone.type} zone "${zone.name}" at ${zone.center.x}, ${zone.center.z}`).catch(() => {});
    }
  }, []);

  const assignRoutePatrol = useCallback(async (botName: string, routeId: string) => {
    const route = routesRef.current.find((r) => r.id === routeId);
    if (!route) return;
    try {
      await api.createMission({
        type: 'patrol_route',
        status: 'pending',
        botName,
        description: `Patrol route "${route.name}"`,
        routeId,
      });
      useControlStore.getState().fetchMissions();
    } catch {
      const wpStr = route.waypoints.map((wp) => `(${wp.x}, ${wp.z})`).join(' -> ');
      await api.queueTask(botName, `Patrol route "${route.name}" through waypoints: ${wpStr}`).catch(() => {});
    }
  }, []);

  const returnToBase = useCallback(async (botName: string) => {
    try {
      await api.walkTo(botName, 0, null, 0);
    } catch {
      await api.queueTask(botName, 'Return to base (0, 0)').catch(() => {});
    }
  }, []);

  // Build context menu actions based on target
  const getContextMenuActions = useCallback((target: ContextMenuTarget): ContextMenuAction[] => {
    const selected = useControlStore.getState().selectedBotIds;
    const botNames = botsRef.current.map((b) => b.name);
    const botsToUse = selected.length > 0 ? selected : [];

    switch (target.kind) {
      case 'canvas': {
        const actions: ContextMenuAction[] = [];
        if (botsToUse.length > 0) {
          actions.push({
            label: `Send ${botsToUse.length} bot${botsToUse.length > 1 ? 's' : ''} here`,
            icon: '>',
            color: '#3B82F6',
            onClick: () => sendBotsToCoords(botsToUse, target.worldX, target.worldZ),
          });
        } else if (botNames.length > 0) {
          // Offer to send any bot
          for (const name of botNames.slice(0, 5)) {
            actions.push({
              label: `Send ${name} here`,
              icon: '>',
              color: '#3B82F6',
              onClick: () => sendBotsToCoords([name], target.worldX, target.worldZ),
            });
          }
        }
        actions.push({
          label: 'Create marker here',
          icon: '+',
          color: '#F59E0B',
          onClick: () => {
            const name = prompt('Marker name:');
            if (name) {
              api.createMarker({ name, x: Math.round(target.worldX), z: Math.round(target.worldZ) })
                .then(() => useControlStore.getState().fetchMarkers())
                .catch(() => {});
            }
          },
        });
        return actions;
      }

      case 'bot': {
        const actions: ContextMenuAction[] = [];
        const name = target.name;
        const isBot = botsRef.current.some((b) => b.name === name);
        if (!isBot) return actions;

        // Zone assignment
        for (const zone of zonesRef.current.slice(0, 5)) {
          actions.push({
            label: `Assign to "${zone.name}" (${zone.type})`,
            icon: 'Z',
            color: ZONE_TYPE_COLORS[zone.type] || '#6B7280',
            onClick: () => assignZoneMission('guard', name, zone.id),
          });
        }

        // Route patrol
        for (const route of routesRef.current.slice(0, 3)) {
          actions.push({
            label: `Patrol "${route.name}"`,
            icon: 'P',
            color: '#A78BFA',
            onClick: () => assignRoutePatrol(name, route.id),
          });
        }

        actions.push({
          label: 'Return to base',
          icon: 'H',
          color: '#6B7280',
          onClick: () => returnToBase(name),
        });

        return actions;
      }

      case 'zone': {
        const actions: ContextMenuAction[] = [];
        if (botsToUse.length > 0) {
          actions.push({
            label: `Guard this zone (${botsToUse.length} bot${botsToUse.length > 1 ? 's' : ''})`,
            icon: 'G',
            color: '#4A90D9',
            onClick: () => { for (const b of botsToUse) assignZoneMission('guard', b, target.zoneId); },
          });
          actions.push({
            label: `Patrol this zone`,
            icon: 'P',
            color: '#0EA5E9',
            onClick: () => { for (const b of botsToUse) assignZoneMission('patrol', b, target.zoneId); },
          });
        } else {
          for (const name of botNames.slice(0, 4)) {
            actions.push({
              label: `Send ${name} to guard`,
              icon: 'G',
              color: '#4A90D9',
              onClick: () => assignZoneMission('guard', name, target.zoneId),
            });
          }
        }
        return actions;
      }

      case 'marker': {
        const actions: ContextMenuAction[] = [];
        if (botsToUse.length > 0) {
          actions.push({
            label: `Send ${botsToUse.length} bot${botsToUse.length > 1 ? 's' : ''} here`,
            icon: '>',
            color: '#F59E0B',
            onClick: () => sendBotsToCoords(botsToUse, target.worldX, target.worldZ),
          });
        } else {
          for (const name of botNames.slice(0, 4)) {
            actions.push({
              label: `Send ${name} here`,
              icon: '>',
              color: '#F59E0B',
              onClick: () => sendBotsToCoords([name], target.worldX, target.worldZ),
            });
          }
        }
        return actions;
      }

      case 'route': {
        const actions: ContextMenuAction[] = [];
        if (botsToUse.length > 0) {
          actions.push({
            label: `Patrol this route (${botsToUse.length} bot${botsToUse.length > 1 ? 's' : ''})`,
            icon: 'P',
            color: '#A78BFA',
            onClick: () => { for (const b of botsToUse) assignRoutePatrol(b, target.routeId); },
          });
        } else {
          for (const name of botNames.slice(0, 4)) {
            actions.push({
              label: `${name}: patrol this route`,
              icon: 'P',
              color: '#A78BFA',
              onClick: () => assignRoutePatrol(name, target.routeId),
            });
          }
        }
        return actions;
      }
    }
  }, [sendBotsToCoords, assignZoneMission, assignRoutePatrol, returnToBase]);

  const centerOn = (x: number, z: number) => {
    offsetRef.current = { x: -x * scaleRef.current, y: -z * scaleRef.current };
    kick();
  };

  // Sidebar entities
  const botNames = new Set(bots.map((b) => b.name.toLowerCase()));
  const allEntities: MapEntity[] = [
    ...bots.filter((b) => b.position).map((bot) => ({
      name: bot.name, x: bot.position!.x, z: bot.position!.z,
      color: getPersonalityColor(bot.personality), type: 'bot' as const,
      state: bot.state, personality: bot.personality,
    })),
    ...players.filter((p) => p.isOnline && p.position && !botNames.has(p.name.toLowerCase())).map((player) => ({
      name: player.name, x: player.position!.x, z: player.position!.z,
      color: PLAYER_COLOR, type: 'player' as const,
    })),
  ];

  const show = showRef.current;
  const toggleShow = (key: keyof typeof show) => { showRef.current = { ...show, [key]: !show[key] }; kick(); };

  return (
    <div className="h-screen flex flex-col">
      {/* Toolbar */}
      <div className="px-4 py-2.5 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-950/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold text-white">World Map</h1>
          <div className="flex items-center gap-1.5 text-[11px]">
            <ToggleBtn active={show.terrain} onClick={() => toggleShow('terrain')} label="Terrain" color="#5B8C33" />
            <ToggleBtn active={show.grid} onClick={() => toggleShow('grid')} label="Grid" />
            <ToggleBtn active={show.trails} onClick={() => toggleShow('trails')} label="Trails" />
            <ToggleBtn active={show.coords} onClick={() => toggleShow('coords')} label="Coords" />
            <span className="w-px h-4 bg-zinc-800 mx-1" />
            <ToggleBtn active={show.bots} onClick={() => toggleShow('bots')} label="Bots" color="#10B981" />
            <ToggleBtn active={show.players} onClick={() => toggleShow('players')} label="Players" color="#60A5FA" />
            <span className="w-px h-4 bg-zinc-800 mx-1" />
            <ToggleBtn active={showZones} onClick={() => setShowZones(!showZones)} label="Zones" color="#4A90D9" />
            <ToggleBtn active={showMarkers} onClick={() => setShowMarkers(!showMarkers)} label="Markers" color="#F59E0B" />
            <ToggleBtn active={showRoutes} onClick={() => setShowRoutes(!showRoutes)} label="Routes" color="#A78BFA" />
          </div>
          {terrainStatus === 'loading' && (
            <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <span className="w-3 h-3 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
              Loading terrain...
            </span>
          )}
          {terrainStatus === 'error' && <span className="text-[10px] text-red-400/70">Terrain unavailable</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              terrainMeta.current = null;
              terrainCanvas.current = null;
              loadTerrain(-offsetRef.current.x / scaleRef.current, -offsetRef.current.y / scaleRef.current);
            }}
            className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs transition-colors"
            title="Reload terrain"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <span className="w-px h-4 bg-zinc-800" />
          <button
            onClick={() => { scaleRef.current = Math.min(MAX_SCALE, scaleRef.current * 1.3); kick(); }}
            className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm transition-colors"
          >+</button>
          <span className="text-[10px] text-zinc-500 font-mono w-8 text-center">{scaleRef.current.toFixed(1)}x</span>
          <button
            onClick={() => { scaleRef.current = Math.max(MIN_SCALE, scaleRef.current / 1.3); kick(); }}
            className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm transition-colors"
          >-</button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Entity sidebar */}
        <div className="w-56 border-r border-zinc-800/60 bg-zinc-950/50 overflow-y-auto shrink-0">
          <div className="p-3">
            {/* Bot selection banner */}
            {selectedBotIds.length > 0 && (
              <div className="mb-3 bg-blue-500/10 border border-blue-500/20 rounded-lg px-2.5 py-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-semibold text-blue-400">{selectedBotIds.length} selected</p>
                  <button
                    onClick={() => useControlStore.getState().clearSelection()}
                    className="text-[9px] text-zinc-500 hover:text-zinc-300"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {selectedBotIds.map((name) => (
                    <span key={name} className="text-[9px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">{name}</span>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Entities ({allEntities.length})
            </p>
            <div className="space-y-0.5">
              {allEntities.map((entity) => {
                const isSelected = selectedBotIds.includes(entity.name);
                return (
                  <button
                    key={`${entity.type}-${entity.name}`}
                    onClick={(e) => {
                      centerOn(entity.x, entity.z);
                      selectedRef.current = entity.name;
                      if ((e.ctrlKey || e.metaKey) && entity.type === 'bot') {
                        useControlStore.getState().toggleBotSelection(entity.name);
                      }
                      kick();
                    }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                      selectedRef.current === entity.name ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                    } ${isSelected ? 'ring-1 ring-blue-500/40' : ''}`}
                  >
                    <span className={`w-2.5 h-2.5 shrink-0 ${entity.type === 'player' ? 'rounded-sm' : 'rounded-full'}`} style={{ backgroundColor: entity.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-zinc-300 truncate">{entity.name}</p>
                      <p className="text-[9px] text-zinc-600 font-mono tabular-nums">{Math.round(entity.x)}, {Math.round(entity.z)}</p>
                    </div>
                    <span className="text-[9px] text-zinc-600 uppercase shrink-0">
                      {entity.type === 'bot' ? entity.personality?.slice(0, 3) : 'PLR'}
                    </span>
                  </button>
                );
              })}
              {allEntities.length === 0 && <p className="text-[11px] text-zinc-600 text-center py-4">No entities with positions</p>}
            </div>
          </div>

          {/* Zones list */}
          {zones.length > 0 && (
            <div className="p-3 border-t border-zinc-800/60">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Zones ({zones.length})
              </p>
              <div className="space-y-0.5">
                {zones.map((zone) => (
                  <button
                    key={zone.id}
                    onClick={() => {
                      centerOn(zone.center.x, zone.center.z);
                      setSidebarDetail({ kind: 'zone', zone });
                      kick();
                    }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                      sidebarDetail?.kind === 'zone' && sidebarDetail.zone.id === zone.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: ZONE_TYPE_COLORS[zone.type] || '#6B7280' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-zinc-300 truncate">{zone.name}</p>
                      <p className="text-[9px] text-zinc-600 capitalize">{zone.type}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Routes list */}
          {routes.length > 0 && (
            <div className="p-3 border-t border-zinc-800/60">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Routes ({routes.length})
              </p>
              <div className="space-y-0.5">
                {routes.map((route) => (
                  <button
                    key={route.id}
                    onClick={() => {
                      if (route.waypoints.length > 0) centerOn(route.waypoints[0].x, route.waypoints[0].z);
                      setSidebarDetail({ kind: 'route', route });
                      kick();
                    }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                      sidebarDetail?.kind === 'route' && sidebarDetail.route.id === route.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: route.color || '#A78BFA' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-zinc-300 truncate">{route.name}</p>
                      <p className="text-[9px] text-zinc-600">{route.waypoints.length} pts</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Markers list */}
          {markers.length > 0 && (
            <div className="p-3 border-t border-zinc-800/60">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Markers ({markers.length})
              </p>
              <div className="space-y-0.5">
                {markers.map((marker) => (
                  <button
                    key={marker.id}
                    onClick={() => {
                      centerOn(marker.x, marker.z);
                      setSidebarDetail({ kind: 'marker', marker });
                      kick();
                    }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                      sidebarDetail?.kind === 'marker' && sidebarDetail.marker.id === marker.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: marker.color || '#F59E0B' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-zinc-300 truncate">{marker.name}</p>
                      <p className="text-[9px] text-zinc-600 font-mono">{Math.round(marker.x)}, {Math.round(marker.z)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Detail panel for selected zone/route/marker */}
          {sidebarDetail?.kind === 'zone' && (
            <ZoneDetailPanel
              zone={sidebarDetail.zone}
              missions={missions}
              botNames={bots.map((b) => b.name)}
              selectedBotIds={selectedBotIds}
              onCreateMission={assignZoneMission}
            />
          )}
          {sidebarDetail?.kind === 'route' && (
            <RouteDetailPanel
              route={sidebarDetail.route}
              botNames={bots.map((b) => b.name)}
              selectedBotIds={selectedBotIds}
              onAssignPatrol={assignRoutePatrol}
            />
          )}
          {sidebarDetail?.kind === 'marker' && (
            <MarkerDetailPanel
              marker={sidebarDetail.marker}
              botNames={bots.map((b) => b.name)}
              selectedBotIds={selectedBotIds}
              onSendBots={sendBotsToCoords}
            />
          )}
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className={`flex-1 relative ${draggingRef.current ? 'cursor-grabbing' : hoveredRef.current ? 'cursor-pointer' : 'cursor-grab'}`}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { handleMouseUp(); hoveredRef.current = null; }}
            onContextMenu={handleContextMenu}
            className="w-full h-full"
          />
          <div className="absolute bottom-4 left-4 bg-zinc-900/90 backdrop-blur-sm border border-zinc-800/60 rounded-lg p-3 text-[10px]">
            <p className="text-zinc-500 font-semibold uppercase tracking-wider mb-2">Legend</p>
            <div className="space-y-1.5">
              <LegendItem shape="circle" color="#6B7280" label="Bot" />
              <LegendItem shape="square" color="#60A5FA" label="Player" />
              {show.terrain && terrainCanvas.current && (
                <>
                  <LegendItem shape="square" color="#5B8C33" label="Grass" />
                  <LegendItem shape="square" color="#3366CC" label="Water" />
                  <LegendItem shape="square" color="#7F7F7F" label="Stone" />
                  <LegendItem shape="square" color="#DBCFA0" label="Sand" />
                </>
              )}
              {(zones.length > 0 || markers.length > 0 || routes.length > 0) && (
                <>
                  <div className="w-full h-px bg-zinc-800 my-1" />
                  {zones.length > 0 && <LegendItem shape="square" color="#4A90D9" label="Zone" />}
                  {markers.length > 0 && <LegendItem shape="circle" color="#F59E0B" label="Marker" />}
                  {routes.length > 0 && <LegendItem shape="circle" color="#A78BFA" label="Route" />}
                </>
              )}
            </div>
            <p className="text-zinc-600 mt-2">Right-click for actions</p>
            <p className="text-zinc-600">Ctrl+click bots to select</p>
          </div>

          {/* Context menu */}
          {contextMenu && (
            <MapContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              target={contextMenu.target}
              selectedBotCount={selectedBotIds.length}
              actions={getContextMenuActions(contextMenu.target)}
              onClose={() => setContextMenu(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

function ToggleBtn({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded transition-colors ${active ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-600 hover:text-zinc-400'}`}
      style={active && color ? { color } : undefined}
    >{label}</button>
  );
}

function LegendItem({ shape, color, label }: { shape: 'circle' | 'square'; color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-3 h-3 ${shape === 'circle' ? 'rounded-full' : 'rounded-sm'}`} style={{ backgroundColor: color }} />
      <span className="text-zinc-400">{label}</span>
    </div>
  );
}
