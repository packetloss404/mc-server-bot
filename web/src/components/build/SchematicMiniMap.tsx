'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useBotStore, useWorldStore, useSchematicPlacementStore } from '@/lib/store';
import { api, type SchematicInfo } from '@/lib/api';
import { drawSchematicFootprint, TERRAIN_RADIUS, TERRAIN_STEP } from '@/components/map/mapDrawing';
import { getBlockColor } from '@/lib/blockColors';
import { getPersonalityColor, PLAYER_COLOR } from '@/lib/constants';

const MIN_SCALE = 0.5;
const MAX_SCALE = 10;
const ZOOM_SENSITIVITY = 0.002;

interface Props {
  schematic: SchematicInfo;
  origin: { x: number; y: number; z: number };
  onOriginChange: (origin: { x: number; y: number; z: number }) => void;
  height?: number;
}

export function SchematicMiniMap({ schematic, origin, onOriginChange, height = 300 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bots = useBotStore((s) => s.botList);
  const players = useBotStore((s) => s.playerList);
  const markers = useWorldStore((s) => s.markers);

  // Refs for rAF loop
  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(2);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const cursorWorldRef = useRef<{ x: number; z: number } | null>(null);
  const botsRef = useRef(bots);
  const playersRef = useRef(players);
  const markersRef = useRef(markers);
  const originRef = useRef(origin);
  const schematicRef = useRef(schematic);
  const placedRef = useRef<{ x: number; z: number } | null>(null);
  const initializedRef = useRef(false);

  // Terrain
  const terrainCanvas = useRef<OffscreenCanvas | null>(null);
  const terrainMeta = useRef<{ cx: number; cz: number; radius: number } | null>(null);
  const [terrainStatus, setTerrainStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  // Sync refs
  useEffect(() => { botsRef.current = bots; }, [bots]);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { markersRef.current = markers; }, [markers]);
  useEffect(() => { originRef.current = origin; }, [origin]);
  useEffect(() => { schematicRef.current = schematic; }, [schematic]);

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

  // Center on origin and load terrain
  useEffect(() => {
    if (initializedRef.current) return;
    offsetRef.current = { x: -origin.x * scaleRef.current, y: -origin.z * scaleRef.current };
    initializedRef.current = true;
    const timeout = window.setTimeout(() => {
      void loadTerrain(origin.x, origin.z);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [origin, loadTerrain]);

  // Draw loop
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
      const cx = w / 2;
      const cy = h / 2;

      // Background
      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, w, h);

      // Terrain
      if (terrainCanvas.current && terrainMeta.current) {
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
      const gridSize = 16 * scale;
      if (gridSize > 4) {
        ctx.strokeStyle = terrainCanvas.current ? '#00000030' : '#ffffff12';
        ctx.lineWidth = 1;
        const startX = ((cx + offset.x) % gridSize + gridSize) % gridSize;
        const startY = ((cy + offset.y) % gridSize + gridSize) % gridSize;
        for (let x = startX; x < w; x += gridSize) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = startY; y < h; y += gridSize) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
      }

      // Markers
      for (const marker of markersRef.current) {
        if (!marker.position) continue;
        const sx = cx + marker.position.x * scale + offset.x;
        const sy = cy + marker.position.z * scale + offset.y;
        if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
        ctx.fillStyle = '#10B981';
        const sz = 4;
        ctx.beginPath();
        ctx.moveTo(sx, sy - sz); ctx.lineTo(sx + sz, sy); ctx.lineTo(sx, sy + sz); ctx.lineTo(sx - sz, sy);
        ctx.closePath(); ctx.fill();
        if (marker.name) {
          ctx.fillStyle = '#ffffff80';
          ctx.font = '9px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(marker.name, sx, sy - sz - 3);
        }
      }

      // Bot/player dots
      for (const bot of botsRef.current) {
        if (!bot.position) continue;
        const sx = cx + bot.position.x * scale + offset.x;
        const sy = cy + bot.position.z * scale + offset.y;
        if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
        ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fillStyle = getPersonalityColor(bot.personality);
        ctx.fill();
        ctx.strokeStyle = '#ffffffb0'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(bot.name, sx, sy - 8);
      }
      for (const p of playersRef.current) {
        if (!p.isOnline || !p.position) continue;
        const sx = cx + p.position.x * scale + offset.x;
        const sy = cy + p.position.z * scale + offset.y;
        if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
        const half = 3;
        ctx.fillStyle = PLAYER_COLOR;
        ctx.fillRect(sx - half, sy - half, half * 2, half * 2);
      }

      // Schematic footprint — placed
      const sch = schematicRef.current;
      if (placedRef.current) {
        drawSchematicFootprint(ctx, cx, cy, scale, offset, placedRef.current, sch.size.x, sch.size.z, 'placed');
      }

      // Schematic footprint — preview following cursor
      const cursor = cursorWorldRef.current;
      if (cursor && !draggingRef.current) {
        const snapped = { x: Math.floor(cursor.x), z: Math.floor(cursor.z) };
        drawSchematicFootprint(ctx, cx, cy, scale, offset, snapped, sch.size.x, sch.size.z, 'preview');
      }

      // HUD
      ctx.fillStyle = '#00000080'; ctx.fillRect(8, h - 24, 110, 18);
      ctx.fillStyle = '#ffffff70'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`${scale.toFixed(1)}x  Click to place`, 12, h - 11);

      animFrame = requestAnimationFrame(draw);
    };

    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
  }, []);

  // Screen → world conversion
  const screenToWorld = (clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const worldX = (mx - cx - offsetRef.current.x) / scaleRef.current;
    const worldZ = (my - cy - offsetRef.current.y) / scaleRef.current;
    return { x: worldX, z: worldZ };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    draggingRef.current = true;
    dragStartRef.current = { x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingRef.current) {
      offsetRef.current = { x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y };
      return;
    }
    const world = screenToWorld(e.clientX, e.clientY);
    if (world) cursorWorldRef.current = world;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (draggingRef.current) {
      // Only treat as click if barely moved
      const dx = Math.abs(e.clientX - (dragStartRef.current.x + offsetRef.current.x));
      const dy = Math.abs(e.clientY - (dragStartRef.current.y + offsetRef.current.y));
      draggingRef.current = false;
      if (dx < 3 && dy < 3) {
        // This was a click, not a drag — place the schematic
        const world = screenToWorld(e.clientX, e.clientY);
        if (world) {
          const snapped = { x: Math.floor(world.x), z: Math.floor(world.z) };
          placedRef.current = snapped;
          onOriginChange({ x: snapped.x, y: originRef.current.y, z: snapped.z });
          useSchematicPlacementStore.getState().setPlacedOrigin({ x: snapped.x, y: originRef.current.y, z: snapped.z });
        }
      } else {
        // Drag ended — reload terrain if needed
        const viewCenterX = -offsetRef.current.x / scaleRef.current;
        const viewCenterZ = -offsetRef.current.y / scaleRef.current;
        loadTerrain(viewCenterX, viewCenterZ);
      }
    }
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
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  // When origin changes externally (from coord inputs), update placed ref and recenter
  useEffect(() => {
    placedRef.current = { x: origin.x, z: origin.z };
    useSchematicPlacementStore.getState().setPlacedOrigin(origin);
  }, [origin]);

  return (
    <div className="relative rounded-lg overflow-hidden border border-zinc-700/50 bg-zinc-950" style={{ height }}>
      <div
        ref={containerRef}
        className="w-full h-full cursor-crosshair"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { draggingRef.current = false; cursorWorldRef.current = null; }}
          className="w-full h-full"
        />
      </div>
      {terrainStatus === 'loading' && (
        <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] text-zinc-500">
          <span className="w-3 h-3 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
          Loading terrain...
        </div>
      )}
      <div className="absolute bottom-2 right-2 text-[9px] text-zinc-600">
        Scroll to zoom  |  Drag to pan  |  Click to place
      </div>
    </div>
  );
}
