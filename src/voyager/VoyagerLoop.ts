import { Bot } from 'mineflayer';
import { LLMClient } from '../ai/LLMClient';
import { Config } from '../config';
import { isProtected, getNearestProtectedCenter } from '../actions/geofence';
import { SkillLibrary, SkillMatch } from './SkillLibrary';
import { CodeExecutor } from './CodeExecutor';
import { CurriculumAgent, Task } from './CurriculumAgent';
import { ActionAgent, GeneratedCode } from './ActionAgent';
import { CriticAgent, takeBotSnapshot } from './CriticAgent';
import { logger } from '../util/logger';
import { getProgressionState } from './Progression';
import { buildTaskPlan, PlannedStep, replanTaskStep } from './TaskPlanner';
import { StatsTracker } from './StatsTracker';
import { completeLongTermSubtask, goalSummary, LongTermGoal, longTermGoalToTask, makeLongTermGoal, popLongTermSubtask } from './LongTermGoal';
import { countBlueprintMaterials, generateSimpleHouseBlueprint, getMissingBlueprintPlacements, validateBlueprint } from './Blueprint';
import { placeBlock } from '../actions/placeBlock';
import { Vec3 } from 'vec3';
import { BlackboardManager, BlackboardTask } from './BlackboardManager';
import { SocialMemory } from '../social/SocialMemory';
import type { BotMessage } from '../social/BotComms';
import { DecisionTrace } from './DecisionTrace';
import { GoalGenerator, GoalGeneratorState, Goal } from './GoalGenerator';
import { ThreatAssessor, ThreatAssessment } from './ThreatAssessor';
import { OpportunityDetector, OpportunityScan } from './OpportunityDetector';
import { AgentState } from './AgentState';
import { decide as cognitiveDecide, CognitiveContext, Decision } from './CognitiveController';
import { DecisionNarrator } from './DecisionNarrator';
import { ProactiveCommunicator } from './ProactiveCommunicator';
import { ActionTemplateRegistry } from './ActionTemplates';
import { PlanLibrary } from './PlanLibrary';
import { SkillAttribution } from './SkillAttribution';
import { TradeNegotiator } from './TradeNegotiator';
import { analyzeFailure, RecoveryHint } from './ErrorRecovery';
import { DependencyResolver, FlatStep } from './DependencyResolver';
import { SharedWorldModel } from './SharedWorldModel';
import { formatRulesForPrompt, type TownRule } from '../town/RuleStore';
import { formatCultureForPrompt } from '../social/CultureManager';
import { analyzeSentiment } from '../ai/prompts/chat';

const AIR_BLOCKS: ReadonlySet<string> = new Set(['air', 'cave_air', 'void_air']);

/**
 * Minimal surface VoyagerLoop needs from AffinityManager (real or proxied via
 * AffinityProxy). Write methods are fire-and-forget; isHostile awaits an IPC
 * round-trip. The 2nd argument keys by arbitrary name string, so a peer bot
 * name works exactly like a player name — no affinity schema change (P3-A).
 */
export interface AffinityLike {
  onPositiveChat(botName: string, name: string): void;
  onNegativeSentiment(botName: string, name: string): void;
  isHostile(botName: string, name: string): boolean | Promise<boolean>;
  getAllForBot(botName: string): Record<string, number> | Promise<Record<string, number>>;
}

/**
 * Minimal surface VoyagerLoop needs from CultureManager (real or proxied via
 * CultureProxy). Reads await an IPC round-trip; writes are fire-and-forget. The
 * registry is authoritative in the main thread, so adoption/observation done in
 * one worker is visible to every other worker (P3-B). Only wired + consulted
 * when `config.social.culture` is true — null/no-op otherwise.
 */
export interface CultureLike {
  matchMeme(text: string): { id: string; label: string; keywords: string[]; strength: number } | null | Promise<{ id: string; label: string; keywords: string[]; strength: number } | null>;
  getAdoptedMemes(botName: string): Array<{ id: string; label: string; keywords: string[]; strength: number }> | Promise<Array<{ id: string; label: string; keywords: string[]; strength: number }>>;
  adopt(memeId: string, botName: string, townId?: string): void;
  observeChat(text: string): void;
  addMeme(label: string, keywords: string[], originBot?: string): void;
}

/**
 * Minimal surface VoyagerLoop needs from the inter-bot message layer (real
 * per-worker `BotComms` OR the cross-worker `BotCommsProxy`). Sends are
 * fire-and-forget; `getUnread` may await an IPC round-trip (the proxy) or
 * return synchronously (the local class), so it's typed as either. The relay is
 * AUTHORITATIVE in the main thread (SHOULD-FIX #1), so a broadcast issued here
 * lands in OTHER bots' worker inboxes and the drain sees cross-worker traffic.
 */
export interface BotCommsLike {
  getUnread(botName: string): BotMessage[] | Promise<BotMessage[]>;
  broadcast(from: string, content: string, type?: BotMessage['type']): void;
  sendMessage(from: string, to: string, content: string, type?: BotMessage['type']): void;
}

/** Minimal surface VoyagerLoop needs from DifficultyBalancer (real or proxied). */
export interface DifficultyBalancerLike {
  getBotBehaviorModifiers(): {
    taskCooldownMultiplier: number;
    preferredTaskTypes: string[];
    chatProbability: number;
    helpRadius: number;
  } | Promise<{
    taskCooldownMultiplier: number;
    preferredTaskTypes: string[];
    chatProbability: number;
    helpRadius: number;
  }>;
}

/** Minimal surface VoyagerLoop needs from PlayerIntentModel (real or proxied). */
export interface PlayerIntentModelLike {
  predictIntent(playerName: string): {
    intent: string;
    confidence: number;
    evidence: string[];
    suggestedBotResponse: string;
    suggestedTask?: string;
  } | Promise<{
    intent: string;
    confidence: number;
    evidence: string[];
    suggestedBotResponse: string;
    suggestedTask?: string;
  }>;
}

export class VoyagerLoop {
  private static MAX_RETRY_EVENT_LOG_CHARS = 1200;
  private static MAX_FAILURE_OUTPUT_CHARS = 1200;
  private bot: Bot;
  private personality: string;
  private botName: string;
  private config: Config;
  private skillLibrary: SkillLibrary;
  private codeExecutor: CodeExecutor;
  private curriculumAgent: CurriculumAgent;
  /** Home anchor when this bot is movement-leashed (config.leash), else null. */
  private leashHome: { x: number; z: number; radius: number } | null = null;
  /** Safe fallback teleport target for stranded-bot self-rescue (config.rescueHome). */
  private rescueHome: { x: number; y: number; z: number } | null = null;
  /** Rate-limits self-rescue attempts so an un-rescuable bot can't spam /tp. */
  private lastRescueAttemptAt = 0;
  /** True when a leashed `builder` bot should run the place-only caretaker
   *  curriculum (withdraw from a home chest → expand the home structure)
   *  instead of the roaming Voyager/DungeonMaster curriculum. */
  private isCaretakerBuilder = false;
  /** Rotating index over CARETAKER_BUILD_TASKS so the caretaker cycles through
   *  distinct expansion tasks instead of repeating one. */
  private caretakerBuildIndex = 0;
  private actionAgent: ActionAgent | null;
  private criticAgent: CriticAgent;
  private statsTracker: StatsTracker;
  private running = false;
  private paused = false;
  private loopTimeout: NodeJS.Timeout | null = null;
  private lastExecutionMetrics: {
    attempt: number;
    task: string;
    success: boolean;
    outputLength: number;
    eventCount: number;
    eventLogLength: number;
    codeLength: number;
    timestamp: number;
  } | null = null;
  private playerTaskQueue: Task[] = [];
  private activeLongTermGoal: LongTermGoal | null = null;
  private blackboardManager: BlackboardManager | null = null;
  private activeBlackboardTask: BlackboardTask | null = null;
  private socialMemory: SocialMemory | null = null;
  private botComms: BotCommsLike | null = null;
  private affinityManager: AffinityLike | null = null;
  private cultureManager: CultureLike | null = null;
  /** P3-B — meme ids this bot already adopted, to suppress re-adoption /
   *  re-broadcast loops (a meme message-storm) within a connection. */
  private adoptedMemeIds: Set<string> = new Set();
  private decisionTrace: DecisionTrace;
  private goalGenerator: GoalGenerator | null = null;
  private threatAssessor: ThreatAssessor | null = null;
  private opportunityDetector: OpportunityDetector | null = null;
  /**
   * P4-A — per-bot shared cognitive state. Always allocated (cheap, empty), but
   * only WRITTEN by the perception tick and READ by runOneCycle when
   * `config.cognition.perceptionTick` is enabled. With the flag off it stays
   * empty and is never consulted (inline path unchanged).
   */
  private agentState: AgentState = new AgentState();
  /**
   * P4-A — max age (ms) a cached perception value may have and still be used by
   * runOneCycle. Older than this ⇒ fall back to inline compute. Sized a few
   * cycles wide of the ~750ms perception interval so a slightly-late tick is
   * still usable, but a wedged/stopped tick forces a fresh inline assessment.
   */
  private static readonly PERCEPTION_MAX_AGE_MS = 3000;
  /**
   * P4-B — the most recent structured Decision emitted by the Cognitive
   * Controller this cycle. Only WRITTEN when
   * `config.cognition.cognitiveController` is enabled; null otherwise. The
   * `conditioningForTalk` field is broadcast to the talk modules (handleChat /
   * ProactiveCommunicator) via getTalkConditioning() so speech is conditioned
   * on the same decision the loop is acting on. With the flag OFF this stays
   * null and getTalkConditioning() returns undefined ⇒ talk falls back to
   * getInternalState() exactly as today.
   */
  private lastDecision: Decision | null = null;
  private decisionNarrator: DecisionNarrator | null = null;
  private proactiveCommunicator: ProactiveCommunicator | null = null;
  private actionTemplates: ActionTemplateRegistry | null = null;
  private planLibrary: PlanLibrary | null = null;
  private skillAttribution: SkillAttribution | null = null;
  private tradeNegotiator: TradeNegotiator | null = null;
  private reputationNotify: ((event: any) => void) | null = null;
  private dependencyResolver: DependencyResolver | null = null;
  private sharedWorldModel: SharedWorldModel | null = null;
  private lastSharedWorldUpdateAt = 0;
  private difficultyBalancer: DifficultyBalancerLike | null = null;
  private playerIntentModel: PlayerIntentModelLike | null = null;
  /** Multiplier applied to taskCooldownMs by DifficultyBalancer. 1.0 = neutral. */
  private taskCooldownMultiplier = 1.0;
  /** Probability gate for proactive chat announcements. 1.0 = always (default). */
  private chatProbability = 1.0;

  // Exposed state for chat context
  private currentTask: string | null = null;
  private lastCompletedTask: string | null = null;
  private lastFailedTask: string | null = null;
  /** Timestamp of last acknowledgment chat; rate-limits to 1 per 10s per bot. */
  private lastAckAt = 0;
  /** Retry attempts per recent task description. Bounded to the last 20 tasks. */
  private retryHistory: Map<string, { attempt: number; error: string; timestamp: number }[]> = new Map();
  private static readonly RETRY_HISTORY_MAX_TASKS = 20;

  private static readonly ACK_TEMPLATES: Record<string, string> = {
    merchant: 'On it, [player].',
    guard: 'Acknowledged.',
    farmer: "I'll get right on it!",
    elder: 'Hmm, I shall attend to this.',
    explorer: 'Off I go!',
    blacksmith: 'Steel be true.',
  };
  private static readonly ACK_DEFAULT = 'Working on it.';
  private static readonly ACK_RATE_LIMIT_MS = 10_000;

  constructor(
    bot: Bot,
    botName: string,
    personality: string,
    config: Config,
    llmClient: LLMClient | null
  ) {
    this.bot = bot;
    this.botName = botName;
    this.personality = personality;
    this.config = config;

    this.skillLibrary = new SkillLibrary(config.skills.directory, config.skills.maxSkills, llmClient);
    this.codeExecutor = new CodeExecutor(config.voyager.codeExecutionTimeoutMs);

    this.rescueHome = config.rescueHome ?? null;

    // Movement leash: if config.leash names this bot, pin it to a home anchor +
    // radius so generated code can't walk it off its island (enforced in
    // CodeExecutor.moveTo/exploreUntil). No entry → unleashed (default).
    const leashEntry = config.leash?.find(
      (l) => l.botName.toLowerCase() === botName.toLowerCase(),
    );
    if (leashEntry) {
      this.leashHome = { x: leashEntry.x, z: leashEntry.z, radius: leashEntry.radius };
      this.codeExecutor.setLeash({ x: leashEntry.x, z: leashEntry.z, radius: leashEntry.radius });
      // A leashed `builder` becomes a HQ caretaker: it must not chase roaming
      // swarm/DungeonMaster explore tasks (the leash would just reject the move
      // and it thrashes). Instead it withdraws materials from a home chest and
      // place-only expands the structure it's parked on. See proposeCaretakerTask.
      this.isCaretakerBuilder = personality.toLowerCase() === 'builder';
      logger.info(
        {
          bot: botName,
          home: { x: leashEntry.x, z: leashEntry.z },
          radius: leashEntry.radius,
          caretaker: this.isCaretakerBuilder,
        },
        'VoyagerLoop: bot is leashed to a home boundary',
      );
    }

    this.curriculumAgent = new CurriculumAgent(
      llmClient,
      config.voyager.curriculumLLMCalls,
      './data'
    );

    this.actionAgent = llmClient
      ? new ActionAgent(llmClient, config.llm.codeGenMaxTokens)
      : null;

    this.criticAgent = new CriticAgent(
      llmClient,
      config.voyager.criticLLMCalls
    );
    this.statsTracker = new StatsTracker('./data');
    this.decisionTrace = new DecisionTrace(botName);

    try {
      this.dependencyResolver = new DependencyResolver(config.minecraft.version);
    } catch (err: any) {
      logger.warn({ err: err.message }, 'DependencyResolver init failed, prerequisite resolution disabled');
    }
  }

  /**
   * Placeable building/decoration materials the caretaker withdraws + places.
   * Used both to detect "am I out of supplies?" and to hint the withdraw task.
   */
  private static readonly CARETAKER_MATERIAL_HINTS = [
    'planks', 'log', 'stripped_', 'stone_bricks', 'bricks', 'cobblestone',
    'stone', 'deepslate', 'sandstone', 'quartz', 'glass', 'glass_pane',
    'stairs', 'slab', 'fence', 'wall', 'door', 'trapdoor', 'terracotta',
    'concrete', 'wool', 'torch', 'lantern', 'ladder', 'chest', 'barrel',
    'copper', 'polished_', 'chiseled_', 'tuff', 'calcite', 'prismarine',
  ];

  /**
   * Place-only expansion tasks the caretaker rotates through. Each is phrased
   * for the codegen ActionAgent: it uses placeBlock(...) with blocks already in
   * the bot's inventory, anchored at the home structure. Every entry repeats the
   * hard rule — NEVER mine/break existing blocks — so the caretaker only ever
   * adds to the user's build, never damages it.
   */
  private static readonly CARETAKER_BUILD_TASKS: Array<{ description: string; keywords: string[] }> = [
    { description: 'Extend an outer wall of your home base outward by a few blocks, placing building blocks from your inventory to grow the footprint. PLACE ONLY — never mine or break any existing block.', keywords: ['build', 'place', 'wall', 'expand'] },
    { description: 'Raise the walls of your home base one layer taller by stacking building blocks from your inventory on top of the existing walls. PLACE ONLY — never mine or break any existing block.', keywords: ['build', 'place', 'wall', 'height'] },
    { description: 'Add a new room next to your home base: lay out a floor and four short walls from blocks in your inventory, leaving a doorway. PLACE ONLY — never mine or break any existing block.', keywords: ['build', 'place', 'room', 'expand'] },
    { description: 'Build a flat roof or ceiling over an open part of your home base using slabs or planks from your inventory. PLACE ONLY — never mine or break any existing block.', keywords: ['build', 'place', 'roof'] },
    { description: 'Add a second floor above your home base: place a floor layer, then a short wall ring around it, from blocks in your inventory. PLACE ONLY — never mine or break any existing block.', keywords: ['build', 'place', 'floor', 'expand'] },
    { description: 'Light up and finish your home base: place torches or lanterns and fill any gaps in the walls with blocks from your inventory. PLACE ONLY — never mine or break any existing block.', keywords: ['build', 'place', 'torch', 'light'] },
  ];

  /**
   * Caretaker curriculum for a leashed builder. If the bot is low on placeable
   * materials it goes to the nearest chest to restock; otherwise it runs the
   * next place-only home-expansion task. Never proposes mining/exploration, so
   * a leashed builder can never wander off or dig up the user's build.
   */
  private proposeCaretakerTask(): Task {
    const home = this.leashHome;
    const items = (() => {
      try { return this.bot.inventory.items(); } catch { return []; }
    })();
    const isMaterial = (name: string) =>
      VoyagerLoop.CARETAKER_MATERIAL_HINTS.some((h) => name.includes(h));
    const materialCount = items
      .filter((i) => isMaterial(i.name))
      .reduce((sum, i) => sum + i.count, 0);

    // Out of supplies → restock from the home chest before building.
    if (materialCount < 16) {
      const anchor = home ? ` near (${home.x}, ${home.z})` : '';
      return {
        description: `Go to the nearest chest${anchor} and withdraw full stacks of building materials (planks, stone bricks, logs, glass, stairs, slabs, torches). Use inspectContainer('chest') to see what's inside, then withdrawItem('chest', <block>, 64) for several block types. Do not break anything.`,
        keywords: ['withdraw', 'chest', 'container', 'restock', 'build'],
      };
    }

    // Have materials → run the next place-only expansion task.
    const idx = this.caretakerBuildIndex % VoyagerLoop.CARETAKER_BUILD_TASKS.length;
    this.caretakerBuildIndex = (this.caretakerBuildIndex + 1) % VoyagerLoop.CARETAKER_BUILD_TASKS.length;
    const base = VoyagerLoop.CARETAKER_BUILD_TASKS[idx];
    const anchor = home ? ` Your home base is centered near (${home.x}, ${home.z}); build within ${home.radius} blocks of it.` : '';
    return { description: base.description + anchor, keywords: base.keywords };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info({ bot: this.botName }, 'Voyager loop started');
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.loopTimeout) {
      clearTimeout(this.loopTimeout);
      this.loopTimeout = null;
    }
    logger.info({ bot: this.botName }, 'Voyager loop stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  pause(reason = 'paused'): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    if (this.loopTimeout) {
      clearTimeout(this.loopTimeout);
      this.loopTimeout = null;
    }
    this.codeExecutor.requestInterrupt(reason);
    logger.warn({ bot: this.botName, reason, task: this.currentTask }, 'Voyager loop paused');
  }

  resume(reason = 'resumed'): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    logger.info({ bot: this.botName, reason }, 'Voyager loop resumed');
    this.scheduleNext();
  }

  isPaused(): boolean {
    return this.paused;
  }

  getDecisionTrace(): DecisionTrace {
    return this.decisionTrace;
  }

  /** P4-A — the per-bot AgentState cache (written by the perception tick). */
  getAgentState(): AgentState {
    return this.agentState;
  }

  /**
   * P4-A — always-on perception tick.
   *
   * Runs the synchronous threat/opportunity/survival-goal assessors and writes
   * their results into the AgentState cache. Driven by BotInstance's
   * independent `perceptionInterval` ONLY when `config.cognition.perceptionTick`
   * is enabled — it decouples fast perception from the slow sequential loop
   * (which is blocked during task execution). The work mirrors EXACTLY what
   * runOneCycle computes inline (same assessor calls, same survival-override
   * selection rule) so a cache read is interchangeable with an inline compute.
   *
   * Self-guarded and fully try/caught: a tick failure leaves the previous
   * cached values in place and never throws into the caller's timer.
   */
  runPerceptionTick(): void {
    if (!this.config.cognition?.perceptionTick) return;
    if (!this.bot || !this.bot.entity) return;

    const now = Date.now();

    let threatAssessment: ThreatAssessment | null = null;
    if (this.threatAssessor) {
      try {
        threatAssessment = this.threatAssessor.assess(this.bot);
        this.agentState.setThreat(threatAssessment, now);
      } catch { /* keep prior cached threat */ }
    }

    if (this.opportunityDetector) {
      try {
        const scan = this.opportunityDetector.scan(this.bot);
        this.agentState.setOpportunities(scan, now);
      } catch { /* keep prior cached opportunities */ }
    }

    if (this.goalGenerator) {
      try {
        const top = this.computeSurvivalGoal(threatAssessment);
        this.agentState.setSurvivalGoal(top, now);
      } catch { /* keep prior cached survival goal */ }
    }
  }

  /**
   * P4-A — compute the single survival/safety override goal, or null. Factored
   * out of runOneCycle so the inline path and the perception tick produce the
   * IDENTICAL result. The caller passes the threat assessment already in hand
   * (inline scan or cached) so the nearbyHostiles inputs match.
   *
   * Returns the top goal only when it is a survival|safety priority with
   * urgency >= 7 (the existing override gate); otherwise null.
   */
  private computeSurvivalGoal(threatAssessment: ThreatAssessment | null): Goal | null {
    if (!this.goalGenerator || this.playerTaskQueue.length !== 0) return null;
    const goals = this.goalGenerator.generateGoals({
      health: this.bot.health,
      food: this.bot.food,
      oxygen: this.getOxygenLevel(),
      inventory: Object.fromEntries(this.bot.inventory.items().map((i) => [i.name, i.count])),
      equipment: {},
      nearbyHostiles: {
        count: threatAssessment?.threats.filter((t) => t.type === 'hostile_mob').length ?? 0,
        closestDistance: threatAssessment?.threats.filter((t) => t.type === 'hostile_mob').reduce((min, t) => Math.min(min, t.distance), Infinity) ?? Infinity,
      },
      timeOfDay: this.bot.time?.timeOfDay ?? 0,
      isRaining: this.bot.isRaining ?? false,
      // A bot standing inside a protected town zone (near our builds) is
      // effectively sheltered — don't make it abandon work every night to
      // rebuild a redundant hut in the middle of town. Bots out in the
      // wilderness still get the shelter goal.
      hasShelter: (() => {
        const p = this.bot?.entity?.position;
        return p ? isProtected(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) : false;
      })(),
      // Where to send the bot at night instead of building a hut (nearest town).
      shelterTarget: (() => {
        const p = this.bot?.entity?.position;
        return p ? getNearestProtectedCenter(Math.floor(p.x), Math.floor(p.z)) : null;
      })(),
      playerTasks: this.playerTaskQueue.map((t) => t.description),
      blackboardTasks: [],
      completedTaskCount: this.curriculumAgent.getCompletedTasks().length,
      personality: this.personality,
    });
    const top = goals[0];
    if (top && (top.priority === 'survival' || top.priority === 'safety') && top.urgency >= 7) {
      return top;
    }
    return null;
  }

  /**
   * P4-B — assemble the bottlenecked CognitiveContext from the ladder signals
   * the loop has already computed this cycle. This is ONLY called when
   * `config.cognition.cognitiveController` is on, and feeds the pure
   * `decide()`. Defaults make it safe to call from the early-return branches
   * (build/resident-idle) that don't have every downstream signal in hand.
   */
  private buildCognitiveContext(args: {
    buildGoalActive?: boolean;
    buildGoalDescription?: string | null;
    survivalGoal?: Goal | null;
    playerIntent?: { player: string; intent: string; confidence: number; suggestedTask: string } | null;
    longTermGoalTask?: string | null;
    playerTask?: string | null;
    blackboardTask?: string | null;
    isResident?: boolean;
    threatAssessment?: ThreatAssessment | null;
  }): CognitiveContext {
    return {
      instinctPaused: this.paused,
      instinctReason: null,
      buildGoalActive: args.buildGoalActive ?? false,
      buildGoalDescription: args.buildGoalDescription ?? null,
      survivalGoal: args.survivalGoal ?? null,
      playerIntent: args.playerIntent ?? null,
      longTermGoalTask: args.longTermGoalTask ?? null,
      playerTask: args.playerTask ?? null,
      blackboardTask: args.blackboardTask ?? null,
      isResident: args.isResident ?? false,
      topThreat: args.threatAssessment ?? null,
      topOpportunity: null,
    };
  }

  setGoalGenerator(g: GoalGenerator): void { this.goalGenerator = g; }
  setThreatAssessor(t: ThreatAssessor): void { this.threatAssessor = t; }
  setOpportunityDetector(o: OpportunityDetector): void { this.opportunityDetector = o; }
  setDecisionNarrator(n: DecisionNarrator): void { this.decisionNarrator = n; }
  setProactiveCommunicator(p: ProactiveCommunicator): void { this.proactiveCommunicator = p; }
  setActionTemplates(t: ActionTemplateRegistry): void { this.actionTemplates = t; }
  setPlanLibrary(p: PlanLibrary): void { this.planLibrary = p; }
  setSkillAttribution(s: SkillAttribution): void { this.skillAttribution = s; }
  setTradeNegotiator(t: TradeNegotiator): void { this.tradeNegotiator = t; }
  setDifficultyBalancer(d: DifficultyBalancerLike): void { this.difficultyBalancer = d; }
  setPlayerIntentModel(p: PlayerIntentModelLike): void { this.playerIntentModel = p; }
  /** Set a callback for recording reputation events to the main thread. */
  setReputationNotifier(fn: (event: any) => void): void { this.reputationNotify = fn; }

  /** Get the current task description, or null if idle */
  getCurrentTask(): string | null {
    return this.currentTask;
  }

  /** Get list of completed task descriptions (proxied from CurriculumAgent) */
  getCompletedTasks(): string[] {
    return this.curriculumAgent.getCompletedTasks();
  }

  /** Get list of failed task descriptions (proxied from CurriculumAgent) */
  getFailedTasks(): string[] {
    return this.curriculumAgent.getFailedTasks();
  }

  getQueuedTasks(): string[] {
    return this.playerTaskQueue.map((task) => task.description);
  }

  getLongTermGoal() {
    if (!this.activeLongTermGoal) return null;
    return {
      id: this.activeLongTermGoal.id,
      requestedBy: this.activeLongTermGoal.requestedBy,
      rawRequest: this.activeLongTermGoal.rawRequest,
      kind: this.activeLongTermGoal.spec.kind,
      status: this.activeLongTermGoal.status,
      buildState: this.activeLongTermGoal.buildState ?? null,
      materialRequirements: this.activeLongTermGoal.materialRequirements ?? null,
      pendingSubtasks: this.activeLongTermGoal.pendingSubtasks.map((task) => task.description),
      completedSubtasks: [...this.activeLongTermGoal.completedSubtasks],
      updatedAt: this.activeLongTermGoal.updatedAt,
    };
  }

  getLastExecutionMetrics() {
    return this.lastExecutionMetrics;
  }

  /** Get the skill library instance */
  getSkillLibrary(): SkillLibrary {
    return this.skillLibrary;
  }

  setBlackboardManager(manager: BlackboardManager): void {
    this.blackboardManager = manager;
  }

  setSharedWorldModel(model: SharedWorldModel): void {
    this.sharedWorldModel = model;
  }

  getBlackboardManager(): BlackboardManager | null {
    return this.blackboardManager;
  }

  setSocialMemory(memory: SocialMemory): void {
    this.socialMemory = memory;
  }

  setBotComms(comms: BotCommsLike): void {
    this.botComms = comms;
  }

  /**
   * Wire the affinity manager (proxy in worker threads) so the brain-tick
   * message drain can write bot→peer affinity edges (P3-A). Only consulted
   * when `config.social.botAffinity` is true.
   */
  setAffinityManager(affinity: AffinityLike): void {
    this.affinityManager = affinity;
  }

  /**
   * Wire the cultural-meme registry (proxy in worker threads) so the brain-tick
   * message drain can adopt memes from trusted peers and the task-proposal
   * prompt can be biased by adopted memes (P3-B). Only consulted when
   * `config.social.culture` is true; the worker only wires it when the flag is
   * on, so it stays null (a no-op) otherwise.
   */
  setCultureManager(culture: CultureLike): void {
    this.cultureManager = culture;
  }

  /** Exposed for the ambient-chat hook (P3-B): this bot's adopted-meme labels,
   *  strongest first, or [] when culture is off / nothing adopted. */
  async getAdoptedMemeLabels(limit = 3): Promise<string[]> {
    if (!this.config.social?.culture || !this.cultureManager) return [];
    try {
      const memes = await this.cultureManager.getAdoptedMemes(this.botName);
      return memes
        .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))
        .slice(0, Math.max(0, limit))
        .map((m) => m.label);
    } catch {
      return [];
    }
  }

  /** Returns a short summary of what the bot is currently doing, for chat context. */
  getInternalState(): string {
    const parts: string[] = [];
    if (this.currentTask) {
      parts.push(`Currently working on: ${this.currentTask}`);
    } else {
      parts.push('Idle, waiting for next task');
    }
    if (this.lastCompletedTask) {
      parts.push(`Just finished: ${this.lastCompletedTask}`);
    }
    if (this.lastFailedTask) {
      parts.push(`Recently failed: ${this.lastFailedTask}`);
    }
    if (this.playerTaskQueue.length > 0) {
      parts.push(`Queued tasks: ${this.playerTaskQueue.map(t => t.description).join(', ')}`);
    }
    if (this.activeLongTermGoal) {
      parts.push(`Long-term goal: ${goalSummary(this.activeLongTermGoal)}`);
    }
    return parts.join('. ');
  }

  /**
   * P4-B — the most recent Cognitive Controller decision (or null when the
   * controller is disabled / hasn't run yet). Read by the dashboard / A-B
   * tooling; behavior selection does NOT depend on this getter.
   */
  getLastDecision(): Decision | null {
    return this.lastDecision;
  }

  /**
   * P4-B — decision broadcast for the talk modules.
   *
   * When `config.cognition.cognitiveController` is ON, returns the current
   * decision's `conditioningForTalk` string so chat + proactive speech are
   * conditioned on the SAME decision the loop is acting on (no "say one thing,
   * do another"). Falls back to `getInternalState()` if no decision has been
   * emitted yet this connection.
   *
   * When the flag is OFF, returns `undefined` — callers then use
   * `getInternalState()` exactly as before, so prompts are byte-identical.
   */
  getTalkConditioning(): string | undefined {
    if (!this.config.cognition?.cognitiveController) return undefined;
    return this.lastDecision?.conditioningForTalk ?? this.getInternalState();
  }

  queueLongTermGoal(description: string, requestedBy: string): void {
    this.decomposeAndSetLongTermGoal(description, requestedBy).catch((err) => {
      logger.warn({ err: err.message, goal: description }, 'Long-term goal decomposition failed, falling back to task queue');
      this.queuePlayerTask(description, requestedBy);
    });
  }

  async queueSwarmGoal(description: string, requestedBy: string): Promise<void> {
    const subtasks = await this.curriculumAgent.decomposeTask(this.bot, description);
    this.blackboardManager?.setSwarmGoal(description, requestedBy, subtasks);
    logger.info({ bot: this.botName, goal: description, requestedBy, subtasks: subtasks.map((t) => t.description) }, 'Swarm goal set');
  }

  overrideWithSwarmDirective(description: string, requestedBy: string): void {
    this.activeLongTermGoal = null;
    this.playerTaskQueue = [];
    this.activeBlackboardTask = null;
    this.codeExecutor.requestInterrupt(`swarm override: ${description}`);
    this.blackboardManager?.postMessage(this.botName, 'info', `Yielding to swarm directive from ${requestedBy}: ${description}`);
    logger.info({ bot: this.botName, goal: description, requestedBy }, 'Local directives cleared for swarm override');
  }

  queuePlayerTask(description: string, requestedBy: string): void {
    // Followup #70 — push the raw task to the queue *synchronously* so the
    // priority chain (goalOverrideTask > goalTask > playerTask > blackboardTask
    // > curriculumAgent.proposeTask) sees it on the very next tick. The previous
    // implementation fire-and-forgot the LLM decomposition before pushing, so
    // a slow/failing LLM left `playerTaskQueue` empty for tens of seconds while
    // the curriculum kept re-proposing its own work, starving player requests.
    // The raw task carries a stable identity (the object reference itself) we
    // match on later when decomposition completes and (optionally) refines the
    // entry into subtasks.
    const keywords = description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const rawTask: Task = { description, keywords, requestedBy };
    this.playerTaskQueue.push(rawTask);
    logger.info(
      { bot: this.botName, task: description, requestedBy, queueLen: this.playerTaskQueue.length },
      'Player task queued (raw, awaiting optional decomposition)'
    );

    // Asynchronously try to decompose into subtasks. If decomposition yields
    // >1 step *and* the raw task is still in the queue (not yet shifted into
    // execution), replace it in-place with the ordered subtasks.
    this.decomposeAndRefine(rawTask, requestedBy).catch((err) => {
      logger.warn({ err: err.message, task: description }, 'Decompose-refine failed; raw task remains queued');
    });
  }

  queuePlayerTaskFront(description: string, requestedBy: string): void {
    const keywords = description.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2);
    this.playerTaskQueue.unshift({ description, keywords, requestedBy });
    logger.info({ bot: this.botName, task: description, requestedBy }, 'Player task prepended to front of queue');
  }

  reorderQueue(orderedDescriptions: string[]): void {
    const byDesc = new Map(this.playerTaskQueue.map((t) => [t.description, t]));
    const orderedSet = new Set(orderedDescriptions);
    const reordered = orderedDescriptions.map((d) => byDesc.get(d)).filter(Boolean) as typeof this.playerTaskQueue;
    const remaining = this.playerTaskQueue.filter((t) => !orderedSet.has(t.description));
    this.playerTaskQueue.length = 0;
    this.playerTaskQueue.push(...reordered, ...remaining);
    logger.info({ bot: this.botName, count: reordered.length }, 'Player task queue reordered');
  }

  clearQueue(): void {
    const count = this.playerTaskQueue.length;
    this.playerTaskQueue.length = 0;
    logger.info({ bot: this.botName, cleared: count }, 'Player task queue cleared');
  }

  /**
   * Async refinement step paired with the synchronous push in `queuePlayerTask`.
   * Attempts LLM-driven decomposition; if it produces more than one ordered
   * subtask AND the original raw task is still pending in the queue (i.e. it
   * hasn't been shifted into execution yet), replaces that single entry in
   * place with the subtasks. The raw task's queue position is preserved so
   * batched POSTs stay in order. If the raw task is gone (already executing,
   * cleared by swarm override, or shifted on a tick), the refinement is a
   * no-op — the bot is already working on something derived from it.
   */
  private async decomposeAndRefine(rawTask: Task, requestedBy: string): Promise<void> {
    const subtasks = await this.curriculumAgent.decomposeTask(this.bot, rawTask.description);
    this.blackboardManager?.postMessage(this.botName, 'info', `Queued local task: ${rawTask.description}`);

    if (subtasks.length <= 1) {
      // Nothing useful to refine; the raw task already represents this step.
      return;
    }

    const index = this.playerTaskQueue.indexOf(rawTask);
    if (index === -1) {
      logger.info(
        { bot: this.botName, goal: rawTask.description, subtasks: subtasks.map((t) => t.description) },
        'Decomposition completed but raw task already left queue; skipping refine'
      );
      return;
    }

    const replacements = subtasks.map((task) => ({ ...task, requestedBy }));
    this.playerTaskQueue.splice(index, 1, ...replacements);
    logger.info({
      bot: this.botName,
      goal: rawTask.description,
      requestedBy,
      subtasks: subtasks.map((t) => t.description),
    }, 'Player goal decomposed and refined in place');
  }

  private async decomposeAndSetLongTermGoal(description: string, requestedBy: string): Promise<void> {
    const goal = makeLongTermGoal(description, requestedBy, []);
    if (goal.spec.kind === 'build_structure') {
      goal.buildState = 'blueprint_pending';
      const blueprint = generateSimpleHouseBlueprint(this.bot, description, this.curriculumAgent.getWorldMemory());
      const validation = validateBlueprint(this.bot, blueprint);
      if (!validation.valid) {
        throw new Error(`Generated blueprint invalid: ${validation.errors.join('; ')}`);
      }
      goal.blueprint = blueprint;
      goal.materialRequirements = countBlueprintMaterials(blueprint);
      goal.origin = this.findGroundedBuildOrigin();
      goal.buildState = 'blueprint_ready';
      this.activeLongTermGoal = goal;
      this.blackboardManager?.setBotGoal(this.botName, goal);
      logger.info({
        bot: this.botName,
        goal: description,
        requestedBy,
        blueprint: blueprint.name,
        materialRequirements: goal.materialRequirements,
        origin: goal.origin,
      }, 'Long-term build goal set');
      return;
    }

    const subtasks = await this.curriculumAgent.decomposeTask(this.bot, description);
    goal.pendingSubtasks = subtasks;
    this.activeLongTermGoal = goal;
    this.blackboardManager?.setBotGoal(this.botName, goal);
    logger.info({
      bot: this.botName,
      goal: description,
      requestedBy,
      subtasks: subtasks.map((t) => t.description),
    }, 'Long-term goal set');
  }

  private scheduleNext(): void {
    if (!this.running || this.paused) return;

    this.loopTimeout = setTimeout(async () => {
      if (!this.running || this.paused) return;

      try {
        await this.runOneCycle();
      } catch (err: any) {
        logger.error({ bot: this.botName, err: err.message }, 'Voyager cycle error');
      }

      this.scheduleNext();
    }, Math.max(50, Math.round(this.config.voyager.taskCooldownMs * this.taskCooldownMultiplier)));
  }

  /**
   * When a bot is both stuck (its task is on the failure cooldown) and physically
   * stranded (standing in liquid), teleport it back to a safe home so it can make
   * progress again. Bots are server-op, so a bot can /tp itself — but op is granted
   * externally (ops.json) and NOT guaranteed, so we VERIFY the teleport by re-reading
   * position. If the bot didn't move, it isn't op (or /tp was rejected): we emit a
   * loud, greppable WARN with the exact manual command instead of looping silently —
   * i.e. we only bother a human when self-rescue genuinely can't work. Rate-limited.
   */
  private async tryRescueIfStranded(task: Task): Promise<void> {
    const RESCUE_COOLDOWN_MS = 10 * 60 * 1000;
    if (Date.now() - this.lastRescueAttemptAt < RESCUE_COOLDOWN_MS) return;

    const pos = this.bot.entity?.position;
    if (!pos) return;

    // Physical stranding signal: feet block is liquid, or mineflayer flags in-water.
    let inLiquid = false;
    try {
      const feet = this.bot.blockAt(pos);
      inLiquid = (!!feet && (feet.name === 'water' || feet.name === 'lava'))
        || (this.bot.entity as any)?.isInWater === true;
    } catch {
      return;
    }
    if (!inLiquid) return; // stuck but not stranded — the cooldown alone caps cost

    // Destination: leashed bots return to their anchor (using the configured rescue
    // Y); unleashed bots go to the fleet rescueHome. No home → escalate, don't guess.
    const dest = this.leashHome
      ? { x: this.leashHome.x, y: this.rescueHome?.y ?? Math.round(pos.y), z: this.leashHome.z }
      : this.rescueHome;
    this.lastRescueAttemptAt = Date.now();

    if (!dest) {
      logger.warn(
        { bot: this.botName, pos: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) } },
        'STRANDED bot has no rescue home (set config.rescueHome or leash it) — manual /tp needed',
      );
      return;
    }

    const dx = Math.round(dest.x), dy = Math.round(dest.y), dz = Math.round(dest.z);
    const before = { x: pos.x, z: pos.z };
    logger.warn({ bot: this.botName, dest: { x: dx, y: dy, z: dz } }, 'STRANDED in liquid — attempting self-rescue /tp home');
    try {
      this.bot.chat(`/tp ${this.bot.username} ${dx} ${dy} ${dz}`);
    } catch (err: any) {
      logger.warn({ bot: this.botName, err: err.message }, 'Self-rescue /tp threw');
      return;
    }
    await new Promise((r) => setTimeout(r, 2500));

    const after = this.bot.entity?.position;
    const movedToHome = !!after && Math.hypot(after.x - dx, after.z - dz) < 12;
    if (movedToHome) {
      // Landed near home → clear the doomed task's blockers so it retries fresh.
      this.curriculumAgent.getBlockerMemory().clearTask(task);
      logger.info({ bot: this.botName, dest: { x: dx, y: dy, z: dz } }, 'Self-rescue succeeded — teleported home, cleared blockers');
    } else {
      const moved = after ? Math.hypot(after.x - before.x, after.z - before.z) : 0;
      logger.warn(
        { bot: this.botName, movedBlocks: Math.round(moved), manualCommand: `/tp ${this.bot.username} ${dx} ${dy} ${dz}` },
        'STRANDED bot could NOT self-rescue (not op / tp rejected) — MANUAL /tp REQUIRED',
      );
    }
  }

  private async runOneCycle(): Promise<void> {
    if (this.paused) return;

    // bot.entity is null in the death→respawn window. Several hot paths below
    // (computeSurvivalGoal, build origin resolution) dereference it; bail this
    // cycle if we're not embodied yet. scheduleNext() still re-arms the loop.
    if (!this.bot?.entity) return;

    // Pull current difficulty modifiers up front so they shape this cycle's cadence
    // (cooldown for the *next* schedule) and gate proactive chat below. Failures here
    // are non-fatal — bots without a balancer keep their previous (neutral) defaults.
    if (this.difficultyBalancer) {
      try {
        const mods = await this.difficultyBalancer.getBotBehaviorModifiers();
        if (mods && typeof mods.taskCooldownMultiplier === 'number' && mods.taskCooldownMultiplier > 0) {
          this.taskCooldownMultiplier = mods.taskCooldownMultiplier;
        }
        if (mods && typeof mods.chatProbability === 'number') {
          this.chatProbability = Math.max(0, Math.min(1, mods.chatProbability));
        }
      } catch { /* ignore — additive signal */ }
    }

    // Check for inter-bot messages (help requests become queued tasks)
    // Process inter-bot messages (rate-limited to 3 per cycle)
    if (this.botComms) {
      const unread = await this.botComms.getUnread(this.botName);
      for (const msg of unread.slice(0, 3)) {
        await this.processBotMessage(msg);
      }
    }

    // Reflect on emotional state (decay toward neutral)
    this.socialMemory?.reflect(this.botName);

    // Assess threats and scan opportunities each cycle.
    //
    // P4-A: when the perception tick is enabled, READ the latest threat
    // assessment from the AgentState cache (populated off the loop by
    // BotInstance's perceptionInterval) and only fall back to an inline
    // assess() if the cache is empty or stale. When the flag is OFF,
    // `cognition?.perceptionTick` is falsy so we take the SAME inline assess()
    // path as before — byte-identical behavior.
    const perceptionTickOn = !!this.config.cognition?.perceptionTick;
    let threatAssessment: ThreatAssessment | null = null;
    if (this.threatAssessor) {
      if (perceptionTickOn) {
        threatAssessment = this.agentState.getFreshThreat(VoyagerLoop.PERCEPTION_MAX_AGE_MS);
      }
      if (!threatAssessment) {
        try { threatAssessment = this.threatAssessor.assess(this.bot); } catch { /* ignore scan errors */ }
      }
      if (threatAssessment && threatAssessment.overallThreatLevel >= 7) {
        this.decisionTrace.record('task_selection', threatAssessment.suggestedAction,
          `Threat level ${threatAssessment.overallThreatLevel}: ${threatAssessment.threats[0]?.description || 'unknown'}`,
          threatAssessment.suggestedAction, { level: threatAssessment.overallThreatLevel, threats: threatAssessment.threats.length });
      }
    }

    // Feed observations into the cross-bot SharedWorldModel.
    // Throttled to once per 5 seconds per bot to keep IPC traffic reasonable.
    if (this.sharedWorldModel && Date.now() - this.lastSharedWorldUpdateAt > 5000) {
      this.lastSharedWorldUpdateAt = Date.now();
      try {
        const pos = this.bot.entity?.position;
        if (pos) {
          this.sharedWorldModel.updateBotState({
            name: this.botName,
            position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
            state: this.currentTask ? 'working' : 'idle',
            currentTask: this.currentTask ?? undefined,
            health: this.bot.health ?? 20,
            food: this.bot.food ?? 20,
            updatedAt: Date.now(),
          });
          this.sharedWorldModel.markChunkExplored(Math.floor(pos.x / 16), Math.floor(pos.z / 16));
        }
        if (typeof this.bot.time?.timeOfDay === 'number') {
          this.sharedWorldModel.updateServerState(
            this.bot.time.timeOfDay,
            this.bot.isRaining ? 'rain' : 'clear',
          );
        }
        // Forward high-priority threats so other bots can avoid the area
        if (threatAssessment) {
          for (const t of threatAssessment.threats) {
            if (t.dangerLevel < 5 || !t.position) continue;
            this.sharedWorldModel.reportThreat(this.botName, {
              type: t.type,
              source: t.source,
              position: t.position,
              dangerLevel: t.dangerLevel,
              reportedBy: this.botName,
              reportedAt: Date.now(),
              expiresAt: Date.now() + 5 * 60 * 1000,
            });
          }
        }
      } catch { /* ignore feed errors */ }
    }

    // Proactive communication: announce discoveries and threats
    if (this.proactiveCommunicator && this.opportunityDetector) {
      try {
        // P4-A: prefer the cached scan when the perception tick is on; fall
        // back to an inline scan() when stale/empty. Flag OFF ⇒ always inline,
        // identical to before.
        let scan: OpportunityScan | null = perceptionTickOn
          ? this.agentState.getFreshOpportunities(VoyagerLoop.PERCEPTION_MAX_AGE_MS)
          : null;
        if (!scan) {
          scan = this.opportunityDetector.scan(this.bot);
        }
        const announcements = this.proactiveCommunicator.checkAndAnnounce({
          threats: threatAssessment?.threats.map((t) => ({ type: t.type, source: t.source, dangerLevel: t.dangerLevel, distance: t.distance, position: t.position })) ?? [],
          opportunities: scan.opportunities,
          health: this.bot.health,
          food: this.bot.food,
          currentTask: this.currentTask ?? undefined,
          // P4-B: undefined when the controller is OFF (getTalkConditioning
          // short-circuits), so ProactiveCommunicator behaves exactly as before.
          decisionConditioning: this.getTalkConditioning(),
        });
        for (const ann of announcements) {
          // Gate by both priority and DifficultyBalancer chat probability so bots stay
          // quieter on peaceful/easy and chatter more on challenge tiers.
          if (ann.priority >= 7 && this.bot.chat && Math.random() < this.chatProbability) {
            this.bot.chat(this.proactiveCommunicator.formatForChat(ann));
          }
        }
      } catch { /* ignore scan errors */ }
    }

    if (this.activeLongTermGoal?.spec.kind === 'build_structure') {
      // P4-B: record the structured decision for talk-conditioning (flag-gated).
      // Behavior (runBuildGoalCycle) is unchanged either way.
      if (this.config.cognition?.cognitiveController) {
        this.lastDecision = cognitiveDecide(this.buildCognitiveContext({
          buildGoalActive: true,
          buildGoalDescription: this.activeLongTermGoal.rawRequest,
          threatAssessment,
        }));
      }
      await this.runBuildGoalCycle();
      return;
    }

    // GoalGenerator: check for survival/safety overrides before normal task selection
    let goalOverrideTask: Task | null = null;
    // P4-B: capture which signal produced the override so the Cognitive
    // Controller can label it correctly (survival goal vs. player intent).
    // Only assigned when the controller flag is on; unused on the OFF path.
    const ccOn = !!this.config.cognition?.cognitiveController;
    let ccSurvivalGoal: Goal | null = null;
    let ccPlayerIntent: { player: string; intent: string; confidence: number; suggestedTask: string } | null = null;
    if (this.goalGenerator && this.playerTaskQueue.length === 0) {
      try {
        // P4-A: when the perception tick is on, READ the survival-override goal
        // the tick already computed (falling back to an inline compute if the
        // cache is empty/stale). When OFF, compute inline EXACTLY as before —
        // computeSurvivalGoal() is a verbatim extraction of the original inline
        // generateGoals() + selection, so the disabled path is byte-identical.
        let top: Goal | null;
        if (perceptionTickOn) {
          const [fresh, cached] = this.agentState.getFreshSurvivalGoal(VoyagerLoop.PERCEPTION_MAX_AGE_MS);
          top = fresh ? cached : this.computeSurvivalGoal(threatAssessment);
        } else {
          top = this.computeSurvivalGoal(threatAssessment);
        }
        if (top && (top.priority === 'survival' || top.priority === 'safety') && top.urgency >= 7) {
          goalOverrideTask = { description: top.description, keywords: top.keywords };
          if (ccOn) ccSurvivalGoal = top;
          this.decisionTrace.record('task_selection', top.description, `GoalGenerator: ${top.priority} override (urgency ${top.urgency})`,
            top.description, { priority: top.priority, urgency: top.urgency });
        }
      } catch { /* ignore goal generation errors */ }
    }

    // PlayerIntent: if a nearby player is doing something we have a confident
    // suggestion for (e.g. building, mining, struggling) AND no higher-priority
    // override is already pinned, adopt the suggested task. This biases bots
    // toward helping players without overriding survival/safety or queued work.
    if (
      this.playerIntentModel
      && !goalOverrideTask
      && this.playerTaskQueue.length === 0
    ) {
      try {
        const botPosForIntent = this.bot.entity?.position;
        const nearbyPlayers: string[] = [];
        if (botPosForIntent && this.bot.players) {
          for (const p of Object.values(this.bot.players) as any[]) {
            if (!p?.username || p.username === this.bot.username) continue;
            const ent = p.entity;
            if (!ent?.position) continue;
            if (ent.position.distanceTo(botPosForIntent) <= 32) {
              nearbyPlayers.push(p.username);
            }
          }
        }
        let bestIntent: { player: string; intent: string; confidence: number; suggestedTask: string } | null = null;
        for (const playerName of nearbyPlayers) {
          const pred = await this.playerIntentModel.predictIntent(playerName);
          if (
            pred
            && pred.confidence >= 0.7
            && pred.suggestedTask
            && (!bestIntent || pred.confidence > bestIntent.confidence)
          ) {
            bestIntent = {
              player: playerName,
              intent: pred.intent,
              confidence: pred.confidence,
              suggestedTask: pred.suggestedTask,
            };
          }
        }
        if (bestIntent) {
          const keywords = bestIntent.suggestedTask
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter((w) => w.length > 2);
          goalOverrideTask = { description: bestIntent.suggestedTask, keywords };
          if (ccOn) ccPlayerIntent = bestIntent;
          this.decisionTrace.record(
            'task_selection',
            bestIntent.suggestedTask,
            `PlayerIntent: ${bestIntent.intent} (confidence ${bestIntent.confidence.toFixed(2)}) for ${bestIntent.player}`,
            bestIntent.suggestedTask,
            { intent: bestIntent.intent, confidence: bestIntent.confidence, player: bestIntent.player },
          );
        }
      } catch { /* ignore intent errors — additive signal */ }
    }

    // 1. Get task from player queue or curriculum
    const goalTask = this.activeLongTermGoal ? longTermGoalToTask(this.activeLongTermGoal) : null;
    this.blackboardManager?.releaseStale();
    const botPos = this.bot.entity?.position ? { x: this.bot.entity.position.x, y: this.bot.entity.position.y, z: this.bot.entity.position.z } : undefined;
    // Followup #40 — fetch the bot's town role (if any) so ScheduleManager's
    // role-tagged tasks get the role-keyword boost in claimBestTask scoring.
    // The BlackboardProxy round-trips to the main thread; WorkerHandle
    // caches the result for 60s. Resolves to null for non-resident bots
    // and behavior is identical to before.
    let botRole: string | null = null;
    try {
      const bp = this.blackboardManager as unknown as { getBotRole?: (n: string) => Promise<string | null> } | null;
      if (bp?.getBotRole) {
        botRole = (await bp.getBotRole(this.botName)) ?? null;
      }
    } catch {
      /* swallow — role boost is additive */
    }
    // Caretaker builders never claim blackboard/swarm tasks — those are the
    // roaming DungeonMaster "explore N blocks for iron" quests that the leash
    // can't fulfill. They run only their own place-only caretaker curriculum
    // (below), plus any explicit player/goal task.
    const blackboardTask = (!goalTask && !this.isCaretakerBuilder) ? (await this.blackboardManager?.claimBestTask(this.botName, this.currentTask || this.personality, this.personality, botPos, botRole ?? undefined)) || null : null;
    this.activeBlackboardTask = blackboardTask;
    const playerTask = goalTask || this.playerTaskQueue.shift();

    // Town-resident gate: when the bot has a (non-idle) town role and nothing
    // higher-priority is available, prefer to idle a tick over running the
    // curriculum agent. Curriculum-proposed tasks tend to be exploratory
    // Voyager-style mining/exploring quests that pull residents away from
    // their town. Skipping curriculum here means the next iteration retries
    // the blackboard, which is what we want for town work.
    const isResident = !!botRole && botRole.toLowerCase() !== 'idle';

    // Project Sid P2-B — inject the town's standing rules into the resident's
    // task-proposal prompt (Sid's one-line enforcement model). Gated on
    // governance.enabled AND residency: when the flag is off or the bot isn't
    // a resident, formatRulesForPrompt returns '' and we never even fetch the
    // rules (no IPC, no token cost). The fetch mirrors getBotRole — a
    // BlackboardProxy round-trip cached for 60s on WorkerHandle.
    let rulesContext = '';
    if (this.config.governance?.enabled && isResident) {
      try {
        const bp = this.blackboardManager as unknown as { getActiveRulesForBot?: (n: string) => Promise<TownRule[]> } | null;
        if (bp?.getActiveRulesForBot) {
          const rules = (await bp.getActiveRulesForBot(this.botName)) ?? [];
          rulesContext = formatRulesForPrompt(rules, true, true);
        }
      } catch {
        /* swallow — rule injection is additive */
      }
    }

    // Project Sid P3-B — bias the bot's task selection toward the memes it has
    // ADOPTED (the anti-gimmick hook: culture must change behavior, not just
    // chat). Mirrors the P2-B rules line. Gated entirely on
    // `config.social.culture`: formatCultureForPrompt returns '' when off, and
    // getAdoptedMemeLabels short-circuits without any IPC, so it's byte-for-byte
    // identical to today and costs zero tokens when the flag is off.
    let cultureContext = '';
    if (this.config.social?.culture && this.cultureManager) {
      try {
        const memes = await this.cultureManager.getAdoptedMemes(this.botName);
        cultureContext = formatCultureForPrompt(memes, true);
      } catch {
        /* swallow — meme injection is additive */
      }
    }

    const haveHigherPriority = Boolean(goalOverrideTask || goalTask || playerTask || blackboardTask);
    if (isResident && !haveHigherPriority) {
      // P4-B: record the resident-idle decision (flag-gated). Same early return.
      if (ccOn) {
        this.lastDecision = cognitiveDecide(this.buildCognitiveContext({
          isResident: true,
          threatAssessment,
        }));
      }
      logger.debug(
        { bot: this.botName, role: botRole },
        'Resident has no swarm/player task this tick; idling (skipping curriculum fallback)',
      );
      return;
    }

    const task = goalOverrideTask
      || goalTask
      || playerTask
      || (blackboardTask ? { description: blackboardTask.description, keywords: blackboardTask.keywords } : null)
      // Caretaker builders bypass the roaming Voyager curriculum entirely and
      // run the place-only home-expansion loop instead.
      || (this.isCaretakerBuilder ? this.proposeCaretakerTask() : null)
      || await this.curriculumAgent.proposeTask(
      this.bot,
      this.personality,
      this.skillLibrary,
      rulesContext || undefined,
      cultureContext || undefined,
    );

    // Stuck-task cost guard: if this autonomously-chosen task has failed hard
    // recently (count >= 2 within the cooldown window), don't burn a codegen call
    // regenerating a doomed task every ~30s. Idle this cycle; the cooldown lets us
    // retry later once the situation may have changed (e.g. the bot was rescued
    // from a spot where the task was impossible). Player/goal/blackboard tasks
    // bypass this — the user explicitly asked for those.
    const STUCK_TASK_COOLDOWN_MS = 5 * 60 * 1000;
    if (task && !haveHigherPriority
      && this.curriculumAgent.getBlockerMemory().isOnCooldown(task, STUCK_TASK_COOLDOWN_MS)) {
      // A bot stuck on the same task is often physically stranded (e.g. beached in
      // water with no reachable resources). Try to self-rescue it home before we
      // idle — otherwise it's cheap but permanently useless until a human notices.
      await this.tryRescueIfStranded(task);
      logger.info(
        { bot: this.botName, task: task.description },
        'Stuck task on cooldown — skipping codegen this cycle (cost guard)',
      );
      return;
    }

    const progression = getProgressionState(this.bot, (this.curriculumAgent as any).completedTasks || []);
    const plan = buildTaskPlan(task, progression);
    this.currentTask = task.description;

    // P4-B: emit the structured Cognitive Controller decision for THIS cycle
    // (flag-gated). The action.kind decide() selects is identical to the
    // imperative ladder above — the value here is the structured decision plus
    // the `conditioningForTalk` string broadcast to chat/proactive speech.
    // Behavior selection above is unchanged; this is purely additive.
    if (ccOn) {
      this.lastDecision = cognitiveDecide(this.buildCognitiveContext({
        survivalGoal: ccSurvivalGoal,
        playerIntent: ccPlayerIntent,
        longTermGoalTask: goalTask ? goalTask.description : null,
        // NOTE: `playerTask` aliases `goalTask` when a long-term goal is active
        // (see `const playerTask = goalTask || …shift()`), so only treat it as a
        // genuine player-queue request when there is no long-term goal.
        playerTask: !goalTask && playerTask ? playerTask.description : null,
        blackboardTask: blackboardTask ? blackboardTask.description : null,
        isResident,
        threatAssessment,
      }));
    }

    // Personality-flavored acknowledgment when starting a player-requested task.
    if (playerTask && playerTask.requestedBy) {
      this.maybeAcknowledgeTask(playerTask.requestedBy);
    }

    logger.info({
      bot: this.botName,
      task: task.description,
      source: goalTask ? 'long-term-goal' : playerTask ? 'player-request' : blackboardTask ? 'blackboard' : 'autonomous',
      plan: plan.steps.map((step) => step.description),
    }, 'Voyager task proposed');

    const taskSource = goalTask ? 'long-term-goal' : playerTask ? 'player-request' : blackboardTask ? 'blackboard' : 'autonomous';
    this.decisionTrace.record('task_selection', task.description, `Selected ${taskSource} task`, task.description, {
      plan: plan.steps.map((s) => s.description),
      playerQueueSize: this.playerTaskQueue.length,
      hasLongTermGoal: !!this.activeLongTermGoal,
    }, [
      { label: 'long-term-goal', chosen: taskSource === 'long-term-goal', reason: goalTask ? 'Active goal' : 'No goal' },
      { label: 'player-request', chosen: taskSource === 'player-request', reason: playerTask && !goalTask ? 'Queued' : 'None' },
      { label: 'blackboard', chosen: taskSource === 'blackboard', reason: blackboardTask ? 'Claimed' : 'None' },
      { label: 'autonomous', chosen: taskSource === 'autonomous', reason: taskSource === 'autonomous' ? 'Curriculum' : 'Higher priority used' },
    ]);

    for (const step of plan.steps) {
      const ok = await this.executeTaskStep(step);
      if (!ok) {
        // If the failure was caused by an instinct pause (damage), don't treat it as
        // a real failure — just bail out so the goal resumes when instinct ends.
        if (this.paused) {
          this.currentTask = null;
          return;
        }
        const blockers = this.curriculumAgent.getBlockerMemory().getTaskBlockers({ description: step.description, keywords: step.keywords, spec: step.spec });
        const replanned = replanTaskStep({ description: step.description, keywords: step.keywords, spec: step.spec }, blockers, this.curriculumAgent.getWorldMemory());
        if (replanned) {
          logger.info({ bot: this.botName, step: step.description, replanned: replanned.steps.map((s) => s.description) }, 'Adaptive replan triggered');
          for (const replannedStep of replanned.steps) {
            const replannedOk = await this.executeTaskStep(replannedStep);
            if (!replannedOk) {
              this.currentTask = null;
              return;
            }
          }
          continue;
        }
        if (goalTask && this.activeLongTermGoal) {
          this.activeLongTermGoal.status = 'blocked';
          this.activeLongTermGoal.updatedAt = Date.now();
        }
        if (this.activeBlackboardTask) {
          this.blackboardManager?.blockTask(this.activeBlackboardTask.description, this.botName, 'step failed');
          this.activeBlackboardTask = null;
        }
        this.currentTask = null;
        return;
      }
    }
    if (goalTask && this.activeLongTermGoal) {
      const completedTask = popLongTermSubtask(this.activeLongTermGoal);
      if (completedTask) completeLongTermSubtask(this.activeLongTermGoal, completedTask);
      if (this.activeLongTermGoal.status === 'completed') {
        logger.info({ bot: this.botName, goal: this.activeLongTermGoal.rawRequest }, 'Long-term goal completed');
        this.activeLongTermGoal = null;
      }
    }
    if (this.activeBlackboardTask) {
      this.blackboardManager?.completeTask(this.activeBlackboardTask.description, this.botName);
      this.activeBlackboardTask = null;
    }
    // Report completion of player-requested task back to the requester in chat.
    if (playerTask) this.maybeReportCompletion(playerTask);
    this.currentTask = null;
  }

  private async runBuildGoalCycle(): Promise<void> {
    const goal = this.activeLongTermGoal;
    if (!goal || !goal.blueprint || !goal.origin) return;
    this.currentTask = goal.rawRequest;
    goal.buildState = 'building';

    const missing = getMissingBlueprintPlacements(this.bot, goal.blueprint, goal.origin);
    if (missing.length === 0) {
      goal.status = 'completed';
      goal.buildState = 'completed';
      if (this.bot.chat) this.bot.chat('The build is finished.');
      logger.info({ bot: this.botName, goal: goal.rawRequest }, 'Long-term build goal completed');
      this.activeLongTermGoal = null;
      this.currentTask = null;
      return;
    }

    const reserveResults = await Promise.all(missing.map(async (placement) => ({ placement, ok: await this.tryReserveBuildCell(goal.id, placement.x, placement.y, placement.z) })));
    const reservable = reserveResults.filter((r) => r.ok).map((r) => r.placement);
    const batch = (reservable.length > 0 ? reservable : missing).slice(0, 8);
    const inventoryCounts = new Map<string, number>();
    for (const item of this.bot.inventory.items()) {
      inventoryCounts.set(item.name, (inventoryCounts.get(item.name) || 0) + item.count);
    }
    const placeableNow = batch.filter((placement) => {
      if (placement.block === 'any_block') {
        return !!this.chooseAvailableBuildBlock();
      }
      return (inventoryCounts.get(placement.block) || 0) > 0;
    });
    let placedCount = 0;
    let lastError: string | null = null;
    for (const placement of (placeableNow.length > 0 ? placeableNow : batch)) {
      const blockToPlace = placement.block === 'any_block'
        ? this.chooseAvailableBuildBlock()
        : placement.block;
      if (!blockToPlace) {
        lastError = 'No suitable building block available';
        continue;
      }
      const result = await placeBlock(this.bot, blockToPlace, placement.x, placement.y, placement.z);
      if (result.success) {
        placedCount++;
        inventoryCounts.set(blockToPlace, Math.max(0, (inventoryCounts.get(blockToPlace) || 0) - 1));
      } else {
        lastError = result.message || 'placement failed';
        if (!result.message?.includes('No ') && !result.message?.includes('inventory')) {
          logger.warn({ bot: this.botName, placement, error: result.message }, 'Build placement failed without material shortage');
          continue;
        }
      }
    }

    if (placedCount > 0) {
      logger.info({ bot: this.botName, placedCount, remaining: missing.length - placedCount, goal: goal.rawRequest }, 'Build goal placed blueprint blocks');
      goal.updatedAt = Date.now();
      this.releaseBuildReservations(goal.id);
      this.currentTask = null;
      return;
    }

    const neededBlock = this.findNeededBlockForGather(batch, inventoryCounts) || missing[0]?.block;
    const gatherTask = this.createGatherTaskForBlock(neededBlock);
    if (gatherTask) {
      const now = Date.now();
      if (!goal.lastResourceNoticeAt || now - goal.lastResourceNoticeAt > 30000) {
        this.bot.chat('I need to gather more resources.');
        goal.lastResourceNoticeAt = now;
      }
      goal.buildState = 'gathering';
      logger.info({ bot: this.botName, neededBlock, task: gatherTask.description, error: lastError }, 'Build goal executing resource gathering task');
      const gatherOk = await this.executeTaskStep({ description: gatherTask.description, keywords: gatherTask.keywords, spec: gatherTask.spec });
      if (!gatherOk) {
        // If paused by instinct (damage), don't mark the build goal as blocked
        if (this.paused) {
          this.currentTask = null;
          return;
        }
        goal.status = 'blocked';
        goal.buildState = 'blocked';
        logger.warn({ bot: this.botName, goal: goal.rawRequest, gatherTask: gatherTask.description }, 'Build goal blocked while gathering resources');
      }
      this.releaseBuildReservations(goal.id);
      this.currentTask = null;
      return;
    }

    goal.status = 'blocked';
    goal.buildState = 'blocked';
    logger.warn({ bot: this.botName, goal: goal.rawRequest, error: lastError }, 'Build goal blocked');
    this.releaseBuildReservations(goal.id);
    this.currentTask = null;
  }

  private createGatherTaskForBlock(blockName?: string): Task | null {
    if (!blockName) return null;
    if (blockName === 'any_block') {
      const preferred = this.choosePreferredGatherMaterial();
      return this.createGatherTaskForBlock(preferred);
    }
    if (blockName === 'cobblestone') {
      return { description: 'Mine 20 cobblestone', keywords: ['mine', 'cobblestone', 'stone'] };
    }
    // Snapshot the inventory once so we don't iterate it three times across the wood branches.
    const itemNames = new Set(this.bot.inventory.items().map((i) => i.name));
    if (blockName === 'oak_planks') {
      return itemNames.has('oak_log')
        ? { description: 'Craft 20 oak planks', keywords: ['craft', 'oak_planks', 'wood'] }
        : { description: 'Mine 6 oak logs', keywords: ['mine', 'oak_log', 'wood'] };
    }
    if (blockName === 'spruce_planks') {
      return itemNames.has('spruce_log')
        ? { description: 'Craft 20 spruce planks', keywords: ['craft', 'spruce_planks', 'wood'] }
        : { description: 'Mine 6 spruce logs', keywords: ['mine', 'spruce_log', 'wood'] };
    }
    if (blockName === 'birch_planks') {
      return itemNames.has('birch_log')
        ? { description: 'Craft 20 birch planks', keywords: ['craft', 'birch_planks', 'wood'] }
        : { description: 'Mine 6 birch logs', keywords: ['mine', 'birch_log', 'wood'] };
    }
    return null;
  }

  private findGroundedBuildOrigin(): { x: number; y: number; z: number } {
    const base = this.bot.entity.position.floored();
    const startX = Math.round(base.x + 2);
    const startZ = Math.round(base.z + 2);
    for (let y = Math.floor(base.y); y >= Math.max(1, Math.floor(base.y) - 20); y--) {
      const below = this.bot.blockAt(new Vec3(startX, y, startZ));
      const above = this.bot.blockAt(new Vec3(startX, y + 1, startZ));
      if (below && !AIR_BLOCKS.has(below.name) && (!above || AIR_BLOCKS.has(above.name))) {
        return { x: startX, y: y + 1, z: startZ };
      }
    }
    return { x: Math.round(base.x + 2), y: Math.round(base.y), z: Math.round(base.z + 2) };
  }

  private findNeededBlockForGather(batch: Array<{ block: string }>, inventoryCounts: Map<string, number>): string | undefined {
    for (const placement of batch) {
      if (placement.block === 'any_block') {
        if (!this.chooseAvailableBuildBlock()) return 'any_block';
        continue;
      }
      if ((inventoryCounts.get(placement.block) || 0) <= 0) {
        return placement.block;
      }
    }
    return undefined;
  }

  private chooseAvailableBuildBlock(): string | null {
    const buildable = [
      'oak_planks',
      'spruce_planks',
      'birch_planks',
      'cobblestone',
      'dirt',
      'stone',
    ];
    const inventory = new Map<string, number>();
    for (const item of this.bot.inventory.items()) {
      inventory.set(item.name, (inventory.get(item.name) || 0) + item.count);
    }
    for (const block of buildable) {
      if ((inventory.get(block) || 0) > 0) return block;
    }
    return null;
  }

  private choosePreferredGatherMaterial(): string {
    const inventory = new Set(this.bot.inventory.items().map((item) => item.name));
    if (inventory.has('oak_log') || this.curriculumAgent.getWorldMemory().findNearest('oak_log', 'resource')) return 'oak_planks';
    if (inventory.has('spruce_log') || this.curriculumAgent.getWorldMemory().findNearest('spruce_log', 'resource')) return 'spruce_planks';
    if (inventory.has('birch_log') || this.curriculumAgent.getWorldMemory().findNearest('birch_log', 'resource')) return 'birch_planks';
    if (inventory.has('cobblestone')) return 'cobblestone';
    return 'oak_planks';
  }

  private async tryReserveBuildCell(goalId: string, x: number, y: number, z: number): Promise<boolean> {
    if (!this.blackboardManager) return true;
    return this.blackboardManager.claimReservation('build-cell', `${goalId}:${x},${y},${z}`, this.botName, goalId, 45000);
  }

  private releaseBuildReservations(goalId: string): void {
    this.blackboardManager?.releaseReservationsForBot(this.botName, `${goalId}:`);
  }

  private async executeTaskStep(step: PlannedStep): Promise<boolean> {
    const task: Task = { description: step.description, keywords: step.keywords, spec: step.spec };
    this.currentTask = task.description;
    this.blackboardManager?.postMessage(this.botName, 'progress', `Working on ${task.description}.`);

    // 2. Try the best existing skill first, then fall back to fresh generation
    if (!this.actionAgent) {
      logger.info({ bot: this.botName }, 'No LLM available, skipping task');
      return false;
    }

    const query = task.keywords.join(' ') + ' ' + task.description;
    const bestSkill = await this.skillLibrary.getBestMatch(query);
    const composableSkills = await this.skillLibrary.getComposableMatches(query, 3);
    const blockerSummary = this.curriculumAgent.getBlockerMemory().summarize(task);
    const worldMemorySummary = this.curriculumAgent.getWorldMemory().summary();
    // A confident direct-skill match reuses cached skill code WITHOUT an LLM call
    // (codeSource='skill-library' below). The old `composableSkills.length <= 1`
    // gate defeated this whenever ≥2 skills loosely matched (getComposableMatches
    // admits score ≥ 8), forcing full codegen even on a strong exact match — the
    // dominant source of "regenerate the same already-learned task 100×" spend.
    // Trust a strong direct match (getBestMatch already requires score ≥ 16;
    // ≥ 24 is a confident hit) regardless of how many weak composables co-matched.
    const STRONG_DIRECT_SKILL_SCORE = 24;
    const useDirectSkill = !!bestSkill
      && (composableSkills.length <= 1 || bestSkill.score >= STRONG_DIRECT_SKILL_SCORE);

    // Try action templates as a middle tier between skill library and full code gen
    const templateMatch = !useDirectSkill && this.actionTemplates
      ? this.actionTemplates.findTemplate(task.description, task.keywords)
      : null;
    const useTemplate = templateMatch && templateMatch.confidence >= 0.5;

    let generated: GeneratedCode;
    let codeSource: string;

    if (useDirectSkill) {
      generated = this.skillToGeneratedCode(bestSkill);
      codeSource = 'skill-library';
    } else if (useTemplate && templateMatch) {
      // Render template to code
      const params: Record<string, string> = {};
      for (const kw of task.keywords) params[kw] = kw;
      const rendered = this.actionTemplates!.renderTemplate(templateMatch.template, params);
      const code = this.actionTemplates!.toCode(rendered, this.taskToSkillName(task));
      const fnMatch = code.match(/async\s+function\s+(\w+)/);
      generated = {
        functionName: fnMatch?.[1] || 'templateTask',
        functionCode: code,
        execCode: `await ${fnMatch?.[1] || 'templateTask'}(bot);`,
      };
      codeSource = 'action-template';
    } else {
      generated = await this.actionAgent.generateCode(this.bot, task, this.skillLibrary, undefined, undefined, undefined, undefined, blockerSummary, worldMemorySummary);
      codeSource = 'action-agent';
    }

    logger.info({
      bot: this.botName,
      source: codeSource,
      skillName: bestSkill?.name,
      skillScore: bestSkill?.score,
      templateName: templateMatch?.template.name,
      templateConfidence: templateMatch?.confidence,
      composableSkills: composableSkills.map((skill) => ({ name: skill.name, score: skill.score })),
      functionName: generated.functionName,
      codeLength: generated.functionCode.length,
      execCode: generated.execCode,
    }, codeSource === 'skill-library' ? 'Reusing saved skill' : codeSource === 'action-template' ? 'Using action template' : 'Code generated by ActionAgent');

    this.decisionTrace.record('skill_vs_codegen', task.description,
      codeSource === 'skill-library' ? `Reusing skill "${bestSkill!.name}"`
        : codeSource === 'action-template' ? `Using template "${templateMatch!.template.name}" (${(templateMatch!.confidence * 100).toFixed(0)}%)`
        : `Generating fresh code`,
      codeSource, { functionName: generated.functionName, codeLength: generated.functionCode.length, composableCount: composableSkills.length },
      [
        { label: 'skill-library', chosen: codeSource === 'skill-library', score: bestSkill?.score, reason: bestSkill ? `Match: "${bestSkill.name}"` : 'No match' },
        { label: 'action-template', chosen: codeSource === 'action-template', score: templateMatch?.confidence, reason: templateMatch ? `Template: "${templateMatch.template.name}"` : 'No match' },
        { label: 'action-agent', chosen: codeSource === 'action-agent', reason: 'Full code gen' },
      ],
    );

    logger.debug({
      bot: this.botName,
      functionName: generated.functionName,
      code: generated.functionCode,
    }, 'Generated code body');

    // 3. Execute with retries
    let lastError: string | undefined;
    let previousErrorKey: string | undefined;
    let eventLog = '';
    for (let attempt = 0; attempt < this.config.voyager.maxRetriesPerTask; attempt++) {
      if (!this.running) return false;

      const preState = takeBotSnapshot(this.bot);

      // Get ALL skill code for VM injection (so new code can call prior skills)
      const allSkillCode = this.skillLibrary.getAllSkillCode();

      logger.info({ bot: this.botName, attempt: attempt + 1 }, 'Executing generated code');
      const execResult = await this.codeExecutor.execute(this.bot, {
        functionCode: generated.functionCode,
        execCode: generated.execCode,
        allSkillCode,
      });

      if (execResult.error?.startsWith('Execution interrupted:')) {
        logger.warn({ bot: this.botName, task: task.description, reason: execResult.error }, 'Voyager task interrupted');
        return false;
      }

      logger.info({
        bot: this.botName,
        execSuccess: execResult.success,
        execError: execResult.error,
        execOutputPreview: execResult.output.slice(0, 2000),
        execOutputLength: execResult.output.length,
        execEventsCount: execResult.events.length,
      }, 'Execution result');
      this.decisionTrace.record('execution', task.description,
        `Attempt ${attempt + 1}: ${execResult.success ? 'success' : `error: ${execResult.error?.slice(0, 120) || 'unknown'}`}`,
        execResult.success ? 'success' : 'error',
        { attempt: attempt + 1, execSuccess: execResult.success, execError: execResult.error?.slice(0, 300), eventCount: execResult.events.length },
      );
      logger.debug({
        bot: this.botName,
        execOutput: execResult.output.slice(0, 4000),
        execEvents: execResult.events.slice(0, 40),
        execEventsTruncated: Math.max(0, execResult.events.length - 40),
      }, 'Execution result details');
      this.statsTracker.trackExecution(this.botName, execResult.events);
      eventLog = execResult.events
        .slice(0, 30)
        .map((event) => `${event.type}: ${event.message}`)
        .join(' | ')
        .slice(0, VoyagerLoop.MAX_RETRY_EVENT_LOG_CHARS);
      this.lastExecutionMetrics = {
        attempt: attempt + 1,
        task: task.description,
        success: execResult.success,
        outputLength: execResult.output.length,
        eventCount: execResult.events.length,
        eventLogLength: eventLog.length,
        codeLength: generated.functionCode.length,
        timestamp: Date.now(),
      };

      // Wait for actions to settle
      await new Promise((r) => setTimeout(r, 2000));

      const postState = takeBotSnapshot(this.bot);
      await this.curriculumAgent.getWorldMemory().rememberFromBot(this.bot);

      // 4. Critic evaluation
      const criticResult = await this.criticAgent.evaluate(
        this.bot,
        task,
        execResult,
        preState,
        postState
      );

      logger.info({
        bot: this.botName,
        task: task.description,
        attempt: attempt + 1,
        success: criticResult.success,
        reason: criticResult.reason,
      }, 'Voyager task evaluated');
      this.decisionTrace.record('critic_evaluation', task.description,
        `Attempt ${attempt + 1}: ${criticResult.success ? 'PASS' : 'FAIL'} — ${criticResult.reason.slice(0, 150)}`,
        criticResult.success ? 'success' : 'failure',
        { attempt: attempt + 1, success: criticResult.success, reason: criticResult.reason, critique: criticResult.critique?.slice(0, 300) },
      );

      if (criticResult.success) {
        // Save the named function as a reusable skill
        const skillName = this.taskToSkillName(task);
        const quality = this.estimateSkillQuality(criticResult.reason, generated.functionCode);
        if (quality >= 0.65) {
          await this.skillLibrary.save(
            skillName,
            task.description,
            task.keywords,
            generated.functionCode,
            quality
          );
          this.skillLibrary.recordOutcome(skillName, true);
        }
        this.curriculumAgent.updateProgress(task, true);
        this.curriculumAgent.getBlockerMemory().clearTask(task);
        this.lastCompletedTask = task.description;
        this.blackboardManager?.postMessage(this.botName, 'completion', `Finished ${task.description}.`);

        // Record success in social memory
        this.socialMemory?.addMemory(this.botName, 'task_complete', this.botName, `Completed task: ${task.description}`, 0.5);
        this.socialMemory?.updateEmotionalState(this.botName, 'task_success');

        // Narrate completion in-game
        if (this.decisionNarrator) {
          const narration = this.decisionNarrator.narrate({ task: task.description, personality: this.personality, botName: this.botName, event: 'task_complete' });
          if (narration && this.bot.chat) this.bot.chat(narration);
        }

        // Report reputation event to main thread
        try { this.decisionTrace.emitReputation({ botName: this.botName, type: 'task_completed', description: task.description, timestamp: Date.now(), impact: 0.5 }); } catch { /* ignore */ }
        try { this.skillAttribution?.recordUsage({ skillName: generated.functionName, botName: this.botName, personality: this.personality, context: task.description, success: true, executionTimeMs: Date.now() - (this.lastExecutionMetrics?.timestamp ?? Date.now()), timestamp: Date.now() }); } catch { /* ignore */ }
        try { this.planLibrary?.savePlan(task.description, [{ description: task.description, preconditions: [], postconditions: [], estimatedDurationMs: 0, failureRate: 0 }], task.keywords); } catch { /* ignore */ }

        this.decisionTrace.record('task_outcome', task.description, `Task succeeded on attempt ${attempt + 1}`, 'success',
          { attempts: attempt + 1, source: codeSource, skillSaved: quality >= 0.65, skillQuality: quality });

        return true;
      }

      // Retry with iterative refinement + error recovery analysis
      lastError = criticResult.reason;
      this.recordRetryAttempt(task.description, attempt + 1, lastError);
      if (useDirectSkill && bestSkill) {
        this.skillLibrary.recordOutcome(bestSkill.name, false);
      }

      // Analyze the failure and get specific recovery hints
      const recovery = analyzeFailure({
        task: task.description,
        error: lastError || '',
        critique: criticResult.critique || '',
        code: generated.functionCode,
        bot: this.bot,
        attempt: attempt + 1,
        maxAttempts: this.config.voyager.maxRetriesPerTask,
      });

      // If recovery says abandon (e.g. swimming when already safe), skip retries
      if (recovery?.abandon) {
        logger.info({ bot: this.botName, pattern: recovery.pattern, hint: recovery.hint }, 'ErrorRecovery: abandoning task');
        this.decisionTrace.record('retry_decision', task.description,
          `Abandoned: ${recovery.pattern}`, 'abandon', { pattern: recovery.pattern, hint: recovery.hint });
        return false;
      }

      // If recovery says replace task, queue prerequisites and bail out of this task
      if (recovery?.replaceTask) {
        const prereqs = this.resolvePrerequisites(recovery.replaceTask, task.description);
        if (prereqs.length > 0) {
          // Queue prerequisites at the front, then re-queue the original task after them
          const originalKeywords = task.keywords.length > 0 ? task.keywords
            : task.description.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 2);
          this.playerTaskQueue.unshift({ description: task.description, keywords: originalKeywords });
          for (let i = prereqs.length - 1; i >= 0; i--) {
            const p = prereqs[i];
            const kw = p.description.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w: string) => w.length > 2);
            this.playerTaskQueue.unshift({ description: p.description, keywords: kw });
          }
          logger.info({ bot: this.botName, task: task.description, prereqs: prereqs.map((p) => p.description) },
            'ErrorRecovery: replacing task with prerequisite chain');
          this.decisionTrace.record('retry_decision', task.description,
            `Replaced with ${prereqs.length} prerequisites: ${prereqs.map((p) => p.description).join(' → ')}`,
            'replace', { pattern: recovery.pattern, prereqs: prereqs.map((p) => p.description) });
          return false;
        }
      }

      // Abandon if the same error occurs twice in a row (first 80 chars match)
      const currentErrorKey = (lastError || '').slice(0, 80);
      if (previousErrorKey !== undefined && currentErrorKey === previousErrorKey) {
        logger.info({ bot: this.botName, task: task.description, error: currentErrorKey }, 'Abandoning task: same error appeared twice consecutively');
        this.decisionTrace.record('retry_decision', task.description,
          `Abandoned: same error appeared twice in a row (${currentErrorKey})`,
          'abandon', { attempt: attempt + 1, error: currentErrorKey, reason: 'duplicate_error' });
        return false;
      }
      previousErrorKey = currentErrorKey;

      if (attempt < this.config.voyager.maxRetriesPerTask - 1) {
        // Backoff before retrying so we don't hammer the LLM / spin uselessly.
        // `attempt` is 0-indexed (the iteration that just failed). The try we are
        // about to launch is (attempt + 2) in 1-indexed terms. Per spec
        // (1-indexed): attempt 1 -> 0, attempt 2 -> 2s, attempt 3 -> 4s,
        // attempt 4 -> 8s, capped at 10s. In 0-indexed terms that simplifies to
        // 1000 * 2^(attempt + 1).
        const nextAttempt1Indexed = attempt + 2;
        const backoffDelay = nextAttempt1Indexed === 1
          ? 0
          : Math.min(1000 * Math.pow(2, nextAttempt1Indexed - 1), 10000);
        if (backoffDelay > 0) {
          logger.info({ bot: this.botName, attempt: attempt + 1, backoffMs: backoffDelay },
            `Backing off ${backoffDelay}ms before retry ${attempt + 2}/${this.config.voyager.maxRetriesPerTask}`);
          await new Promise((r) => setTimeout(r, backoffDelay));
          if (!this.running) return false;
        }

        // Enrich the critique with recovery hints
        const enrichedCritique = recovery
          ? `${recovery.hint}\n\n${criticResult.critique || ''}`
          : criticResult.critique;

        logger.info({ bot: this.botName, attempt: attempt + 1, recoveryPattern: recovery?.pattern || 'none', critique: enrichedCritique?.slice(0, 200) }, 'Retrying with error feedback');
        this.decisionTrace.record('retry_decision', task.description,
          `Retrying (attempt ${attempt + 2}/${this.config.voyager.maxRetriesPerTask})${recovery ? ` [${recovery.pattern}]` : ''}`,
          'retry', { attempt: attempt + 1, error: lastError?.slice(0, 200), recoveryPattern: recovery?.pattern, recoveryHint: recovery?.hint?.slice(0, 200), critique: enrichedCritique?.slice(0, 200) });
        generated = await this.actionAgent.generateCode(
          this.bot, task, this.skillLibrary,
          lastError, generated.functionCode, enrichedCritique, eventLog, blockerSummary, worldMemorySummary
        );
        logger.info({
          bot: this.botName,
          source: 'action-agent',
          functionName: generated.functionName,
          codeLength: generated.functionCode.length,
          execCode: generated.execCode,
        }, 'Code generated by ActionAgent');
        logger.debug({
          bot: this.botName,
          functionName: generated.functionName,
          code: generated.functionCode,
        }, 'Retry generated code body');
      }
    }

    this.curriculumAgent.updateProgress(task, false);
    this.curriculumAgent.getBlockerMemory().recordTaskFailure(task, {
      success: false,
      output: eventLog.slice(0, VoyagerLoop.MAX_FAILURE_OUTPUT_CHARS),
      error: lastError,
      events: [],
    }, lastError || 'task failed');
    this.lastFailedTask = task.description;
    this.blackboardManager?.postMessage(this.botName, 'blocker', `${task.description} failed: ${lastError || 'unknown error'}`);

    // Record failure in social memory
    this.socialMemory?.addMemory(this.botName, 'task_failure', this.botName, `Failed task: ${task.description} - ${lastError || 'unknown'}`, -0.3);
    this.socialMemory?.updateEmotionalState(this.botName, 'task_failure');

    // Report reputation + attribution
    try { this.decisionTrace.emitReputation({ botName: this.botName, type: 'task_failed', description: task.description, timestamp: Date.now(), impact: -0.3 }); } catch { /* ignore */ }
    try { this.skillAttribution?.recordUsage({ skillName: generated.functionName, botName: this.botName, personality: this.personality, context: task.description, success: false, executionTimeMs: Date.now() - (this.lastExecutionMetrics?.timestamp ?? Date.now()), timestamp: Date.now() }); } catch { /* ignore */ }

    this.decisionTrace.record('task_outcome', task.description,
      `Task failed after ${this.config.voyager.maxRetriesPerTask} attempts: ${lastError?.slice(0, 120) || 'unknown'}`,
      'failure', { attempts: this.config.voyager.maxRetriesPerTask, source: codeSource, lastError: lastError?.slice(0, 300) });

    logger.warn({ bot: this.botName, task: task.description, lastError }, 'Task failed after max retries');
    return false;
  }

  /**
   * Use DependencyResolver to turn a replacement hint (e.g. "Obtain oak_planks")
   * into an ordered list of prerequisite task descriptions.
   */
  private resolvePrerequisites(replaceHint: string, originalTask: string): { description: string }[] {
    // Extract item name from hints like "Obtain oak_planks", "Craft a stone_pickaxe"
    const itemMatch = replaceHint.match(/(?:obtain|craft|get|gather|mine)\s+(?:a\s+)?(\d+\s+)?(\w+)/i);
    const itemName = itemMatch?.[2];
    if (!itemName) {
      // Fallback: just queue the hint itself as a single task
      return [{ description: replaceHint }];
    }

    if (!this.dependencyResolver) {
      return [{ description: replaceHint }];
    }

    try {
      const inv = Object.fromEntries(
        this.bot.inventory.items().map((i) => [i.name, i.count])
      );
      const plan = this.dependencyResolver.resolve(itemName, 1, inv);

      if (plan.orderedSteps.length === 0) {
        return [{ description: replaceHint }];
      }

      // Convert FlatSteps into task descriptions
      return plan.orderedSteps
        .map((step) => {
          switch (step.action) {
            case 'mine':
              return { description: `Mine ${step.count} ${step.item.replace(/_/g, ' ')}` };
            case 'craft':
              return { description: `Craft ${step.count} ${step.item.replace(/_/g, ' ')}` };
            case 'smelt':
              return { description: `Smelt ${step.count} ${step.item.replace(/_/g, ' ')}` };
            case 'gather':
              return { description: `Gather ${step.count} ${step.item.replace(/_/g, ' ')}` };
            default:
              return { description: `Obtain ${step.count} ${step.item.replace(/_/g, ' ')}` };
          }
        });
    } catch (err: any) {
      logger.warn({ err: err.message, item: itemName }, 'DependencyResolver failed, falling back to simple replacement');
      return [{ description: replaceHint }];
    }
  }

  /** Record a failed retry attempt; truncates errors and bounds the history. */
  private recordRetryAttempt(taskDescription: string, attempt: number, error: string): void {
    const list = this.retryHistory.get(taskDescription) ?? [];
    list.push({
      attempt,
      // Excerpt — full critic critiques can be very long.
      error: (error || 'unknown').slice(0, 240),
      timestamp: Date.now(),
    });
    this.retryHistory.set(taskDescription, list);
    if (this.retryHistory.size > VoyagerLoop.RETRY_HISTORY_MAX_TASKS) {
      // Drop oldest entry (Map preserves insertion order).
      const oldest = this.retryHistory.keys().next().value;
      if (oldest !== undefined) this.retryHistory.delete(oldest);
    }
  }

  /** Return the retry attempts recorded for recent tasks (keyed by task description). */
  getRetryHistory(): Record<string, { attempt: number; error: string; timestamp: number }[]> {
    const out: Record<string, { attempt: number; error: string; timestamp: number }[]> = {};
    for (const [task, attempts] of this.retryHistory.entries()) {
      out[task] = attempts.slice();
    }
    return out;
  }

  /** Chat a personality-flavored line when starting a player task, rate-limited to 1 per 10s. */
  private maybeAcknowledgeTask(playerName: string): void {
    const now = Date.now();
    if (now - this.lastAckAt < VoyagerLoop.ACK_RATE_LIMIT_MS) return;
    if (!this.bot.chat) return;
    const template = VoyagerLoop.ACK_TEMPLATES[this.personality] ?? VoyagerLoop.ACK_DEFAULT;
    const line = template.replace('[player]', playerName);
    try {
      this.bot.chat(line);
      this.lastAckAt = now;
    } catch { /* ignore chat failures */ }
  }

  /** Chat a short result when a player-requested task succeeds. */
  private maybeReportCompletion(task: Task): void {
    if (!task.requestedBy || !this.bot.chat) return;
    try {
      this.bot.chat(`${task.requestedBy}: Done — ${task.description}.`);
    } catch { /* ignore chat failures */ }
  }

  private taskToSkillName(task: Task): string {
    return task.description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 5)
      .join('_');
  }

  private skillToGeneratedCode(skill: SkillMatch): GeneratedCode {
    const nameMatch = skill.code.match(/^async\s+function\s+(\w+)\s*\(/m);
    const functionName = nameMatch?.[1] || skill.name;
    return {
      functionName,
      functionCode: skill.code,
      execCode: `await ${functionName}(bot);`,
    };
  }

  private estimateSkillQuality(reason: string, code: string): number {
    let quality = 0.75;
    const lowerReason = reason.toLowerCase();
    if (lowerReason.includes('inventory changed') || lowerReason.includes('crafted') || lowerReason.includes('collected')) {
      quality += 0.1;
    }
    if (code.length > 2000) {
      quality -= 0.1;
    }
    if (code.includes('generatedTask')) {
      quality -= 0.15;
    }
    return Math.max(0, Math.min(1, quality));
  }

  /** Get oxygen level, but return 300 (safe) if bot is clearly not underwater. */
  private getOxygenLevel(): number {
    const raw = (this.bot as any).oxygenLevel;
    if (raw === undefined || raw === null) return 300;
    // If oxygen is reported as low but bot is above sea level and not in water, it's a false alarm
    if (raw < 100) {
      try {
        const pos = this.bot.entity?.position;
        if (pos) {
          const blockAtHead = this.bot.blockAt(pos.offset(0, 1, 0));
          const blockAtFeet = this.bot.blockAt(pos);
          const inWater = blockAtHead?.name === 'water' || blockAtFeet?.name === 'water';
          if (!inWater) return 300; // Not actually in water, ignore low oxygen
        }
      } catch { /* ignore */ }
    }
    return raw;
  }

  /**
   * Derive a CHEAP bot→peer sentiment from an inter-bot message and nudge the
   * directed affinity edge. NO LLM call: the message *kind* carries most of the
   * signal (a request for help / resources / a trade offer is a friendly social
   * overture; an alert/threat is negative), and for free-form social/chat we
   * reuse the existing keyword-based `analyzeSentiment` (also non-LLM). Gated
   * entirely behind `config.social.botAffinity` — a no-op when disabled.
   */
  private updateBotAffinity(msg: { from: string; type: string; content: string }): void {
    if (!this.config.social?.botAffinity || !this.affinityManager) return;
    if (!msg.from || msg.from.toLowerCase() === this.botName.toLowerCase()) return;

    let sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
    switch (msg.type) {
      case 'help_request':
      case 'request':
      case 'trade_offer':
        // Reaching out for help / resources / a trade is a friendly overture.
        sentiment = 'POSITIVE';
        break;
      case 'alert':
        // Alerts are about world danger, not the peer. A warning like "creeper
        // will kill us, leave!" must not lower the warner's standing, so stay
        // neutral rather than keyword-scanning (which would read "kill"/"leave"
        // as negative and penalize a helpful peer).
        sentiment = 'NEUTRAL';
        break;
      default:
        // chat / social / inform / broadcast / status — free-form, scan it.
        sentiment = analyzeSentiment(msg.content);
        break;
    }

    if (sentiment === 'POSITIVE') {
      this.affinityManager.onPositiveChat(this.botName, msg.from);
    } else if (sentiment === 'NEGATIVE') {
      this.affinityManager.onNegativeSentiment(this.botName, msg.from);
    }
    // NEUTRAL → leave the edge unchanged (matches player-chat handling).
  }

  /**
   * P3-A behavioral gate. When `social.botAffinity` is on, returns true if the
   * peer's bot→peer affinity is below the configured hostile threshold — used
   * to deprioritize helping / sharing resources with a disliked peer (reuses
   * the same `isHostile` pattern as player-directed task refusal). Always
   * false (no gating) when the flag is off or no affinity manager is wired.
   */
  private async isPeerDisliked(peer: string): Promise<boolean> {
    if (!this.config.social?.botAffinity || !this.affinityManager) return false;
    try {
      return await this.affinityManager.isHostile(this.botName, peer);
    } catch {
      return false;
    }
  }

  /**
   * P3-B — true when this bot TRUSTS a peer (bot→peer affinity at/above the
   * configured trust threshold). Adoption only happens from trusted peers, so a
   * meme spreads along strong social ties (the Sid diffusion result). Returns
   * false (no adoption) when bot affinity is off or the edge can't be read.
   */
  private async isPeerTrusted(peer: string): Promise<boolean> {
    // Trust rides on bot→bot affinity edges, which only exist when P3-A is on —
    // so culture adoption explicitly depends on social.botAffinity being enabled.
    if (!this.config.social?.botAffinity || !this.affinityManager) return false;
    try {
      const scores = await this.affinityManager.getAllForBot(this.botName);
      const score = scores[peer.toLowerCase()];
      if (typeof score !== 'number') return false;
      return score >= (this.config.affinity?.trustThreshold ?? 70);
    } catch {
      return false;
    }
  }

  /**
   * P3-B cultural-meme spread. CHEAP and no-LLM: feed the message into the
   * emergence tally, then keyword-scan it against the registry. If it carries a
   * known meme keyword AND the sender is a peer this bot TRUSTS (high bot→bot
   * affinity, P3-A), adopt the meme — record it in SocialMemory + CultureManager
   * and re-broadcast it via the dormant BotComms.broadcast() so the belief keeps
   * diffusing outward (proximity/peer-scoped). Entirely gated on
   * `config.social.culture`; a complete no-op when the flag is off (the worker
   * doesn't even wire a CultureProxy in that case).
   */
  private async maybeAdoptMeme(msg: { from: string; type: string; content: string }): Promise<void> {
    if (!this.config.social?.culture || !this.cultureManager) return;
    if (!msg.from || msg.from.toLowerCase() === this.botName.toLowerCase()) return;

    // Emergence: count keyword frequency from observed inter-bot chatter so
    // recurring phrases can be promoted into memes by the registry (no LLM).
    this.cultureManager.observeChat(msg.content);

    let meme: { id: string; label: string } | null = null;
    try {
      meme = await this.cultureManager.matchMeme(msg.content);
    } catch {
      meme = null;
    }
    if (!meme) return;

    // Novelty gate: if we already hold this belief, do NOT re-adopt/re-broadcast.
    // Without this, two mutually-trusting bots ping-pong "I believe in X" every
    // cycle (a meme message-storm) and pile duplicate SocialMemory entries.
    if (this.adoptedMemeIds.has(meme.id)) return;

    // Adoption gate: only from a TRUSTED peer (high bot→bot affinity).
    if (!(await this.isPeerTrusted(msg.from))) return;

    this.adoptedMemeIds.add(meme.id);
    this.cultureManager.adopt(meme.id, this.botName);
    this.socialMemory?.addMemory(
      this.botName,
      'observation',
      msg.from,
      `Took to heart the idea "${meme.label}" from ${msg.from}`,
      0.2,
    );
    logger.info({ bot: this.botName, from: msg.from, meme: meme.label }, 'Adopted meme from trusted peer (culture)');

    // Propagation: re-broadcast the belief so it keeps spreading along the
    // social graph. With SHOULD-FIX #1 this `broadcast` goes through the
    // cross-worker BotCommsProxy → main-thread BotComms relay, so it now
    // actually fans out to OTHER bots' worker inboxes (when culture/affinity is
    // on the proxy is wired). The registry/adoption side was already cross-worker
    // via CultureProxy; this completes the loop for the message transport.
    try {
      this.botComms?.broadcast(this.botName, `I believe in ${meme.label}.`, 'chat');
    } catch {
      /* swallow — propagation is best-effort */
    }
  }

  private async processBotMessage(msg: { from: string; type: string; content: string }): Promise<void> {
    const content = msg.content;
    const keywords = content.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2);

    // P3-A: write a directed bot→peer affinity edge from this interaction
    // (flag-gated, cheap/no-LLM). Done before the kind-specific handling so the
    // edge reflects every message we actually process.
    this.updateBotAffinity(msg);

    // P3-B: cheap, no-LLM cultural-meme observation + adoption-from-trusted-peer.
    // Gated on config.social.culture (no-op when off). Done after the affinity
    // edge is updated so adoption sees this message's freshest trust signal.
    await this.maybeAdoptMeme(msg);

    switch (msg.type) {
      case 'help_request':
        // P3-A behavioral hook: deprioritize helping a disliked peer. When the
        // flag is off this is always false, so the help task queues as before.
        if (await this.isPeerDisliked(msg.from)) {
          logger.info({ bot: this.botName, from: msg.from }, 'Declining help request from disliked peer (bot affinity)');
          this.socialMemory?.addMemory(this.botName, 'observation', msg.from, `Ignored help request from disliked peer: ${content}`, -0.1);
          break;
        }
        logger.info({ bot: this.botName, from: msg.from, content }, 'Help request received from bot');
        this.playerTaskQueue.push({ description: content, keywords });
        this.socialMemory?.addMemory(this.botName, 'observation', msg.from, `Help request: ${content}`, 0.3);
        break;
      case 'inform':
        logger.info({ bot: this.botName, from: msg.from, content }, 'Info received from bot');
        this.socialMemory?.addMemory(this.botName, 'observation', msg.from, content, 0.1);
        this.blackboardManager?.postMessage(msg.from, 'info', content);
        break;
      case 'request': {
        logger.info({ bot: this.botName, from: msg.from, content }, 'Resource request from bot');
        // P3-A behavioral hook: refuse to share resources with a disliked peer.
        if (await this.isPeerDisliked(msg.from)) {
          logger.info({ bot: this.botName, from: msg.from }, 'Refusing resource share to disliked peer (bot affinity)');
          this.botComms?.sendMessage(this.botName, msg.from, `I'd rather not share with you right now.`, 'chat');
          this.socialMemory?.addMemory(this.botName, 'trade', msg.from, `Refused resource request from disliked peer: ${content}`, -0.1);
          break;
        }
        const requestedItem = keywords.find((w) => this.bot.inventory.items().some((i) => i.name.includes(w)));
        if (requestedItem) {
          this.playerTaskQueue.push({ description: `Give ${requestedItem} to ${msg.from}`, keywords: ['give', requestedItem, msg.from] });
          this.botComms?.sendMessage(this.botName, msg.from, `I have ${requestedItem}, coming to you.`, 'chat');
        } else {
          this.botComms?.sendMessage(this.botName, msg.from, `Sorry, I don't have what you need.`, 'chat');
        }
        this.socialMemory?.addMemory(this.botName, 'trade', msg.from, content, 0.2);
        break;
      }
      case 'broadcast':
        logger.info({ bot: this.botName, from: msg.from, content }, 'Broadcast received');
        this.blackboardManager?.postMessage(msg.from, 'info', content);
        break;
      case 'social':
        this.socialMemory?.addMemory(this.botName, 'chat', msg.from, content, 0.15);
        break;
      case 'trade_offer':
        // NIT #6 — intentionally NOT gated on isPeerDisliked (unlike
        // help_request / request above). A trade is mutually beneficial and the
        // TradeNegotiator already evaluates whether the proposal is worth it, so
        // we let even a disliked peer make an offer the bot can rationally
        // accept or decline on its own (economic) merits.
        if (this.tradeNegotiator) {
          const proposals = this.tradeNegotiator.processTradeMessages(this.botName, [msg]);
          for (const proposal of proposals) {
            const inv = Object.fromEntries(this.bot.inventory.items().map((i) => [i.name, i.count]));
            const result = this.tradeNegotiator.evaluateProposal(proposal, inv, this.personality);
            if (result.accept) {
              this.botComms?.sendMessage(this.botName, msg.from, `Deal accepted for ${proposal.offering.map((o) => `${o.count} ${o.item}`).join(', ')}`, 'chat');
              this.decisionTrace.emitReputation({ botName: this.botName, type: 'trade_honored', description: `Accepted trade from ${msg.from}`, timestamp: Date.now(), impact: 0.4 });
            } else {
              this.botComms?.sendMessage(this.botName, msg.from, result.reason || 'No deal, sorry.', 'chat');
            }
          }
        }
        break;
      default:
        logger.debug({ bot: this.botName, from: msg.from, type: msg.type }, 'Unknown bot message type');
    }
  }
}
