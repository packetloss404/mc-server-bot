'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useBotStore } from '@/lib/store';
import { api } from '@/lib/api';
<<<<<<< HEAD
import { STATE_COLORS } from '@/lib/constants';
import { getBlockColor } from '@/lib/blockColors';
import { MapToolbar } from '@/components/map/MapToolbar';
import { MapEntitySidebar } from '@/components/map/MapEntitySidebar';
import {
  MIN_SCALE,
  MAX_SCALE,
  TRAIL_LENGTH,
  TERRAIN_RADIUS,
  TERRAIN_STEP,
  ZOOM_SENSITIVITY,
  collectEntities,
  type MapEntity,
  type MapMode,
  type ShowState,
} from '@/components/map/mapDrawing';
=======
import type { MarkerRecord, MarkerKind, ZoneRecord, RouteRecord } from '@/lib/api';
import { getPersonalityColor, PLAYER_COLOR, STATE_COLORS } from '@/lib/constants';
import { getBlockColor } from '@/lib/blockColors';
import MapContextMenu, { type ContextTarget } from '@/components/map/MapContextMenu';
import MarkerEditor from '@/components/map/MarkerEditor';

const MIN_SCALE = 0.5;
const MAX_SCALE = 10;
const TRAIL_LENGTH = 80;
const TERRAIN_RADIUS = 96;
const TERRAIN_STEP = 2;
const ZOOM_SENSITIVITY = 0.002; // Normalized zoom speed

// Marker kind colors
const MARKER_KIND_COLORS: Record<string, string> = {
  base: '#22C55E',
  storage: '#EAB308',
  mine: '#9CA3AF',
  village: '#F97316',
  'build-site': '#3B82F6',
  custom: '#E5E7EB',
};

// Zone mode colors
const ZONE_MODE_COLORS: Record<string, string> = {
  guard: '#EF4444',
  avoid: '#F97316',
  farm: '#22C55E',
  build: '#3B82F6',
  gather: '#A855F7',
  custom: '#6B7280',
};

interface MapEntity {
  name: string;
  x: number;
  z: number;
  color: string;
  type: 'bot' | 'player';
  state?: string;
  personality?: string;
}
>>>>>>> worktree-agent-ab88f285

export default function MapPage() {
  const bots = useBotStore((s) => s.botList);
  const players = useBotStore((s) => s.playerList);
  const markers = useBotStore((s) => s.markers);
  const zones = useBotStore((s) => s.zones);
  const routes = useBotStore((s) => s.routes);
  const mapDrawingMode = useBotStore((s) => s.mapDrawingMode);
  const setMarkers = useBotStore((s) => s.setMarkers);
  const addMarker = useBotStore((s) => s.addMarker);
  const removeMarker = useBotStore((s) => s.removeMarker);
  const updateMarkerInStore = useBotStore((s) => s.updateMarker);
  const setZones = useBotStore((s) => s.setZones);
  const setRoutes = useBotStore((s) => s.setRoutes);
  const setMapDrawingMode = useBotStore((s) => s.setMapDrawingMode);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use refs for all values the draw loop needs — avoids effect restarts
  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(3);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
<<<<<<< HEAD
  const showRef = useRef<ShowState>({ bots: true, players: true, trails: true, grid: true, coords: true, terrain: true });
=======
  const showRef = useRef({ bots: true, players: true, trails: true, grid: true, coords: true, terrain: true, markers: true, zones: true, routes: true });
>>>>>>> worktree-agent-ab88f285
  const botsRef = useRef(bots);
  const playersRef = useRef(players);
  const markersRef = useRef(markers);
  const zonesRef = useRef(zones);
  const routesRef = useRef(routes);
  const trails = useRef<Map<string, { x: number; z: number }[]>>(new Map());
  const entityPositions = useRef<Map<string, { sx: number; sy: number; radius: number }>>(new Map());
  const markerPositions = useRef<Map<string, { sx: number; sy: number; radius: number }>>(new Map());
  const terrainCanvas = useRef<OffscreenCanvas | null>(null);
  const terrainMeta = useRef<{ cx: number; cz: number; radius: number } | null>(null);
  const initializedRef = useRef(false);

  // Interaction mode state — only 'navigate' and 'select' are active for now
  const [mapMode, setMapMode] = useState<MapMode>('navigate');
  const mapModeRef = useRef<MapMode>(mapMode);

  // State just for UI re-renders (toolbar, sidebar)
  const [, forceRender] = useState(0);
  const kick = () => forceRender((n) => n + 1);

  const [terrainStatus, setTerrainStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');

<<<<<<< HEAD
  // Keep refs in sync with zustand — inside useEffect, not during render
  useEffect(() => {
    botsRef.current = bots;
    playersRef.current = players;
  }, [bots, players]);

  // Keep mapMode ref in sync
  useEffect(() => {
    mapModeRef.current = mapMode;
  }, [mapMode]);
=======
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ target: ContextTarget; screenX: number; screenY: number } | null>(null);

  // Marker editor state
  const [markerEditor, setMarkerEditor] = useState<{
    marker?: MarkerRecord;
    defaultX?: number;
    defaultZ?: number;
  } | null>(null);

  // Keep refs in sync with zustand
  botsRef.current = bots;
  playersRef.current = players;
  markersRef.current = markers;
  zonesRef.current = zones;
  routesRef.current = routes;

  // Load markers, zones, routes on mount
  useEffect(() => {
    api.getMarkers().then((r) => setMarkers(r.markers)).catch(() => {});
    api.getZones().then((r) => setZones(r.zones)).catch(() => {});
    api.getRoutes().then((r) => setRoutes(r.routes)).catch(() => {});
  }, [setMarkers, setZones, setRoutes]);
>>>>>>> worktree-agent-ab88f285

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

  // Helper: screen coords to world coords
  const screenToWorld = useCallback((screenX: number, screenY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, z: 0 };
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const mx = screenX - rect.left;
    const my = screenY - rect.top;
    const worldX = (mx - cx - offsetRef.current.x) / scaleRef.current;
    const worldZ = (my - cy - offsetRef.current.y) / scaleRef.current;
    return { x: worldX, z: worldZ };
  }, []);

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
<<<<<<< HEAD
      const currentBots = botsRef.current;
      const currentPlayers = playersRef.current;
=======
      const curBots = botsRef.current;
      const curPlayers = playersRef.current;
      const curMarkers = markersRef.current;
      const curZones = zonesRef.current;
      const curRoutes = routesRef.current;
>>>>>>> worktree-agent-ab88f285
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

      // --- Draw zones ---
      if (show.zones) {
        for (const zone of curZones) {
          const zoneColor = zone.color || ZONE_MODE_COLORS[zone.mode] || '#6B7280';
          const zsx = cx + zone.cx * scale + offset.x;
          const zsy = cy + zone.cz * scale + offset.y;

          if (zone.shape === 'circle' && zone.radius) {
            const sr = zone.radius * scale;
            ctx.beginPath();
            ctx.arc(zsx, zsy, sr, 0, Math.PI * 2);
            ctx.fillStyle = zoneColor + '18';
            ctx.fill();
            ctx.strokeStyle = zoneColor + '60';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (zone.shape === 'rectangle' && zone.width && zone.height) {
            const sw = zone.width * scale;
            const sh = zone.height * scale;
            ctx.fillStyle = zoneColor + '18';
            ctx.fillRect(zsx - sw / 2, zsy - sh / 2, sw, sh);
            ctx.strokeStyle = zoneColor + '60';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(zsx - sw / 2, zsy - sh / 2, sw, sh);
            ctx.setLineDash([]);
          }

          // Zone label
          ctx.save();
          ctx.shadowColor = '#000000'; ctx.shadowBlur = 3;
          ctx.fillStyle = zoneColor + 'B0';
          ctx.font = '10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(zone.name, zsx, zsy + 4);
          ctx.restore();
        }
      }

      // --- Draw routes ---
      if (show.routes) {
        const markerById = new Map(curMarkers.map((m) => [m.id, m]));
        for (const route of curRoutes) {
          const waypoints = route.markerIds
            .map((id) => markerById.get(id))
            .filter((m): m is MarkerRecord => !!m);

          if (waypoints.length < 2) continue;

          ctx.save();
          ctx.setLineDash([8, 6]);
          ctx.strokeStyle = '#A78BFA90';
          ctx.lineWidth = 2;
          ctx.beginPath();

          for (let i = 0; i < waypoints.length; i++) {
            const sx = cx + waypoints[i].x * scale + offset.x;
            const sy = cx + waypoints[i].z * scale + offset.y;
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
          ctx.setLineDash([]);

          // Draw arrows along route segments
          for (let i = 0; i < waypoints.length - 1; i++) {
            const ax = cx + waypoints[i].x * scale + offset.x;
            const ay = cy + waypoints[i].z * scale + offset.y;
            const bx = cx + waypoints[i + 1].x * scale + offset.x;
            const by = cy + waypoints[i + 1].z * scale + offset.y;
            const midX = (ax + bx) / 2;
            const midY = (ay + by) / 2;
            const angle = Math.atan2(by - ay, bx - ax);
            const arrowSize = 6;

            ctx.beginPath();
            ctx.moveTo(midX + Math.cos(angle) * arrowSize, midY + Math.sin(angle) * arrowSize);
            ctx.lineTo(midX + Math.cos(angle + 2.5) * arrowSize, midY + Math.sin(angle + 2.5) * arrowSize);
            ctx.lineTo(midX + Math.cos(angle - 2.5) * arrowSize, midY + Math.sin(angle - 2.5) * arrowSize);
            ctx.closePath();
            ctx.fillStyle = '#A78BFAB0';
            ctx.fill();
          }

          ctx.restore();
        }
      }

      // Collect entities
<<<<<<< HEAD
      const entities = collectEntities(currentBots, currentPlayers, show.bots, show.players);
=======
      const entities: MapEntity[] = [];
      const drawnNames = new Set<string>();
      if (show.bots) {
        for (const bot of curBots) {
          if (!bot.position) continue;
          drawnNames.add(bot.name.toLowerCase());
          entities.push({ name: bot.name, x: bot.position.x, z: bot.position.z, color: getPersonalityColor(bot.personality), type: 'bot', state: bot.state, personality: bot.personality });
        }
      }
      if (show.players) {
        for (const player of curPlayers) {
          if (!player.isOnline || !player.position || drawnNames.has(player.name.toLowerCase())) continue;
          entities.push({ name: player.name, x: player.position.x, z: player.position.z, color: PLAYER_COLOR, type: 'player' });
        }
      }
>>>>>>> worktree-agent-ab88f285

      entityPositions.current.clear();
      markerPositions.current.clear();

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

      // --- Draw markers (diamond/pin shapes) ---
      if (show.markers) {
        for (const marker of curMarkers) {
          const sx = cx + marker.x * scale + offset.x;
          const sy = cy + marker.z * scale + offset.y;
          if (sx < -30 || sx > w + 30 || sy < -30 || sy > h + 30) continue;

          const color = MARKER_KIND_COLORS[marker.kind] || '#E5E7EB';
          const isHov = hovered === `marker:${marker.id}`;
          const size = isHov ? 8 : 6;

          markerPositions.current.set(marker.id, { sx, sy, radius: size + 4 });

          // Draw diamond shape
          ctx.save();
          ctx.shadowColor = '#000000'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
          ctx.beginPath();
          ctx.moveTo(sx, sy - size);
          ctx.lineTo(sx + size * 0.7, sy);
          ctx.lineTo(sx, sy + size);
          ctx.lineTo(sx - size * 0.7, sy);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = '#ffffffb0';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
          ctx.restore();

          // Label (always show name, show details on hover)
          ctx.save();
          ctx.shadowColor = '#000000'; ctx.shadowBlur = 3;
          ctx.fillStyle = color;
          ctx.font = `${isHov ? 'bold ' : ''}10px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(marker.name, sx, sy - size - 5);
          if (isHov) {
            ctx.fillStyle = '#ffffff70';
            ctx.font = '9px monospace';
            ctx.fillText(`${Math.round(marker.x)}, ${Math.round(marker.z)}`, sx, sy + size + 12);
          }
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

  // Find what's under a given screen position
  const hitTest = useCallback((mx: number, my: number): { type: 'entity'; name: string } | { type: 'marker'; id: string } | null => {
    // Check entities first
    for (const [name, pos] of entityPositions.current) {
      const dx = mx - pos.sx;
      const dy = my - pos.sy;
      if (dx * dx + dy * dy < pos.radius * pos.radius) {
        return { type: 'entity', name };
      }
    }
    // Check markers
    for (const [id, pos] of markerPositions.current) {
      const dx = mx - pos.sx;
      const dy = my - pos.sy;
      if (dx * dx + dy * dy < pos.radius * pos.radius) {
        return { type: 'marker', id };
      }
    }
    return null;
  }, []);

  // Input handlers — all mutate refs directly, no state updates during drag/hover
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return; // handled by context menu
    setContextMenu(null); // close context menu on left click

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

<<<<<<< HEAD
    // In navigate or select mode, clicking an entity selects it
    const mode = mapModeRef.current;
    if (mode === 'navigate' || mode === 'select') {
      for (const [name, pos] of entityPositions.current) {
        const dx = mx - pos.sx;
        const dy = my - pos.sy;
        if (dx * dx + dy * dy < pos.radius * pos.radius) {
          selectedRef.current = selectedRef.current === name ? null : name;
          kick();
          return;
        }
=======
    // Check if clicking in add-marker mode
    if (mapDrawingMode === 'add-marker') {
      const world = screenToWorld(e.clientX, e.clientY);
      setMarkerEditor({ defaultX: world.x, defaultZ: world.z });
      setMapDrawingMode('none');
      return;
    }

    const hit = hitTest(mx, my);
    if (hit) {
      if (hit.type === 'entity') {
        selectedRef.current = selectedRef.current === hit.name ? null : hit.name;
>>>>>>> worktree-agent-ab88f285
      }
      kick();
      return;
    }

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
    // Check entities
    for (const [name, pos] of entityPositions.current) {
      const dx = mx - pos.sx;
      const dy = my - pos.sy;
      if (dx * dx + dy * dy < pos.radius * pos.radius) { found = name; break; }
    }
    // Check markers
    if (!found) {
      for (const [id, pos] of markerPositions.current) {
        const dx = mx - pos.sx;
        const dy = my - pos.sy;
        if (dx * dx + dy * dy < pos.radius * pos.radius) { found = `marker:${id}`; break; }
      }
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

  // Right-click handler for context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const hit = hitTest(mx, my);
    let target: ContextTarget;

    if (hit?.type === 'entity') {
      const entity = [...botsRef.current, ...playersRef.current].find(
        (e) => e.name === hit.name
      );
      if (entity?.position) {
        const isBot = botsRef.current.some((b) => b.name === hit.name);
        target = {
          type: isBot ? 'bot' : 'player',
          name: hit.name,
          worldX: entity.position.x,
          worldZ: entity.position.z,
        };
      } else {
        const world = screenToWorld(e.clientX, e.clientY);
        target = { type: 'terrain', worldX: world.x, worldZ: world.z };
      }
    } else if (hit?.type === 'marker') {
      const marker = markersRef.current.find((m) => m.id === hit.id);
      if (marker) {
        target = { type: 'marker', marker };
      } else {
        const world = screenToWorld(e.clientX, e.clientY);
        target = { type: 'terrain', worldX: world.x, worldZ: world.z };
      }
    } else {
      const world = screenToWorld(e.clientX, e.clientY);
      target = { type: 'terrain', worldX: world.x, worldZ: world.z };
    }

    setContextMenu({ target, screenX: e.clientX, screenY: e.clientY });
  };

  // Context menu action handlers
  const getSelectedBot = (): string | null => {
    const sel = selectedRef.current;
    if (!sel) return null;
    const bot = botsRef.current.find((b) => b.name === sel);
    return bot ? bot.name : null;
  };

  const handleWalkHere = (x: number, z: number) => {
    const botName = getSelectedBot();
    if (botName) {
      api.walkTo(botName, Math.round(x), null, Math.round(z)).catch(() => {});
    }
  };

  const handleCreateMarker = (x: number, z: number) => {
    setMarkerEditor({ defaultX: x, defaultZ: z });
  };

  const handleCopyCoords = (x: number, z: number) => {
    navigator.clipboard.writeText(`${Math.round(x)}, ${Math.round(z)}`).catch(() => {});
  };

  const handleFollow = (targetName: string) => {
    const botName = getSelectedBot();
    if (botName) {
      api.followPlayer(botName, targetName).catch(() => {});
    }
  };

  const handleEditMarker = (marker: MarkerRecord) => {
    setMarkerEditor({ marker });
  };

  const handleDeleteMarker = (marker: MarkerRecord) => {
    api.deleteMarker(marker.id).then(() => removeMarker(marker.id)).catch(() => {
      // If the API doesn't exist yet, still remove locally
      removeMarker(marker.id);
    });
  };

  const handleSaveMarker = async (data: { name: string; kind: MarkerKind; x: number; y: number; z: number; tags: string[]; notes: string }) => {
    if (markerEditor?.marker) {
      // Update existing
      try {
        const result = await api.updateMarker(markerEditor.marker.id, data);
        updateMarkerInStore(markerEditor.marker.id, result.marker);
      } catch {
        // If API doesn't exist, update locally
        updateMarkerInStore(markerEditor.marker.id, data);
      }
    } else {
      // Create new
      try {
        const result = await api.createMarker(data);
        addMarker(result.marker);
      } catch {
        // If API doesn't exist, create locally with generated id
        const localMarker: MarkerRecord = {
          ...data,
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
        };
        addMarker(localMarker);
      }
    }
    setMarkerEditor(null);
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

  const centerOn = (x: number, z: number) => {
    offsetRef.current = { x: -x * scaleRef.current, y: -z * scaleRef.current };
    kick();
  };

  // Sidebar entities
  const allEntities = collectEntities(bots, players, true, true);

  const show = showRef.current;
  const toggleShow = (key: keyof ShowState) => { showRef.current = { ...show, [key]: !show[key] }; kick(); };

  const handleEntitySelect = (entity: MapEntity) => {
    centerOn(entity.x, entity.z);
    selectedRef.current = entity.name;
    kick();
  };

  const cursorClass = mapDrawingMode === 'add-marker'
    ? 'cursor-crosshair'
    : draggingRef.current
      ? 'cursor-grabbing'
      : hoveredRef.current
        ? 'cursor-pointer'
        : 'cursor-grab';

  return (
    <div className="h-screen flex flex-col">
      {/* Toolbar */}
<<<<<<< HEAD
      <MapToolbar
        show={show}
        toggleShow={toggleShow}
        scale={scaleRef.current}
        onZoomIn={() => { scaleRef.current = Math.min(MAX_SCALE, scaleRef.current * 1.3); kick(); }}
        onZoomOut={() => { scaleRef.current = Math.max(MIN_SCALE, scaleRef.current / 1.3); kick(); }}
        terrainStatus={terrainStatus}
        onReloadTerrain={() => {
          terrainMeta.current = null;
          terrainCanvas.current = null;
          loadTerrain(-offsetRef.current.x / scaleRef.current, -offsetRef.current.y / scaleRef.current);
        }}
      />

      <div className="flex-1 flex min-h-0">
        {/* Entity sidebar */}
        <MapEntitySidebar
          entities={allEntities}
          selectedEntity={selectedRef.current}
          onSelect={handleEntitySelect}
        />
=======
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
            <ToggleBtn active={show.markers} onClick={() => toggleShow('markers')} label="Markers" color="#EAB308" />
            <ToggleBtn active={show.zones} onClick={() => toggleShow('zones')} label="Zones" color="#A855F7" />
            <ToggleBtn active={show.routes} onClick={() => toggleShow('routes')} label="Routes" color="#A78BFA" />
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
          {/* Drawing mode buttons */}
          <button
            onClick={() => setMapDrawingMode(mapDrawingMode === 'add-marker' ? 'none' : 'add-marker')}
            className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
              mapDrawingMode === 'add-marker'
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
            }`}
            title="Click on map to place a marker"
          >
            + Marker
          </button>
          <span className="w-px h-4 bg-zinc-800" />
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
        <div className="w-52 border-r border-zinc-800/60 bg-zinc-950/50 overflow-y-auto shrink-0">
          <div className="p-3">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Entities ({allEntities.length})
            </p>
            <div className="space-y-0.5">
              {allEntities.map((entity) => (
                <button
                  key={`${entity.type}-${entity.name}`}
                  onClick={() => { centerOn(entity.x, entity.z); selectedRef.current = entity.name; kick(); }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                    selectedRef.current === entity.name ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                  }`}
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
              ))}
              {allEntities.length === 0 && <p className="text-[11px] text-zinc-600 text-center py-4">No entities with positions</p>}
            </div>
          </div>

          {/* Markers section in sidebar */}
          {markers.length > 0 && (
            <div className="p-3 border-t border-zinc-800/60">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Markers ({markers.length})
              </p>
              <div className="space-y-0.5">
                {markers.map((marker) => (
                  <button
                    key={marker.id}
                    onClick={() => { centerOn(marker.x, marker.z); kick(); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-zinc-800/50"
                  >
                    <span
                      className="w-2.5 h-2.5 shrink-0"
                      style={{
                        backgroundColor: MARKER_KIND_COLORS[marker.kind] || '#E5E7EB',
                        clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-zinc-300 truncate">{marker.name}</p>
                      <p className="text-[9px] text-zinc-600 font-mono tabular-nums">{Math.round(marker.x)}, {Math.round(marker.z)}</p>
                    </div>
                    <span className="text-[9px] text-zinc-600 uppercase shrink-0">
                      {marker.kind.slice(0, 3)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
>>>>>>> worktree-agent-ab88f285

        {/* Canvas */}
        <div
          ref={containerRef}
          className={`flex-1 relative ${cursorClass}`}
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

          {/* Drawing mode indicator */}
          {mapDrawingMode === 'add-marker' && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-emerald-600/90 backdrop-blur-sm border border-emerald-500/60 rounded-lg px-4 py-2 text-[12px] text-white font-medium">
              Click on the map to place a marker
              <button
                onClick={() => setMapDrawingMode('none')}
                className="ml-3 text-emerald-200 hover:text-white underline"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-zinc-900/90 backdrop-blur-sm border border-zinc-800/60 rounded-lg p-3 text-[10px]">
            <p className="text-zinc-500 font-semibold uppercase tracking-wider mb-2">Legend</p>
            <div className="space-y-1.5">
              <LegendItem shape="circle" color="#6B7280" label="Bot" />
              <LegendItem shape="square" color="#60A5FA" label="Player" />
              <LegendItem shape="diamond" color="#EAB308" label="Marker" />
              {show.terrain && terrainCanvas.current && (
                <>
                  <LegendItem shape="square" color="#5B8C33" label="Grass" />
                  <LegendItem shape="square" color="#3366CC" label="Water" />
                  <LegendItem shape="square" color="#7F7F7F" label="Stone" />
                  <LegendItem shape="square" color="#DBCFA0" label="Sand" />
                </>
              )}
            </div>
          </div>

          {/* Marker Editor overlay */}
          {markerEditor && (
            <div className="absolute top-4 right-4 z-40">
              <MarkerEditor
                marker={markerEditor.marker}
                defaultX={markerEditor.defaultX}
                defaultZ={markerEditor.defaultZ}
                onSave={handleSaveMarker}
                onCancel={() => setMarkerEditor(null)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <MapContextMenu
          target={contextMenu.target}
          screenX={contextMenu.screenX}
          screenY={contextMenu.screenY}
          selectedBot={getSelectedBot()}
          onClose={() => setContextMenu(null)}
          onWalkHere={handleWalkHere}
          onCreateMarker={handleCreateMarker}
          onCopyCoords={handleCopyCoords}
          onFollow={handleFollow}
          onEditMarker={handleEditMarker}
          onDeleteMarker={handleDeleteMarker}
        />
      )}
    </div>
  );
}

<<<<<<< HEAD
function LegendItem({ shape, color, label }: { shape: 'circle' | 'square'; color: string; label: string }) {
=======
function ToggleBtn({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded transition-colors ${active ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-600 hover:text-zinc-400'}`}
      style={active && color ? { color } : undefined}
    >{label}</button>
  );
}

function LegendItem({ shape, color, label }: { shape: 'circle' | 'square' | 'diamond'; color: string; label: string }) {
>>>>>>> worktree-agent-ab88f285
  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-3 h-3 ${shape === 'circle' ? 'rounded-full' : shape === 'square' ? 'rounded-sm' : ''}`}
        style={{
          backgroundColor: color,
          ...(shape === 'diamond' ? { clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' } : {}),
        }}
      />
      <span className="text-zinc-400">{label}</span>
    </div>
  );
}
