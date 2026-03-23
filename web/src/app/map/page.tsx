'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useBotStore } from '@/lib/store';
import { useFleetStore } from '@/lib/fleetStore';
import { useMissionStore } from '@/lib/missionStore';
import { useMapStore, generateId } from '@/lib/mapStore';
import type { MapMarker, MapZone, ZoneMode, MapInteractionMode } from '@/lib/mapStore';
import { api } from '@/lib/api';
import { getPersonalityColor, PLAYER_COLOR, STATE_COLORS } from '@/lib/constants';
import { getBlockColor } from '@/lib/blockColors';

const MIN_SCALE = 0.5;
const MAX_SCALE = 10;
const TRAIL_LENGTH = 80;
const TERRAIN_RADIUS = 96;
const TERRAIN_STEP = 2;
const ZOOM_SENSITIVITY = 0.002;

// Squad color palette derived from squad name hash
const SQUAD_PALETTE = [
  '#F59E0B', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
];

function squadColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return SQUAD_PALETTE[Math.abs(hash) % SQUAD_PALETTE.length];
}

// Mission type short labels
const MISSION_LABELS: Record<string, string> = {
  queue_task: 'task',
  gather_items: 'gather',
  craft_items: 'craft',
  smelt_batch: 'smelt',
  build_schematic: 'build',
  supply_chain: 'supply',
  patrol_zone: 'patrol',
  escort_player: 'escort',
  resupply_builder: 'resupply',
};

// Zone mode colors
const ZONE_COLORS: Record<string, string> = {
  guard: '#4A90D9',
  avoid: '#EF4444',
  farm: '#F39C12',
  build: '#1ABC9C',
  gather: '#27AE60',
  custom: '#8B5CF6',
};

// Marker kind icons (simple text chars for canvas)
const MARKER_ICONS: Record<string, string> = {
  base: '\u2302',       // house
  storage: '\u25A3',    // box
  'build-site': '\u2692', // hammer
  mine: '\u26CF',       // pick
  village: '\u2616',    // flag
  custom: '\u2605',     // star
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

interface ContextMenuState {
  x: number;
  y: number;
  worldX: number;
  worldZ: number;
  entityName?: string;
}

export default function MapPage() {
  const bots = useBotStore((s) => s.botList);
  const players = useBotStore((s) => s.playerList);
  const squads = useFleetStore((s) => s.squads);
  const missions = useMissionStore((s) => s.missions);
  const markers = useMapStore((s) => s.markers);
  const zones = useMapStore((s) => s.zones);
  const activeBuild = useMapStore((s) => s.activeBuild);
  const interactionMode = useMapStore((s) => s.interactionMode);
  const editingMarkerId = useMapStore((s) => s.editingMarkerId);
  const editingZoneId = useMapStore((s) => s.editingZoneId);
  const mapActions = useMapStore.getState();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(3);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const showRef = useRef({ bots: true, players: true, trails: true, grid: true, coords: true, terrain: true, squads: true, missions: true, zones: true, markers: true, buildSite: true });
  const botsRef = useRef(bots);
  const playersRef = useRef(players);
  const squadsRef = useRef(squads);
  const missionsRef = useRef(missions);
  const markersRef = useRef(markers);
  const zonesRef = useRef(zones);
  const activeBuildRef = useRef(activeBuild);
  const interactionModeRef = useRef(interactionMode);
  const trails = useRef<Map<string, { x: number; z: number }[]>>(new Map());
  const entityPositions = useRef<Map<string, { sx: number; sy: number; radius: number }>>(new Map());
  const terrainCanvas = useRef<OffscreenCanvas | null>(null);
  const terrainMeta = useRef<{ cx: number; cz: number; radius: number } | null>(null);
  const initializedRef = useRef(false);
  const mouseWorldRef = useRef<{ x: number; z: number } | null>(null);

  // Zone drawing state
  const zoneDragRef = useRef<{ startX: number; startZ: number } | null>(null);
  const zoneDragEndRef = useRef<{ x: number; z: number } | null>(null);

  const [, forceRender] = useState(0);
  const kick = () => forceRender((n) => n + 1);

  const [terrainStatus, setTerrainStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Keep refs in sync
  botsRef.current = bots;
  playersRef.current = players;
  squadsRef.current = squads;
  missionsRef.current = missions;
  markersRef.current = markers;
  zonesRef.current = zones;
  activeBuildRef.current = activeBuild;
  interactionModeRef.current = interactionMode;

  // Close context menu on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        if (interactionModeRef.current !== 'pan') {
          useMapStore.getState().setInteractionMode('pan');
          kick();
        }
      }
      if (e.key === 'm' || e.key === 'M') {
        if (!editingMarkerId && !editingZoneId) {
          const mode = interactionModeRef.current === 'marker' ? 'pan' : 'marker';
          useMapStore.getState().setInteractionMode(mode);
          kick();
        }
      }
      if (e.key === 'z' || e.key === 'Z') {
        if (!editingMarkerId && !editingZoneId) {
          const mode = interactionModeRef.current === 'zone' ? 'pan' : 'zone';
          useMapStore.getState().setInteractionMode(mode);
          kick();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingMarkerId, editingZoneId]);

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

  // Helper: screen coords from world coords
  const worldToScreen = (wx: number, wz: number, cx: number, cy: number, scale: number, offset: { x: number; y: number }) => ({
    sx: cx + wx * scale + offset.x,
    sy: cy + wz * scale + offset.y,
  });

  // Helper: world coords from screen coords
  const screenToWorld = (sx: number, sy: number, cx: number, cy: number, scale: number, offset: { x: number; y: number }) => ({
    wx: (sx - cx - offset.x) / scale,
    wz: (sy - cy - offset.y) / scale,
  });

  // Main draw loop
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
      const show = showRef.current;
      const currentBots = botsRef.current;
      const currentPlayers = playersRef.current;
      const hovered = hoveredRef.current;
      const selected = selectedRef.current;
      const currentSquads = squadsRef.current;
      const currentMissions = missionsRef.current;
      const currentMarkers = markersRef.current;
      const currentZones = zonesRef.current;
      const currentBuild = activeBuildRef.current;
      const mode = interactionModeRef.current;
      const mouseWorld = mouseWorldRef.current;

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

      // Draw zones
      if (show.zones) {
        for (const zone of currentZones) {
          const color = ZONE_COLORS[zone.mode] ?? '#8B5CF6';
          const r = zone.rect;
          const tl = worldToScreen(r.minX, r.minZ, cx, cy, scale, offset);
          const br = worldToScreen(r.maxX, r.maxZ, cx, cy, scale, offset);
          const zw = br.sx - tl.sx;
          const zh = br.sy - tl.sy;

          ctx.fillStyle = color + '15';
          ctx.fillRect(tl.sx, tl.sy, zw, zh);
          ctx.strokeStyle = color + '60';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(tl.sx, tl.sy, zw, zh);
          ctx.setLineDash([]);

          ctx.save();
          ctx.fillStyle = color + 'B0';
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(`${zone.name} [${zone.mode}]`, tl.sx + 4, tl.sy + 12);
          ctx.restore();
        }
      }

      // Draw zone preview while dragging
      if (mode === 'zone' && zoneDragRef.current && zoneDragEndRef.current) {
        const s = zoneDragRef.current;
        const e = zoneDragEndRef.current;
        const tl = worldToScreen(Math.min(s.startX, e.x), Math.min(s.startZ, e.z), cx, cy, scale, offset);
        const br = worldToScreen(Math.max(s.startX, e.x), Math.max(s.startZ, e.z), cx, cy, scale, offset);
        ctx.fillStyle = '#8B5CF620';
        ctx.fillRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
        ctx.strokeStyle = '#8B5CF680';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
        ctx.setLineDash([]);
      }

      // Build site overlay
      if (show.buildSite && currentBuild) {
        const b = currentBuild;
        const tl = worldToScreen(b.origin.x, b.origin.z, cx, cy, scale, offset);
        const br = worldToScreen(b.origin.x + b.dimensions.width, b.origin.z + b.dimensions.depth, cx, cy, scale, offset);
        const bw = br.sx - tl.sx;
        const bh = br.sy - tl.sy;

        ctx.fillStyle = '#1ABC9C18';
        ctx.fillRect(tl.sx, tl.sy, bw, bh);
        ctx.strokeStyle = '#1ABC9C80';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(tl.sx, tl.sy, bw, bh);
        ctx.setLineDash([]);

        // Progress bar if available
        if (b.progress != null) {
          const barW = Math.max(bw, 60);
          const barX = tl.sx + (bw - barW) / 2;
          const barY = tl.sy - 10;
          ctx.fillStyle = '#00000060';
          ctx.fillRect(barX, barY, barW, 6);
          ctx.fillStyle = '#1ABC9C90';
          ctx.fillRect(barX, barY, barW * b.progress, 6);
        }

        ctx.save();
        ctx.fillStyle = '#1ABC9CE0';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 3;
        ctx.fillText(`Build: ${b.schematicName}`, tl.sx + bw / 2, tl.sy - 16);
        ctx.restore();
      }

      // Draw markers
      if (show.markers) {
        for (const marker of currentMarkers) {
          const { sx, sy } = worldToScreen(marker.position.x, marker.position.z, cx, cy, scale, offset);
          if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;

          const icon = MARKER_ICONS[marker.kind] ?? '\u2605';
          const markerColor = marker.kind === 'base' ? '#F59E0B' : marker.kind === 'storage' ? '#3B82F6' : marker.kind === 'mine' ? '#D97706' : marker.kind === 'build-site' ? '#1ABC9C' : '#8B5CF6';

          // Marker diamond shape
          ctx.save();
          ctx.shadowColor = '#000';
          ctx.shadowBlur = 3;
          ctx.beginPath();
          ctx.moveTo(sx, sy - 8);
          ctx.lineTo(sx + 6, sy);
          ctx.lineTo(sx, sy + 8);
          ctx.lineTo(sx - 6, sy);
          ctx.closePath();
          ctx.fillStyle = markerColor;
          ctx.fill();
          ctx.strokeStyle = '#ffffffA0';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();

          // Icon
          ctx.save();
          ctx.fillStyle = '#fff';
          ctx.font = '9px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(icon, sx, sy);
          ctx.restore();

          // Label
          ctx.save();
          ctx.shadowColor = '#000';
          ctx.shadowBlur = 3;
          ctx.fillStyle = '#ffffffC0';
          ctx.font = '9px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(marker.name, sx, sy - 12);
          ctx.restore();
        }
      }

      // Marker preview at cursor in marker mode
      if (mode === 'marker' && mouseWorld) {
        const { sx, sy } = worldToScreen(mouseWorld.x, mouseWorld.z, cx, cy, scale, offset);
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 8);
        ctx.lineTo(sx + 6, sy);
        ctx.lineTo(sx, sy + 8);
        ctx.lineTo(sx - 6, sy);
        ctx.closePath();
        ctx.fillStyle = '#F59E0B';
        ctx.fill();
        ctx.strokeStyle = '#ffffffA0';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#fff';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(mouseWorld.x)}, ${Math.round(mouseWorld.z)}`, sx, sy - 12);
        ctx.restore();
      }

      // Collect entities
      const entities: MapEntity[] = [];
      const drawnNames = new Set<string>();
      if (show.bots) {
        for (const bot of currentBots) {
          if (!bot.position) continue;
          drawnNames.add(bot.name.toLowerCase());
          entities.push({ name: bot.name, x: bot.position.x, z: bot.position.z, color: getPersonalityColor(bot.personality), type: 'bot', state: bot.state, personality: bot.personality });
        }
      }
      if (show.players) {
        for (const player of currentPlayers) {
          if (!player.isOnline || !player.position || drawnNames.has(player.name.toLowerCase())) continue;
          entities.push({ name: player.name, x: player.position.x, z: player.position.z, color: PLAYER_COLOR, type: 'player' });
        }
      }

      // Squad overlays
      if (show.squads && currentSquads.length > 0) {
        for (const squad of currentSquads) {
          const squadBots = entities.filter((e) =>
            e.type === 'bot' && squad.botNames.some((n) => n.toLowerCase() === e.name.toLowerCase()),
          );
          if (squadBots.length < 1) continue;

          const color = squadColor(squad.name);

          // Compute group center
          let sumX = 0, sumZ = 0;
          for (const b of squadBots) { sumX += b.x; sumZ += b.z; }
          const groupCX = sumX / squadBots.length;
          const groupCZ = sumZ / squadBots.length;

          // Draw connecting lines between squad members
          if (squadBots.length >= 2) {
            ctx.save();
            ctx.strokeStyle = color + '35';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            for (let i = 0; i < squadBots.length; i++) {
              for (let j = i + 1; j < squadBots.length; j++) {
                const a = worldToScreen(squadBots[i].x, squadBots[i].z, cx, cy, scale, offset);
                const b2 = worldToScreen(squadBots[j].x, squadBots[j].z, cx, cy, scale, offset);
                ctx.beginPath();
                ctx.moveTo(a.sx, a.sy);
                ctx.lineTo(b2.sx, b2.sy);
                ctx.stroke();
              }
            }
            ctx.setLineDash([]);
            ctx.restore();
          }

          // Squad name label near group center
          const gc = worldToScreen(groupCX, groupCZ, cx, cy, scale, offset);
          ctx.save();
          ctx.shadowColor = '#000';
          ctx.shadowBlur = 4;
          const labelText = squad.name;
          ctx.font = 'bold 10px system-ui, sans-serif';
          const tw = ctx.measureText(labelText).width;
          ctx.fillStyle = '#000000A0';
          ctx.fillRect(gc.sx - tw / 2 - 4, gc.sy - 22, tw + 8, 14);
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.fillText(labelText, gc.sx, gc.sy - 12);
          ctx.restore();
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

      // Build bot-mission lookup for badges
      const botMissions = new Map<string, string>();
      if (show.missions) {
        for (const m of currentMissions) {
          if (m.status !== 'running') continue;
          for (const aid of m.assigneeIds) {
            botMissions.set(aid.toLowerCase(), MISSION_LABELS[m.type] ?? m.type);
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

        // Mission status ring for bots on active missions
        const missionLabel = botMissions.get(entity.name.toLowerCase());
        if (entity.type === 'bot' && missionLabel) {
          ctx.beginPath();
          ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = '#10B981A0';
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (entity.type === 'bot' && entity.state && !['IDLE', 'DISCONNECTED'].includes(entity.state)) {
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

        // Mission badge
        if (missionLabel) {
          ctx.save();
          ctx.shadowColor = '#000';
          ctx.shadowBlur = 2;
          const badgeW = ctx.measureText(missionLabel).width || 20;
          ctx.font = '8px system-ui, sans-serif';
          const measuredW = ctx.measureText(missionLabel).width;
          ctx.fillStyle = '#10B98140';
          ctx.fillRect(sx + r + 2, sy - 5, measuredW + 6, 11);
          ctx.fillStyle = '#10B981';
          ctx.textAlign = 'left';
          ctx.fillText(missionLabel, sx + r + 5, sy + 3);
          // suppress unused warning
          void badgeW;
          ctx.restore();
        }

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

      // Mode indicator
      if (mode !== 'pan') {
        const modeLabel = mode === 'marker' ? 'MARKER MODE (M)' : 'ZONE MODE (Z)';
        ctx.save();
        ctx.fillStyle = '#F59E0B30';
        ctx.fillRect(w / 2 - 70, 8, 140, 22);
        ctx.fillStyle = '#F59E0B';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(modeLabel, w / 2, 23);
        ctx.restore();
      }

      animFrame = requestAnimationFrame(draw);
    };

    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
  }, []);

  // Convert screen to world helper (outside draw loop)
  const screenToWorldCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const w = rect.width;
    const h = rect.height;
    const cxc = w / 2;
    const cyc = h / 2;
    return screenToWorld(mx, my, cxc, cyc, scaleRef.current, offsetRef.current);
  };

  // Input handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setContextMenu(null);

    if (e.button === 2) return; // handled by context menu

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const mode = interactionModeRef.current;

    // Marker placement mode
    if (mode === 'marker') {
      const world = screenToWorldCoords(e.clientX, e.clientY);
      if (world) {
        const id = generateId();
        const marker: MapMarker = {
          id,
          name: 'New Marker',
          kind: 'custom',
          position: { x: Math.round(world.wx), y: 64, z: Math.round(world.wz) },
          tags: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        useMapStore.getState().addMarker(marker);
        useMapStore.getState().setEditingMarkerId(id);
        useMapStore.getState().setInteractionMode('pan');
        kick();
      }
      return;
    }

    // Zone drawing mode
    if (mode === 'zone') {
      const world = screenToWorldCoords(e.clientX, e.clientY);
      if (world) {
        zoneDragRef.current = { startX: Math.round(world.wx), startZ: Math.round(world.wz) };
        zoneDragEndRef.current = { x: Math.round(world.wx), z: Math.round(world.wz) };
      }
      return;
    }

    // Entity selection
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
    // Update world position for marker preview
    const world = screenToWorldCoords(e.clientX, e.clientY);
    if (world) {
      mouseWorldRef.current = { x: world.wx, z: world.wz };
    }

    // Zone drag
    if (interactionModeRef.current === 'zone' && zoneDragRef.current) {
      if (world) {
        zoneDragEndRef.current = { x: Math.round(world.wx), z: Math.round(world.wz) };
      }
      return;
    }

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
    // Finish zone drawing
    if (interactionModeRef.current === 'zone' && zoneDragRef.current && zoneDragEndRef.current) {
      const s = zoneDragRef.current;
      const e = zoneDragEndRef.current;
      const minX = Math.min(s.startX, e.x);
      const minZ = Math.min(s.startZ, e.z);
      const maxX = Math.max(s.startX, e.x);
      const maxZ = Math.max(s.startZ, e.z);

      // Only create if dragged at least a few blocks
      if (Math.abs(maxX - minX) > 2 || Math.abs(maxZ - minZ) > 2) {
        const id = generateId();
        const zone: MapZone = {
          id,
          name: 'New Zone',
          mode: 'custom',
          rect: { minX, minZ, maxX, maxZ },
        };
        useMapStore.getState().addZone(zone);
        useMapStore.getState().setEditingZoneId(id);
        useMapStore.getState().setInteractionMode('pan');
      }

      zoneDragRef.current = null;
      zoneDragEndRef.current = null;
      kick();
      return;
    }

    if (draggingRef.current) {
      draggingRef.current = false;
      if (showRef.current.terrain) {
        const viewCenterX = -offsetRef.current.x / scaleRef.current;
        const viewCenterZ = -offsetRef.current.y / scaleRef.current;
        loadTerrain(viewCenterX, viewCenterZ);
      }
      kick();
    }
  };

  // Context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const world = screenToWorldCoords(e.clientX, e.clientY);
    if (!world) return;

    // Check if right-clicked on an entity
    let entityName: string | undefined;
    for (const [name, pos] of entityPositions.current) {
      const dx = mx - pos.sx;
      const dy = my - pos.sy;
      if (dx * dx + dy * dy < pos.radius * pos.radius) { entityName = name; break; }
    }

    // Clamp to viewport
    const menuW = 200;
    const menuH = 220;
    const clampedX = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const clampedY = Math.min(e.clientY, window.innerHeight - menuH - 8);

    setContextMenu({
      x: clampedX,
      y: clampedY,
      worldX: Math.round(world.wx),
      worldZ: Math.round(world.wz),
      entityName,
    });
  };

  // Zoom
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

  const cursorClass = interactionMode === 'marker'
    ? 'cursor-crosshair'
    : interactionMode === 'zone'
      ? 'cursor-crosshair'
      : draggingRef.current
        ? 'cursor-grabbing'
        : hoveredRef.current
          ? 'cursor-pointer'
          : 'cursor-grab';

  // Editing marker
  const editingMarker = editingMarkerId ? markers.find((m) => m.id === editingMarkerId) : null;
  const editingZone = editingZoneId ? zones.find((z) => z.id === editingZoneId) : null;

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
            <ToggleBtn active={show.squads} onClick={() => toggleShow('squads')} label="Squads" color="#F59E0B" />
            <ToggleBtn active={show.missions} onClick={() => toggleShow('missions')} label="Missions" color="#10B981" />
            <ToggleBtn active={show.zones} onClick={() => toggleShow('zones')} label="Zones" color="#8B5CF6" />
            <ToggleBtn active={show.markers} onClick={() => toggleShow('markers')} label="Markers" color="#F59E0B" />
            <ToggleBtn active={show.buildSite} onClick={() => toggleShow('buildSite')} label="Build" color="#1ABC9C" />
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
          {/* Drawing tools */}
          <button
            onClick={() => {
              const next: MapInteractionMode = interactionMode === 'marker' ? 'pan' : 'marker';
              useMapStore.getState().setInteractionMode(next);
              kick();
            }}
            className={`w-7 h-7 flex items-center justify-center rounded text-xs transition-colors ${interactionMode === 'marker' ? 'bg-amber-700/50 text-amber-300' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'}`}
            title="Place marker (M)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
          </button>
          <button
            onClick={() => {
              const next: MapInteractionMode = interactionMode === 'zone' ? 'pan' : 'zone';
              useMapStore.getState().setInteractionMode(next);
              kick();
            }}
            className={`w-7 h-7 flex items-center justify-center rounded text-xs transition-colors ${interactionMode === 'zone' ? 'bg-purple-700/50 text-purple-300' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'}`}
            title="Draw zone (Z)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
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

            {/* Squads section in sidebar */}
            {squads.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 mt-4">
                  Squads ({squads.length})
                </p>
                <div className="space-y-0.5">
                  {squads.map((squad) => (
                    <div key={squad.id} className="px-2 py-1.5 rounded-md">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: squadColor(squad.name) }} />
                        <p className="text-[11px] font-medium text-zinc-300 truncate">{squad.name}</p>
                        <span className="text-[9px] text-zinc-600 ml-auto">{squad.botNames.length}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Markers section in sidebar */}
            {markers.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 mt-4">
                  Markers ({markers.length})
                </p>
                <div className="space-y-0.5">
                  {markers.map((marker) => (
                    <button
                      key={marker.id}
                      onClick={() => centerOn(marker.position.x, marker.position.z)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-zinc-800/50 transition-colors"
                    >
                      <span className="text-[10px]">{MARKER_ICONS[marker.kind] ?? '\u2605'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-zinc-300 truncate">{marker.name}</p>
                        <p className="text-[9px] text-zinc-600 font-mono">{marker.position.x}, {marker.position.z}</p>
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
          className={`flex-1 relative ${cursorClass}`}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { handleMouseUp(); hoveredRef.current = null; mouseWorldRef.current = null; }}
            onContextMenu={handleContextMenu}
            className="w-full h-full"
          />

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-zinc-900/90 backdrop-blur-sm border border-zinc-800/60 rounded-lg p-3 text-[10px]">
            <p className="text-zinc-500 font-semibold uppercase tracking-wider mb-2">Legend</p>
            <div className="space-y-1.5">
              <LegendItem shape="circle" color="#6B7280" label="Bot" />
              <LegendItem shape="square" color="#60A5FA" label="Player" />
              {show.squads && <LegendItem shape="square" color="#F59E0B" label="Squad link" />}
              {show.missions && <LegendItem shape="circle" color="#10B981" label="On mission" />}
              {show.buildSite && activeBuild && <LegendItem shape="square" color="#1ABC9C" label="Build site" />}
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

          {/* Context Menu */}
          {contextMenu && (
            <ContextMenu
              menu={contextMenu}
              onClose={() => setContextMenu(null)}
              onPlaceMarker={(wx, wz) => {
                const id = generateId();
                const marker: MapMarker = {
                  id,
                  name: 'New Marker',
                  kind: 'custom',
                  position: { x: wx, y: 64, z: wz },
                  tags: [],
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                };
                useMapStore.getState().addMarker(marker);
                useMapStore.getState().setEditingMarkerId(id);
                setContextMenu(null);
                kick();
              }}
              onSetBase={(wx, wz) => {
                const id = generateId();
                const marker: MapMarker = {
                  id,
                  name: 'Base',
                  kind: 'base',
                  position: { x: wx, y: 64, z: wz },
                  tags: ['base'],
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                };
                useMapStore.getState().addMarker(marker);
                setContextMenu(null);
                kick();
              }}
              onCenterHere={(wx, wz) => {
                centerOn(wx, wz);
                setContextMenu(null);
              }}
              onWalkTo={(wx, wz, botName) => {
                if (botName) {
                  api.walkTo(botName, wx, 64, wz).catch(() => {});
                }
                setContextMenu(null);
              }}
            />
          )}

          {/* Marker Editor */}
          {editingMarker && (
            <MarkerEditor
              marker={editingMarker}
              onSave={(patch) => {
                useMapStore.getState().updateMarker(editingMarker.id, patch);
                useMapStore.getState().setEditingMarkerId(null);
                kick();
              }}
              onDelete={() => {
                useMapStore.getState().removeMarker(editingMarker.id);
                useMapStore.getState().setEditingMarkerId(null);
                kick();
              }}
              onClose={() => {
                useMapStore.getState().setEditingMarkerId(null);
                kick();
              }}
            />
          )}

          {/* Zone Editor */}
          {editingZone && (
            <ZoneEditor
              zone={editingZone}
              onSave={(patch) => {
                useMapStore.getState().updateZone(editingZone.id, patch);
                useMapStore.getState().setEditingZoneId(null);
                kick();
              }}
              onDelete={() => {
                useMapStore.getState().removeZone(editingZone.id);
                useMapStore.getState().setEditingZoneId(null);
                kick();
              }}
              onClose={() => {
                useMapStore.getState().setEditingZoneId(null);
                kick();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Sub-components --- */

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

function ContextMenu({
  menu,
  onClose,
  onPlaceMarker,
  onSetBase,
  onCenterHere,
  onWalkTo,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onPlaceMarker: (x: number, z: number) => void;
  onSetBase: (x: number, z: number) => void;
  onCenterHere: (x: number, z: number) => void;
  onWalkTo: (x: number, z: number, botName?: string) => void;
}) {
  return (
    <div
      className="fixed z-50 bg-zinc-900 border border-zinc-700/80 rounded-lg shadow-xl py-1 min-w-[180px] text-[11px]"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 text-zinc-500 font-mono text-[10px] border-b border-zinc-800/60">
        {menu.worldX}, {menu.worldZ}
        {menu.entityName && <span className="ml-2 text-zinc-400">({menu.entityName})</span>}
      </div>
      <ContextMenuItem label="Center here" hint="" onClick={() => onCenterHere(menu.worldX, menu.worldZ)} />
      <ContextMenuItem label="Place marker" hint="M" onClick={() => onPlaceMarker(menu.worldX, menu.worldZ)} />
      <ContextMenuItem label="Set as Base" hint="" onClick={() => onSetBase(menu.worldX, menu.worldZ)} />
      {menu.entityName && (
        <ContextMenuItem label={`Walk ${menu.entityName} here`} hint="" onClick={() => onWalkTo(menu.worldX, menu.worldZ, menu.entityName)} />
      )}
      <div className="border-t border-zinc-800/60 my-1" />
      <ContextMenuItem label="Close" hint="Esc" onClick={onClose} />
    </div>
  );
}

function ContextMenuItem({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-zinc-800 text-zinc-300 transition-colors text-left"
    >
      <span>{label}</span>
      {hint && <span className="text-zinc-600 text-[9px] font-mono ml-4">{hint}</span>}
    </button>
  );
}

function MarkerEditor({
  marker,
  onSave,
  onDelete,
  onClose,
}: {
  marker: MapMarker;
  onSave: (patch: Partial<MapMarker>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(marker.name);
  const [kind, setKind] = useState(marker.kind);

  return (
    <div className="absolute top-4 right-4 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/80 rounded-lg shadow-xl p-4 w-64 z-40">
      <h3 className="text-xs font-bold text-white mb-3">Edit Marker</h3>
      <div className="space-y-2">
        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            autoFocus
          />
        </div>
        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Kind</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as MapMarker['kind'])}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="base">Base</option>
            <option value="storage">Storage</option>
            <option value="build-site">Build Site</option>
            <option value="mine">Mine</option>
            <option value="village">Village</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="text-[10px] text-zinc-500">
          Position: {marker.position.x}, {marker.position.y}, {marker.position.z}
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onSave({ name, kind, updatedAt: Date.now() })}
          className="flex-1 bg-emerald-700/60 hover:bg-emerald-700/80 text-emerald-200 text-[10px] py-1.5 rounded transition-colors"
        >
          Save
        </button>
        <button
          onClick={onDelete}
          className="bg-red-800/40 hover:bg-red-800/60 text-red-300 text-[10px] py-1.5 px-3 rounded transition-colors"
        >
          Delete
        </button>
        <button
          onClick={onClose}
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-[10px] py-1.5 px-3 rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ZoneEditor({
  zone,
  onSave,
  onDelete,
  onClose,
}: {
  zone: MapZone;
  onSave: (patch: Partial<MapZone>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(zone.name);
  const [mode, setMode] = useState<ZoneMode>(zone.mode);

  return (
    <div className="absolute top-4 right-4 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/80 rounded-lg shadow-xl p-4 w-64 z-40">
      <h3 className="text-xs font-bold text-white mb-3">Edit Zone</h3>
      <div className="space-y-2">
        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            autoFocus
          />
        </div>
        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ZoneMode)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="guard">Guard</option>
            <option value="avoid">Avoid</option>
            <option value="farm">Farm</option>
            <option value="build">Build</option>
            <option value="gather">Gather</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="text-[10px] text-zinc-500">
          Area: ({zone.rect.minX}, {zone.rect.minZ}) to ({zone.rect.maxX}, {zone.rect.maxZ})
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onSave({ name, mode })}
          className="flex-1 bg-emerald-700/60 hover:bg-emerald-700/80 text-emerald-200 text-[10px] py-1.5 rounded transition-colors"
        >
          Save
        </button>
        <button
          onClick={onDelete}
          className="bg-red-800/40 hover:bg-red-800/60 text-red-300 text-[10px] py-1.5 px-3 rounded transition-colors"
        >
          Delete
        </button>
        <button
          onClick={onClose}
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-[10px] py-1.5 px-3 rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
