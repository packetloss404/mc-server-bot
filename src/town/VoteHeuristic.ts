/**
 * VoteHeuristic — Phase 6-B simple personality-driven approval voting.
 *
 * For Phase 6 we deliberately keep this LLM-free: every resident bot has a
 * personality string (merchant | guard | explorer | farmer | blacksmith |
 * elder, plus future extensions) and casts a yes/no vote based on a static
 * lookup table per approval kind. Phase 8 swaps this out for an LLM-driven
 * vote that takes town context into account; until then a deterministic
 * heuristic is enough to exercise the approval queue end-to-end.
 *
 * Defaults:
 *   - Unknown personality → 'yes' (residents tend to defer to the brain).
 *   - Unknown approval kind → 'yes' (don't block on a kind we haven't taught
 *     the heuristic about; the mayor flow remains the real veto path).
 */
export type VoteChoice = 'yes' | 'no';

/**
 * The shape ApprovalManager hands to each voter. Kept loose so future kinds
 * can wedge their own payload shape without forcing a heuristic re-design.
 */
export interface ApprovalContextForVote {
  kind: string;
  payload: unknown;
}

/**
 * Vote table — keys are personalities (lowercased), values are per-kind
 * choices. A missing kind for a personality falls through to the per-kind
 * default below.
 */
const PERSONALITY_VOTES: Record<string, Record<string, VoteChoice>> = {
  guard: {
    // Guards are cautious about expansion (more land = harder to defend).
    expansion: 'no',
    construction: 'yes',
    decree: 'yes',
  },
  elder: {
    // Elders bless milestones and child towns.
    expansion: 'yes',
    milestone: 'yes',
    decree: 'yes',
    construction: 'yes',
  },
  merchant: {
    // Merchants love new markets — expansion good, decrees neutral.
    expansion: 'yes',
    construction: 'yes',
    decree: 'yes',
  },
  farmer: {
    // Farmers want food security; new towns split the field labour pool.
    expansion: 'no',
    construction: 'yes',
    decree: 'yes',
  },
  blacksmith: {
    // Blacksmiths want infrastructure built; expansion is fine.
    expansion: 'yes',
    construction: 'yes',
    decree: 'yes',
  },
  explorer: {
    // Explorers always want to expand.
    expansion: 'yes',
    construction: 'yes',
    decree: 'yes',
  },
  builder: {
    expansion: 'yes',
    construction: 'yes',
    decree: 'yes',
  },
};

/** Per-kind fallback when a personality doesn't have an explicit vote. */
const KIND_DEFAULTS: Record<string, VoteChoice> = {
  expansion: 'yes',
  construction: 'yes',
  milestone: 'yes',
  decree: 'yes',
};

/**
 * Decide a single bot's vote for an approval. Pure function — no I/O, no
 * randomness. Easy to test and easy to reason about.
 */
export function voteFor(
  personality: string | null | undefined,
  kind: string,
  _payload: unknown = null,
): VoteChoice {
  const p = (personality ?? '').toLowerCase();
  const k = (kind ?? '').toLowerCase();
  const perPersonality = PERSONALITY_VOTES[p];
  if (perPersonality && perPersonality[k] !== undefined) {
    return perPersonality[k];
  }
  if (KIND_DEFAULTS[k] !== undefined) return KIND_DEFAULTS[k];
  return 'yes';
}
