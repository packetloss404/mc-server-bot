/**
 * budgetLedger — tiny per-town JSON persistence for daily LLM/chronicle spend.
 *
 * Followup #45 (partial): persist the running daily spend totals so a brain
 * restart doesn't immediately re-burn the budget. We deliberately keep this
 * out of the SQLite store: each file is rewritten in full on every save (tiny
 * blob, atomic rename) and read once at construction.
 *
 * Followup #64: split the unified `budget.json` into two sibling files so the
 * design-spend writer (TownBrain.persistDesignSpend) and the chronicle writer
 * (ChronicleGenerator.persistTownLedger) can no longer race each other. Each
 * writer used to load the full file, mutate its own slice, and save the whole
 * thing — concurrent saves around an async LLM call could silently roll back
 * the other slice. Now each owns its own file, so there is nothing to clobber.
 *
 * File layout:
 *   `data/towns/<townId>/budget-design.json`
 *     { "designSpendUsdByDay":  { "2026-05-15": 0.42, ... } }
 *   `data/towns/<townId>/budget-chronicle.json`
 *     { "chronicleCostCentsByKey": { "<townId>|<dayNumber>": 12, ... } }
 *
 * Migration: when a split file is missing, fall back to the legacy unified
 * `budget.json` for the relevant slice. The next save writes the split file,
 * after which the legacy file is silently ignored (we do NOT delete it — it
 * stays as a no-op backup until something else cleans it up).
 *
 * Failure isolation: every read/write swallows errors and logs a warning.
 * The brain MUST keep ticking even when the disk is wedged — we just lose
 * persistence until the disk recovers.
 */
import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '../util/atomicWrite';
import { logger } from '../util/logger';

/** Design-spend slice — per-day USD spend on the LLM design path. */
export interface DesignLedger {
  /** Per-day (UTC yyyy-mm-dd) USD spend on the design LLM path. */
  designSpendUsdByDay: Record<string, number>;
}

/** Chronicle-spend slice — per-(townId|dayNumber) cents on chronicle LLM calls. */
export interface ChronicleLedger {
  /** Per-(townId|dayNumber) cents spent on chronicle LLM calls. */
  chronicleCostCentsByKey: Record<string, number>;
}

/** Legacy unified shape — kept only for the one-shot migration read. */
interface LegacyBudgetLedger {
  designSpendUsdByDay?: Record<string, unknown>;
  chronicleCostCentsByKey?: Record<string, unknown>;
}

function emptyDesign(): DesignLedger {
  return { designSpendUsdByDay: {} };
}

function emptyChronicle(): ChronicleLedger {
  return { chronicleCostCentsByKey: {} };
}

function designPath(dataDir: string, townId: string): string {
  return path.join(dataDir, 'towns', townId, 'budget-design.json');
}

function chroniclePath(dataDir: string, townId: string): string {
  return path.join(dataDir, 'towns', townId, 'budget-chronicle.json');
}

function legacyPath(dataDir: string, townId: string): string {
  return path.join(dataDir, 'towns', townId, 'budget.json');
}

/**
 * Load the design-spend ledger for a town. Returns an empty ledger when:
 *  - both the split file and legacy file are missing (first boot for this town),
 *  - the file is unparseable (corrupted on disk),
 *  - any I/O error fires.
 *
 * Migration shim: when `budget-design.json` is missing, falls back to the
 * `designSpendUsdByDay` slice of the legacy unified `budget.json`. The next
 * `saveDesign` writes the split file; legacy stays as a no-op backup.
 */
export function loadDesign(dataDir: string, townId: string): DesignLedger {
  const file = designPath(dataDir, townId);
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DesignLedger>;
      return {
        designSpendUsdByDay:
          parsed?.designSpendUsdByDay && typeof parsed.designSpendUsdByDay === 'object'
            ? sanitizeStringNumberMap(parsed.designSpendUsdByDay as Record<string, unknown>)
            : {},
      };
    }
    // Migration fallback — pull the design slice out of the legacy unified file.
    const legacy = readLegacy(dataDir, townId);
    if (legacy?.designSpendUsdByDay && typeof legacy.designSpendUsdByDay === 'object') {
      return {
        designSpendUsdByDay: sanitizeStringNumberMap(legacy.designSpendUsdByDay),
      };
    }
    return emptyDesign();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: msg, townId, file },
      'budgetLedger.loadDesign failed; starting with empty ledger',
    );
    return emptyDesign();
  }
}

/**
 * Persist the design-spend ledger atomically. Failures (disk full, permission
 * denied) are swallowed + logged so the brain keeps ticking with the in-memory
 * state intact.
 */
export function saveDesign(dataDir: string, townId: string, ledger: DesignLedger): void {
  const file = designPath(dataDir, townId);
  try {
    atomicWriteJsonSync(file, ledger);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: msg, townId, file },
      'budgetLedger.saveDesign failed; in-memory state retained',
    );
  }
}

/**
 * Load the chronicle-spend ledger for a town. Same semantics as `loadDesign`:
 * empty on missing/corrupt, migration fallback to the legacy unified file when
 * the split file is missing.
 */
export function loadChronicle(dataDir: string, townId: string): ChronicleLedger {
  const file = chroniclePath(dataDir, townId);
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ChronicleLedger>;
      return {
        chronicleCostCentsByKey:
          parsed?.chronicleCostCentsByKey && typeof parsed.chronicleCostCentsByKey === 'object'
            ? sanitizeStringNumberMap(parsed.chronicleCostCentsByKey as Record<string, unknown>)
            : {},
      };
    }
    // Migration fallback — pull the chronicle slice out of the legacy unified file.
    const legacy = readLegacy(dataDir, townId);
    if (legacy?.chronicleCostCentsByKey && typeof legacy.chronicleCostCentsByKey === 'object') {
      return {
        chronicleCostCentsByKey: sanitizeStringNumberMap(legacy.chronicleCostCentsByKey),
      };
    }
    return emptyChronicle();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: msg, townId, file },
      'budgetLedger.loadChronicle failed; starting with empty ledger',
    );
    return emptyChronicle();
  }
}

/**
 * Persist the chronicle-spend ledger atomically. Failures (disk full,
 * permission denied) are swallowed + logged so the generator keeps ticking
 * with the in-memory state intact.
 */
export function saveChronicle(dataDir: string, townId: string, ledger: ChronicleLedger): void {
  const file = chroniclePath(dataDir, townId);
  try {
    atomicWriteJsonSync(file, ledger);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: msg, townId, file },
      'budgetLedger.saveChronicle failed; in-memory state retained',
    );
  }
}

/**
 * Best-effort read of the legacy unified `budget.json`. Returns null when the
 * file is missing or unparseable. Used exclusively for the one-shot migration
 * from the unified shape to the split-file shape.
 */
function readLegacy(dataDir: string, townId: string): LegacyBudgetLedger | null {
  const file = legacyPath(dataDir, townId);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw) as LegacyBudgetLedger;
  } catch {
    // Corrupted legacy file is non-fatal — the split files start empty.
    return null;
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
