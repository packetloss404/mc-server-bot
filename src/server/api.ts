import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { BotInstance } from '../bot/BotInstance';
import { EventLog, BotEvent } from './EventLog';
import { logger } from '../util/logger';
import { BuildCoordinator } from '../build/BuildCoordinator';
import { ChainCoordinator } from '../supplychain/ChainCoordinator';

export interface APIServerResult {
  app: express.Application;
  httpServer: http.Server;
  io: SocketIOServer;
  eventLog: EventLog;
  buildCoordinator: BuildCoordinator;
  chainCoordinator: ChainCoordinator;
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

  // ═══════════════════════════════════════
  //  BUILD COORDINATOR + SCHEMATIC/BUILD ENDPOINTS
  // ═══════════════════════════════════════

  const buildCoordinator = new BuildCoordinator(botManager, io, eventLog);

  // List all available schematics
  app.get('/api/schematics', async (_req: Request, res: Response) => {
    try {
      const schematics = await buildCoordinator.listSchematics();
      res.json({ schematics });
    } catch (err: any) {
      logger.error({ err }, 'Failed to list schematics');
      res.status(500).json({ error: 'Failed to list schematics' });
    }
  });

  // Get single schematic info
  app.get('/api/schematics/:filename', async (req: Request, res: Response) => {
    try {
      const info = await buildCoordinator.getSchematicInfoAsync(req.params.filename as string);
      if (!info) {
        res.status(404).json({ error: 'Schematic not found' });
        return;
      }
      res.json({ schematic: info });
    } catch (err: any) {
      logger.error({ err, filename: req.params.filename }, 'Failed to get schematic info');
      res.status(500).json({ error: 'Failed to get schematic info' });
    }
  });

  // Start a multi-bot build
  app.post('/api/builds', async (req: Request, res: Response) => {
    const { schematicFile, origin, botNames } = req.body;

    if (!schematicFile || !origin || !botNames || !Array.isArray(botNames) || botNames.length === 0) {
      res.status(400).json({ error: 'schematicFile, origin {x,y,z}, and botNames[] are required' });
      return;
    }

    if (typeof origin.x !== 'number' || typeof origin.y !== 'number' || typeof origin.z !== 'number') {
      res.status(400).json({ error: 'origin must have numeric x, y, z fields' });
      return;
    }

    try {
      const build = await buildCoordinator.startBuild(schematicFile, origin, botNames);
      res.status(201).json({ success: true, build });
    } catch (err: any) {
      logger.error({ err }, 'Failed to start build');
      res.status(400).json({ error: err.message });
    }
  });

  // List all build jobs
  app.get('/api/builds', (_req: Request, res: Response) => {
    const jobs = buildCoordinator.getAllBuildJobs();
    res.json({ builds: jobs });
  });

  // Get single build job
  app.get('/api/builds/:id', (req: Request, res: Response) => {
    const job = buildCoordinator.getBuildJob(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: 'Build job not found' });
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
  //  SUPPLY CHAIN COORDINATOR + ENDPOINTS
  // ═══════════════════════════════════════

  const chainCoordinator = new ChainCoordinator(botManager, io, eventLog);

  // List all available chain templates
  app.get('/api/chain-templates', (_req: Request, res: Response) => {
    const templates = chainCoordinator.getTemplates();
    res.json({ templates });
  });

  // List all supply chains
  app.get('/api/chains', (_req: Request, res: Response) => {
    const chains = chainCoordinator.getAllChains();
    res.json({ chains });
  });

  // Get single supply chain
  app.get('/api/chains/:id', (req: Request, res: Response) => {
    const chain = chainCoordinator.getChain(req.params.id as string);
    if (!chain) {
      res.status(404).json({ error: 'Supply chain not found' });
      return;
    }
    res.json({ chain });
  });

  // Create a supply chain
  app.post('/api/chains', (req: Request, res: Response) => {
    const { name, description, templateId, stages, loop, botAssignments, chestLocations } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    try {
      const chain = chainCoordinator.createChain({
        name,
        description,
        templateId,
        stages,
        loop,
        botAssignments,
        chestLocations,
      });
      res.status(201).json({ chain });
    } catch (err: any) {
      logger.error({ err }, 'Failed to create supply chain');
      res.status(400).json({ error: err.message });
    }
  });

  // Delete a supply chain
  app.delete('/api/chains/:id', (req: Request, res: Response) => {
    const success = chainCoordinator.deleteChain(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Supply chain not found' });
      return;
    }
    res.json({ success: true });
  });

  // Start a supply chain
  app.post('/api/chains/:id/start', (req: Request, res: Response) => {
    const success = chainCoordinator.startChain(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Supply chain not found or already running' });
      return;
    }
    res.json({ success: true });
  });

  // Pause a supply chain
  app.post('/api/chains/:id/pause', (req: Request, res: Response) => {
    const success = chainCoordinator.pauseChain(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Supply chain not found or not running' });
      return;
    }
    res.json({ success: true });
  });

  // Cancel a supply chain
  app.post('/api/chains/:id/cancel', (req: Request, res: Response) => {
    const success = chainCoordinator.cancelChain(req.params.id as string);
    if (!success) {
      res.status(404).json({ error: 'Supply chain not found' });
      return;
    }
    res.json({ success: true });
  });

  // ═══════════════════════════════════════
  //  SOCIAL MEMORY + BOT COMMS ENDPOINTS
  // ═══════════════════════════════════════

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

  return { app, httpServer, io, eventLog, buildCoordinator, chainCoordinator };
}
