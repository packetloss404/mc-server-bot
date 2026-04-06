import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';
import { atomicWriteJsonSync } from '../util/atomicWrite';

const DATA_DIR = path.join(process.cwd(), 'data');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const DEBOUNCE_MS = 2_000;

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface SerializedData {
  /** botName -> { playerName -> ChatMessage[] } */
  conversations: Record<string, Record<string, ChatMessage[]>>;
}

export class ConversationManager {
  private maxHistory: number;
  // histories[botName][playerName] = ChatMessage[]
  private histories: Map<string, Map<string, ChatMessage[]>> = new Map();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(maxHistory = 20) {
    this.maxHistory = maxHistory;
    this.load();
  }

  addPlayerMessage(botName: string, playerName: string, message: string): void {
    this.getOrCreate(botName, playerName).push({ role: 'user', text: message });
    this.trim(botName, playerName);
    this.scheduleSave();
  }

  addBotResponse(botName: string, playerName: string, response: string): void {
    this.getOrCreate(botName, playerName).push({ role: 'model', text: response });
    this.trim(botName, playerName);
    this.scheduleSave();
  }

  getHistory(botName: string, playerName: string): ChatMessage[] {
    return this.getOrCreate(botName, playerName);
  }

  buildContentsArray(botName: string, playerName: string, newMessage: string): any[] {
    const history = this.getOrCreate(botName, playerName);
    const contents: any[] = history.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.text }],
    }));
    contents.push({ role: 'user', parts: [{ text: newMessage }] });
    return contents;
  }

  /** Get all conversations for a specific bot, keyed by player name */
  getAllConversations(botName: string): Record<string, ChatMessage[]> {
    const botMap = this.histories.get(botName.toLowerCase());
    if (!botMap) return {};
    const result: Record<string, ChatMessage[]> = {};
    for (const [player, messages] of botMap.entries()) {
      result[player] = [...messages];
    }
    return result;
  }

  clearBot(botName: string): void {
    this.histories.delete(botName.toLowerCase());
    this.scheduleSave();
  }

  // -- Persistence --

  private load(): void {
    try {
      if (!fs.existsSync(CONVERSATIONS_FILE)) return;

      const raw = fs.readFileSync(CONVERSATIONS_FILE, 'utf-8');
      const data = JSON.parse(raw) as SerializedData;

      if (data.conversations && typeof data.conversations === 'object') {
        for (const [botName, players] of Object.entries(data.conversations)) {
          const botMap = new Map<string, ChatMessage[]>();
          for (const [playerName, messages] of Object.entries(players)) {
            if (Array.isArray(messages)) {
              botMap.set(playerName, messages);
            }
          }
          if (botMap.size > 0) {
            this.histories.set(botName, botMap);
          }
        }
        logger.info({ botCount: this.histories.size }, 'Loaded conversations from disk');
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load conversations.json, starting fresh');
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveImmediate();
    }, DEBOUNCE_MS);
  }

  private saveImmediate(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      const conversations: Record<string, Record<string, ChatMessage[]>> = {};
      for (const [botName, botMap] of this.histories.entries()) {
        const players: Record<string, ChatMessage[]> = {};
        for (const [playerName, messages] of botMap.entries()) {
          players[playerName] = messages;
        }
        conversations[botName] = players;
      }
      atomicWriteJsonSync(CONVERSATIONS_FILE, { conversations });
    } catch (err) {
      logger.error({ err }, 'Failed to save conversations.json');
    }
  }

  /** Flush any pending debounced writes to disk immediately (call on shutdown). */
  shutdown(): void {
    this.saveImmediate();
  }

  // -- Internal helpers --

  private getOrCreate(botName: string, playerName: string): ChatMessage[] {
    const bKey = botName.toLowerCase();
    const pKey = playerName.toLowerCase();

    if (!this.histories.has(bKey)) this.histories.set(bKey, new Map());
    const botMap = this.histories.get(bKey)!;

    if (!botMap.has(pKey)) botMap.set(pKey, []);
    return botMap.get(pKey)!;
  }

  private trim(botName: string, playerName: string): void {
    const history = this.getOrCreate(botName, playerName);
    while (history.length > this.maxHistory) {
      // Remove in pairs to maintain alternating user/model roles
      history.shift();
      if (history.length > 0 && history[0].role === 'model') {
        history.shift();
      }
    }
    // Ensure history always starts with 'user' role (Gemini requirement)
    while (history.length > 0 && history[0].role === 'model') {
      history.shift();
    }
  }
}
