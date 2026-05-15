'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type TerrainData } from '@/lib/api';

interface Props {
  centerX: number;
  centerZ: number;
  radius: number;
  schematicSize: { x: number; z: number };
  onPick: (origin: { x: number; z: number; y: number | null }) => void;
}

const CANVAS_SIZE = 480;

type Category = 'water' | 'sand' | 'grass' | 'stone' | 'wood' | 'lava' | 'other';

const CATEGORY_COLORS: Record<Category, string> = {
  water: '#3366CC',
  sand: '#DBCFA0',
  grass: '#5B8C33',
  stone: '#7F7F7F',
  wood: '#2E5E2E',
  lava: '#CC4400',
  other: '#4A4A52',
};

const CATEGORY_LABELS: Record<Category, string> = {
  water: 'Water',
  sand: 'Sand/Gravel',
  grass: 'Grass/Dirt',
  stone: 'Stone',
  wood: 'Logs/Leaves',
  lava: 'Lava',
  other: 'Other',
};

function categorize(blockName: string): Category {
  if (!blockName) return 'other';
  const n = blockName.toLowerCase();
  if (n.includes('water') || n.includes('kelp') || n.includes('seagrass')) return 'water';
  if (n.includes('lava') || n.includes('magma')) return 'lava';
  if (n.includes('sand') || n.includes('gravel')) return 'sand';
  if (n.includes('log') || n.includes('leaves') || n.includes('wood')) return 'wood';
  if (
    n.includes('grass') ||
    n.includes('dirt') ||
    n.includes('podzol') ||
    n.includes('mycelium') ||
    n.includes('moss') ||
    n.includes('farmland')
  ) {
    return 'grass';
  }
  if (
    n.includes('stone') ||
    n.includes('cobble') ||
    n.includes('deepslate') ||
    n.includes('granite') ||
    n.includes('diorite') ||
    n.includes('andesite') ||
    n.includes('tuff') ||
    n.includes('basalt') ||
    n.includes('bedrock') ||
    n.includes('ore')
  ) {
    return 'stone';
  }
  return 'other';
}

function colorForBlock(blockName: string): string {
  return CATEGORY_COLORS[categorize(blockName)];
}

export function BuildMapPicker({ centerX, centerZ, radius, schematicSize, onPick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hover, setHover] = useState<{ px: number; py: number; worldX: number; worldZ: number; block: string } | null>(null);
  const [picking, setPicking] = useState(false);

  // Normalize bounds: server clamps radius to <= 64
  const effectiveRadius = useMemo(() => Math.max(1, Math.min(64, Math.round(radius))), [radius]);
  const cx = Math.round(centerX);
  const cz = Math.round(centerZ);

  // Fetch terrain once on mount (and re-fetch if inputs change)
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMessage(null);
    api
      .getTerrain(cx, cz, effectiveRadius, 1)
      .then((data) => {
        if (cancelled) return;
        setTerrain(data);
        setStatus('loaded');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load terrain');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [cx, cz, effectiveRadius]);

  // Pre-render terrain to an offscreen canvas, scaled up to CANVAS_SIZE
  const terrainImage = useMemo(() => {
    if (!terrain) return null;
    const size = terrain.size;
    if (size <= 0) return null;
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const octx = off.getContext('2d');
    if (!octx) return null;
    const img = octx.createImageData(size, size);
    for (let i = 0; i < terrain.blocks.length; i++) {
      const color = colorForBlock(terrain.blocks[i]);
      // Parse "#RRGGBB" -> r,g,b
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      const idx = i * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    return off;
  }, [terrain]);

  // Convert between world coords and canvas pixel coords.
  // Terrain spans worldLeft = cx - radius ... cx + radius (size = 2*radius + 1).
  const worldFromPixel = useCallback(
    (px: number, py: number): { worldX: number; worldZ: number } | null => {
      if (!terrain) return null;
      const size = terrain.size;
      const blockX = Math.floor((px / CANVAS_SIZE) * size);
      const blockZ = Math.floor((py / CANVAS_SIZE) * size);
      if (blockX < 0 || blockZ < 0 || blockX >= size || blockZ >= size) return null;
      const worldX = terrain.cx - terrain.radius + blockX;
      const worldZ = terrain.cz - terrain.radius + blockZ;
      return { worldX, worldZ };
    },
    [terrain],
  );

  const blockAtWorld = useCallback(
    (worldX: number, worldZ: number): string => {
      if (!terrain) return '';
      const bx = worldX - (terrain.cx - terrain.radius);
      const bz = worldZ - (terrain.cz - terrain.radius);
      if (bx < 0 || bz < 0 || bx >= terrain.size || bz >= terrain.size) return '';
      return terrain.blocks[bz * terrain.size + bx] ?? '';
    },
    [terrain],
  );

  // Draw loop: terrain image + footprint overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = CANVAS_SIZE * dpr;
    canvas.height = CANVAS_SIZE * dpr;
    canvas.style.width = `${CANVAS_SIZE}px`;
    canvas.style.height = `${CANVAS_SIZE}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Terrain
    if (terrainImage) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(terrainImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }

    // Footprint overlay (follows hover cursor, snapped to block)
    if (hover && terrain) {
      const pixelsPerBlock = CANVAS_SIZE / terrain.size;
      // Anchor footprint top-left to hovered world block
      const blockX = hover.worldX - (terrain.cx - terrain.radius);
      const blockZ = hover.worldZ - (terrain.cz - terrain.radius);
      const px = blockX * pixelsPerBlock;
      const py = blockZ * pixelsPerBlock;
      const w = schematicSize.x * pixelsPerBlock;
      const h = schematicSize.z * pixelsPerBlock;

      ctx.fillStyle = 'rgba(26, 188, 156, 0.30)';
      ctx.fillRect(px, py, w, h);
      ctx.strokeStyle = 'rgba(26, 188, 156, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
    }
  }, [terrain, terrainImage, hover, schematicSize.x, schematicSize.z]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const world = worldFromPixel(px, py);
    if (!world) {
      setHover(null);
      return;
    }
    setHover({
      px,
      py,
      worldX: world.worldX,
      worldZ: world.worldZ,
      block: blockAtWorld(world.worldX, world.worldZ),
    });
  };

  const handleMouseLeave = () => setHover(null);

  const handleClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain || picking) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const world = worldFromPixel(px, py);
    if (!world) return;

    setPicking(true);
    try {
      const data = await api.getTerrainHeight(world.worldX, world.worldZ);
      onPick({ x: world.worldX, z: world.worldZ, y: data.y });
    } catch {
      onPick({ x: world.worldX, z: world.worldZ, y: null });
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative rounded-lg overflow-hidden border border-zinc-700/50 bg-zinc-950"
        style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
      >
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          className="block cursor-crosshair"
          style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
        />

        {/* Loading state */}
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="w-3.5 h-3.5 border-2 border-zinc-700 border-t-zinc-300 rounded-full animate-spin" />
              Loading terrain...
            </div>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center px-4">
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-center">
              {errorMessage ?? 'Failed to load terrain'}
            </p>
          </div>
        )}

        {/* Legend */}
        <div className="absolute top-2 left-2 bg-zinc-900/80 border border-zinc-700/50 rounded-md px-2 py-1.5 backdrop-blur-sm">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">Legend</p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
              <div key={cat} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm border border-black/40"
                  style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                />
                <span className="text-[9px] text-zinc-300">{CATEGORY_LABELS[cat]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tooltip */}
        {hover && status === 'loaded' && (
          <div
            className="pointer-events-none absolute bg-zinc-900/95 border border-zinc-700/60 rounded-md px-2 py-1 text-[10px] font-mono text-zinc-200 shadow-lg whitespace-nowrap"
            style={{
              left: Math.min(hover.px + 12, CANVAS_SIZE - 160),
              top: Math.min(hover.py + 12, CANVAS_SIZE - 40),
            }}
          >
            <div>
              X={hover.worldX}, Z={hover.worldZ}
            </div>
            <div className="text-zinc-400">{hover.block || 'unknown'}</div>
          </div>
        )}

        {/* Hint */}
        <div className="absolute bottom-2 right-2 text-[9px] text-zinc-500 bg-zinc-900/70 rounded px-1.5 py-0.5">
          {picking ? 'Resolving height...' : 'Click to set origin'}
        </div>
      </div>
    </div>
  );
}
