/**
 * Supply-chain endpoints, extracted from createAPIServer (review: api.ts
 * decomposition). Single dep: ChainCoordinator. Registered via
 * registerChainRoutes(app, { chainCoordinator }).
 */
import type { Express, Request, Response } from 'express';
import type { ChainCoordinator } from '../../supplychain/ChainCoordinator';
import { logger } from '../../util/logger';

export function registerChainRoutes(app: Express, deps: { chainCoordinator: ChainCoordinator }): void {
  const { chainCoordinator } = deps;

  app.get('/api/chains/templates', (_req: Request, res: Response) => {
    res.json({ templates: chainCoordinator.getTemplates() });
  });

  app.get('/api/chains', (_req: Request, res: Response) => {
    res.json({ chains: chainCoordinator.getAllChains() });
  });

  app.post('/api/chains', (req: Request, res: Response) => {
    const { name, description, templateId, stages, loop, botAssignments, chestLocations } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    try {
      const chain = chainCoordinator.createChain({ name, description, templateId, stages, loop, botAssignments, chestLocations });
      res.status(201).json({ chain });
    } catch (err: any) {
      logger.error({ err }, 'Failed to create chain');
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/chains/:id', (req: Request, res: Response) => {
    const chain = chainCoordinator.getChain(req.params.id as string);
    if (!chain) {
      res.status(404).json({ error: 'Chain not found' });
      return;
    }
    res.json({ chain });
  });

  app.post('/api/chains/:id/start', (req: Request, res: Response) => {
    const success = chainCoordinator.startChain(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Chain not found or already running' });
      return;
    }
    res.json({ success: true });
  });

  app.post('/api/chains/:id/pause', (req: Request, res: Response) => {
    const success = chainCoordinator.pauseChain(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Chain not found or not running' });
      return;
    }
    res.json({ success: true });
  });

  app.post('/api/chains/:id/cancel', (req: Request, res: Response) => {
    const success = chainCoordinator.cancelChain(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Chain not found' });
      return;
    }
    res.json({ success: true });
  });

  app.delete('/api/chains/:id', (req: Request, res: Response) => {
    const success = chainCoordinator.deleteChain(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Chain not found' });
      return;
    }
    res.json({ success: true });
  });
}
