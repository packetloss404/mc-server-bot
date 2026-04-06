'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useBotStore } from '@/lib/store';
import { useMapOverlayStore } from '@/lib/mapStore';
import { api } from '@/lib/api';
import { getPersonalityColor, PLAYER_COLOR, STATE_COLORS } from '@/lib/constants';
import { getBlockColor } from '@/lib/blockColors';
import {
  worldToScreen,
  screenToWorld,
  drawMarkers,
  drawZones,
  drawRoutes,
  drawZonePreview,
  drawRoutePreview,
  drawMissionOverlays,
  drawSquadOverlays,
} from '@/lib/mapDrawing';
import { MapToolbar, ZoneEditorDialog, RouteNameDialog, MapContextMenu } from '@/components/map';

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

  // Map overlay store data
  const markers = useMapOverlayStore((s) => s.markers);
  const zones = useMapOverlayStore((s) => s.zones);
  const routes = useMapOverlayStore((s) => s.routes);
  const missions = useMapOverlayStore((s) => s.missions);
  const squads = useMapOverlayStore((s) => s.squads);
  const activeTool = useMapOverlayStore((s) => s.activeTool);
  const zoneDrawStart = useMapOverlayStore((s) => s.zoneDrawStart);
  const zoneDrawEnd = useMapOverlayStore((s) => s.zoneDrawEnd);
  const routeWaypoints = useMapOverlayStore((s) => s.routeWaypoints);
  const setZoneDrawStart = useMapOverlayStore((s) => s.setZoneDrawStart);
  const setZoneDrawEnd = useMapOverlayStore((s) => s.setZoneDrawEnd);
  const openZoneDialog = useMapOverlayStore((s) => s.openZoneDialog);
  const addRouteWaypoint = useMapOverlayStore((s) => s.addRouteWaypoint);
  const openRouteDialog = useMapOverlayStore((s) => s.openRouteDialog);
  const openContextMenu = useMapOverlayStore((s) => s.openContextMenu);
  const closeContextMenu = useMapOverlayStore((s) => s.closeContextMenu);
  const setMarkers = useMapOverlayStore((s) => s.setMarkers);
  const setZones = useMapOverlayStore((s) => s.setZones);
  const setRoutes = useMapOverlayStore((s) => s.setRoutes);
  const setMissions = useMapOverlayStore((s) => s.setMissions);
  const setSquads = useMapOverlayStore((s) => s.setSquads);

  // Use refs for all values the draw loop needs — avoids effect restarts
  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(3);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const showRef = useRef({ bots: true, players: true, trails: true, grid: true, coords: true, terrain: true, zones: true, routes: true, markers: true });
  const botsRef = useRef(bots);
  const playersRef = useRef(players);
  const trails = useRef<Map<string, { x: number; z: number }[]>>(new Map());
  const entityPositions = useRef<Map<string, { sx: number; sy: number; radius: number }>>(new Map());
  const terrainCanvas = useRef<OffscreenCanvas | null>(null);
  const terrainMeta = useRef<{ cx: number; cz: number; radius: number } | null>(null);
  const initializedRef = useRef(false);

  // Refs for overlay data (avoids draw loop restarts)
  const markersRef = useRef(markers);
  const zonesRef = useRef(zones);
  const routesRef = useRef(routes);
  const missionsRef = useRef(missions);
  const squadsRef = useRef(squads);
  const activeToolRef = useRef(activeTool);
  const zoneDrawStartRef = useRef(zoneDrawStart);
  const zoneDrawEndRef = useRef(zoneDrawEnd);
  const routeWaypointsRef = useRef(routeWaypoints);

  // State just for UI re-renders (toolbar, sidebar)
  const [, forceRender] = useState(0);
  const kick = () => forceRender((n) => n + 1);

  const [terrainStatus, setTerrainStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  // Keep refs in sync
  botsRef.current = bots;
  playersRef.current = players;
  markersRef.current = markers;
  zonesRef.current = zones;
  routesRef.current = routes;
  missionsRef.current = missions;
  squadsRef.current = squads;
  activeToolRef.current = activeTool;
  zoneDrawStartRef.current = zoneDrawStart;
  zoneDrawEndRef.current = zoneDrawEnd;
  routeWaypointsRef.current = routeWaypoints;

  // Fetch overlay data on mount
  useEffect(() => {
    const load = async () => {
      const [markersRes, zonesRes, routesRes, missionsRes, squadsRes] = await Promise.all([
        api.getMarkers().catch(() => ({ markers: [] })),
        api.getZones().catch(() => ({ zones: [] })),
        api.getRoutes().catch(() => ({ routes: [] })),
        api.getMissions().catch(() => ({ missions: [] })),
        api.getSquads().catch(() => ({ squads: [] })),
      ]);
      setMarkers(markersRes.markers);
      setZones(zonesRes.zones);
      setRoutes(routesRes.routes);
      setMissions(missionsRes.missions);
      setSquads(squadsRes.squads);
    };
    load();
    // Refresh overlay data periodically
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [setMarkers, setZones, setRoutes, setMissions, setSquads]);

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
        const { sx: screenX, sy: screenY } = worldToScreen(tm.cx - tm.radius, tm.cz - tm.radius, cx, cy, scale, offset);
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

          const { sx: originX, sy: originY } = worldToScreen(0, 0, cx, cy, scale, offset);
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
        const { sx: ox, sy: oy } = worldToScreen(0, 0, cx, cy, scale, offset);
        if (ox >= 0 && ox <= w && oy >= 0 && oy <= h) {
          ctx.fillStyle = '#ffffff40';
          ctx.font = '10px monospace';
          ctx.textAlign = 'left';
          ctx.fillText('0, 0', ox + 4, oy - 4);
        }
      }

      // ── Draw saved zones ──
      if (show.zones) {
        drawZones(ctx, zonesRef.current, cx, cy, scale, offset);
      }

      // ── Draw saved routes ──
      if (show.routes) {
        drawRoutes(ctx, routesRef.current, cx, cy, scale, offset);
      }

      // ── Draw saved markers ──
      if (show.markers) {
        drawMarkers(ctx, markersRef.current, cx, cy, scale, offset);
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
              const prev = worldToScreen(trail[i - 1].x, trail[i - 1].z, cx, cy, scale, offset);
              const cur = worldToScreen(trail[i].x, trail[i].z, cx, cy, scale, offset);
              ctx.moveTo(prev.sx, prev.sy);
              ctx.lineTo(cur.sx, cur.sy);
              ctx.stroke();
            }
          }
        }
      }

      // Entity markers
      for (const entity of entities) {
        const { sx, sy } = worldToScreen(entity.x, entity.z, cx, cy, scale, offset);
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

      // ── Mission overlays ──
      const botPositions = new Map<string, { x: number; z: number }>();
      for (const bot of bots) {
        if (bot.position) {
          botPositions.set(bot.name.toLowerCase(), { x: bot.position.x, z: bot.position.z });
        }
      }
      drawMissionOverlays(ctx, missionsRef.current, cx, cy, scale, offset, botPositions);

      // ── Squad overlays ──
      drawSquadOverlays(ctx, squadsRef.current, cx, cy, scale, offset, botPositions);

      // ── Zone draw preview ──
      const zds = zoneDrawStartRef.current;
      const zde = zoneDrawEndRef.current;
      if (zds && zde) {
        drawZonePreview(ctx, zds, zde, cx, cy, scale, offset);
      }

      // ── Route draw preview ──
      const rwp = routeWaypointsRef.current;
      if (rwp.length > 0) {
        drawRoutePreview(ctx, rwp, cx, cy, scale, offset);
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

      // Tool hint
      const tool = activeToolRef.current;
      if (tool !== 'select') {
        const hints: Record<string, string> = {
          'draw-zone': 'Click and drag to draw zone',
          'draw-route': 'Click to add waypoints, double-click to finish',
          'place-marker': 'Right-click to place a marker',
        };
        const hint = hints[tool] || '';
        ctx.fillStyle = '#00000090';
        const tw = ctx.measureText(hint).width + 20;
        ctx.fillRect(cx - tw / 2, 8, tw, 22);
        ctx.fillStyle = '#ffffffB0';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(hint, cx, 23);
      }

      animFrame = requestAnimationFrame(draw);
    };

    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
  }, []); // Empty deps — loop runs forever, reads from refs

  // Input handlers — all mutate refs directly, no state updates during drag/hover
  const handleMouseDown = (e: React.MouseEvent) => {
    // Close context menu on any click
    closeContextMenu();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;
    const tool = activeToolRef.current;

    // Zone drawing mode: start drag
    if (tool === 'draw-zone') {
      const { wx, wz } = screenToWorld(mx, my, cx, cy, scaleRef.current, offsetRef.current);
      setZoneDrawStart({ x: wx, z: wz });
      setZoneDrawEnd({ x: wx, z: wz });
      return;
    }

    // Route drawing mode: place waypoint on click
    if (tool === 'draw-route') {
      const { wx, wz } = screenToWorld(mx, my, cx, cy, scaleRef.current, offsetRef.current);
      addRouteWaypoint({ x: Math.round(wx), y: 64, z: Math.round(wz) });
      kick();
      return;
    }

    // Select tool: check entity clicks
    for (const [name, pos] of entityPositions.current) {
      const dx = mx - pos.sx;
      const dy = my - pos.sy;
      if (dx * dx + dy * dy < pos.radius * pos.radius) {
        selectedRef.current = selectedRef.current === name ? null : name;
        kick();
        return;
      }
    }

    draggingRef.current = true;
    dragStartRef.current = { x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;

    // Zone drawing: update preview
    if (activeToolRef.current === 'draw-zone' && zoneDrawStartRef.current) {
      const { wx, wz } = screenToWorld(mx, my, cx, cy, scaleRef.current, offsetRef.current);
      setZoneDrawEnd({ x: wx, z: wz });
      return;
    }

    if (draggingRef.current) {
      offsetRef.current = { x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y };
      return;
    }

    let found: string | null = null;
    for (const [name, pos] of entityPositions.current) {
      const dx = mx - pos.sx;
      const dy = my - pos.sy;
      if (dx * dx + dy * dy < pos.radius * pos.radius) { found = name; break; }
    }
    hoveredRef.current = found;
  };

  const handleMouseUp = () => {
    // Zone drawing: finish and open dialog
    if (activeToolRef.current === 'draw-zone' && zoneDrawStartRef.current && zoneDrawEndRef.current) {
      const start = zoneDrawStartRef.current;
      const end = zoneDrawEndRef.current;
      const dx = Math.abs(end.x - start.x);
      const dz = Math.abs(end.z - start.z);
      if (dx > 2 && dz > 2) {
        openZoneDialog({
          x1: Math.round(Math.min(start.x, end.x)),
          z1: Math.round(Math.min(start.z, end.z)),
          x2: Math.round(Math.max(start.x, end.x)),
          z2: Math.round(Math.max(start.z, end.z)),
        });
      } else {
        // Too small, cancel
        setZoneDrawStart(null);
        setZoneDrawEnd(null);
      }
      return;
    }

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

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Route drawing: finish on double-click
    if (activeToolRef.current === 'draw-route' && routeWaypointsRef.current.length >= 2) {
      openRouteDialog();
      return;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const { wx, wz } = screenToWorld(mx, my, cx, cy, scaleRef.current, offsetRef.current);

    // Place marker tool: directly place on right-click
    if (activeToolRef.current === 'place-marker') {
      const name = prompt('Marker name:');
      if (name?.trim()) {
        api.createMarker({
          name: name.trim(),
          x: Math.round(wx),
          y: 64,
          z: Math.round(wz),
        }).then((result) => {
          useMapOverlayStore.getState().addMarker(result.marker);
        }).catch(() => {});
      }
      return;
    }

    openContextMenu({
      screenX: mx,
      screenY: my,
      worldX: wx,
      worldZ: wz,
    });
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

  // Cursor style based on tool
  const getCursorClass = () => {
    if (draggingRef.current) return 'cursor-grabbing';
    if (activeTool === 'draw-zone') return 'cursor-crosshair';
    if (activeTool === 'draw-route') return 'cursor-crosshair';
    if (activeTool === 'place-marker') return 'cursor-crosshair';
    if (hoveredRef.current) return 'cursor-pointer';
    return 'cursor-grab';
  };

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
            <ToggleBtn active={show.zones} onClick={() => toggleShow('zones')} label="Zones" color="#8B5CF6" />
            <ToggleBtn active={show.routes} onClick={() => toggleShow('routes')} label="Routes" color="#F59E0B" />
            <ToggleBtn active={show.markers} onClick={() => toggleShow('markers')} label="Markers" color="#FFFFFF" />
          </div>
          {terrainStatus === 'loading' && (
            <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <span className="w-3 h-3 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
              Loading terrain...
            </span>
          )}
          {terrainStatus === 'error' && <span className="text-[10px] text-red-400/70">Terrain unavailable</span>}
        </div>
        <div className="flex items-center gap-3">
          <MapToolbar />
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

            {/* Zones list */}
            {zones.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 mt-4">
                  Zones ({zones.length})
                </p>
                <div className="space-y-0.5">
                  {zones.map((zone) => (
                    <button
                      key={zone.id}
                      onClick={() => { centerOn((zone.x1 + zone.x2) / 2, (zone.z1 + zone.z2) / 2); kick(); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-zinc-800/50 transition-colors"
                    >
                      <span className="w-2.5 h-2.5 shrink-0 rounded-sm" style={{ backgroundColor: zone.color || '#8B5CF6' }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-zinc-300 truncate">{zone.name}</p>
                        <p className="text-[9px] text-zinc-600 uppercase">{zone.type}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Routes list */}
            {routes.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 mt-4">
                  Routes ({routes.length})
                </p>
                <div className="space-y-0.5">
                  {routes.map((route) => (
                    <button
                      key={route.id}
                      onClick={() => {
                        if (route.waypoints.length > 0) {
                          centerOn(route.waypoints[0].x, route.waypoints[0].z);
                          kick();
                        }
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-zinc-800/50 transition-colors"
                    >
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full" style={{ backgroundColor: route.color || '#F59E0B' }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-zinc-300 truncate">{route.name}</p>
                        <p className="text-[9px] text-zinc-600">{route.waypoints.length} pts{route.loop ? ' (loop)' : ''}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Markers list */}
            {markers.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 mt-4">
                  Markers ({markers.length})
                </p>
                <div className="space-y-0.5">
                  {markers.map((marker) => (
                    <button
                      key={marker.id}
                      onClick={() => { centerOn(marker.x, marker.z); kick(); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-zinc-800/50 transition-colors"
                    >
                      <span className="w-2.5 h-2.5 shrink-0 rotate-45" style={{ backgroundColor: marker.color || '#FFFFFF', width: 8, height: 8 }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-zinc-300 truncate">{marker.name}</p>
                        <p className="text-[9px] text-zinc-600 font-mono">{Math.round(marker.x)}, {Math.round(marker.z)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className={`flex-1 relative ${getCursorClass()}`}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { handleMouseUp(); hoveredRef.current = null; }}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
            className="w-full h-full"
          />

          {/* Context menu */}
          <MapContextMenu />

          {/* Zone editor dialog */}
          <ZoneEditorDialog />

          {/* Route name dialog */}
          <RouteNameDialog />

          <div className="absolute bottom-4 left-4 bg-zinc-900/90 backdrop-blur-sm border border-zinc-800/60 rounded-lg p-3 text-[10px]">
            <p className="text-zinc-500 font-semibold uppercase tracking-wider mb-2">Legend</p>
            <div className="space-y-1.5">
              <LegendItem shape="circle" color="#6B7280" label="Bot" />
              <LegendItem shape="square" color="#60A5FA" label="Player" />
              {show.zones && <LegendItem shape="square" color="#8B5CF6" label="Zone" />}
              {show.routes && <LegendItem shape="circle" color="#F59E0B" label="Route" />}
              {show.markers && <LegendItem shape="diamond" color="#FFFFFF" label="Marker" />}
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
        </div>
      </div>
    </div>
  );
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

function LegendItem({ shape, color, label }: { shape: 'circle' | 'square' | 'diamond'; color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-3 h-3 ${shape === 'circle' ? 'rounded-full' : shape === 'diamond' ? 'rotate-45 rounded-sm' : 'rounded-sm'}`}
        style={{ backgroundColor: color, ...(shape === 'diamond' ? { width: 8, height: 8 } : {}) }}
      />
      <span className="text-zinc-400">{label}</span>
    </div>
  );
}
