import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';

const ACTIVITY_FILE = path.join(process.cwd(), 'data', 'activity.json');
const SAVE_DEBOUNCE_MS = 2000;

export interface BotEvent {
  type: string;
  botName: string;
  description: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Circular buffer that stores the last N events.
 * Persisted to data/activity.json so events survive restarts.
 * Exposed via GET /api/activity and also used by Socket.IO to broadcast.
 */
export class EventLog {
  private buffer: BotEvent[] = [];
  private maxSize: number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.load();
  }

  push(event: Omit<BotEvent, 'timestamp'>): BotEvent {
    const full: BotEvent = { ...event, timestamp: Date.now() };
    this.buffer.push(full);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
    this.scheduleSave();
    return full;
  }

  /** Get recent events, optionally filtered by bot name or type */
  getRecent(limit = 50, botName?: string, type?: string): BotEvent[] {
    let events = this.buffer;
    if (botName) {
      events = events.filter((e) => e.botName.toLowerCase() === botName.toLowerCase());
    }
    if (type) {
      events = events.filter((e) => e.type === type);
    }
    return events.slice(-limit).reverse(); // newest first
  }

  getAll(): BotEvent[] {
    return [...this.buffer].reverse();
  }

  // ── Persistence ────────────────────────────────────────────

  private load(): void {
    try {
      if (fs.existsSync(ACTIVITY_FILE)) {
        const raw = JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf-8'));
        const events: BotEvent[] = Array.isArray(raw) ? raw : [];
        // Only keep the most recent maxSize entries
        this.buffer = events.slice(-this.maxSize);
        logger.info({ count: this.buffer.length }, 'Loaded activity log from disk');
      }
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'Failed to load activity log, starting fresh');
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(ACTIVITY_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(this.buffer, null, 2), 'utf-8');
    } catch (err: any) {
      logger.error({ err: err?.message }, 'Failed to save activity log');
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Flush pending debounced writes to disk immediately (call on process exit). */
  shutdown(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save();
    logger.info('Event log shut down, activity flushed to disk');
  }
}
