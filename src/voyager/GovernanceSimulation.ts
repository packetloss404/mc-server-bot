import { logger } from '../util/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DecreeType =
  | 'resource_priority'
  | 'construction_order'
  | 'defense_alert'
  | 'role_reassignment'
  | 'trade_policy'
  | 'exploration_directive'
  | 'festival'
  | 'rationing';

export interface Decree {
  id: string;
  type: DecreeType;
  title: string;
  description: string;
  issuedBy: string;
  targets: string[];
  effects: Record<string, unknown>;
  priority: number;
  issuedAt: number;
  expiresAt?: number;
  status: 'active' | 'completed' | 'revoked';
}

export interface CouncilVote {
  decree: Decree;
  votes: Record<string, 'approve' | 'reject' | 'abstain'>;
  result: 'approved' | 'rejected' | 'pending';
  votedAt: number;
}

export interface GovernanceState {
  leader: string;
  activeDecrees: Decree[];
  recentVotes: CouncilVote[];
  resourceBudget: Record<string, number>;
  taxRate: number;
}

export interface GovernanceInput {
  resourceSupply: Record<string, number>;
  botStates: Array<{
    name: string;
    personality: string;
    idle: boolean;
    currentTask?: string;
    health: number;
  }>;
  activeThreatCount: number;
  pendingTaskCount: number;
  playerCount: number;
  settlementProgress: number;
  recentEvents: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let decreeCounter = 0;

function generateDecreeId(): string {
  return `decree_${Date.now()}_${++decreeCounter}`;
}

/** Resources considered critical for survival / progression. */
const CRITICAL_RESOURCES: Record<string, number> = {
  oak_log: 16,
  cobblestone: 32,
  iron_ingot: 8,
  coal: 16,
  diamond: 2,
};

const SETTLEMENT_TARGET = 0.6;
const IDLE_RATIO_THRESHOLD = 0.5;
const EXPLORED_CHUNKS_PROXY_THRESHOLD = 0.3; // re-use settlementProgress as proxy
const MAX_TAX_RATE = 0.3;
const MAX_RECENT_VOTES = 50;

// ---------------------------------------------------------------------------
// GovernanceSimulation
// ---------------------------------------------------------------------------

export class GovernanceSimulation {
  private readonly elderBotName: string;
  private activeDecrees: Decree[] = [];
  private recentVotes: CouncilVote[] = [];
  private resourceBudget: Record<string, number> = {};
  private taxRate = 0.05;

  constructor(elderBotName: string) {
    this.elderBotName = elderBotName;
    logger.info({ elder: elderBotName }, 'GovernanceSimulation initialised');
  }

  // -----------------------------------------------------------------------
  // Evaluate world state and issue decrees
  // -----------------------------------------------------------------------

  evaluate(worldState: GovernanceInput): Decree[] {
    const issued: Decree[] = [];
    const botCount = worldState.botStates.length || 1;

    // Expire stale decrees
    this.expireDecrees();

    // 1. Defense alert (priority 10)
    if (worldState.activeThreatCount > 3) {
      const guards = worldState.botStates
        .filter((b) => b.personality === 'guard')
        .map((b) => b.name);
      const others = worldState.botStates
        .filter((b) => b.personality !== 'guard')
        .map((b) => b.name);

      const decree = this.issueDecree({
        type: 'defense_alert',
        title: 'Threat level critical – all guards mobilise',
        description: `${worldState.activeThreatCount} active threats detected. Guards patrol perimeter, all others shelter immediately.`,
        issuedBy: this.elderBotName,
        targets: ['__all__'],
        effects: {
          guardAction: 'patrol',
          guardBots: guards,
          shelterBots: others,
          threatCount: worldState.activeThreatCount,
        },
        priority: 10,
      });
      issued.push(decree);
    }

    // 2. Rationing (priority 8)
    const foodSupply =
      (worldState.resourceSupply['bread'] ?? 0) +
      (worldState.resourceSupply['cooked_beef'] ?? 0) +
      (worldState.resourceSupply['cooked_porkchop'] ?? 0) +
      (worldState.resourceSupply['apple'] ?? 0) +
      (worldState.resourceSupply['baked_potato'] ?? 0) +
      (worldState.resourceSupply['wheat'] ?? 0);

    if (foodSupply < botCount * 10) {
      const farmers = worldState.botStates
        .filter((b) => b.personality === 'farmer')
        .map((b) => b.name);

      const decree = this.issueDecree({
        type: 'rationing',
        title: 'Food shortage – rationing in effect',
        description: `Food supply (${foodSupply}) is below safe threshold (${botCount * 10}). Farmers prioritise food production; exploration and building paused.`,
        issuedBy: this.elderBotName,
        targets: farmers.length > 0 ? farmers : ['__all__'],
        effects: {
          action: 'prioritise_food',
          currentSupply: foodSupply,
          requiredSupply: botCount * 10,
          pauseActivities: ['exploration', 'building'],
        },
        priority: 8,
      });
      issued.push(decree);
    }

    // 3. Resource priority (priority 7)
    for (const [resource, minThreshold] of Object.entries(CRITICAL_RESOURCES)) {
      const supply = worldState.resourceSupply[resource] ?? 0;
      if (supply < minThreshold) {
        // Avoid duplicate decrees for same resource
        if (this.activeDecrees.some((d) => d.type === 'resource_priority' && (d.effects as any).resource === resource)) {
          continue;
        }
        const miners = worldState.botStates
          .filter((b) => b.personality === 'blacksmith' || b.personality === 'explorer')
          .map((b) => b.name);

        const decree = this.issueDecree({
          type: 'resource_priority',
          title: `Critical shortage: ${resource}`,
          description: `${resource} supply (${supply}) is below minimum (${minThreshold}). Redirecting miners to gather.`,
          issuedBy: this.elderBotName,
          targets: miners.length > 0 ? miners : ['__all__'],
          effects: {
            resource,
            currentSupply: supply,
            requiredSupply: minThreshold,
            action: 'gather',
          },
          priority: 7,
        });
        issued.push(decree);
        break; // only address the most critical shortage per evaluation
      }
    }

    // 4. Construction order (priority 5)
    if (worldState.settlementProgress < SETTLEMENT_TARGET) {
      const builders = worldState.botStates
        .filter((b) => b.personality === 'blacksmith' || b.personality === 'farmer')
        .map((b) => b.name);

      if (
        !this.activeDecrees.some((d) => d.type === 'construction_order')
      ) {
        const decree = this.issueDecree({
          type: 'construction_order',
          title: 'Settlement expansion needed',
          description: `Settlement progress (${(worldState.settlementProgress * 100).toFixed(0)}%) is below target (${(SETTLEMENT_TARGET * 100).toFixed(0)}%). Builders assigned to next structure.`,
          issuedBy: this.elderBotName,
          targets: builders.length > 0 ? builders : ['__all__'],
          effects: {
            action: 'build_next_structure',
            currentProgress: worldState.settlementProgress,
            targetProgress: SETTLEMENT_TARGET,
          },
          priority: 5,
        });
        issued.push(decree);
      }
    }

    // 5. Role reassignment (priority 4)
    const idleBots = worldState.botStates.filter((b) => b.idle);
    if (idleBots.length / botCount > IDLE_RATIO_THRESHOLD && idleBots.length > 1) {
      const decree = this.issueDecree({
        type: 'role_reassignment',
        title: 'Idle bots reassigned',
        description: `${idleBots.length}/${botCount} bots are idle. Reassigning to highest-need roles.`,
        issuedBy: this.elderBotName,
        targets: idleBots.map((b) => b.name),
        effects: {
          action: 'reassign_to_need',
          idleBotCount: idleBots.length,
          pendingTasks: worldState.pendingTaskCount,
        },
        priority: 4,
      });
      issued.push(decree);
    }

    // 6. Exploration directive (priority 3)
    if (
      worldState.settlementProgress < EXPLORED_CHUNKS_PROXY_THRESHOLD &&
      !this.activeDecrees.some((d) => d.type === 'exploration_directive')
    ) {
      const explorers = worldState.botStates
        .filter((b) => b.personality === 'explorer')
        .map((b) => b.name);

      if (explorers.length > 0) {
        const decree = this.issueDecree({
          type: 'exploration_directive',
          title: 'Expand explored territory',
          description: 'Explored area is below threshold. Explorer bots dispatched to chart new regions.',
          issuedBy: this.elderBotName,
          targets: explorers,
          effects: {
            action: 'explore_new_chunks',
            explorationLevel: worldState.settlementProgress,
          },
          priority: 3,
        });
        issued.push(decree);
      }
    }

    // 7. Trade policy (priority 2)
    if (
      worldState.playerCount > 0 &&
      !this.activeDecrees.some((d) => d.type === 'trade_policy')
    ) {
      const merchants = worldState.botStates
        .filter((b) => b.personality === 'merchant')
        .map((b) => b.name);

      const decree = this.issueDecree({
        type: 'trade_policy',
        title: 'Trade policy for visiting players',
        description: `${worldState.playerCount} player(s) online. Merchant bots set up trade stalls with dynamic pricing.`,
        issuedBy: this.elderBotName,
        targets: merchants.length > 0 ? merchants : ['__all__'],
        effects: {
          action: 'open_trade',
          playerCount: worldState.playerCount,
          pricingStrategy: 'supply_demand',
        },
        priority: 2,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      });
      issued.push(decree);
    }

    // 8. Festival (priority 1)
    const basicNeedsMet =
      foodSupply >= botCount * 10 &&
      worldState.activeThreatCount === 0 &&
      worldState.settlementProgress >= SETTLEMENT_TARGET;

    const noHighPriorityDecrees = this.activeDecrees.every((d) => d.priority <= 2);

    if (
      basicNeedsMet &&
      noHighPriorityDecrees &&
      !this.activeDecrees.some((d) => d.type === 'festival')
    ) {
      const decree = this.issueDecree({
        type: 'festival',
        title: 'Settlement festival!',
        description: 'All basic needs are met and the settlement is thriving. Time for decorative building and social activities.',
        issuedBy: this.elderBotName,
        targets: ['__all__'],
        effects: {
          action: 'celebrate',
          activities: ['decorative_building', 'social_gathering', 'fireworks'],
        },
        priority: 1,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
      });
      issued.push(decree);
    }

    if (issued.length > 0) {
      logger.info(
        { elder: this.elderBotName, decreeCount: issued.length, types: issued.map((d) => d.type) },
        'Elder evaluated world state and issued decrees',
      );
    }

    return issued;
  }

  // -----------------------------------------------------------------------
  // Decree management
  // -----------------------------------------------------------------------

  issueDecree(
    input: Omit<Decree, 'id' | 'issuedAt' | 'status'> & { expiresAt?: number },
  ): Decree {
    const decree: Decree = {
      ...input,
      id: generateDecreeId(),
      issuedAt: Date.now(),
      status: 'active',
    };
    this.activeDecrees.push(decree);
    logger.info(
      { decreeId: decree.id, type: decree.type, title: decree.title },
      'Decree issued',
    );
    return decree;
  }

  revokeDecree(decreeId: string): boolean {
    const decree = this.activeDecrees.find((d) => d.id === decreeId);
    if (!decree) {
      logger.warn({ decreeId }, 'Cannot revoke – decree not found');
      return false;
    }
    decree.status = 'revoked';
    this.activeDecrees = this.activeDecrees.filter((d) => d.id !== decreeId);
    logger.info({ decreeId, type: decree.type }, 'Decree revoked');
    return true;
  }

  // -----------------------------------------------------------------------
  // Council voting
  // -----------------------------------------------------------------------

  callVote(decree: Decree, botNames: string[]): CouncilVote {
    const votes: Record<string, 'approve' | 'reject' | 'abstain'> = {};
    for (const name of botNames) {
      votes[name] = 'abstain'; // default until cast
    }
    const councilVote: CouncilVote = {
      decree,
      votes,
      result: 'pending',
      votedAt: Date.now(),
    };
    this.recentVotes.push(councilVote);

    // Cap stored votes
    if (this.recentVotes.length > MAX_RECENT_VOTES) {
      this.recentVotes = this.recentVotes.slice(-MAX_RECENT_VOTES);
    }

    logger.info(
      { decreeId: decree.id, voters: botNames },
      'Council vote called',
    );
    return councilVote;
  }

  castVote(
    decreeId: string,
    botName: string,
    vote: 'approve' | 'reject' | 'abstain',
  ): boolean {
    const councilVote = this.recentVotes.find(
      (v) => v.decree.id === decreeId && v.result === 'pending',
    );
    if (!councilVote) {
      logger.warn({ decreeId, botName }, 'Cannot cast vote – no pending vote found for decree');
      return false;
    }
    if (!(botName in councilVote.votes)) {
      logger.warn({ decreeId, botName }, 'Bot is not a registered voter for this decree');
      return false;
    }
    councilVote.votes[botName] = vote;
    logger.debug({ decreeId, botName, vote }, 'Vote cast');
    return true;
  }

  tallyVotes(decreeId: string): CouncilVote | undefined {
    const councilVote = this.recentVotes.find(
      (v) => v.decree.id === decreeId,
    );
    if (!councilVote) {
      logger.warn({ decreeId }, 'Cannot tally – vote not found');
      return undefined;
    }

    const entries = Object.values(councilVote.votes);
    const approvals = entries.filter((v) => v === 'approve').length;
    const rejections = entries.filter((v) => v === 'reject').length;
    const participating = entries.filter((v) => v !== 'abstain').length;

    // Majority of participating voters required
    if (participating === 0) {
      councilVote.result = 'rejected';
    } else if (approvals > participating / 2) {
      councilVote.result = 'approved';
    } else {
      councilVote.result = 'rejected';
    }

    logger.info(
      { decreeId, approvals, rejections, abstentions: entries.length - participating, result: councilVote.result },
      'Vote tallied',
    );

    // If approved, ensure the decree stays active; if rejected, revoke it
    if (councilVote.result === 'rejected') {
      this.revokeDecree(decreeId);
    }

    return councilVote;
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  getActiveDecrees(): Decree[] {
    this.expireDecrees();
    return [...this.activeDecrees];
  }

  getGovernanceState(): GovernanceState {
    this.expireDecrees();
    return {
      leader: this.elderBotName,
      activeDecrees: [...this.activeDecrees],
      recentVotes: [...this.recentVotes],
      resourceBudget: { ...this.resourceBudget },
      taxRate: this.taxRate,
    };
  }

  // -----------------------------------------------------------------------
  // Taxation
  // -----------------------------------------------------------------------

  applyTaxation(
    botInventories: Record<string, Record<string, number>>,
  ): Record<string, Record<string, number>> {
    const contributions: Record<string, Record<string, number>> = {};

    for (const [botName, inventory] of Object.entries(botInventories)) {
      contributions[botName] = {};
      for (const [item, count] of Object.entries(inventory)) {
        const taxed = Math.floor(count * this.taxRate);
        if (taxed > 0) {
          contributions[botName][item] = taxed;
          this.resourceBudget[item] = (this.resourceBudget[item] ?? 0) + taxed;
        }
      }
    }

    logger.info(
      { taxRate: this.taxRate, budgetSnapshot: this.resourceBudget },
      'Taxation applied – communal budget updated',
    );

    return contributions;
  }

  /** Update the tax rate (clamped to 0 – MAX_TAX_RATE). */
  setTaxRate(rate: number): void {
    this.taxRate = Math.max(0, Math.min(MAX_TAX_RATE, rate));
    logger.info({ taxRate: this.taxRate }, 'Tax rate updated');
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private expireDecrees(): void {
    const now = Date.now();
    this.activeDecrees = this.activeDecrees.filter((d) => {
      if (d.expiresAt && d.expiresAt <= now) {
        d.status = 'completed';
        logger.debug({ decreeId: d.id, type: d.type }, 'Decree expired');
        return false;
      }
      return d.status === 'active';
    });
  }
}
