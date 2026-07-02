/**
 * Terrain read endpoints, extracted from the createAPIServer god-function
 * (review: api.ts decomposition). Read-only; only needs BotManager to pick a
 * connected probe bot. Registered from createAPIServer via
 * registerTerrainRoutes(app, { botManager }).
 */
import type { Express, Request, Response } from 'express';
import type { BotManager } from '../../bot/BotManager';

export function registerTerrainRoutes(app: Express, deps: { botManager: BotManager }): void {
  const { botManager } = deps;

  // Pick the connected bot closest to (x, z). A probe outside view distance
  // reads every block as air (bot.blockAt returns null → treated as air), so a
  // far-away probe silently reports empty/wrong terrain. Falls back to the first
  // connected bot when no handle exposes a cached position.
  const nearestProbe = async (x: number, z: number): Promise<any | null> => {
    let probeHandle: any = null;
    let bestDist = Infinity;
    for (const h of botManager.getAllWorkers() as any[]) {
      if (typeof h.isBotConnected !== 'function') continue;
      if (!(await h.isBotConnected())) continue;
      const pos = h.getCachedStatus?.()?.position;
      if (!pos) { if (probeHandle === null) probeHandle = h; continue; }
      const d = Math.hypot(pos.x - x, pos.z - z);
      if (d < bestDist) { bestDist = d; probeHandle = h; }
    }
    return probeHandle;
  };

  // Height-map probe around (cx, cz). Returns the top non-air block at each grid
  // cell as a flat array, matching the TerrainData frontend shape.
  app.get('/api/terrain', async (req: Request, res: Response) => {
    const cx = parseInt(String(req.query.cx ?? req.query.x ?? '0'));
    const cz = parseInt(String(req.query.cz ?? req.query.z ?? '0'));
    const radius = Math.min(parseInt(String(req.query.radius ?? '16')), 64);
    const step = Math.max(parseInt(String(req.query.step ?? '1')), 1);

    const probeHandle = await nearestProbe(cx, cz);
    if (!probeHandle) {
      res.status(503).json({ error: 'No connected bot available to scan terrain' });
      return;
    }

    const size = Math.floor((2 * radius) / step) + 1;
    // Single IPC call — the worker iterates the grid internally for speed.
    const blocks = (await probeHandle.getTerrainGrid(cx, cz, radius, step, 120, -60)) ?? [];
    res.json({ cx, cz, radius, step, size, blocks });
  });

  // Terrain height at a specific (x, z) column.
  app.get('/api/terrain/height', async (req: Request, res: Response) => {
    const x = parseInt(String(req.query.x ?? '0'));
    const z = parseInt(String(req.query.z ?? '0'));
    const maxY = parseInt(String(req.query.maxY ?? '320'));
    const minY = parseInt(String(req.query.minY ?? '-64'));

    // bot.blockAt() returns null for chunks outside view distance, so the probe
    // must be the bot closest to (x, z) or the scan misses the surface entirely.
    const probeHandle = await nearestProbe(x, z);
    if (!probeHandle) {
      res.status(503).json({ error: 'No connected bot available to scan terrain' });
      return;
    }

    for (let y = maxY; y >= minY; y--) {
      const block = await probeHandle.getBlockAt(x, y, z);
      if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
        res.json({ x, z, height: y, surfaceBlock: block.name });
        return;
      }
    }
    res.json({ x, z, height: null, surfaceBlock: null });
  });
}
