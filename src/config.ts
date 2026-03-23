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
  };
  skills: { directory: string; maxSkills: number };
  logging: { level: string };
}

export function loadConfig(configPath?: string): Config {
  const filePath = configPath || path.join(process.cwd(), 'config.yml');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(raw) as Config;
}
