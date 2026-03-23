import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { BotInstance } from '../bot/BotInstance';
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

  const commanderService = new CommanderService({
    llmClient: botManager.getLLMClient?.() ?? null,
    botManager, commandCenter, missionManager, markerStore,
  });

  // Wire role manager to command center for auto-override
  if ('setRoleManager' in commandCenter) (commandCenter as any).setRoleManager(roleManager);

  // Check override timeouts periodically
  setInterval(() => roleManager.checkOverrideTimeouts?.(), 60000);

  // ═══════════════════════════════════════
  //  EXISTING ENDPOINTS (unchanged logic)
  // ═══════════════════════════════════════

  // Health check
  app.get('/api/status', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      botCount: botManager.getAllBots().length,
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
    const bots = botManager.getAllBots().map((b) => b.getStatus());
    res.json({ bots });
  });

  // Get single bot (basic)
  app.get('/api/bots/:name', (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.name as string);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json({ bot: bot.getStatus() });
  });

  // Create bot
  app.post('/api/bots', async (req: Request, res: Response) => {
    const { name, personality, location, mode } = req.body;

    if (!name || !personality) {
      res.status(400).json({ error: 'name and personality are required' });
      return;
    }

    const bot = await botManager.spawnBot(name, personality, location, mode);
    if (!bot) {
      res.status(409).json({ error: 'Bot already exists or max limit reached' });
      return;
    }

    const event = eventLog.push({ type: 'bot:spawn', botName: name, description: `${name} spawned` });
    io.emit('bot:spawn', { bot: name });
    io.emit('activity', event);

    res.status(201).json({ success: true, bot: bot.getStatus() });
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
    const bot = nearestBot ? botManager.getBot(nearestBot) : null;

    if (!bot || !bot.bot) {
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
  //  NEW DASHBOARD ENDPOINTS
  // ═══════════════════════════════════════

  // Detailed bot status (enriched)
  app.get('/api/bots/:name/detailed', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const bot = botManager.getBot(name);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json({ bot: bot.getDetailedStatus() });
  });

  // Bot inventory
  app.get('/api/bots/:name/inventory', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const bot = botManager.getBot(name);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    if (!bot.bot) {
      res.json({ inventory: [] });
      return;
    }
    const items = bot.bot.inventory.items().map((item) => ({
      name: item.name,
      count: item.count,
      slot: item.slot,
    }));
    res.json({ inventory: items });
  });

  // Bot relationships (affinities)
  app.get('/api/bots/:name/relationships', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const bot = botManager.getBot(name);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const affinities = botManager.getAffinityManager().getAllForBot(name);
    res.json({ relationships: affinities });
  });

  // Bot conversations
  app.get('/api/bots/:name/conversations', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const bot = botManager.getBot(name);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const conversations = botManager.getConversationManager().getAllConversations(name);
    res.json({ conversations });
  });

  // Bot tasks (completed, failed, current)
  app.get('/api/bots/:name/tasks', (req: Request, res: Response) => {
    const name = req.params.name as string;
    const bot = botManager.getBot(name);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const voyager = bot.getVoyagerLoop();
    if (!voyager) {
      res.json({ currentTask: null, completedTasks: [], failedTasks: [] });
      return;
    }
    res.json({
      currentTask: voyager.getCurrentTask(),
      queuedTasks: voyager.getQueuedTasks(),
      longTermGoal: voyager.getLongTermGoal(),
      completedTasks: voyager.getCompletedTasks(),
      failedTasks: voyager.getFailedTasks(),
    });
  });

  // Full social graph (all bots, all players)
  app.get('/api/relationships', (_req: Request, res: Response) => {
    const allAffinities = botManager.getAffinityManager().getAll();
    res.json({ relationships: allAffinities });
  });

  // Global skill library
  app.get('/api/skills', (_req: Request, res: Response) => {
    // Try to get skill library from any active codegen bot
    const bots = botManager.getAllBots();
    for (const bot of bots) {
      const voyager = bot.getVoyagerLoop();
      if (voyager) {
        const library = voyager.getSkillLibrary();
        const names = library.getSkillNames();
        const skills = names.map((name) => {
          const code = library.getCode(name);
          return { name, code: code?.slice(0, 2000) ?? null };
        });
        res.json({ skills, count: skills.length });
        return;
      }
    }
    res.json({ skills: [], count: 0 });
  });

  // Single skill with code
  app.get('/api/skills/:name', (req: Request, res: Response) => {
    const skillName = req.params.name as string;
    const bots = botManager.getAllBots();
    for (const bot of bots) {
      const voyager = bot.getVoyagerLoop();
      if (voyager) {
        const code = voyager.getSkillLibrary().getCode(skillName);
        if (code) {
          res.json({ name: skillName, code });
          return;
        }
      }
    }
    res.status(404).json({ error: 'Skill not found' });
  });

  // Aggregate world state
  app.get('/api/world', (_req: Request, res: Response) => {
    const bots = botManager.getAllBots();
    const firstConnected = bots.find((b) => b.bot);
    if (!firstConnected?.bot) {
      res.json({ timeOfDay: null, day: null, isRaining: null, onlineBots: 0 });
      return;
    }
    const bot = firstConnected.bot;
    const timeOfDay = bot.time.timeOfDay < 6000 ? 'sunrise'
      : bot.time.timeOfDay < 12000 ? 'day'
      : bot.time.timeOfDay < 18000 ? 'sunset'
      : 'night';
    res.json({
      timeOfDay,
      timeOfDayTicks: bot.time.timeOfDay,
      day: bot.time.day,
      isRaining: bot.isRaining,
      onlineBots: bots.filter((b) => b.bot).length,
    });
  });

  // Shared blackboard state
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

  // Send chat message to a bot (from dashboard)
  app.post('/api/bots/:name/chat', (req: Request, res: Response) => {
    const { playerName, message } = req.body;
    if (!playerName || !message) {
      res.status(400).json({ error: 'playerName and message are required' });
      return;
    }
    const name = req.params.name as string;
    const bot = botManager.getBot(name);
    if (!bot || !bot.bot) {
      res.status(404).json({ error: 'Bot not found or not connected' });
      return;
    }
    // Emit the message as if the player said it — the bot's chat listener will handle it
    (bot.bot as any).emit('chat', playerName, message);
    res.json({ success: true });
  });

  // Queue a task for a bot (from dashboard)
  app.post('/api/bots/:name/task', (req: Request, res: Response) => {
    const { description } = req.body;
    if (!description) {
      res.status(400).json({ error: 'description is required' });
      return;
    }
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
    voyager.queuePlayerTask(description, 'dashboard');

    const event = eventLog.push({
      type: 'bot:task',
      botName: name,
      description: `Task queued: ${description}`,
      metadata: { source: 'dashboard' },
    });
    io.emit('bot:task', { bot: name, task: description, status: 'queued' });
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
    const { type, scope, priority, source, targets, params } = req.body;

    if (!type || !targets || !Array.isArray(targets) || targets.length === 0) {
      res.status(400).json({ error: 'type and targets[] are required' });
      return;
    }

    try {
      const command = commandCenter.createCommand({
        type: type as CommandType,
        scope: scope ?? 'single',
        priority: priority ?? 'normal',
        source: source ?? 'dashboard',
        targets,
        params: params ?? {},
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

  // Reorder/remove from bot's VoyagerLoop queue
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
    const { action, index, fromIndex, toIndex } = req.body;
    let success = false;
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

  // ═══════════════════════════════════════
  //  CONTROL PLATFORM - ROLE ENDPOINTS
  // ═══════════════════════════════════════

  app.get('/api/roles', (_req: Request, res: Response) => {
    res.json({ assignments: roleManager.getAssignments(), overrides: roleManager.getOverrides?.() ?? [] });
  });
  app.post('/api/roles/assignments', (req: Request, res: Response) => {
    const { botName, role, autonomyLevel, homeMarkerId, allowedZoneIds, preferredMissionTypes } = req.body;
    if (!botName || !role || !autonomyLevel) { res.status(400).json({ error: 'botName, role, and autonomyLevel are required' }); return; }
    if (!botManager.getBot(botName)) { res.status(404).json({ error: `Bot "${botName}" not found` }); return; }
    try {
      const assignment = roleManager.createAssignment({ botName, role, autonomyLevel, homeMarkerId, allowedZoneIds, preferredMissionTypes });
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
      res.json({ plan });
    } catch (err: any) {
      logger.error({ err }, 'Commander parse failed');
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/commander/execute', async (req: Request, res: Response) => {
    const { planId } = req.body;
    if (!planId) { res.status(400).json({ error: 'planId is required' }); return; }
    const plan = commanderService.getPlan(planId);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
    try {
      const result = await commanderService.execute(planId);
      res.json(result);
    } catch (err: any) {
      logger.error({ err }, 'Commander execute failed');
      res.status(500).json({ error: err.message });
    }
  });

  return { app, httpServer, io, eventLog, commandCenter, missionManager, buildCoordinator, chainCoordinator, markerStore, squadManager, roleManager, commanderService };
}
