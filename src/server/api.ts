import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { BotInstance } from '../bot/BotInstance';
import { EventLog, BotEvent } from './EventLog';
import { logger } from '../util/logger';
import { SquadManager } from '../control/SquadManager';

export interface APIServerResult {
  app: express.Application;
  httpServer: http.Server;
  io: SocketIOServer;
  eventLog: EventLog;
  squadManager: SquadManager;
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
  //  EXISTING ENDPOINTS (unchanged logic)
  // ═══════════════════════════════════════

  // Health check
  app.get('/api/status', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      botCount: botManager.getAllBots().length,
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
  //  CONTROL PLATFORM - SQUAD ENDPOINTS
  // ═══════════════════════════════════════

  const squadManager = new SquadManager(io);

  // List all squads
  app.get('/api/squads', (_req: Request, res: Response) => {
    res.json({ squads: squadManager.getSquads() });
  });

  // Create a squad
  app.post('/api/squads', (req: Request, res: Response) => {
    const { name, botNames, defaultRole, homeMarkerId } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const squad = squadManager.createSquad({
      name,
      botNames: botNames ?? [],
      defaultRole,
      homeMarkerId,
    });
    res.status(201).json({ squad });
  });

  // Get single squad
  app.get('/api/squads/:id', (req: Request, res: Response) => {
    const squad = squadManager.getSquad(req.params.id as string);
    if (!squad) {
      res.status(404).json({ error: 'Squad not found' });
      return;
    }
    res.json({ squad });
  });

  // Update a squad
  app.patch('/api/squads/:id', (req: Request, res: Response) => {
    const squad = squadManager.updateSquad(req.params.id as string, req.body);
    if (!squad) {
      res.status(404).json({ error: 'Squad not found' });
      return;
    }
    res.json({ squad });
  });

  // Delete a squad
  app.delete('/api/squads/:id', (req: Request, res: Response) => {
    const deleted = squadManager.deleteSquad(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: 'Squad not found' });
      return;
    }
    res.json({ success: true });
  });

  // Add bot to squad
  app.post('/api/squads/:id/members', (req: Request, res: Response) => {
    const { botName } = req.body;
    if (!botName) {
      res.status(400).json({ error: 'botName is required' });
      return;
    }
    const added = squadManager.addBotToSquad(req.params.id as string, botName);
    if (!added) {
      res.status(404).json({ error: 'Squad not found' });
      return;
    }
    res.json({ success: true });
  });

  // Remove bot from squad
  app.delete('/api/squads/:id/members/:botName', (req: Request, res: Response) => {
    const removed = squadManager.removeBotFromSquad(
      req.params.id as string,
      req.params.botName as string,
    );
    if (!removed) {
      res.status(404).json({ error: 'Squad not found or bot not a member' });
      return;
    }
    res.json({ success: true });
  });

  return { app, httpServer, io, eventLog, squadManager };
}
