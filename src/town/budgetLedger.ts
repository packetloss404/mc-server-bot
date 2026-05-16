/**
 * budgetLedger — tiny per-town JSON persistence for daily LLM/chronicle spend.
 *
 * Followup #45 (partial): persist the running daily spend totals so a brain
 * restart doesn't immediately re-burn the budget. We deliberately keep this
 * out of the SQLite store: the file is rewritten in full on every save (tiny
 * blob, atomic rename) and read once at construction.
 *
 * File layout: `data/towns/<townId>/budget.json` containing:
 *   {
 *     "designSpendUsdByDay":  { "2026-05-15": 0.42, ... },
 *     "chronicleCostCentsByKey": { "<townId>|<dayNumber>": 12, ... }
 *   }
 *
 * Failure isolation: every read/write swallows errors and logs a warning.
 * The brain MUST keep ticking even when the disk is wedged — we just lose
 * persistence until the disk recovers.
 */
import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '../util/atomicWrite';
import { logger } from '../util/logger';

/** The on-disk shape — all maps are stringly-keyed for JSON safety. */
export interface BudgetLedger {
  /** Per-day (UTC yyyy-mm-dd) USD spend on the design LLM path. */
  designSpendUsdByDay: Record<string, number>;
  /** Per-(townId|dayNumber) cents spent on chronicle LLM calls. */
  chronicleCostCentsByKey: Record<string, number>;
}

function emptyLedger(): BudgetLedger {
  return { designSpendUsdByDay: {}, chronicleCostCentsByKey: {} };
}

function ledgerPath(dataDir: string, townId: string): string {
  return path.join(dataDir, 'towns', townId, 'budget.json');
}

/**
 * Load the ledger for a town. Returns an empty ledger when:
 *  - the file is missing (first boot for this town),
 *  - the file is unparseable (corrupted on disk),
 *  - any I/O error fires.
 */
export function load(dataDir: string, townId: string): BudgetLedger {
  const file = ledgerPath(dataDir, townId);
  try {
    if (!fs.existsSync(file)) return emptyLedger();
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BudgetLedger>;
    return {
      designSpendUsdByDay:
        parsed?.designSpendUsdByDay && typeof parsed.designSpendUsdByDay === 'object'
          ? sanitizeStringNumberMap(parsed.designSpendUsdByDay)
          : {},
      chronicleCostCentsByKey:
        parsed?.chronicleCostCentsByKey && typeof parsed.chronicleCostCentsByKey === 'object'
          ? sanitizeStringNumberMap(parsed.chronicleCostCentsByKey)
          : {},
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: msg, townId, file },
      'budgetLedger.load failed; starting with empty ledger',
    );
    return emptyLedger();
  }
}

/**
 * Persist the ledger atomically. Failures (disk full, permission denied)
 * are swallowed + logged so the brain keeps ticking with the in-memory
 * state intact.
 */
export function save(dataDir: string, townId: string, ledger: BudgetLedger): void {
  const file = ledgerPath(dataDir, townId);
  try {
    atomicWriteJsonSync(file, ledger);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: msg, townId, file },
      'budgetLedger.save failed; in-memory state retained',
    );
  }
}

/** Keep only well-typed (string -> finite number) entries. */
function sanitizeStringNumberMap(map: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      out[k] = v;
    }
  }
  return out;
}
