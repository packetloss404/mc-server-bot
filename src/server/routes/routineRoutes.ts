/**
 * Routine + template endpoints, extracted from createAPIServer (review: api.ts
 * decomposition). Registered via registerRoutineRoutes(app, { routineManager,
 * templateManager }).
 */
import type { Express } from 'express';
import type { RoutineManager } from '../../control/RoutineManager';
import type { TemplateManager } from '../../control/TemplateManager';

export function registerRoutineRoutes(
  app: Express,
  deps: { routineManager: RoutineManager; templateManager: TemplateManager },
): void {
  const { routineManager, templateManager } = deps;

  // ── Routines ──
  app.get('/api/routines', (_req, res) => res.json({ routines: routineManager.list() }));
  app.post('/api/routines', (req, res) => {
    try { res.status(201).json({ routine: routineManager.create(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch('/api/routines/:id', (req, res) => {
    const r = routineManager.update(req.params.id as string, req.body);
    if (!r) return res.status(404).json({ error: 'Routine not found' });
    res.json({ routine: r });
  });
  app.delete('/api/routines/:id', (req, res) => {
    const ok = routineManager.delete(req.params.id as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  });
  app.post('/api/routines/:id/execute', async (req, res) => {
    try {
      const { botNames } = req.body ?? {};
      const execution = await routineManager.execute(req.params.id as string, botNames ?? []);
      res.json({ execution });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/routines/recording', (_req, res) => {
    res.json({
      isRecording: routineManager.isRecording(),
      draft: routineManager.getRecordingDraft(),
    });
  });
  app.post('/api/routines/recording/start', (req, res) => {
    try {
      const { name, startedBy } = req.body ?? {};
      if (!name) return res.status(400).json({ error: 'name required' });
      res.status(201).json({ draft: routineManager.startRecording(name, startedBy) });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/routines/recording/stop', (req, res) => {
    const { save } = req.body ?? {};
    const saved = routineManager.stopRecording(save === true);
    res.json({ routine: saved });
  });

  // ── Templates ──
  app.get('/api/templates', (_req, res) => res.json({ templates: templateManager.getAll() }));
  app.get('/api/templates/:id', (req, res) => {
    const t = templateManager.getById(req.params.id as string);
    if (!t) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: t });
  });
}
