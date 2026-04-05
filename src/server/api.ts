import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { EventLog } from './EventLog';
import { CommanderService } from '../control/CommanderService';
import { RoutineManager } from '../control/RoutineManager';
import { TemplateManager } from '../control/TemplateManager';
import { logger } from '../util/logger';

export interface APIServerResult {
  app: express.Application;
  httpServer: http.Server;
  io: SocketIOServer;
  eventLog: EventLog;
  commanderService: CommanderService;
  routineManager: RoutineManager;
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

  // ── Routine manager (agent 2-1) ──
  const routineManager = new RoutineManager(botManager);

  // ── Template manager (agent 2-2) ──
  const templateManager = new TemplateManager();

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

    const botName = req.params.name as string;
    const event = eventLog.push({
      type: 'bot:mode',
      botName,
      description: `${botName} mode changed to ${mode}`,
      metadata: { mode },
    });
    io.emit('bot:mode', { bot: botName, mode });
    io.emit('activity', event);

    res.json({ success: true, mode });
  });

  // Event relay endpoints (for Java plugin)
  app.post('/api/events/chat', (req: Request, res: Response) => {
    const { playerName, message, nearestBot, position } = req.body;
    const handle = nearestBot ? botManager.getWorker(nearestBot) : null;

    // If position is provided by the plugin, broadcast it
    if (playerName && position && position.x != null) {
      io.emit('player:position', {
        name: playerName,
        x: position.x,
        y: position.y,
        z: position.z,
      });
    }

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
    io.emit('player:join', { name: playerName });
    const event = eventLog.push({
      type: 'player:join',
      botName: '',
      description: `${playerName} joined the server`,
      metadata: { player: playerName },
    });
    io.emit('activity', event);
    res.json({ handled: true });
  });

  app.post('/api/events/player-leave', (req: Request, res: Response) => {
    const { playerName } = req.body;
    logger.info({ player: playerName }, 'Player left');
    io.emit('player:leave', { name: playerName });
    const event = eventLog.push({
      type: 'player:leave',
      botName: '',
      description: `${playerName} left the server`,
      metadata: { player: playerName },
    });
    io.emit('activity', event);
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
    io.emit('bot:chat', {
      bot: req.params.name as string,
      playerName,
      message,
      timestamp: Date.now(),
    });
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

    // Capture step if recording a routine
    if (routineManager.isRecording()) {
      routineManager.captureStep({
        type: 'mission',
        data: { description },
      });
    }

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

  // ═══════════════════════════════════════
  //  METRICS ENDPOINT
  // ═══════════════════════════════════════

  app.get('/api/metrics', (_req: Request, res: Response) => {
    try {
      const workers = botManager.getAllWorkers();
      const statuses = botManager.getAllBotStatuses();

      // ── Bot overview ──
      const totalBots = workers.length;
      const aliveBots = workers.filter((w) => w.isAlive()).length;
      const idleBots = statuses.filter((s: any) => s.state === 'IDLE').length;
      const workingBots = statuses.filter((s: any) => s.state === 'EXECUTING_TASK').length;

      // ── Bot states breakdown ──
      const stateBreakdown: Record<string, number> = {};
      for (const s of statuses) {
        const state = (s as any).state || 'UNKNOWN';
        stateBreakdown[state] = (stateBreakdown[state] || 0) + 1;
      }

      // ── Personality breakdown ──
      const personalityBreakdown: Record<string, number> = {};
      for (const s of statuses) {
        const p = (s as any).personality || 'unknown';
        personalityBreakdown[p] = (personalityBreakdown[p] || 0) + 1;
      }

      // ── Task metrics (from detailed statuses) ──
      let totalCompleted = 0;
      let totalFailed = 0;
      let totalQueued = 0;
      let activeTasks = 0;
      const botTaskStats: Array<{ name: string; personality: string; completed: number; failed: number; queued: number; currentTask: string | null }> = [];

      for (const w of workers) {
        const detailed = w.getCachedDetailedStatus();
        const name = w.botName;
        const personality = w.personality;
        const completed = detailed?.voyager?.completedTasks?.length || 0;
        const failed = detailed?.voyager?.failedTasks?.length || 0;
        const queued = detailed?.voyager?.queuedTaskCount || 0;
        const currentTask = detailed?.voyager?.currentTask || null;

        totalCompleted += completed;
        totalFailed += failed;
        totalQueued += queued;
        if (currentTask) activeTasks++;

        botTaskStats.push({ name, personality, completed, failed, queued, currentTask });
      }

      const totalTasks = totalCompleted + totalFailed;
      const taskSuccessRate = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

      // ── Command metrics (from persisted data if available) ──
      let commandMetrics = { total: 0, succeeded: 0, failed: 0, pending: 0, cancelled: 0, successRate: 0 };
      try {
        const cmdPath = path.join(process.cwd(), 'data', 'commands.json');
        if (fs.existsSync(cmdPath)) {
          const cmdData = JSON.parse(fs.readFileSync(cmdPath, 'utf-8'));
          const commands = cmdData.commands || [];
          commandMetrics.total = commands.length;
          commandMetrics.succeeded = commands.filter((c: any) => c.status === 'completed').length;
          commandMetrics.failed = commands.filter((c: any) => c.status === 'failed').length;
          commandMetrics.pending = commands.filter((c: any) => c.status === 'pending' || c.status === 'running').length;
          commandMetrics.cancelled = commands.filter((c: any) => c.status === 'cancelled').length;
          commandMetrics.successRate = commandMetrics.total > 0
            ? Math.round((commandMetrics.succeeded / commandMetrics.total) * 100) : 0;
        }
      } catch { /* ignore */ }

      // ── Mission metrics (from persisted data if available) ──
      let missionMetrics = { total: 0, active: 0, completed: 0, failed: 0, paused: 0, completionRate: 0, byType: {} as Record<string, number> };
      try {
        const msnPath = path.join(process.cwd(), 'data', 'missions.json');
        if (fs.existsSync(msnPath)) {
          const msnData = JSON.parse(fs.readFileSync(msnPath, 'utf-8'));
          const missions = msnData.missions || [];
          missionMetrics.total = missions.length;
          missionMetrics.active = missions.filter((m: any) => m.status === 'running').length;
          missionMetrics.completed = missions.filter((m: any) => m.status === 'completed').length;
          missionMetrics.failed = missions.filter((m: any) => m.status === 'failed').length;
          missionMetrics.paused = missions.filter((m: any) => m.status === 'paused').length;
          missionMetrics.completionRate = missionMetrics.total > 0
            ? Math.round((missionMetrics.completed / missionMetrics.total) * 100) : 0;
          for (const m of missions) {
            const t = m.type || 'unknown';
            missionMetrics.byType[t] = (missionMetrics.byType[t] || 0) + 1;
          }
        }
      } catch { /* ignore */ }

      // ── Commander metrics ──
      let commanderMetrics = { parseCount: 0, avgConfidence: 0, failureRate: 0 };
      try {
        const csMetrics = commanderService.getMetrics();
        commanderMetrics.parseCount = csMetrics.totalParses;
        commanderMetrics.avgConfidence = csMetrics.averageConfidence
          ? Math.round(csMetrics.averageConfidence * 100)
          : 0;
        commanderMetrics.failureRate = csMetrics.totalParses > 0
          ? Math.round((csMetrics.failedParses / csMetrics.totalParses) * 100)
          : 0;
      } catch {
        // Fallback: read from persisted data
        try {
          const cmdPath = path.join(process.cwd(), 'data', 'commands.json');
          if (fs.existsSync(cmdPath)) {
            const cmdData = JSON.parse(fs.readFileSync(cmdPath, 'utf-8'));
            const commands = cmdData.commands || [];
            const parsed = commands.filter((c: any) => c.source === 'commander' || c.parsedPlan);
            commanderMetrics.parseCount = parsed.length;
            const confidences = parsed.map((c: any) => c.confidence ?? c.parsedPlan?.confidence).filter((c: any) => typeof c === 'number');
            commanderMetrics.avgConfidence = confidences.length > 0
              ? Math.round(confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length) : 0;
            const cmdFailed = parsed.filter((c: any) => c.status === 'failed').length;
            commanderMetrics.failureRate = parsed.length > 0
              ? Math.round((cmdFailed / parsed.length) * 100) : 0;
          }
        } catch { /* ignore */ }
      }

      // ── Fleet metrics ──
      let fleetMetrics = { botsByRole: {} as Record<string, number>, overrideCount: 0, activeSquads: 0, totalSquads: 0 };
      try {
        const rolesPath = path.join(process.cwd(), 'data', 'roles.json');
        if (fs.existsSync(rolesPath)) {
          const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf-8'));
          const assignments = rolesData.assignments || [];
          for (const a of assignments) {
            const role = a.role || 'unassigned';
            fleetMetrics.botsByRole[role] = (fleetMetrics.botsByRole[role] || 0) + 1;
            if (a.manualOverride) fleetMetrics.overrideCount++;
          }
        }
      } catch { /* ignore */ }
      try {
        const squadsPath = path.join(process.cwd(), 'data', 'squads.json');
        if (fs.existsSync(squadsPath)) {
          const squadsData = JSON.parse(fs.readFileSync(squadsPath, 'utf-8'));
          const squads = squadsData.squads || [];
          fleetMetrics.totalSquads = squads.length;
          fleetMetrics.activeSquads = squads.filter((s: any) => s.members && s.members.length > 0).length;
        }
      } catch { /* ignore */ }

      // ── Skill metrics ──
      let skillCount = 0;
      try {
        const indexPath = path.join(process.cwd(), 'skills', 'index.json');
        if (fs.existsSync(indexPath)) {
          const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
          skillCount = Object.keys(index).length;
        }
      } catch { /* ignore */ }

      // ── Health summary ──
      const healthStats: Array<{ name: string; health: number; food: number }> = [];
      for (const w of workers) {
        const detailed = w.getCachedDetailedStatus();
        if (detailed) {
          healthStats.push({
            name: w.botName,
            health: detailed.health ?? 20,
            food: detailed.food ?? 20,
          });
        }
      }

      res.json({
        timestamp: Date.now(),
        bots: {
          total: totalBots,
          alive: aliveBots,
          idle: idleBots,
          working: workingBots,
          stateBreakdown,
          personalityBreakdown,
          healthStats,
        },
        tasks: {
          totalCompleted,
          totalFailed,
          totalQueued,
          activeTasks,
          successRate: taskSuccessRate,
          botTaskStats,
        },
        commands: commandMetrics,
        missions: missionMetrics,
        commander: commanderMetrics,
        fleet: fleetMetrics,
        skills: { count: skillCount },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to gather metrics');
      res.status(500).json({ error: 'Failed to gather metrics' });
    }
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

  // Commander clarify (agent 2-9 — re-parse with answered clarification questions)
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
      // If the CommanderService supports parseWithClarification, use it;
      // otherwise fall back to a plain re-parse with the enriched input.
      const plan = commanderService.parseWithClarification
        ? await commanderService.parseWithClarification(originalInput.trim(), clarifications)
        : await commanderService.parse(
            originalInput.trim() + ' [clarifications: ' + JSON.stringify(clarifications) + ']',
          );

      const event = eventLog.push({
        type: 'commander:clarify',
        botName: 'system',
        description: `Commander re-parsed with clarification: "${originalInput.trim().slice(0, 60)}"`,
        metadata: { planId: plan.id, intent: plan.intent, confidence: plan.confidence },
      });
      io.emit('activity', event);

      res.json({ plan });
    } catch (err: any) {
      logger.error({ err, originalInput }, 'Commander clarification failed');
      res.status(500).json({ error: err.message || 'Clarification failed' });
    }
  });

  // Commander suggestions (agent 2-9 / 2-10)
  app.get('/api/commander/suggestions', (_req: Request, res: Response) => {
    if (commanderService.getSuggestedCommands) {
      res.json({ suggestions: commanderService.getSuggestedCommands() });
    } else {
      res.json({ suggestions: [] });
    }
  });

  // ═══════════════════════════════════════
  //  ROUTINE (MACRO) ENDPOINTS — agent 2-1
  // ═══════════════════════════════════════

  // List all routines
  app.get('/api/routines', (_req: Request, res: Response) => {
    res.json({ routines: routineManager.list() });
  });

  // Create routine
  app.post('/api/routines', (req: Request, res: Response) => {
    const { name, description, steps } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const routine = routineManager.create({ name, description, steps });
    res.status(201).json({ routine });
  });

  // Recording routes (must come before :id routes to avoid param capture)
  app.get('/api/routines/recording/status', (_req: Request, res: Response) => {
    res.json({
      recording: routineManager.isRecording(),
      draft: routineManager.getRecordingDraft(),
    });
  });

  app.post('/api/routines/recording/start', (req: Request, res: Response) => {
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    try {
      const draft = routineManager.startRecording(name);
      res.json({ draft });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/routines/recording/stop', (req: Request, res: Response) => {
    const { save } = req.body;
    const routine = routineManager.stopRecording(save !== false);
    res.json({ routine, saved: save !== false });
  });

  // Get single routine
  app.get('/api/routines/:id', (req: Request, res: Response) => {
    const routine = routineManager.get(req.params.id as string);
    if (!routine) {
      res.status(404).json({ error: 'Routine not found' });
      return;
    }
    res.json({ routine });
  });

  // Update routine
  app.put('/api/routines/:id', (req: Request, res: Response) => {
    const { name, description, steps } = req.body;
    const updated = routineManager.update(req.params.id as string, { name, description, steps });
    if (!updated) {
      res.status(404).json({ error: 'Routine not found' });
      return;
    }
    res.json({ routine: updated });
  });

  // Delete routine
  app.delete('/api/routines/:id', (req: Request, res: Response) => {
    const deleted = routineManager.delete(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: 'Routine not found' });
      return;
    }
    res.json({ success: true });
  });

  // Execute routine
  app.post('/api/routines/:id/execute', async (req: Request, res: Response) => {
    const { botNames } = req.body;
    if (!botNames || !Array.isArray(botNames) || botNames.length === 0) {
      res.status(400).json({ error: 'botNames (string[]) is required' });
      return;
    }
    try {
      const execution = await routineManager.execute(req.params.id as string, botNames);

      const event = eventLog.push({
        type: 'routine:execute',
        botName: botNames.join(', '),
        description: `Routine "${execution.routineName}" executed on ${botNames.join(', ')}`,
        metadata: { routineId: req.params.id, status: execution.status },
      });
      io.emit('activity', event);

      res.json({ execution });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════
  //  TEMPLATE ENDPOINTS — agent 2-2
  // ═══════════════════════════════════════

  // List all templates (optionally filter by category)
  app.get('/api/templates', (req: Request, res: Response) => {
    const category = req.query.category ? String(req.query.category) : undefined;
    const templates = category
      ? templateManager.getByCategory(category)
      : templateManager.getAll();
    res.json({ templates });
  });

  // Get single template
  app.get('/api/templates/:id', (req: Request, res: Response) => {
    const template = templateManager.getById(req.params.id as string);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json({ template });
  });

  // Create custom template
  app.post('/api/templates', (req: Request, res: Response) => {
    const { id, name, description, category, missionType, defaultParams, requiredFields, optionalFields, suggestedBotCount, loadoutPolicy } = req.body;
    if (!id || !name || !missionType) {
      res.status(400).json({ error: 'id, name, and missionType are required' });
      return;
    }
    if (templateManager.getById(id)) {
      res.status(409).json({ error: 'Template with this id already exists' });
      return;
    }
    const template = templateManager.create({
      id,
      name,
      description: description || '',
      category: category || 'gathering',
      missionType,
      defaultParams: defaultParams || {},
      requiredFields: requiredFields || [],
      optionalFields: optionalFields || [],
      suggestedBotCount: suggestedBotCount ?? 1,
      loadoutPolicy,
    });
    res.status(201).json({ template });
  });

  // Update custom template
  app.patch('/api/templates/:id', (req: Request, res: Response) => {
    const { id: _id, builtIn: _bi, ...patch } = req.body;
    const updated = templateManager.update(req.params.id as string, patch);
    if (!updated) {
      res.status(404).json({ error: 'Template not found or is built-in' });
      return;
    }
    res.json({ template: updated });
  });

  // Delete custom template
  app.delete('/api/templates/:id', (req: Request, res: Response) => {
    const deleted = templateManager.delete(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: 'Template not found or is built-in' });
      return;
    }
    res.json({ success: true });
  });

  // Create mission from template — fills params, builds task, queues to bot(s)
  app.post('/api/templates/:id/execute', (req: Request, res: Response) => {
    const { params, assignees, priority } = req.body;
    const templateId = req.params.id as string;
    const template = templateManager.getById(templateId);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    // Validate required fields
    const missing = template.requiredFields
      .filter((f: any) => f.required !== false)
      .filter((f: any) => !params || params[f.name] === undefined || params[f.name] === '');
    if (missing.length > 0) {
      res.status(400).json({
        error: 'Missing required fields',
        fields: missing.map((f: any) => f.name),
      });
      return;
    }

    const botNames: string[] = Array.isArray(assignees) ? assignees : assignees ? [assignees] : [];
    if (botNames.length === 0) {
      res.status(400).json({ error: 'At least one assignee (bot name) is required' });
      return;
    }

    const taskDesc = templateManager.buildTaskDescription(templateId, params || {});
    if (!taskDesc) {
      res.status(500).json({ error: 'Failed to build task description' });
      return;
    }

    const results: { bot: string; queued: boolean; error?: string }[] = [];
    for (const botName of botNames) {
      const handle = botManager.getWorker(botName);
      if (!handle) {
        results.push({ bot: botName, queued: false, error: 'Bot not found' });
        continue;
      }
      handle.sendCommand('queueTask', { description: taskDesc, source: 'template', priority: priority || 'normal' });

      const event = eventLog.push({
        type: 'bot:task',
        botName,
        description: `Template mission: ${template.name} — ${taskDesc}`,
        metadata: { source: 'template', templateId, priority: priority || 'normal' },
      });
      io.emit('bot:task', { bot: botName, task: taskDesc, status: 'queued' });
      io.emit('activity', event);

      results.push({ bot: botName, queued: true });
    }

    res.json({
      success: true,
      template: template.name,
      taskDescription: taskDesc,
      loadoutPolicy: template.loadoutPolicy || null,
      results,
    });
  });

  // ═══════════════════════════════════════
  //  COMMANDER — Templates, Suggestions, Routines (agent 2-10)
  // ═══════════════════════════════════════

  // Commander templates are served from the CommanderService if it supports them.
  // These endpoints provide template browsing, fill, and routine CRUD.

  app.get('/api/commander/templates', (req: Request, res: Response) => {
    const { category, q } = req.query;
    const svc = commanderService as any;
    if (typeof svc.searchTemplates === 'function' && q) {
      res.json({ templates: svc.searchTemplates(String(q)) });
      return;
    }
    if (typeof svc.getTemplatesByCategory === 'function' && category) {
      res.json({ templates: svc.getTemplatesByCategory(String(category)) });
      return;
    }
    if (typeof svc.getTemplates === 'function') {
      res.json({ templates: svc.getTemplates() });
      return;
    }
    res.json({ templates: [] });
  });

  app.post('/api/commander/templates/fill', (req: Request, res: Response) => {
    const { templateId, values } = req.body;
    if (!templateId) {
      res.status(400).json({ error: 'templateId is required' });
      return;
    }
    const svc = commanderService as any;
    if (typeof svc.fillTemplate === 'function') {
      const text = svc.fillTemplate(templateId, values || {});
      if (!text) {
        res.status(404).json({ error: 'Template not found' });
        return;
      }
      res.json({ text });
      return;
    }
    res.status(501).json({ error: 'Template fill not implemented' });
  });

  app.get('/api/commander/routines', (_req: Request, res: Response) => {
    const svc = commanderService as any;
    if (typeof svc.getRoutines === 'function') {
      res.json({ routines: svc.getRoutines() });
      return;
    }
    res.json({ routines: [] });
  });

  app.post('/api/commander/routines', (req: Request, res: Response) => {
    const { name, description, steps } = req.body;
    if (!name || !steps || !Array.isArray(steps)) {
      res.status(400).json({ error: 'name and steps[] are required' });
      return;
    }
    const svc = commanderService as any;
    if (typeof svc.createRoutine === 'function') {
      const routine = svc.createRoutine(name, description || '', steps);
      res.status(201).json({ routine });
      return;
    }
    res.status(501).json({ error: 'Commander routines not implemented' });
  });

  app.delete('/api/commander/routines/:id', (req: Request, res: Response) => {
    const svc = commanderService as any;
    if (typeof svc.deleteRoutine === 'function') {
      const deleted = svc.deleteRoutine(req.params.id as string);
      if (!deleted) {
        res.status(404).json({ error: 'Routine not found' });
        return;
      }
      res.json({ success: true });
      return;
    }
    res.status(501).json({ error: 'Commander routines not implemented' });
  });

  app.get('/api/commander/routines/:id/expand', (req: Request, res: Response) => {
    const svc = commanderService as any;
    if (typeof svc.expandRoutine === 'function') {
      const commands = svc.expandRoutine(req.params.id as string);
      if (!commands) {
        res.status(404).json({ error: 'Routine not found' });
        return;
      }
      res.json({ commands });
      return;
    }
    res.status(501).json({ error: 'Commander routines not implemented' });
  });

  return { app, httpServer, io, eventLog, commanderService, routineManager };
}
