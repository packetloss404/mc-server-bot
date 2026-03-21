import mineflayer, { Bot } from 'mineflayer';
import { pathfinder, Movements } from 'mineflayer-pathfinder';
import { plugin as collectBlock } from 'mineflayer-collectblock';
import { Vec3 } from 'vec3';
import { BotState, BotMode } from './BotState';
import { Config } from '../config';
import { logger } from '../util/logger';
import { LLMClient } from '../ai/LLMClient';
import { AffinityManager } from '../personality/AffinityManager';
import { ConversationManager } from '../personality/ConversationManager';
import { buildSystemPrompt, buildAmbientContext } from '../ai/prompts/personality';
import { analyzeSentiment, parseCommand, extractTask } from '../ai/prompts/chat';
import { followPlayer } from '../actions/followPlayer';
import { VoyagerLoop } from '../voyager/VoyagerLoop';

export interface BotOptions {
  name: string;
  personality: string;
  mode: BotMode;
  spawnLocation?: { x: number; y: number; z: number };
  config: Config;
  llmClient: LLMClient | null;
  affinityManager: AffinityManager;
  conversationManager: ConversationManager;
}

export class BotInstance {
  readonly name: string;
  readonly personality: string;
  mode: BotMode;
  state: BotState = BotState.SPAWNING;
  bot: Bot | null = null;

  private config: Config;
  private spawnLocation?: { x: number; y: number; z: number };
  private headTrackingInterval: NodeJS.Timeout | null = null;
  private wanderInterval: NodeJS.Timeout | null = null;
  private ambientChatTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private destroyed = false;
  private llmClient: LLMClient | null;
  private affinityManager: AffinityManager;
  private conversationManager: ConversationManager;
  private chatCooldowns: Map<string, number> = new Map();
  private voyagerLoop: VoyagerLoop | null = null;
  private static CHAT_COOLDOWN_MS = 3000;

  constructor(options: BotOptions) {
    this.name = options.name;
    this.personality = options.personality;
    this.mode = options.mode;
    this.spawnLocation = options.spawnLocation;
    this.config = options.config;
    this.llmClient = options.llmClient;
    this.affinityManager = options.affinityManager;
    this.conversationManager = options.conversationManager;
  }

  async connect(): Promise<void> {
    if (this.destroyed) return;

    this.state = BotState.SPAWNING;
    logger.info({ bot: this.name }, 'Connecting to Minecraft server...');

    this.bot = mineflayer.createBot({
      host: this.config.minecraft.host,
      port: this.config.minecraft.port,
      username: this.name,
      version: this.config.minecraft.version,
      auth: this.config.minecraft.auth as any,
      physicsEnabled: false,
    });

    this.bot.loadPlugin(pathfinder);
    this.bot.loadPlugin(collectBlock);

    this.bot.on('spawn', () => {
      logger.info({
        bot: this.name,
        position: this.bot?.entity?.position ? {
          x: Number(this.bot.entity.position.x.toFixed(1)),
          y: Number(this.bot.entity.position.y.toFixed(1)),
          z: Number(this.bot.entity.position.z.toFixed(1)),
        } : null,
        health: this.bot?.health,
        food: this.bot?.food,
      }, 'Bot spawned in world');
      this.reconnectAttempts = 0;

      if (this.bot) {
        this.bot.physicsEnabled = true;

        // Set up pathfinder movements
        const mcData = require('minecraft-data')(this.bot.version);
        const movements = new Movements(this.bot);
        movements.canDig = false; // Don't destroy blocks while pathfinding
        this.bot.pathfinder.setMovements(movements);
        logger.info({ bot: this.name, canDig: movements.canDig }, 'Pathfinder movements configured');
      }

      // Auth with DyoAuth before doing anything else
      this.handleAuth(() => {
        // Teleport to spawn location if specified
        if (this.spawnLocation && this.bot) {
          this.bot.chat(`/tp ${this.name} ${this.spawnLocation.x} ${this.spawnLocation.y} ${this.spawnLocation.z}`);
        }

        this.state = BotState.IDLE;
        this.startHeadTracking();
        if (this.mode !== BotMode.CODEGEN) {
          this.startWandering(); // Voyager owns movement in codegen mode
        }
        this.startChatListener();
        this.scheduleAmbientChat();
        this.startVoyagerIfCodegen();
      });
    });

    this.bot.on('error', (err) => {
      logger.error({ bot: this.name, err: err.message }, 'Bot error');
    });

    this.bot.on('death', () => {
      logger.warn({
        bot: this.name,
        state: this.state,
        position: this.bot?.entity?.position ? {
          x: Number(this.bot.entity.position.x.toFixed(1)),
          y: Number(this.bot.entity.position.y.toFixed(1)),
          z: Number(this.bot.entity.position.z.toFixed(1)),
        } : null,
        pathfinderMoving: this.bot?.pathfinder?.isMoving?.() ?? false,
      }, 'Bot died');
      if (this.bot?.pathfinder?.isMoving()) {
        this.bot.pathfinder.stop();
        logger.warn({ bot: this.name }, 'Stopped pathfinder after death');
      }
    });

    this.bot.on('health', () => {
      logger.info({
        bot: this.name,
        health: this.bot?.health,
        food: this.bot?.food,
      }, 'Bot health updated');
    });

    this.bot.on('goal_reached', () => {
      const pos = this.bot?.entity?.position;
      logger.info({
        bot: this.name,
        position: pos ? {
          x: Number(pos.x.toFixed(1)),
          y: Number(pos.y.toFixed(1)),
          z: Number(pos.z.toFixed(1)),
        } : null,
      }, 'Bot goal reached');
    });

    this.bot.on('path_update', (result: any) => {
      logger.info({
        bot: this.name,
        status: result?.status || 'unknown',
        nodes: Array.isArray(result?.path) ? result.path.length : 0,
      }, 'Pathfinder updated');
    });

    this.bot.on('path_reset', (reason: any) => {
      logger.warn({ bot: this.name, reason: String(reason || 'unknown') }, 'Pathfinder reset');
    });

    this.bot.on('path_stop', () => {
      logger.info({ bot: this.name }, 'Pathfinder stopped');
    });

    this.bot.on('kicked', (reason) => {
      logger.warn({ bot: this.name, reason }, 'Bot was kicked');
      this.state = BotState.DISCONNECTED;
      this.stopAmbientBehaviors();
      this.scheduleReconnect();
    });

    this.bot.on('end', (reason) => {
      if (this.destroyed) return;
      logger.warn({ bot: this.name, reason }, 'Bot disconnected');
      this.state = BotState.DISCONNECTED;
      this.stopAmbientBehaviors();
      this.scheduleReconnect();
    });
  }

  private static BOT_PASSWORD = 'dyobot2026';

  private handleAuth(onReady: () => void): void {
    if (!this.bot) return;

    const bot = this.bot;
    let authDone = false;

    const finish = () => {
      if (authDone) return;
      authDone = true;
      bot.removeListener('message', onMessage);
      logger.info({ bot: this.name }, 'Auth complete');
      onReady();
    };

    const onMessage = (jsonMsg: any) => {
      if (authDone) return;
      const msg = jsonMsg.toString();

      if (msg.includes('Registered successfully') || msg.includes('Logged in successfully') || msg.includes('already logged in')) {
        finish();
      } else if (msg.includes('already registered') || msg.includes('Please log in')) {
        logger.info({ bot: this.name }, 'Already registered, logging in');
        bot.chat(`/login ${BotInstance.BOT_PASSWORD}`);
      } else if (msg.includes('Please register') || msg.includes('not registered')) {
        logger.info({ bot: this.name }, 'Registering with DyoAuth');
        bot.chat(`/register ${BotInstance.BOT_PASSWORD} ${BotInstance.BOT_PASSWORD}`);
      }
    };

    bot.on('message', onMessage);

    // Proactively try register after 1s (in case message event was missed)
    setTimeout(() => {
      if (!authDone && bot) {
        bot.chat(`/register ${BotInstance.BOT_PASSWORD} ${BotInstance.BOT_PASSWORD}`);
      }
    }, 1000);

    // Timeout fallback
    setTimeout(() => {
      if (!authDone) {
        logger.warn({ bot: this.name }, 'Auth timeout, proceeding anyway');
        finish();
      }
    }, 15000);
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectAttempts >= this.config.bots.maxReconnectAttempts) {
      logger.error({ bot: this.name }, 'Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(
      this.config.bots.reconnectDelaySec * Math.pow(2, this.reconnectAttempts) * 1000,
      30000
    );
    this.reconnectAttempts++;

    logger.info({ bot: this.name, delay, attempt: this.reconnectAttempts }, 'Scheduling reconnect');
    setTimeout(() => this.connect(), delay);
  }

  startHeadTracking(): void {
    if (this.headTrackingInterval) return;

    this.headTrackingInterval = setInterval(() => {
      if (!this.bot || this.state === BotState.DISCONNECTED) return;

      const players = Object.values(this.bot.players).filter(
        (p) => p.entity && p.username !== this.bot!.username
      );

      if (players.length === 0) return;

      // Find nearest player
      const botPos = this.bot.entity.position;
      let nearest = players[0];
      let nearestDist = Infinity;

      for (const p of players) {
        if (!p.entity) continue;
        const dist = p.entity.position.distanceTo(botPos);
        if (dist < nearestDist) {
          nearest = p;
          nearestDist = dist;
        }
      }

      if (nearest.entity && nearestDist < this.config.behavior.headTrackingRange) {
        const headPos = nearest.entity.position.offset(0, nearest.entity.height, 0);
        this.bot.lookAt(headPos);
      }
    }, this.config.behavior.headTrackingTickMs);
  }

  startWandering(): void {
    if (this.wanderInterval) return;

    this.wanderInterval = setInterval(() => {
      if (!this.bot || this.state !== BotState.IDLE) return;

      const { goals } = require('mineflayer-pathfinder');
      const pos = this.bot.entity.position;
      const radius = this.config.behavior.wanderRadius;

      const dx = (Math.random() - 0.5) * 2 * radius;
      const dz = (Math.random() - 0.5) * 2 * radius;
      const target = pos.offset(dx, 0, dz);

      this.state = BotState.WANDERING;
      this.bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 2));

      this.bot.once('goal_reached', () => {
        if (this.state === BotState.WANDERING) {
          this.state = BotState.IDLE;
        }
      });

      // Timeout: go idle if pathfinding takes too long
      setTimeout(() => {
        if (this.state === BotState.WANDERING && this.bot) {
          this.bot.pathfinder.setGoal(null);
          this.state = BotState.IDLE;
        }
      }, 15000);
    }, this.config.behavior.wanderIntervalMs);
  }

  private startChatListener(): void {
    if (!this.bot) return;

    this.bot.on('chat', async (username: string, message: string) => {
      // Ignore own messages and empty messages
      if (!this.bot || username === this.bot.username || !message.trim()) return;

      // Check if player is within conversation radius
      const player = this.bot.players[username];
      if (!player?.entity) return;

      const dist = player.entity.position.distanceTo(this.bot.entity.position);
      if (dist > this.config.behavior.conversationRadius) return;

      // Rate limit per player
      const now = Date.now();
      const lastChat = this.chatCooldowns.get(username) || 0;
      if (now - lastChat < BotInstance.CHAT_COOLDOWN_MS) return;
      this.chatCooldowns.set(username, now);

      // Check for commands first
      const command = parseCommand(message);
      if (command) {
        await this.handleCommand(command, username);
        return;
      }

      // Generate AI chat response
      await this.handleChat(username, message);
    });
  }

  private async handleCommand(
    command: { command: string; args: string },
    playerName: string
  ): Promise<void> {
    if (!this.bot) return;

    logger.info({ bot: this.name, player: playerName, command }, 'Executing command');

    switch (command.command) {
      case 'follow':
        this.bot.chat(`Alright ${playerName}, I'll follow you.`);
        this.state = BotState.FOLLOWING;
        followPlayer(this.bot, playerName, 120000).finally(() => {
          if (this.state === BotState.FOLLOWING) this.state = BotState.IDLE;
        });
        break;

      case 'stay':
        this.bot.chat(`I'll stay right here.`);
        if (this.bot.pathfinder.isMoving()) {
          this.bot.pathfinder.setGoal(null);
        }
        this.state = BotState.IDLE;
        break;
    }
  }

  private async handleChat(playerName: string, message: string): Promise<void> {
    if (!this.bot || !this.llmClient) return;

    try {
      logger.info({ bot: this.name, player: playerName, message }, 'Chat received');

      // Update sentiment and affinity
      const sentiment = analyzeSentiment(message);
      if (sentiment === 'POSITIVE') {
        this.affinityManager.onPositiveChat(this.name, playerName);
      } else if (sentiment === 'NEGATIVE') {
        this.affinityManager.onNegativeSentiment(this.name, playerName);
      }

      const affinity = this.affinityManager.get(this.name, playerName);
      const isCodegen = this.mode === BotMode.CODEGEN;
      const systemPrompt = buildSystemPrompt(this.name, this.personality, affinity, isCodegen);

      // Build conversation history (current message appended by buildContentsArray)
      const contents = this.conversationManager.buildContentsArray(this.name, playerName, message);

      const response = await this.llmClient.chat(systemPrompt, contents, this.config.llm.chatMaxTokens);

      // Check if LLM decided not to respond
      if (response.text.trim() === '[NO_RESPONSE]' || response.text.trim().startsWith('[NO_RESPONSE]')) {
        logger.info({ bot: this.name, player: playerName }, 'LLM chose not to respond (not addressed)');
        // Still store the player message for context in future conversations
        this.conversationManager.addPlayerMessage(this.name, playerName, message);
        return;
      }

      // Extract [TASK: ...] tag if present (codegen mode)
      const { cleanText, taskDescription } = extractTask(response.text);
      const safeText = this.sanitizeOutput(cleanText);

      // Store both messages in history for future context
      this.conversationManager.addPlayerMessage(this.name, playerName, message);
      this.conversationManager.addBotResponse(this.name, playerName, safeText);
      this.bot.chat(safeText);

      logger.info(
        { bot: this.name, player: playerName, response: safeText, tokens: response.inputTokens },
        'Chat response sent'
      );

      // Queue task in Voyager loop if extracted
      if (taskDescription && this.voyagerLoop) {
        logger.info({ bot: this.name, player: playerName, task: taskDescription }, 'Task extracted from chat');
        this.voyagerLoop.queuePlayerTask(taskDescription, playerName);
      }
    } catch (err: any) {
      logger.error({ bot: this.name, player: playerName, err: err.message }, 'Chat response failed');
      // Stay silent on errors — don't spam fallback messages
    }
  }

  private scheduleAmbientChat(): void {
    if (!this.llmClient) return;

    // Ambient chat is rare — 10 to 20 minutes between attempts
    const minMs = 600_000;  // 10 minutes
    const maxMs = 1_200_000; // 20 minutes
    const delay = minMs + Math.random() * (maxMs - minMs);

    this.ambientChatTimeout = setTimeout(async () => {
      if (!this.bot || this.destroyed) return;

      // 30% chance to actually say something even when timer fires
      if (Math.random() > 0.3) {
        this.scheduleAmbientChat();
        return;
      }

      // Find nearest player within conversation radius
      const players = Object.values(this.bot.players).filter(
        (p) => p.entity && p.username !== this.bot!.username
      );

      let nearestPlayer: string | null = null;
      let nearestDist = Infinity;
      const botPos = this.bot.entity.position;

      for (const p of players) {
        if (!p.entity) continue;
        const dist = p.entity.position.distanceTo(botPos);
        if (dist < this.config.behavior.conversationRadius && dist < nearestDist) {
          nearestPlayer = p.username;
          nearestDist = dist;
        }
      }

      if (nearestPlayer && this.llmClient) {
        try {
          const timeOfDay = this.bot.time.timeOfDay < 12000 ? 'day' : 'night';
          const isRaining = this.bot.isRaining;
          const player = this.bot.players[nearestPlayer];
          const heldItem = player?.entity?.heldItem?.name || '';

          const prompt = buildAmbientContext(this.name, nearestPlayer, timeOfDay, isRaining, heldItem);
          const systemPrompt = buildSystemPrompt(
            this.name,
            this.personality,
            this.affinityManager.get(this.name, nearestPlayer)
          );

          const response = await this.llmClient.generate(systemPrompt, prompt, 60);
          this.bot.chat(response.text);

          logger.info({ bot: this.name, nearPlayer: nearestPlayer }, 'Ambient chat');
        } catch (err: any) {
          logger.error({ bot: this.name, err: err.message }, 'Ambient chat failed');
        }
      }

      // Schedule next ambient chat
      this.scheduleAmbientChat();
    }, delay);
  }

  private startVoyagerIfCodegen(): void {
    if (this.mode !== BotMode.CODEGEN || !this.bot || !this.config.voyager.enabled) return;

    this.voyagerLoop = new VoyagerLoop(
      this.bot,
      this.name,
      this.personality,
      this.config,
      this.llmClient
    );
    this.voyagerLoop.start();
  }

  private stopAmbientBehaviors(): void {
    if (this.headTrackingInterval) {
      clearInterval(this.headTrackingInterval);
      this.headTrackingInterval = null;
    }
    if (this.wanderInterval) {
      clearInterval(this.wanderInterval);
      this.wanderInterval = null;
    }
    if (this.ambientChatTimeout) {
      clearTimeout(this.ambientChatTimeout);
      this.ambientChatTimeout = null;
    }
    if (this.voyagerLoop) {
      this.voyagerLoop.stop();
      this.voyagerLoop = null;
    }
  }

  private sanitizeOutput(text: string): string {
    // Strip anything that looks like an API key (AIza..., sk-..., etc.)
    return text.replace(/AIza[A-Za-z0-9_-]{30,}/g, '[REDACTED]')
      .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED]')
      .replace(/key[=:\s]+[A-Za-z0-9_-]{20,}/gi, '[REDACTED]');
  }

  setMode(newMode: BotMode): void {
    this.mode = newMode;
    if (newMode === BotMode.CODEGEN) {
      if (!this.voyagerLoop) this.startVoyagerIfCodegen();
    } else {
      if (this.voyagerLoop) {
        this.voyagerLoop.stop();
        this.voyagerLoop = null;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.destroyed = true;
    this.stopAmbientBehaviors();

    if (this.bot) {
      this.bot.quit();
      this.bot = null;
    }

    this.state = BotState.DISCONNECTED;
    logger.info({ bot: this.name }, 'Bot disconnected and destroyed');
  }

  getStatus() {
    return {
      name: this.name,
      personality: this.personality,
      mode: this.mode,
      state: this.state,
      position: this.bot?.entity?.position
        ? {
            x: Math.round(this.bot.entity.position.x),
            y: Math.round(this.bot.entity.position.y),
            z: Math.round(this.bot.entity.position.z),
          }
        : null,
    };
  }
}
