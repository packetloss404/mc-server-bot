import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { EventLog } from './EventLog';
import { logger } from '../util/logger';

export interface APIServerResult {
  app: express.Application;
  httpServer: http.Server;
  io: SocketIOServer;
  eventLog: EventLog;
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
    io.emit('bot:task', { bot: req.params.name, task: description, status: 'queued' });
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

      // ── Commander metrics (from persisted data if available) ──
      let commanderMetrics = { parseCount: 0, avgConfidence: 0, failureRate: 0 };
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

  return { app, httpServer, io, eventLog };
}
