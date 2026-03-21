import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { BotInstance } from '../bot/BotInstance';
import { EventLog, BotEvent } from './EventLog';
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
  //  BOT COMMAND CENTER
  // ═══════════════════════════════════════

  // Equip bot with full gear and inventory
  app.post('/api/bots/:name/equip', (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.name as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!bot.bot) { res.status(400).json({ error: 'Bot not connected' }); return; }
    bot.equip();
    const event = eventLog.push({ type: 'bot:state', botName: req.params.name as string, description: `${req.params.name} equipped with full gear` });
    io.emit('activity', event);
    res.json({ success: true });
  });

  // Pause voyager loop
  app.post('/api/bots/:name/pause', (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.name as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    const voyager = bot.getVoyagerLoop();
    if (!voyager) { res.status(400).json({ error: 'Bot has no voyager loop (not in codegen mode)' }); return; }
    voyager.pause();
    const event = eventLog.push({ type: 'bot:state', botName: req.params.name as string, description: 'Voyager paused from dashboard' });
    io.emit('activity', event);
    res.json({ success: true });
  });

  // Resume voyager loop
  app.post('/api/bots/:name/resume', (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.name as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    const voyager = bot.getVoyagerLoop();
    if (!voyager) { res.status(400).json({ error: 'Bot has no voyager loop (not in codegen mode)' }); return; }
    voyager.resume();
    const event = eventLog.push({ type: 'bot:state', botName: req.params.name as string, description: 'Voyager resumed from dashboard' });
    io.emit('activity', event);
    res.json({ success: true });
  });

  // Follow a player
  app.post('/api/bots/:name/follow', async (req: Request, res: Response) => {
    const { playerName } = req.body;
    if (!playerName) { res.status(400).json({ error: 'playerName is required' }); return; }
    const botInstance = botManager.getBot(req.params.name as string);
    if (!botInstance?.bot) { res.status(404).json({ error: 'Bot not found or not connected' }); return; }
    // Simulate the follow command
    (botInstance as any).state = 'FOLLOWING';
    const voyager = botInstance.getVoyagerLoop();
    if (voyager) voyager.pause();
    const { followPlayer } = await import('../actions/followPlayer');
    followPlayer(botInstance.bot, playerName, 600000).finally(() => {
      if ((botInstance as any).state === 'FOLLOWING') (botInstance as any).state = 'IDLE';
      if (voyager) voyager.resume();
    });
    const event = eventLog.push({ type: 'bot:state', botName: req.params.name as string, description: `Following ${playerName}` });
    io.emit('activity', event);
    res.json({ success: true });
  });

  // Stop / Stay
  app.post('/api/bots/:name/stop', (req: Request, res: Response) => {
    const botInstance = botManager.getBot(req.params.name as string);
    if (!botInstance?.bot) { res.status(404).json({ error: 'Bot not found or not connected' }); return; }
    if (botInstance.bot.pathfinder.isMoving()) {
      botInstance.bot.pathfinder.setGoal(null);
    }
    (botInstance as any).state = 'IDLE';
    const event = eventLog.push({ type: 'bot:state', botName: req.params.name as string, description: 'Stopped from dashboard' });
    io.emit('activity', event);
    res.json({ success: true });
  });

  // Walk to coordinates
  app.post('/api/bots/:name/walkto', async (req: Request, res: Response) => {
    const { x, y, z } = req.body;
    if (x === undefined || z === undefined) { res.status(400).json({ error: 'x and z are required' }); return; }
    const botInstance = botManager.getBot(req.params.name as string);
    if (!botInstance?.bot) { res.status(404).json({ error: 'Bot not found or not connected' }); return; }
    const targetY = y ?? botInstance.bot.entity.position.y;
    (botInstance as any).state = 'EXECUTING_TASK';
    const voyager = botInstance.getVoyagerLoop();
    if (voyager) voyager.pause();
    const { walkTo } = await import('../actions/walkTo');
    walkTo(botInstance.bot, x, targetY, z).then((result) => {
      (botInstance as any).state = 'IDLE';
      if (voyager) voyager.resume();
      const event = eventLog.push({ type: 'bot:task', botName: req.params.name as string, description: result.message ?? `Walked to ${x}, ${z}` });
      io.emit('activity', event);
    });
    res.json({ success: true });
  });

  // ═══════════════════════════════════════
  //  MAP / TERRAIN ENDPOINTS
  // ═══════════════════════════════════════

  // Scan terrain: returns a grid of surface block names for rendering on the map.
  // Query params: cx, cz (center coords), radius (in blocks, max 128), step (sample every N blocks, default 1)
  app.get('/api/terrain', (req: Request, res: Response) => {
    const cx = parseInt(String(req.query.cx ?? '0')) || 0;
    const cz = parseInt(String(req.query.cz ?? '0')) || 0;
    const radius = Math.min(parseInt(String(req.query.radius ?? '64')) || 64, 128);
    const step = Math.max(1, Math.min(parseInt(String(req.query.step ?? '1')) || 1, 8));

    // Use the first connected bot's world for block access
    const allBots = botManager.getAllBots();
    const connectedBot = allBots.find((b) => b.bot);
    if (!connectedBot?.bot) {
      res.status(503).json({ error: 'No connected bot available for terrain scanning' });
      return;
    }

    const bot = connectedBot.bot;
    const size = Math.floor((radius * 2) / step) + 1;
    // Pack into a flat array: row-major [z][x], each entry is a block name
    const blocks: string[] = new Array(size * size);
    let idx = 0;

    // Reference height: use the first bot's Y position as a starting scan point
    const refY = bot.entity?.position?.y ? Math.round(bot.entity.position.y) : 64;

    for (let dz = -radius; dz <= radius; dz += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        const worldX = cx + dx;
        const worldZ = cz + dz;
        let blockName = 'unknown';

        try {
          // Scan from refY+16 downward in a tight window — fast for nearby terrain
          const scanTop = refY + 16;
          const scanBottom = refY - 32;
          for (let y = scanTop; y >= scanBottom; y--) {
            const block = bot.blockAt(bot.entity.position.clone().set(worldX, y, worldZ));
            if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
              blockName = block.name;
              break;
            }
          }
        } catch { /* ignore */ }

        blocks[idx++] = blockName;
      }
    }

    res.json({
      cx,
      cz,
      radius,
      step,
      size,
      blocks,
    });
  });

  // Online players list
  app.get('/api/players', (_req: Request, res: Response) => {
    const allBots = botManager.getAllBots();
    const connectedBot = allBots.find((b) => b.bot);
    if (!connectedBot?.bot) {
      res.json({ players: [] });
      return;
    }

    const players = Object.values(connectedBot.bot.players)
      .filter((p) => p.entity)
      .map((p) => ({
        name: p.username,
        position: p.entity ? {
          x: Math.round(p.entity.position.x),
          y: Math.round(p.entity.position.y),
          z: Math.round(p.entity.position.z),
        } : null,
        isOnline: true,
      }));

    res.json({ players });
  });

  return { app, httpServer, io, eventLog };
}
