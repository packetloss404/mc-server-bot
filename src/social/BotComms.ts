import crypto from 'crypto';
import { logger } from '../util/logger';

export interface BotMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  type: 'chat' | 'request' | 'inform' | 'greeting';
  timestamp: number;
  read: boolean;
}

export class BotComms {
  private queues: Map<string, BotMessage[]> = new Map();
  private listeners: Map<string, (msg: BotMessage) => void> = new Map();

  sendMessage(from: string, to: string, content: string, type: BotMessage['type'] = 'chat'): BotMessage {
    const msg: BotMessage = {
      id: crypto.randomUUID(),
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      content,
      type,
      timestamp: Date.now(),
      read: false,
    };

    const toKey = to.toLowerCase();
    if (!this.queues.has(toKey)) this.queues.set(toKey, []);
    this.queues.get(toKey)!.push(msg);

    // Also store in sender's queue for history
    const fromKey = from.toLowerCase();
    if (!this.queues.has(fromKey)) this.queues.set(fromKey, []);
    this.queues.get(fromKey)!.push({ ...msg, read: true });

    const listener = this.listeners.get(toKey);
    if (listener) {
      try {
        listener(msg);
      } catch (err) {
        logger.error({ err, to }, 'BotComms listener error');
      }
    }

    logger.debug({ from, to, type }, 'Bot message sent');
    return msg;
  }

  getUnread(botName: string): BotMessage[] {
    const key = botName.toLowerCase();
    const queue = this.queues.get(key) ?? [];
    const unread = queue.filter(m => !m.read && m.to === key);
    for (const m of unread) {
      m.read = true;
    }
    return unread;
  }

  registerListener(botName: string, callback: (msg: BotMessage) => void): void {
    this.listeners.set(botName.toLowerCase(), callback);
  }

  unregisterListener(botName: string): void {
    this.listeners.delete(botName.toLowerCase());
  }

  getRecentMessages(botName: string, limit = 10): BotMessage[] {
    const key = botName.toLowerCase();
    const queue = this.queues.get(key) ?? [];
    return queue
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  clearBot(botName: string): void {
    const key = botName.toLowerCase();
    this.queues.delete(key);
    this.listeners.delete(key);
  }
}
