import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Vec3 } from 'vec3';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { EventLog, BotEvent } from './EventLog';
import { CommandCenter } from '../control/CommandCenter';
import { CommandType } from '../control/CommandTypes';
import { MissionManager } from '../control/MissionManager';
import { MarkerStore } from '../control/MarkerStore';
import { SquadManager } from '../control/SquadManager';
import { RoleManager } from '../control/RoleManager';
import { CommanderService } from '../control/CommanderService';
import { BuildCoordinator } from '../build/BuildCoordinator';
import { ChainCoordinator } from '../supplychain/ChainCoordinator';
import { logger } from '../util/logger';

export interface APIServerResult {
  app: express.Application;
  httpServer: http.Server;
  io: SocketIOServer;
  eventLog: EventLog;
  commandCenter: CommandCenter;
  missionManager: MissionManager;
  buildCoordinator: BuildCoordinator;
  chainCoordinator: ChainCoordinator;
  markerStore: MarkerStore;
  squadManager: SquadManager;
  roleManager: RoleManager;
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

  // ── Control platform singletons (created once, wired to routes below) ──
  const markerStore = new MarkerStore(io);
  const squadManager = new SquadManager(io);
  const roleManager = new RoleManager(io);
  const commandCenter = new CommandCenter(botManager, io, markerStore);
  const missionManager = new MissionManager(botManager, io);
  const buildCoordinator = new BuildCoordinator(botManager, io, eventLog);
  const chainCoordinator = new ChainCoordinator(botManager, io, eventLog);
  missionManager.setBuildCoordinator(buildCoordinator);
  missionManager.setChainCoordinator(chainCoordinator);
  missionManager.setSquadManager(squadManager);
  roleManager.setMissionManager(missionManager);

  const commanderService = new CommanderService({
    llmClient: botManager.getLLMClient?.() ?? null,
    botManager, commandCenter, missionManager, markerStore,
  });

  // Wire role manager to command center for auto-override
  if ('setRoleManager' in commandCenter) (commandCenter as any).setRoleManager(roleManager);

  // Check override timeouts periodically
  setInterval(() => roleManager.checkOverrideTimeouts?.(), 60000);

  // ═══════════════════════════════════════
  //  ENDPOINTS — all use cached worker state
  // ═══════════════════════════════════════

  // Health check
  app.get('/api/status', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      botCount: botManager.getAllWorkers().length,
      controlPlatform: {
        commandCount: commandCenter.getCommands().length,
        missionCount: missionManager.getMissions().length,
        markerCount: markerStore.getMarkers().length,
        squadCount: squadManager.getSquads().length,
        roleCount: roleManager.getAssignments().length,
      },
    });
  });

  // Metrics endpoint
  app.get('/api/metrics', (_req: Request, res: Response) => {
    res.json({
      commands: typeof commandCenter.getMetrics === 'function' ? commandCenter.getMetrics() : {},
      missions: typeof missionManager.getMetrics === 'function' ? missionManager.getMetrics() : {},
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

  // Online players with positions
  app.get('/api/players', (_req: Request, res: Response) => {
    const bots = botManager.getAllBots();
    const connectedBot = bots.find((b) => b.bot);
    if (!connectedBot?.bot) {
      res.json({ players: [] });
      return;
    }
    const players = Object.values(connectedBot.bot.players)
      .filter((p: any) => p.username)
      .map((p: any) => ({
        name: p.username,
        position: p.entity
          ? { x: Math.floor(p.entity.position.x), y: Math.floor(p.entity.position.y), z: Math.floor(p.entity.position.z) }
          : null,
        isOnline: true,
      }));
    res.json({ players });
  });

  // Social Memory
  app.get('/api/bots/:name/memories', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const memories = botManager.getSocialMemory().getRecentMemories(name, 20);
    const reflections = botManager.getSocialMemory().getReflections(name, 5);
    const emotional = botManager.getSocialMemory().getEmotionalState(name);
    res.json({ memories, reflections, emotionalState: emotional });
  });

  // Bot Communications
  app.get('/api/bots/:name/messages', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const messages = botManager.getBotComms().getRecentMessages(name, 20);
    res.json({ messages });
  });

  // Send a message between bots (from dashboard)
  app.post('/api/bots/:name/bot-message', (req: Request, res: Response) => {
    const { to, content } = req.body;
    if (!to || !content) {
      res.status(400).json({ error: 'to and content required' });
      return;
    }
    const msg = botManager.getBotComms().sendMessage(req.params.name as string, to, content, 'chat');
    res.json({ success: true, message: msg });
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
  //  CONTROL PLATFORM - COMMAND ENDPOINTS
  // ═══════════════════════════════════════

  // Create and dispatch a command
  app.post('/api/commands', async (req: Request, res: Response) => {
    const { type, scope, priority, source, targets, params, payload } = req.body;

    if (!type || !targets || !Array.isArray(targets) || targets.length === 0) {
      res.status(400).json({ error: 'type and targets[] are required' });
      return;
    }

    try {
      const command = commandCenter.createCommand({
        type: type as CommandType,
        scope: scope === 'bot' ? 'single' : (scope ?? 'single'),
        priority: priority === 'urgent' ? 'critical' : (priority ?? 'normal'),
        source: source ?? 'dashboard',
        targets,
        params: params ?? payload ?? {},
      });
      const result = await commandCenter.dispatchCommand(command);
      const statusCode = result.status === 'succeeded' ? 200 : result.status === 'failed' ? 422 : 200;
      res.status(statusCode).json({ command: result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // List commands with optional filters
  app.get('/api/commands', (req: Request, res: Response) => {
    const bot = req.query.bot ? String(req.query.bot) : undefined;
    const status = req.query.status ? String(req.query.status) as any : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit)) : undefined;
    const commands = commandCenter.getCommands({ bot, status, limit });
    res.json({ commands });
  });

  // Get single command
  app.get('/api/commands/:id', (req: Request, res: Response) => {
    const command = commandCenter.getCommand(req.params.id as string);
    if (!command) {
      res.status(404).json({ error: 'Command not found' });
      return;
    }
    res.json({ command });
  });

  // Cancel a command
  app.post('/api/commands/:id/cancel', (req: Request, res: Response) => {
    const command = commandCenter.cancelCommand(req.params.id as string);
    if (!command) {
      res.status(404).json({ error: 'Command not found' });
      return;
    }
    res.json({ command });
  });

  // ═══════════════════════════════════════
  //  BOT ACTION SHORTCUTS (via CommandCenter)
  // ═══════════════════════════════════════

  // Pause voyager
  app.post('/api/bots/:name/pause', async (req: Request, res: Response) => {
    const name = req.params.name as string;
    const command = commandCenter.createCommand({
      type: 'pause_voyager', targets: [name], source: 'dashboard',
    });
    await commandCenter.dispatchCommand(command);
    if (command.status === 'failed') {
      res.status(422).json({ success: false, error: command.error?.message });
      return;
    }
    res.json({ success: true });
  });

  // Resume voyager
  app.post('/api/bots/:name/resume', async (req: Request, res: Response) => {
    const name = req.params.name as string;
    const command = commandCenter.createCommand({
      type: 'resume_voyager', targets: [name], source: 'dashboard',
    });
    await commandCenter.dispatchCommand(command);
    if (command.status === 'failed') {
      res.status(422).json({ success: false, error: command.error?.message });
      return;
    }
    res.json({ success: true });
  });

  // Stop movement
  app.post('/api/bots/:name/stop', async (req: Request, res: Response) => {
    const name = req.params.name as string;
    const command = commandCenter.createCommand({
      type: 'stop_movement', targets: [name], source: 'dashboard',
    });
    await commandCenter.dispatchCommand(command);
    if (command.status === 'failed') {
      res.status(422).json({ success: false, error: command.error?.message });
      return;
    }
    res.json({ success: true });
  });

  // Follow player
  app.post('/api/bots/:name/follow', async (req: Request, res: Response) => {
    const name = req.params.name as string;
    const { playerName } = req.body;
    if (!playerName) {
      res.status(400).json({ error: 'playerName is required' });
      return;
    }
    const command = commandCenter.createCommand({
      type: 'follow_player', targets: [name], source: 'dashboard',
      params: { playerName },
    });
    await commandCenter.dispatchCommand(command);
    if (command.status === 'failed') {
      res.status(422).json({ success: false, error: command.error?.message });
      return;
    }
    res.json({ success: true });
  });

  // Walk to coordinates
  app.post('/api/bots/:name/walkto', async (req: Request, res: Response) => {
    const name = req.params.name as string;
    const { x, y, z } = req.body;
    if (x == null || y == null || z == null) {
      res.status(400).json({ error: 'x, y, z are required' });
      return;
    }
    const command = commandCenter.createCommand({
      type: 'walk_to_coords', targets: [name], source: 'dashboard',
      params: { x, y, z },
    });
    await commandCenter.dispatchCommand(command);
    if (command.status === 'failed') {
      res.status(422).json({ success: false, error: command.error?.message });
      return;
    }
    res.json({ success: true });
  });

  // ═══════════════════════════════════════
  //  CONTROL PLATFORM - MISSION ENDPOINTS
  // ═══════════════════════════════════════

  // Start mission (transitions queued → running and triggers executor)
  app.post('/api/missions/:id/start', async (req: Request, res: Response) => {
    try {
      const mission = await missionManager.startMission(req.params.id as string);
      if (!mission) {
        res.status(404).json({ error: 'Mission not found or cannot be started' });
        return;
      }
      res.json({ mission });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create mission
  app.post('/api/missions', (req: Request, res: Response) => {
    const { type, title, description, assigneeType, assigneeIds, priority, source, steps, linkedCommandIds } = req.body;
    if (!type || !title || !assigneeType || !assigneeIds?.length) {
      res.status(400).json({ error: 'type, title, assigneeType, and assigneeIds are required' });
      return;
    }
    const mission = missionManager.createMission({
      type, title, description, assigneeType, assigneeIds, priority, source, steps, linkedCommandIds,
    });
    res.status(201).json({ mission });
  });

  // List missions
  app.get('/api/missions', (req: Request, res: Response) => {
    const filters = {
      bot: req.query.bot ? String(req.query.bot) : undefined,
      squad: req.query.squad ? String(req.query.squad) : undefined,
      status: req.query.status ? String(req.query.status) as any : undefined,
      limit: req.query.limit ? parseInt(String(req.query.limit)) : undefined,
    };
    const missions = missionManager.getMissions(filters);
    res.json({ missions });
  });

  // Get single mission
  app.get('/api/missions/:id', (req: Request, res: Response) => {
    const mission = missionManager.getMission(req.params.id as string);
    if (!mission) {
      res.status(404).json({ error: 'Mission not found' });
      return;
    }
    res.json({ mission });
  });

  // Pause mission
  app.post('/api/missions/:id/pause', (req: Request, res: Response) => {
    const mission = missionManager.pauseMission(req.params.id as string);
    if (!mission) {
      res.status(404).json({ error: 'Mission not found or cannot be paused' });
      return;
    }
    res.json({ mission });
  });

  // Resume mission
  app.post('/api/missions/:id/resume', (req: Request, res: Response) => {
    const mission = missionManager.resumeMission(req.params.id as string);
    if (!mission) {
      res.status(404).json({ error: 'Mission not found or cannot be resumed' });
      return;
    }
    res.json({ mission });
  });

  // Cancel mission
  app.post('/api/missions/:id/cancel', (req: Request, res: Response) => {
    const mission = missionManager.cancelMission(req.params.id as string);
    if (!mission) {
      res.status(404).json({ error: 'Mission not found or cannot be cancelled' });
      return;
    }
    res.json({ mission });
  });

  // Retry mission
  app.post('/api/missions/:id/retry', (req: Request, res: Response) => {
    const mission = missionManager.retryMission(req.params.id as string);
    if (!mission) {
      res.status(404).json({ error: 'Mission not found or cannot be retried' });
      return;
    }
    res.json({ mission });
  });

  // Get bot's combined mission queue (MissionManager + VoyagerLoop)
  app.get('/api/bots/:name/mission-queue', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const bot = botManager.getBot(name);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const missions = missionManager.getBotMissionQueue(name);
    const voyager = bot.getVoyagerLoop();
    const voyagerTasks = voyager ? voyager.getQueuedTasksDetailed() : [];
    res.json({ missions, voyagerTasks });
  });

  // Reorder/remove from bot mission queue
  app.patch('/api/bots/:name/mission-queue', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const bot = botManager.getBot(name);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const voyager = bot.getVoyagerLoop();
    if (!voyager) {
      res.status(400).json({ error: 'Bot is not in codegen mode' });
      return;
    }
    const { action, missionId, index, fromIndex, toIndex } = req.body;
    let success = false;
    if (action === 'remove' || action === 'reorder' || action === 'clear') {
      success = missionManager.updateBotMissionQueue(
        name,
        action,
        missionId,
        typeof fromIndex === 'number' && typeof toIndex === 'number'
          ? { from: fromIndex, to: toIndex }
          : undefined,
      );

      if (success) {
        res.json({ success: true });
        return;
      }
    }

    switch (action) {
      case 'remove':
        success = typeof index === 'number' ? voyager.removeQueuedTask(index) : false;
        break;
      case 'reorder':
        success = typeof fromIndex === 'number' && typeof toIndex === 'number'
          ? voyager.reorderQueue(fromIndex, toIndex)
          : false;
        break;
      case 'clear':
        voyager.clearQueue();
        success = true;
        break;
      default:
        res.status(400).json({ error: 'action must be remove, reorder, or clear' });
        return;
    }
    res.json({ success });
  });

  // ═══════════════════════════════════════
  //  CONTROL PLATFORM - WORLD PLANNING
  // ═══════════════════════════════════════

  app.get('/api/markers', (_req: Request, res: Response) => {
    res.json({ markers: markerStore.getMarkers() });
  });
  app.post('/api/markers', (req: Request, res: Response) => {
    const { name, kind, position } = req.body;
    if (!name || !kind || !position) { res.status(400).json({ error: 'name, kind, and position are required' }); return; }
    const marker = markerStore.createMarker({ name, kind, position, tags: req.body.tags, notes: req.body.notes });
    res.status(201).json({ marker });
  });
  app.patch('/api/markers/:id', (req: Request, res: Response) => {
    const updated = markerStore.updateMarker(req.params.id as string, req.body);
    if (!updated) { res.status(404).json({ error: 'Marker not found' }); return; }
    res.json({ marker: updated });
  });
  app.delete('/api/markers/:id', (req: Request, res: Response) => {
    const deleted = markerStore.deleteMarker(req.params.id as string);
    if (!deleted) { res.status(404).json({ error: 'Marker not found' }); return; }
    res.json({ success: true });
  });

  app.get('/api/zones', (_req: Request, res: Response) => {
    res.json({ zones: markerStore.getZones() });
  });
  app.post('/api/zones', (req: Request, res: Response) => {
    const { name, mode, shape } = req.body;
    if (!name || !mode || !shape) { res.status(400).json({ error: 'name, mode, and shape are required' }); return; }
    const zone = markerStore.createZone(req.body);
    res.status(201).json({ zone });
  });
  app.patch('/api/zones/:id', (req: Request, res: Response) => {
    const updated = markerStore.updateZone(req.params.id as string, req.body);
    if (!updated) { res.status(404).json({ error: 'Zone not found' }); return; }
    res.json({ zone: updated });
  });
  app.delete('/api/zones/:id', (req: Request, res: Response) => {
    const deleted = markerStore.deleteZone(req.params.id as string);
    if (!deleted) { res.status(404).json({ error: 'Zone not found' }); return; }
    res.json({ success: true });
  });

  app.get('/api/routes', (_req: Request, res: Response) => {
    res.json({ routes: markerStore.getRoutes() });
  });
  app.post('/api/routes', (req: Request, res: Response) => {
    const { name, waypointIds, loop } = req.body;
    if (!name || !Array.isArray(waypointIds)) { res.status(400).json({ error: 'name and waypointIds are required' }); return; }
    const route = markerStore.createRoute({ name, waypointIds, loop: loop ?? false });
    res.status(201).json({ route });
  });
  app.patch('/api/routes/:id', (req: Request, res: Response) => {
    const updated = markerStore.updateRoute(req.params.id as string, req.body);
    if (!updated) { res.status(404).json({ error: 'Route not found' }); return; }
    res.json({ route: updated });
  });
  app.delete('/api/routes/:id', (req: Request, res: Response) => {
    const deleted = markerStore.deleteRoute(req.params.id as string);
    if (!deleted) { res.status(404).json({ error: 'Route not found' }); return; }
    res.json({ success: true });
  });

  // ═══════════════════════════════════════
  //  CONTROL PLATFORM - SQUAD ENDPOINTS
  // ═══════════════════════════════════════

  app.get('/api/squads', (_req: Request, res: Response) => {
    res.json({ squads: squadManager.getSquads() });
  });
  app.post('/api/squads', (req: Request, res: Response) => {
    const { name, botNames, defaultRole, homeMarkerId } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    const squad = squadManager.createSquad({ name, botNames: botNames ?? [], defaultRole, homeMarkerId });
    res.status(201).json({ squad });
  });
  app.get('/api/squads/:id', (req: Request, res: Response) => {
    const squad = squadManager.getSquad(req.params.id as string);
    if (!squad) { res.status(404).json({ error: 'Squad not found' }); return; }
    res.json({ squad });
  });
  app.patch('/api/squads/:id', (req: Request, res: Response) => {
    const squad = squadManager.updateSquad(req.params.id as string, req.body);
    if (!squad) { res.status(404).json({ error: 'Squad not found' }); return; }
    res.json({ squad });
  });
  app.delete('/api/squads/:id', (req: Request, res: Response) => {
    const deleted = squadManager.deleteSquad(req.params.id as string);
    if (!deleted) { res.status(404).json({ error: 'Squad not found' }); return; }
    res.json({ success: true });
  });
  app.post('/api/squads/:id/members', (req: Request, res: Response) => {
    const { botName } = req.body;
    if (!botName) { res.status(400).json({ error: 'botName is required' }); return; }
    const added = squadManager.addBotToSquad(req.params.id as string, botName);
    if (!added) { res.status(404).json({ error: 'Squad not found' }); return; }
    res.json({ success: true });
  });
  app.delete('/api/squads/:id/members/:botName', (req: Request, res: Response) => {
    const removed = squadManager.removeBotFromSquad(req.params.id as string, req.params.botName as string);
    if (!removed) { res.status(404).json({ error: 'Squad not found or bot not a member' }); return; }
    res.json({ success: true });
  });
  app.post('/api/squads/:id/commands', async (req: Request, res: Response) => {
    const squad = squadManager.getSquad(req.params.id as string);
    if (!squad) { res.status(404).json({ error: 'Squad not found' }); return; }

    const { type, payload, priority, source } = req.body;
    if (!type) { res.status(400).json({ error: 'type is required' }); return; }
    if (!Array.isArray(squad.botNames) || squad.botNames.length === 0) {
      res.status(400).json({ error: 'Squad has no members' });
      return;
    }

    try {
      const command = commandCenter.createCommand({
        type,
        scope: 'squad',
        priority: priority === 'urgent' ? 'critical' : (priority ?? 'normal'),
        source: source ?? 'dashboard',
        targets: squad.botNames,
        params: payload ?? {},
      });
      const result = await commandCenter.dispatchCommand(command);
      res.json({ command: result, squad });
    } catch (err: any) {
      logger.error({ err, squadId: squad.id, type }, 'Squad command dispatch failed');
      res.status(500).json({ error: err.message ?? 'Failed to dispatch squad command' });
    }
  });
  app.post('/api/squads/:id/missions', (req: Request, res: Response) => {
    const squad = squadManager.getSquad(req.params.id as string);
    if (!squad) { res.status(404).json({ error: 'Squad not found' }); return; }

    const { type, title, description, priority, steps, linkedCommandIds, source } = req.body;
    if (!type || !title) {
      res.status(400).json({ error: 'type and title are required' });
      return;
    }

    try {
      const mission = missionManager.createMission({
        type,
        title,
        description,
        assigneeType: 'squad',
        assigneeIds: [squad.id],
        priority: priority ?? 'normal',
        source: source ?? 'dashboard',
        steps,
        linkedCommandIds,
      });
      squadManager.updateSquad(squad.id, { activeMissionId: mission.id });
      res.status(201).json({ mission, squadId: squad.id });
    } catch (err: any) {
      logger.error({ err, squadId: squad.id, type }, 'Squad mission creation failed');
      res.status(500).json({ error: err.message ?? 'Failed to create squad mission' });
    }
  });

  // ═══════════════════════════════════════
  //  CONTROL PLATFORM - ROLE ENDPOINTS
  // ═══════════════════════════════════════

  app.get('/api/roles', (_req: Request, res: Response) => {
    res.json({ assignments: roleManager.getAssignments(), overrides: roleManager.getOverrides?.() ?? [], approvalRequests: roleManager.getApprovalRequests?.() ?? [] });
  });
  app.post('/api/roles/assignments', (req: Request, res: Response) => {
    const { botName, role, autonomyLevel, homeMarkerId, allowedZoneIds, preferredMissionTypes, interruptPolicy, loadoutPolicy } = req.body;
    if (!botName || !role || !autonomyLevel) { res.status(400).json({ error: 'botName, role, and autonomyLevel are required' }); return; }
    if (!botManager.getBot(botName)) { res.status(404).json({ error: `Bot "${botName}" not found` }); return; }
    try {
      const assignment = roleManager.createAssignment({ botName, role, autonomyLevel, homeMarkerId, allowedZoneIds, preferredMissionTypes, interruptPolicy, loadoutPolicy });
      res.status(201).json({ assignment });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });
  app.get('/api/roles/assignments/:id', (req: Request, res: Response) => {
    const assignment = roleManager.getAssignment(req.params.id as string);
    if (!assignment) { res.status(404).json({ error: 'Assignment not found' }); return; }
    res.json({ assignment });
  });
  app.patch('/api/roles/assignments/:id', (req: Request, res: Response) => {
    try {
      const updated = roleManager.updateAssignment(req.params.id as string, req.body);
      if (!updated) { res.status(404).json({ error: 'Assignment not found' }); return; }
      res.json({ assignment: updated });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });
  app.delete('/api/roles/assignments/:id', (req: Request, res: Response) => {
    const deleted = roleManager.deleteAssignment(req.params.id as string);
    if (!deleted) { res.status(404).json({ error: 'Assignment not found' }); return; }
    res.json({ success: true });
  });

  // Override endpoints
  app.get('/api/bots/:name/override', (req: Request, res: Response) => {
    const override = roleManager.getOverride?.(req.params.name as string);
    res.json({ override: override || null });
  });
  app.delete('/api/bots/:name/override', (req: Request, res: Response) => {
    roleManager.clearOverride?.(req.params.name as string);
    res.json({ success: true });
  });
  app.post('/api/roles/approvals/:id/approve', (req: Request, res: Response) => {
    const result = roleManager.approveApprovalRequest?.(req.params.id as string, req.body?.decidedBy, req.body?.decisionNote);
    if (!result) { res.status(404).json({ error: 'Approval request not found or no longer valid' }); return; }
    res.json(result);
  });
  app.post('/api/roles/approvals/:id/reject', (req: Request, res: Response) => {
    const result = roleManager.rejectApprovalRequest?.(req.params.id as string, req.body?.decidedBy, req.body?.decisionNote);
    if (!result) { res.status(404).json({ error: 'Approval request not found or no longer valid' }); return; }
    res.json({ approvalRequest: result });
  });

  // ═══════════════════════════════════════
  //  BUILD & SCHEMATIC ENDPOINTS
  // ═══════════════════════════════════════

  app.get('/api/schematics', async (_req: Request, res: Response) => {
    try {
      const schematics = await buildCoordinator.listSchematics();
      res.json({ schematics });
    } catch (err: any) {
      logger.error({ err }, 'Failed to list schematics');
      res.status(500).json({ error: 'Failed to list schematics' });
    }
  });

  app.get('/api/schematics/:filename', async (req: Request, res: Response) => {
    try {
      const filename = req.params.filename as string;
      if (/[\/\\]|\.\./.test(filename)) {
        res.status(400).json({ error: 'Invalid filename: path traversal characters not allowed' }); return;
      }
      const info = await buildCoordinator.getSchematicInfoAsync(filename);
      if (!info) { res.status(404).json({ error: 'Schematic not found' }); return; }
      res.json({ schematic: info });
    } catch (err: any) {
      logger.error({ err, filename: req.params.filename }, 'Failed to get schematic info');
      res.status(500).json({ error: 'Failed to get schematic info' });
    }
  });

  app.post('/api/builds', async (req: Request, res: Response) => {
    const { schematicFile, origin, botNames, cleanupBotNames, fillFoundation, snapToGround } = req.body;
    if (!schematicFile || !origin || !botNames || !Array.isArray(botNames) || botNames.length === 0) {
      res.status(400).json({ error: 'schematicFile, origin {x,y,z}, and botNames[] are required' }); return;
    }
    if (/[\/\\]|\.\./.test(schematicFile)) {
      res.status(400).json({ error: 'Invalid schematicFile: path traversal characters not allowed' }); return;
    }
    if (typeof origin.x !== 'number' || typeof origin.y !== 'number' || typeof origin.z !== 'number') {
      res.status(400).json({ error: 'origin must have numeric x, y, z fields' }); return;
    }
    try {
      const build = await buildCoordinator.startBuild(schematicFile, origin, botNames, {
        cleanupBotNames: Array.isArray(cleanupBotNames) ? cleanupBotNames : undefined,
        fillFoundation: typeof fillFoundation === 'boolean' ? fillFoundation : undefined,
        snapToGround: typeof snapToGround === 'boolean' ? snapToGround : undefined,
      });
      res.status(201).json({ success: true, build });
    } catch (err: any) {
      logger.error({ err }, 'Failed to start build');
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/builds', (_req: Request, res: Response) => {
    const jobs = buildCoordinator.getAllBuildJobs();
    res.json({ builds: jobs });
  });

  app.get('/api/builds/:id', (req: Request, res: Response) => {
    const job = buildCoordinator.getBuildJob(req.params.id as string);
    if (!job) { res.status(404).json({ error: 'Build job not found' }); return; }
    res.json({ build: job });
  });

  app.post('/api/builds/:id/cancel', (req: Request, res: Response) => {
    const success = buildCoordinator.cancelBuild(req.params.id as string);
    if (!success) { res.status(404).json({ error: 'Build not found or already finished' }); return; }
    res.json({ success: true });
  });

  app.post('/api/builds/:id/pause', (req: Request, res: Response) => {
    const success = buildCoordinator.pauseBuild(req.params.id as string);
    if (!success) { res.status(404).json({ error: 'Build not found or not running' }); return; }
    res.json({ success: true });
  });

  app.post('/api/builds/:id/resume', (req: Request, res: Response) => {
    const success = buildCoordinator.resumeBuild(req.params.id as string);
    if (!success) { res.status(404).json({ error: 'Build not found or not paused' }); return; }
    res.json({ success: true });
  });

  // ═══════════════════════════════════════
  //  SUPPLY CHAIN ENDPOINTS
  // ═══════════════════════════════════════

  app.get('/api/chain-templates', (_req: Request, res: Response) => {
    const templates = chainCoordinator.getTemplates();
    res.json({ templates });
  });

  app.get('/api/chains', (_req: Request, res: Response) => {
    const chains = chainCoordinator.getAllChains();
    res.json({ chains });
  });

  app.get('/api/chains/:id', (req: Request, res: Response) => {
    const chain = chainCoordinator.getChain(req.params.id as string);
    if (!chain) { res.status(404).json({ error: 'Supply chain not found' }); return; }
    res.json({ chain });
  });

  app.post('/api/chains', (req: Request, res: Response) => {
    const { name, description, templateId, stages, loop, botAssignments, chestLocations } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    try {
      const chain = chainCoordinator.createChain({ name, description, templateId, stages, loop, botAssignments, chestLocations });
      res.status(201).json({ chain });
    } catch (err: any) {
      logger.error({ err }, 'Failed to create supply chain');
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/chains/:id', (req: Request, res: Response) => {
    const success = chainCoordinator.deleteChain(req.params.id as string);
    if (!success) { res.status(404).json({ error: 'Supply chain not found' }); return; }
    res.json({ success: true });
  });

  app.post('/api/chains/:id/start', (req: Request, res: Response) => {
    const success = chainCoordinator.startChain(req.params.id as string);
    if (!success) { res.status(404).json({ error: 'Supply chain not found or already running' }); return; }
    res.json({ success: true });
  });

  app.post('/api/chains/:id/pause', (req: Request, res: Response) => {
    const success = chainCoordinator.pauseChain(req.params.id as string);
    if (!success) { res.status(404).json({ error: 'Supply chain not found or not running' }); return; }
    res.json({ success: true });
  });

  app.post('/api/chains/:id/cancel', (req: Request, res: Response) => {
    const success = chainCoordinator.cancelChain(req.params.id as string);
    if (!success) { res.status(404).json({ error: 'Supply chain not found' }); return; }
    res.json({ success: true });
  });

  // ═══════════════════════════════════════
  //  CONTROL PLATFORM - COMMANDER ENDPOINTS
  // ═══════════════════════════════════════

  app.post('/api/commander/parse', async (req: Request, res: Response) => {
    const { input } = req.body;
    if (!input || typeof input !== 'string' || !input.trim()) {
      res.status(400).json({ error: 'input is required' }); return;
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

  app.get('/api/commander/history', (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 20);
    res.json({ entries: commanderService.getHistory(Number.isFinite(limit) ? limit : 20) });
  });

  app.post('/api/commander/execute', async (req: Request, res: Response) => {
    const { planId } = req.body;
    if (!planId) { res.status(400).json({ error: 'planId is required' }); return; }
    const plan = commanderService.getPlan(planId);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
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

  // ═══════════════════════════════════════
  //  TERRAIN SCANNING ENDPOINTS
  // ═══════════════════════════════════════

  /** Scan downward from y=200 to y=-64 to find the first non-air surface block. */
  function findNearestConnectedBot(x: number, z: number): any | null {
    const connected = botManager.getAllBots().filter((b) => b.bot?.entity);
    if (connected.length === 0) return null;
    let best = connected[0];
    let bestDist = Infinity;
    for (const b of connected) {
      const pos = b.bot!.entity.position;
      const dx = pos.x - x;
      const dz = pos.z - z;
      const dist = dx * dx + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    return best.bot;
  }

  function findSurfaceBlock(bot: any, x: number, z: number): { y: number; name: string } | null {
    for (let y = 200; y >= -64; y--) {
      const block = bot.blockAt(new Vec3(x, y, z));
      if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
        return { y, name: block.name };
      }
    }
    return null;
  }

  // GET /api/terrain?cx=100&cz=200&radius=64&step=2
  app.get('/api/terrain', (_req: Request, res: Response) => {
    const cx = parseInt(String(_req.query.cx ?? '0'), 10);
    const cz = parseInt(String(_req.query.cz ?? '0'), 10);
    const bot = findNearestConnectedBot(cx, cz);
    if (!bot) {
      res.status(503).json({ error: 'No bot connected' });
      return;
    }
    let radius = parseInt(String(_req.query.radius ?? '64'), 10);
    let step = parseInt(String(_req.query.step ?? '2'), 10);

    // Clamp for performance
    if (radius > 128) radius = 128;
    if (step < 1) step = 1;

    const size = Math.floor(2 * radius / step) + 1;
    const blocks: string[] = [];

    for (let z = cz - radius; z <= cz + radius; z += step) {
      for (let x = cx - radius; x <= cx + radius; x += step) {
        const surface = findSurfaceBlock(bot, x, z);
        blocks.push(surface ? surface.name : 'unknown');
      }
    }

    res.json({ cx, cz, radius, step, size, blocks });
  });

  // GET /api/terrain/height?x=100&z=200
  app.get('/api/terrain/height', (_req: Request, res: Response) => {
    const x = parseInt(String(_req.query.x ?? '0'), 10);
    const z = parseInt(String(_req.query.z ?? '0'), 10);
    const bot = findNearestConnectedBot(x, z);
    if (!bot) {
      res.status(503).json({ error: 'No bot connected' });
      return;
    }

    const surface = findSurfaceBlock(bot, x, z);
    if (surface) {
      res.json({ x, z, y: surface.y, block: surface.name });
    } else {
      res.json({ x, z, y: null, block: 'unknown' });
    }
  });

  // POST /api/terrain/height  — batch mode
  app.post('/api/terrain/height', (req: Request, res: Response) => {
    const positions: Array<{ x: number; z: number }> = req.body?.positions;
    if (!Array.isArray(positions)) {
      res.status(400).json({ error: 'positions array is required' });
      return;
    }

    const heights = positions.map((p) => {
      const x = Number(p.x) || 0;
      const z = Number(p.z) || 0;
      const bot = findNearestConnectedBot(x, z);
      if (!bot) return { x, z, y: null as number | null, block: 'unknown' };
      const surface = findSurfaceBlock(bot, x, z);
      return surface
        ? { x, z, y: surface.y, block: surface.name }
        : { x, z, y: null as number | null, block: 'unknown' };
    });

    res.json({ heights });
  });

  // POST /api/terrain/heightmap  — rectangular area heightmap
  app.post('/api/terrain/heightmap', (req: Request, res: Response) => {
    const { minX, maxX, minZ, maxZ } = req.body ?? {};
    if (minX == null || maxX == null || minZ == null || maxZ == null) {
      res.status(400).json({ error: 'minX, maxX, minZ, maxZ are required' });
      return;
    }

    let step = parseInt(String(req.body.step ?? '1'), 10);
    if (step < 1) step = 1;

    const heights: number[][] = [];
    const blocks: string[][] = [];

    const centerX = Math.round((minX + maxX) / 2);
    const centerZ = Math.round((minZ + maxZ) / 2);
    const bot = findNearestConnectedBot(centerX, centerZ);
    if (!bot) {
      res.status(503).json({ error: 'No bot connected' });
      return;
    }

    for (let z = minZ; z <= maxZ; z += step) {
      const heightRow: number[] = [];
      const blockRow: string[] = [];
      for (let x = minX; x <= maxX; x += step) {
        const surface = findSurfaceBlock(bot, x, z);
        if (surface) {
          heightRow.push(surface.y);
          blockRow.push(surface.name);
        } else {
          heightRow.push(-64);
          blockRow.push('unknown');
        }
      }
      heights.push(heightRow);
      blocks.push(blockRow);
    }

    res.json({ heights, blocks });
  });

  return { app, httpServer, io, eventLog, commandCenter, missionManager, buildCoordinator, chainCoordinator, markerStore, squadManager, roleManager, commanderService };
}
