import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';
import { atomicWriteJson } from '../util/atomicWrite';

export interface BotMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  type: 'chat' | 'help_request' | 'status' | 'trade_offer' | 'alert';
  timestamp: number;
  read: boolean;
}

type MessageListener = (message: BotMessage) => void;

const PERSIST_PATH = path.join(process.cwd(), 'data', 'bot_comms.json');
const SAVE_DEBOUNCE_MS = 2000;

/**
 * Inter-bot communication system. Singleton shared across all bot instances.
 * Allows bots to send messages to each other, request help, and coordinate.
 *
 * Inbox is persisted (debounced, atomic) to `data/bot_comms.json` so pending
 * help requests / trade offers / alerts survive a process restart. Listeners
 * are intentionally not persisted — they're rebound when bots respawn.
 */
export class BotComms {
  private static instance: BotComms | null = null;
  private inbox: Map<string, BotMessage[]> = new Map(); // keyed by recipient bot name
  private listeners: Map<string, MessageListener[]> = new Map(); // keyed by bot name
  private saveTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.load();
  }

  static getInstance(): BotComms {
    if (!BotComms.instance) {
      BotComms.instance = new BotComms();
    }
    return BotComms.instance;
  }

  private load(): void {
    try {
      if (!fs.existsSync(PERSIST_PATH)) return;
      const raw = fs.readFileSync(PERSIST_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as { inbox?: Record<string, BotMessage[]> };
      if (parsed?.inbox && typeof parsed.inbox === 'object') {
        let totalLoaded = 0;
        for (const [key, messages] of Object.entries(parsed.inbox)) {
          if (Array.isArray(messages)) {
            this.inbox.set(key, messages);
            totalLoaded += messages.length;
          }
        }
        logger.info({ totalLoaded, recipients: this.inbox.size }, 'BotComms inbox loaded from disk');
      }
    } catch (err: any) {
      // Corrupted file → start fresh; data loss is preferable to crash here
      // and the file gets rewritten on next save.
      logger.warn({ err: err?.message, path: PERSIST_PATH }, 'BotComms load failed; starting with empty inbox');
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const inbox: Record<string, BotMessage[]> = {};
      for (const [k, v] of this.inbox.entries()) inbox[k] = v;
      atomicWriteJson(PERSIST_PATH, { inbox }).catch((err) => {
        logger.warn({ err: err?.message, path: PERSIST_PATH }, 'BotComms save failed');
      });
    }, SAVE_DEBOUNCE_MS);
  }

  sendMessage(from: string, to: string, content: string, type: BotMessage['type'] = 'chat'): void {
    const msg: BotMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      content,
      type,
      timestamp: Date.now(),
      read: false,
    };

    const key = to.toLowerCase();
    if (!this.inbox.has(key)) this.inbox.set(key, []);
    this.inbox.get(key)!.push(msg);

    // Trim inbox to prevent unbounded growth
    const inbox = this.inbox.get(key)!;
    if (inbox.length > 100) {
      this.inbox.set(key, inbox.slice(-100));
    }

    // Notify listeners
    const listeners = this.listeners.get(key) || [];
    for (const listener of listeners) {
      try {
        listener(msg);
      } catch (err: any) {
        logger.error({ err: err.message, to: key }, 'BotComms listener error');
      }
    }

    logger.debug({ from: msg.from, to: msg.to, type, content }, 'Bot message sent');
    this.scheduleSave();
  }

  getUnread(botName: string): BotMessage[] {
    const key = botName.toLowerCase();
    const inbox = this.inbox.get(key) || [];
    const unread = inbox.filter(m => !m.read);

    // Mark as read
    for (const msg of unread) {
      msg.read = true;
    }

    if (unread.length > 0) this.scheduleSave();
    return unread;
  }

  /** Get all unread messages without marking them as read */
  peekUnread(botName: string): BotMessage[] {
    const key = botName.toLowerCase();
    const inbox = this.inbox.get(key) || [];
    return inbox.filter(m => !m.read);
  }

  registerListener(botName: string, listener: MessageListener): void {
    const key = botName.toLowerCase();
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key)!.push(listener);
  }

  removeListeners(botName: string): void {
    this.listeners.delete(botName.toLowerCase());
  }

  /** Broadcast a message to all registered bots except the sender */
  broadcast(from: string, content: string, type: BotMessage['type'] = 'chat'): void {
    const fromKey = from.toLowerCase();
    for (const key of this.inbox.keys()) {
      if (key !== fromKey) {
        this.sendMessage(from, key, content, type);
      }
    }
    // Also send to bots with listeners but no inbox yet
    for (const key of this.listeners.keys()) {
      if (key !== fromKey && !this.inbox.has(key)) {
        this.sendMessage(from, key, content, type);
      }
    }
  }

  /** Initialize inbox for a bot (call on spawn) */
  registerBot(botName: string): void {
    const key = botName.toLowerCase();
    if (!this.inbox.has(key)) {
      this.inbox.set(key, []);
    }
  }

  /** Clean up when a bot is removed */
  unregisterBot(botName: string): void {
    const key = botName.toLowerCase();
    this.inbox.delete(key);
    this.listeners.delete(key);
    this.scheduleSave();
  }
}
