import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { EventLog } from './EventLog';
import { logger } from '../util/logger';
import { CommandCenter } from '../control/CommandCenter';
import { MissionManager } from '../control/MissionManager';
import { MarkerStore } from '../control/MarkerStore';
import { SquadManager } from '../control/SquadManager';
import { RoleManager } from '../control/RoleManager';
import { CommanderService } from '../control/CommanderService';
import { LLMClient } from '../ai/LLMClient';
import { CommandType } from '../control/CommandTypes';
import { MissionType, MissionStatus } from '../control/MissionTypes';

export interface APIServerResult {
  app: express.Application;
  httpServer: http.Server;
  io: SocketIOServer;
  eventLog: EventLog;
  markerStore: MarkerStore;
  squadManager: SquadManager;
  roleManager: RoleManager;
  commandCenter: CommandCenter;
  missionManager: MissionManager;
  commanderService: CommanderService;
}

export function createAPIServer(botManager: BotManager, llmClient?: LLMClient | null): APIServerResult {
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
  //  CONTROL PLATFORM — instantiate managers
  // ═══════════════════════════════════════

  const markerStore = new MarkerStore(io);
  const squadManager = new SquadManager(io);
  const roleManager = new RoleManager(io);
  const commandCenter = new CommandCenter(botManager, io, markerStore);
  commandCenter.setRoleManager(roleManager);
  const missionManager = new MissionManager(botManager, io);
  missionManager.setCommandCenter(commandCenter);
  missionManager.setSquadManager(squadManager);
  roleManager.setMissionManager(missionManager);

  const commanderService = new CommanderService({ llmClient: llmClient ?? null });

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
  //  BOT ACTION ROUTES (sendCommand shortcuts)
  // ═══════════════════════════════════════

  app.post('/api/bots/:name/pause', (req: Request, res: Response) => {
    try {
      const handle = botManager.getWorker(req.params.name as string);
      if (!handle || !handle.isAlive()) {
        res.status(404).json({ error: 'Bot not found or not connected' });
        return;
      }
      handle.sendCommand('setMode', { pause: true });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/bots/:name/resume', (req: Request, res: Response) => {
    try {
      const handle = botManager.getWorker(req.params.name as string);
      if (!handle || !handle.isAlive()) {
        res.status(404).json({ error: 'Bot not found or not connected' });
        return;
      }
      handle.sendCommand('setMode', { pause: false });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/bots/:name/stop', (req: Request, res: Response) => {
    try {
      const handle = botManager.getWorker(req.params.name as string);
      if (!handle || !handle.isAlive()) {
        res.status(404).json({ error: 'Bot not found or not connected' });
        return;
      }
      handle.sendCommand('disconnect', {});
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/bots/:name/follow', (req: Request, res: Response) => {
    try {
      const { playerName } = req.body;
      if (!playerName) {
        res.status(400).json({ error: 'playerName is required' });
        return;
      }
      const handle = botManager.getWorker(req.params.name as string);
      if (!handle || !handle.isAlive()) {
        res.status(404).json({ error: 'Bot not found or not connected' });
        return;
      }
      handle.sendCommand('follow', { playerName });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/bots/:name/walkto', (req: Request, res: Response) => {
    try {
      const { x, y, z } = req.body;
      if (x == null || y == null || z == null) {
        res.status(400).json({ error: 'x, y, z coordinates are required' });
        return;
      }
      const handle = botManager.getWorker(req.params.name as string);
      if (!handle || !handle.isAlive()) {
        res.status(404).json({ error: 'Bot not found or not connected' });
        return;
      }
      handle.sendCommand('walkTo', { x, y, z });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/bots/:name/return-to-base', (req: Request, res: Response) => {
    try {
      const handle = botManager.getWorker(req.params.name as string);
      if (!handle || !handle.isAlive()) {
        res.status(404).json({ error: 'Bot not found or not connected' });
        return;
      }
      handle.sendCommand('returnToBase', {});
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/bots/:name/unstuck', (req: Request, res: Response) => {
    try {
      const handle = botManager.getWorker(req.params.name as string);
      if (!handle || !handle.isAlive()) {
        res.status(404).json({ error: 'Bot not found or not connected' });
        return;
      }
      handle.sendCommand('unstuck', {});
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/bots/:name/equip-best', (req: Request, res: Response) => {
    try {
      const handle = botManager.getWorker(req.params.name as string);
      if (!handle || !handle.isAlive()) {
        res.status(404).json({ error: 'Bot not found or not connected' });
        return;
      }
      handle.sendCommand('equipBest', {});
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // ═══════════════════════════════════════
  //  PLAYERS
  // ═══════════════════════════════════════

  app.get('/api/players', (_req: Request, res: Response) => {
    try {
      const playerSet = new Set<string>();
      for (const w of botManager.getAllWorkers()) {
        const detailed = w.getCachedDetailedStatus();
        if (detailed?.nearbyPlayers) {
          for (const p of detailed.nearbyPlayers) {
            playerSet.add(typeof p === 'string' ? p : (p as any).name ?? String(p));
          }
        }
      }
      res.json({ players: Array.from(playerSet) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // ═══════════════════════════════════════
  //  TERRAIN
  // ═══════════════════════════════════════

  app.get('/api/terrain', (_req: Request, res: Response) => {
    try {
      const workers = botManager.getAllWorkers();
      const botPositions: Record<string, any> = {};
      for (const w of workers) {
        const status = w.getCachedStatus();
        if (status?.position) {
          botPositions[status.name] = status.position;
        }
      }
      res.json({ botPositions, markers: markerStore.getMarkers(), zones: markerStore.getZones() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // ═══════════════════════════════════════
  //  BOT MISSION QUEUE
  // ═══════════════════════════════════════

  app.get('/api/bots/:name/mission-queue', (req: Request, res: Response) => {
    try {
      const botName = req.params.name as string;
      const queue = missionManager.getBotMissionQueue(botName);
      res.json({ queue });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.patch('/api/bots/:name/mission-queue', (req: Request, res: Response) => {
    try {
      const botName = req.params.name as string;
      const { action, missionId, position } = req.body;
      if (!action) {
        res.status(400).json({ error: 'action is required (remove | reorder | clear)' });
        return;
      }
      const success = missionManager.updateBotMissionQueue(botName, action, missionId, position);
      if (!success) {
        res.status(400).json({ error: 'Failed to update mission queue' });
        return;
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // ═══════════════════════════════════════
  //  BOT OVERRIDE
  // ═══════════════════════════════════════

  app.get('/api/bots/:name/override', (req: Request, res: Response) => {
    try {
      const botName = req.params.name as string;
      const override = roleManager.getOverride(botName);
      res.json({ override });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.delete('/api/bots/:name/override', (req: Request, res: Response) => {
    try {
      const botName = req.params.name as string;
      roleManager.clearOverride(botName);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // ═══════════════════════════════════════
  //  COMMANDS (Control Platform)
  // ═══════════════════════════════════════

  app.post('/api/commands', async (req: Request, res: Response) => {
    try {
      const { type, scope, priority, source, targets, params, payload, force } = req.body;
      if (!type || !targets || !Array.isArray(targets) || targets.length === 0) {
        res.status(400).json({ error: 'type and targets[] are required' });
        return;
      }
      const command = commandCenter.createCommand({
        type: type as CommandType,
        scope,
        priority,
        source,
        targets,
        params,
        payload,
        force,
      });
      const dispatched = await commandCenter.dispatchCommand(command, force);
      res.status(201).json({ command: dispatched });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.get('/api/commands', (req: Request, res: Response) => {
    try {
      const bot = req.query.bot ? String(req.query.bot) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit)) : undefined;
      const commands = commandCenter.getCommands({ bot, status: status as any, limit });
      res.json({ commands });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.get('/api/commands/:id', (req: Request, res: Response) => {
    try {
      const command = commandCenter.getCommand(req.params.id as string);
      if (!command) {
        res.status(404).json({ error: 'Command not found' });
        return;
      }
      res.json({ command });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/commands/:id/cancel', (req: Request, res: Response) => {
    try {
      const { reason } = req.body ?? {};
      const command = commandCenter.cancelCommand(req.params.id as string, reason);
      if (!command) {
        res.status(404).json({ error: 'Command not found' });
        return;
      }
      res.json({ command });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // ═══════════════════════════════════════
  //  MISSIONS (Control Platform)
  // ═══════════════════════════════════════

  app.post('/api/missions', (req: Request, res: Response) => {
    try {
      const { type, title, description, assigneeType, assigneeIds, priority, source, steps, linkedCommandIds } = req.body;
      if (!type || !title || !assigneeType || !assigneeIds || !Array.isArray(assigneeIds)) {
        res.status(400).json({ error: 'type, title, assigneeType, and assigneeIds[] are required' });
        return;
      }
      const mission = missionManager.createMission({
        type: type as MissionType,
        title,
        description,
        assigneeType,
        assigneeIds,
        priority,
        source,
        steps,
        linkedCommandIds,
      });
      res.status(201).json({ mission });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.get('/api/missions', (req: Request, res: Response) => {
    try {
      const bot = req.query.bot ? String(req.query.bot) : undefined;
      const squad = req.query.squad ? String(req.query.squad) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit)) : undefined;
      const missions = missionManager.getMissions({ bot, squad, status: status as MissionStatus, limit });
      res.json({ missions });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.get('/api/missions/:id', (req: Request, res: Response) => {
    try {
      const mission = missionManager.getMission(req.params.id as string);
      if (!mission) {
        res.status(404).json({ error: 'Mission not found' });
        return;
      }
      res.json({ mission });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/missions/:id/start', async (req: Request, res: Response) => {
    try {
      const mission = await missionManager.startMission(req.params.id as string);
      if (!mission) {
        res.status(404).json({ error: 'Mission not found or cannot be started' });
        return;
      }
      res.json({ mission });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/missions/:id/pause', (req: Request, res: Response) => {
    try {
      const mission = missionManager.pauseMission(req.params.id as string);
      if (!mission) {
        res.status(404).json({ error: 'Mission not found or cannot be paused' });
        return;
      }
      res.json({ mission });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/missions/:id/resume', (req: Request, res: Response) => {
    try {
      const mission = missionManager.resumeMission(req.params.id as string);
      if (!mission) {
        res.status(404).json({ error: 'Mission not found or cannot be resumed' });
        return;
      }
      res.json({ mission });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/missions/:id/cancel', (req: Request, res: Response) => {
    try {
      const mission = missionManager.cancelMission(req.params.id as string);
      if (!mission) {
        res.status(404).json({ error: 'Mission not found or cannot be cancelled' });
        return;
      }
      res.json({ mission });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/missions/:id/retry', (req: Request, res: Response) => {
    try {
      const mission = missionManager.retryMission(req.params.id as string);
      if (!mission) {
        res.status(404).json({ error: 'Mission not found or cannot be retried' });
        return;
      }
      res.json({ mission });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // ═══════════════════════════════════════
  //  MARKERS (Control Platform)
  // ═══════════════════════════════════════

  app.get('/api/markers', (_req: Request, res: Response) => {
    try {
      res.json({ markers: markerStore.getMarkers() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/markers', (req: Request, res: Response) => {
    try {
      const { name, kind, position, tags, notes } = req.body;
      if (!name || !kind || !position) {
        res.status(400).json({ error: 'name, kind, and position are required' });
        return;
      }
      const marker = markerStore.createMarker({ name, kind, position, tags, notes });
      res.status(201).json({ marker });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.patch('/api/markers/:id', (req: Request, res: Response) => {
    try {
      const updated = markerStore.updateMarker(req.params.id as string, req.body);
      if (!updated) {
        res.status(404).json({ error: 'Marker not found' });
        return;
      }
      res.json({ marker: updated });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.delete('/api/markers/:id', (req: Request, res: Response) => {
    try {
      const deleted = markerStore.deleteMarker(req.params.id as string);
      if (!deleted) {
        res.status(404).json({ error: 'Marker not found' });
        return;
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // ═══════════════════════════════════════
  //  ZONES (Control Platform)
  // ═══════════════════════════════════════

  app.get('/api/zones', (_req: Request, res: Response) => {
    try {
      res.json({ zones: markerStore.getZones() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/zones', (req: Request, res: Response) => {
    try {
      const { name, mode, shape, circle, rectangle, markerIds, rules } = req.body;
      if (!name || !mode || !shape) {
        res.status(400).json({ error: 'name, mode, and shape are required' });
        return;
      }
      const zone = markerStore.createZone({ name, mode, shape, circle, rectangle, markerIds, rules });
      res.status(201).json({ zone });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.patch('/api/zones/:id', (req: Request, res: Response) => {
    try {
      const updated = markerStore.updateZone(req.params.id as string, req.body);
      if (!updated) {
        res.status(404).json({ error: 'Zone not found' });
        return;
      }
      res.json({ zone: updated });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.delete('/api/zones/:id', (req: Request, res: Response) => {
    try {
      const deleted = markerStore.deleteZone(req.params.id as string);
      if (!deleted) {
        res.status(404).json({ error: 'Zone not found' });
        return;
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // ═══════════════════════════════════════
  //  ROUTES (Control Platform)
  // ═══════════════════════════════════════

  app.get('/api/routes', (_req: Request, res: Response) => {
    try {
      res.json({ routes: markerStore.getRoutes() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/routes', (req: Request, res: Response) => {
    try {
      const { name, waypointIds, loop } = req.body;
      if (!name || !waypointIds || !Array.isArray(waypointIds)) {
        res.status(400).json({ error: 'name and waypointIds[] are required' });
        return;
      }
      const route = markerStore.createRoute({ name, waypointIds, loop: loop ?? false });
      res.status(201).json({ route });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.patch('/api/routes/:id', (req: Request, res: Response) => {
    try {
      const updated = markerStore.updateRoute(req.params.id as string, req.body);
      if (!updated) {
        res.status(404).json({ error: 'Route not found' });
        return;
      }
      res.json({ route: updated });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.delete('/api/routes/:id', (req: Request, res: Response) => {
    try {
      const deleted = markerStore.deleteRoute(req.params.id as string);
      if (!deleted) {
        res.status(404).json({ error: 'Route not found' });
        return;
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // ═══════════════════════════════════════
  //  SQUADS (Control Platform)
  // ═══════════════════════════════════════

  app.get('/api/squads', (_req: Request, res: Response) => {
    try {
      res.json({ squads: squadManager.getSquads() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/squads', (req: Request, res: Response) => {
    try {
      const { name, botNames, defaultRole, homeMarkerId } = req.body;
      if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      const squad = squadManager.createSquad({ name, botNames: botNames ?? [], defaultRole, homeMarkerId });
      res.status(201).json({ squad });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.get('/api/squads/:id', (req: Request, res: Response) => {
    try {
      const squad = squadManager.getSquad(req.params.id as string);
      if (!squad) {
        res.status(404).json({ error: 'Squad not found' });
        return;
      }
      res.json({ squad });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.patch('/api/squads/:id', (req: Request, res: Response) => {
    try {
      const updated = squadManager.updateSquad(req.params.id as string, req.body);
      if (!updated) {
        res.status(404).json({ error: 'Squad not found' });
        return;
      }
      res.json({ squad: updated });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.delete('/api/squads/:id', (req: Request, res: Response) => {
    try {
      const deleted = squadManager.deleteSquad(req.params.id as string);
      if (!deleted) {
        res.status(404).json({ error: 'Squad not found' });
        return;
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/squads/:id/members', (req: Request, res: Response) => {
    try {
      const { botName } = req.body;
      if (!botName) {
        res.status(400).json({ error: 'botName is required' });
        return;
      }
      const success = squadManager.addBotToSquad(req.params.id as string, botName);
      if (!success) {
        res.status(404).json({ error: 'Squad not found' });
        return;
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.delete('/api/squads/:id/members/:botName', (req: Request, res: Response) => {
    try {
      const success = squadManager.removeBotFromSquad(req.params.id as string, req.params.botName as string);
      if (!success) {
        res.status(404).json({ error: 'Squad or bot not found' });
        return;
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // ═══════════════════════════════════════
  //  ROLES (Control Platform)
  // ═══════════════════════════════════════

  app.get('/api/roles/assignments', (_req: Request, res: Response) => {
    try {
      res.json({ assignments: roleManager.getAssignments() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/roles/assignments', (req: Request, res: Response) => {
    try {
      const { botName, role, autonomyLevel, homeMarkerId, allowedZoneIds, preferredMissionTypes, interruptPolicy, loadoutPolicy } = req.body;
      if (!botName || !role || !autonomyLevel) {
        res.status(400).json({ error: 'botName, role, and autonomyLevel are required' });
        return;
      }
      const assignment = roleManager.createAssignment({
        botName,
        role,
        autonomyLevel,
        homeMarkerId,
        allowedZoneIds,
        preferredMissionTypes,
        interruptPolicy,
        loadoutPolicy,
      });
      res.status(201).json({ assignment });
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? 'Invalid role assignment' });
    }
  });

  app.get('/api/roles/assignments/:id', (req: Request, res: Response) => {
    try {
      const assignment = roleManager.getAssignment(req.params.id as string);
      if (!assignment) {
        res.status(404).json({ error: 'Assignment not found' });
        return;
      }
      res.json({ assignment });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.patch('/api/roles/assignments/:id', (req: Request, res: Response) => {
    try {
      const updated = roleManager.updateAssignment(req.params.id as string, req.body);
      if (!updated) {
        res.status(404).json({ error: 'Assignment not found' });
        return;
      }
      res.json({ assignment: updated });
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? 'Invalid update' });
    }
  });

  app.delete('/api/roles/assignments/:id', (req: Request, res: Response) => {
    try {
      const deleted = roleManager.deleteAssignment(req.params.id as string);
      if (!deleted) {
        res.status(404).json({ error: 'Assignment not found' });
        return;
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  // ═══════════════════════════════════════
  //  COMMANDER (Natural Language)
  // ═══════════════════════════════════════

  app.post('/api/commander/parse', async (req: Request, res: Response) => {
    try {
      const { input } = req.body;
      if (!input) {
        res.status(400).json({ error: 'input is required' });
        return;
      }
      const plan = await commanderService.parse(input);
      res.json({ plan });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.post('/api/commander/execute', async (req: Request, res: Response) => {
    try {
      const { planId } = req.body;
      if (!planId) {
        res.status(400).json({ error: 'planId is required' });
        return;
      }
      const result = await commanderService.execute(planId);
      if (!result) {
        res.status(404).json({ error: 'Plan not found or requires clarification' });
        return;
      }
      res.json({ result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  return {
    app,
    httpServer,
    io,
    eventLog,
    markerStore,
    squadManager,
    roleManager,
    commandCenter,
    missionManager,
    commanderService,
  };
}
