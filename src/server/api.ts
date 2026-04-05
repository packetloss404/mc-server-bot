import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { EventLog } from './EventLog';
import { logger } from '../util/logger';
import { LLMClient } from '../ai/LLMClient';
import { CommandCenter } from '../control/CommandCenter';
import { MissionManager } from '../control/MissionManager';
import { MarkerStore } from '../control/MarkerStore';
import { SquadManager } from '../control/SquadManager';
import { RoleManager } from '../control/RoleManager';
import { RoutineManager } from '../control/RoutineManager';
import { TemplateManager } from '../control/TemplateManager';
import { CommanderService } from '../control/CommanderService';

export interface APIServerResult {
  app: express.Application;
  httpServer: http.Server;
  io: SocketIOServer;
  eventLog: EventLog;
  // Expose managers for shutdown wiring
  commandCenter: CommandCenter;
  missionManager: MissionManager;
  markerStore: MarkerStore;
  squadManager: SquadManager;
  roleManager: RoleManager;
  routineManager: RoutineManager;
  templateManager: TemplateManager;
  commanderService: CommanderService;
}

export function createAPIServer(botManager: BotManager, llmClient?: LLMClient | null): APIServerResult {
  const app = express();
  const httpServer = http.createServer(app);

  // CORS -- allow the Next.js dev server and common local ports
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

  // ======================================================
  //  INSTANTIATE CONTROL PLATFORM MANAGERS
  // ======================================================

  const markerStore = new MarkerStore(io);
  const squadManager = new SquadManager(io);
  const roleManager = new RoleManager(io);
  const commandCenter = new CommandCenter(botManager, io, markerStore);
  const missionManager = new MissionManager(botManager, io);
  const routineManager = new RoutineManager(botManager);
  const templateManager = new TemplateManager();
  const commanderService = new CommanderService({ llmClient: llmClient ?? null });

  // Wire cross-references
  commandCenter.setRoleManager(roleManager);
  missionManager.setCommandCenter(commandCenter);
  missionManager.setSquadManager(squadManager);
  roleManager.setMissionManager(missionManager);

  // Periodic mission progress check
  const missionCheckInterval = setInterval(() => {
    missionManager.checkMissionProgress();
  }, 30_000);

  // ======================================================
  //  ENDPOINTS -- existing bot CRUD and status
  // ======================================================

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

  // ======================================================
  //  DASHBOARD ENDPOINTS
  // ======================================================

  // Detailed bot status (enriched) -- uses cached state from worker
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

  // Bot inventory -- from cached detailed status
  app.get('/api/bots/:name/inventory', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    const detailed = handle.getCachedDetailedStatus();
    res.json({ inventory: detailed?.inventory || [] });
  });

  // Bot relationships (affinities)
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

  // Bot conversations
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

  // Bot tasks -- from cached detailed status
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

  // Full social graph
  app.get('/api/relationships', (_req: Request, res: Response) => {
    const allAffinities = botManager.getAffinityManager().getAll();
    res.json({ relationships: allAffinities });
  });

  // Global skill library -- read from disk
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

  // Single skill with code
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

  // Aggregate world state
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
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle || !handle.isAlive()) {
      res.status(404).json({ error: 'Bot not found or not connected' });
      return;
    }
    handle.sendCommand('queueChat', { playerName, message });
    res.json({ success: true });
  });

  // Queue a task for a bot (from dashboard)
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

  // ======================================================
  //  BOT ACTION ROUTES (sendCommand to worker)
  // ======================================================

  app.post('/api/bots/:name/pause', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) { res.status(404).json({ error: 'Bot not found' }); return; }
    handle.sendCommand('setMode', { pause: true });
    res.json({ success: true });
  });

  app.post('/api/bots/:name/resume', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) { res.status(404).json({ error: 'Bot not found' }); return; }
    handle.sendCommand('setMode', { pause: false });
    res.json({ success: true });
  });

  app.post('/api/bots/:name/stop', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) { res.status(404).json({ error: 'Bot not found' }); return; }
    handle.sendCommand('disconnect', {});
    res.json({ success: true });
  });

  app.post('/api/bots/:name/follow', (req: Request, res: Response) => {
    const { playerName } = req.body;
    if (!playerName) { res.status(400).json({ error: 'playerName is required' }); return; }
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) { res.status(404).json({ error: 'Bot not found' }); return; }
    handle.sendCommand('follow', { playerName });
    res.json({ success: true });
  });

  app.post('/api/bots/:name/walkto', (req: Request, res: Response) => {
    const { x, y, z } = req.body;
    if (x == null || y == null || z == null) { res.status(400).json({ error: 'x, y, z are required' }); return; }
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) { res.status(404).json({ error: 'Bot not found' }); return; }
    handle.sendCommand('walkTo', { x, y, z });
    res.json({ success: true });
  });

  app.post('/api/bots/:name/return-to-base', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) { res.status(404).json({ error: 'Bot not found' }); return; }
    handle.sendCommand('returnToBase', {});
    res.json({ success: true });
  });

  app.post('/api/bots/:name/unstuck', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) { res.status(404).json({ error: 'Bot not found' }); return; }
    handle.sendCommand('unstuck', {});
    res.json({ success: true });
  });

  app.post('/api/bots/:name/equip-best', (req: Request, res: Response) => {
    const handle = botManager.getWorker(req.params.name as string);
    if (!handle) { res.status(404).json({ error: 'Bot not found' }); return; }
    handle.sendCommand('equipBest', {});
    res.json({ success: true });
  });

  // ======================================================
  //  PLAYERS & TERRAIN
  // ======================================================

  app.get('/api/players', (_req: Request, res: Response) => {
    const workers = botManager.getAllWorkers();
    const playerSet = new Set<string>();
    for (const w of workers) {
      const detailed = w.getCachedDetailedStatus();
      if (detailed?.world?.players) {
        for (const p of detailed.world.players) {
          playerSet.add(typeof p === 'string' ? p : (p as any).name ?? String(p));
        }
      }
    }
    res.json({ players: Array.from(playerSet) });
  });

  app.get('/api/terrain', (_req: Request, res: Response) => {
    // Terrain data is not currently tracked -- return empty
    res.json({ terrain: null });
  });

  // ======================================================
  //  COMMAND CENTER ENDPOINTS
  // ======================================================

  app.post('/api/commands', async (req: Request, res: Response) => {
    try {
      const command = commandCenter.createCommand(req.body);
      const dispatched = await commandCenter.dispatchCommand(command, req.body.force);
      res.status(201).json({ command: dispatched });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to create command' });
    }
  });

  app.get('/api/commands', (req: Request, res: Response) => {
    try {
      const filters: any = {};
      if (req.query.bot) filters.bot = String(req.query.bot);
      if (req.query.status) filters.status = String(req.query.status);
      if (req.query.limit) filters.limit = parseInt(String(req.query.limit));
      const commands = commandCenter.getCommands(filters);
      res.json({ commands });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/commands/:id', (req: Request, res: Response) => {
    const command = commandCenter.getCommand(req.params.id as string);
    if (!command) { res.status(404).json({ error: 'Command not found' }); return; }
    res.json({ command });
  });

  app.post('/api/commands/:id/cancel', (req: Request, res: Response) => {
    const command = commandCenter.cancelCommand(req.params.id as string, req.body?.reason);
    if (!command) { res.status(404).json({ error: 'Command not found' }); return; }
    res.json({ command });
  });

  // ======================================================
  //  MISSION ENDPOINTS
  // ======================================================

  app.post('/api/missions', (req: Request, res: Response) => {
    try {
      const mission = missionManager.createMission(req.body);
      res.status(201).json({ mission });
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? 'Failed to create mission' });
    }
  });

  app.get('/api/missions', (req: Request, res: Response) => {
    try {
      const filters: any = {};
      if (req.query.bot) filters.bot = String(req.query.bot);
      if (req.query.squad) filters.squad = String(req.query.squad);
      if (req.query.status) filters.status = String(req.query.status);
      if (req.query.limit) filters.limit = parseInt(String(req.query.limit));
      const missions = missionManager.getMissions(filters);
      res.json({ missions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/missions/:id', (req: Request, res: Response) => {
    const mission = missionManager.getMission(req.params.id as string);
    if (!mission) { res.status(404).json({ error: 'Mission not found' }); return; }
    res.json({ mission });
  });

  app.post('/api/missions/:id/start', async (req: Request, res: Response) => {
    try {
      const mission = await missionManager.startMission(req.params.id as string);
      if (!mission) { res.status(404).json({ error: 'Mission not found or cannot be started' }); return; }
      res.json({ mission });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/missions/:id/pause', (req: Request, res: Response) => {
    const mission = missionManager.pauseMission(req.params.id as string);
    if (!mission) { res.status(404).json({ error: 'Mission not found or cannot be paused' }); return; }
    res.json({ mission });
  });

  app.post('/api/missions/:id/resume', (req: Request, res: Response) => {
    const mission = missionManager.resumeMission(req.params.id as string);
    if (!mission) { res.status(404).json({ error: 'Mission not found or cannot be resumed' }); return; }
    res.json({ mission });
  });

  app.post('/api/missions/:id/cancel', (req: Request, res: Response) => {
    const mission = missionManager.cancelMission(req.params.id as string);
    if (!mission) { res.status(404).json({ error: 'Mission not found or cannot be cancelled' }); return; }
    res.json({ mission });
  });

  app.post('/api/missions/:id/retry', (req: Request, res: Response) => {
    const mission = missionManager.retryMission(req.params.id as string);
    if (!mission) { res.status(404).json({ error: 'Mission not found or cannot be retried' }); return; }
    res.json({ mission });
  });

  // Per-bot mission queue
  app.get('/api/bots/:name/mission-queue', (req: Request, res: Response) => {
    const queue = missionManager.getBotMissionQueue(req.params.name as string);
    res.json({ queue });
  });

  app.patch('/api/bots/:name/mission-queue', (req: Request, res: Response) => {
    const { action, missionId, position } = req.body;
    const success = missionManager.updateBotMissionQueue(req.params.name as string, action, missionId, position);
    if (!success) { res.status(400).json({ error: 'Failed to update mission queue' }); return; }
    res.json({ success: true });
  });

  // ======================================================
  //  MARKER ENDPOINTS
  // ======================================================

  app.get('/api/markers', (_req: Request, res: Response) => {
    res.json({ markers: markerStore.getMarkers() });
  });

  app.post('/api/markers', (req: Request, res: Response) => {
    try {
      const marker = markerStore.createMarker(req.body);
      res.status(201).json({ marker });
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? 'Failed to create marker' });
    }
  });

  app.patch('/api/markers/:id', (req: Request, res: Response) => {
    const marker = markerStore.updateMarker(req.params.id as string, req.body);
    if (!marker) { res.status(404).json({ error: 'Marker not found' }); return; }
    res.json({ marker });
  });

  app.delete('/api/markers/:id', (req: Request, res: Response) => {
    const deleted = markerStore.deleteMarker(req.params.id as string);
    if (!deleted) { res.status(404).json({ error: 'Marker not found' }); return; }
    res.json({ success: true });
  });

  // ======================================================
  //  ZONE ENDPOINTS
  // ======================================================

  app.get('/api/zones', (_req: Request, res: Response) => {
    res.json({ zones: markerStore.getZones() });
  });

  app.post('/api/zones', (req: Request, res: Response) => {
    try {
      const zone = markerStore.createZone(req.body);
      res.status(201).json({ zone });
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? 'Failed to create zone' });
    }
  });

  app.patch('/api/zones/:id', (req: Request, res: Response) => {
    const zone = markerStore.updateZone(req.params.id as string, req.body);
    if (!zone) { res.status(404).json({ error: 'Zone not found' }); return; }
    res.json({ zone });
  });

  app.delete('/api/zones/:id', (req: Request, res: Response) => {
    const deleted = markerStore.deleteZone(req.params.id as string);
    if (!deleted) { res.status(404).json({ error: 'Zone not found' }); return; }
    res.json({ success: true });
  });

  // ======================================================
  //  ROUTE ENDPOINTS
  // ======================================================

  app.get('/api/routes', (_req: Request, res: Response) => {
    res.json({ routes: markerStore.getRoutes() });
  });

  app.post('/api/routes', (req: Request, res: Response) => {
    try {
      const route = markerStore.createRoute(req.body);
      res.status(201).json({ route });
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? 'Failed to create route' });
    }
  });

  app.patch('/api/routes/:id', (req: Request, res: Response) => {
    const route = markerStore.updateRoute(req.params.id as string, req.body);
    if (!route) { res.status(404).json({ error: 'Route not found' }); return; }
    res.json({ route });
  });

  app.delete('/api/routes/:id', (req: Request, res: Response) => {
    const deleted = markerStore.deleteRoute(req.params.id as string);
    if (!deleted) { res.status(404).json({ error: 'Route not found' }); return; }
    res.json({ success: true });
  });

  // ======================================================
  //  SQUAD ENDPOINTS
  // ======================================================

  app.get('/api/squads', (_req: Request, res: Response) => {
    res.json({ squads: squadManager.getSquads() });
  });

  app.post('/api/squads', (req: Request, res: Response) => {
    try {
      const squad = squadManager.createSquad(req.body);
      res.status(201).json({ squad });
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? 'Failed to create squad' });
    }
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
    const success = squadManager.addBotToSquad(req.params.id as string, botName);
    if (!success) { res.status(404).json({ error: 'Squad not found' }); return; }
    res.json({ success: true });
  });

  app.delete('/api/squads/:id/members/:botName', (req: Request, res: Response) => {
    const success = squadManager.removeBotFromSquad(req.params.id as string, req.params.botName as string);
    if (!success) { res.status(404).json({ error: 'Squad or member not found' }); return; }
    res.json({ success: true });
  });

  // ======================================================
  //  ROLE ASSIGNMENT ENDPOINTS
  // ======================================================

  app.get('/api/roles/assignments', (_req: Request, res: Response) => {
    res.json({ assignments: roleManager.getAssignments() });
  });

  app.post('/api/roles/assignments', (req: Request, res: Response) => {
    try {
      const assignment = roleManager.createAssignment(req.body);
      res.status(201).json({ assignment });
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? 'Failed to create assignment' });
    }
  });

  app.get('/api/roles/assignments/:id', (req: Request, res: Response) => {
    const assignment = roleManager.getAssignment(req.params.id as string);
    if (!assignment) { res.status(404).json({ error: 'Assignment not found' }); return; }
    res.json({ assignment });
  });

  app.patch('/api/roles/assignments/:id', (req: Request, res: Response) => {
    try {
      const assignment = roleManager.updateAssignment(req.params.id as string, req.body);
      if (!assignment) { res.status(404).json({ error: 'Assignment not found' }); return; }
      res.json({ assignment });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/roles/assignments/:id', (req: Request, res: Response) => {
    const deleted = roleManager.deleteAssignment(req.params.id as string);
    if (!deleted) { res.status(404).json({ error: 'Assignment not found' }); return; }
    res.json({ success: true });
  });

  // Bot override endpoints
  app.get('/api/bots/:name/override', (req: Request, res: Response) => {
    const override = roleManager.getOverride(req.params.name as string);
    res.json({ override });
  });

  app.delete('/api/bots/:name/override', (req: Request, res: Response) => {
    roleManager.clearOverride(req.params.name as string);
    res.json({ success: true });
  });

  // ======================================================
  //  COMMANDER ENDPOINTS
  // ======================================================

  app.post('/api/commander/parse', async (req: Request, res: Response) => {
    try {
      const { input } = req.body;
      if (!input) { res.status(400).json({ error: 'input is required' }); return; }
      const plan = await commanderService.parse(input);
      res.json({ plan });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to parse command' });
    }
  });

  app.post('/api/commander/execute', async (req: Request, res: Response) => {
    try {
      const { planId } = req.body;
      if (!planId) { res.status(400).json({ error: 'planId is required' }); return; }
      const result = await commanderService.execute(planId);
      if (!result) { res.status(404).json({ error: 'Plan not found or requires clarification' }); return; }
      res.json({ result });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to execute plan' });
    }
  });

  return {
    app,
    httpServer,
    io,
    eventLog,
    commandCenter,
    missionManager,
    markerStore,
    squadManager,
    roleManager,
    routineManager,
    templateManager,
    commanderService,
  };
}
