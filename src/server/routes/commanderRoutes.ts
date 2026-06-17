/**
 * Commander (natural-language → plan) endpoints, extracted from createAPIServer
 * (review: api.ts decomposition). Registered via registerCommanderRoutes(app,
 * { commanderService, eventLog, io }).
 */
import type { Express, Request, Response } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import type { CommanderService } from '../../control/CommanderService';
import type { EventLog } from '../EventLog';
import { logger } from '../../util/logger';

export function registerCommanderRoutes(
  app: Express,
  deps: { commanderService: CommanderService; eventLog: EventLog; io: SocketIOServer },
): void {
  const { commanderService, eventLog, io } = deps;

  app.get('/api/commander/history', (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    res.json({ entries: commanderService.getHistory(Number.isFinite(limit) ? limit : 20) });
  });

  app.post('/api/commander/parse', async (req: Request, res: Response) => {
    const { input } = req.body;
    if (!input || typeof input !== 'string' || !input.trim()) {
      res.status(400).json({ error: 'input is required' });
      return;
    }
    try {
      const plan = await commanderService.parse(input.trim());
      const event = eventLog.push({
        type: 'commander:parse',
        botName: 'system',
        description: `Commander parsed input: ${input.trim().slice(0, 80)}`,
        metadata: { planId: plan.id, confidence: plan.confidence, warnings: plan.warnings.length },
      });
      io.emit('activity', event);
      res.json({ plan });
    } catch (err: any) {
      logger.error({ err }, 'Commander parse failed');
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/commander/execute', async (req: Request, res: Response) => {
    const { planId } = req.body;
    if (!planId) {
      res.status(400).json({ error: 'planId is required' });
      return;
    }
    const plan = commanderService.getPlan(planId);
    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    try {
      const result = await commanderService.execute(planId);
      if (result) {
        const event = eventLog.push({
          type: 'commander:execute',
          botName: 'system',
          description: `Commander executed plan ${planId}`,
          metadata: { planId, commands: result.commands.length, missions: result.missions.length },
        });
        io.emit('activity', event);
      }
      res.json({ result });
    } catch (err: any) {
      logger.error({ err }, 'Commander execute failed');
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/commander/drafts', (_req: Request, res: Response) => {
    res.json({ drafts: commanderService.getDrafts() });
  });

  app.post('/api/commander/drafts', (req: Request, res: Response) => {
    const { input, plan, notes, id } = req.body;
    if (!input || typeof input !== 'string' || !input.trim()) {
      res.status(400).json({ error: 'input is required' });
      return;
    }
    const draft = commanderService.saveDraft({ input: input.trim(), plan, notes, id });
    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    res.status(201).json({ draft });
  });

  app.delete('/api/commander/drafts/:id', (req: Request, res: Response) => {
    const deleted = commanderService.deleteDraft(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    res.json({ success: true });
  });

  app.post('/api/commander/clarify', async (req: Request, res: Response) => {
    const { originalInput, clarifications } = req.body;
    if (!originalInput || typeof originalInput !== 'string') {
      res.status(400).json({ error: 'originalInput string is required' });
      return;
    }
    if (!clarifications || typeof clarifications !== 'object') {
      res.status(400).json({ error: 'clarifications object is required' });
      return;
    }
    try {
      const plan = await commanderService.parseWithClarification(originalInput.trim(), clarifications);
      const event = eventLog.push({
        type: 'commander:clarify',
        botName: 'system',
        description: `Commander re-parsed with clarification: "${originalInput.trim().slice(0, 60)}"`,
        metadata: { planId: plan.id, intent: plan.intent, confidence: plan.confidence },
      });
      io.emit('activity', event);
      res.json({ plan });
    } catch (err: any) {
      logger.error({ err }, 'Commander clarify failed');
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/commander/suggestions', (_req: Request, res: Response) => {
    res.json({ suggestions: commanderService.getSuggestedCommands() });
  });
}
