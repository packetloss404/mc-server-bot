'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  useBotStore,
  useSchematicPlacementStore,
  useMovementTrailStore,
  type TrailPoint,
} from '@/lib/store';
import { useMapOverlayStore } from '@/lib/mapStore';
import { api, type SchematicInfo } from '@/lib/api';
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
import {
  MapToolbar,
  ZoneEditorDialog,
  RouteNameDialog,
  MapContextMenu,
  MapLayerToggle,
  DEFAULT_LAYERS,
  encodeLayers,
  decodeLayers,
  type LayerState,
} from '@/components/map';

const MIN_SCALE = 0.5;
const MAX_SCALE = 10;
const TERRAIN_RADIUS = 96;
const TERRAIN_STEP = 2;
const ZOOM_SENSITIVITY = 0.002; // Normalized zoom speed
const MARKER_HIT_RADIUS = 10; // pixels — for right-click detection

interface MapEntity {
  name: string;
  x: number;
  z: number;
  color: string;
  type: 'bot' | 'player';
  state?: string;
  personality?: string;
}

// ─── URL hash helpers ────────────────────────────────────────────────────

interface HashState {
  x?: number;
  z?: number;
  zoom?: number;
  layers?: LayerState;
  follow?: string;
}

function parseHash(hash: string): HashState {
  // Strip leading '#'
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const out: HashState = {};
  const xs = params.get('x');
  const zs = params.get('z');
  const zoom = params.get('zoom');
  const layers = params.get('layers');
  const follow = params.get('follow');
  if (xs && !Number.isNaN(Number(xs))) out.x = Number(xs);
  if (zs && !Number.isNaN(Number(zs))) out.z = Number(zs);
  if (zoom && !Number.isNaN(Number(zoom))) out.zoom = Number(zoom);
  if (layers) {
    const decoded = decodeLayers(layers);
    if (decoded) out.layers = decoded;
  }
  if (follow) out.follow = follow;
  return out;
}

function buildHash(state: HashState): string {
  const params = new URLSearchParams();
  if (state.x !== undefined) params.set('x', Math.round(state.x).toString());
  if (state.z !== undefined) params.set('z', Math.round(state.z).toString());
  if (state.zoom !== undefined) params.set('zoom', state.zoom.toFixed(2));
  if (state.layers) params.set('layers', encodeLayers(state.layers));
  if (state.follow) params.set('follow', state.follow);
  const s = params.toString();
  return s ? `#${s}` : '';
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

  // Movement trails
  const pushTrailPoint = useMovementTrailStore((s) => s.pushPoint);

  // ─── Layer state (URL-hash-driven) ─────────────────────────────────
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  // Use refs for all values the draw loop needs — avoids effect restarts
  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(3);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  // Toolbar-side overlays (terrain, grid, coords) are separate from the layer panel.
  const auxShowRef = useRef({ grid: true, coords: true, terrain: true });
  const botsRef = useRef(bots);
  const playersRef = useRef(players);
  const entityPositions = useRef<Map<string, { sx: number; sy: number; radius: number }>>(new Map());
  const terrainCanvas = useRef<OffscreenCanvas | null>(null);
  const terrainMeta = useRef<{ cx: number; cz: number; radius: number } | null>(null);
  const initializedRef = useRef(false);
  const hashInitializedRef = useRef(false);

  // Multi-select rectangle (Shift+drag) state — all refs for the draw loop.
  const marqueeDraggingRef = useRef(false);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeEndRef = useRef<{ x: number; y: number } | null>(null);
  // Set of lowercase bot names currently marquee-selected.
  const [marqueeSelection, setMarqueeSelection] = useState<Set<string>>(new Set());
  const marqueeSelectionRef = useRef(marqueeSelection);
  marqueeSelectionRef.current = marqueeSelection;

  // Follow target — recenter on every position update of this bot. null = off.
  const followRef = useRef<string | null>(null);
  const [followName, setFollowName] = useState<string | null>(null);

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
  const kick = useCallback(() => forceRender((n) => n + 1), []);

  const [terrainStatus, setTerrainStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  // ─── Building placement state ───
  const pendingPlacements = useSchematicPlacementStore((s) => s.pending);
  const addPending = useSchematicPlacementStore((s) => s.addPending);
  const removePending = useSchematicPlacementStore((s) => s.removePending);
  const clearPending = useSchematicPlacementStore((s) => s.clearPending);

  const [schematics, setSchematics] = useState<SchematicInfo[]>([]);
  const [selectedSchematic, setSelectedSchematic] = useState<string>('');
  const [campaignName, setCampaignName] = useState<string>('');
  const [campaignStatus, setCampaignStatus] = useState<
    { kind: 'idle' } | { kind: 'sending' } | { kind: 'success'; name: string } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // Refs for draw loop
  const pendingRef = useRef(pendingPlacements);
  const selectedSchematicRef = useRef(selectedSchematic);
  const schematicsRef = useRef(schematics);
  const cursorWorldRef = useRef<{ x: number; z: number } | null>(null);
  pendingRef.current = pendingPlacements;
  selectedSchematicRef.current = selectedSchematic;
  schematicsRef.current = schematics;

  // Load schematics on mount
  useEffect(() => {
    let cancelled = false;
    api.getSchematics().then((res) => {
      if (cancelled) return;
      setSchematics(res.schematics ?? []);
      setSelectedSchematic((prev) => {
        if (prev) return prev;
        return res.schematics?.[0]?.filename ?? '';
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [setMarkers, setZones, setRoutes, setMissions, setSquads]);

  // ─── Hash → state (mount only) ────────────────────────────────────
  useEffect(() => {
    if (hashInitializedRef.current) return;
    const parsed = parseHash(window.location.hash);
    if (parsed.layers) setLayers(parsed.layers);
    if (parsed.zoom !== undefined) {
      scaleRef.current = Math.min(MAX_SCALE, Math.max(MIN_SCALE, parsed.zoom));
    }
    if (parsed.x !== undefined && parsed.z !== undefined) {
      offsetRef.current = {
        x: -parsed.x * scaleRef.current,
        y: -parsed.z * scaleRef.current,
      };
      initializedRef.current = true;
    }
    if (parsed.follow) {
      followRef.current = parsed.follow;
      setFollowName(parsed.follow);
    }
    hashInitializedRef.current = true;
    kick();
  }, [kick]);

  // ─── state → hash (debounced 250ms) ────────────────────────────────
  const hashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeHashSoon = useCallback(() => {
    if (!hashInitializedRef.current) return;
    if (hashTimerRef.current) clearTimeout(hashTimerRef.current);
    hashTimerRef.current = setTimeout(() => {
      const wx = -offsetRef.current.x / scaleRef.current;
      const wz = -offsetRef.current.y / scaleRef.current;
      const next = buildHash({
        x: wx,
        z: wz,
        zoom: scaleRef.current,
        layers: layersRef.current,
        follow: followRef.current ?? undefined,
      });
      // Use replaceState to avoid polluting history.
      const url = `${window.location.pathname}${window.location.search}${next}`;
      window.history.replaceState(null, '', url);
    }, 250);
  }, []);

  // Write the hash whenever layers or follow change.
  useEffect(() => {
    writeHashSoon();
  }, [layers, followName, writeHashSoon]);

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

  // Push every position update into the movement-trail ring buffer + handle follow.
  useEffect(() => {
    for (const bot of bots) {
      if (!bot.position) continue;
      pushTrailPoint(bot.name, bot.position.x, bot.position.z);
    }
    for (const p of players) {
      if (!p.isOnline || !p.position) continue;
      // Players share the trail store too — keyed by name.
      pushTrailPoint(p.name, p.position.x, p.position.z);
    }
    // Follow logic: recenter on every position tick of the followed bot.
    const followTarget = followRef.current;
    if (followTarget) {
      const lower = followTarget.toLowerCase();
      const target =
        bots.find((b) => b.name.toLowerCase() === lower) ??
        players.find((p) => p.name.toLowerCase() === lower);
      if (target?.position) {
        offsetRef.current = {
          x: -target.position.x * scaleRef.current,
          y: -target.position.z * scaleRef.current,
        };
      }
    }
  }, [bots, players, pushTrailPoint]);

  // Center on first entity once (only if hash didn't already position us)
  useEffect(() => {
    if (initializedRef.current) return;
    if (!hashInitializedRef.current) return;
    const allEntities = [...bots, ...players.filter((p) => p.isOnline)];
    const first = allEntities.find((e) => e.position);
    if (first?.position) {
      offsetRef.current = {
        x: -first.position.x * scaleRef.current,
        y: -first.position.z * scaleRef.current,
      };
      initializedRef.current = true;
      loadTerrain(first.position.x, first.position.z);
      kick();
    }
  }, [bots, players, loadTerrain, kick]);

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
      const aux = auxShowRef.current;
      const layerState = layersRef.current;
      const bots = botsRef.current;
      const players = playersRef.current;
      const hovered = hoveredRef.current;
      const selected = selectedRef.current;
      const marquee = marqueeSelectionRef.current;

      const cx = w / 2;
      const cy = h / 2;

      // Background
      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, w, h);

      // Terrain
      if (aux.terrain && terrainCanvas.current && terrainMeta.current) {
        const tm = terrainMeta.current;
        const tc = terrainCanvas.current;
        const { sx: screenX, sy: screenY } = worldToScreen(tm.cx - tm.radius, tm.cz - tm.radius, cx, cy, scale, offset);
        const screenW = tc.width * TERRAIN_STEP * scale;
        const screenH = tc.height * TERRAIN_STEP * scale;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tc, screenX, screenY, screenW, screenH);
      }

      // Grid
      if (aux.grid) {
        const gridSize = 16 * scale;
        if (gridSize > 4) {
          const hasTerrain = aux.terrain && terrainCanvas.current;
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
      if (aux.coords) {
        const { sx: ox, sy: oy } = worldToScreen(0, 0, cx, cy, scale, offset);
        if (ox >= 0 && ox <= w && oy >= 0 && oy <= h) {
          ctx.fillStyle = '#ffffff40';
          ctx.font = '10px monospace';
          ctx.textAlign = 'left';
          ctx.fillText('0, 0', ox + 4, oy - 4);
        }
      }

      // ── Draw saved zones ──
      if (layerState.zones) {
        drawZones(ctx, zonesRef.current, cx, cy, scale, offset);
      }

      // ── Draw saved routes ──
      if (layerState.routes) {
        drawRoutes(ctx, routesRef.current, cx, cy, scale, offset);
      }

      // ── Draw saved markers ──
      if (layerState.markers) {
        drawMarkers(ctx, markersRef.current, cx, cy, scale, offset);
      }

      // Collect entities
      const entities: MapEntity[] = [];
      const drawnNames = new Set<string>();
      if (layerState.bots) {
        for (const bot of bots) {
          if (!bot.position) continue;
          drawnNames.add(bot.name.toLowerCase());
          entities.push({ name: bot.name, x: bot.position.x, z: bot.position.z, color: getPersonalityColor(bot.personality), type: 'bot', state: bot.state, personality: bot.personality });
        }
      }
      if (layerState.players) {
        for (const player of players) {
          if (!player.isOnline || !player.position || drawnNames.has(player.name.toLowerCase())) continue;
          entities.push({ name: player.name, x: player.position.x, z: player.position.z, color: PLAYER_COLOR, type: 'player' });
        }
      }

      entityPositions.current.clear();

      // ── Movement trails (from useMovementTrailStore) ──
      if (layerState.trails) {
        const trails = useMovementTrailStore.getState().trailsByBot;
        for (const entity of entities) {
          const trail = trails[entity.name.toLowerCase()];
          if (!trail || trail.length < 2) continue;
          drawTrail(ctx, trail, entity.color, entity.type === 'player' ? 1.5 : 2, cx, cy, scale, offset);
        }
      }

      // ── Entity markers ──
      for (const entity of entities) {
        const { sx, sy } = worldToScreen(entity.x, entity.z, cx, cy, scale, offset);
        if (sx < -30 || sx > w + 30 || sy < -30 || sy > h + 30) continue;

        const isHovered = hovered === entity.name;
        const isSelected = selected === entity.name;
        const isMarquee = marquee.has(entity.name.toLowerCase());
        const baseR = entity.type === 'bot' ? 8 : 6;
        const r = isHovered || isSelected || isMarquee ? baseR + 2 : baseR;

        entityPositions.current.set(entity.name, { sx, sy, radius: r + 4 });

        // Marquee selection ring (bright teal).
        if (isMarquee) {
          ctx.beginPath();
          ctx.arc(sx, sy, r + 8, 0, Math.PI * 2);
          ctx.strokeStyle = '#22D3EE';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

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

      // ── Pending building placements (gated by Builds layer) ──
      if (layerState.builds) {
        const pendings = pendingRef.current;
        const schematicList = schematicsRef.current;
        const schematicByFile = new Map(schematicList.map((s) => [s.filename, s] as const));
        if (pendings.length > 0) {
          for (let i = 0; i < pendings.length; i++) {
            const p = pendings[i];
            const sch = schematicByFile.get(p.schematicFile);
            const sizeX = sch?.size.x ?? 1;
            const sizeZ = sch?.size.z ?? 1;
            const tl = worldToScreen(p.origin.x, p.origin.z, cx, cy, scale, offset);
            const sw = sizeX * scale;
            const sh = sizeZ * scale;

            ctx.save();
            ctx.fillStyle = '#F59E0B22';
            ctx.fillRect(tl.sx, tl.sy, sw, sh);
            ctx.strokeStyle = '#F59E0BC0';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(tl.sx, tl.sy, sw, sh);
            ctx.setLineDash([]);

            ctx.shadowColor = '#000000';
            ctx.shadowBlur = 3;
            ctx.fillStyle = '#F59E0B';
            ctx.font = 'bold 11px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`#${i + 1}`, tl.sx + 4, tl.sy + 13);

            const labelName = p.label || p.schematicFile;
            ctx.fillStyle = '#ffffffCC';
            ctx.font = '9px system-ui, sans-serif';
            ctx.fillText(labelName, tl.sx + 4, tl.sy + sh - 4);
            ctx.restore();
          }
        }

        // Place-building cursor preview also gated by Builds layer
        if (activeToolRef.current === 'place-building' && cursorWorldRef.current) {
          const selFile = selectedSchematicRef.current;
          const sch = selFile ? schematicByFile.get(selFile) : undefined;
          if (sch) {
            const sizeX = sch.size.x;
            const sizeZ = sch.size.z;
            const ox = Math.floor(cursorWorldRef.current.x);
            const oz = Math.floor(cursorWorldRef.current.z);
            const tl = worldToScreen(ox, oz, cx, cy, scale, offset);
            const sw = sizeX * scale;
            const sh = sizeZ * scale;

            ctx.save();
            ctx.fillStyle = '#8B5CF622';
            ctx.fillRect(tl.sx, tl.sy, sw, sh);
            ctx.strokeStyle = '#8B5CF6E0';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(tl.sx, tl.sy, sw, sh);
            ctx.setLineDash([]);

            ctx.shadowColor = '#000000';
            ctx.shadowBlur = 3;
            ctx.fillStyle = '#C4B5FD';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(
              `${sizeX}×${sizeZ}  @ ${ox}, ${oz}`,
              tl.sx + sw / 2,
              tl.sy + sh / 2 + 4,
            );
            ctx.restore();
          }
        }
      }

      // ── Marquee rectangle (Shift+drag) ──
      if (marqueeDraggingRef.current && marqueeStartRef.current && marqueeEndRef.current) {
        const sx1 = marqueeStartRef.current.x;
        const sy1 = marqueeStartRef.current.y;
        const sx2 = marqueeEndRef.current.x;
        const sy2 = marqueeEndRef.current.y;
        const rx = Math.min(sx1, sx2);
        const ry = Math.min(sy1, sy2);
        const rw = Math.abs(sx2 - sx1);
        const rh = Math.abs(sy2 - sy1);
        ctx.save();
        ctx.fillStyle = '#22D3EE22';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = '#22D3EE';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
        ctx.restore();
      }

      // HUD overlays
      if (aux.coords) {
        ctx.fillStyle = '#00000080'; ctx.fillRect(8, h - 28, 130, 20);
        ctx.fillStyle = '#ffffff80'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
        ctx.fillText(`Center: ${Math.round(-offset.x / scale)}, ${Math.round(-offset.y / scale)}`, 14, h - 14);
      }
      ctx.fillStyle = '#00000080'; ctx.fillRect(w - 50, h - 28, 42, 20);
      ctx.fillStyle = '#ffffff60'; ctx.font = '10px monospace'; ctx.textAlign = 'right';
      ctx.fillText(`${scale.toFixed(1)}x`, w - 12, h - 14);

      // Follow badge
      if (followRef.current) {
        const text = `Following ${followRef.current}`;
        ctx.font = '10px system-ui, sans-serif';
        const tw = ctx.measureText(text).width + 16;
        ctx.fillStyle = '#22D3EECC';
        ctx.fillRect(8, 8, tw, 18);
        ctx.fillStyle = '#0a0a0c';
        ctx.textAlign = 'left';
        ctx.fillText(text, 16, 20);
      }

      // Tool hint
      const tool = activeToolRef.current;
      if (tool !== 'select') {
        const hints: Record<string, string> = {
          'draw-zone': 'Click and drag to draw zone',
          'draw-route': 'Click to add waypoints, double-click to finish',
          'place-marker': 'Right-click to place a marker',
          'place-building': 'Pick a schematic in the sidebar, then click to place',
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

  // ─── Hit-testing helpers ───────────────────────────────────────────

  const hitTestEntity = (mx: number, my: number): string | null => {
    for (const [name, pos] of entityPositions.current) {
      const dx = mx - pos.sx;
      const dy = my - pos.sy;
      if (dx * dx + dy * dy < pos.radius * pos.radius) return name;
    }
    return null;
  };

  const hitTestMarker = (mx: number, my: number, cx: number, cy: number): string | null => {
    const scale = scaleRef.current;
    const offset = offsetRef.current;
    for (const m of markersRef.current) {
      const { sx, sy } = worldToScreen(m.x, m.z, cx, cy, scale, offset);
      const dx = mx - sx;
      const dy = my - sy;
      if (dx * dx + dy * dy < MARKER_HIT_RADIUS * MARKER_HIT_RADIUS) return m.id;
    }
    return null;
  };

  // ─── Input handlers ────────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent) => {
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

    // Shift+drag → marquee selection (highest priority in select mode).
    if (e.shiftKey && tool === 'select') {
      marqueeDraggingRef.current = true;
      marqueeStartRef.current = { x: mx, y: my };
      marqueeEndRef.current = { x: mx, y: my };
      return;
    }

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

    // Place-building mode: add a pending placement at the clicked location.
    if (tool === 'place-building') {
      const selFile = selectedSchematicRef.current;
      if (!selFile) return;
      const { wx, wz } = screenToWorld(mx, my, cx, cy, scaleRef.current, offsetRef.current);
      const ox = Math.floor(wx);
      const oz = Math.floor(wz);
      const labelBase = selFile.replace(/\.(schem|schematic)$/i, '');
      const label = `${labelBase} #${pendingRef.current.length + 1}`;
      const provisionalY = 64;
      const id = addPending({
        schematicFile: selFile,
        origin: { x: ox, y: provisionalY, z: oz },
        label,
      });
      api.getTerrainHeight(ox, oz).then((res) => {
        useSchematicPlacementStore.setState((state) => {
          if (!state.pending.some((p) => p.id === id)) return state;
          return {
            pending: state.pending.map((p) =>
              p.id === id ? { ...p, origin: { ...p.origin, y: res.y } } : p,
            ),
          };
        });
        kick();
      }).catch(() => {});
      kick();
      return;
    }

    // Select tool: check entity clicks
    const hitName = hitTestEntity(mx, my);
    if (hitName) {
      selectedRef.current = selectedRef.current === hitName ? null : hitName;
      kick();
      return;
    }

    // Click on empty map clears the marquee selection.
    if (marqueeSelectionRef.current.size > 0) {
      setMarqueeSelection(new Set());
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

    // Marquee drag — update end point.
    if (marqueeDraggingRef.current) {
      marqueeEndRef.current = { x: mx, y: my };
      return;
    }

    // Zone drawing: update preview
    if (activeToolRef.current === 'draw-zone' && zoneDrawStartRef.current) {
      const { wx, wz } = screenToWorld(mx, my, cx, cy, scaleRef.current, offsetRef.current);
      setZoneDrawEnd({ x: wx, z: wz });
      return;
    }

    // Place-building: track world cursor for footprint preview
    if (activeToolRef.current === 'place-building') {
      const { wx, wz } = screenToWorld(mx, my, cx, cy, scaleRef.current, offsetRef.current);
      cursorWorldRef.current = { x: wx, z: wz };
    } else if (cursorWorldRef.current) {
      cursorWorldRef.current = null;
    }

    if (draggingRef.current) {
      offsetRef.current = { x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y };
      // Manual pan stops follow mode.
      if (followRef.current) {
        followRef.current = null;
        setFollowName(null);
      }
      writeHashSoon();
      return;
    }

    hoveredRef.current = hitTestEntity(mx, my);
  };

  const handleMouseUp = (e?: React.MouseEvent) => {
    // Finish marquee selection.
    if (marqueeDraggingRef.current) {
      const start = marqueeStartRef.current;
      const end = marqueeEndRef.current;
      marqueeDraggingRef.current = false;
      if (start && end) {
        const rx1 = Math.min(start.x, end.x);
        const ry1 = Math.min(start.y, end.y);
        const rx2 = Math.max(start.x, end.x);
        const ry2 = Math.max(start.y, end.y);
        // If the rectangle is essentially a point, treat as a click — don't change selection.
        if (Math.abs(rx2 - rx1) >= 4 && Math.abs(ry2 - ry1) >= 4) {
          const selection = new Set<string>();
          for (const [name, pos] of entityPositions.current) {
            // Only consider bots — players aren't directly controllable.
            const lower = name.toLowerCase();
            const isBot = botsRef.current.some((b) => b.name.toLowerCase() === lower);
            if (!isBot) continue;
            if (pos.sx >= rx1 && pos.sx <= rx2 && pos.sy >= ry1 && pos.sy <= ry2) {
              selection.add(lower);
            }
          }
          setMarqueeSelection(selection);
        }
      }
      marqueeStartRef.current = null;
      marqueeEndRef.current = null;
      kick();
      return;
    }

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
        setZoneDrawStart(null);
        setZoneDrawEnd(null);
      }
      return;
    }

    if (draggingRef.current) {
      draggingRef.current = false;
      if (auxShowRef.current.terrain) {
        const viewCenterX = -offsetRef.current.x / scaleRef.current;
        const viewCenterZ = -offsetRef.current.y / scaleRef.current;
        loadTerrain(viewCenterX, viewCenterZ);
      }
      writeHashSoon();
      kick();
    }
  };

  const handleDoubleClick = () => {
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

    // Detect bot or marker hit (in that order).
    const botHit = hitTestEntity(mx, my);
    // If the hit name is actually a player, fall through to map menu.
    const isBot =
      botHit && botsRef.current.some((b) => b.name.toLowerCase() === botHit.toLowerCase());
    const markerHit = isBot ? null : hitTestMarker(mx, my, cx, cy);

    openContextMenu({
      screenX: mx,
      screenY: my,
      worldX: wx,
      worldZ: wz,
      botName: isBot ? botHit! : undefined,
      markerId: markerHit ?? undefined,
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

      const rawDelta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const zoomFactor = Math.exp(-rawDelta * ZOOM_SENSITIVITY);

      const oldScale = scaleRef.current;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * zoomFactor));
      const ratio = newScale / oldScale;

      const cw = rect.width / 2;
      const ch = rect.height / 2;
      offsetRef.current = {
        x: mouseX - cw - (mouseX - cw - offsetRef.current.x) * ratio,
        y: mouseY - ch - (mouseY - ch - offsetRef.current.y) * ratio,
      };
      scaleRef.current = newScale;
      writeHashSoon();
      kick();
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [kick, writeHashSoon]);

  // Reload terrain after zoom settles
  useEffect(() => {
    if (!auxShowRef.current.terrain || !initializedRef.current) return;
    const timer = setTimeout(() => {
      const viewCenterX = -offsetRef.current.x / scaleRef.current;
      const viewCenterZ = -offsetRef.current.y / scaleRef.current;
      loadTerrain(viewCenterX, viewCenterZ);
    }, 500);
    return () => clearTimeout(timer);
  });

  const centerOn = (x: number, z: number) => {
    offsetRef.current = { x: -x * scaleRef.current, y: -z * scaleRef.current };
    writeHashSoon();
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

  const aux = auxShowRef.current;
  const toggleAux = (key: keyof typeof aux) => {
    auxShowRef.current = { ...aux, [key]: !aux[key] };
    kick();
  };

  // Cursor style based on tool
  const getCursorClass = () => {
    if (draggingRef.current) return 'cursor-grabbing';
    if (marqueeDraggingRef.current) return 'cursor-crosshair';
    if (activeTool === 'draw-zone') return 'cursor-crosshair';
    if (activeTool === 'draw-route') return 'cursor-crosshair';
    if (activeTool === 'place-marker') return 'cursor-crosshair';
    if (activeTool === 'place-building') return 'cursor-crosshair';
    if (hoveredRef.current) return 'cursor-pointer';
    return 'cursor-grab';
  };

  // ─── Selection panel actions ──────────────────────────────────────

  const selectionList = bots.filter((b) => marqueeSelection.has(b.name.toLowerCase()));

  const handleSelectionSendHere = async () => {
    if (selectionList.length === 0) return;
    // Send to current view center as a fallback "rally point".
    const tx = Math.round(-offsetRef.current.x / scaleRef.current);
    const tz = Math.round(-offsetRef.current.y / scaleRef.current);
    for (const b of selectionList) {
      try {
        await api.walkTo(b.name, tx, null, tz);
      } catch {
        // continue
      }
    }
  };

  const handleSelectionPauseAll = async () => {
    for (const b of selectionList) {
      try {
        await api.pauseBot(b.name);
      } catch {
        // continue
      }
    }
  };

  const handleSelectionResumeAll = async () => {
    for (const b of selectionList) {
      try {
        await api.resumeBot(b.name);
      } catch {
        // continue
      }
    }
  };

  const handleClearSelection = () => setMarqueeSelection(new Set());

  const handleFollow = (name: string) => {
    followRef.current = name;
    setFollowName(name);
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Toolbar */}
      <div className="px-4 py-2.5 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-950/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold text-white">World Map</h1>
          <div className="flex items-center gap-1.5 text-[11px]">
            <ToggleBtn active={aux.terrain} onClick={() => toggleAux('terrain')} label="Terrain" color="#5B8C33" />
            <ToggleBtn active={aux.grid} onClick={() => toggleAux('grid')} label="Grid" />
            <ToggleBtn active={aux.coords} onClick={() => toggleAux('coords')} label="Coords" />
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
            onClick={() => { scaleRef.current = Math.min(MAX_SCALE, scaleRef.current * 1.3); writeHashSoon(); kick(); }}
            className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm transition-colors"
          >+</button>
          <span className="text-[10px] text-zinc-500 font-mono w-8 text-center">{scaleRef.current.toFixed(1)}x</span>
          <button
            onClick={() => { scaleRef.current = Math.max(MIN_SCALE, scaleRef.current / 1.3); writeHashSoon(); kick(); }}
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
                      onClick={() => { centerOn(((zone.x1 ?? 0) + (zone.x2 ?? 0)) / 2, ((zone.z1 ?? 0) + (zone.z2 ?? 0)) / 2); kick(); }}
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

            {/* Building placement — active tool schematic picker */}
            {activeTool === 'place-building' && (
              <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                <p className="text-[10px] font-semibold text-amber-300 uppercase tracking-wider mb-2">
                  Place Building
                </p>
                {schematics.length === 0 ? (
                  <p className="text-[11px] text-zinc-500">No schematics available.</p>
                ) : (
                  <>
                    <label className="block text-[10px] text-zinc-400 mb-1">Schematic</label>
                    <select
                      value={selectedSchematic}
                      onChange={(e) => setSelectedSchematic(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200"
                    >
                      {schematics.map((s) => (
                        <option key={s.filename} value={s.filename}>
                          {s.filename}  ({s.size.x}×{s.size.y}×{s.size.z})
                        </option>
                      ))}
                    </select>
                    <p className="text-[9px] text-zinc-500 mt-2">
                      Click on the map to drop a footprint. Y is snapped to the terrain height.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Pending placements list */}
            {pendingPlacements.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-amber-300 uppercase tracking-wider mb-2 mt-4">
                  Pending Placements ({pendingPlacements.length})
                </p>
                <div className="space-y-0.5">
                  {pendingPlacements.map((p, i) => (
                    <div
                      key={p.id}
                      className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800/50 transition-colors"
                    >
                      <span className="text-[10px] font-mono text-amber-400 w-6 shrink-0">#{i + 1}</span>
                      <button
                        onClick={() => { centerOn(p.origin.x, p.origin.z); kick(); }}
                        className="flex-1 min-w-0 text-left"
                      >
                        <p className="text-[11px] font-medium text-zinc-200 truncate">
                          {p.label || p.schematicFile}
                        </p>
                        <p className="text-[9px] text-zinc-500 font-mono tabular-nums">
                          {Math.round(p.origin.x)}, {Math.round(p.origin.y)}, {Math.round(p.origin.z)}
                        </p>
                      </button>
                      <button
                        onClick={() => { removePending(p.id); kick(); }}
                        title="Remove"
                        className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-red-600/40 text-zinc-400 hover:text-red-200 transition-colors shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-3 space-y-1.5">
                  <input
                    type="text"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="Campaign name"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200"
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      disabled={campaignStatus.kind === 'sending' || !campaignName.trim() || pendingPlacements.length === 0}
                      onClick={async () => {
                        const name = campaignName.trim();
                        if (!name || pendingPlacements.length === 0) return;
                        setCampaignStatus({ kind: 'sending' });
                        try {
                          await api.createCampaign({
                            name,
                            structures: pendingPlacements.map((p) => ({
                              schematicFile: p.schematicFile,
                              origin: p.origin,
                            })),
                            start: false,
                          });
                          clearPending();
                          setCampaignName('');
                          setCampaignStatus({ kind: 'success', name });
                          setTimeout(() => setCampaignStatus({ kind: 'idle' }), 4000);
                          kick();
                        } catch (err: any) {
                          setCampaignStatus({ kind: 'error', message: err?.message || 'Failed to create campaign' });
                        }
                      }}
                      className="flex-1 px-2 py-1 text-[11px] font-medium rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {campaignStatus.kind === 'sending' ? 'Sending…' : 'Send to Campaign'}
                    </button>
                    <button
                      onClick={() => { clearPending(); setCampaignStatus({ kind: 'idle' }); kick(); }}
                      className="px-2 py-1 text-[11px] rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                  {campaignStatus.kind === 'success' && (
                    <p className="text-[10px] text-emerald-400">Campaign “{campaignStatus.name}” created.</p>
                  )}
                  {campaignStatus.kind === 'error' && (
                    <p className="text-[10px] text-red-400">{campaignStatus.message}</p>
                  )}
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
            onMouseLeave={() => { handleMouseUp(); hoveredRef.current = null; cursorWorldRef.current = null; }}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
            className="w-full h-full"
          />

          {/* Layer toggle panel (top-right) */}
          <MapLayerToggle layers={layers} onChange={setLayers} />

          {/* Context menu */}
          <MapContextMenu
            selectedBotNames={Array.from(marqueeSelection)}
            onFollow={handleFollow}
            onSetBuildOrigin={(x, z) => {
              // Default to whatever schematic is selected; if none, no-op.
              const selFile = selectedSchematicRef.current;
              if (!selFile) return;
              const labelBase = selFile.replace(/\.(schem|schematic)$/i, '');
              const label = `${labelBase} #${pendingRef.current.length + 1}`;
              const id = addPending({
                schematicFile: selFile,
                origin: { x, y: 64, z },
                label,
              });
              api.getTerrainHeight(x, z).then((res) => {
                useSchematicPlacementStore.setState((state) => {
                  if (!state.pending.some((p) => p.id === id)) return state;
                  return {
                    pending: state.pending.map((p) =>
                      p.id === id ? { ...p, origin: { ...p.origin, y: res.y } } : p,
                    ),
                  };
                });
                kick();
              }).catch(() => {});
              kick();
            }}
          />

          {/* Zone editor dialog */}
          <ZoneEditorDialog />

          {/* Route name dialog */}
          <RouteNameDialog />

          {/* Selection panel (bottom) */}
          {marqueeSelection.size > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-zinc-900/95 border border-teal-500/40 rounded-lg shadow-xl backdrop-blur-sm px-3 py-2 flex items-center gap-2">
              <span className="text-[11px] font-semibold text-teal-300">
                [{marqueeSelection.size}] bot{marqueeSelection.size === 1 ? '' : 's'} selected
              </span>
              <span className="w-px h-4 bg-zinc-700" />
              <button
                onClick={handleSelectionSendHere}
                className="px-2 py-0.5 text-[11px] rounded bg-teal-500/20 border border-teal-500/40 text-teal-200 hover:bg-teal-500/30 transition-colors"
                title="Send all selected bots to the current view center"
              >
                Send all here
              </button>
              <button
                onClick={handleSelectionPauseAll}
                className="px-2 py-0.5 text-[11px] rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Pause all
              </button>
              <button
                onClick={handleSelectionResumeAll}
                className="px-2 py-0.5 text-[11px] rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Resume all
              </button>
              <button
                onClick={handleClearSelection}
                className="px-2 py-0.5 text-[11px] rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Clear
              </button>
            </div>
          )}

          <div className="absolute bottom-4 left-4 bg-zinc-900/90 backdrop-blur-sm border border-zinc-800/60 rounded-lg p-3 text-[10px]">
            <p className="text-zinc-500 font-semibold uppercase tracking-wider mb-2">Legend</p>
            <div className="space-y-1.5">
              <LegendItem shape="circle" color="#6B7280" label="Bot" />
              <LegendItem shape="square" color="#60A5FA" label="Player" />
              {layers.zones && <LegendItem shape="square" color="#8B5CF6" label="Zone" />}
              {layers.routes && <LegendItem shape="circle" color="#F59E0B" label="Route" />}
              {layers.markers && <LegendItem shape="diamond" color="#FFFFFF" label="Marker" />}
              {aux.terrain && terrainCanvas.current && (
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

// Draw a fading polyline behind an entity.
// Newest segment full opacity; oldest at 0.1.
function drawTrail(
  ctx: CanvasRenderingContext2D,
  trail: TrailPoint[],
  baseColor: string,
  baseWidth: number,
  cx: number,
  cy: number,
  scale: number,
  offset: { x: number; y: number },
) {
  const n = trail.length;
  if (n < 2) return;
  for (let i = 1; i < n; i++) {
    // Older segments → lower alpha. i=1 is the oldest, i=n-1 is the newest.
    const t = i / (n - 1); // 0..1
    const alpha = 0.1 + 0.9 * t; // 0.1 → 1.0
    const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
    const prev = worldToScreen(trail[i - 1].x, trail[i - 1].z, cx, cy, scale, offset);
    const cur = worldToScreen(trail[i].x, trail[i].z, cx, cy, scale, offset);
    ctx.beginPath();
    ctx.strokeStyle = baseColor + a;
    ctx.lineWidth = baseWidth;
    ctx.moveTo(prev.sx, prev.sy);
    ctx.lineTo(cur.sx, cur.sy);
    ctx.stroke();
  }
}
