import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

/**
 * Config schema — single source of truth for what `config.yml` may contain.
 *
 * Any change to this interface MUST be mirrored in `validateConfig()` below so
 * that misspelled, missing, or mistyped fields surface at startup instead of
 * propagating as `undefined` through the rest of the codebase.
 *
 * DO NOT do `yaml.load(...) as Config` anywhere else — go through
 * `loadConfig()` (or call `validateConfig()` directly) so the schema check
 * runs. The cast in `loadConfig()` is the ONLY raw cast permitted; it is
 * sound because `validateConfig()` returned `ok: true` on the same object.
 */
export interface Config {
  api: { port: number; host: string };
  minecraft: {
    host: string;
    port: number;
    version: string;
    auth: string;
    /**
     * Server onboarding behaviour. DyoCraft requires a chat-password login
     * ('dyoauth') and a class-selection hotbar dance; a vanilla/Paper server
     * needs neither. Optional with DyoCraft-compatible defaults so existing
     * configs are unaffected.
     *   loginFlow: 'none' (just join) | 'dyoauth' (/login + /register flow)
     *   loginPassword: shared password for the dyoauth flow
     *   selectClass: run the DyoClasses hotbar class-selection after login
     */
    loginFlow?: string;
    loginPassword?: string;
    selectClass?: boolean;
  };
  bots: {
    maxBots: number;
    defaultMode: string;
    joinStaggerMs: number;
    reconnectDelaySec: number;
    maxReconnectAttempts: number;
    /** Slow retry cadence (seconds) when the server rejects our protocol
     *  version ("Outdated client!"). Permanent failure until the server or
     *  our protocol stack changes, so retries are a heartbeat, not a storm.
     *  Default 900 (15 min). */
    versionMismatchBackoffSec?: number;
  };
  behavior: {
    headTrackingRange: number;
    headTrackingTickMs: number;
    wanderRadius: number;
    wanderIntervalMs: number;
    ambientChatMinSec: number;
    ambientChatMaxSec: number;
    conversationRadius: number;
  };
  affinity: {
    default: number;
    hitPenalty: number;
    chatBonus: number;
    giftBonus: number;
    negativeSentimentPenalty: number;
    hostileThreshold: number;
    trustThreshold: number;
  };
  instincts: {
    enabled: boolean;
    attackCooldownMs: number;
    lowHealthThreshold: number;
    fleeDistance: number;
    fightRange: number;
    drowningOxygenThreshold: number;
    drowningSurfaceClearOxygen: number;
  };
  voyager: {
    enabled: boolean;
    taskCooldownMs: number;
    maxRetriesPerTask: number;
    codeExecutionTimeoutMs: number;
    curriculumLLMCalls: boolean;
    criticLLMCalls: boolean;
  };
  llm: {
    provider: string;
    model: string;
    temperature: number;
    chatMaxTokens: number;
    codeGenMaxTokens: number;
    maxConcurrentRequests: number;
    routes?: Record<string, {
      provider: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      useThinking?: boolean;
      fallback?: string[];
    }>;
    providers?: Record<string, {
      maxConcurrentRequests?: number;
    }>;
  };
  skills: { directory: string; maxSkills: number };
  ollama?: {
    baseUrl?: string;
    chatModel?: string;
    codeModel?: string;
    timeoutMs?: number;
  };
  logging: { level: string };
  /**
   * Followup #58 — player-identity session secret (dev-mode).
   *
   * When `auth.devSecret` is set, `POST /api/auth/login` requires the
   * caller to supply that secret as `secret` in the JSON body and is
   * accepted for ANY `playerName`. The login mints a signed `pid`
   * cookie that `requireMayor` then validates against the town's
   * mayor.playerName.
   *
   * Per-player secrets are intentionally out-of-scope for this
   * followup (see #58 acceptance notes); the dev secret is a single
   * shared key. When `auth.devSecret` is missing AND no
   * `DASHBOARD_AUTH_SECRET` env var is set, player login is wide
   * open (any playerName succeeds) — preserves single-user local
   * dev behavior.
   */
  auth?: {
    devSecret?: string | null;
  };
  /**
   * Impersonation detection — defends against another client logging in under
   * a bot's username (a duplicate-login kick boots the real bot). When a
   * duplicate-login kick is detected the bot quarantines itself (stops
   * reconnecting) and an alert is raised. See src/security/ImpersonationMonitor
   * and BotInstance.parseDuplicateLoginKick. The outbound webhook URL is read
   * from the IMPERSONATION_ALERT_WEBHOOK env var (not config), matching the
   * DASHBOARD_AUTH_SECRET / PLUGIN_AUTH_TOKEN convention.
   */
  security?: {
    /** Master switch. Detection/quarantine is on unless explicitly false. */
    impersonationDetection: boolean;
    /** Have a connected bot announce the impersonation in Minecraft chat. */
    broadcastInGame: boolean;
    /** Reserved: auto-release quarantine after N seconds (0 = manual only). */
    quarantineReleaseSec: number;
  };
  /**
   * Project Sid P2 — "Governance that bites".
   *
   * When `governance.enabled` is true, a mayor decree is ALSO persisted as a
   * standing TownRule (via RuleStore) instead of being a purely one-shot
   * blackboard task, and `BlackboardManager.scoreTaskEnhanced` boosts tasks
   * whose text/keywords match an active rule for the bot's town.
   *
   * Default OFF (behavior-changing). When disabled, decrees keep their legacy
   * one-shot-task behavior and task scoring is byte-for-byte identical to
   * today — the rule store is never consulted.
   */
  governance?: {
    /** Master switch for P2 standing-rule behavior. Default false. */
    enabled: boolean;
  };
  /**
   * Project Sid P3 — "Culture & social spread".
   *
   * When `social.botAffinity` is true, bots write directed bot→peer affinity
   * edges from inter-bot interactions (the VoyagerLoop brain-tick message
   * drain): a cheap, non-LLM sentiment signal (message kind + keyword scan via
   * the existing `analyzeSentiment`) nudges the bot→peer edge through the same
   * AffinityProxy/IPC path used for player affinity. The bot's top bot-
   * relationships are surfaced in its chat system prompt, and a disliked peer
   * (below the affinity hostile threshold) is deprioritized for help/resource
   * sharing — reusing the existing `isHostile` gate.
   *
   * When `social.culture` is true, the (separately implemented) CultureManager
   * meme layer is active. P3-A defines this flag so the meme work needs no
   * config.ts change; P3-A itself never reads it.
   *
   * BOTH default OFF (behavior-changing). With `botAffinity` off, inter-bot
   * messages are processed byte-for-byte as today (no affinity edges written,
   * no prompt change, no help/share gating) and there is zero added LLM cost.
   */
  social?: {
    /** Master switch for P3-A bot→bot affinity. Default false. */
    botAffinity: boolean;
    /** Reserved for P3-B cultural memes (CultureManager). Default false. */
    culture: boolean;
  };
  /**
   * Project Sid P4 — "PIANO cognition".
   *
   * When `cognition.perceptionTick` is true, the threat/opportunity/survival-
   * goal assessors run on their OWN short-interval timer in BotInstance (a
   * `perceptionInterval` mirroring `instinctInterval`/`survivalInterval`),
   * writing results into a per-bot AgentState cache that VoyagerLoop.runOneCycle
   * READS instead of computing inline. This lets the bot perceive a spawning
   * threat mid-task (the sequential loop is blocked during task execution)
   * rather than only reacting when the next cycle reaches the inline scan.
   *
   * When `cognition.cognitiveController` is true, the (separately implemented —
   * P4-B) CognitiveController replaces the imperative priority ladder in
   * runOneCycle with a single Decision emitter and broadcasts the decision to
   * chat/proactive speech. P4-A defines this flag so the controller work needs
   * no config.ts change; P4-A itself never reads it.
   *
   * BOTH default OFF (behavior-changing). With `perceptionTick` off, the
   * perception timer is never started and runOneCycle computes the assessment
   * inline byte-for-byte as today — the AgentState cache is never consulted and
   * there is zero added timer / CPU cost.
   */
  cognition?: {
    /** Master switch for P4-A always-on perception tick. Default false. */
    perceptionTick: boolean;
    /** Reserved for P4-B CognitiveController + decision broadcast. Default false. */
    cognitiveController: boolean;
  };
  /**
   * Build-system tuning knobs.
   *
   * All fields are optional; when the `build:` section is absent defaults are
   * used so existing deployments need no config change.
   */
  build?: {
    /**
     * Hard deadline for the PRE-JOB phase of `BuildCoordinator.startBuild`
     * (origin resolution + bunker excavation + site-clear + snap-to-ground).
     * If this budget elapses before the job object is created the call rejects
     * and the TownBrain caller cleans up the planned-building row and retries
     * next tick — preventing a hung startBuild from freezing the serialized
     * town-management loop indefinitely.
     *
     * Generous default (150 s) to avoid killing legitimate slow builds on a
     * loaded 2-core server; lower in tests via the injected options override.
     */
    sitePrepTimeoutMs?: number;
  };
  /**
   * Mining geofence — stops bots gathering raw materials by tunnelling through
   * town structures and routes resource mining to a designated communal mine
   * site. Consumed by src/actions/geofence.ts. All fields optional; when the
   * `mining:` section is absent the geofence is empty and mining behaves
   * byte-for-byte as before (no protection, no routing).
   */
  mining?: {
    /** Axis-aligned boxes around builds; blocks inside are never dug. */
    protectedZones?: Array<{
      name?: string;
      minX: number; minY: number; minZ: number;
      maxX: number; maxY: number; maxZ: number;
      /** false = mining-protection only, not a night-shelter destination. */
      shelter?: boolean;
    }>;
    /** Designated communal dig site bots travel to for routed block types. */
    mineSite?: { x: number; y: number; z: number; radius?: number };
    /** Block types that must be sourced at the mine site, not dug in place. */
    routeToMineBlocks?: string[];
  };
  /**
   * Per-bot movement leash. Each entry pins a named bot to a home anchor (x,z)
   * and radius — generated code cannot move it outside the radius (enforced in
   * CodeExecutor.moveTo, and exploreUntil is disabled for it). Used to keep a
   * dedicated caretaker bot on its island/site. Absent/empty → no bot leashed.
   */
  leash?: Array<{ botName: string; x: number; z: number; radius: number }>;
  /**
   * Safe fallback location a stranded bot teleports itself to when it gets stuck
   * in liquid and can't complete tasks (see VoyagerLoop.tryRescueIfStranded).
   * Leashed bots rescue to their anchor using this Y; unleashed bots rescue here.
   * Should be a known-safe land coordinate (e.g. near base). Absent → no
   * auto-rescue for unleashed bots (they escalate via a WARN log instead).
   */
  rescueHome?: { x: number; y: number; z: number };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';

interface FieldSpec {
  key: string;
  type: FieldType;
  optional?: boolean;
}

// Top-level sections expected on Config. Unknown top-level keys are warned
// about (not rejected) — yaml-level extensions are a common pattern.
const KNOWN_TOP_LEVEL_KEYS = new Set<string>([
  'api',
  'minecraft',
  'bots',
  'behavior',
  'affinity',
  'instincts',
  'voyager',
  'llm',
  'skills',
  'ollama',
  'logging',
  'auth',
  'security',
  'governance',
  'social',
  'cognition',
  'mining',
  'build',
  'leash',
  'rescueHome',
]);

const SECTION_SPECS: Record<string, { required: boolean; fields: FieldSpec[] }> = {
  api: {
    required: true,
    fields: [
      { key: 'port', type: 'number' },
      { key: 'host', type: 'string' },
    ],
  },
  minecraft: {
    required: true,
    fields: [
      { key: 'host', type: 'string' },
      { key: 'port', type: 'number' },
      { key: 'version', type: 'string' },
      { key: 'auth', type: 'string' },
      { key: 'loginFlow', type: 'string', optional: true },
      { key: 'loginPassword', type: 'string', optional: true },
      { key: 'selectClass', type: 'boolean', optional: true },
    ],
  },
  bots: {
    required: true,
    fields: [
      { key: 'maxBots', type: 'number' },
      { key: 'defaultMode', type: 'string' },
      { key: 'joinStaggerMs', type: 'number' },
      { key: 'reconnectDelaySec', type: 'number' },
      { key: 'maxReconnectAttempts', type: 'number' },
      { key: 'versionMismatchBackoffSec', type: 'number', optional: true },
    ],
  },
  behavior: {
    required: true,
    fields: [
      { key: 'headTrackingRange', type: 'number' },
      { key: 'headTrackingTickMs', type: 'number' },
      { key: 'wanderRadius', type: 'number' },
      { key: 'wanderIntervalMs', type: 'number' },
      { key: 'ambientChatMinSec', type: 'number' },
      { key: 'ambientChatMaxSec', type: 'number' },
      { key: 'conversationRadius', type: 'number' },
    ],
  },
  affinity: {
    required: true,
    fields: [
      { key: 'default', type: 'number' },
      { key: 'hitPenalty', type: 'number' },
      { key: 'chatBonus', type: 'number' },
      { key: 'giftBonus', type: 'number' },
      { key: 'negativeSentimentPenalty', type: 'number' },
      { key: 'hostileThreshold', type: 'number' },
      { key: 'trustThreshold', type: 'number' },
    ],
  },
  instincts: {
    required: true,
    fields: [
      { key: 'enabled', type: 'boolean' },
      { key: 'attackCooldownMs', type: 'number' },
      { key: 'lowHealthThreshold', type: 'number' },
      { key: 'fleeDistance', type: 'number' },
      { key: 'fightRange', type: 'number' },
      { key: 'drowningOxygenThreshold', type: 'number' },
      { key: 'drowningSurfaceClearOxygen', type: 'number' },
    ],
  },
  voyager: {
    required: true,
    fields: [
      { key: 'enabled', type: 'boolean' },
      { key: 'taskCooldownMs', type: 'number' },
      { key: 'maxRetriesPerTask', type: 'number' },
      { key: 'codeExecutionTimeoutMs', type: 'number' },
      { key: 'curriculumLLMCalls', type: 'boolean' },
      { key: 'criticLLMCalls', type: 'boolean' },
    ],
  },
  llm: {
    required: true,
    fields: [
      { key: 'provider', type: 'string' },
      { key: 'model', type: 'string' },
      { key: 'temperature', type: 'number' },
      { key: 'chatMaxTokens', type: 'number' },
      { key: 'codeGenMaxTokens', type: 'number' },
      { key: 'maxConcurrentRequests', type: 'number' },
      { key: 'routes', type: 'object', optional: true },
      { key: 'providers', type: 'object', optional: true },
    ],
  },
  skills: {
    required: true,
    fields: [
      { key: 'directory', type: 'string' },
      { key: 'maxSkills', type: 'number' },
    ],
  },
  ollama: {
    required: false,
    fields: [
      { key: 'baseUrl', type: 'string', optional: true },
      { key: 'chatModel', type: 'string', optional: true },
      { key: 'codeModel', type: 'string', optional: true },
      { key: 'timeoutMs', type: 'number', optional: true },
    ],
  },
  logging: {
    required: true,
    fields: [{ key: 'level', type: 'string' }],
  },
  auth: {
    required: false,
    fields: [
      // devSecret may be string OR null (per Config interface). Handled in
      // checkSection() with a special-case below.
      { key: 'devSecret', type: 'string', optional: true },
    ],
  },
  security: {
    required: false,
    fields: [
      { key: 'impersonationDetection', type: 'boolean', optional: true },
      { key: 'broadcastInGame', type: 'boolean', optional: true },
      { key: 'quarantineReleaseSec', type: 'number', optional: true },
    ],
  },
  governance: {
    required: false,
    fields: [{ key: 'enabled', type: 'boolean', optional: true }],
  },
  social: {
    required: false,
    fields: [
      { key: 'botAffinity', type: 'boolean', optional: true },
      { key: 'culture', type: 'boolean', optional: true },
    ],
  },
  cognition: {
    required: false,
    fields: [
      { key: 'perceptionTick', type: 'boolean', optional: true },
      { key: 'cognitiveController', type: 'boolean', optional: true },
    ],
  },
  mining: {
    required: false,
    fields: [
      { key: 'protectedZones', type: 'array', optional: true },
      { key: 'mineSite', type: 'object', optional: true },
      { key: 'routeToMineBlocks', type: 'array', optional: true },
    ],
  },
  build: {
    required: false,
    fields: [
      { key: 'sitePrepTimeoutMs', type: 'number', optional: true },
    ],
  },
};

function typeOf(value: unknown): FieldType | 'null' | 'undefined' {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value as FieldType;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkSection(
  sectionName: string,
  sectionValue: unknown,
  spec: { fields: FieldSpec[] },
  errors: string[],
): void {
  if (!isPlainObject(sectionValue)) {
    errors.push(`${sectionName}: expected object, got ${typeOf(sectionValue)}`);
    return;
  }
  for (const field of spec.fields) {
    const fieldPath = `${sectionName}.${field.key}`;
    const present = Object.prototype.hasOwnProperty.call(sectionValue, field.key);
    if (!present) {
      if (!field.optional) {
        errors.push(`${fieldPath}: missing required field (expected ${field.type})`);
      }
      continue;
    }
    const v = sectionValue[field.key];
    // Special-case: auth.devSecret may be string OR null.
    if (sectionName === 'auth' && field.key === 'devSecret') {
      if (v !== null && typeof v !== 'string') {
        errors.push(`${fieldPath}: expected string or null, got ${typeOf(v)}`);
      }
      continue;
    }
    const actual = typeOf(v);
    if (actual !== field.type) {
      errors.push(`${fieldPath}: expected ${field.type}, got ${actual}`);
    }
  }
}

function checkLlmRoutes(routes: unknown, errors: string[]): void {
  if (!isPlainObject(routes)) {
    errors.push(`llm.routes: expected object, got ${typeOf(routes)}`);
    return;
  }
  for (const [routeName, route] of Object.entries(routes)) {
    const base = `llm.routes.${routeName}`;
    if (!isPlainObject(route)) {
      errors.push(`${base}: expected object, got ${typeOf(route)}`);
      continue;
    }
    // provider is required on each route entry.
    if (!Object.prototype.hasOwnProperty.call(route, 'provider')) {
      errors.push(`${base}.provider: missing required field (expected string)`);
    } else if (typeof route.provider !== 'string') {
      errors.push(`${base}.provider: expected string, got ${typeOf(route.provider)}`);
    }
    const optionalScalars: Array<[string, FieldType]> = [
      ['model', 'string'],
      ['temperature', 'number'],
      ['maxTokens', 'number'],
      ['useThinking', 'boolean'],
    ];
    for (const [k, t] of optionalScalars) {
      if (Object.prototype.hasOwnProperty.call(route, k)) {
        const actual = typeOf(route[k]);
        if (actual !== t) {
          errors.push(`${base}.${k}: expected ${t}, got ${actual}`);
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(route, 'fallback')) {
      const fb = route.fallback;
      if (!Array.isArray(fb)) {
        errors.push(`${base}.fallback: expected array, got ${typeOf(fb)}`);
      } else {
        fb.forEach((item, i) => {
          if (typeof item !== 'string') {
            errors.push(`${base}.fallback[${i}]: expected string, got ${typeOf(item)}`);
          }
        });
      }
    }
  }
}

function checkLlmProviders(providers: unknown, errors: string[]): void {
  if (!isPlainObject(providers)) {
    errors.push(`llm.providers: expected object, got ${typeOf(providers)}`);
    return;
  }
  for (const [providerName, p] of Object.entries(providers)) {
    const base = `llm.providers.${providerName}`;
    if (!isPlainObject(p)) {
      errors.push(`${base}: expected object, got ${typeOf(p)}`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(p, 'maxConcurrentRequests')) {
      const actual = typeOf(p.maxConcurrentRequests);
      if (actual !== 'number') {
        errors.push(`${base}.maxConcurrentRequests: expected number, got ${actual}`);
      }
    }
  }
}

export type ValidateConfigResult =
  | { ok: true; config: Config; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/**
 * Validate a raw parsed-YAML value against the Config schema.
 *
 * - Required fields: missing OR wrong-type → error (collected, not thrown).
 * - Optional fields: only checked if present.
 * - Unknown top-level keys: emit a warning (returned, not thrown) — yaml
 *   extension keys are a common ops pattern.
 *
 * On `ok: true` the returned `config` is the same object reference as `raw`
 * (just narrowed); on `ok: false`, `errors` contains every problem found.
 */
export function validateConfig(raw: unknown): ValidateConfigResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: [`root: expected object, got ${typeOf(raw)}`],
      warnings,
    };
  }

  // Unknown top-level keys → warning only.
  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      warnings.push(`unknown top-level key '${key}' (ignored)`);
    }
  }

  for (const [sectionName, spec] of Object.entries(SECTION_SPECS)) {
    const present = Object.prototype.hasOwnProperty.call(raw, sectionName);
    if (!present) {
      if (spec.required) {
        errors.push(`${sectionName}: missing required section`);
      }
      continue;
    }
    checkSection(sectionName, raw[sectionName], spec, errors);
  }

  // Deep checks for llm sub-structures (only when llm itself parsed cleanly
  // enough to have those keys as objects).
  const llm = raw.llm;
  if (isPlainObject(llm)) {
    if (Object.prototype.hasOwnProperty.call(llm, 'routes') && llm.routes !== undefined) {
      checkLlmRoutes(llm.routes, errors);
    }
    if (Object.prototype.hasOwnProperty.call(llm, 'providers') && llm.providers !== undefined) {
      checkLlmProviders(llm.providers, errors);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, config: raw as unknown as Config, warnings };
}

export function loadConfig(configPath?: string): Config {
  const filePath = configPath || path.join(process.cwd(), 'config.yml');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(raw);
  const result = validateConfig(parsed);
  if (!result.ok) {
    const joined = result.errors.map((e) => `  - ${e}`).join('\n');
    throw new Error(
      `Invalid config (${filePath}): ${result.errors.length} error(s)\n${joined}`,
    );
  }
  if (result.warnings.length > 0) {
    // Don't take a logger dep here; config loads before logger init.
    for (const w of result.warnings) {
      // eslint-disable-next-line no-console
      console.warn(`[config] ${w}`);
    }
  }
  return result.config;
}

/**
 * Type-safe accessor for a top-level Config section. Returns the live object
 * reference, so mutating the returned section is observed by any subsystem
 * holding the same reference (e.g. AffinityManager — see configPersist.ts).
 */
export function getSection<K extends keyof Config>(config: Config, name: K): Config[K] {
  return config[name];
}
