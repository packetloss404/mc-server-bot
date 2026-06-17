/**
 * Core bot management + dashboard read endpoints + bot interaction, extracted
 * from createAPIServer (review: api.ts decomposition). The most central group:
 * status, bot CRUD/mode/security, all /api/bots/:name/* reads, world/blackboard/
 * players/reputation/culture reads, chat/say/task, swarm, diagnostics, llm-trace.
 * Registered via registerBotRoutes(app, { botManager, io, eventLog, tokenLedger }).
 */
import type { Express, Request, Response } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import type { BotManager } from '../../bot/BotManager';
import type { EventLog } from '../EventLog';
import type { TokenLedger } from '../../ai/TokenLedger';
import { asyncH, isSafeBotName } from './helpers';
import { createGrantHandler } from './grantHandler';
import { requireDev } from '../auth';
import { loadObservedRole } from '../../town/ObservedRoleModel';

export function registerBotRoutes(
  app: Express,
  deps: { botManager: BotManager; io: SocketIOServer; eventLog: EventLog; tokenLedger?: TokenLedger },
): void {
  const { botManager, io, eventLog, tokenLedger } = deps;

  app.get('/api/status', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      botCount: botManager.getAllWorkers().length,
    });
  });

  // List all bots (basic status)
  app.get('/api/bots', (_req: Request, res: Response) => {
    const bots = botManager.getAllBotStatuses();
    res.json({ bots });
  });

  // Get single bot (basic)
  app.get('/api/bots/:name', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json({ bot: handle.getCachedStatus() });
  });

  // Create bot
  app.post('/api/bots', asyncH(async (req: Request, res: Response) => {
    const { name, personality, location, mode } = req.body;

    if (!name || !personality) {
      res.status(400).json({ error: 'name and personality are required' });
      return;
    }
    if (!isSafeBotName(name)) {
      res.status(400).json({
        error: 'invalid bot name',
        hint: 'must match /^[A-Za-z0-9_]{3,16}$/ (Minecraft username rules)',
      });
      return;
    }

    const handle = await botManager.spawnBot(name, personality, location, mode);
    if (!handle) {
      res.status(409).json({ error: 'Bot already exists or max limit reached' });
      return;
    }

    const event = eventLog.push({ type: 'bot:spawn', botName: name, description: `${name} spawned` });
    io.emit('bot:spawn', { bot: name });
    io.emit('activity', event);

    res.status(201).json({ success: true, bot: handle.getCachedStatus() });
  }));

  // Remove single bot
  app.delete('/api/bots/:name', asyncH(async (req: Request, res: Response) => {
    const removed = await botManager.removeBot(req.params.name as string);
    if (!removed) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    const deletedName = req.params.name as string;
    const event = eventLog.push({ type: 'bot:disconnect', botName: deletedName, description: `${deletedName} removed` });
    io.emit('bot:disconnect', { bot: deletedName });
    io.emit('activity', event);

    res.json({ success: true });
  }));

  // Remove all bots
  app.delete('/api/bots', asyncH(async (_req: Request, res: Response) => {
    const count = await botManager.removeAllBots();
    res.json({ success: true, count });
  }));

  // Toggle mode
  app.post('/api/bots/:name/mode', (req: Request, res: Response) => {
    const { mode } = req.body;
    if (!mode || !['primitive', 'codegen'].includes(mode)) {
      res.status(400).json({ error: 'mode must be "primitive" or "codegen"' });
      return;
    }

    const success = botManager.setMode(req.params.name as string, mode);
    if (!success) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    res.json({ success: true, mode });
  });

  // ── Security: impersonation detection ──

  // List recent impersonation incidents (newest first).
  app.get('/api/security/impersonation', (_req: Request, res: Response) => {
    res.json({ incidents: botManager.getImpersonationMonitor().list() });
  });

  // Release an impersonation quarantine so the bot reconnects. Operator action,
  // to be used once the impostor is gone (kicked/banned or online-mode enabled).
  app.post('/api/bots/:name/quarantine/release', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const handle = botManager.getWorker(name);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    handle.releaseQuarantine();
    const event = eventLog.push({
      type: 'security:quarantine-released',
      botName: name,
      description: `${name} quarantine released — reconnecting`,
    });
    io.emit('activity', event);
    res.json({ success: true });
  });


  // ═══════════════════════════════════════
  //  DASHBOARD ENDPOINTS
  // ═══════════════════════════════════════

  // Detailed bot status (enriched) — uses cached state from worker
  app.get('/api/bots/:name/detailed', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const detailed = handle.getCachedDetailedStatus();
    if (!detailed) {
      res.json({ bot: handle.getCachedStatus() });
      return;
    }
    res.json({ bot: detailed });
  });

  // Bot prismarine-viewer port — lazy-mounts the viewer on first call.
  // Returns { port: number | null }; null means the viewer couldn't start
  // (bot not connected yet, or prismarine-viewer threw on init).
  app.get('/api/bots/:name/viewer-port', async (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    try {
      const port = await handle.getViewerPort();
      res.json({ port });
    } catch (err: any) {
      res.json({ port: null, error: err?.message ?? 'Failed to fetch viewer port' });
    }
  });

  // Bot inventory — from cached detailed status
  app.get('/api/bots/:name/inventory', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const detailed = handle.getCachedDetailedStatus();
    res.json({ inventory: detailed?.inventory || [] });
  });

  // Bot relationships (affinities) — read directly from main thread manager
  app.get('/api/bots/:name/relationships', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const handle = botManager.getWorker(name);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const affinities = botManager.getAffinityManager().getAllForBot(name);
    res.json({ relationships: affinities });
  });

  // Bot conversations — read directly from main thread manager
  app.get('/api/bots/:name/conversations', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const handle = botManager.getWorker(name);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const conversations = botManager.getConversationManager().getAllConversations(name);
    res.json({ conversations });
  });

  // Bot tasks — from cached detailed status
  app.get('/api/bots/:name/tasks', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const detailed = handle.getCachedDetailedStatus();
    if (!detailed?.voyager) {
      res.json({ currentTask: null, completedTasks: [], failedTasks: [] });
      return;
    }
    res.json({
      currentTask: detailed.voyager.currentTask,
      queuedTasks: detailed.voyager.queuedTasks,
      longTermGoal: detailed.voyager.longTermGoal,
      completedTasks: detailed.voyager.completedTasks,
      failedTasks: detailed.voyager.failedTasks,
      // Per-task retry telemetry: { [taskDescription]: [{attempt, error, timestamp}] }
      retries: detailed.voyager.retryHistory ?? {},
    });
  });

  // Observed-role inference (Project Sid P1-A) — classify what the bot
  // *actually does* from its persisted action tallies (data/stats.json) and
  // compare to the role its town assigned it. Read-only; computes on demand.
  // Returns { observedRole, scores, assignedRole } where assignedRole is the
  // town RoleManager's current_role if the bot is a resident, else null.
  app.get('/api/bots/:name/observed-role', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const handle = botManager.getWorker(name);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const { observedRole, scores } = loadObservedRole(name);
    // assignedRole: scan towns for a resident row matching this bot. Most
    // bots belong to at most one town; first alive match wins.
    let assignedRole: string | null = null;
    const tm = botManager.getTownManager();
    for (const town of tm.listTowns()) {
      const resident = tm
        .listResidents(town.id)
        .find(
          (r) =>
            r.botName.toLowerCase() === name.toLowerCase() &&
            (r.status === 'alive' || r.status == null),
        );
      if (resident) {
        assignedRole = resident.currentRole ?? null;
        break;
      }
    }
    res.json({ observedRole, scores, assignedRole });
  });

  // Bot decision traces — from worker-forwarded trace buffer
  app.get('/api/bots/:name/decisions', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const limit = parseInt(String(req.query.limit ?? '50')) || 50;
    const type = req.query.type ? String(req.query.type) : undefined;
    const traces = handle.getDecisionTraces(limit, type as any);
    res.json({ decisions: traces });
  });

  // ═══════════════════════════════════════
  //  SMART AI SYSTEM ENDPOINTS
  // ═══════════════════════════════════════

  // Shared world model
  app.get('/api/world/model', (_req: Request, res: Response) => {
    res.json(botManager.getSharedWorldModel().getSnapshot());
  });

  // Bot reputation scores
  app.get('/api/reputation', (_req: Request, res: Response) => {
    res.json({ scores: botManager.getBotReputation().getAllReputations() });
  });

  app.get('/api/reputation/:name', (req: Request, res: Response) => {
    const score = botManager.getBotReputation().getReputation(req.params.name as string);
    res.json({ reputation: score });
  });

  // DungeonMaster world events
  app.get('/api/events/world', (_req: Request, res: Response) => {
    res.json({ active: botManager.getDungeonMaster().getActiveEvents(), history: botManager.getDungeonMaster().getEventHistory(20) });
  });

  // Difficulty state
  app.get('/api/difficulty', (_req: Request, res: Response) => {
    res.json(botManager.getDifficultyBalancer().calculateDifficulty());
  });

  // Swarm coordination plans
  app.get('/api/swarm/plans', (_req: Request, res: Response) => {
    res.json({ plans: botManager.getSwarmCoordinator().getActivePlans() });
  });

  // Online players with positions — queried via any connected worker bot
  app.get('/api/players', async (_req: Request, res: Response) => {
    try {
      for (const handle of botManager.getAllWorkers() as any[]) {
        if (typeof handle.isBotConnected === 'function' && (await handle.isBotConnected())) {
          const players = await handle.getPlayers();
          res.json({ players });
          return;
        }
      }
      res.json({ players: [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message, players: [] });
    }
  });

  // Player intent predictions
  app.get('/api/players/:name/intent', (req: Request, res: Response) => {
    const prediction = botManager.getPlayerIntentModel().predictIntent(req.params.name as string);
    res.json({ prediction });
  });

  // Social memory for a bot
  app.get('/api/bots/:name/memories', (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const sm = botManager.getSocialMemory();
      const memories = sm.getRecentMemories(name, 20);
      const emotionalState = sm.getEmotionalState(name);
      res.json({ memories, emotionalState });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bot-to-bot messages received by a bot
  app.get('/api/bots/:name/messages', (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      // peekUnread returns pending messages without marking them consumed
      const messages = botManager.getBotComms().peekUnread(name);
      res.json({ messages });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send a message from one bot to another
  app.post('/api/bots/:name/bot-message', (req: Request, res: Response) => {
    const { to, content } = req.body;
    if (!to || !content) {
      res.status(400).json({ error: 'to and content are required' });
      return;
    }
    try {
      botManager.getBotComms().sendMessage(
        req.params.name as string,
        to,
        content,
        'chat',
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Full social graph (all bots, all players) — direct from main thread
  app.get('/api/relationships', (_req: Request, res: Response) => {
    const allAffinities = botManager.getAffinityManager().getAll();
    res.json({ relationships: allAffinities });
  });

  // Project Sid P3-B — cultural-meme layer snapshot. Mirrors Sid's per-town
  // meme curves: the meme registry (label, strength, adoption count) plus
  // per-town keyword/adoption counts. The registry stays empty unless
  // `config.social.culture` is on and bots have started adopting memes, so this
  // safely returns `{ enabled, memes: [], towns: {}, totalAdoptions: 0 }` when
  // the flag is off.
  app.get('/api/culture', (_req: Request, res: Response) => {
    const enabled = !!botManager.getConfig().social?.culture;
    const summary = botManager.getCultureManager().getSummary();
    res.json({ enabled, ...summary });
  });


  // Aggregate world state — from first bot's cached detailed status
  app.get('/api/world', (_req: Request, res: Response) => {
    const workers = botManager.getAllWorkers();
    for (const w of workers) {
      const detailed = w.getCachedDetailedStatus();
      if (detailed?.world) {
        res.json({
          timeOfDay: detailed.world.timeOfDay,
          timeOfDayTicks: detailed.world.timeOfDayTicks ?? null,
          day: detailed.world.day ?? null,
          isRaining: detailed.world.isRaining,
          onlineBots: workers.filter((h) => h.isAlive()).length,
          onlinePlayers: botManager.getPlayerPresenceTracker().getPlayerCount(),
        });
        return;
      }
    }
    res.json({
      timeOfDay: null,
      timeOfDayTicks: null,
      day: null,
      isRaining: null,
      onlineBots: 0,
      onlinePlayers: botManager.getPlayerPresenceTracker().getPlayerCount(),
    });
  });

  // Shared blackboard state — direct from main thread
  app.get('/api/blackboard', (_req: Request, res: Response) => {
    res.json({ blackboard: botManager.getBlackboardManager().getState() });
  });

  // Activity log
  app.get('/api/activity', (req: Request, res: Response) => {
    const limit = parseInt(String(req.query.limit ?? '50')) || 50;
    const botName = req.query.bot ? String(req.query.bot) : undefined;
    const type = req.query.type ? String(req.query.type) : undefined;
    const events = eventLog.getRecent(limit, botName, type);
    res.json({ events });
  });

  // Send chat message to a bot (from dashboard) — forward to worker
  app.post('/api/bots/:name/chat', (req: Request, res: Response) => {
    const { playerName, message } = req.body;
    if (!playerName || !message) {
      res.status(400).json({ error: 'playerName and message are required' });
      return;
    }
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle || !handle.isAlive()) {
      res.status(404).json({ error: 'Bot not found or not connected' });
      return;
    }
    handle.sendCommand('queueChat', { playerName, message });
    res.json({ success: true });
  });

  // Make a bot say raw chat (or run a server command if prefixed with /)
  app.post('/api/bots/:name/say', (req: Request, res: Response) => {
    const { message } = req.body;
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    const handle = botManager.getWorker(req.params.name as string) as any;
    if (!handle || !handle.isAlive()) {
      res.status(404).json({ error: 'Bot not found or not connected' });
      return;
    }
    if (typeof handle.chat !== 'function') {
      res.status(500).json({ error: 'Bot handle does not support chat' });
      return;
    }
    handle.chat(message);
    res.json({ success: true });
  });

  // Task #72 — Dev-only /grant endpoint for offline-mode item seeding.
  // The handler logic lives in `createGrantHandler` (exported above, near
  // the top of this file) so it can be tested in isolation without
  // spinning up a full BotManager. Gated by `requireDev`: NODE_ENV ===
  // 'development' OR config.auth.devSecret being set.
  app.post(
    '/api/bots/:name/grant',
    requireDev,
    createGrantHandler({
      getWorker: (name) => botManager.getWorker(name) as any,
    }),
  );

  // Queue a task for a bot (from dashboard) — forward to worker
  app.post('/api/bots/:name/task', (req: Request, res: Response) => {
    const { description } = req.body;
    if (!description) {
      res.status(400).json({ error: 'description is required' });
      return;
    }
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    handle.sendCommand('queueTask', { description, source: 'dashboard' });

    const event = eventLog.push({
      type: 'bot:task',
      botName: req.params.name as string,
      description: `Task queued: ${description}`,
      metadata: { source: 'dashboard' },
    });
    // `bot:task` socket event removed per the dead-event audit (no listeners).
    // Surfaced via the `activity` channel + activity log instead.
    io.emit('activity', event);

    res.json({ success: true });
  });

  // Set a swarm directive from dashboard/UI
  app.post('/api/swarm', asyncH(async (req: Request, res: Response) => {
    const { description, requestedBy } = req.body ?? {};
    // `description` is the core directive — must be a non-empty string and
    // bounded so a runaway client can't queue a megabyte directive into
    // the blackboard.
    if (typeof description !== 'string' || description.trim().length === 0) {
      res.status(400).json({ error: 'description is required (non-empty string)' });
      return;
    }
    if (description.length > 2000) {
      res.status(400).json({ error: 'description must be ≤2000 characters' });
      return;
    }
    // `requestedBy` is optional metadata — short string when present.
    if (requestedBy !== undefined && requestedBy !== null) {
      if (typeof requestedBy !== 'string' || requestedBy.length > 64) {
        res.status(400).json({ error: 'requestedBy must be a string ≤64 chars' });
        return;
      }
    }
    const source = (typeof requestedBy === 'string' && requestedBy.length > 0) ? requestedBy : 'dashboard';

    await botManager.handleSwarmDirective(description, source);

    const event = eventLog.push({
      type: 'swarm:directive',
      botName: 'swarm',
      description: `Swarm directive set: ${description}`,
      metadata: { requestedBy: source },
    });
    io.emit('activity', event);
    res.json({ success: true });
  }));

  // ── Swarm directive ──
  app.post('/api/blackboard/swarm-directive', async (req, res) => {
    const { description, requestedBy } = req.body ?? {};
    if (!description) return res.status(400).json({ error: 'description required' });
    try {
      await botManager.handleSwarmDirective(description, requestedBy || 'dashboard');
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Diagnostics ──
  app.get('/api/bots/:name/diagnostics', (req, res) => {
    const handle = botManager.getWorker(req.params.name as string) as any;
    if (!handle) return res.status(404).json({ error: 'Bot not found' });
    res.json({ diagnostics: handle.getCachedDiagnostics?.() ?? null });
  });

  // ═══════════════════════════════════════════════════════════════
  //  LLM trace timeline — AgentOps-style waterfall for one bot
  // ═══════════════════════════════════════════════════════════════
  //
  // Returns the last N LLM calls for a single bot from the shared TokenLedger,
  // ordered by startMs ascending so the dashboard renders the waterfall
  // left-to-right. Each record's startMs is the timestamp the ledger recorded
  // (call completion time) minus its measured latencyMs.
  app.get('/api/bots/:name/llm-trace', (req: Request, res: Response) => {
    const name = String(req.params.name);
    if (!tokenLedger) {
      res.json({ trace: [] });
      return;
    }
    const limitRaw = Number.parseInt(String(req.query.limit ?? '50'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 50;
    const records = tokenLedger.getRecords({ botName: name, limit });
    const trace = records.map((r, idx) => {
      const endMs = r.timestamp;
      const startMs = endMs - (r.latencyMs ?? 0);
      return {
        id: `${name}-${endMs}-${idx}`,
        taskType: r.taskType,
        provider: r.provider,
        model: r.model,
        startMs,
        endMs,
        durationMs: r.latencyMs ?? 0,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        success: r.success,
      };
    });
    // getRecords returns oldest-first via slice(-limit); sort defensively in
    // case future changes reorder. Ascending startMs = left-to-right waterfall.
    trace.sort((a, b) => a.startMs - b.startMs);
    res.json({ trace });
  });
}
