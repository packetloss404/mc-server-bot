import { logger } from '../util/logger';

export interface TradeProposal {
  id: string;
  fromBot: string;
  toBot: string;
  offering: { item: string; count: number }[];
  requesting: { item: string; count: number }[];
  meetingPoint?: { x: number; y: number; z: number };
  status: 'proposed' | 'counter_offered' | 'accepted' | 'declined' | 'completed' | 'expired';
  createdAt: number;
  expiresAt: number;
  counterOffer?: {
    offering: { item: string; count: number }[];
    requesting: { item: string; count: number }[];
  };
}

export interface NegotiationResult {
  success: boolean;
  proposal: TradeProposal;
  reason?: string;
}

interface EvaluationResult {
  accept: boolean;
  reason: string;
  counterOffer?: {
    offering: { item: string; count: number }[];
    requesting: { item: string; count: number }[];
  };
}

/** Simple tier-based item values used for trade ratio calculations. */
const ITEM_VALUES: Record<string, number> = {
  diamond: 100,
  emerald: 80,
  gold_ingot: 50,
  iron_ingot: 25,
  copper_ingot: 10,
  diamond_pickaxe: 300,
  diamond_sword: 300,
  diamond_axe: 300,
  diamond_shovel: 200,
  iron_pickaxe: 80,
  iron_sword: 80,
  iron_axe: 80,
  iron_shovel: 60,
  stone_pickaxe: 15,
  stone_sword: 15,
  stone_axe: 15,
  cooked_beef: 15,
  cooked_porkchop: 15,
  cooked_chicken: 12,
  bread: 10,
  apple: 8,
  wheat: 5,
  oak_log: 3,
  spruce_log: 3,
  birch_log: 3,
  jungle_log: 3,
  oak_planks: 1,
  spruce_planks: 1,
  cobblestone: 1,
  dirt: 1,
  sand: 1,
  gravel: 1,
};

const DEFAULT_ITEM_VALUE = 2;

const TRADE_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes

/** Personality-based acceptance thresholds. */
const PERSONALITY_THRESHOLDS: Record<string, number> = {
  merchant: 0.8,
  farmer: 0.6,
  guard: 0.7,
  elder: 0.5,
  explorer: 0.6,
};

/** Blacksmith uses different thresholds depending on item category. */
const BLACKSMITH_TOOL_THRESHOLD = 0.9;
const BLACKSMITH_RAW_THRESHOLD = 0.7;

function isTool(item: string): boolean {
  return /pickaxe|sword|axe|shovel|hoe/.test(item);
}

function itemValue(item: string): number {
  return ITEM_VALUES[item] ?? DEFAULT_ITEM_VALUE;
}

function stackValue(stack: { item: string; count: number }[]): number {
  return stack.reduce((sum, s) => sum + itemValue(s.item) * s.count, 0);
}

function generateId(): string {
  return `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Handles inter-bot trade negotiation via the BotComms messaging system.
 *
 * Trade messages follow the format:
 *   TRADE:<offering_item>:<count>:<requesting_item>:<count>
 *
 * For multi-item trades, items are separated by semicolons:
 *   TRADE:<item>:<count>;<item>:<count>:FOR:<item>:<count>
 */
export class TradeNegotiator {
  private proposals: Map<string, TradeProposal> = new Map();
  private personality: string;

  constructor(personality: string) {
    this.personality = personality.toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // Proposal lifecycle
  // ---------------------------------------------------------------------------

  /** Create a new trade proposal and store it. */
  proposeTrade(
    fromBot: string,
    toBot: string,
    offering: { item: string; count: number }[],
    requesting: { item: string; count: number }[],
  ): TradeProposal {
    const now = Date.now();
    const proposal: TradeProposal = {
      id: generateId(),
      fromBot: fromBot.toLowerCase(),
      toBot: toBot.toLowerCase(),
      offering,
      requesting,
      status: 'proposed',
      createdAt: now,
      expiresAt: now + TRADE_EXPIRY_MS,
    };

    this.proposals.set(proposal.id, proposal);
    logger.info(
      { proposalId: proposal.id, from: fromBot, to: toBot, offering, requesting },
      'Trade proposed',
    );
    return proposal;
  }

  /** Evaluate whether to accept a proposal based on inventory and personality. */
  evaluateProposal(
    proposal: TradeProposal,
    evaluatorInventory: Record<string, number>,
    evaluatorPersonality: string,
  ): EvaluationResult {
    const personality = evaluatorPersonality.toLowerCase();

    // Check the evaluator actually has the requested items
    for (const req of proposal.requesting) {
      const have = evaluatorInventory[req.item] ?? 0;
      if (have < req.count) {
        return {
          accept: false,
          reason: `Insufficient ${req.item}: have ${have}, need ${req.count}`,
        };
      }
    }

    // Calculate value ratio from the evaluator's perspective:
    // what they receive (the proposer's offering) vs what they give up (the proposer's requesting)
    const receiveValue = stackValue(proposal.offering);
    const giveValue = stackValue(proposal.requesting);

    if (giveValue === 0) {
      // Free stuff — always accept
      return { accept: true, reason: 'Free items offered' };
    }

    const ratio = receiveValue / giveValue;

    // Determine threshold
    let threshold: number;
    if (personality === 'blacksmith') {
      const requestsTools = proposal.requesting.some(r => isTool(r.item));
      threshold = requestsTools ? BLACKSMITH_TOOL_THRESHOLD : BLACKSMITH_RAW_THRESHOLD;
    } else {
      threshold = PERSONALITY_THRESHOLDS[personality] ?? 0.7;
    }

    if (ratio >= threshold) {
      const stored = this.proposals.get(proposal.id);
      if (stored) stored.status = 'accepted';
      return {
        accept: true,
        reason: `Value ratio ${ratio.toFixed(2)} meets ${personality} threshold ${threshold}`,
      };
    }

    // Decline — attach a counter-offer suggestion
    const counter = this.generateCounterOffer(proposal, evaluatorInventory);
    const stored = this.proposals.get(proposal.id);
    if (stored) {
      stored.status = 'declined';
    }

    return {
      accept: false,
      reason: `Value ratio ${ratio.toFixed(2)} below ${personality} threshold ${threshold}`,
      counterOffer: counter ?? undefined,
    };
  }

  /**
   * Generate a counter-offer that adjusts quantities toward a 1:1 value ratio,
   * or substitutes items the evaluator has a surplus of.
   */
  generateCounterOffer(
    proposal: TradeProposal,
    evaluatorInventory: Record<string, number>,
  ): { offering: { item: string; count: number }[]; requesting: { item: string; count: number }[] } | null {
    const receiveValue = stackValue(proposal.offering);
    const giveValue = stackValue(proposal.requesting);

    if (giveValue === 0 || receiveValue === 0) return null;

    const ratio = receiveValue / giveValue;

    // Strategy 1: Adjust counts to bring ratio closer to 1.0
    if (ratio < 1) {
      // The evaluator is being asked to give too much — reduce what they give
      const adjustedRequesting = proposal.requesting.map(r => {
        const adjusted = Math.max(1, Math.floor(r.count * ratio));
        return { item: r.item, count: adjusted };
      });
      return { offering: [...proposal.offering], requesting: adjustedRequesting };
    }

    // ratio >= 1 means the deal already favours the evaluator. Unlikely to
    // reach here since we only counter-offer on decline, but handle gracefully.
    // Ask for more of the offered items.
    const adjustedOffering = proposal.offering.map(o => {
      const adjusted = Math.ceil(o.count / ratio);
      return { item: o.item, count: Math.max(1, adjusted) };
    });
    return { offering: adjustedOffering, requesting: [...proposal.requesting] };
  }

  // ---------------------------------------------------------------------------
  // Message parsing
  // ---------------------------------------------------------------------------

  /**
   * Parse incoming BotComms messages for trade-related content.
   *
   * Supported formats:
   *   TRADE:<offering_item>:<count>:<requesting_item>:<count>
   *
   * Returns parsed TradeProposals (status = 'proposed').
   */
  processTradeMessages(
    botName: string,
    messages: Array<{ from: string; type: string; content: string }>,
  ): TradeProposal[] {
    const parsed: TradeProposal[] = [];
    const tradePattern = /^TRADE:(\w+):(\d+):(\w+):(\d+)$/;

    for (const msg of messages) {
      if (msg.type !== 'trade_offer' && !msg.content.startsWith('TRADE:')) continue;

      const match = msg.content.match(tradePattern);
      if (!match) {
        logger.debug({ content: msg.content }, 'Unrecognised trade message format');
        continue;
      }

      const [, offerItem, offerCount, reqItem, reqCount] = match;
      const now = Date.now();
      const proposal: TradeProposal = {
        id: generateId(),
        fromBot: msg.from.toLowerCase(),
        toBot: botName.toLowerCase(),
        offering: [{ item: offerItem, count: parseInt(offerCount, 10) }],
        requesting: [{ item: reqItem, count: parseInt(reqCount, 10) }],
        status: 'proposed',
        createdAt: now,
        expiresAt: now + TRADE_EXPIRY_MS,
      };

      this.proposals.set(proposal.id, proposal);
      parsed.push(proposal);
      logger.info(
        { proposalId: proposal.id, from: msg.from, to: botName },
        'Trade proposal parsed from message',
      );
    }

    return parsed;
  }

  // ---------------------------------------------------------------------------
  // Queries & housekeeping
  // ---------------------------------------------------------------------------

  /** Return all non-expired proposals, optionally filtered by bot name. */
  getActiveProposals(botName?: string): TradeProposal[] {
    const now = Date.now();
    const active: TradeProposal[] = [];

    for (const p of this.proposals.values()) {
      if (p.expiresAt < now) continue;
      if (p.status === 'completed' || p.status === 'expired') continue;
      if (botName) {
        const key = botName.toLowerCase();
        if (p.fromBot !== key && p.toBot !== key) continue;
      }
      active.push(p);
    }
    return active;
  }

  /** Mark a proposal as completed. */
  completeProposal(proposalId: string): void {
    const p = this.proposals.get(proposalId);
    if (!p) {
      logger.warn({ proposalId }, 'Cannot complete unknown proposal');
      return;
    }
    p.status = 'completed';
    logger.info({ proposalId, from: p.fromBot, to: p.toBot }, 'Trade completed');
  }

  /** Expire proposals past their deadline. */
  expireStale(): number {
    const now = Date.now();
    let count = 0;
    for (const p of this.proposals.values()) {
      if (p.expiresAt < now && p.status !== 'completed' && p.status !== 'expired') {
        p.status = 'expired';
        count++;
      }
    }
    if (count > 0) {
      logger.debug({ expired: count }, 'Expired stale trade proposals');
    }
    return count;
  }
}
