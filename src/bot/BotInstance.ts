import { EventEmitter } from 'events';
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
import { buildSchematic, listSchematics } from '../actions/buildSchematic';
import { VoyagerLoop } from '../voyager/VoyagerLoop';
import { StatsTracker } from '../voyager/StatsTracker';
import { renderObservation } from '../voyager/Observation';
import { PERSONALITIES } from '../personality/PersonalityType';
import { SocialMemory } from '../social/SocialMemory';
import { BotComms, BotMessage } from '../social/BotComms';
import type { BotManager } from './BotManager';
import { BlackboardManager } from '../voyager/BlackboardManager';

export interface BotOptions {
  name: string;
  personality: string;
  mode: BotMode;
  spawnLocation?: { x: number; y: number; z: number };
  config: Config;
  llmClient: LLMClient | null;
  affinityManager: AffinityManager;
  conversationManager: ConversationManager;
  socialMemory: SocialMemory;
  botComms: BotComms;
  botManager: BotManager;
  blackboardManager: BlackboardManager;
  onSwarmDirective?: (description: string, requestedBy: string) => Promise<void> | void;
}

export class BotInstance extends EventEmitter {
  private static OWNER_PLAYER = 'Nerdfuryz';
  private static nextAvailableConnectAt = 0;
  readonly name: string;
  readonly personality: string;
  mode: BotMode;
  private _state: BotState = BotState.SPAWNING;
  bot: Bot | null = null;

  /** State getter/setter that emits 'stateChanged' for event-driven socket updates. */
  get state(): BotState { return this._state; }
  set state(newState: BotState) {
    const prev = this._state;
    this._state = newState;
    if (prev !== newState) {
      this.emit('stateChanged', { bot: this.name, state: newState, previousState: prev });
    }
  }

  // Throttle tracking for event-driven position/inventory updates
  private _lastPositionEmit = 0;
  private _inventoryDebounceTimer: NodeJS.Timeout | null = null;

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
  private onSwarmDirective?: (description: string, requestedBy: string) => Promise<void> | void;
  private chatCooldowns: Map<string, number> = new Map();
  private socialMemory: SocialMemory;
  private botComms: BotComms;
  private botManager: BotManager;
  private voyagerLoop: VoyagerLoop | null = null;
  private reflectionInterval: ReturnType<typeof setInterval> | null = null;
  private rawMessageHandler: ((jsonMsg: any) => void) | null = null;
  private instinctInterval: NodeJS.Timeout | null = null;
  private instinctResumeTimeout: NodeJS.Timeout | null = null;
  private instinctActive = false;
  private instinctReason: 'attack' | 'hazard' | null = null;
  private instinctPauseKey: string | null = null;
  private lastAttackedAt = 0;
  private lastHealth = 20;
  private lastAttackerName: string | null = null;
  private statsTracker = new StatsTracker('./data');
  private static CHAT_COOLDOWN_MS = 3000;
  private lastPathResetLog: { reason: string; at: number; suppressed: number } | null = null;
  private lastInteractionAt: number = Date.now();

  constructor(options: BotOptions) {
    super();
    this.name = options.name;
    this.personality = options.personality;
    this.mode = options.mode;
    this.spawnLocation = options.spawnLocation;
    this.config = options.config;
    this.llmClient = options.llmClient;
    this.affinityManager = options.affinityManager;
    this.conversationManager = options.conversationManager;
    this.socialMemory = options.socialMemory;
    this.botComms = options.botComms;
    this.botManager = options.botManager;
    this.blackboardManager = options.blackboardManager;
    this.onSwarmDirective = options.onSwarmDirective;
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
          // Debug: log all raw messages to diagnose chat issues
          if (!this.bot) return; // Bot disconnected during auth/class selection
          if (this.rawMessageHandler) {
            this.bot.removeListener('message', this.rawMessageHandler);
          }
          this.rawMessageHandler = (jsonMsg: any) => {
            const text = jsonMsg.toString();
            if (text && !text.includes('Chunk size') && text.trim().length > 0) {
              logger.debug({ bot: this.name, rawMessage: text }, 'Raw message received');
            }
          };
          this.bot.on('message', this.rawMessageHandler);

          // Listen for inter-bot messages (unregister first to avoid duplicates on reconnect)
          this.botComms.unregisterListener(this.name);
          this.botComms.registerListener(this.name, (msg: BotMessage) => {
            // Don't process messages from self
            if (msg.from.toLowerCase() === this.name.toLowerCase()) return;

            logger.info({ bot: this.name, from: msg.from, content: msg.content }, 'Received bot message');
            this.socialMemory.addMemory(this.name, 'social',
              `${msg.from} sent me a message: "${msg.content.substring(0, 80)}"`,
              [msg.from], 5
            );

            // Detect task-like requests and queue them via VoyagerLoop
            const taskRequest = this.extractBotTaskRequest(msg.content);
            if (taskRequest && this.voyagerLoop) {
              logger.info(
                { bot: this.name, from: msg.from, task: taskRequest },
                'Queuing bot-to-bot task request'
              );
              this.voyagerLoop.queuePlayerTask(taskRequest, msg.from);
            }
          });

          // Periodic reflection every 10 minutes
          this.reflectionInterval = setInterval(() => {
            const recent = this.socialMemory.getRecentMemories(this.name, 10);
            if (recent.length >= 5) {
              this.socialMemory.reflect(this.name, recent);
            }
          }, 600000);

          this.scheduleAmbientChat();
          this.startVoyagerIfCodegen();
        });
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
      this.statsTracker.trackDeath(this.name);
      this.stopInstinct('death');
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
      this.triggerAttackInstinct(source || this.findLikelyThreat(), 'entity-hurt');
    });

    // --- Event-driven socket updates (position, health, inventory) ---

    // Position: throttle to max once per second
    this.bot.on('move', () => {
      const now = Date.now();
      if (now - this._lastPositionEmit < 1000) return;
      const pos = this.bot?.entity?.position;
      if (!pos) return;
      this._lastPositionEmit = now;
      this.emit('positionChanged', {
        bot: this.name,
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        z: Math.round(pos.z),
      });
    });

    // Health: emit on change (mineflayer fires 'health' on actual change)
    this.bot.on('health', () => {
      this.emit('healthChanged', {
        bot: this.name,
        health: this.bot?.health ?? 0,
        food: this.bot?.food ?? 0,
      });
    });

    // Inventory: debounce to once per 2 seconds since changes can be rapid
    const emitInventory = () => {
      if (!this.bot) return;
      try {
        const items = this.bot.inventory.items();
        this.emit('inventoryChanged', {
          bot: this.name,
          items: items.map((i: any) => ({ name: i.name, count: i.count, slot: i.slot })),
        });
      } catch { /* bot may be disconnected */ }
    };
    const debouncedInventory = () => {
      if (this._inventoryDebounceTimer) clearTimeout(this._inventoryDebounceTimer);
      this._inventoryDebounceTimer = setTimeout(emitInventory, 2000);
    };
    this.bot.on('playerCollect' as any, debouncedInventory);
    this.bot.once('spawn', () => {
      (this.bot?.inventory as any)?.on?.('updateSlot', debouncedInventory);
    });

    // --- End event-driven socket updates ---

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
      // 'end' will also fire after kick — let 'end' handle reconnect
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

  // Map bot personality to server class (hotbar slot)
  // Classes: Warrior=0, Mage=1, Archer=2, Tank=3
  private static CLASS_MAP: Record<string, { slot: number; name: string }> = {
    guard:      { slot: 3, name: 'Tank' },
    blacksmith: { slot: 0, name: 'Warrior' },
    explorer:   { slot: 2, name: 'Archer' },
    elder:      { slot: 1, name: 'Mage' },
    merchant:   { slot: 2, name: 'Archer' },
    farmer:     { slot: 0, name: 'Warrior' },
    builder:    { slot: 3, name: 'Tank' },
  };

  private handleAuth(onReady: () => void): void {
    if (!this.bot) return;

    const bot = this.bot;
    let authDone = false;
    let classSelected = false;

    const finish = () => {
      if (authDone) return;
      authDone = true;
      bot.removeListener('message', onMessage);
      logger.info({ bot: this.name }, 'Auth complete');
      onReady();
    };

    const selectClass = () => {
      if (classSelected) return;
      classSelected = true;
      const mapping = BotInstance.CLASS_MAP[this.personality] || { slot: 0, name: 'Warrior' };
      logger.info({ bot: this.name, class: mapping.name, slot: mapping.slot }, 'Selecting class');
      try {
        bot.setQuickBarSlot(mapping.slot);
        setTimeout(() => {
          try {
            bot.activateItem();
            logger.info({ bot: this.name, class: mapping.name }, 'Class selected via activateItem');
          } catch (e) {
            logger.debug({ bot: this.name, err: String(e) }, 'activateItem failed, trying swingArm');
            try { bot.swingArm('right'); } catch {}
          }
        }, 500);
      } catch (e) {
        logger.warn({ bot: this.name, err: String(e) }, 'Class selection failed');
      }
    };

    const onMessage = (jsonMsg: any) => {
      if (authDone) return;
      const msg = jsonMsg.toString();
      if (msg.trim()) {
        logger.info({ bot: this.name, authMsg: msg.substring(0, 200) }, 'Auth phase message');
      }

      // Auth login/register flow
      if (msg.includes('Registered successfully') || msg.includes('Logged in successfully') || msg.includes('already logged in')) {
        // Don't finish yet — class selection may follow
        logger.info({ bot: this.name }, 'Login successful, waiting for class selection');
      } else if (msg.includes('already registered') || msg.includes('Please log in')) {
        logger.info({ bot: this.name }, 'Already registered, logging in');
        bot.chat(`/login ${BotInstance.BOT_PASSWORD}`);
      } else if (msg.includes('Please register') || msg.includes('not registered')) {
        logger.info({ bot: this.name }, 'Registering with DyoAuth');
        bot.chat(`/register ${BotInstance.BOT_PASSWORD} ${BotInstance.BOT_PASSWORD}`);
      }

      // Class selection flow
      if (msg.includes('Choose your class') || msg.includes('choose your class')) {
        logger.info({ bot: this.name }, 'Class selection prompt detected');
        setTimeout(() => selectClass(), 1000);
      } else if (msg.includes('Please select a class')) {
        logger.info({ bot: this.name }, 'Class reminder, retrying selection');
        classSelected = false; // Allow retry
        setTimeout(() => selectClass(), 500);
      } else if (msg.includes('You are now a') || msg.includes('Class selected') || msg.includes('you have selected')) {
        logger.info({ bot: this.name }, 'Class confirmed, auth complete');
        finish();
      }
    };

    bot.on('message', onMessage);

    // Proactively try login after 2s (in case message event was missed)
    setTimeout(() => {
      if (!authDone && bot && typeof bot.chat === 'function') {
        try {
          logger.info({ bot: this.name }, 'Proactively trying /login');
          bot.chat(`/login ${BotInstance.BOT_PASSWORD}`);
        } catch (e) {
          logger.debug({ bot: this.name, err: String(e) }, 'Proactive login failed');
        }
      }
    }, 2000);

    // Try /register at 4s if still not authed
    setTimeout(() => {
      if (!authDone && bot && typeof bot.chat === 'function') {
        try {
          logger.info({ bot: this.name }, 'Proactively trying /register');
          bot.chat(`/register ${BotInstance.BOT_PASSWORD} ${BotInstance.BOT_PASSWORD}`);
        } catch (e) {
          logger.debug({ bot: this.name, err: String(e) }, 'Proactive register failed');
        }
      }
    }, 4000);

    // Timeout fallback — finish even if class wasn't confirmed
    setTimeout(() => {
      if (!authDone) {
        logger.warn({ bot: this.name }, 'Auth timeout, proceeding anyway');
        finish();
      }
    }, 20000);
  }

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** Reset reconnect state so the bot can be reconnected by the watchdog. */
  resetReconnect(): void {
    this.reconnectAttempts = 0;
    this.destroyed = false;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) return; // Already scheduled
    if (this.reconnectAttempts >= this.config.bots.maxReconnectAttempts) {
      logger.error({ bot: this.name }, 'Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(
      this.config.bots.reconnectDelaySec * Math.pow(2, this.reconnectAttempts) * 1000,
      60000
    );
    this.reconnectAttempts++;

    logger.info({ bot: this.name, delay, attempt: this.reconnectAttempts }, 'Scheduling reconnect');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
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

    this.headTrackingInterval = setInterval(() => {
      if (!this.bot || this.state === BotState.DISCONNECTED || !this.bot.players || !this.bot.entity) return;
      if (this.mode === BotMode.CODEGEN && this.voyagerLoop?.getCurrentTask()) return;
      if (this.state === BotState.EXECUTING_TASK) return;

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

  private chatListenerBound = false;

  private startChatListener(): void {
    if (!this.bot || this.chatListenerBound) return;
    this.chatListenerBound = true;

    this.bot.on('chat', async (username: string, message: string) => {
      // Ignore own messages and empty messages
      if (!this.bot || username === this.bot.username || !message.trim()) return;

      logger.info({ bot: this.name, from: username, message }, 'Chat received');

      // Check if the chatting player is actually another bot
      const otherBot = this.botManager.getBot(username);
      if (otherBot) {
        this.botComms.sendMessage(username, this.name, message, 'chat');
      }

      // Check if player is within conversation radius
      const player = this.bot.players[username];
      if (!player?.entity) {
        logger.debug({ bot: this.name, from: username, hasPlayer: !!player, hasEntity: !!player?.entity }, 'Chat ignored: no player entity');
        return;
      }

      // Handle swarm directives from owner
      const swarmMatch = message.match(/^swarm:\s*(.+)$/i);
      if (swarmMatch && this.onSwarmDirective) {
        const directive = swarmMatch[1].trim();
        logger.info({ bot: this.name, player: username, directive }, 'Swarm directive received');
        await this.onSwarmDirective(directive, username);
        this.sendLongChat(`Understood. The swarm will work on: ${directive}`);
        return;
      }

      const dist = player.entity.position.distanceTo(this.bot.entity.position);
      if (dist > this.config.behavior.conversationRadius) {
        logger.debug({ bot: this.name, from: username, dist, radius: this.config.behavior.conversationRadius }, 'Chat ignored: out of range');
        return;
      }

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
        if (this.voyagerLoop) this.voyagerLoop.pause('command:follow');
        followPlayer(this.bot, playerName, 600000).finally(() => {
          if (this.state === BotState.FOLLOWING) this.state = BotState.IDLE;
          if (this.voyagerLoop) this.voyagerLoop.resume('command:follow');
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
        if (this.voyagerLoop) this.voyagerLoop.pause('command:build-schematic');
        const origin = this.bot.entity.position.floored();
        buildSchematic(this.bot, match, { x: origin.x, y: origin.y, z: origin.z }, (placed, total) => {
          this.bot?.chat(`Building... ${placed}/${total} blocks`);
        }).then((result) => {
          if (this.bot) this.bot.chat(result.message ?? 'Build complete.');
          this.state = BotState.IDLE;
          if (this.voyagerLoop) this.voyagerLoop.resume('command:build-schematic');
        }).catch((err) => {
          this.bot?.chat(`Build failed: ${err.message}`);
          this.state = BotState.IDLE;
          if (this.voyagerLoop) this.voyagerLoop.resume('command:build-schematic');
        });
        break;
      }
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

      const affinity = await this.affinityManager.get(this.name, playerName);
      const isCodegen = this.mode === BotMode.CODEGEN;
      const internalState = this.voyagerLoop?.getInternalState();

      // Build social context for enhanced prompts
      const memoryContext = this.socialMemory.buildMemoryContext(this.name, [playerName]);
      const emotionalState = this.socialMemory.getEmotionalState(this.name);
      const relationshipSummary = this.affinityManager.getRelationshipSummary(this.name, playerName);
      const nearbyBots = this.botManager.getNearbyBotInfo(this.name);

      const systemPrompt = buildSystemPrompt(
        this.name, this.personality, affinity, isCodegen, internalState,
        { nearbyBots, memoryContext, emotionalState, relationshipSummary }
      );

      // Build conversation history (current message appended by buildContentsArray)
      const contents = await this.conversationManager.buildContentsArray(this.name, playerName, message);

      const response = await this.llmClient.chat(systemPrompt, contents, this.config.llm.chatMaxTokens);

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

      // Record memory of this interaction
      this.socialMemory.addMemory(this.name, 'social',
        `${playerName} said: "${message.substring(0, 50)}". I responded about ${flatText.substring(0, 50)}`,
        [playerName],
        sentiment === 'POSITIVE' ? 6 : sentiment === 'NEGATIVE' ? 7 : 4
      );
      this.socialMemory.updateEmotionalState(this.name,
        sentiment === 'POSITIVE' ? 'positive_chat' : sentiment === 'NEGATIVE' ? 'negative_chat' : 'social_interaction'
      );
      this.lastInteractionAt = Date.now();

      // Queue task in Voyager loop if extracted
      if ((goalDescription || taskDescription) && this.voyagerLoop) {
        // Force-resume if paused so the player's request actually executes
        if (this.voyagerLoop.isPaused()) {
          this.voyagerLoop.forceResume('player-chat-request');
          logger.info({ bot: this.name, player: playerName }, 'Force-resumed voyager loop for player request');
        }
        if (!this.voyagerLoop.isRunning()) {
          this.voyagerLoop.start();
          logger.info({ bot: this.name, player: playerName }, 'Auto-started voyager loop for player request');
        }

        if (goalDescription) {
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

    // Mood-based ambient chat intervals
    const emotionalState = this.socialMemory.getEmotionalState(this.name);
    let minMs: number;
    let maxMs: number;
    switch (emotionalState.mood) {
      case 'lonely':
        minMs = 300_000;    // 5 minutes
        maxMs = 600_000;    // 10 minutes
        break;
      case 'annoyed':
        minMs = 1_200_000;  // 20 minutes
        maxMs = 2_400_000;  // 40 minutes
        break;
      case 'happy':
      case 'excited':
        minMs = 480_000;    // 8 minutes
        maxMs = 900_000;    // 15 minutes
        break;
      case 'scared':
        minMs = 900_000;    // 15 minutes
        maxMs = 1_800_000;  // 30 minutes
        break;
      default: // neutral
        minMs = 600_000;    // 10 minutes
        maxMs = 1_200_000;  // 20 minutes
        break;
    }
    const delay = minMs + Math.random() * (maxMs - minMs);

    this.ambientChatTimeout = setTimeout(async () => {
      if (!this.bot || this.destroyed) return;

      // Check for idle_long: if no interactions for 10+ minutes, trigger lonely mood
      const idleMs = Date.now() - this.lastInteractionAt;
      if (idleMs > 600_000) { // 10 minutes
        this.socialMemory.updateEmotionalState(this.name, 'idle_long');
      }

      // 30% chance to actually say something even when timer fires
      if (Math.random() > 0.3) {
        this.scheduleAmbientChat();
        return;
      }

      // Find nearest player within conversation radius
      if (!this.bot.players || !this.bot.entity) {
        this.scheduleAmbientChat();
        return;
      }
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

    // Wire social memory into task lifecycle
    this.voyagerLoop.onTaskSuccess = (taskDescription: string) => {
      this.socialMemory.addMemory(this.name, 'event', `Successfully completed: ${taskDescription}`, [], 5);
      this.socialMemory.updateEmotionalState(this.name, 'task_success');
      this.lastInteractionAt = Date.now();
    };
    this.voyagerLoop.onTaskFailure = (taskDescription: string) => {
      this.socialMemory.addMemory(this.name, 'event', `Failed task: ${taskDescription}`, [], 4);
      this.socialMemory.updateEmotionalState(this.name, 'task_failure');
      this.lastInteractionAt = Date.now();
    };

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

    // Track affinity hit when a real player (not another bot) attacks this bot
    if (this.lastAttackerName && source?.type === 'player' && !this.botManager.getBot(this.lastAttackerName)) {
      this.affinityManager.onHit(this.name, this.lastAttackerName);
    }

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
    if (this.voyagerLoop?.isRunning()) {
      const key = `instinct:${trigger}`;
      this.instinctPauseKey = key;
      this.voyagerLoop.pause(key);
    }
  }

  private startInstinctLoop(): void {
    if (this.instinctInterval || !this.bot) return;
    this.instinctInterval = setInterval(() => {
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
    }, 1000);
  }

  private stopInstinct(reason: string): void {
    if (this.instinctResumeTimeout) {
      clearTimeout(this.instinctResumeTimeout);
      this.instinctResumeTimeout = null;
    }
    if (this.instinctInterval) {
      clearInterval(this.instinctInterval);
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
    if (!this.destroyed && this.state !== BotState.DISCONNECTED && this.instinctPauseKey && this.voyagerLoop) {
      this.voyagerLoop.resume(this.instinctPauseKey);
    }
    this.instinctPauseKey = null;
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
      if (entity.type === 'player' && entity.username !== this.bot!.username) {
        // Only treat players as threats if they are hostile (low affinity)
        return this.affinityManager.isHostile(this.name, entity.username);
      }
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
    if (this.reflectionInterval) {
      clearInterval(this.reflectionInterval);
      this.reflectionInterval = null;
    }
    if (this.voyagerLoop) {
      this.voyagerLoop.stop();
      this.voyagerLoop = null;
    }
    this.chatCooldowns.clear();
    if (this._inventoryDebounceTimer) {
      clearTimeout(this._inventoryDebounceTimer);
      this._inventoryDebounceTimer = null;
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

    if (this.pendingConnectTimeout) {
      clearTimeout(this.pendingConnectTimeout);
      this.pendingConnectTimeout = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.botComms.unregisterListener(this.name);

    if (this.bot) {
      if (this.rawMessageHandler) {
        this.bot.removeListener('message', this.rawMessageHandler);
        this.rawMessageHandler = null;
      }
      this.bot.quit();
      this.bot = null;
    }

    this.removeAllListeners();
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

    // World context via Observation
    let world = null;
    try {
      const obs = renderObservation(this.bot);
      world = {
        biome: obs.biome,
        timeOfDay: obs.timeOfDay,
        isRaining: this.bot.isRaining,
        nearbyBlocks: obs.nearbyBlocks,
        nearbyEntities: obs.nearbyEntities,
      };
    } catch { /* bot may not be fully spawned */ }

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
      health: this.bot?.health ?? 0,
      food: this.bot?.food ?? 0,
      voyager: this.voyagerLoop
        ? {
            isRunning: this.voyagerLoop.isRunning(),
            isPaused: this.voyagerLoop.isPaused(),
            currentTask: this.voyagerLoop.getCurrentTask(),
            queuedTasks: this.voyagerLoop.getQueuedTasks().length,
            queuedTaskCount: this.voyagerLoop.getQueueLength(),
            queuedTaskPreviews: this.voyagerLoop.getQueuedTasksDetailed().slice(0, 5),
            lastExecution: this.voyagerLoop.getLastExecutionMetrics(),
          }
        : null,
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

  /**
   * Detect task-like requests in bot-to-bot messages using keyword matching.
   * Returns the extracted task string if the message looks like a request, or null otherwise.
   */
  private extractBotTaskRequest(content: string): string | null {
    const lower = content.toLowerCase();

    // Only match direct requests — require "please", "can you", "could you", "go", "I need you to"
    // or imperative form directed at this bot. This avoids matching status chatter like
    // "I need to gather more resources" which is self-directed, not a request.
    const directRequestPattern = /\b(please|can you|could you|go|i need you to|would you|will you)\b/;
    if (!directRequestPattern.test(lower)) return null;

    // Check that the message also contains an action verb + noun
    const taskPattern = /\b(mine|craft|gather|bring|come|help|build|collect|get|find|chop|dig|smelt|cook|farm|harvest|fetch|deliver|make|place|break)\b.*?\b(\w{3,})\b/;
    const match = lower.match(taskPattern);
    if (!match) return null;

    // Use the original content (preserving case) as the task description
    return content.trim();
  }
}
