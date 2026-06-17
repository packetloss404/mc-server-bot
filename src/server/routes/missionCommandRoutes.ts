/**
 * Missions + commands + bot-control-shortcut endpoints, extracted from
 * createAPIServer (review: api.ts decomposition). Registered via
 * registerMissionCommandRoutes(app, { missionManager, commandCenter }).
 */
import type { Express } from 'express';
import type { MissionManager } from '../../control/MissionManager';
import type { CommandCenter } from '../../control/CommandCenter';
import { asyncH, sanitizeErrorMessage } from './helpers';

export function registerMissionCommandRoutes(
  app: Express,
  deps: { missionManager: MissionManager; commandCenter: CommandCenter },
): void {
  const { missionManager, commandCenter } = deps;

  // ── Missions ──
  app.get('/api/missions', (req, res) => {
    const filters = req.query.status ? { status: String(req.query.status) as any } : undefined;
    res.json({ missions: missionManager.getMissions(filters) });
  });
  app.post('/api/missions', asyncH(async (req, res) => {
    // Validate the body up-front — MissionManager.createMission doesn't
    // re-validate field shapes, so a malformed body could otherwise persist a
    // half-constructed mission record across a restart.
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      res.status(400).json({ error: 'title is required (non-empty string)' });
      return;
    }
    if (body.title.length > 200) {
      res.status(400).json({ error: 'title must be ≤200 characters' });
      return;
    }

    const allowedTypes = new Set([
      'queue_task', 'gather_items', 'craft_items', 'smelt_batch',
      'build_schematic', 'supply_chain', 'patrol_zone', 'escort_player',
      'resupply_builder',
    ]);
    if (typeof body.type !== 'string' || !allowedTypes.has(body.type)) {
      res.status(400).json({ error: `type must be one of: ${[...allowedTypes].join(', ')}` });
      return;
    }

    // Accept canonical { assigneeType, assigneeIds } OR convenience aliases
    // assigneeBotNames (→ bot) / squadId (→ squad).
    let assigneeType: 'bot' | 'squad' | undefined;
    let assigneeIds: string[] | undefined;
    if (Array.isArray(body.assigneeBotNames) && body.assigneeBotNames.length > 0) {
      if (!body.assigneeBotNames.every((n) => typeof n === 'string' && n.length > 0)) {
        res.status(400).json({ error: 'assigneeBotNames must be an array of non-empty strings' });
        return;
      }
      assigneeType = 'bot';
      assigneeIds = body.assigneeBotNames as string[];
    } else if (typeof body.squadId === 'string' && body.squadId.length > 0) {
      assigneeType = 'squad';
      assigneeIds = [body.squadId];
    } else if (body.assigneeType === 'bot' || body.assigneeType === 'squad') {
      if (!Array.isArray(body.assigneeIds) || body.assigneeIds.length === 0 ||
          !body.assigneeIds.every((n) => typeof n === 'string' && n.length > 0)) {
        res.status(400).json({ error: 'assigneeIds must be a non-empty array of strings' });
        return;
      }
      assigneeType = body.assigneeType;
      assigneeIds = body.assigneeIds as string[];
    } else {
      res.status(400).json({
        error: 'either assigneeBotNames: string[] OR squadId: string OR (assigneeType + assigneeIds) is required',
      });
      return;
    }

    if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 2000)) {
      res.status(400).json({ error: 'description must be a string ≤2000 chars' });
      return;
    }
    const allowedPriorities = new Set(['low', 'normal', 'high', 'urgent']);
    if (body.priority !== undefined && (typeof body.priority !== 'string' || !allowedPriorities.has(body.priority))) {
      res.status(400).json({ error: 'priority must be one of: low, normal, high, urgent' });
      return;
    }
    const allowedSources = new Set(['dashboard', 'map', 'role', 'routine', 'commander']);
    if (body.source !== undefined && (typeof body.source !== 'string' || !allowedSources.has(body.source))) {
      res.status(400).json({ error: 'source must be one of: dashboard, map, role, routine, commander' });
      return;
    }
    if (body.steps !== undefined && !Array.isArray(body.steps)) {
      res.status(400).json({ error: 'steps must be an array' });
      return;
    }
    if (body.linkedCommandIds !== undefined && (!Array.isArray(body.linkedCommandIds) ||
        !body.linkedCommandIds.every((s) => typeof s === 'string'))) {
      res.status(400).json({ error: 'linkedCommandIds must be an array of strings' });
      return;
    }

    const params: any = {
      type: body.type,
      title: body.title,
      assigneeType,
      assigneeIds,
      description: body.description,
      priority: body.priority,
      source: body.source,
      steps: body.steps,
      linkedCommandIds: body.linkedCommandIds,
    };

    try {
      res.status(201).json({ mission: missionManager.createMission(params) });
    } catch (e: any) {
      res.status(400).json({ error: sanitizeErrorMessage(e, 'Failed to create mission') });
    }
  }));
  app.get('/api/missions/:id', (req, res) => {
    const m = missionManager.getMission(req.params.id as string);
    if (!m) return res.status(404).json({ error: 'Mission not found' });
    res.json({ mission: m });
  });
  app.post('/api/missions/:id/:action', async (req, res) => {
    const id = req.params.id as string;
    const action = req.params.action as string;
    try {
      let result: any;
      switch (action) {
        case 'start': result = await missionManager.startMission(id); break;
        case 'pause': result = missionManager.pauseMission(id); break;
        case 'resume': result = missionManager.resumeMission(id); break;
        case 'cancel': result = missionManager.cancelMission(id); break;
        case 'retry': result = missionManager.retryMission(id); break;
        default: return res.status(400).json({ error: `Unknown action: ${action}` });
      }
      if (!result) return res.status(404).json({ error: 'Mission not found' });
      res.json({ mission: result });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.patch('/api/bots/:name/mission-queue', (req, res) => {
    const { action, missionId, position } = req.body;
    const r = missionManager.updateBotMissionQueue(req.params.name as string, action, missionId, position);
    res.json({ queue: r });
  });
  app.delete('/api/bots/:name/mission-queue', (req, res) => {
    const r = missionManager.updateBotMissionQueue(req.params.name as string, 'clear');
    res.json({ queue: r });
  });

  // ── Commands ──
  // Flatten the structured command.error into a string for client safety.
  const flattenCmd = (c: any) => c && ({
    ...c,
    error: c.error ? `${c.error.code ?? 'error'}: ${c.error.message ?? ''}` : undefined,
  });
  app.get('/api/commands', (req, res) => {
    const filters = req.query.status ? { status: String(req.query.status) as any } : undefined;
    res.json({ commands: commandCenter.getCommands(filters).map(flattenCmd) });
  });
  app.post('/api/commands', async (req, res) => {
    try {
      const cmd = commandCenter.createCommand(req.body);
      await commandCenter.dispatchCommand(cmd, req.body.force === true);
      res.status(201).json({ command: flattenCmd(cmd) });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get('/api/commands/:id', (req, res) => {
    const c = commandCenter.getCommand(req.params.id as string);
    if (!c) return res.status(404).json({ error: 'Command not found' });
    res.json({ command: flattenCmd(c) });
  });
  app.post('/api/commands/:id/cancel', (req, res) => {
    const { reason } = req.body ?? {};
    const c = commandCenter.cancelCommand(req.params.id as string, reason);
    if (!c) return res.status(404).json({ error: 'Command not found' });
    res.json({ command: flattenCmd(c) });
  });

  // ── Bot control shortcuts (dispatched through CommandCenter) ──
  const botControlAction = async (botName: string, type: string, params: any = {}) => {
    const cmd = commandCenter.createCommand({
      type: type as any,
      scope: 'single',
      priority: 'normal',
      source: 'api',
      targets: [botName],
      params,
    } as any);
    await commandCenter.dispatchCommand(cmd);
    return cmd;
  };
  const makeBotActionRoute = (routePath: string, type: string) => {
    app.post(routePath, async (req, res) => {
      try {
        const cmd = await botControlAction(req.params.name as string, type, req.body ?? {});
        res.json({ success: true, command: flattenCmd(cmd) });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    });
  };
  makeBotActionRoute('/api/bots/:name/pause', 'pause_voyager');
  makeBotActionRoute('/api/bots/:name/resume', 'resume_voyager');
  makeBotActionRoute('/api/bots/:name/stop', 'stop_movement');
  makeBotActionRoute('/api/bots/:name/follow', 'follow_player');
  makeBotActionRoute('/api/bots/:name/walkto', 'walk_to_coords');
  makeBotActionRoute('/api/bots/:name/return-to-base', 'return_to_base');
  makeBotActionRoute('/api/bots/:name/unstuck', 'unstuck');
  makeBotActionRoute('/api/bots/:name/equip-best', 'equip_best');
}
