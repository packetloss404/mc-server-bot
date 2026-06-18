/**
 * Build-job + tunnel endpoints, extracted from createAPIServer (review: api.ts
 * decomposition). Single coordinator dep; the build engine handles bot/io/event
 * wiring internally. Registered via registerBuildRoutes(app, { buildCoordinator }).
 */
import type { Express, Request, Response } from 'express';
import type { BuildCoordinator } from '../../build/BuildCoordinator';
import { asyncH, isSafeFilename, sanitizeErrorMessage } from './helpers';
import { logger } from '../../util/logger';

export function registerBuildRoutes(app: Express, deps: { buildCoordinator: BuildCoordinator }): void {
  const { buildCoordinator } = deps;

  app.get('/api/builds', (_req: Request, res: Response) => {
    res.json({ builds: buildCoordinator.getAllBuildJobs() });
  });

  app.post('/api/builds', asyncH(async (req: Request, res: Response) => {
    const { schematicFile, origin, botNames, options } = req.body ?? {};
    const originMode = options?.originMode ?? 'coords';
    const originRequired = originMode === 'coords';
    if (!schematicFile || !botNames || !Array.isArray(botNames) || botNames.length === 0) {
      res.status(400).json({ error: 'schematicFile and botNames[] are required' });
      return;
    }
    if (!isSafeFilename(schematicFile)) {
      res.status(400).json({ error: 'invalid schematicFile' });
      return;
    }
    if (originRequired && !origin) {
      res.status(400).json({ error: 'origin {x,y,z} is required when originMode is "coords" (default)' });
      return;
    }
    const requestedMode = options?.mode;
    if (requestedMode !== undefined && requestedMode !== 'surface' && requestedMode !== 'underground') {
      res.status(400).json({ error: `options.mode must be "surface" or "underground" (got: ${requestedMode})` });
      return;
    }
    if (options?.autoGather !== undefined && typeof options.autoGather !== 'boolean') {
      res.status(400).json({ error: 'options.autoGather must be a boolean' });
      return;
    }
    if (options?.autoGatherTimeoutMs !== undefined &&
      (typeof options.autoGatherTimeoutMs !== 'number' || options.autoGatherTimeoutMs <= 0)) {
      res.status(400).json({ error: 'options.autoGatherTimeoutMs must be a positive number (ms)' });
      return;
    }
    try {
      const resolvedOrigin = origin ?? { x: 0, y: 64, z: 0 };
      const startOptions = options
        ? { ...options, mode: requestedMode as 'surface' | 'underground' | undefined }
        : undefined;
      const job = await buildCoordinator.startBuild(schematicFile, resolvedOrigin, botNames, startOptions);
      res.status(201).json({ build: job });
    } catch (err: any) {
      logger.error({ err }, 'Failed to start build');
      res.status(400).json({ error: sanitizeErrorMessage(err, 'Failed to start build') });
    }
  }));

  app.get('/api/builds/:id', (req: Request, res: Response) => {
    const job = buildCoordinator.getBuildJob(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: 'Build not found' });
      return;
    }
    res.json({ build: job });
  });

  app.post('/api/builds/:id/cancel', (req: Request, res: Response) => {
    const success = buildCoordinator.cancelBuild(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Build not found or already finished' });
      return;
    }
    res.json({ success: true });
  });

  app.post('/api/builds/:id/pause', (req: Request, res: Response) => {
    const success = buildCoordinator.pauseBuild(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Build not found or not running' });
      return;
    }
    res.json({ success: true });
  });

  app.post('/api/builds/:id/resume', (req: Request, res: Response) => {
    const success = buildCoordinator.resumeBuild(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Build not found or not paused' });
      return;
    }
    res.json({ success: true });
  });

  app.post('/api/builds/:id/retry', asyncH(async (req: Request, res: Response) => {
    try {
      const job = await buildCoordinator.retryBuild(req.params.id as string);
      if (!job) {
        res.status(404).json({ error: 'Build not found' });
        return;
      }
      res.json({ success: true, build: job });
    } catch (err: any) {
      res.status(409).json({ error: err.message });
    }
  }));

  // Demolish a build's footprint. ?dryRun=true previews the bbox.
  app.post('/api/builds/:id/demolish', asyncH(async (req: Request, res: Response) => {
    try {
      const dryRun = req.query.dryRun === 'true' || (req.body && req.body.dryRun === true);
      const result = await buildCoordinator.demolishBuild(req.params.id as string, { dryRun });
      if (!result) {
        res.status(404).json({ error: 'Build not found' });
        return;
      }
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(409).json({ error: err.message });
    }
  }));

  // Data-driven town rail network. ?dryRun=true previews the dynamic routes;
  // carving needs confirm:true. Optional townId / floorOffset target a specific
  // town / corridor depth (defaults: active town, floorOffset 12).
  app.post('/api/tunnel', asyncH(async (req: Request, res: Response) => {
    try {
      const dryRun = req.query.dryRun === 'true' || (req.body && req.body.dryRun === true);
      const confirm = req.query.confirm === 'true' || (req.body && req.body.confirm === true);
      const townId = req.query?.townId ?? req.body?.townId;
      const floorOffsetRaw = req.query?.floorOffset ?? req.body?.floorOffset;

      if (townId !== undefined && typeof townId !== 'string') {
        return res.status(400).json({ error: 'townId must be a string' });
      }
      let floorOffset: number | undefined;
      if (floorOffsetRaw !== undefined && floorOffsetRaw !== '') {
        floorOffset = typeof floorOffsetRaw === 'string' ? Number(floorOffsetRaw) : floorOffsetRaw;
        // Must be a finite number >= 6 so the corridor band always sits safely
        // below building floors. Reject 0, negatives, empty-string, and NaN.
        if (typeof floorOffset !== 'number' || !Number.isFinite(floorOffset) || floorOffset < 6) {
          return res.status(400).json({ error: 'floorOffset must be a finite number >= 6' });
        }
      }

      const result = await buildCoordinator.buildTunnel({ dryRun, confirm, townId: townId as string | undefined, floorOffset });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(409).json({ error: err.message });
    }
  }));
}
