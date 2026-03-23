import fs from 'fs';
import path from 'path';
import { Task } from './CurriculumAgent';
import { LongTermGoal } from './LongTermGoal';

export interface BlackboardTask {
  id: string;
  description: string;
  keywords: string[];
  status: 'pending' | 'claimed' | 'completed' | 'blocked';
  assignedBot?: string;
  source: 'swarm' | 'goal' | 'bot';
  goalId?: string;
  createdAt: number;
  updatedAt: number;
  blocker?: string;
}

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

  addTask(task: Task, source: 'swarm' | 'goal' | 'bot', goalId?: string): BlackboardTask {
    const boardTask: BlackboardTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: task.description,
      keywords: task.keywords,
      status: 'pending',
      source,
      goalId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.state.tasks.push(boardTask);
    this.persist();
    return boardTask;
  }

  claimBestTask(botName: string, query?: string): BlackboardTask | null {
    const candidates = this.state.tasks.filter((t) => t.status === 'pending');
    if (candidates.length === 0) return null;
    const lowered = query?.toLowerCase() || '';
    const ranked = candidates.sort((a, b) => this.scoreTask(b, lowered) - this.scoreTask(a, lowered) || a.createdAt - b.createdAt);
    const task = ranked[0];
    task.status = 'claimed';
    task.assignedBot = botName;
    task.updatedAt = Date.now();
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

  getState(): BlackboardState {
    return JSON.parse(JSON.stringify(this.state));
  }

  getRecentMessages(limit = 20): BlackboardMessage[] {
    return this.state.messages.slice(-limit).reverse();
  }

  getSwarmGoal(): BlackboardGoal | null {
    return this.state.swarmGoal;
  }

  claimReservation(type: BlackboardReservation['type'], key: string, botName: string, goalId?: string, ttlMs = 30000): boolean {
    this.clearExpiredReservations();
    const existing = this.state.reservations.find((r) => r.type === type && r.key === key && r.botName !== botName);
    if (existing) return false;
    const own = this.state.reservations.find((r) => r.type === type && r.key === key && r.botName === botName);
    if (own) {
      own.expiresAt = Date.now() + ttlMs;
      this.persist();
      return true;
    }
    this.state.reservations.push({
      id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      key,
      botName,
      goalId,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    });
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

  private scoreTask(task: BlackboardTask, query: string): number {
    let score = task.source === 'swarm' ? 12 : task.source === 'bot' ? 10 : 6;
    if (!query) return score;
    const text = `${task.description} ${task.keywords.join(' ')}`.toLowerCase();
    for (const word of query.split(/\s+/).filter(Boolean)) {
      if (text.includes(word)) score += 4;
    }
    return score;
  }

  private load(): BlackboardState {
    if (!fs.existsSync(this.filePath)) {
      return { swarmGoal: null, goals: [], tasks: [], messages: [], reservations: [] };
    }
    try {
      return { reservations: [], ...JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) };
    } catch {
      return { swarmGoal: null, goals: [], tasks: [], messages: [], reservations: [] };
    }
  }

  private clearExpiredReservations(): void {
    const now = Date.now();
    const before = this.state.reservations.length;
    this.state.reservations = this.state.reservations.filter((r) => !r.expiresAt || r.expiresAt > now);
    if (this.state.reservations.length !== before) this.persist();
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }
}
