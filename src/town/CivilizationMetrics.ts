/**
 * Civilization-progress metrics — Project Sid P1-B.
 *
 * Sid measures an emergent society with a handful of scalar "health" signals.
 * This module is the PURE math layer behind `GET /api/metrics/civilization`:
 * every function here is deterministic and I/O-free so it can be unit-tested in
 * isolation. The API handler is responsible for gathering the raw data
 * (observed roles of the current fleet + per-bot action tallies from
 * `data/stats.json`) and feeding it in.
 *
 * The three headline metrics, mapped to the paper:
 *   - `shannonEntropy`   — Fig-8E: role-distribution entropy (bits). High entropy
 *                          means a diverse division of labour; collapse toward a
 *                          single role drives it down.
 *   - `actionExclusivity`— Fig-9: how concentrated each action type is in a single
 *                          bot (specialisation vs. everyone-does-everything).
 *   - `uniqueItems`      — Fig-5: tech-tree progress, the count of distinct items
 *                          the fleet has mined+crafted.
 */

import type { BotActionStats } from './ObservedRoleModel';

/**
 * Shannon entropy in **bits** (log base 2) over a list of category counts.
 *
 * H = -Σ p_i · log2(p_i), where p_i = count_i / Σcounts. Zero counts contribute
 * nothing (0·log0 ≡ 0). Returns 0 for an empty/all-zero input (no distribution).
 *
 * Properties (used as the spec for the unit tests):
 *  - a uniform distribution over N categories yields log2(N) bits
 *    (e.g. 4 equal roles → 2.0 bits);
 *  - a distribution with all mass on one category yields 0 bits.
 */
export function shannonEntropy(counts: number[]): number {
  const total = counts.reduce((s, c) => s + (c > 0 ? c : 0), 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Build a histogram (count per category) from a list of category labels.
 * Categories not present simply don't appear. Order of keys is insertion order.
 */
export function roleHistogram(roles: string[]): Record<string, number> {
  const hist: Record<string, number> = {};
  for (const role of roles) {
    hist[role] = (hist[role] || 0) + 1;
  }
  return hist;
}

/**
 * Action-exclusivity index in [0, 1] over a per-bot action-count matrix.
 *
 * Input shape: a map of `actionType -> (botName -> count)`. For each action type
 * we compute its "max-share" = (largest single-bot count) / (total across all
 * bots for that action). A max-share of 1 means exactly one bot performs that
 * action (perfectly exclusive / specialised); 1/N means it is spread evenly
 * across N bots. The index is the mean of the max-shares over all action types
 * that have any activity. Action types with zero total are skipped (an action
 * nobody performs carries no information about specialisation).
 *
 * Returns 0 when there is no activity at all.
 *
 * Properties (spec for the unit tests):
 *  - if every action type is performed entirely by a single (possibly different)
 *    bot, the index is 1;
 *  - sharing an action across multiple bots lowers its contribution, so a fleet
 *    where actions are evenly split scores well below 1.
 */
export function actionExclusivity(
  matrix: Record<string, Record<string, number>>,
): number {
  let shareSum = 0;
  let activeActions = 0;
  for (const perBot of Object.values(matrix)) {
    let total = 0;
    let max = 0;
    for (const count of Object.values(perBot)) {
      const c = count > 0 ? count : 0;
      total += c;
      if (c > max) max = c;
    }
    if (total <= 0) continue;
    shareSum += max / total;
    activeActions += 1;
  }
  if (activeActions === 0) return 0;
  return shareSum / activeActions;
}

export interface UniqueItemsResult {
  /** Count of distinct item ids mined+crafted across the whole fleet. */
  distinct: number;
  /** Cumulative total quantity mined+crafted across the whole fleet. */
  total: number;
  /** The distinct item ids, sorted, for display/debugging. */
  items: string[];
}

/**
 * Tech-tree progress (Sid Fig-5): the set of distinct items the fleet has
 * **mined or crafted**, plus the cumulative quantity.
 *
 * `distinct` dedupes across bots and across the mined/crafted buckets — an
 * item counts once toward `distinct` no matter how many bots touched it or how
 * many times. `total` sums every mined+crafted quantity across the fleet.
 */
export function uniqueItems(stats: BotActionStats[]): UniqueItemsResult {
  const seen = new Set<string>();
  let total = 0;
  for (const row of stats) {
    for (const bucket of [row.mined, row.crafted]) {
      if (!bucket) continue;
      for (const [item, count] of Object.entries(bucket)) {
        const qty = Number(count) || 0;
        if (qty <= 0) continue;
        seen.add(item);
        total += qty;
      }
    }
  }
  return { distinct: seen.size, total, items: [...seen].sort() };
}

export interface CivilizationMetrics {
  /** Shannon entropy (bits) over the observed-role distribution. */
  roleEntropy: number;
  /** Action-exclusivity index in [0, 1] (Sid Fig-9). */
  actionExclusivity: number;
  /** Tech-tree progress: distinct + cumulative items mined+crafted. */
  uniqueItems: UniqueItemsResult;
  /** Observed-role histogram (role -> bot count). */
  roleDistribution: Record<string, number>;
}

/**
 * Build the per-action-type matrix `actionType -> (botName -> count)` from a map
 * of `botName -> BotActionStats`. Each of the seven action buckets becomes one
 * action-type row, summing the per-item counts into a single per-bot total for
 * that action. This is the shape `actionExclusivity` consumes.
 */
export function buildActionMatrix(
  byBot: Record<string, BotActionStats>,
): Record<string, Record<string, number>> {
  const ACTION_KEYS: (keyof BotActionStats)[] = [
    'mined',
    'crafted',
    'smelted',
    'placed',
    'killed',
    'withdrew',
    'deposited',
  ];
  const matrix: Record<string, Record<string, number>> = {};
  for (const action of ACTION_KEYS) matrix[action] = {};
  for (const [botName, row] of Object.entries(byBot)) {
    for (const action of ACTION_KEYS) {
      const bucket = row[action];
      if (!bucket) continue;
      let sum = 0;
      for (const v of Object.values(bucket)) sum += Number(v) || 0;
      if (sum > 0) matrix[action][botName] = sum;
    }
  }
  return matrix;
}

/**
 * Top-level aggregator: combine the observed-role list of the current fleet and
 * the per-bot action stats into the full civilization-metrics payload. Pure —
 * the API handler gathers the inputs and calls this.
 */
export function computeCivilizationMetrics(
  observedRoles: string[],
  statsByBot: Record<string, BotActionStats>,
): CivilizationMetrics {
  const roleDistribution = roleHistogram(observedRoles);
  const roleEntropy = shannonEntropy(Object.values(roleDistribution));
  const matrix = buildActionMatrix(statsByBot);
  return {
    roleEntropy,
    actionExclusivity: actionExclusivity(matrix),
    uniqueItems: uniqueItems(Object.values(statsByBot)),
    roleDistribution,
  };
}
