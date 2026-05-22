import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { validateConfig, loadConfig } from '../src/config';

function baseValid(): any {
  // Mirror of the shape in repo's config.yml (kept minimal — just enough to
  // pass schema validation).
  return {
    api: { port: 3001, host: '0.0.0.0' },
    minecraft: { host: 'play.example.com', port: 25565, version: '1.21.11', auth: 'offline' },
    bots: {
      maxBots: 10,
      defaultMode: 'codegen',
      joinStaggerMs: 5000,
      reconnectDelaySec: 5,
      maxReconnectAttempts: 10,
    },
    behavior: {
      headTrackingRange: 10,
      headTrackingTickMs: 250,
      wanderRadius: 15,
      wanderIntervalMs: 5000,
      ambientChatMinSec: 120,
      ambientChatMaxSec: 300,
      conversationRadius: 64.0,
    },
    affinity: {
      default: 50,
      hitPenalty: 10,
      chatBonus: 2,
      giftBonus: 5,
      negativeSentimentPenalty: 3,
      hostileThreshold: 20,
      trustThreshold: 70,
    },
    instincts: {
      enabled: true,
      attackCooldownMs: 12000,
      lowHealthThreshold: 8,
      fleeDistance: 14,
      fightRange: 3,
      drowningOxygenThreshold: 120,
      drowningSurfaceClearOxygen: 260,
    },
    voyager: {
      enabled: true,
      taskCooldownMs: 2000,
      maxRetriesPerTask: 3,
      codeExecutionTimeoutMs: 300000,
      curriculumLLMCalls: true,
      criticLLMCalls: true,
    },
    llm: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      temperature: 0.7,
      chatMaxTokens: 2048,
      codeGenMaxTokens: 8192,
      maxConcurrentRequests: 3,
    },
    skills: { directory: './skills', maxSkills: 500 },
    logging: { level: 'debug' },
    auth: { devSecret: null },
  };
}

describe('validateConfig', () => {
  it('accepts a minimally valid config', () => {
    const result = validateConfig(baseValid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.llm.provider).toBe('gemini');
      expect(result.warnings).toEqual([]);
    }
  });

  it('reports missing required top-level sections', () => {
    const raw = baseValid();
    delete raw.api;
    delete raw.llm;
    const result = validateConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('api: missing required section');
      expect(result.errors).toContain('llm: missing required section');
    }
  });

  it('reports wrong-type fields with section.field paths', () => {
    const raw = baseValid();
    raw.api.port = '3001'; // wrong type
    raw.llm.temperature = 'hot'; // wrong type
    const result = validateConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          'api.port: expected number, got string',
          'llm.temperature: expected number, got string',
        ]),
      );
    }
  });

  it('collects multiple errors instead of throwing on first', () => {
    const raw = baseValid();
    delete raw.api.port;
    raw.minecraft.port = 'not-a-number';
    raw.bots.maxBots = false;
    const result = validateConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('warns (does not reject) on unknown top-level keys', () => {
    const raw = baseValid();
    raw.someExperimentalSection = { foo: 'bar' };
    const result = validateConfig(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContain("unknown top-level key 'someExperimentalSection' (ignored)");
    }
  });

  it('validates llm.routes entries (provider required, fallback array of strings)', () => {
    const raw = baseValid();
    raw.llm.routes = {
      chat: { provider: 'anthropic', model: 'claude', fallback: ['gemini', 42] },
      code: { temperature: 'high' }, // missing provider, wrong-type temperature
    };
    const result = validateConfig(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          'llm.routes.chat.fallback[1]: expected string, got number',
          'llm.routes.code.provider: missing required field (expected string)',
          'llm.routes.code.temperature: expected number, got string',
        ]),
      );
    }
  });

  it('accepts auth.devSecret as string or null', () => {
    const r1 = validateConfig({ ...baseValid(), auth: { devSecret: null } });
    const r2 = validateConfig({ ...baseValid(), auth: { devSecret: 'shhh' } });
    const r3 = validateConfig({ ...baseValid(), auth: { devSecret: 42 as any } });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(false);
    if (!r3.ok) {
      expect(r3.errors).toContain('auth.devSecret: expected string or null, got number');
    }
  });

  it('the real repo config.yml passes validation', () => {
    const configPath = path.join(process.cwd(), 'config.yml');
    const raw = yaml.load(fs.readFileSync(configPath, 'utf-8'));
    const result = validateConfig(raw);
    if (!result.ok) {
      throw new Error(`repo config.yml failed validation: ${result.errors.join('; ')}`);
    }
    expect(result.ok).toBe(true);
  });

  it('loadConfig throws an error listing every problem when invalid', () => {
    const tmpFile = path.join(process.cwd(), '.tmp-bad-config.yml');
    fs.writeFileSync(tmpFile, 'api:\n  port: "not-a-number"\n', 'utf-8');
    try {
      expect(() => loadConfig(tmpFile)).toThrow(/Invalid config/);
      try {
        loadConfig(tmpFile);
      } catch (e: any) {
        // Should report multiple missing sections, not just the first.
        expect(e.message).toMatch(/api\.port: expected number/);
        expect(e.message).toMatch(/minecraft: missing required section/);
      }
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
