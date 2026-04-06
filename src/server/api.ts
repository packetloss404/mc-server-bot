import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Vec3 } from 'vec3';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { EventLog } from './EventLog';
import { BuildCoordinator } from '../build/BuildCoordinator';
import { ChainCoordinator } from '../supplychain/ChainCoordinator';
import { logger } from '../util/logger';

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

  // ── Build coordinator ──
  const buildCoordinator = new BuildCoordinator(botManager, io, eventLog);

  // ── Supply chain coordinator ──
  const chainCoordinator = new ChainCoordinator(botManager, io, eventLog);

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
  //  SCHEMATIC ENDPOINTS
  // ═══════════════════════════════════════

  // List .schem files in schematics/ directory
  app.get('/api/schematics', async (_req: Request, res: Response) => {
    try {
      const schematics = await buildCoordinator.listSchematics();
      res.json({ schematics });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════
  //  BUILD ENDPOINTS
  // ═══════════════════════════════════════

  // List all build jobs
  app.get('/api/builds', (_req: Request, res: Response) => {
    res.json({ builds: buildCoordinator.getAllBuildJobs() });
  });

  // Get a specific build job
  app.get('/api/builds/:id', (req: Request, res: Response) => {
    const job = buildCoordinator.getBuildJob(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: 'Build job not found' });
      return;
    }
    res.json({ build: job });
  });

  // Start a new build
  app.post('/api/builds', async (req: Request, res: Response) => {
    try {
      const { schematicFile, origin, botNames, options } = req.body;

      if (!schematicFile || !origin || !botNames || !Array.isArray(botNames)) {
        res.status(400).json({ error: 'schematicFile, origin {x,y,z}, and botNames[] are required' });
        return;
      }

      const job = await buildCoordinator.startBuild(schematicFile, origin, botNames, options);

      const event = eventLog.push({
        type: 'build:started',
        botName: botNames.join(', '),
        description: `Build started: ${schematicFile}`,
        metadata: { jobId: job.id },
      });
      io.emit('activity', event);

      res.status(201).json({ build: job });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
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

  // Get a specific chain
  app.get('/api/chains/:id', (req: Request, res: Response) => {
    const chain = chainCoordinator.getChain(req.params.id as string);
    if (!chain) {
      res.status(404).json({ error: 'Supply chain not found' });
      return;
    }
    res.json({ chain });
  });

  // Create a new chain
  app.post('/api/chains', (req: Request, res: Response) => {
    try {
      const chain = chainCoordinator.createChain(req.body);

      const event = eventLog.push({
        type: 'chain:created',
        botName: chain.stages.map((s) => s.botName).filter(Boolean).join(', '),
        description: `Supply chain created: ${chain.name}`,
        metadata: { chainId: chain.id },
      });
      io.emit('activity', event);

      res.status(201).json({ chain });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
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

  // Scan blocks around a bot's position
  app.get('/api/terrain', (req: Request, res: Response) => {
    try {
      const botName = req.query.bot ? String(req.query.bot) : undefined;
      const radius = parseInt(String(req.query.radius ?? '8'), 10);

      if (!botName) {
        res.status(400).json({ error: 'bot query parameter is required' });
        return;
      }

      const handle = botManager.getWorker(botName) as any;
      if (!handle) {
        res.status(404).json({ error: 'Bot not found' });
        return;
      }

      const detailed = handle.getCachedDetailedStatus();
      const pos = detailed?.position || handle.getCachedStatus()?.position;
      if (!pos) {
        res.status(400).json({ error: 'Bot position not available' });
        return;
      }

      // Use the bot's mineflayer instance if available via worker
      // Since we use worker threads, we read from cached detailed status
      // and report block info from the bot's position
      const clampedRadius = Math.min(radius, 16);
      const blocks: Array<{ x: number; y: number; z: number; name: string }> = [];

      // We cannot directly access mineflayer from the main thread (worker architecture),
      // so return the bot's position and nearby entity/block info from cached state
      res.json({
        bot: botName,
        center: pos,
        radius: clampedRadius,
        blocks,
        note: 'Block scanning requires direct bot access; use /api/terrain/height for ground-level queries via bot commands',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get ground height at coordinates (uses first available bot to probe)
  app.get('/api/terrain/height', (req: Request, res: Response) => {
    try {
      const x = parseInt(String(req.query.x ?? ''), 10);
      const z = parseInt(String(req.query.z ?? ''), 10);

      if (isNaN(x) || isNaN(z)) {
        res.status(400).json({ error: 'x and z query parameters are required (integers)' });
        return;
      }

      // Find a connected bot to probe terrain
      const workers = botManager.getAllWorkers();
      const probeBot = workers.find((w) => w.isAlive());

      if (!probeBot) {
        res.status(503).json({ error: 'No connected bots available to probe terrain' });
        return;
      }

      // Since bots run in worker threads, we send a command and return a best-effort estimate
      // based on the bot's known position. For real height queries, the dashboard can
      // ask the bot to navigate to the location.
      const status = probeBot.getCachedDetailedStatus();
      const botPos = status?.position;

      res.json({
        x,
        z,
        estimatedHeight: botPos ? Math.round(botPos.y) : null,
        probeBotName: probeBot.botName,
        note: 'Height is estimated from probe bot position; exact height requires the bot to be near the target coordinates',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return { app, httpServer, io, eventLog, buildCoordinator, chainCoordinator };
}
