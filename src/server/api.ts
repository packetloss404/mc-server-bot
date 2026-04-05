import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { EventLog } from './EventLog';
import { CommanderService } from '../control/CommanderService';
import { logger } from '../util/logger';

export interface APIServerResult {
  app: express.Application;
  httpServer: http.Server;
  io: SocketIOServer;
  eventLog: EventLog;
  commanderService: CommanderService;
}

export function createAPIServer(botManager: BotManager): APIServerResult {
  const app = express();
  const httpServer = http.createServer(app);

  // CORS — allow the Next.js dev server and common local ports
  app.use(cors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
    ],
    credentials: true,
  }));

  app.use(express.json());

  const dashboardDir = path.join(process.cwd(), 'dashboard');
  app.use('/dashboard', express.static(dashboardDir));
  app.get('/', (_req: Request, res: Response) => {
    res.redirect('/dashboard/');
  });

  // Event log (in-memory circular buffer)
  const eventLog = new EventLog(500);

  // Socket.IO
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
      ],
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Dashboard client connected');
    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Dashboard client disconnected');
    });
  });

  // ── Commander service (persisted to data/commander-history.json) ──
  const commanderService = new CommanderService({
    llmClient: null, // LLM wired later if available
  });

  // ═══════════════════════════════════════
  //  ENDPOINTS — all use cached worker state
  // ═══════════════════════════════════════

  // Health check
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
  app.post('/api/bots', async (req: Request, res: Response) => {
    const { name, personality, location, mode } = req.body;

    if (!name || !personality) {
      res.status(400).json({ error: 'name and personality are required' });
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
  });

  // Remove single bot
  app.delete('/api/bots/:name', async (req: Request, res: Response) => {
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
  });

  // Remove all bots
  app.delete('/api/bots', async (_req: Request, res: Response) => {
    const count = await botManager.removeAllBots();
    res.json({ success: true, count });
  });

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

  // Event relay endpoints (for Java plugin)
  app.post('/api/events/chat', (req: Request, res: Response) => {
    const { playerName, message, nearestBot } = req.body;
    const handle = nearestBot ? botManager.getWorker(nearestBot) : null;

    if (!handle) {
      res.json({ handled: false });
      return;
    }

    logger.info({ player: playerName, bot: nearestBot, message }, 'Chat event received');
    res.json({ handled: true });
  });

  app.post('/api/events/player-join', (req: Request, res: Response) => {
    const { playerName } = req.body;
    logger.info({ player: playerName }, 'Player joined');
    res.json({ handled: true });
  });

  app.post('/api/events/player-leave', (req: Request, res: Response) => {
    const { playerName } = req.body;
    logger.info({ player: playerName }, 'Player left');
    res.json({ handled: true });
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
    });
  });

  // Full social graph (all bots, all players) — direct from main thread
  app.get('/api/relationships', (_req: Request, res: Response) => {
    const allAffinities = botManager.getAffinityManager().getAll();
    res.json({ relationships: allAffinities });
  });

  // Global skill library — read from disk
  app.get('/api/skills', (_req: Request, res: Response) => {
    try {
      const indexPath = path.join(process.cwd(), 'skills', 'index.json');
      if (!fs.existsSync(indexPath)) {
        res.json({ skills: [], count: 0 });
        return;
      }
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const skills = Object.keys(index).map((name) => {
        const skillPath = path.join(process.cwd(), 'skills', `${name}.js`);
        const code = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf-8').slice(0, 2000) : null;
        return { name, code };
      });
      res.json({ skills, count: skills.length });
    } catch {
      res.json({ skills: [], count: 0 });
    }
  });

  // Single skill with code — read from disk
  app.get('/api/skills/:name', (req: Request, res: Response) => {
    const skillName = req.params.name as string;
    const skillPath = path.join(process.cwd(), 'skills', `${skillName}.js`);
    if (!fs.existsSync(skillPath)) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    const code = fs.readFileSync(skillPath, 'utf-8');
    res.json({ name: skillName, code });
  });

  // ═══════════════════════════════════════
  //  DIAGNOSTICS
  // ═══════════════════════════════════════

  // Bot diagnostics — "Why is this bot stuck?"
  app.get('/api/bots/:name/diagnostics', (req: Request, res: Response) => {
    const botName = req.params.name as string;
    const handle = botManager.getWorker(botName);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    const diag = handle.getCachedDiagnostics();
    const detailed = handle.getCachedDetailedStatus();
    const workerAlive = handle.isAlive();

    // Build structured diagnostic report
    const now = Date.now();
    const checks: Array<{
      id: string;
      label: string;
      status: 'ok' | 'warn' | 'error';
      detail: string;
    }> = [];

    // 1. Connection status
    const connected = workerAlive && diag?.connected !== false && diag?.state !== 'DISCONNECTED';
    checks.push({
      id: 'connection',
      label: 'Connection',
      status: connected ? 'ok' : 'error',
      detail: connected ? 'Bot is connected to the server' : 'Bot is disconnected or worker thread is dead',
    });

    // 2. Health check
    const health = diag?.health ?? detailed?.health ?? 0;
    const food = diag?.food ?? detailed?.food ?? 0;
    checks.push({
      id: 'health',
      label: 'Health',
      status: health <= 0 ? 'error' : health <= 6 ? 'warn' : 'ok',
      detail: health <= 0 ? 'Bot is dead (0 HP)' : health <= 6 ? `Low health (${health}/20)` : `${health}/20 HP`,
    });
    checks.push({
      id: 'hunger',
      label: 'Hunger',
      status: food <= 0 ? 'error' : food <= 6 ? 'warn' : 'ok',
      detail: food <= 0 ? 'Starving (0 food)' : food <= 6 ? `Low hunger (${food}/20)` : `${food}/20 food`,
    });

    // 3. Voyager loop state
    const voyager = diag?.voyager ?? null;
    if (voyager) {
      // Paused check
      checks.push({
        id: 'voyager_paused',
        label: 'Voyager Loop',
        status: !voyager.isRunning ? 'error' : voyager.isPaused ? 'warn' : 'ok',
        detail: !voyager.isRunning
          ? 'Voyager loop is not running'
          : voyager.isPaused
            ? 'Voyager loop is paused'
            : 'Voyager loop is running',
      });

      // Current task stale check (>30 min)
      const lastExec = voyager.lastExecution;
      const taskAge = lastExec?.timestamp ? now - lastExec.timestamp : null;
      const staleThresholdMs = 30 * 60 * 1000; // 30 minutes
      const isTaskStale = voyager.currentTask && taskAge !== null && taskAge > staleThresholdMs;
      if (voyager.currentTask) {
        checks.push({
          id: 'task_stale',
          label: 'Current Task',
          status: isTaskStale ? 'warn' : 'ok',
          detail: isTaskStale
            ? `Task "${voyager.currentTask}" has been running for ${Math.round((taskAge ?? 0) / 60000)} min (stale >30 min)`
            : `Working on: "${voyager.currentTask}"`,
        });
      }

      // Last execution success
      if (lastExec) {
        checks.push({
          id: 'last_execution',
          label: 'Last Execution',
          status: lastExec.success ? 'ok' : 'warn',
          detail: lastExec.success
            ? `Task "${lastExec.task}" succeeded (attempt ${lastExec.attempt})`
            : `Task "${lastExec.task}" failed on attempt ${lastExec.attempt}`,
        });
      }
    } else {
      checks.push({
        id: 'voyager_paused',
        label: 'Voyager Loop',
        status: 'warn',
        detail: 'No voyager loop instance (bot may be in primitive mode)',
      });
    }

    // 4. Instinct / combat override
    const instinctActive = diag?.instinctActive ?? false;
    if (instinctActive) {
      checks.push({
        id: 'instinct',
        label: 'Combat Instinct',
        status: 'warn',
        detail: `Instinct active: ${diag?.instinctReason ?? 'unknown reason'} -- voyager is paused while fighting/fleeing`,
      });
    }

    // 5. Bot state
    const state = diag?.state ?? detailed?.state ?? 'UNKNOWN';
    if (state === 'SPAWNING') {
      checks.push({
        id: 'state',
        label: 'Bot State',
        status: 'warn',
        detail: 'Bot is still spawning',
      });
    } else if (state === 'IDLE' && voyager && !voyager.isPaused && voyager.isRunning && !voyager.currentTask) {
      checks.push({
        id: 'state',
        label: 'Bot State',
        status: 'ok',
        detail: 'Idle -- waiting for next task from curriculum',
      });
    }

    // 6. Recent failures
    const recentFails = diag?.recentFailedTasks ?? [];
    if (recentFails.length > 0) {
      checks.push({
        id: 'recent_failures',
        label: 'Recent Failures',
        status: recentFails.length >= 3 ? 'warn' : 'ok',
        detail: recentFails.length >= 3
          ? `${recentFails.length} recently failed tasks -- bot may be stuck on impossible goals`
          : `${recentFails.length} failed task(s)`,
      });
    }

    // Build recovery actions
    const actions: Array<{
      id: string;
      label: string;
      description: string;
      available: boolean;
      endpoint: string;
      method: string;
    }> = [];

    if (voyager?.isPaused) {
      actions.push({
        id: 'resume_voyager',
        label: 'Resume Voyager',
        description: 'Unpause the voyager loop so the bot continues working on tasks',
        available: connected,
        endpoint: `/api/bots/${botName}/resume`,
        method: 'POST',
      });
    }

    if (voyager?.currentTask) {
      actions.push({
        id: 'run_unstuck',
        label: 'Run Unstuck',
        description: 'Queue an unstuck task to break the bot out of its current situation',
        available: connected,
        endpoint: `/api/bots/${botName}/task`,
        method: 'POST',
      });
    }

    if (!connected && workerAlive) {
      actions.push({
        id: 'reconnect',
        label: 'Reconnect',
        description: 'Remove and re-create the bot to force a fresh connection',
        available: true,
        endpoint: `/api/bots/${botName}`,
        method: 'DELETE',
      });
    }

    const overallStatus: 'ok' | 'warn' | 'error' =
      checks.some((c) => c.status === 'error') ? 'error'
      : checks.some((c) => c.status === 'warn') ? 'warn'
      : 'ok';

    res.json({
      botName,
      timestamp: now,
      overallStatus,
      checks,
      actions,
      raw: {
        state,
        connected,
        health,
        food,
        instinctActive,
        voyagerRunning: voyager?.isRunning ?? false,
        voyagerPaused: voyager?.isPaused ?? false,
        currentTask: voyager?.currentTask ?? null,
        queuedTaskCount: voyager?.queuedTaskCount ?? 0,
        recentFailedTasks: recentFails,
        lastExecution: voyager?.lastExecution ?? null,
      },
    });
  });

  // Aggregate world state — from first bot's cached detailed status
  app.get('/api/world', (_req: Request, res: Response) => {
    const workers = botManager.getAllWorkers();
    for (const w of workers) {
      const detailed = w.getCachedDetailedStatus();
      if (detailed?.world) {
        const timeOfDay = detailed.world.timeOfDay;
        res.json({
          timeOfDay,
          timeOfDayTicks: null,
          day: null,
          isRaining: detailed.world.isRaining,
          onlineBots: workers.filter((h) => h.isAlive()).length,
        });
        return;
      }
    }
    res.json({ timeOfDay: null, day: null, isRaining: null, onlineBots: 0 });
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

  // Queue a task for a bot (from dashboard) — forward to worker
  app.post('/api/bots/:name/task', (req: Request, res: Response) => {
    const { description, prepend } = req.body;
    if (!description) {
      res.status(400).json({ error: 'description is required' });
      return;
    }
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    handle.sendCommand('queueTask', { description, source: 'dashboard', prepend: !!prepend });

    const event = eventLog.push({
      type: 'bot:task',
      botName: req.params.name as string,
      description: `Task ${prepend ? 'prepended' : 'queued'}: ${description}`,
      metadata: { source: 'dashboard', prepend: !!prepend },
    });
    io.emit('bot:task', { bot: req.params.name, task: description, status: 'queued' });
    io.emit('activity', event);

    res.json({ success: true });
  });

  // Reorder a bot's task queue
  app.put('/api/bots/:name/mission-queue', (req: Request, res: Response) => {
    const { order } = req.body;
    if (!Array.isArray(order)) {
      res.status(400).json({ error: 'order must be an array of task descriptions' });
      return;
    }
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    handle.sendCommand('reorderQueue', { order });
    res.json({ success: true });
  });

  // Clear a bot's task queue
  app.delete('/api/bots/:name/mission-queue', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    handle.sendCommand('clearQueue', {});

    const event = eventLog.push({
      type: 'bot:task',
      botName: req.params.name as string,
      description: 'Task queue cleared',
      metadata: { source: 'dashboard' },
    });
    io.emit('activity', event);

    res.json({ success: true });
  });

  // Set a swarm directive from dashboard/UI
  app.post('/api/swarm', async (req: Request, res: Response) => {
    const { description, requestedBy } = req.body;
    if (!description) {
      res.status(400).json({ error: 'description is required' });
      return;
    }
    await botManager.handleSwarmDirective(description, requestedBy || 'dashboard');

    const event = eventLog.push({
      type: 'swarm:directive',
      botName: 'swarm',
      description: `Swarm directive set: ${description}`,
      metadata: { requestedBy: requestedBy || 'dashboard' },
    });
    io.emit('activity', event);
    res.json({ success: true });
  });

  // ═══════════════════════════════════════
  //  COMMANDER ENDPOINTS
  // ═══════════════════════════════════════

  // Commander history (persisted)
  app.get('/api/commander/history', (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    res.json({ entries: commanderService.getHistory(Number.isFinite(limit) ? limit : 20) });
  });

  // Commander parse (NL → plan)
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

  // Commander execute plan
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
      res.json(result);
    } catch (err: any) {
      logger.error({ err }, 'Commander execute failed');
      res.status(500).json({ error: err.message });
    }
  });

  // Commander drafts — list
  app.get('/api/commander/drafts', (_req: Request, res: Response) => {
    res.json({ drafts: commanderService.getDrafts() });
  });

  // Commander drafts — create or update
  app.post('/api/commander/drafts', (req: Request, res: Response) => {
    const { input, plan, notes, id } = req.body;
    if (!input || typeof input !== 'string' || !input.trim()) {
      res.status(400).json({ error: 'input is required' });
      return;
    }
    const draft = commanderService.saveDraft({ input: input.trim(), plan, notes, id });
    res.status(201).json({ draft });
  });

  // Commander drafts — delete
  app.delete('/api/commander/drafts/:id', (req: Request, res: Response) => {
    const deleted = commanderService.deleteDraft(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    res.json({ success: true });
  });

  return { app, httpServer, io, eventLog, commanderService };
}
