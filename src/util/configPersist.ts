import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Config } from '../config';

/**
 * Atomically persist the in-memory Config back to config.yml.
 *
 * Writes a sibling `.tmp` file and renames it over the target so a crash
 * mid-write cannot corrupt config.yml.
 *
 * NOTE: comments and formatting in the original YAML file are NOT preserved.
 * `js-yaml` dumps a structural representation only, so the first time this
 * function fires the file will be reformatted and any `#` comments will be
 * lost. This is a deliberate trade-off — round-tripping comments would
 * require a different YAML library. Document this in the dashboard UI so
 * operators know what to expect.
 */
export function persistConfig(config: Config, configPath?: string): void {
  const filePath = configPath || path.join(process.cwd(), 'config.yml');
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const dumped = yaml.dump(config, { indent: 2, lineWidth: 120, noRefs: true });
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, dumped, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Section names that may be patched via the runtime config API. Anything
 * outside this set is rejected with 400 — we do not want operators editing
 * `api`, `minecraft`, `bots`, `llm`, `skills`, or `logging` over HTTP.
 */
export const PATCHABLE_SECTIONS = ['behavior', 'affinity', 'instincts', 'voyager'] as const;
export type PatchableSection = (typeof PATCHABLE_SECTIONS)[number];

/**
 * Sections whose subsystems live inside worker threads (BotInstance,
 * VoyagerLoop, CodeExecutor). Each worker captures its own `Config` copy at
 * worker start via `loadConfig()`, so any PATCH against these sections only
 * lands on disk + the main-thread `Config` object. Existing workers keep
 * reading the old values until they're respawned.
 *
 * Until cross-thread IPC propagation is wired (TODO), the PATCH handler
 * treats every field in these sections as restart-required.
 */
export const WORKER_THREAD_SECTIONS: ReadonlySet<PatchableSection> = new Set([
  'instincts',
  'voyager',
]);

/**
 * Fields that — even on the main thread — are captured once at startup
 * (constructor / setInterval scope) and therefore do NOT take effect on a
 * hot patch.
 */
export const RESTART_REQUIRED_FIELDS: Record<PatchableSection, ReadonlySet<string>> = {
  behavior: new Set([
    // ambientChat timings drive setInterval schedules at bot worker boot
    'ambientChatMinSec',
    'ambientChatMaxSec',
  ]),
  affinity: new Set(),
  instincts: new Set(),
  voyager: new Set([
    // codeExecutionTimeoutMs captured in CodeExecutor at construction
    'codeExecutionTimeoutMs',
  ]),
};

/**
 * Per-field type guards. Used by PATCH to reject value-shape drift before
 * we persist the file. Returns null when the value is acceptable; otherwise
 * returns a human-readable error.
 */
const FIELD_TYPES: Record<PatchableSection, Record<string, 'number' | 'boolean' | 'string'>> = {
  behavior: {
    headTrackingRange: 'number',
    wanderRadius: 'number',
    conversationRadius: 'number',
    ambientChatMinSec: 'number',
    ambientChatMaxSec: 'number',
  },
  affinity: {
    default: 'number',
    hitPenalty: 'number',
    chatBonus: 'number',
    giftBonus: 'number',
    negativeSentimentPenalty: 'number',
    hostileThreshold: 'number',
    trustThreshold: 'number',
  },
  instincts: {
    enabled: 'boolean',
    attackCooldownMs: 'number',
    lowHealthThreshold: 'number',
    fleeDistance: 'number',
    fightRange: 'number',
    drowningOxygenThreshold: 'number',
    drowningSurfaceClearOxygen: 'number',
  },
  voyager: {
    enabled: 'boolean',
    taskCooldownMs: 'number',
    maxRetriesPerTask: 'number',
    codeExecutionTimeoutMs: 'number',
    curriculumLLMCalls: 'boolean',
    criticLLMCalls: 'boolean',
  },
};

export interface ValidatedPatch {
  ok: boolean;
  values: Record<string, unknown>;
  errors: string[];
}

/**
 * Type-check + coerce incoming PATCH values. Unknown keys for a section are
 * dropped with a warning (rather than rejected outright — section schemas
 * grow over time and we don't want to break older clients).
 */
export function validatePatch(
  section: PatchableSection,
  incoming: Record<string, unknown>,
): ValidatedPatch {
  const schema = FIELD_TYPES[section];
  const out: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [key, raw] of Object.entries(incoming)) {
    const expected = schema?.[key];
    if (!expected) {
      errors.push(`unknown field '${key}' for section '${section}' (dropped)`);
      continue;
    }
    if (expected === 'number') {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        errors.push(`field '${key}' must be a finite number, got ${JSON.stringify(raw)}`);
        return { ok: false, values: {}, errors };
      }
      out[key] = n;
    } else if (expected === 'boolean') {
      if (typeof raw === 'boolean') out[key] = raw;
      else if (raw === 'true' || raw === 'false') out[key] = raw === 'true';
      else {
        errors.push(`field '${key}' must be a boolean, got ${JSON.stringify(raw)}`);
        return { ok: false, values: {}, errors };
      }
    } else {
      if (typeof raw !== 'string') {
        errors.push(`field '${key}' must be a string, got ${typeof raw}`);
        return { ok: false, values: {}, errors };
      }
      out[key] = raw;
    }
  }

  return { ok: true, values: out, errors };
}

/**
 * Return the subset of patched field names that require a restart to take
 * effect. Worker-thread sections are entirely restart-required until IPC
 * propagation is wired; main-thread sections only flag specific captured
 * fields.
 */
export function findRestartRequiredFields(
  section: PatchableSection,
  values: Record<string, unknown>,
): string[] {
  if (WORKER_THREAD_SECTIONS.has(section)) return Object.keys(values);
  const required = RESTART_REQUIRED_FIELDS[section];
  return Object.keys(values).filter((key) => required.has(key));
}
