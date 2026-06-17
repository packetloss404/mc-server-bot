/**
 * Runtime-config read/edit endpoints, extracted from createAPIServer (review:
 * api.ts decomposition). Hot-reloads a whitelist of config sections and
 * broadcasts patches to live workers. Registered via registerConfigRoutes(app,
 * { config, botManager }).
 */
import type { Express, Request, Response } from 'express';
import type { Config } from '../../config';
import { getSection } from '../../config';
import type { BotManager } from '../../bot/BotManager';
import {
  persistConfig,
  PATCHABLE_SECTIONS,
  PatchableSection,
  RESTART_REQUIRED_FIELDS,
  findRestartRequiredFields,
  validatePatch,
} from '../../util/configPersist';
import { logger } from '../../util/logger';

export function registerConfigRoutes(
  app: Express,
  deps: { config?: Config; botManager: BotManager },
): void {
  const { config, botManager } = deps;

  const isPatchableSection = (name: string): name is PatchableSection =>
    (PATCHABLE_SECTIONS as readonly string[]).includes(name);

  app.get('/api/config', (_req: Request, res: Response) => {
    if (!config) return res.status(503).json({ error: 'Config not wired into API server' });
    const sections: Record<string, unknown> = {};
    for (const name of PATCHABLE_SECTIONS) {
      sections[name] = getSection(config, name);
    }
    res.json({ sections });
  });

  app.get('/api/config/:section', (req: Request, res: Response) => {
    if (!config) return res.status(503).json({ error: 'Config not wired into API server' });
    const section = req.params.section as string;
    if (!isPatchableSection(section)) {
      return res.status(400).json({
        error: `Unknown or non-patchable section '${section}'. Allowed: ${PATCHABLE_SECTIONS.join(', ')}`,
      });
    }
    res.json({
      section,
      values: getSection(config, section),
      restartRequired: Array.from(RESTART_REQUIRED_FIELDS[section]),
    });
  });

  app.patch('/api/config/:section', (req: Request, res: Response) => {
    if (!config) return res.status(503).json({ error: 'Config not wired into API server' });
    const section = req.params.section as string;
    if (!isPatchableSection(section)) {
      return res.status(400).json({
        error: `Unknown or non-patchable section '${section}'. Allowed: ${PATCHABLE_SECTIONS.join(', ')}`,
      });
    }
    const body = req.body ?? {};
    const incoming = body.values;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'body must be { values: { ... } }' });
    }

    const validated = validatePatch(section, incoming as Record<string, unknown>);
    if (!validated.ok) {
      return res.status(400).json({ error: 'Invalid patch values', details: validated.errors });
    }

    const current = getSection(config, section) as Record<string, unknown>;
    // Shallow merge in place so any MAIN-THREAD subsystem holding a reference
    // (AffinityManager) sees new values on the next read.
    for (const [key, value] of Object.entries(validated.values)) {
      current[key] = value;
    }

    try {
      persistConfig(config);
    } catch (err: any) {
      logger.error({ err: err.message, section }, 'Failed to persist config.yml');
      return res.status(500).json({ error: `Failed to persist config.yml: ${err.message}` });
    }

    // Broadcast to every live worker so cross-thread subsystems hot-reload
    // without a restart. Fire-and-forget; no-ops on dead/disconnected workers.
    let workersNotified = 0;
    try {
      for (const handle of botManager.getAllWorkers()) {
        handle.postConfigPatch(section, validated.values);
        workersNotified++;
      }
    } catch (err: any) {
      logger.warn(
        { err: err?.message, section },
        'Config patch broadcast partially failed; some workers may be stale until restart',
      );
    }

    const restartRequiredFields = findRestartRequiredFields(section, validated.values);
    logger.info(
      { section, fields: Object.keys(validated.values), restartRequiredFields, workersNotified, droppedFields: validated.errors },
      'Runtime config patched',
    );
    res.json({
      section,
      values: current,
      restartRequiredFields,
      warnings: validated.errors,
    });
  });
}
