import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../util/logger';

export interface Memory {
  id: string;
  botName: string;
  type: 'social' | 'event' | 'reflection' | 'observation';
  content: string;
  subjects: string[];
  importance: number;
  timestamp: number;
  decay: number;
}

export interface Reflection {
  id: string;
  botName: string;
  content: string;
  basedOn: string[];
  timestamp: number;
}

export interface BotEmotionalState {
  mood: 'happy' | 'neutral' | 'annoyed' | 'scared' | 'excited' | 'lonely';
  energy: number;
  sociability: number;
  lastUpdated: number;
}

interface SocialMemoryStore {
  memories: Memory[];
  reflections: Reflection[];
  emotionalStates: { [botName: string]: BotEmotionalState };
}

const DECAY_INTERVAL_MS = 5 * 60 * 1000;
const DECAY_AMOUNT = 0.02;
const DECAY_THRESHOLD = 0.1;

export class SocialMemory {
  private store: SocialMemoryStore = { memories: [], reflections: [], emotionalStates: {} };
  private savePath: string;
  private decayTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.savePath = path.join('data', 'social_memory.json');
    this.load();
    this.decayTimer = setInterval(() => this.decayMemories(), DECAY_INTERVAL_MS);
  }

  addMemory(botName: string, type: Memory['type'], content: string, subjects: string[], importance: number): Memory {
    const memory: Memory = {
      id: crypto.randomUUID(),
      botName: botName.toLowerCase(),
      type,
      content,
      subjects: subjects.map(s => s.toLowerCase()),
      importance: Math.max(1, Math.min(10, importance)),
      timestamp: Date.now(),
      decay: 1.0,
    };
    this.store.memories.push(memory);
    this.save();
    logger.debug({ botName, type, importance }, 'Social memory added');
    return memory;
  }

  getRecentMemories(botName: string, limit = 10): Memory[] {
    const key = botName.toLowerCase();
    return this.store.memories
      .filter(m => m.botName === key)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  getMemoriesAbout(botName: string, subject: string, limit = 5): Memory[] {
    const key = botName.toLowerCase();
    const subj = subject.toLowerCase();
    return this.store.memories
      .filter(m => m.botName === key && m.subjects.includes(subj))
      .sort((a, b) => (b.importance * b.decay) - (a.importance * a.decay))
      .slice(0, limit);
  }

  getRelevantMemories(botName: string, context: string, limit = 5): Memory[] {
    const key = botName.toLowerCase();
    const words = context.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) return [];

    const scored = this.store.memories
      .filter(m => m.botName === key)
      .map(m => {
        const contentLower = m.content.toLowerCase();
        const matches = words.filter(w => contentLower.includes(w)).length;
        const relevance = matches / words.length;
        return { memory: m, score: relevance * m.importance * m.decay };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(s => s.memory);
  }

  getReflections(botName: string, limit = 3): Reflection[] {
    const key = botName.toLowerCase();
    return this.store.reflections
      .filter(r => r.botName === key)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  reflect(botName: string, recentMemories: Memory[]): Reflection {
    const key = botName.toLowerCase();

    // Find common subjects
    const subjectCounts: Record<string, number> = {};
    for (const m of recentMemories) {
      for (const s of m.subjects) {
        subjectCounts[s] = (subjectCounts[s] || 0) + 1;
      }
    }
    const topSubjects = Object.entries(subjectCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);

    // Identify patterns
    const socialMemories = recentMemories.filter(m => m.type === 'social');
    const eventMemories = recentMemories.filter(m => m.type === 'event');
    const avgImportance = recentMemories.reduce((sum, m) => sum + m.importance, 0) / (recentMemories.length || 1);
    const positiveWords = ['help', 'friend', 'gave', 'thank', 'nice', 'great', 'success', 'crafted', 'built'];
    const negativeWords = ['hit', 'attack', 'fail', 'died', 'lost', 'broke', 'angry', 'stole'];

    let positiveCount = 0;
    let negativeCount = 0;
    for (const m of recentMemories) {
      const lower = m.content.toLowerCase();
      if (positiveWords.some(w => lower.includes(w))) positiveCount++;
      if (negativeWords.some(w => lower.includes(w))) negativeCount++;
    }

    // Generate summary
    let content: string;
    if (topSubjects.length > 0 && socialMemories.length > eventMemories.length) {
      const sentiment = positiveCount > negativeCount ? 'friendly' : negativeCount > positiveCount ? 'hostile' : 'neutral';
      if (sentiment === 'friendly') {
        content = `${topSubjects[0]} has been very friendly lately, chatting often and ${avgImportance > 5 ? 'asking for help' : 'being supportive'}`;
      } else if (sentiment === 'hostile') {
        content = `${topSubjects[0]} has been causing trouble, I should be careful around them`;
      } else {
        content = `${topSubjects[0]} and I have had some interactions but nothing stands out`;
      }
    } else if (eventMemories.length > 0) {
      const mainActivity = eventMemories[0].content.toLowerCase();
      if (negativeCount > positiveCount) {
        content = `I've been busy but keep running into setbacks${topSubjects.length > 0 ? ` involving ${topSubjects[0]}` : ''}`;
      } else {
        content = `Things have been going well${topSubjects.length > 0 ? `, especially with ${topSubjects[0]}` : ''}`;
      }
    } else if (topSubjects.length >= 2) {
      content = `${topSubjects[0]} and ${topSubjects[1]} haven't interacted much, we should coordinate more`;
    } else {
      content = `Not much has happened recently, things are quiet`;
    }

    const reflection: Reflection = {
      id: crypto.randomUUID(),
      botName: key,
      content,
      basedOn: recentMemories.map(m => m.id),
      timestamp: Date.now(),
    };
    this.store.reflections.push(reflection);
    this.save();
    logger.debug({ botName, content }, 'Reflection created');
    return reflection;
  }

  getEmotionalState(botName: string): BotEmotionalState {
    const key = botName.toLowerCase();
    return this.store.emotionalStates[key] ?? {
      mood: 'neutral',
      energy: 50,
      sociability: 50,
      lastUpdated: Date.now(),
    };
  }

  updateEmotionalState(botName: string, event: string): void {
    const key = botName.toLowerCase();
    const state = this.getEmotionalState(botName);

    switch (event) {
      case 'positive_chat':
        state.mood = state.mood === 'excited' ? 'excited' : 'happy';
        state.sociability = Math.min(100, state.sociability + 5);
        break;
      case 'negative_chat':
        state.mood = state.mood === 'scared' ? 'scared' : 'annoyed';
        state.sociability = Math.max(0, state.sociability - 5);
        break;
      case 'death':
        state.mood = 'scared';
        state.energy = Math.max(0, state.energy - 20);
        break;
      case 'task_success':
        state.mood = state.mood === 'happy' ? 'excited' : 'happy';
        state.energy = Math.min(100, state.energy + 5);
        break;
      case 'task_failure':
        state.mood = state.mood === 'scared' ? 'scared' : 'annoyed';
        state.energy = Math.max(0, state.energy - 5);
        break;
      case 'idle_long':
        state.mood = 'lonely';
        state.sociability = Math.min(100, state.sociability + 10);
        break;
      case 'social_interaction':
        state.mood = state.mood === 'excited' ? 'excited' : 'happy';
        state.energy = Math.min(100, state.energy + 3);
        break;
    }

    state.lastUpdated = Date.now();
    this.store.emotionalStates[key] = state;
    this.save();
  }

  decayMemories(): void {
    const before = this.store.memories.length;
    for (const m of this.store.memories) {
      m.decay -= DECAY_AMOUNT;
    }
    this.store.memories = this.store.memories.filter(m => m.decay >= DECAY_THRESHOLD);
    const removed = before - this.store.memories.length;
    if (removed > 0) {
      logger.debug({ removed }, 'Decayed and removed memories');
    }
    this.save();
  }

  buildMemoryContext(botName: string, nearbyPlayers: string[], limit = 8): string {
    const recent = this.getRecentMemories(botName, limit);
    const reflections = this.getReflections(botName, 3);
    const emotional = this.getEmotionalState(botName);
    const lines: string[] = [];

    if (recent.length > 0) {
      lines.push('Recent memories:');
      const now = Date.now();
      for (const m of recent) {
        const ago = formatTimeAgo(now - m.timestamp);
        lines.push(`- [${ago}] ${m.content} (importance: ${m.importance})`);
      }
    }

    if (reflections.length > 0) {
      lines.push('');
      lines.push('Reflections:');
      for (const r of reflections) {
        lines.push(`- ${r.content}`);
      }
    }

    lines.push('');
    lines.push(`Current mood: ${emotional.mood} | Energy: ${emotional.energy} | Sociability: ${emotional.sociability}`);

    return lines.join('\n');
  }

  save(): void {
    const dir = path.dirname(this.savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.savePath, JSON.stringify(this.store, null, 2));
  }

  load(): void {
    if (fs.existsSync(this.savePath)) {
      try {
        this.store = JSON.parse(fs.readFileSync(this.savePath, 'utf-8'));
        if (!this.store.memories) this.store.memories = [];
        if (!this.store.reflections) this.store.reflections = [];
        if (!this.store.emotionalStates) this.store.emotionalStates = {};
      } catch {
        logger.warn('Failed to load social_memory.json, starting fresh');
      }
    }
  }
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
