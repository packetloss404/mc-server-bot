import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { EventLog } from './EventLog';
import { CommanderService } from '../control/CommanderService';
import { CommandCenter } from '../control/CommandCenter';
import { MissionManager } from '../control/MissionManager';
import { MarkerStore } from '../control/MarkerStore';
import { SquadManager } from '../control/SquadManager';
import { RoleManager } from '../control/RoleManager';
import { TemplateManager } from '../control/TemplateManager';
import { RoutineManager } from '../control/RoutineManager';
import { BuildCoordinator } from '../build/BuildCoordinator';
import { ChainCoordinator } from '../supplychain/ChainCoordinator';
import { logger } from '../util/logger';

export interface APIServerResult {
  app: express.Application;
  httpServer: http.Server;
  io: SocketIOServer;
  eventLog: EventLog;
  commanderService: CommanderService;
  commandCenter: CommandCenter;
  missionManager: MissionManager;
  markerStore: MarkerStore;
  squadManager: SquadManager;
  roleManager: RoleManager;
  templateManager: TemplateManager;
  routineManager: RoutineManager;
  buildCoordinator: BuildCoordinator;
  chainCoordinator: ChainCoordinator;
}

export function createAPIServer(botManager: BotManager): APIServerResult {
  const app = express();
  const httpServer = http.createServer(app);

  // CORS — allow the Next.js dev server and common local ports
  app.use(cors({
    origin: true,
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

  // ── Commander service (persisted to data/commander-history.json) ──
  const commanderService = new CommanderService({
    llmClient: null, // LLM wired later if available
  });

  // Socket.IO
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: true,
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Dashboard client connected');
    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Dashboard client disconnected');
    });
  });

  // ── Build & Supply Chain coordinators ──
  const buildCoordinator = new BuildCoordinator(botManager, io, eventLog);
  const chainCoordinator = new ChainCoordinator(botManager, io, eventLog);

  // ── Control platform: wire managers in dependency order ──
  const markerStore = new MarkerStore(io);
  const squadManager = new SquadManager(io);
  const roleManager = new RoleManager(io);
  const templateManager = new TemplateManager();
  const routineManager = new RoutineManager(botManager);
  const commandCenter = new CommandCenter(botManager, io, markerStore);
  commandCenter.setRoleManager(roleManager);
  const missionManager = new MissionManager(botManager, io);
  missionManager.setCommandCenter(commandCenter);
  missionManager.setSquadManager(squadManager);
  roleManager.setMissionManager(missionManager);
  commanderService.setCommandCenter(commandCenter);
  commanderService.setMissionManager(missionManager);
  logger.info('Control platform wired: CommandCenter ↔ MissionManager ↔ Squad/Role/Marker/Template');

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

  // Global skill library — read from disk
  app.get('/api/skills', (_req: Request, res: Response) => {
    try {
      const indexPath = path.join(process.cwd(), 'skills', 'index.json');
      if (!fs.existsSync(indexPath)) {
        res.json({ skills: [], count: 0 });
        return;
      }
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      // index.json is an array of skill metadata objects (name, description, file, ...)
      const entries: any[] = Array.isArray(index) ? index : Object.values(index);
      const skills = entries.map((entry: any) => {
        const name: string = entry?.name ?? '';
        const fileName: string = entry?.file ?? `${name}.js`;
        const skillPath = path.join(process.cwd(), 'skills', fileName);
        const code = fs.existsSync(skillPath)
          ? fs.readFileSync(skillPath, 'utf-8').slice(0, 2000)
          : null;
        return {
          name,
          description: entry?.description ?? null,
          keywords: entry?.keywords ?? [],
          quality: entry?.quality ?? null,
          successCount: entry?.successCount ?? 0,
          failureCount: entry?.failureCount ?? 0,
          code,
        };
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
  // ═══════════════════════════════════════
  //  LLM USAGE ENDPOINT (TokenLedger)
  // ═══════════════════════════════════════

  // LLM settings and usage are managed via index.ts injection
  // Placeholder — real endpoints registered by registerLLMSettingsRoutes() below

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
      // CommandStatus values: 'queued' | 'started' | 'succeeded' | 'failed' | 'cancelled'
      let commandMetrics = { total: 0, succeeded: 0, failed: 0, pending: 0, cancelled: 0, successRate: 0 };
      try {
        const cmdPath = path.join(process.cwd(), 'data', 'commands.json');
        if (fs.existsSync(cmdPath)) {
          const cmdData = JSON.parse(fs.readFileSync(cmdPath, 'utf-8'));
          const commands = Array.isArray(cmdData) ? cmdData : (cmdData.commands || []);
          commandMetrics.total = commands.length;
          commandMetrics.succeeded = commands.filter((c: any) => c.status === 'succeeded').length;
          commandMetrics.failed = commands.filter((c: any) => c.status === 'failed').length;
          commandMetrics.pending = commands.filter((c: any) => c.status === 'queued' || c.status === 'started').length;
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
          const missions = Array.isArray(msnData) ? msnData : (msnData.missions || []);
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
            const commands = Array.isArray(cmdData) ? cmdData : (cmdData.commands || []);
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
      // RoleAssignmentRecord fields: id, botName, role, autonomyLevel, ...
      // SquadRecord fields: id, name, botNames, ...
      // Overrides are tracked separately in RoleManager (in-memory), not on the assignment record.
      let fleetMetrics = { botsByRole: {} as Record<string, number>, overrideCount: 0, activeSquads: 0, totalSquads: 0 };
      try {
        const rolesPath = path.join(process.cwd(), 'data', 'roles.json');
        if (fs.existsSync(rolesPath)) {
          const rolesData = JSON.parse(fs.readFileSync(rolesPath, 'utf-8'));
          const assignments = Array.isArray(rolesData) ? rolesData : (rolesData.assignments || []);
          for (const a of assignments) {
            const role = a.role || 'unassigned';
            fleetMetrics.botsByRole[role] = (fleetMetrics.botsByRole[role] || 0) + 1;
            // Note: manualOverride is not a field on RoleAssignmentRecord;
            // overrides are tracked in-memory by RoleManager.
          }
        }
      } catch { /* ignore */ }
      try {
        const squadsPath = path.join(process.cwd(), 'data', 'squads.json');
        if (fs.existsSync(squadsPath)) {
          const squadsData = JSON.parse(fs.readFileSync(squadsPath, 'utf-8'));
          // File may be a raw array or { squads: [...] }
          const squads = Array.isArray(squadsData) ? squadsData : (squadsData.squads || []);
          fleetMetrics.totalSquads = squads.length;
          // SquadRecord uses botNames, not members
          fleetMetrics.activeSquads = squads.filter((s: any) => (s.botNames || s.members || []).length > 0).length;
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

  // ═══════════════════════════════════════
  //  COMMANDER ENDPOINTS
  // ═══════════════════════════════════════

  // Commander history (persisted)
  app.get('/api/commander/history', (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    res.json({ entries: commanderService.getHistory(Number.isFinite(limit) ? limit : 20) });
  });

  // Commander parse (NL -> plan)
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
      res.json({ result });
    } catch (err: any) {
      logger.error({ err }, 'Commander execute failed');
      res.status(500).json({ error: err.message });
    }
  });

  // Commander drafts -- list
  app.get('/api/commander/drafts', (_req: Request, res: Response) => {
    res.json({ drafts: commanderService.getDrafts() });
  });

  // Commander drafts -- create or update
  app.post('/api/commander/drafts', (req: Request, res: Response) => {
    const { input, plan, notes, id } = req.body;
    if (!input || typeof input !== 'string' || !input.trim()) {
      res.status(400).json({ error: 'input is required' });
      return;
    }
    const draft = commanderService.saveDraft({ input: input.trim(), plan, notes, id });
    res.status(201).json({ draft });
  });

  // Commander drafts -- delete
  app.delete('/api/commander/drafts/:id', (req: Request, res: Response) => {
    const deleted = commanderService.deleteDraft(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    res.json({ success: true });
  });

  // Commander clarify (re-parse with answered clarification questions)
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

  // Commander suggestions
  app.get('/api/commander/suggestions', (_req: Request, res: Response) => {
    res.json({ suggestions: commanderService.getSuggestedCommands() });
  });

  // ═══════════════════════════════════════
  //  BUILD ENDPOINTS
  // ═══════════════════════════════════════

  // List available schematics
  app.get('/api/schematics', async (_req: Request, res: Response) => {
    try {
      const schematics = await buildCoordinator.listSchematics();
      res.json({ schematics });
    } catch (err: any) {
      logger.error({ err }, 'Failed to list schematics');
      res.status(500).json({ error: err.message });
    }
  });

  // Get a single schematic's metadata
  app.get('/api/schematics/:filename', async (req: Request, res: Response) => {
    try {
      const filename = decodeURIComponent(req.params.filename as string);
      const info = await buildCoordinator.getSchematicInfoAsync(filename);
      if (!info) {
        res.status(404).json({ error: 'Schematic not found' });
        return;
      }
      res.json({ schematic: info });
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to fetch schematic');
      res.status(500).json({ error: err.message });
    }
  });

  // List all build jobs
  app.get('/api/builds', (_req: Request, res: Response) => {
    res.json({ builds: buildCoordinator.getAllBuildJobs() });
  });

  // Create a new build job
  app.post('/api/builds', async (req: Request, res: Response) => {
    const { schematicFile, origin, botNames, options } = req.body;
    if (!schematicFile || !origin || !botNames || !Array.isArray(botNames) || botNames.length === 0) {
      res.status(400).json({ error: 'schematicFile, origin {x,y,z}, and botNames[] are required' });
      return;
    }
    try {
      const job = await buildCoordinator.startBuild(schematicFile, origin, botNames, options);
      res.status(201).json({ build: job });
    } catch (err: any) {
      logger.error({ err }, 'Failed to start build');
      res.status(400).json({ error: err.message });
    }
  });

  // Get a specific build job
  app.get('/api/builds/:id', (req: Request, res: Response) => {
    const job = buildCoordinator.getBuildJob(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: 'Build not found' });
      return;
    }
    res.json({ build: job });
  });

  // Cancel a build
  app.post('/api/builds/:id/cancel', (req: Request, res: Response) => {
    const success = buildCoordinator.cancelBuild(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Build not found or already finished' });
      return;
    }
    res.json({ success: true });
  });

  // Pause a build
  app.post('/api/builds/:id/pause', (req: Request, res: Response) => {
    const success = buildCoordinator.pauseBuild(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Build not found or not running' });
      return;
    }
    res.json({ success: true });
  });

  // Resume a build
  app.post('/api/builds/:id/resume', (req: Request, res: Response) => {
    const success = buildCoordinator.resumeBuild(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Build not found or not paused' });
      return;
    }
    res.json({ success: true });
  });

  // ═══════════════════════════════════════
  //  SUPPLY CHAIN ENDPOINTS
  // ═══════════════════════════════════════

  // List chain templates
  app.get('/api/chains/templates', (_req: Request, res: Response) => {
    res.json({ templates: chainCoordinator.getTemplates() });
  });

  // List all chains
  app.get('/api/chains', (_req: Request, res: Response) => {
    res.json({ chains: chainCoordinator.getAllChains() });
  });

  // Create a new chain
  app.post('/api/chains', (req: Request, res: Response) => {
    const { name, description, templateId, stages, loop, botAssignments, chestLocations } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    try {
      const chain = chainCoordinator.createChain({ name, description, templateId, stages, loop, botAssignments, chestLocations });
      res.status(201).json({ chain });
    } catch (err: any) {
      logger.error({ err }, 'Failed to create chain');
      res.status(400).json({ error: err.message });
    }
  });

  // Get a specific chain
  app.get('/api/chains/:id', (req: Request, res: Response) => {
    const chain = chainCoordinator.getChain(req.params.id as string);
    if (!chain) {
      res.status(404).json({ error: 'Chain not found' });
      return;
    }
    res.json({ chain });
  });

  // Start a chain
  app.post('/api/chains/:id/start', (req: Request, res: Response) => {
    const success = chainCoordinator.startChain(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Chain not found or already running' });
      return;
    }
    res.json({ success: true });
  });

  // Pause a chain
  app.post('/api/chains/:id/pause', (req: Request, res: Response) => {
    const success = chainCoordinator.pauseChain(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Chain not found or not running' });
      return;
    }
    res.json({ success: true });
  });

  // Cancel a chain
  app.post('/api/chains/:id/cancel', (req: Request, res: Response) => {
    const success = chainCoordinator.cancelChain(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Chain not found' });
      return;
    }
    res.json({ success: true });
  });

  // Delete a chain
  app.delete('/api/chains/:id', (req: Request, res: Response) => {
    const success = chainCoordinator.deleteChain(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Chain not found' });
      return;
    }
    res.json({ success: true });
  });

  // ═══════════════════════════════════════
  //  TERRAIN ENDPOINTS
  // ═══════════════════════════════════════

  // Scan blocks in a region around a position
  // Height-map probe around (cx, cz). Returns the top non-air block name at
  // each grid cell as a flat string[], matching the TerrainData frontend shape.
  app.get('/api/terrain', async (req: Request, res: Response) => {
    const cx = parseInt(String(req.query.cx ?? req.query.x ?? '0'));
    const cz = parseInt(String(req.query.cz ?? req.query.z ?? '0'));
    const radius = Math.min(parseInt(String(req.query.radius ?? '16')), 64);
    const step = Math.max(parseInt(String(req.query.step ?? '1')), 1);

    let probeHandle: any = null;
    for (const h of botManager.getAllWorkers() as any[]) {
      if (typeof h.isBotConnected === 'function' && (await h.isBotConnected())) {
        probeHandle = h;
        break;
      }
    }
    if (!probeHandle) {
      res.status(503).json({ error: 'No connected bot available to scan terrain' });
      return;
    }

    const size = Math.floor((2 * radius) / step) + 1;
    // Single IPC call — the worker iterates the grid internally for speed.
    const blocks = (await probeHandle.getTerrainGrid(cx, cz, radius, step, 120, -60)) ?? [];
    res.json({ cx, cz, radius, step, size, blocks });
  });

  // Get terrain height at a specific (x, z) column
  app.get('/api/terrain/height', async (req: Request, res: Response) => {
    const x = parseInt(String(req.query.x ?? '0'));
    const z = parseInt(String(req.query.z ?? '0'));
    const maxY = parseInt(String(req.query.maxY ?? '320'));
    const minY = parseInt(String(req.query.minY ?? '-64'));

    let probeHandle: any = null;
    for (const h of botManager.getAllWorkers() as any[]) {
      if (typeof h.isBotConnected === 'function' && (await h.isBotConnected())) {
        probeHandle = h;
        break;
      }
    }
    if (!probeHandle) {
      res.status(503).json({ error: 'No connected bot available to scan terrain' });
      return;
    }

    // Scan downward to find the first solid block
    for (let y = maxY; y >= minY; y--) {
      const block = await probeHandle.getBlockAt(x, y, z);
      if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
        res.json({ x, z, height: y, surfaceBlock: block.name });
        return;
      }
    }
    res.json({ x, z, height: null, surfaceBlock: null });
  });

  // ═══════════════════════════════════════
  //  CONTROL PLATFORM ENDPOINTS
  //  (MarkerStore, SquadManager, RoleManager,
  //   MissionManager, CommandCenter, TemplateManager)
  // ═══════════════════════════════════════

  // ── Markers ──
  app.get('/api/markers', (_req, res) => res.json({ markers: markerStore.getMarkers() }));
  app.post('/api/markers', (req, res) => {
    try { res.status(201).json({ marker: markerStore.createMarker(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch('/api/markers/:id', (req, res) => {
    const m = markerStore.updateMarker(req.params.id as string, req.body);
    if (!m) return res.status(404).json({ error: 'Marker not found' });
    res.json({ marker: m });
  });
  app.delete('/api/markers/:id', (req, res) => {
    const ok = markerStore.deleteMarker(req.params.id as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ── Zones ──
  app.get('/api/zones', (_req, res) => res.json({ zones: markerStore.getZones() }));
  app.post('/api/zones', (req, res) => {
    try { res.status(201).json({ zone: markerStore.createZone(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch('/api/zones/:id', (req, res) => {
    const z = markerStore.updateZone(req.params.id as string, req.body);
    if (!z) return res.status(404).json({ error: 'Zone not found' });
    res.json({ zone: z });
  });
  app.delete('/api/zones/:id', (req, res) => {
    const ok = markerStore.deleteZone(req.params.id as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ── Routes (paths) ──
  app.get('/api/routes', (_req, res) => res.json({ routes: markerStore.getRoutes() }));
  app.post('/api/routes', (req, res) => {
    try { res.status(201).json({ route: markerStore.createRoute(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch('/api/routes/:id', (req, res) => {
    const r = markerStore.updateRoute(req.params.id as string, req.body);
    if (!r) return res.status(404).json({ error: 'Route not found' });
    res.json({ route: r });
  });
  app.delete('/api/routes/:id', (req, res) => {
    const ok = markerStore.deleteRoute(req.params.id as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ── Squads ──
  app.get('/api/squads', (_req, res) => res.json({ squads: squadManager.getSquads() }));
  app.post('/api/squads', (req, res) => {
    try { res.status(201).json({ squad: squadManager.createSquad(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get('/api/squads/:id', (req, res) => {
    const s = squadManager.getSquad(req.params.id as string);
    if (!s) return res.status(404).json({ error: 'Squad not found' });
    res.json({ squad: s });
  });
  app.patch('/api/squads/:id', (req, res) => {
    const s = squadManager.updateSquad(req.params.id as string, req.body);
    if (!s) return res.status(404).json({ error: 'Squad not found' });
    res.json({ squad: s });
  });
  app.delete('/api/squads/:id', (req, res) => {
    const ok = squadManager.deleteSquad(req.params.id as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  });
  app.post('/api/squads/:id/bots', (req, res) => {
    const { botName } = req.body;
    if (!botName) return res.status(400).json({ error: 'botName required' });
    const s = squadManager.addBotToSquad(req.params.id as string, botName);
    if (!s) return res.status(404).json({ error: 'Squad not found' });
    res.json({ squad: s });
  });
  app.delete('/api/squads/:id/bots/:botName', (req, res) => {
    const s = squadManager.removeBotFromSquad(req.params.id as string, req.params.botName as string);
    if (!s) return res.status(404).json({ error: 'Squad not found' });
    res.json({ squad: s });
  });

  // ── Roles ──
  app.get('/api/roles/assignments', (_req, res) => res.json({ assignments: roleManager.getAssignments() }));
  app.post('/api/roles/assignments', (req, res) => {
    try { res.status(201).json({ assignment: roleManager.createAssignment(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch('/api/roles/assignments/:id', (req, res) => {
    const a = roleManager.updateAssignment(req.params.id as string, req.body);
    if (!a) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ assignment: a });
  });
  app.delete('/api/roles/assignments/:id', (req, res) => {
    const ok = roleManager.deleteAssignment(req.params.id as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  });
  app.get('/api/roles/approvals', (_req, res) => res.json({ approvals: roleManager.getApprovalRequests() }));
  app.post('/api/roles/approvals/:id/approve', (req, res) => {
    const { decidedBy, decisionNote } = req.body ?? {};
    const r = roleManager.approveApprovalRequest(req.params.id as string, decidedBy, decisionNote);
    if (!r) return res.status(404).json({ error: 'Approval request not found' });
    res.json({ request: r });
  });
  app.post('/api/roles/approvals/:id/reject', (req, res) => {
    const { decidedBy, decisionNote } = req.body ?? {};
    const r = roleManager.rejectApprovalRequest(req.params.id as string, decidedBy, decisionNote);
    if (!r) return res.status(404).json({ error: 'Approval request not found' });
    res.json({ request: r });
  });
  app.get('/api/roles/overrides', (_req, res) => res.json({ overrides: roleManager.getOverrides() }));
  app.delete('/api/bots/:name/override', (req, res) => {
    roleManager.clearOverride(req.params.name as string);
    res.json({ success: true });
  });

  // ── Missions ──
  app.get('/api/missions', (req, res) => {
    const filters = req.query.status ? { status: String(req.query.status) as any } : undefined;
    res.json({ missions: missionManager.getMissions(filters) });
  });
  app.post('/api/missions', (req, res) => {
    try { res.status(201).json({ mission: missionManager.createMission(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
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
  // Flatten the structured command.error into a string for client safety —
  // the dashboard renders cmd.error directly as a React child.
  const flattenCmd = (c: any) => c && ({
    ...c,
    error: c.error
      ? `${c.error.code ?? 'error'}: ${c.error.message ?? ''}`
      : undefined,
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

  return {
    app, httpServer, io, eventLog,
    commanderService, commandCenter, missionManager, markerStore, squadManager, roleManager, templateManager, routineManager,
    buildCoordinator, chainCoordinator,
  };
}
