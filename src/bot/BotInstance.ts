import path from 'path';
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
import { GoalGenerator } from '../voyager/GoalGenerator';
import { ThreatAssessor } from '../voyager/ThreatAssessor';
import { OpportunityDetector } from '../voyager/OpportunityDetector';
import { DecisionNarrator } from '../voyager/DecisionNarrator';
import { ProactiveCommunicator } from '../voyager/ProactiveCommunicator';
import { ActionTemplateRegistry } from '../voyager/ActionTemplates';
import { PlanLibrary } from '../voyager/PlanLibrary';
import { SkillAttribution } from '../voyager/SkillAttribution';
import { TradeNegotiator } from '../voyager/TradeNegotiator';
import { analyzeSentiment, parseCommand, extractTask } from '../ai/prompts/chat';
import { followPlayer } from '../actions/followPlayer';
import { buildSchematic, listSchematics } from '../actions/buildSchematic';
import { VoyagerLoop } from '../voyager/VoyagerLoop';
import { StatsTracker } from '../voyager/StatsTracker';
import { renderObservation } from '../voyager/Observation';
import { PERSONALITIES } from '../personality/PersonalityType';
import { BlackboardManager } from '../voyager/BlackboardManager';
import { SharedWorldModel } from '../voyager/SharedWorldModel';
import { SocialMemory } from '../social/SocialMemory';
import { BotComms } from '../social/BotComms';

export interface BotOptions {
  name: string;
  personality: string;
  mode: BotMode;
  spawnLocation?: { x: number; y: number; z: number };
  config: Config;
  llmClient: LLMClient | null;
  affinityManager: AffinityManager;
  conversationManager: ConversationManager;
  blackboardManager: BlackboardManager;
  sharedWorldModel?: SharedWorldModel;
  onSwarmDirective?: (description: string, requestedBy: string) => Promise<void> | void;
  onReputationEvent?: (event: any) => void;
  onVoyagerLoopCreated?: (loop: VoyagerLoop) => void;
  onDeath?: (event: { botName: string; position: { x: number; y: number; z: number } | null }) => void;
}

export class BotInstance {
  private static OWNER_PLAYER = 'Nerdfuryz';
  private static nextAvailableConnectAt = 0;
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
  private pendingConnectTimeout: NodeJS.Timeout | null = null;
  private llmClient: LLMClient | null;
  private affinityManager: AffinityManager;
  private conversationManager: ConversationManager;
  private blackboardManager: BlackboardManager;
  private sharedWorldModel: SharedWorldModel | null;
  private onSwarmDirective?: (description: string, requestedBy: string) => Promise<void> | void;
  private onReputationEvent?: (event: any) => void;
  private onVoyagerLoopCreated?: (loop: VoyagerLoop) => void;
  private onDeath?: (event: { botName: string; position: { x: number; y: number; z: number } | null }) => void;
  private chatCooldowns: Map<string, number> = new Map();
  private socialMemory: SocialMemory;
  private botComms: BotComms;
  private voyagerLoop: VoyagerLoop | null = null;
  private instinctInterval: NodeJS.Timeout | null = null;
  private survivalInterval: NodeJS.Timeout | null = null;
  private instinctResumeTimeout: NodeJS.Timeout | null = null;
  private instinctActive = false;
  private instinctReason: 'attack' | 'hazard' | null = null;
  private voyagerPausedByInstinct = false;
  private lastAttackedAt = 0;
  private lastHealth = 20;
  /** Cached world observation. The 512-block scan in renderObservation is expensive,
   *  so we reuse it across rapid getDetailedStatus polls and refresh at most every 10s. */
  private cachedWorld: { at: number; world: any } | null = null;
  private lastAttackerName: string | null = null;
  private statsTracker = new StatsTracker('./data');
  private static CHAT_COOLDOWN_MS = 3000;
  private lastPathResetLog: { reason: string; at: number; suppressed: number } | null = null;

  // ── Overnight-survival state ──
  /** Last time we evaluated the "am I hungry?" branch. Gated to ~10s. */
  private lastFoodCheckAt = 0;
  /** True while a bot.consume() promise is in flight. */
  private isEating = false;
  /** Last time we tried to place a torch. Gated to ~30s. */
  private lastTorchPlaceAt = 0;
  /** True while a torch placement promise is in flight. */
  private isPlacingTorch = false;

  constructor(options: BotOptions) {
    this.name = options.name;
    this.personality = options.personality;
    this.mode = options.mode;
    this.spawnLocation = options.spawnLocation;
    this.config = options.config;
    this.llmClient = options.llmClient;
    this.affinityManager = options.affinityManager;
    this.conversationManager = options.conversationManager;
    this.blackboardManager = options.blackboardManager;
    this.sharedWorldModel = options.sharedWorldModel ?? null;
    this.onSwarmDirective = options.onSwarmDirective;
    this.onReputationEvent = options.onReputationEvent;
    this.onVoyagerLoopCreated = options.onVoyagerLoopCreated;
    this.onDeath = options.onDeath;
    this.socialMemory = new SocialMemory(path.join(process.cwd(), 'data'));
    this.botComms = BotComms.getInstance();
    this.botComms.registerBot(this.name);
  }

  async connect(skipQueue = false): Promise<void> {
    if (this.destroyed) return;

    if (!skipQueue && this.pendingConnectTimeout) {
      logger.debug({ bot: this.name }, 'Connect already scheduled, skipping duplicate request');
      return;
    }

    const delay = skipQueue ? 0 : this.reserveConnectSlot();
    if (!skipQueue && delay > 0) {
      this.state = BotState.SPAWNING;
      logger.info({ bot: this.name, delay }, 'Queued bot connection to stagger join');
      this.pendingConnectTimeout = setTimeout(() => {
        this.pendingConnectTimeout = null;
        void this.connect(true);
      }, delay);
      return;
    }

    this.state = BotState.SPAWNING;
    logger.info({ bot: this.name }, 'Connecting to Minecraft server...');

    // Reconnect path: tear down the previous bot object explicitly so its
    // listeners don't keep references to closures from the previous lifecycle.
    if (this.bot) {
      try { this.bot.removeAllListeners(); } catch {}
      try { this.bot.end(); } catch {}
      this.bot = null;
    }
    // The chat listener guard is per-bot-object — reset so the new bot
    // actually gets a chat listener on spawn.
    this.chatListenerBound = false;

    this.bot = mineflayer.createBot({
      host: this.config.minecraft.host,
      port: this.config.minecraft.port,
      username: this.name,
      version: this.config.minecraft.version,
      auth: this.config.minecraft.auth as any,
      hideErrors: true,
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
      this.lastHealth = this.bot?.health ?? 20;

      if (this.bot) {
        this.bot.physicsEnabled = true;

        // Set up pathfinder movements
        const mcData = require('minecraft-data')(this.bot.version);
        const movements = new Movements(this.bot);
        movements.canDig = true; // Allow digging to escape holes (matches original Voyager)
        this.bot.pathfinder.setMovements(movements);
        logger.info({ bot: this.name, canDig: movements.canDig }, 'Pathfinder movements configured');

        // Auto-dismount to prevent physicsTick from stopping (matches original Voyager)
        // Use once + re-register pattern to avoid accumulating listeners on respawn
        const onMount = () => {
          this.bot?.dismount();
          this.bot?.once('mount', onMount);
        };
        this.bot.once('mount', onMount);
      }

      // Auth with DyoAuth, then select class, before doing anything else
      this.handleAuth(() => {
        this.handleClassSelection(() => {
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
          this.startVoyagerIfCodegen();
          this.startSurvivalLoop();
        });
      });
    });

    this.bot.on('error', (err) => {
      logger.error({ bot: this.name, err: err.message }, 'Bot error');
    });

    this.bot.on('death', () => {
      const deathPos = this.bot?.entity?.position ? {
        x: Number(this.bot.entity.position.x.toFixed(1)),
        y: Number(this.bot.entity.position.y.toFixed(1)),
        z: Number(this.bot.entity.position.z.toFixed(1)),
      } : null;
      logger.warn({
        bot: this.name,
        state: this.state,
        position: deathPos,
        pathfinderMoving: this.bot?.pathfinder?.isMoving?.() ?? false,
      }, 'Bot died');
      if (this.bot?.pathfinder?.isMoving()) {
        this.bot.pathfinder.stop();
        logger.warn({ bot: this.name }, 'Stopped pathfinder after death');
      }
      this.statsTracker.trackDeath(this.name);
      this.stopInstinct('death');
      // Reset per-life survival guards so they don't leak across a respawn.
      this.isEating = false;
      this.isPlacingTorch = false;
      // Notify the dashboard / other layers. Layer-1 recovery handles reassignment;
      // this is just so the UI can surface the death in real time.
      if (this.onDeath) {
        try {
          this.onDeath({ botName: this.name, position: deathPos });
        } catch (err: any) {
          logger.warn({ bot: this.name, err: err?.message }, 'onDeath callback failed');
        }
      }
    });

    this.bot.on('health', () => {
      const health = this.bot?.health ?? 20;
      logger.info({
        bot: this.name,
        health,
        food: this.bot?.food,
      }, 'Bot health updated');
      if (this.bot && health < this.lastHealth) {
        this.statsTracker.trackDamage(this.name, this.lastHealth - health);
        if (this.isDrowning()) {
          this.triggerHazardInstinct('drowning-damage');
        }
        this.triggerAttackInstinct(this.findLikelyThreat(), 'health-drop');
      }
      this.lastHealth = health;
    });

    this.bot.on('entityHurt', (entity: any, source: any) => {
      if (!this.bot || !entity || entity.id !== this.bot.entity.id) return;

      // Track player hits for affinity and social memory
      if (source?.type === 'player' && source.username) {
        this.affinityManager.onHit(this.name, source.username);
        this.socialMemory.addMemory(this.name, 'combat', source.username, `${source.username} attacked me`, -0.5);
        this.socialMemory.updateEmotionalState(this.name, 'combat_loss');
      }

      this.triggerAttackInstinct(source || this.findLikelyThreat(), 'entity-hurt');
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
      logger.debug({
        bot: this.name,
        status: result?.status || 'unknown',
        nodes: Array.isArray(result?.path) ? result.path.length : 0,
      }, 'Pathfinder updated');
    });

    this.bot.on('path_reset', (reason: any) => {
      const normalizedReason = String(reason || 'unknown');
      const now = Date.now();
      if (this.lastPathResetLog && this.lastPathResetLog.reason === normalizedReason && now - this.lastPathResetLog.at < 5000) {
        this.lastPathResetLog.suppressed += 1;
        return;
      }

      if (this.lastPathResetLog?.suppressed) {
        logger.warn({
          bot: this.name,
          reason: this.lastPathResetLog.reason,
          suppressed: this.lastPathResetLog.suppressed,
        }, 'Suppressed repeated pathfinder resets');
      }

      this.lastPathResetLog = { reason: normalizedReason, at: now, suppressed: 0 };
      logger.warn({ bot: this.name, reason: normalizedReason }, 'Pathfinder reset');
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

    // Proactively try login after 1s, then register after 3s (in case message events were missed)
    setTimeout(() => {
      if (!authDone && bot) {
        logger.info({ bot: this.name }, 'Proactively trying /login');
        bot.chat(`/login ${BotInstance.BOT_PASSWORD}`);
      }
    }, 1000);

    setTimeout(() => {
      if (!authDone && bot) {
        logger.info({ bot: this.name }, 'Proactively trying /register');
        bot.chat(`/register ${BotInstance.BOT_PASSWORD} ${BotInstance.BOT_PASSWORD}`);
      }
    }, 3000);

    // Timeout fallback
    setTimeout(() => {
      if (!authDone) {
        logger.warn({ bot: this.name }, 'Auth timeout, proceeding anyway');
        finish();
      }
    }, 15000);
  }

  // Maps personality to the class hotbar slot (DyoClasses puts icons in slots 2-5)
  private static PERSONALITY_CLASS_MAP: Record<string, { slot: number; className: string }> = {
    guard:      { slot: 2, className: 'Warrior' },
    blacksmith: { slot: 2, className: 'Warrior' },
    elder:      { slot: 3, className: 'Mage' },
    merchant:   { slot: 3, className: 'Mage' },
    explorer:   { slot: 4, className: 'Archer' },
    farmer:     { slot: 5, className: 'Tank' },
    builder:    { slot: 5, className: 'Tank' },
  };

  private handleClassSelection(onReady: () => void): void {
    if (!this.bot) { onReady(); return; }

    const bot = this.bot;
    const mapping = BotInstance.PERSONALITY_CLASS_MAP[this.personality.toLowerCase()];
    if (!mapping) {
      logger.warn({ bot: this.name, personality: this.personality }, 'No class mapping for personality, skipping class selection');
      onReady();
      return;
    }

    let classDone = false;

    const finish = () => {
      if (classDone) return;
      classDone = true;
      bot.removeListener('message', onClassMessage);
      onReady();
    };

    const onClassMessage = (jsonMsg: any) => {
      if (classDone) return;
      const msg = jsonMsg.toString();

      if (msg.includes('You are now a')) {
        logger.info({ bot: this.name, class: mapping.className }, 'Class selected successfully');
        finish();
      }
    };

    bot.on('message', onClassMessage);

    // Wait 2 seconds for DyoClasses to give us the selection items (it delays 5 ticks after join)
    setTimeout(() => {
      if (classDone || !this.bot) return;

      // Check if we have class selection items in hotbar (iron_sword in slot 2 = class selection active)
      const checkItem = bot.inventory.slots[mapping.slot + 36]; // hotbar slots are 36-44
      if (!checkItem) {
        // No class selection items — we probably already have a class
        logger.info({ bot: this.name }, 'No class selection items found, already has a class');
        finish();
        return;
      }

      logger.info({ bot: this.name, personality: this.personality, class: mapping.className, slot: mapping.slot, item: checkItem.name }, 'Selecting class');
      bot.setQuickBarSlot(mapping.slot);

      // Small delay then activate the item to trigger PlayerInteractEvent
      setTimeout(() => {
        if (classDone || !this.bot) return;
        bot.activateItem();
      }, 500);
    }, 2000);

    // Timeout fallback — don't block forever
    setTimeout(() => {
      if (!classDone) {
        logger.warn({ bot: this.name }, 'Class selection timeout, proceeding anyway');
        finish();
      }
    }, 10000);
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.pendingConnectTimeout) {
      logger.debug({ bot: this.name }, 'Reconnect already queued, skipping duplicate schedule');
      return;
    }
    if (this.reconnectAttempts >= this.config.bots.maxReconnectAttempts) {
      logger.error({ bot: this.name }, 'Max reconnect attempts reached');
      return;
    }

    const baseDelay = Math.min(
      this.config.bots.reconnectDelaySec * Math.pow(2, this.reconnectAttempts) * 1000,
      30000
    );
    const jitter = baseDelay * (Math.random() * 0.5 - 0.25);
    const delay = Math.max(0, Math.round(baseDelay + jitter));
    this.reconnectAttempts++;

    logger.info({ bot: this.name, delay, attempt: this.reconnectAttempts }, 'Scheduling reconnect');
    this.pendingConnectTimeout = setTimeout(() => {
      this.pendingConnectTimeout = null;
      void this.connect();
    }, delay);
  }

  private reserveConnectSlot(): number {
    const now = Date.now();
    const staggerMs = Math.max(0, this.config.bots.joinStaggerMs || 0);
    const scheduledAt = Math.max(now, BotInstance.nextAvailableConnectAt);
    BotInstance.nextAvailableConnectAt = scheduledAt + staggerMs;
    return Math.max(0, scheduledAt - now);
  }

  startHeadTracking(): void {
    if (this.headTrackingInterval) return;

    const fastMs = this.config.behavior.headTrackingTickMs;
    // Idle cadence: poll at most 1Hz when no players are in range. We still
    // need to detect when a player walks up, but 4Hz forever is wasteful.
    const idleMs = Math.max(fastMs * 4, 1000);

    const tick = () => {
      let nextDelay = fastMs;
      try {
        if (!this.bot || this.state === BotState.DISCONNECTED) {
          nextDelay = idleMs;
          return;
        }
        if (this.mode === BotMode.CODEGEN && this.voyagerLoop?.getCurrentTask()) {
          nextDelay = idleMs;
          return;
        }
        if (this.state === BotState.EXECUTING_TASK) {
          nextDelay = idleMs;
          return;
        }

        const players = Object.values(this.bot.players).filter(
          (p) => p.entity && p.username !== this.bot!.username
        );

        if (players.length === 0) {
          nextDelay = idleMs;
          return;
        }

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
          nextDelay = fastMs;
        } else {
          nextDelay = idleMs;
        }
      } finally {
        if (this.headTrackingInterval !== null && !this.destroyed) {
          this.headTrackingInterval = setTimeout(tick, nextDelay);
        }
      }
    };

    // Mark as started; tick() reassigns the timer each iteration.
    this.headTrackingInterval = setTimeout(tick, fastMs);
  }

  startWandering(): void {
    if (this.wanderInterval) return;

    const baseMs = this.config.behavior.wanderIntervalMs;
    // ±20% jitter so multi-bot fleets don't tick in lockstep.
    const nextDelay = () => Math.round(baseMs * (0.8 + Math.random() * 0.4));

    const tick = () => {
      try {
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

        setTimeout(() => {
          if (this.state === BotState.WANDERING && this.bot) {
            this.bot.pathfinder.setGoal(null);
            this.state = BotState.IDLE;
          }
        }, 15000);
      } finally {
        if (this.wanderInterval !== null && !this.destroyed) {
          this.wanderInterval = setTimeout(tick, nextDelay());
        }
      }
    };

    this.wanderInterval = setTimeout(tick, nextDelay());
  }

  private chatListenerBound = false;

  private startChatListener(): void {
    if (!this.bot || this.chatListenerBound) return;
    this.chatListenerBound = true;

    this.bot.on('chat', async (username: string, message: string) => {
      // Ignore own messages and empty messages
      if (!this.bot || username === this.bot.username || !message.trim()) return;

      // Check if player is within conversation radius
      const player = this.bot.players[username];
      if (!player?.entity) return;
      if (username.toLowerCase() !== BotInstance.OWNER_PLAYER.toLowerCase()) return;

      const swarmMatch = message.match(/^swarm:\s*(.+)$/i);
      if (swarmMatch && this.onSwarmDirective) {
        const directive = swarmMatch[1].trim();
        logger.info({ bot: this.name, player: username, directive }, 'Swarm directive received');
        await this.onSwarmDirective(directive, username);
        this.sendLongChat(`Understood. The swarm will work on: ${directive}`);
        return;
      }

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

      if (!this.isDirectlyAddressed(message)) {
        logger.info({ bot: this.name, player: username, message }, 'Ignoring non-direct owner chat');
        return;
      }

      // Generate AI chat response
      await this.handleChat(username, message);
    });
  }

  private isDirectlyAddressed(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes(this.name.toLowerCase());
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
        if (this.voyagerLoop) this.voyagerLoop.pause();
        followPlayer(this.bot, playerName, 600000).finally(() => {
          if (this.state === BotState.FOLLOWING) this.state = BotState.IDLE;
          if (this.voyagerLoop) this.voyagerLoop.resume();
        });
        break;

      case 'stay':
        this.bot.chat(`I'll stay right here.`);
        if (this.bot.pathfinder.isMoving()) {
          this.bot.pathfinder.setGoal(null);
        }
        this.state = BotState.IDLE;
        break;

      case 'list-schematics': {
        const files = listSchematics();
        if (files.length === 0) {
          this.bot.chat('No schematics found. Drop .schem or .schematic files in the schematics/ folder.');
        } else {
          this.bot.chat(`Available schematics: ${files.join(', ')}`);
        }
        break;
      }

      case 'build-schematic': {
        const files = listSchematics();
        const match = files.find((f) => f.toLowerCase() === command.args.toLowerCase());
        if (!match) {
          this.bot.chat(`Schematic "${command.args}" not found. Say "list schematics" to see available files.`);
          break;
        }
        this.bot.chat(`Starting build from ${match}. This may take a while...`);
        this.state = BotState.EXECUTING_TASK;
        if (this.voyagerLoop) this.voyagerLoop.pause();
        const origin = this.bot.entity.position.floored();
        buildSchematic(this.bot, match, { x: origin.x, y: origin.y, z: origin.z }, (placed, total) => {
          this.bot?.chat(`Building... ${placed}/${total} blocks`);
        }).then((result) => {
          if (this.bot) this.bot.chat(result.message ?? 'Build complete.');
          this.state = BotState.IDLE;
          if (this.voyagerLoop) this.voyagerLoop.resume();
        }).catch((err) => {
          this.bot?.chat(`Build failed: ${err.message}`);
          this.state = BotState.IDLE;
          if (this.voyagerLoop) this.voyagerLoop.resume();
        });
        break;
      }
    }
  }

  private async handleChat(playerName: string, message: string): Promise<void> {
    if (!this.bot || !this.llmClient) return;

    try {
      logger.info({ bot: this.name, player: playerName, message }, 'Chat received');

      // Update sentiment, affinity, and social memory
      const sentiment = analyzeSentiment(message);
      if (sentiment === 'POSITIVE') {
        this.affinityManager.onPositiveChat(this.name, playerName);
        this.socialMemory.updateEmotionalState(this.name, 'positive_chat');
      } else if (sentiment === 'NEGATIVE') {
        this.affinityManager.onNegativeSentiment(this.name, playerName);
        this.socialMemory.updateEmotionalState(this.name, 'negative_chat');
      }

      // Record chat interaction in social memory
      this.socialMemory.addMemory(
        this.name,
        'chat',
        playerName,
        `${playerName} said: "${message.slice(0, 100)}"`,
        sentiment === 'POSITIVE' ? 0.3 : sentiment === 'NEGATIVE' ? -0.3 : 0
      );

      const affinity = await this.affinityManager.get(this.name, playerName);
      const isCodegen = this.mode === BotMode.CODEGEN;
      const internalState = this.voyagerLoop?.getInternalState();

      // Build social context from memory for LLM prompt
      const socialContext = this.socialMemory.buildMemoryContext(this.name, playerName);
      const systemPrompt = buildSystemPrompt(this.name, this.personality, affinity, isCodegen, internalState, socialContext);

      // Build conversation history (current message appended by buildContentsArray)
      const contents = await this.conversationManager.buildContentsArray(this.name, playerName, message);

      const response = await this.llmClient.chat(systemPrompt, contents, this.config.llm.chatMaxTokens, { taskType: 'chat', botName: this.name });

      // Check if LLM decided not to respond (empty/blank response = silence)
      const trimmed = response.text.trim();
      if (!trimmed || trimmed.toLowerCase().includes('[no_response]') || trimmed.toLowerCase() === 'no_response') {
        logger.info({ bot: this.name, player: playerName }, 'LLM chose not to respond');
        // Store both messages to maintain alternating user/model roles in history
        this.conversationManager.addPlayerMessage(this.name, playerName, message);
        this.conversationManager.addBotResponse(this.name, playerName, '...');
        return;
      }

      // Extract >>>TASK: tag if present (codegen mode)
      const { cleanText, taskDescription, goalDescription } = extractTask(response.text);
      // Collapse newlines (Minecraft truncates at first \n) and cap length
      const flatText = this.sanitizeOutput(cleanText).replace(/\n+/g, ' ').trim().slice(0, 200);

      // Don't send if empty after sanitization
      if (!flatText) {
        logger.warn({ bot: this.name, player: playerName, raw: response.text }, 'Suppressed empty response');
        this.conversationManager.addPlayerMessage(this.name, playerName, message);
        this.conversationManager.addBotResponse(this.name, playerName, '...');
        return;
      }

      // Store both messages in history for future context
      this.conversationManager.addPlayerMessage(this.name, playerName, message);
      this.conversationManager.addBotResponse(this.name, playerName, flatText);
      this.sendLongChat(flatText);

      logger.info(
        { bot: this.name, player: playerName, response: flatText, tokens: response.inputTokens },
        'Chat response sent'
      );

      // Queue task in Voyager loop if extracted (check hostility first)
      if ((goalDescription || taskDescription) && this.voyagerLoop) {
        if (this.affinityManager.isHostile(this.name, playerName)) {
          logger.warn({ bot: this.name, player: playerName }, 'Refusing task from hostile player');
          this.sendLongChat(`I don't feel like helping you right now.`);
        } else if (goalDescription) {
          logger.info({ bot: this.name, player: playerName, goal: goalDescription }, 'Long-term goal extracted from chat');
          this.voyagerLoop.queueLongTermGoal(goalDescription, playerName);
        } else if (taskDescription) {
          logger.info({ bot: this.name, player: playerName, task: taskDescription }, 'Task extracted from chat');
          this.voyagerLoop.queuePlayerTask(taskDescription, playerName);
        }
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
          const ambientText = response.text.replace(/\n+/g, ' ').trim().slice(0, 200);
          this.bot.chat(ambientText);

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
    this.voyagerLoop.setBlackboardManager(this.blackboardManager);
    if (this.sharedWorldModel) {
      this.voyagerLoop.setSharedWorldModel(this.sharedWorldModel);
    }
    this.voyagerLoop.setSocialMemory(this.socialMemory);
    this.voyagerLoop.setBotComms(this.botComms);

    // Wire per-bot intelligence systems
    this.voyagerLoop.setGoalGenerator(new GoalGenerator(this.personality));
    this.voyagerLoop.setThreatAssessor(new ThreatAssessor());
    this.voyagerLoop.setOpportunityDetector(new OpportunityDetector());
    this.voyagerLoop.setDecisionNarrator(new DecisionNarrator());
    this.voyagerLoop.setProactiveCommunicator(new ProactiveCommunicator(this.name, this.personality));
    this.voyagerLoop.setActionTemplates(new ActionTemplateRegistry());
    this.voyagerLoop.setPlanLibrary(new PlanLibrary('./data'));
    this.voyagerLoop.setSkillAttribution(new SkillAttribution('./data'));
    this.voyagerLoop.setTradeNegotiator(new TradeNegotiator(this.personality));
    if (this.onReputationEvent) {
      this.voyagerLoop.setReputationNotifier(this.onReputationEvent);
    }
    if (this.onVoyagerLoopCreated) {
      try {
        this.onVoyagerLoopCreated(this.voyagerLoop);
      } catch (err) {
        logger.warn({ err: (err as any)?.message, bot: this.name }, 'onVoyagerLoopCreated callback failed');
      }
    }

    this.voyagerLoop.start();
  }

  private triggerAttackInstinct(source: any, trigger: string): void {
    if (!this.bot || !this.config.instincts.enabled || this.destroyed) return;
    if (this.isDrowning()) {
      this.triggerHazardInstinct('drowning-preempts-attack');
      return;
    }

    this.lastAttackedAt = Date.now();
    this.lastAttackerName = source?.username || source?.name || null;

    if (!this.instinctActive) {
      this.activateInstinct('attack', trigger);
      logger.warn({ bot: this.name, trigger, attacker: this.lastAttackerName, health: this.bot.health }, 'Attack instinct triggered');
      this.startInstinctLoop();
    }

    if (this.instinctResumeTimeout) {
      clearTimeout(this.instinctResumeTimeout);
    }
    this.instinctResumeTimeout = setTimeout(() => this.stopInstinct('attack-cooldown-expired'), this.config.instincts.attackCooldownMs);
  }

  private triggerHazardInstinct(trigger: string): void {
    if (!this.bot || !this.config.instincts.enabled || this.destroyed) return;

    if (!this.instinctActive || this.instinctReason !== 'hazard') {
      this.activateInstinct('hazard', trigger);
      logger.warn({
        bot: this.name,
        trigger,
        oxygen: (this.bot.entity as any).oxygenLevel ?? 300,
        position: {
          x: Number(this.bot.entity.position.x.toFixed(1)),
          y: Number(this.bot.entity.position.y.toFixed(1)),
          z: Number(this.bot.entity.position.z.toFixed(1)),
        },
      }, 'Hazard instinct triggered');
      this.startInstinctLoop();
    }
  }

  private activateInstinct(reason: 'attack' | 'hazard', trigger: string): void {
    if (!this.bot) return;

    this.instinctActive = true;
    this.instinctReason = reason;
    this.state = BotState.INSTINCT;
    if (this.instinctResumeTimeout) {
      clearTimeout(this.instinctResumeTimeout);
      this.instinctResumeTimeout = null;
    }
    if (this.bot.pathfinder.isMoving()) {
      this.bot.pathfinder.stop();
    }
    this.clearMovementControls();
    if (this.voyagerLoop?.isRunning() && !this.voyagerLoop.isPaused()) {
      this.voyagerLoop.pause(`instinct:${trigger}`);
      this.voyagerPausedByInstinct = true;
    }
  }

  private startInstinctLoop(): void {
    if (this.instinctInterval || !this.bot) return;

    // ±20% jitter on the 1s tick so instinct loops across many bots don't sync.
    const nextDelay = () => Math.round(1000 * (0.8 + Math.random() * 0.4));

    const tick = () => {
      try {
        if (!this.bot || !this.instinctActive) return;
        if (this.bot.health <= 0) return;

        if (this.isDrowning()) {
          this.runSurfaceInstinct();
          return;
        }

        if (this.instinctReason === 'hazard') {
          this.stopInstinct('hazard-cleared');
          return;
        }

        const threat = this.findLikelyThreat();
        if (!threat) {
          logger.info({ bot: this.name }, 'Instinct active but no nearby threat found');
          return;
        }

        if (this.shouldFight(threat)) {
          this.runFightInstinct(threat);
        } else {
          this.runFleeInstinct(threat);
        }
      } finally {
        if (this.instinctInterval !== null && this.instinctActive && !this.destroyed) {
          this.instinctInterval = setTimeout(tick, nextDelay());
        }
      }
    };

    this.instinctInterval = setTimeout(tick, nextDelay());
  }

  /**
   * Overnight-survival tick. Runs independently of the instinct loop so bots
   * eat / place torches even when they're otherwise idle. Each sub-behavior is
   * fire-and-forget with its own guard flag so a slow mineflayer action can't
   * wedge the tick.
   */
  private startSurvivalLoop(): void {
    if (this.survivalInterval || !this.bot || this.destroyed) return;

    const BASE_MS = 2500;
    const nextDelay = () => Math.round(BASE_MS * (0.85 + Math.random() * 0.3));

    const tick = () => {
      try {
        if (!this.bot || this.destroyed) return;
        if (this.state === BotState.DISCONNECTED) return;
        if (this.bot.health <= 0) return;

        // B1 — eat when hungry
        this.maybeEatFood();
        // B2 — place torches at night when threatened
        this.maybePlaceTorchForNight();
      } finally {
        if (this.survivalInterval !== null && !this.destroyed) {
          this.survivalInterval = setTimeout(tick, nextDelay());
        }
      }
    };

    this.survivalInterval = setTimeout(tick, nextDelay());
  }

  /** Eat an edible inventory item when food <= 6 (3 hunger bar half-icons). */
  private maybeEatFood(): void {
    if (!this.bot || this.isEating) return;
    const now = Date.now();
    if (now - this.lastFoodCheckAt < 10_000) return;
    this.lastFoodCheckAt = now;

    if ((this.bot.food ?? 20) >= 7) return;

    let mcData: any;
    try {
      mcData = require('minecraft-data')(this.bot.version);
    } catch {
      return;
    }
    if (!mcData?.foods) return;

    const foods = mcData.foods as Record<number, { foodPoints?: number }>;
    const edible = this.bot.inventory.items().find((item) => {
      const entry = foods[item.type];
      return entry && (entry.foodPoints ?? 0) > 0;
    });
    if (!edible) return;

    this.isEating = true;
    logger.info({ bot: this.name, food: this.bot.food, item: edible.name }, 'Eating food');
    (async () => {
      try {
        await this.bot!.equip(edible, 'hand');
        await this.bot!.consume();
      } catch (err: any) {
        logger.debug({ bot: this.name, err: err?.message }, 'Eat attempt failed');
      } finally {
        this.isEating = false;
      }
    })().catch(() => {
      this.isEating = false;
    });
  }

  /**
   * Place a torch nearby if it's night, a hostile is within 16 blocks, and we
   * have torches in inventory. Gated to once per 30s.
   */
  private maybePlaceTorchForNight(): void {
    if (!this.bot || this.isPlacingTorch) return;
    const now = Date.now();
    if (now - this.lastTorchPlaceAt < 30_000) return;

    const tod = this.bot.time?.timeOfDay ?? 0;
    const isNight = tod > 13000 && tod < 23000;
    if (!isNight) return;

    // Threat check — use the existing helper, then widen the radius check to 16.
    const threat = this.findLikelyThreat();
    if (!threat?.position) return;
    if (threat.position.distanceTo(this.bot.entity.position) > 16) return;

    // Inventory check
    let mcData: any;
    try {
      mcData = require('minecraft-data')(this.bot.version);
    } catch {
      return;
    }
    const torchItemDef = mcData?.itemsByName?.torch;
    if (!torchItemDef) return;
    const torchItem = this.bot.inventory.items().find((item) => item.type === torchItemDef.id);
    if (!torchItem) return;

    // Find a placeable air block adjacent to a solid block within 5 blocks.
    const target = this.findTorchPlacementSpot();
    if (!target) return;

    this.lastTorchPlaceAt = now;
    this.isPlacingTorch = true;
    logger.info({
      bot: this.name,
      pos: {
        x: Number(target.reference.position.x.toFixed(1)),
        y: Number(target.reference.position.y.toFixed(1)),
        z: Number(target.reference.position.z.toFixed(1)),
      },
    }, 'Placing torch for night protection');
    (async () => {
      try {
        await this.bot!.equip(torchItem, 'hand');
        await this.bot!.placeBlock(target.reference, target.faceVector);
      } catch (err: any) {
        logger.debug({ bot: this.name, err: err?.message }, 'Torch placement failed');
      } finally {
        this.isPlacingTorch = false;
      }
    })().catch(() => {
      this.isPlacingTorch = false;
    });
  }

  /**
   * Scan a small box around the bot for a (solid, air-above) pair we can place
   * a torch against.
   */
  private findTorchPlacementSpot(): { reference: any; faceVector: any } | null {
    if (!this.bot) return null;
    const { Vec3 } = require('vec3');
    const origin = this.bot.entity.position.floored();
    const UP = new Vec3(0, 1, 0);

    // Spiral-ish search: small radius first.
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          const refPos = origin.offset(dx, dy, dz);
          const ref = this.bot.blockAt(refPos);
          if (!ref || ref.name === 'air' || ref.name === 'cave_air' || ref.name === 'water' || ref.name === 'lava') continue;
          // Skip blocks that aren't a reasonable torch substrate.
          if (ref.boundingBox !== 'block') continue;

          const abovePos = refPos.offset(0, 1, 0);
          const above = this.bot.blockAt(abovePos);
          if (!above || (above.name !== 'air' && above.name !== 'cave_air')) continue;

          // Within 5 blocks of the bot feet.
          if (abovePos.distanceTo(origin) > 5) continue;

          return { reference: ref, faceVector: UP };
        }
      }
    }
    return null;
  }

  private stopInstinct(reason: string): void {
    if (this.instinctResumeTimeout) {
      clearTimeout(this.instinctResumeTimeout);
      this.instinctResumeTimeout = null;
    }
    if (this.instinctInterval) {
      clearTimeout(this.instinctInterval);
      this.instinctInterval = null;
    }
    if (!this.instinctActive) return;

    this.instinctActive = false;
    this.instinctReason = null;
    this.lastAttackerName = null;
    this.clearMovementControls();
    if (this.state === BotState.INSTINCT) {
      this.state = BotState.IDLE;
    }
    if (!this.destroyed && this.state !== BotState.DISCONNECTED && this.voyagerPausedByInstinct && this.voyagerLoop) {
      this.voyagerLoop.resume(`instinct-ended:${reason}`);
    }
    this.voyagerPausedByInstinct = false;
    if (this.mode !== BotMode.CODEGEN) {
      this.startWandering();
    }
    logger.info({ bot: this.name, reason }, 'Instinct ended');
  }

  private findLikelyThreat(): any | null {
    if (!this.bot) return null;
    const hostileNames = new Set(['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'slime', 'pillager', 'drowned', 'husk']);
    return this.bot.nearestEntity((entity: any) => {
      if (!entity?.position || entity.id === this.bot?.entity?.id) return false;
      const dist = entity.position.distanceTo(this.bot!.entity.position);
      if (dist > 12) return false;
      if (entity.type === 'hostile') return true;
      if (hostileNames.has(entity.name)) return true;
      if (entity.type === 'player' && entity.username !== this.bot!.username) return true;
      return false;
    });
  }

  private shouldFight(threat: any): boolean {
    if (!this.bot) return false;
    const lowHealth = this.bot.health <= this.config.instincts.lowHealthThreshold;
    if (lowHealth) return false;
    if (threat?.type === 'hostile') {
      return ['guard', 'blacksmith', 'explorer'].includes(this.personality.toLowerCase()) || this.bot.health > 14;
    }
    return ['guard', 'blacksmith'].includes(this.personality.toLowerCase()) && this.bot.health > 12;
  }

  private runFightInstinct(threat: any): void {
    if (!this.bot || !threat?.position) return;
    this.state = BotState.HOSTILE;
    const { goals } = require('mineflayer-pathfinder');
    this.bot.pathfinder.setGoal(new goals.GoalFollow(threat, 2), true);
    const dist = this.bot.entity.position.distanceTo(threat.position);
    if (dist <= this.config.instincts.fightRange) {
      try {
        this.bot.attack(threat);
      } catch {
        // noop
      }
    }
    logger.warn({
      bot: this.name,
      instinct: 'fight',
      target: threat.username || threat.name || 'unknown',
      distance: Number(dist.toFixed(2)),
      health: this.bot.health,
    }, 'Instinct action');
  }

  private runFleeInstinct(threat: any): void {
    if (!this.bot || !threat?.position) return;
    this.clearMovementControls();
    this.state = BotState.INSTINCT;
    const current = this.bot.entity.position;
    const away = current.minus(threat.position);
    const dx = away.x === 0 && away.z === 0 ? (Math.random() > 0.5 ? 1 : -1) : away.x;
    const dz = away.x === 0 && away.z === 0 ? (Math.random() > 0.5 ? 1 : -1) : away.z;
    const mag = Math.sqrt(dx * dx + dz * dz) || 1;
    const flee = this.config.instincts.fleeDistance;
    const target = current.offset((dx / mag) * flee, 0, (dz / mag) * flee);
    const { goals } = require('mineflayer-pathfinder');
    this.bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 2));
    logger.warn({
      bot: this.name,
      instinct: 'flee',
      from: threat.username || threat.name || 'unknown',
      health: this.bot.health,
      target: { x: Number(target.x.toFixed(1)), y: Number(target.y.toFixed(1)), z: Number(target.z.toFixed(1)) },
    }, 'Instinct action');
  }

  private runSurfaceInstinct(): void {
    if (!this.bot) return;

    this.state = BotState.INSTINCT;
    if (this.bot.pathfinder.isMoving()) {
      this.bot.pathfinder.stop();
    }

    const oxygen = (this.bot.entity as any).oxygenLevel ?? 300;
    const pos = this.bot.entity.position;
    const currentBlock = this.bot.blockAt(pos);
    const yaw = this.bot.entity.yaw;
    void this.bot.look(yaw, -Math.PI / 2, true).catch(() => undefined);

    this.bot.setControlState('jump', true);
    this.bot.setControlState('forward', true);
    this.bot.setControlState('sprint', oxygen < this.config.instincts.drowningOxygenThreshold / 2);

    if (currentBlock?.name === 'water' || currentBlock?.name === 'bubble_column') {
      this.bot.setControlState('back', false);
      this.bot.setControlState('left', false);
      this.bot.setControlState('right', false);
    }

    logger.warn({
      bot: this.name,
      instinct: 'surface',
      oxygen,
      position: { x: Number(pos.x.toFixed(1)), y: Number(pos.y.toFixed(1)), z: Number(pos.z.toFixed(1)) },
    }, 'Instinct action');

    if (oxygen >= this.config.instincts.drowningSurfaceClearOxygen && !this.isUnderwater()) {
      this.stopInstinct('reached-air');
    }
  }

  private isDrowning(): boolean {
    if (!this.bot) return false;
    const oxygen = (this.bot.entity as any).oxygenLevel ?? 300;
    return oxygen <= this.config.instincts.drowningOxygenThreshold || (this.isUnderwater() && oxygen < 300);
  }

  private isUnderwater(): boolean {
    if (!this.bot) return false;
    const headHeight = (this.bot.entity as any).height || 1.62;
    const eyePos = this.bot.entity.position.offset(0, Math.max(1, headHeight - 0.2), 0);
    const headBlock = this.bot.blockAt(eyePos);
    return headBlock?.name === 'water' || headBlock?.name === 'bubble_column';
  }

  private clearMovementControls(): void {
    if (!this.bot) return;
    this.bot.clearControlStates();
  }

  private stopAmbientBehaviors(): void {
    this.stopInstinct('stop-ambient-behaviors');
    if (this.headTrackingInterval) {
      clearTimeout(this.headTrackingInterval);
      this.headTrackingInterval = null;
    }
    if (this.wanderInterval) {
      clearTimeout(this.wanderInterval);
      this.wanderInterval = null;
    }
    if (this.ambientChatTimeout) {
      clearTimeout(this.ambientChatTimeout);
      this.ambientChatTimeout = null;
    }
    if (this.survivalInterval) {
      clearTimeout(this.survivalInterval);
      this.survivalInterval = null;
    }
    if (this.voyagerLoop) {
      this.voyagerLoop.stop();
      this.voyagerLoop = null;
    }
  }

  private sendLongChat(text: string): void {
    if (!this.bot) return;
    // Mineflayer automatically splits messages at 256 chars.
    // Just send the text directly.
    this.bot.chat(text);
  }

  private sanitizeOutput(text: string): string {
    // Strip API keys
    let clean = text.replace(/AIza[A-Za-z0-9_-]{30,}/g, '[REDACTED]')
      .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED]')
      .replace(/key[=:\s]+[A-Za-z0-9_-]{20,}/gi, '[REDACTED]');
    // Strip any leaked [NO_RESPONSE] tags
    clean = clean.replace(/\[no_response\]/gi, '').trim();
    // Strip task tags that weren't caught by extractTask
    clean = clean.replace(/\[TASK:[^\]]*\]/gi, '').trim();
    clean = clean.replace(/>>>TASK:.*/gi, '').trim();
    return clean;
  }

  private isBreakingCharacter(text: string): boolean {
    const lower = text.toLowerCase();
    return lower.includes('system instruction') ||
      lower.includes('i am an ai') || lower.includes('i\'m an ai') ||
      lower.includes('language model') || lower.includes('as an ai') ||
      lower.includes('i am a bot') || lower.includes('i\'m a bot');
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
    this.botComms.unregisterBot(this.name);

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

  getDetailedStatus() {
    const basic = this.getStatus();

    if (!this.bot) {
      return {
        ...basic,
        personalityDisplayName: PERSONALITIES[this.personality]?.displayName ?? this.personality,
        health: 0,
        food: 0,
        equipment: null,
        inventory: [],
        world: null,
        voyager: null,
      };
    }

    // Inventory
    const inventory = this.bot.inventory.items().map((item) => ({
      name: item.name,
      count: item.count,
      slot: item.slot,
    }));

    // Equipment (held item)
    const heldItem = this.bot.heldItem;
    const equipment = heldItem ? { name: heldItem.name, count: heldItem.count } : null;

    // World context via Observation. renderObservation does a 512-block scan
    // that's too expensive to run on every 2s status push — cache 10s.
    const WORLD_TTL_MS = 10_000;
    let world: any = null;
    if (this.cachedWorld && Date.now() - this.cachedWorld.at < WORLD_TTL_MS) {
      world = this.cachedWorld.world;
      // Keep the volatile fields fresh (cheap to read).
      world = { ...world, isRaining: this.bot.isRaining };
    } else {
      try {
        const obs = renderObservation(this.bot);
        world = {
          biome: obs.biome,
          timeOfDay: obs.timeOfDay,
          isRaining: this.bot.isRaining,
          nearbyBlocks: obs.nearbyBlocks,
          nearbyEntities: obs.nearbyEntities,
        };
        this.cachedWorld = { at: Date.now(), world };
      } catch { /* bot may not be fully spawned */ }
    }

    // Voyager state
    let voyager = null;
    const effectiveState = this.voyagerLoop?.isRunning() && this.voyagerLoop.getCurrentTask()
      ? BotState.EXECUTING_TASK
      : this.state;
    if (this.voyagerLoop) {
      voyager = {
        isRunning: this.voyagerLoop.isRunning(),
        isPaused: this.voyagerLoop.isPaused(),
        currentTask: this.voyagerLoop.getCurrentTask(),
        queuedTasks: this.voyagerLoop.getQueuedTasks(),
        longTermGoal: this.voyagerLoop.getLongTermGoal(),
        completedTasks: this.voyagerLoop.getCompletedTasks(),
        failedTasks: this.voyagerLoop.getFailedTasks(),
      };
    }

    return {
      ...basic,
      state: effectiveState,
      personalityDisplayName: PERSONALITIES[this.personality]?.displayName ?? this.personality,
      health: this.bot.health,
      food: this.bot.food,
      equipment,
      inventory,
      world,
      voyager,
    };
  }

  getDiagnosticsSummary() {
    const lastExec = this.voyagerLoop?.getLastExecutionMetrics() ?? null;
    const failedTasks = this.voyagerLoop?.getFailedTasks() ?? [];

    return {
      name: this.name,
      personality: this.personality,
      mode: this.mode,
      state: this.state,
      connected: this.bot !== null && this.state !== BotState.DISCONNECTED,
      position: this.bot?.entity?.position
        ? {
            x: Math.round(this.bot.entity.position.x),
            y: Math.round(this.bot.entity.position.y),
            z: Math.round(this.bot.entity.position.z),
          }
        : null,
      health: this.bot?.health ?? 0,
      food: this.bot?.food ?? 0,
      instinctActive: this.instinctActive,
      instinctReason: this.instinctReason,
      voyager: this.voyagerLoop
        ? {
            isRunning: this.voyagerLoop.isRunning(),
            isPaused: this.voyagerLoop.isPaused(),
            currentTask: this.voyagerLoop.getCurrentTask(),
            queuedTaskCount: this.voyagerLoop.getQueuedTasks().length,
            lastExecution: lastExec,
          }
        : null,
      recentFailedTasks: failedTasks.slice(-5),
    };
  }

  /** Expose internal managers for API layer */
  getAffinityManager(): AffinityManager {
    return this.affinityManager;
  }

  getConversationManager(): ConversationManager {
    return this.conversationManager;
  }

  getVoyagerLoop(): VoyagerLoop | null {
    return this.voyagerLoop;
  }
}
