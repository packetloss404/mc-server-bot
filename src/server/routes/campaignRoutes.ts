/**
 * Build-campaign endpoints, extracted from createAPIServer (review: api.ts
 * decomposition). Single dep: CampaignManager. Registered via
 * registerCampaignRoutes(app, { campaignManager }).
 */
import type { Express, Request, Response } from 'express';
import type { CampaignManager } from '../../build/BuildCampaign';
import { logger } from '../../util/logger';

export function registerCampaignRoutes(app: Express, deps: { campaignManager: CampaignManager }): void {
  const { campaignManager } = deps;

  app.get('/api/campaigns', (_req: Request, res: Response) => {
    res.json({ campaigns: campaignManager.listCampaigns() });
  });

  app.get('/api/campaigns/:id', (req: Request, res: Response) => {
    const campaign = campaignManager.getCampaign(req.params.id as string);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    res.json({ campaign });
  });

  // Create a new campaign (optionally auto-start with `start: true`)
  app.post('/api/campaigns', async (req: Request, res: Response) => {
    const { name, structures, maxParallel, autoSpawn, spawnPersonality, cleanupBots, start } = req.body ?? {};
    if (!name || !Array.isArray(structures) || structures.length === 0) {
      res.status(400).json({ error: 'name and structures[] are required' });
      return;
    }
    try {
      const campaign = campaignManager.createCampaign({
        name,
        structures,
        maxParallel,
        autoSpawn,
        spawnPersonality,
        cleanupBots,
      });
      if (start === true) {
        campaignManager.startCampaign(campaign.id).catch((err) => {
          logger.error({ err: err.message, campaignId: campaign.id }, 'Auto-start campaign failed');
        });
      }
      res.status(201).json({ campaign });
    } catch (err: any) {
      logger.error({ err }, 'Failed to create campaign');
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/campaigns/:id/start', async (req: Request, res: Response) => {
    try {
      const campaign = await campaignManager.startCampaign(req.params.id as string);
      res.json({ campaign });
    } catch (err: any) {
      const notFound = /not found/i.test(err.message);
      res.status(notFound ? 404 : 400).json({ error: err.message });
    }
  });

  app.post('/api/campaigns/:id/pause', (req: Request, res: Response) => {
    const ok = campaignManager.pauseCampaign(req.params.id as string);
    if (!ok) {
      res.status(404).json({ error: 'Campaign not found or not running' });
      return;
    }
    res.json({ success: true });
  });

  app.post('/api/campaigns/:id/resume', (req: Request, res: Response) => {
    const ok = campaignManager.resumeCampaign(req.params.id as string);
    if (!ok) {
      res.status(404).json({ error: 'Campaign not found or not paused' });
      return;
    }
    res.json({ success: true });
  });

  app.post('/api/campaigns/:id/cancel', (req: Request, res: Response) => {
    const ok = campaignManager.cancelCampaign(req.params.id as string);
    if (!ok) {
      res.status(404).json({ error: 'Campaign not found or already finished' });
      return;
    }
    res.json({ success: true });
  });

  app.delete('/api/campaigns/:id', (req: Request, res: Response) => {
    const ok = campaignManager.deleteCampaign(req.params.id as string);
    if (!ok) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    res.json({ success: true });
  });
}
