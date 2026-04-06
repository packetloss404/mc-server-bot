import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';

export type MemoryType = 'chat' | 'task_complete' | 'task_failure' | 'combat' | 'gift' | 'trade' | 'observation';
export type EmotionalTrigger = 'task_success' | 'task_failure' | 'positive_chat' | 'negative_chat' | 'combat_win' | 'combat_loss';

export interface MemoryEntry {
  id: string;
  botName: string;
  type: MemoryType;
  subject: string; // player or bot name involved
  description: string;
  timestamp: number;
  emotionalValence: number; // -1 to 1
}

export interface EmotionalState {
  mood: 'happy' | 'neutral' | 'sad' | 'angry' | 'fearful';
  intensity: number; // 0 to 1
  lastUpdated: number;
}

interface SocialMemoryStore {
  memories: Record<string, MemoryEntry[]>; // keyed by botName
  emotionalStates: Record<string, EmotionalState>; // keyed by botName
}

export class SocialMemory {
  private store: SocialMemoryStore = { memories: {}, emotionalStates: {} };
  private savePath: string;
  private maxMemoriesPerBot: number;

  constructor(dataDir: string, maxMemoriesPerBot = 100) {
    this.savePath = path.join(dataDir, 'social_memory.json');
    this.maxMemoriesPerBot = maxMemoriesPerBot;
    this.load();
  }

  addMemory(botName: string, type: MemoryType, subject: string, description: string, emotionalValence = 0): void {
    const key = botName.toLowerCase();
    if (!this.store.memories[key]) this.store.memories[key] = [];

    const entry: MemoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      botName: key,
      type,
      subject: subject.toLowerCase(),
      description,
      timestamp: Date.now(),
      emotionalValence: Math.max(-1, Math.min(1, emotionalValence)),
    };

    this.store.memories[key].push(entry);

    // Trim old memories
    if (this.store.memories[key].length > this.maxMemoriesPerBot) {
      this.store.memories[key] = this.store.memories[key].slice(-this.maxMemoriesPerBot);
    }

    this.save();
    logger.debug({ botName: key, type, subject, description }, 'Social memory added');
  }

  updateEmotionalState(botName: string, trigger: EmotionalTrigger): void {
    const key = botName.toLowerCase();
    const current = this.store.emotionalStates[key] || { mood: 'neutral' as const, intensity: 0.5, lastUpdated: Date.now() };

    switch (trigger) {
      case 'task_success':
        current.mood = 'happy';
        current.intensity = Math.min(1, current.intensity + 0.2);
        break;
      case 'task_failure':
        current.mood = 'sad';
        current.intensity = Math.min(1, current.intensity + 0.15);
        break;
      case 'positive_chat':
        current.mood = 'happy';
        current.intensity = Math.min(1, current.intensity + 0.1);
        break;
      case 'negative_chat':
        current.mood = 'angry';
        current.intensity = Math.min(1, current.intensity + 0.15);
        break;
      case 'combat_win':
        current.mood = 'happy';
        current.intensity = Math.min(1, current.intensity + 0.25);
        break;
      case 'combat_loss':
        current.mood = 'fearful';
        current.intensity = Math.min(1, current.intensity + 0.3);
        break;
    }

    current.lastUpdated = Date.now();
    this.store.emotionalStates[key] = current;
    this.save();
    logger.debug({ botName: key, trigger, mood: current.mood, intensity: current.intensity }, 'Emotional state updated');
  }

  /** Decay emotional intensity toward neutral over time */
  reflect(botName: string): void {
    const key = botName.toLowerCase();
    const state = this.store.emotionalStates[key];
    if (!state) return;

    const elapsed = Date.now() - state.lastUpdated;
    const decayRate = 0.0001; // per ms
    state.intensity = Math.max(0, state.intensity - elapsed * decayRate);

    if (state.intensity < 0.1) {
      state.mood = 'neutral';
      state.intensity = 0.5;
    }

    state.lastUpdated = Date.now();
    this.store.emotionalStates[key] = state;
    this.save();
  }

  /** Build a context string for LLM prompts describing social state */
  buildMemoryContext(botName: string, targetPlayer?: string): string {
    const key = botName.toLowerCase();
    const memories = this.store.memories[key] || [];
    const emotional = this.store.emotionalStates[key];

    const parts: string[] = [];

    // Emotional state
    if (emotional) {
      parts.push(`Current mood: ${emotional.mood} (intensity ${(emotional.intensity * 100).toFixed(0)}%)`);
    }

    // Recent memories (last 10, optionally filtered by target)
    const relevant = targetPlayer
      ? memories.filter(m => m.subject === targetPlayer.toLowerCase()).slice(-10)
      : memories.slice(-10);

    if (relevant.length > 0) {
      const memoryLines = relevant.map(m => {
        const age = this.formatAge(Date.now() - m.timestamp);
        return `- [${age} ago] ${m.description}`;
      });
      parts.push(`Recent memories:\n${memoryLines.join('\n')}`);
    }

    return parts.join('\n');
  }

  getEmotionalState(botName: string): EmotionalState | null {
    return this.store.emotionalStates[botName.toLowerCase()] || null;
  }

  getRecentMemories(botName: string, count = 10): MemoryEntry[] {
    const key = botName.toLowerCase();
    return (this.store.memories[key] || []).slice(-count);
  }

  private formatAge(ms: number): string {
    if (ms < 60000) return 'just now';
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
    return `${Math.floor(ms / 86400000)}d`;
  }

  shutdown(): void {
    this.save();
  }

  private save(): void {
    const dir = path.dirname(this.savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
      fs.writeFileSync(this.savePath, JSON.stringify(this.store, null, 2));
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to save social memory');
    }
  }

  private load(): void {
    if (fs.existsSync(this.savePath)) {
      try {
        this.store = JSON.parse(fs.readFileSync(this.savePath, 'utf-8'));
        if (!this.store.memories) this.store.memories = {};
        if (!this.store.emotionalStates) this.store.emotionalStates = {};
      } catch {
        this.store = { memories: {}, emotionalStates: {} };
      }
    }
  }
}
