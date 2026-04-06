import { BlackboardManager } from './BlackboardManager';
import { logger } from '../util/logger';

export interface SwarmTask {
  id: string;
  parentGoal: string;
  description: string;
  keywords: string[];
  assignedBot?: string;
  preferredRole?: string;
  location?: { x: number; y: number; z: number };
  dependsOn: string[];
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  priority: number;
  createdAt: number;
  completedAt?: number;
}

export interface SwarmPlan {
  id: string;
  goal: string;
  tasks: SwarmTask[];
  status: 'planning' | 'active' | 'completed' | 'failed';
  createdAt: number;
}

export interface BotCapability {
  name: string;
  personality: string;
  position: { x: number; y: number; z: number };
  currentTask?: string;
  idle: boolean;
  inventory: Record<string, number>;
}

const ROLE_KEYWORDS: Record<string, string[]> = {
  blacksmith: ['mine', 'dig', 'ore', 'smelt', 'craft weapon', 'craft armor', 'craft tool', 'iron', 'diamond', 'coal', 'stone', 'cobblestone'],
  farmer: ['farm', 'plant', 'harvest', 'seed', 'crop', 'wheat', 'carrot', 'potato', 'hoe', 'till', 'breed'],
  guard: ['defend', 'patrol', 'fight', 'attack', 'armor', 'weapon', 'sword', 'shield', 'protect', 'combat'],
  explorer: ['explore', 'scout', 'find', 'locate', 'search', 'travel', 'navigate', 'map'],
  merchant: ['trade', 'buy', 'sell', 'barter', 'villager', 'emerald', 'chest', 'store', 'supply'],
  elder: ['plan', 'coordinate', 'manage', 'organize', 'research', 'enchant', 'brew'],
};

const STALL_TIMEOUT_MS = 5 * 60 * 1000;

type DecompositionPattern = {
  match: RegExp;
  decompose: (goal: string, match: RegExpMatchArray, botCount: number) => Omit<SwarmTask, 'id' | 'parentGoal' | 'createdAt'>[];
};

function uid(): string {
  return `swt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function planUid(): string {
  return `swp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function inferRole(keywords: string[]): string | undefined {
  const text = keywords.join(' ').toLowerCase();
  let best: string | undefined;
  let bestScore = 0;
  for (const [role, roleKws] of Object.entries(ROLE_KEYWORDS)) {
    const score = roleKws.filter((k) => text.includes(k)).length;
    if (score > bestScore) {
      bestScore = score;
      best = role;
    }
  }
  return best;
}

function taskTemplate(
  desc: string,
  keywords: string[],
  deps: string[],
  priority: number,
  role?: string,
): Omit<SwarmTask, 'id' | 'parentGoal' | 'createdAt'> {
  return {
    description: desc,
    keywords,
    dependsOn: deps,
    priority,
    preferredRole: role ?? inferRole(keywords),
    status: 'pending',
  };
}

const DECOMPOSITION_PATTERNS: DecompositionPattern[] = [
  {
    match: /build\s+(?:a\s+)?house/i,
    decompose: (_goal, _m, _bc) => {
      const gatherWood = taskTemplate('Gather wood for building', ['mine', 'wood', 'oak', 'log'], [], 8, 'blacksmith');
      const gatherStone = taskTemplate('Gather stone for building', ['mine', 'stone', 'cobblestone'], [], 8, 'blacksmith');
      const clearSite = taskTemplate('Clear the building site', ['clear', 'dig', 'flatten'], [], 7, 'explorer');
      // walls depend on materials + site
      const buildWalls = taskTemplate('Build the walls', ['build', 'place', 'wall'], ['__gatherWood', '__gatherStone', '__clearSite'], 6, 'elder');
      const buildRoof = taskTemplate('Build the roof', ['build', 'place', 'roof', 'slab'], ['__buildWalls'], 5, 'elder');
      return [
        { ...gatherWood, description: gatherWood.description },
        { ...gatherStone, description: gatherStone.description },
        { ...clearSite, description: clearSite.description },
        { ...buildWalls, description: buildWalls.description },
        { ...buildRoof, description: buildRoof.description },
      ];
    },
  },
  {
    match: /mine\s+(\d+)\s+(?:of\s+)?(.+)/i,
    decompose: (_goal, m, botCount) => {
      const total = parseInt(m[1], 10);
      const item = m[2].trim();
      const perBot = Math.ceil(total / Math.max(botCount, 1));
      const tasks: Omit<SwarmTask, 'id' | 'parentGoal' | 'createdAt'>[] = [];
      let remaining = total;
      for (let i = 0; i < botCount && remaining > 0; i++) {
        const count = Math.min(perBot, remaining);
        tasks.push(taskTemplate(`Mine ${count} ${item}`, ['mine', item.toLowerCase()], [], 8, 'blacksmith'));
        remaining -= count;
      }
      return tasks;
    },
  },
  {
    match: /set\s*up\s+(?:a\s+)?farm/i,
    decompose: () => {
      const clearLand = taskTemplate('Clear land for the farm', ['clear', 'dig', 'farm'], [], 8, 'farmer');
      const craftHoe = taskTemplate('Craft a hoe', ['craft', 'hoe', 'tool'], [], 8, 'blacksmith');
      const plantSeeds = taskTemplate('Plant seeds', ['plant', 'seed', 'farm', 'wheat'], ['__clearLand', '__craftHoe'], 6, 'farmer');
      const buildFence = taskTemplate('Build a fence around the farm', ['build', 'fence', 'farm'], ['__clearLand'], 5, 'farmer');
      return [clearLand, craftHoe, plantSeeds, buildFence];
    },
  },
  {
    match: /establish\s+defenses/i,
    decompose: () => {
      const craftWeapons = taskTemplate('Craft weapons for defense', ['craft', 'weapon', 'sword'], [], 8, 'blacksmith');
      const craftArmor = taskTemplate('Craft armor for defense', ['craft', 'armor'], [], 8, 'blacksmith');
      const buildWalls = taskTemplate('Build defensive walls', ['build', 'wall', 'defense'], [], 7, 'elder');
      const setUpPatrol = taskTemplate('Set up patrol routes', ['patrol', 'defend', 'guard'], ['__buildWalls'], 6, 'guard');
      return [craftWeapons, craftArmor, buildWalls, setUpPatrol];
    },
  },
];

export class SwarmCoordinator {
  private plans: Map<string, SwarmPlan> = new Map();
  private blackboard: BlackboardManager;

  constructor(blackboard: BlackboardManager) {
    this.blackboard = blackboard;
  }

  decomposeGoal(goal: string, botCapabilities: BotCapability[]): SwarmPlan {
    const planId = planUid();
    logger.info({ goal, planId }, 'Decomposing swarm goal');

    let rawTasks: Omit<SwarmTask, 'id' | 'parentGoal' | 'createdAt'>[] | null = null;

    for (const pattern of DECOMPOSITION_PATTERNS) {
      const match = goal.match(pattern.match);
      if (match) {
        rawTasks = pattern.decompose(goal, match, botCapabilities.length);
        break;
      }
    }

    if (!rawTasks) {
      // Unknown goal: single task assigned to best-matching bot
      const keywords = goal.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      rawTasks = [taskTemplate(goal, keywords, [], 7)];
    }

    // Assign real IDs and resolve placeholder dependency references
    const now = Date.now();
    const idMap: Record<string, string> = {};
    const tasks: SwarmTask[] = rawTasks.map((t, idx) => {
      const id = uid();
      const placeholderKey = `__${t.description.split(' ').slice(0, 2).join('').replace(/[^a-zA-Z]/g, '')}`;
      // Build a lookup from placeholder-like keys to real IDs
      // We use index-based placeholders matching the pattern templates
      idMap[`__idx_${idx}`] = id;
      return {
        ...t,
        id,
        parentGoal: goal,
        createdAt: now,
        dependsOn: [], // resolved below
      };
    });

    // Resolve dependencies: pattern templates use placeholder dep strings like '__gatherWood'
    // We match them by description prefix
    const descToId: Record<string, string> = {};
    for (const task of tasks) {
      // Create lookup keys from the description (camelCase of first two words)
      const words = task.description.split(' ');
      const key = `__${words[0].toLowerCase()}${words.length > 1 ? words[1].charAt(0).toUpperCase() + words[1].slice(1) : ''}`;
      descToId[key] = task.id;
    }

    // Now go back to rawTasks to pick up original dependsOn placeholders
    for (let i = 0; i < rawTasks.length; i++) {
      tasks[i].dependsOn = rawTasks[i].dependsOn
        .map((dep) => descToId[dep])
        .filter((id): id is string => !!id);
    }

    const plan: SwarmPlan = {
      id: planId,
      goal,
      tasks,
      status: 'active',
      createdAt: now,
    };

    this.plans.set(planId, plan);
    this.assignTasks(plan, botCapabilities);
    logger.info({ planId, taskCount: tasks.length }, 'Swarm plan created');
    return plan;
  }

  assignTasks(plan: SwarmPlan, bots: BotCapability[]): void {
    const unassigned = plan.tasks.filter(
      (t) => t.status === 'pending' && !t.assignedBot && t.dependsOn.every((dep) => {
        const depTask = plan.tasks.find((d) => d.id === dep);
        return depTask && depTask.status === 'completed';
      }),
    );

    for (const task of unassigned) {
      let bestBot: BotCapability | null = null;
      let bestScore = -Infinity;

      for (const bot of bots) {
        let score = 0;

        // Role match
        if (task.preferredRole && bot.personality === task.preferredRole) {
          score += 5;
        }

        // Proximity
        if (task.location && bot.position) {
          const dx = bot.position.x - task.location.x;
          const dy = bot.position.y - task.location.y;
          const dz = bot.position.z - task.location.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          score += 3 * (1 / (1 + dist / 100));
        }

        // Idle bonus
        if (bot.idle) {
          score += 4;
        }

        // Inventory match
        const taskText = `${task.description} ${task.keywords.join(' ')}`.toLowerCase();
        for (const item of Object.keys(bot.inventory)) {
          if (taskText.includes(item.toLowerCase()) && bot.inventory[item] > 0) {
            score += 2;
            break;
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestBot = bot;
        }
      }

      if (bestBot) {
        task.assignedBot = bestBot.name;
        task.status = 'assigned';
        logger.info({ taskId: task.id, bot: bestBot.name, score: bestScore }, 'Task assigned');

        // Post to blackboard
        this.blackboard.postMessage(bestBot.name, 'info', `Swarm assigned: ${task.description}`);
        this.blackboard.addTask(
          { description: task.description, keywords: task.keywords },
          'swarm',
          plan.id,
        );
      }
    }
  }

  monitorProgress(plan: SwarmPlan): void {
    const now = Date.now();

    for (const task of plan.tasks) {
      // Check for stalls
      if (task.status === 'in_progress' && (now - task.createdAt) > STALL_TIMEOUT_MS) {
        logger.warn({ taskId: task.id, bot: task.assignedBot }, 'Task stalled, marking as failed');
        task.status = 'failed';
        // Attempt reassignment
        task.assignedBot = undefined;
        task.status = 'pending';
      }

      // If a task failed, check if we can reassign
      if (task.status === 'failed') {
        const allDepsOk = task.dependsOn.every((dep) => {
          const depTask = plan.tasks.find((d) => d.id === dep);
          return depTask && depTask.status === 'completed';
        });
        if (allDepsOk) {
          task.status = 'pending';
          task.assignedBot = undefined;
          logger.info({ taskId: task.id }, 'Failed task eligible for reassignment');
        }
      }
    }

    // Unblock tasks whose dependencies have completed
    for (const task of plan.tasks) {
      if (task.status === 'blocked' || (task.status === 'pending' && task.dependsOn.length > 0)) {
        const allDepsComplete = task.dependsOn.every((dep) => {
          const depTask = plan.tasks.find((d) => d.id === dep);
          return depTask && depTask.status === 'completed';
        });
        if (allDepsComplete && task.status === 'blocked') {
          task.status = 'pending';
          task.assignedBot = undefined;
          logger.info({ taskId: task.id }, 'Blocked task unblocked, dependencies complete');
        }
      }
    }

    // Check overall plan status
    const allCompleted = plan.tasks.every((t) => t.status === 'completed');
    const anyActive = plan.tasks.some((t) =>
      t.status === 'pending' || t.status === 'assigned' || t.status === 'in_progress',
    );

    if (allCompleted) {
      plan.status = 'completed';
      logger.info({ planId: plan.id }, 'Swarm plan completed');
    } else if (!anyActive && plan.tasks.some((t) => t.status === 'failed')) {
      plan.status = 'failed';
      logger.warn({ planId: plan.id }, 'Swarm plan failed - no recoverable tasks');
    }
  }

  handleBlocker(planId: string, taskId: string, blockerDescription: string): void {
    const plan = this.plans.get(planId);
    if (!plan) {
      logger.warn({ planId }, 'handleBlocker: plan not found');
      return;
    }

    const task = plan.tasks.find((t) => t.id === taskId);
    if (!task) {
      logger.warn({ planId, taskId }, 'handleBlocker: task not found');
      return;
    }

    logger.info({ planId, taskId, blocker: blockerDescription }, 'Handling blocker');
    task.status = 'blocked';

    // Post blocker to blackboard
    if (task.assignedBot) {
      this.blackboard.blockTask(task.description, task.assignedBot, blockerDescription);
    }

    // Option 1: Try to reassign to a different bot
    const originalBot = task.assignedBot;
    task.assignedBot = undefined;
    task.status = 'pending';

    // Option 2: Create a helper sub-task for the blocker
    const helperTask: SwarmTask = {
      id: uid(),
      parentGoal: task.parentGoal,
      description: `Resolve blocker: ${blockerDescription}`,
      keywords: blockerDescription.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
      dependsOn: [],
      status: 'pending',
      priority: task.priority + 1, // higher priority than blocked task
      createdAt: Date.now(),
      preferredRole: inferRole(blockerDescription.toLowerCase().split(/\s+/)),
    };

    // Make the original task depend on the helper
    task.dependsOn.push(helperTask.id);
    task.status = 'blocked';
    task.assignedBot = originalBot;
    plan.tasks.push(helperTask);

    // Post the helper task to the blackboard
    this.blackboard.addTask(
      { description: helperTask.description, keywords: helperTask.keywords },
      'swarm',
      planId,
    );

    logger.info({ planId, helperTaskId: helperTask.id, blockedTaskId: taskId }, 'Helper sub-task created for blocker');
  }

  getActivePlans(): SwarmPlan[] {
    return Array.from(this.plans.values()).filter((p) => p.status === 'active');
  }

  getPlan(planId: string): SwarmPlan | undefined {
    return this.plans.get(planId);
  }

  cancelPlan(planId: string): void {
    const plan = this.plans.get(planId);
    if (!plan) {
      logger.warn({ planId }, 'cancelPlan: plan not found');
      return;
    }

    plan.status = 'failed';
    for (const task of plan.tasks) {
      if (task.status !== 'completed') {
        task.status = 'failed';
        if (task.assignedBot) {
          this.blackboard.postMessage(task.assignedBot, 'info', `Task cancelled: ${task.description}`);
        }
        task.assignedBot = undefined;
      }
    }

    logger.info({ planId }, 'Swarm plan cancelled');
  }
}
