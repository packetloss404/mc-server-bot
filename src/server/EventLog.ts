export interface BotEvent {
  type: string;
  botName: string;
  description: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * In-memory circular buffer that stores the last N events.
 * Exposed via GET /api/activity and also used by Socket.IO to broadcast.
 */
export class EventLog {
  private buffer: BotEvent[] = [];
  private maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  push(event: Omit<BotEvent, 'timestamp'>): BotEvent {
    const full: BotEvent = { ...event, timestamp: Date.now() };
    this.buffer.push(full);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
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

  /** Flush pending writes to disk (no-op for in-memory-only buffer; exists for API compat). */
  shutdown(): void {
    // In-memory circular buffer has nothing to flush.
    // This method exists so callers can safely call shutdown() on any EventLog variant.
  }
}
