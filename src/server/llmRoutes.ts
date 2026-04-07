import type { Application, Request, Response } from 'express';
import type { LLMSettings } from '../ai/LLMSettings';
import type { TokenLedger } from '../ai/TokenLedger';
import type { BotManager } from '../bot/BotManager';
import { logger } from '../util/logger';

/**
 * Register LLM settings and usage API routes.
 * Called from index.ts where we have access to settings + ledger.
 */
export function registerLLMRoutes(
  app: Application,
  llmSettings: LLMSettings,
  tokenLedger: TokenLedger,
  botManager: BotManager,
): void {

  // ── Get current provider config (keys masked) ──
  app.get('/api/llm/providers', (_req: Request, res: Response) => {
    res.json(llmSettings.getSettings());
  });

  // ── Add or update a provider ──
  app.post('/api/llm/providers', (req: Request, res: Response) => {
    const { name, apiKey, model, maxConcurrentRequests, enabled } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    llmSettings.upsertProvider({
      name: name.toLowerCase(),
      apiKey: apiKey ?? '',
      model: model ?? '',
      maxConcurrentRequests: maxConcurrentRequests ?? 3,
      enabled: enabled !== false,
    });

    logger.info({ provider: name }, 'LLM provider updated via API');
    res.status(200).json({ success: true, settings: llmSettings.getSettings() });
  });

  // ── Remove a provider ──
  app.delete('/api/llm/providers/:name', (req: Request, res: Response) => {
    const removed = llmSettings.removeProvider(req.params.name as string);
    if (!removed) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    res.json({ success: true });
  });

  // ── Get current routes ──
  app.get('/api/llm/routes', (_req: Request, res: Response) => {
    const settings = llmSettings.getSettings();
    res.json({
      routes: settings.routes,
      defaultProvider: settings.defaultProvider,
      taskTypes: ['codegen', 'curriculum', 'critic', 'chat', 'embed'],
    });
  });

  // ── Update routes ──
  app.put('/api/llm/routes', (req: Request, res: Response) => {
    const { routes, defaultProvider } = req.body;
    if (routes && typeof routes === 'object') {
      llmSettings.setRoutes(routes);
    }
    if (defaultProvider && typeof defaultProvider === 'string') {
      llmSettings.setDefaultProvider(defaultProvider);
    }
    logger.info({ routes: Object.keys(routes ?? {}), defaultProvider }, 'LLM routes updated via API');
    res.json({ success: true, settings: llmSettings.getSettings() });
  });

  // ── Rebuild router (hot-reload providers) ──
  app.post('/api/llm/reload', (_req: Request, res: Response) => {
    try {
      const router = llmSettings.buildRouter();
      if (router) {
        // Hot-swap the LLM client on the bot manager
        (botManager as any).llmClient = router;
        logger.info('LLM ModelRouter hot-reloaded');
        res.json({ success: true, providers: [...llmSettings.getSettings().providers.map((p) => p.name)] });
      } else {
        res.json({ success: false, error: 'No providers with valid API keys' });
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to reload LLM router');
      res.status(500).json({ error: err.message });
    }
  });

  // ── Token usage metrics ──
  app.get('/api/llm/usage', (_req: Request, res: Response) => {
    res.json({ usage: tokenLedger.getMetrics() });
  });

  // ── Global AI kill switch ──
  app.get('/api/llm/enabled', (_req: Request, res: Response) => {
    res.json({ enabled: llmSettings.isAiEnabled() });
  });

  app.post('/api/llm/enabled', (req: Request, res: Response) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled (boolean) is required' });
      return;
    }
    llmSettings.setAiEnabled(enabled);

    // Broadcast to every worker so each voyager loop pauses/resumes immediately
    // instead of waiting for its next LLM call to notice.
    for (const handle of botManager.getAllWorkers()) {
      try {
        if (enabled) handle.resumeVoyager();
        else handle.pauseVoyager('ai-disabled');
      } catch (err: any) {
        logger.warn({ bot: handle.botName, err: err.message }, 'Failed to broadcast AI toggle to worker');
      }
    }

    logger.warn({ enabled }, 'AI kill switch broadcast to all workers');
    res.json({ success: true, enabled });
  });
}
