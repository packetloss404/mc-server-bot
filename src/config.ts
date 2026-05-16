import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

export interface Config {
  api: { port: number; host: string };
  minecraft: { host: string; port: number; version: string; auth: string };
  bots: {
    maxBots: number;
    defaultMode: string;
    joinStaggerMs: number;
    reconnectDelaySec: number;
    maxReconnectAttempts: number;
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
}

export function loadConfig(configPath?: string): Config {
  const filePath = configPath || path.join(process.cwd(), 'config.yml');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(raw) as Config;
}

/**
 * Type-safe accessor for a top-level Config section. Returns the live object
 * reference, so mutating the returned section is observed by any subsystem
 * holding the same reference (e.g. AffinityManager — see configPersist.ts).
 */
export function getSection<K extends keyof Config>(config: Config, name: K): Config[K] {
  return config[name];
}
