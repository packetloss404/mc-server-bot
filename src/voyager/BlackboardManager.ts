import fs from 'fs';
import path from 'path';
import { Task } from './CurriculumAgent';
import { LongTermGoal } from './LongTermGoal';

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export interface BlackboardTask {
  id: string;
  description: string;
  keywords: string[];
  status: 'pending' | 'claimed' | 'completed' | 'blocked';
  priority: TaskPriority;
  assignedBot?: string;
  source: 'swarm' | 'goal' | 'bot';
  goalId?: string;
  location?: { x: number; y: number; z: number };
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
  blocker?: string;
}

const PERSONALITY_KEYWORDS: Record<string, string[]> = {
  farmer: ['farm', 'harvest', 'plant', 'wheat', 'seeds', 'crop', 'hoe', 'bread', 'potato', 'carrot', 'beetroot', 'melon', 'pumpkin', 'sugar_cane', 'bone_meal'],
  blacksmith: ['smelt', 'furnace', 'iron', 'gold', 'diamond', 'ore', 'anvil', 'armor', 'sword', 'pickaxe', 'axe', 'shovel', 'craft', 'ingot', 'tool'],
  guard: ['kill', 'combat', 'zombie', 'skeleton', 'creeper', 'spider', 'patrol', 'protect', 'defend', 'sword', 'shield', 'armor', 'fight', 'mob'],
  explorer: ['explore', 'walk', 'travel', 'discover', 'find', 'locate', 'cave', 'mountain', 'village', 'biome', 'ocean', 'desert', 'jungle', 'scout'],
  merchant: ['trade', 'chest', 'storage', 'collect', 'gather', 'deposit', 'inventory', 'organize', 'villager', 'emerald', 'sell', 'buy'],
  elder: ['plan', 'enchant', 'brew', 'potion', 'book', 'library', 'lapis', 'experience', 'knowledge', 'redstone'],
  builder: ['build', 'place', 'construct', 'house', 'wall', 'floor', 'roof', 'door', 'window', 'foundation', 'structure', 'planks', 'cobblestone', 'stone'],
};

export interface BlackboardMessage {
  id: string;
  botName: string;
  kind: 'claim' | 'progress' | 'blocker' | 'request_help' | 'completion' | 'info';
  text: string;
  createdAt: number;
}

export interface BlackboardGoal {
  id: string;
  rawRequest: string;
  requestedBy: string;
  scope: 'swarm' | 'bot';
  botName?: string;
  status: 'active' | 'completed' | 'blocked' | 'cancelled';
  createdAt: number;
  updatedAt: number;
}

export interface BlackboardReservation {
  id: string;
  type: 'build-cell' | 'build-zone' | 'resource-node' | 'container' | 'workstation';
  key: string;
  botName: string;
  goalId?: string;
  createdAt: number;
  expiresAt?: number;
}

interface BlackboardState {
  swarmGoal: BlackboardGoal | null;
  goals: BlackboardGoal[];
  tasks: BlackboardTask[];
  messages: BlackboardMessage[];
  reservations: BlackboardReservation[];
}

export class BlackboardManager {
  private filePath: string;
  private state: BlackboardState;
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'blackboard.json');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.state = this.load();
  }

  setSwarmGoal(rawRequest: string, requestedBy: string, tasks: Task[]): BlackboardGoal {
    const goal: BlackboardGoal = {
      id: `swarm-${Date.now()}`,
      rawRequest,
      requestedBy,
      scope: 'swarm',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.state.swarmGoal = goal;
    this.state.goals = this.state.goals.filter((g) => g.scope !== 'swarm');
    this.state.goals.push(goal);
    this.state.tasks = this.state.tasks.filter((t) => t.source !== 'swarm');
    for (const task of tasks) {
      this.addTask(task, 'swarm', goal.id);
    }
    this.postMessage('swarm', 'info', `Swarm directive set: ${rawRequest}`);
    this.persist();
    return goal;
  }

  setBotGoal(botName: string, goal: LongTermGoal): void {
    this.state.goals = this.state.goals.filter((g) => !(g.scope === 'bot' && g.botName === botName));
    const boardGoal: BlackboardGoal = {
      id: goal.id,
      rawRequest: goal.rawRequest,
      requestedBy: goal.requestedBy,
      scope: 'bot',
      botName,
      status: goal.status,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    };
    this.state.goals.push(boardGoal);
    this.state.tasks = this.state.tasks.filter((t) => t.goalId !== goal.id);
    for (const task of goal.pendingSubtasks) {
      this.addTask(task, 'bot', goal.id);
    }
    this.postMessage(botName, 'info', `Pinned directive: ${goal.rawRequest}`);
    this.persist();
  }

  clearBotGoal(botName: string): void {
    this.state.goals = this.state.goals.filter((g) => !(g.scope === 'bot' && g.botName === botName));
    this.state.tasks = this.state.tasks.filter((t) => !(t.source === 'bot' && t.assignedBot === botName));
    this.persist();
  }

  addTask(task: Task, source: 'swarm' | 'goal' | 'bot', goalId?: string, priority: TaskPriority = 'normal', location?: { x: number; y: number; z: number }): BlackboardTask {
    const boardTask: BlackboardTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: task.description,
      keywords: task.keywords,
      status: 'pending',
      priority,
      source,
      goalId,
      location,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.state.tasks.push(boardTask);
    this.persist();
    return boardTask;
  }

  claimBestTask(botName: string, query?: string, personality?: string, botPosition?: { x: number; y: number; z: number }): BlackboardTask | null {
    const candidates = this.state.tasks.filter((t) => t.status === 'pending');
    if (candidates.length === 0) return null;
    const lowered = query?.toLowerCase() || '';
    const ranked = candidates.sort((a, b) =>
      this.scoreTaskEnhanced(b, lowered, personality, botPosition) - this.scoreTaskEnhanced(a, lowered, personality, botPosition)
      || a.createdAt - b.createdAt
    );
    const task = ranked[0];
    task.status = 'claimed';
    task.assignedBot = botName;
    task.updatedAt = Date.now();
    task.claimedAt = Date.now();
    this.postMessage(botName, 'claim', `I'm taking ${task.description}.`);
    this.persist();
    return task;
  }

  completeTask(taskDescription: string, botName: string): void {
    const task = this.state.tasks.find((t) => t.description === taskDescription && t.assignedBot === botName && t.status === 'claimed');
    if (!task) return;
    task.status = 'completed';
    task.updatedAt = Date.now();
    this.postMessage(botName, 'completion', `Completed ${task.description}.`);
    this.persist();
  }

  blockTask(taskDescription: string, botName: string, blocker: string): void {
    const task = this.state.tasks.find((t) => t.description === taskDescription && t.assignedBot === botName && t.status === 'claimed');
    if (!task) return;
    task.status = 'blocked';
    task.blocker = blocker;
    task.updatedAt = Date.now();
    this.postMessage(botName, 'blocker', `${task.description} is blocked: ${blocker}`);
    this.persist();
  }

  postMessage(botName: string, kind: BlackboardMessage['kind'], text: string): void {
    this.state.messages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      botName,
      kind,
      text,
      createdAt: Date.now(),
    });
    this.state.messages = this.state.messages.slice(-200);
    this.persist();
  }

  getState(): BlackboardState { return JSON.parse(JSON.stringify(this.state)); }
  getRecentMessages(limit = 20): BlackboardMessage[] { return this.state.messages.slice(-limit).reverse(); }
  getSwarmGoal(): BlackboardGoal | null { return this.state.swarmGoal; }

  claimReservation(type: BlackboardReservation['type'], key: string, botName: string, goalId?: string, ttlMs = 30000): boolean {
    this.clearExpiredReservations();
    const existing = this.state.reservations.find((r) => r.type === type && r.key === key && r.botName !== botName);
    if (existing) return false;
    const own = this.state.reservations.find((r) => r.type === type && r.key === key && r.botName === botName);
    if (own) { own.expiresAt = Date.now() + ttlMs; this.persist(); return true; }
    this.state.reservations.push({ id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, key, botName, goalId, createdAt: Date.now(), expiresAt: Date.now() + ttlMs });
    this.persist();
    return true;
  }

  releaseReservationsForBot(botName: string, prefix?: string): void {
    this.state.reservations = this.state.reservations.filter((r) => !(r.botName === botName && (!prefix || r.key.startsWith(prefix))));
    this.persist();
  }

  hasReservation(type: BlackboardReservation['type'], key: string, botName?: string): boolean {
    this.clearExpiredReservations();
    return this.state.reservations.some((r) => r.type === type && r.key === key && (!botName || r.botName === botName));
  }

  getSwarmRelevantTasks(personality?: string): BlackboardTask[] {
    const swarm = this.state.swarmGoal;
    if (!swarm || swarm.status !== 'active') return [];
    const swarmTasks = this.state.tasks.filter((t) => t.source === 'swarm' && t.goalId === swarm.id && t.status === 'pending');
    if (!personality) return swarmTasks;
    const personalityWords = PERSONALITY_KEYWORDS[personality.toLowerCase()] || [];
    if (personalityWords.length === 0) return swarmTasks;
    return swarmTasks.sort((a, b) => {
      const textA = `${a.description} ${a.keywords.join(' ')}`.toLowerCase();
      const textB = `${b.description} ${b.keywords.join(' ')}`.toLowerCase();
      return personalityWords.filter((w) => textB.includes(w)).length - personalityWords.filter((w) => textA.includes(w)).length;
    });
  }

  releaseStale(timeoutMs: number = 5 * 60 * 1000): number {
    const now = Date.now();
    let released = 0;
    for (const task of this.state.tasks) {
      if (task.status === 'claimed' && task.claimedAt && now - task.claimedAt > timeoutMs) {
        task.status = 'pending';
        task.assignedBot = undefined;
        task.claimedAt = undefined;
        task.updatedAt = now;
        released++;
      }
    }
    if (released > 0) { this.postMessage('system', 'info', `Released ${released} stale claimed task(s).`); this.persist(); }
    return released;
  }

  getBlockedTaskDescriptions(sinceMs: number = 10 * 60 * 1000): Set<string> {
    const cutoff = Date.now() - sinceMs;
    const blocked = new Set<string>();
    for (const msg of this.state.messages) {
      if (msg.kind === 'blocker' && msg.createdAt >= cutoff) {
        const match = msg.text.match(/^(.+?)(?:\s+is blocked:|\s+failed:)/);
        if (match) blocked.add(match[1]);
      }
    }
    return blocked;
  }

  getRecentMessagesForBot(botName: string, limit = 10): BlackboardMessage[] {
    return this.state.messages.filter((m) => m.botName !== botName).slice(-limit).reverse();
  }

  private scoreTask(task: BlackboardTask, query: string): number {
    let score = task.source === 'swarm' ? 12 : task.source === 'bot' ? 10 : 6;
    if (!query) return score;
    const text = `${task.description} ${task.keywords.join(' ')}`.toLowerCase();
    for (const word of query.split(/\s+/).filter(Boolean)) { if (text.includes(word)) score += 4; }
    return score;
  }

  private scoreTaskEnhanced(task: BlackboardTask, query: string, personality?: string, botPosition?: { x: number; y: number; z: number }): number {
    let score = this.scoreTask(task, query);
    const priorityBonus: Record<TaskPriority, number> = { low: 0, normal: 3, high: 9, critical: 15 };
    score += (priorityBonus[task.priority] ?? priorityBonus.normal) * 3;
    if (personality) {
      const words = PERSONALITY_KEYWORDS[personality.toLowerCase()] || [];
      const text = `${task.description} ${task.keywords.join(' ')}`.toLowerCase();
      for (const w of words) { if (text.includes(w)) score += 2; }
    }
    if (botPosition && task.location) {
      const dx = botPosition.x - task.location.x, dy = botPosition.y - task.location.y, dz = botPosition.z - task.location.z;
      score += Math.max(0, 15 - Math.sqrt(dx * dx + dy * dy + dz * dz) / 256 * 15) * 1.5;
    }
    score += Math.min(10, (Date.now() - task.createdAt) / 60000);
    return score;
  }

  private load(): BlackboardState {
    if (!fs.existsSync(this.filePath)) return { swarmGoal: null, goals: [], tasks: [], messages: [], reservations: [] };
    try { return { reservations: [], ...JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) }; }
    catch { return { swarmGoal: null, goals: [], tasks: [], messages: [], reservations: [] }; }
  }

  private clearExpiredReservations(): void {
    const now = Date.now();
    const before = this.state.reservations.length;
    this.state.reservations = this.state.reservations.filter((r) => !r.expiresAt || r.expiresAt > now);
    if (this.state.reservations.length !== before) this.persist();
  }

  private persist(): void {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.writeAtomic(); }, 2000);
  }

  private writeAtomic(): void {
    const tmpPath = this.filePath + '.tmp';
    try { fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2)); fs.renameSync(tmpPath, this.filePath); }
    catch { try { fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2)); } catch { /* best effort */ } try { fs.unlinkSync(tmpPath); } catch { /* ignore */ } }
  }

  shutdown(): void {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; this.writeAtomic(); }
  }
}
