import fs from 'fs';
import path from 'path';
import { Task } from './CurriculumAgent';
import { LongTermGoal } from './LongTermGoal';
import type { TownRule } from '../town/RuleStore';

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
  /**
   * Optional structured task contract. When set, downstream consumers
   * (Voyager loop, future ChainCoordinator integration, dashboard) can
   * dispatch a specific action chain instead of relying on NL + keyword
   * matching. The shape is open (any JSON-serializable object); the
   * `kind` discriminator identifies the producer.
   *
   * Followup #61 (Phase 7-B): trade-route deliveries emit
   *   { kind: 'trade-route', sourceTownId, targetTownId, resource, amount,
   *     targetCapital }
   * so a future ChainCoordinator integration can build a real
   * gather→walk→deposit pipeline. Today the Voyager loop still treats
   * such a task as a normal NL task; the metadata is the forward-compat
   * contract.
   */
  metadata?: Record<string, unknown>;
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
  /**
   * Project Sid P2-A — resolver for the active standing rules of a bot's town.
   * Wired by BotManager the same way the bot-role resolver is (a closure that
   * walks towns/residents). When unset (tests, or governance disabled — the
   * BotManager closure returns [] when the flag is off) scoreTaskEnhanced
   * applies no rule boost, so scores match the pre-P2 behavior exactly.
   */
  private getActiveRulesForBot: ((botName: string) => TownRule[]) | null = null;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'blackboard.json');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.state = this.load();
  }

  /**
   * Inject the standing-rule resolver (Project Sid P2-A). Mirrors how the
   * bot-role lookup is wired in: BotManager owns the RuleStore + TownManager
   * and passes a per-bot closure. Gating lives in that closure (returns [] when
   * `config.governance.enabled` is false), so callers here never need the flag.
   */
  setActiveRulesForBotResolver(resolver: (botName: string) => TownRule[]): void {
    this.getActiveRulesForBot = resolver;
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

  addTask(
    task: Task,
    source: 'swarm' | 'goal' | 'bot',
    goalId?: string,
    priority: TaskPriority = 'normal',
    location?: { x: number; y: number; z: number },
    metadata?: Record<string, unknown>,
  ): BlackboardTask {
    const boardTask: BlackboardTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: task.description,
      keywords: task.keywords,
      status: 'pending',
      priority,
      source,
      goalId,
      location,
      metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.state.tasks.push(boardTask);
    this.persist();
    return boardTask;
  }

  claimBestTask(
    botName: string,
    query?: string,
    personality?: string,
    botPosition?: { x: number; y: number; z: number },
    role?: string,
  ): BlackboardTask | null {
    const candidates = this.state.tasks.filter((t) => t.status === 'pending');
    if (candidates.length === 0) return null;
    const lowered = query?.toLowerCase() || '';
    // SHOULD-FIX #2 — resolve the bot's active standing rules ONCE here rather
    // than inside the sort comparator. The wired resolver walks all
    // towns×residents uncached, so calling it O(N log N) times per claim is a
    // hot-path waste; the rule set is identical for every candidate task.
    // Flag-off / no-resolver still yields [] → no boost (identical scoring).
    let activeRules: TownRule[] = [];
    if (this.getActiveRulesForBot) {
      try { activeRules = this.getActiveRulesForBot(botName) ?? []; } catch { activeRules = []; }
    }
    const ranked = candidates.sort((a, b) =>
      this.scoreTaskEnhanced(b, lowered, personality, botPosition, role, activeRules) - this.scoreTaskEnhanced(a, lowered, personality, botPosition, role, activeRules)
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

  /**
   * Returns the live state object. Treat as read-only — callers must NOT
   * mutate the returned object or its nested arrays. The three current
   * consumers (HTTP API serializer, worker-thread IPC, BlackboardProxy) all
   * serialize the result for transport, so they don't need a defensive copy.
   * The previous JSON.parse(JSON.stringify(...)) deep clone allocated ~5MB of
   * transient garbage on every dashboard refresh when `state.tasks` grew to
   * thousands of entries.
   */
  getState(): Readonly<BlackboardState> { return this.state; }
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

  /**
   * Followup #41 — true when an open (pending or claimed) task exists with
   * the same description AND source. Used by ScheduleManager.emitForRole to
   * skip pushing a duplicate schedule task when the previous one is still
   * unclaimed/active, since unclaimed schedule tasks aren't aged out by
   * releaseStale and would otherwise pile up on the blackboard over many
   * in-game days.
   *
   * Matching on (description, source) keeps this scoped: a player-issued
   * task with the same wording but different source won't be deduped.
   */
  existsOpenWithDescription(description: string, source: BlackboardTask['source']): boolean {
    for (const task of this.state.tasks) {
      if (task.source !== source) continue;
      if (task.description !== description) continue;
      if (task.status !== 'pending' && task.status !== 'claimed') continue;
      return true;
    }
    return false;
  }

  /**
   * Followup #41 — remove schedule-source tasks (swarm-source tasks tagged
   * with both 'town' and a day/night phase keyword) that are still pending
   * and older than `maxAgeMs`. Schedule tasks are pushed every phase flip
   * (~10 in-game minutes apart); over many days the unclaimed ones leak the
   * blackboard without bound. The scope is intentionally narrow: we only
   * sweep swarm tasks with BOTH 'town' AND ('day' | 'night') keywords so
   * supply-chain and demand-loop tasks survive even when they share the
   * 'town' tag.
   *
   * Returns the number of removed tasks. Safe to call on every brain tick.
   */
  gcStaleScheduleTasks(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    const before = this.state.tasks.length;
    this.state.tasks = this.state.tasks.filter((task) => {
      if (task.source !== 'swarm') return true;
      if (task.status !== 'pending') return true;
      if (task.createdAt >= cutoff) return true;
      const kw = task.keywords ?? [];
      const hasTown = kw.includes('town');
      const hasPhase = kw.includes('day') || kw.includes('night');
      if (!hasTown || !hasPhase) return true;
      return false;
    });
    const removed = before - this.state.tasks.length;
    if (removed > 0) {
      this.postMessage('system', 'info', `GC removed ${removed} stale schedule task(s).`);
      this.persist();
    }
    return removed;
  }

  /**
   * GC tasks in terminal status (blocked/completed/failed) older than
   * `maxAgeMs`. Caps the surviving terminal-task set at `maxTerminalRetained`
   * (most-recent wins) so a sudden burst of failures doesn't outpace the age
   * cutoff. Pending/claimed tasks are never touched here — they belong to
   * `gcStaleScheduleTasks` / `releaseStale`. Returns the count removed.
   *
   * Without this GC the blackboard accumulated thousands of `blocked` rows
   * (4,327 observed on 2026-05-28) since `blockTask` only flips status and
   * nothing else evicts terminal entries. The pile bloats blackboard.json and
   * makes every `getState()` read deep-walk the array, so the GC also helps
   * lower per-read CPU.
   */
  gcTerminalTasks(maxAgeMs: number = 24 * 60 * 60 * 1000, maxTerminalRetained: number = 500): number {
    const cutoff = Date.now() - maxAgeMs;
    const isTerminal = (s: BlackboardTask['status']) =>
      s === 'blocked' || s === 'completed';
    const before = this.state.tasks.length;
    this.state.tasks = this.state.tasks.filter((task) => {
      if (!isTerminal(task.status)) return true;
      return (task.updatedAt ?? task.createdAt) >= cutoff;
    });
    // Even after the age cutoff, cap the terminal-task set so a recent burst
    // can't keep more than `maxTerminalRetained` in memory.
    const terminal = this.state.tasks.filter((t) => isTerminal(t.status));
    if (terminal.length > maxTerminalRetained) {
      terminal.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
      const keepIds = new Set(terminal.slice(0, maxTerminalRetained).map((t) => t.id));
      this.state.tasks = this.state.tasks.filter((t) => !isTerminal(t.status) || keepIds.has(t.id));
    }
    const removed = before - this.state.tasks.length;
    if (removed > 0) {
      // Skip the postMessage chain here — gcTerminalTasks can prune hundreds
      // of rows at once and posting a message per call would itself pollute
      // the messages array. Just persist quietly.
      this.persist();
    }
    return removed;
  }

  /**
   * Bound a recurring task family (e.g. a town's per-resource supply shortage)
   * to at most one in-flight row. Reaps every pending/blocked task matching
   * `matcher`, then reports whether a `claimed` (actively worked) row survives.
   *
   * The town demand loop re-evaluates shortages every tick and previously
   * called addTask() unconditionally, so a shortage that stayed unmet piled a
   * fresh duplicate on every tick — pending dups plus a growing wall of
   * `blocked` rows from failed attempts (553 supply rows / 433 blocked observed
   * 2026-06-30, all < 24h so gcTerminalTasks's age cutoff never reached them).
   * Bots then churned the stale heap instead of the current task. Calling this
   * before re-queueing keeps it to one fresh row per shortage. Returns whether
   * a claim is already active (so the caller skips re-queueing) and the count
   * removed.
   */
  reapShortageTasks(matcher: (t: BlackboardTask) => boolean): { claimedActive: boolean; removed: number } {
    const removeIds = new Set(
      this.state.tasks
        .filter((t) => matcher(t) && (t.status === 'pending' || t.status === 'blocked'))
        .map((t) => t.id),
    );
    if (removeIds.size > 0) {
      this.state.tasks = this.state.tasks.filter((t) => !removeIds.has(t.id));
      this.persist();
    }
    const claimedActive = this.state.tasks.some((t) => matcher(t) && t.status === 'claimed');
    return { claimedActive, removed: removeIds.size };
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

  private scoreTaskEnhanced(
    task: BlackboardTask,
    query: string,
    personality?: string,
    botPosition?: { x: number; y: number; z: number },
    role?: string,
    activeRules: TownRule[] = [],
  ): number {
    let score = this.scoreTask(task, query);
    const priorityBonus: Record<TaskPriority, number> = { low: 0, normal: 3, high: 9, critical: 15 };
    score += (priorityBonus[task.priority] ?? priorityBonus.normal) * 3;
    if (personality) {
      const words = PERSONALITY_KEYWORDS[personality.toLowerCase()] || [];
      const text = `${task.description} ${task.keywords.join(' ')}`.toLowerCase();
      for (const w of words) { if (text.includes(w)) score += 2; }
    }
    // Followup #40 — boost tasks tagged with the bot's town role.
    // ScheduleManager (and other town producers) tag tasks with role
    // keywords like 'lumberjack', 'farmer-role', etc.; without this boost
    // they were only matched against personality. Additive only: when role
    // is undefined behavior is identical to before.
    if (role && typeof role === 'string') {
      const r = role.toLowerCase();
      if (r && r !== 'idle') {
        const text = `${task.description} ${task.keywords.join(' ')}`.toLowerCase();
        // Substring match against the role name itself — ScheduleManager
        // tags with the raw role string (lumberjack, miner, farmer, ...).
        if (text.includes(r)) score += 3;
        // Also boost when any keyword is exactly the role.
        for (const kw of task.keywords) {
          if (typeof kw === 'string' && kw.toLowerCase() === r) {
            score += 3;
            break;
          }
        }
        // Town-prefix boost: tasks emitted by TownBrain demand/schedule
        // phases start with "town:<id>" in the description. For residents
        // we want these to dominate the ranking over curriculum-generated
        // tasks (Voyager mining/explore quests) that landed on the swarm
        // board via the same source='swarm' tag. +30 is enough to clear
        // the typical priority×3 + distance + query-match envelope so
        // residents always pull town work first when one's available.
        if (task.description.toLowerCase().startsWith('town:')) score += 30;
      }
    }
    // Project Sid P2-A — standing-rule bias. When governance is enabled the
    // caller passes the bot's town's active rules (an empty array when the
    // flag is off OR the bot isn't a resident OR no resolver is wired), so
    // this whole block is a no-op in the disabled case and scores match the
    // pre-P2 behavior. The rules are resolved ONCE in claimBestTask (SHOULD-FIX
    // #2) instead of per-comparison here. Each rule whose keywords match the
    // task adds a boost scaled by the rule's priority — a follow→amend→re-follow
    // nudge, not a hard override (kept below the town: +30 dominance).
    if (activeRules.length > 0) {
      {
        const text = `${task.description} ${task.keywords.join(' ')}`.toLowerCase();
        const taskKeywords = task.keywords.map((k) => (typeof k === 'string' ? k.toLowerCase() : ''));
        for (const rule of activeRules) {
          if (!rule.active || !Array.isArray(rule.keywords) || rule.keywords.length === 0) continue;
          // A rule matches when one of its keywords equals a task keyword or
          // appears as a WHOLE WORD in the task text. Word-boundary matching
          // avoids false positives where a short keyword is a substring of an
          // unrelated word (e.g. rule 'ore' matching 'explore', 'war'→'warden').
          const matched = rule.keywords.some((kw) => {
            if (!kw) return false;
            if (taskKeywords.includes(kw)) return true;
            const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${escaped}\\b`).test(text);
          });
          if (matched) {
            const weight = typeof rule.priority === 'number' && rule.priority > 0 ? rule.priority : 1;
            score += 8 * weight;
          }
        }
      }
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
