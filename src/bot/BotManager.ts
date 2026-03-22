import fs from 'fs';
import path from 'path';
import { BotInstance, BotOptions } from './BotInstance';
import { BotMode } from './BotState';
import { Config } from '../config';
import { logger } from '../util/logger';
import { LLMClient } from '../ai/LLMClient';
import { AffinityManager } from '../personality/AffinityManager';
import { ConversationManager } from '../personality/ConversationManager';
import { SocialMemory } from '../social/SocialMemory';
import { BotComms } from '../social/BotComms';

interface SavedBot {
  name: string;
  personality: string;
  mode: string;
  spawnLocation?: { x: number; y: number; z: number };
}

export class BotManager {
  private bots: Map<string, BotInstance> = new Map();
  private config: Config;
  private dataPath: string;
  private llmClient: LLMClient | null;
  private affinityManager: AffinityManager;
  private conversationManager: ConversationManager;
  private socialMemory: SocialMemory;
  private botComms: BotComms;

  constructor(config: Config, llmClient: LLMClient | null) {
    this.config = config;
    this.dataPath = path.join(process.cwd(), 'data', 'bots.json');
    this.llmClient = llmClient;
    this.affinityManager = new AffinityManager(config.affinity, path.join(process.cwd(), 'data'));
    this.conversationManager = new ConversationManager();
    this.socialMemory = new SocialMemory();
    this.botComms = new BotComms();
  }

  async spawnBot(
    name: string,
    personality: string,
    location?: { x: number; y: number; z: number },
    mode?: string
  ): Promise<BotInstance | null> {
    const key = name.toLowerCase();

    if (this.bots.has(key)) {
      logger.warn({ bot: name }, 'Bot already exists');
      return null;
    }

    if (this.bots.size >= this.config.bots.maxBots) {
      logger.warn('Max bot limit reached');
      return null;
    }

    const effectiveMode = mode || this.config.bots.defaultMode;
    const botMode = effectiveMode === 'codegen' ? BotMode.CODEGEN : BotMode.PRIMITIVE;

    const instance = new BotInstance({
      name,
      personality,
      mode: botMode,
      spawnLocation: location,
      config: this.config,
      llmClient: this.llmClient,
      affinityManager: this.affinityManager,
      conversationManager: this.conversationManager,
      socialMemory: this.socialMemory,
      botComms: this.botComms,
      botManager: this,
    });

    this.bots.set(key, instance);
    await instance.connect();
    this.saveBots();

    logger.info({ bot: name, personality, mode: botMode }, 'Bot spawned');
    return instance;
  }

  async removeBot(name: string): Promise<boolean> {
    const key = name.toLowerCase();
    const instance = this.bots.get(key);
    if (!instance) return false;

    await instance.disconnect();
    this.bots.delete(key);
    this.saveBots();

    logger.info({ bot: name }, 'Bot removed');
    return true;
  }

  async removeAllBots(): Promise<number> {
    const count = this.bots.size;
    const names = [...this.bots.keys()];

    for (const name of names) {
      await this.removeBot(name);
    }

    return count;
  }

  getBot(name: string): BotInstance | undefined {
    return this.bots.get(name.toLowerCase());
  }

  getAllBots(): BotInstance[] {
    return [...this.bots.values()];
  }

  getAffinityManager(): AffinityManager {
    return this.affinityManager;
  }

  getConversationManager(): ConversationManager {
    return this.conversationManager;
  }

  getSocialMemory(): SocialMemory {
    return this.socialMemory;
  }

  getBotComms(): BotComms {
    return this.botComms;
  }

  getNearbyBotInfo(botName: string, radius: number = 64): { name: string; personality: string; activity: string }[] {
    const bot = this.getBot(botName);
    if (!bot?.bot?.entity) return [];
    const botPos = bot.bot.entity.position;

    return this.getAllBots()
      .filter(b => b.name !== botName && b.bot?.entity)
      .filter(b => b.bot!.entity.position.distanceTo(botPos) <= radius)
      .map(b => ({
        name: b.name,
        personality: b.personality,
        activity: b.getVoyagerLoop()?.getCurrentTask() || 'idle',
      }));
  }

  setMode(name: string, mode: string): boolean {
    const instance = this.bots.get(name.toLowerCase());
    if (!instance) return false;

    instance.setMode(mode === 'codegen' ? BotMode.CODEGEN : BotMode.PRIMITIVE);
    this.saveBots();
    return true;
  }

  private saveBots(): void {
    const data: SavedBot[] = this.getAllBots().map((bot) => ({
      name: bot.name,
      personality: bot.personality,
      mode: bot.mode,
      spawnLocation: bot.getStatus().position || undefined,
    }));

    const dir = path.dirname(this.dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.dataPath, JSON.stringify({ bots: data }, null, 2));
  }

  async loadSavedBots(): Promise<void> {
    if (!fs.existsSync(this.dataPath)) {
      logger.info('No saved bots found');
      return;
    }

    try {
      const raw = fs.readFileSync(this.dataPath, 'utf-8');
      const data = JSON.parse(raw) as { bots: SavedBot[] };

      for (const saved of data.bots) {
        await this.spawnBot(saved.name, saved.personality, saved.spawnLocation, saved.mode);
      }

      logger.info({ count: data.bots.length }, 'Loaded saved bots');
    } catch (err) {
      logger.error({ err }, 'Failed to load saved bots');
    }
  }
}
