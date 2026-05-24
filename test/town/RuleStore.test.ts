/**
 * RuleStore unit tests (Project Sid P2-A — "Governance that bites").
 *
 * Coverage:
 *   1. extractKeywords — content words kept, stop-words/short tokens dropped,
 *      lowercased + deduped, order-preserving.
 *   2. addRule / listRules / getActiveRules / deactivateRule lifecycle.
 *   3. Persistence round-trip via a real tmpdir (atomicWriteJsonSync).
 *   4. The BlackboardManager rule boost applies ONLY when the resolver is
 *      wired (the resolver is what's gated on config.governance.enabled in
 *      production), and a higher-priority rule yields a bigger boost.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RuleStore, extractKeywords, type TownRule } from '../../src/town/RuleStore';
import { BlackboardManager } from '../../src/voyager/BlackboardManager';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dyobot-rules-'));
}

describe('extractKeywords', () => {
  it('keeps content words and drops stop-words + short tokens', () => {
    const kw = extractKeywords('All residents must keep the town walls repaired');
    // 'all', 'must', 'the' are stop-words; everything <3 chars dropped.
    expect(kw).toEqual(['residents', 'keep', 'town', 'walls', 'repaired']);
  });

  it('lowercases, dedupes, and preserves first-seen order', () => {
    // 'and'/'more' are stop-words; 'farm' and 'wheat' dedupe to first-seen.
    expect(extractKeywords('Farm WHEAT and farm again wheat')).toEqual(['farm', 'wheat', 'again']);
  });

  it('returns [] for stop-word-only or empty text', () => {
    expect(extractKeywords('the and to of')).toEqual([]);
    expect(extractKeywords('   ')).toEqual([]);
  });
});

describe('RuleStore', () => {
  let tmpDir: string;
  let store: RuleStore;

  beforeEach(() => {
    tmpDir = makeTempDir();
    store = new RuleStore(tmpDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('addRule auto-extracts keywords and defaults priority/active', () => {
    const rule = store.addRule('town-1', 'Always defend the town from creepers');
    expect(rule.townId).toBe('town-1');
    expect(rule.active).toBe(true);
    expect(rule.priority).toBe(1);
    expect(rule.keywords).toContain('defend');
    expect(rule.keywords).toContain('creepers');
    expect(rule.keywords).not.toContain('the'); // stop-word
    expect(rule.id).toMatch(/^rule-/);
  });

  it('addRule honors explicit keywords + priority overrides', () => {
    const rule = store.addRule('town-1', 'Keep farming', { keywords: ['Farm', 'WHEAT'], priority: 3 });
    expect(rule.keywords).toEqual(['farm', 'wheat']); // lowercased
    expect(rule.priority).toBe(3);
  });

  it('listRules returns all rules (newest-first); getActiveRules filters inactive', () => {
    const a = store.addRule('town-1', 'First rule about mining ore');
    const b = store.addRule('town-1', 'Second rule about building walls');
    // newest-first
    const all = store.listRules('town-1');
    expect(all.map((r) => r.id)).toEqual([b.id, a.id]);

    expect(store.getActiveRules('town-1')).toHaveLength(2);
    expect(store.deactivateRule(a.id)).toBe(true);
    const active = store.getActiveRules('town-1');
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(b.id);
    // listRules still shows both (active+inactive)
    expect(store.listRules('town-1')).toHaveLength(2);
  });

  it('rules are scoped per town', () => {
    store.addRule('town-1', 'mine ore');
    store.addRule('town-2', 'farm wheat');
    expect(store.getActiveRules('town-1')).toHaveLength(1);
    expect(store.getActiveRules('town-2')).toHaveLength(1);
    expect(store.getActiveRules('town-3')).toEqual([]);
  });

  it('deactivateRule returns false for unknown or already-inactive id', () => {
    const r = store.addRule('town-1', 'patrol the walls');
    expect(store.deactivateRule('rule-nope')).toBe(false);
    expect(store.deactivateRule(r.id)).toBe(true);
    expect(store.deactivateRule(r.id)).toBe(false); // already inactive
  });

  it('persists across instances (round-trip through data/town_rules.json)', () => {
    const r1 = store.addRule('town-1', 'Defend the gates from raiders');
    const r2 = store.addRule('town-1', 'Harvest the crops at dawn');
    store.deactivateRule(r1.id);

    // File exists where we expect it.
    expect(fs.existsSync(path.join(tmpDir, 'town_rules.json'))).toBe(true);

    // Fresh instance reads the same file.
    const reloaded = new RuleStore(tmpDir);
    const all = reloaded.listRules('town-1');
    expect(all).toHaveLength(2);
    const active = reloaded.getActiveRules('town-1');
    expect(active.map((r) => r.id)).toEqual([r2.id]);
    expect(active[0].keywords).toContain('harvest');
  });
});

describe('BlackboardManager rule boost (P2-A scoring bias)', () => {
  let tmpDir: string;
  let bb: BlackboardManager;

  beforeEach(() => {
    tmpDir = makeTempDir();
    bb = new BlackboardManager(tmpDir);
  });

  afterEach(() => {
    bb.shutdown();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  /**
   * Reach into private scoreTaskEnhanced for a deterministic single-task score.
   * SHOULD-FIX #2: scoreTaskEnhanced now takes the pre-resolved active rules
   * (resolved once in claimBestTask) rather than a botName it resolves itself,
   * so mirror that here — resolve via the wired resolver, then pass the rules.
   */
  function score(task: any, botName?: string): number {
    const inner = bb as unknown as {
      getActiveRulesForBot: ((name: string) => any[]) | null;
      scoreTaskEnhanced: (
        t: any, q: string, p?: string, pos?: any, role?: string, rules?: any[],
      ) => number;
    };
    let rules: any[] = [];
    if (botName && inner.getActiveRulesForBot) {
      try { rules = inner.getActiveRulesForBot(botName) ?? []; } catch { rules = []; }
    }
    return inner.scoreTaskEnhanced(task, '', undefined, undefined, undefined, rules);
  }

  function makeTask(description: string, keywords: string[]) {
    return bb.addTask({ description, keywords }, 'swarm', undefined, 'normal');
  }

  // Scores include a small +Math.min(10, age/60000) recency term, so two
  // calls microseconds apart can differ by ~1e-5. Capture the baseline, wire
  // the resolver, and compare deltas with toBeCloseTo so the recency drift
  // doesn't make the assertion flaky.

  it('applies no boost when no resolver is wired (disabled = identical scores)', () => {
    const task = makeTask('mining run for iron blocks', ['mining', 'blocks']);
    // No resolver set: production keeps it unset / returns [] when the flag is off.
    const baseline = score(task, 'BotA');
    // Same call again — stable up to recency drift, no rule effect.
    expect(score(task, 'BotA')).toBeCloseTo(baseline, 3);
  });

  it('boosts a task matching an active rule once the resolver is wired', () => {
    const task = makeTask('mining run for iron blocks', ['mining', 'blocks']);
    const baseline = score(task, 'BotA');

    const rule: TownRule = {
      id: 'rule-1', townId: 't1', text: 'mining daily',
      keywords: ['mining', 'blocks'], priority: 1, active: true, createdAt: Date.now(),
    };
    bb.setActiveRulesForBotResolver(() => [rule]);

    const boosted = score(task, 'BotA');
    expect(boosted).toBeGreaterThan(baseline);
    expect(boosted - baseline).toBeCloseTo(8, 3); // priority 1 ⇒ +8
  });

  it('scales the boost by rule priority', () => {
    const task = makeTask('build a stone wall', ['build', 'wall']);
    const baseline = score(task, 'BotA');

    bb.setActiveRulesForBotResolver(() => [{
      id: 'rule-2', townId: 't1', text: 'always be building walls',
      keywords: ['wall'], priority: 3, active: true, createdAt: Date.now(),
    }]);

    expect(score(task, 'BotA') - baseline).toBeCloseTo(24, 3); // 8 * priority(3)
  });

  it('does not boost a task that matches no rule keyword', () => {
    const task = makeTask('harvest the wheat field', ['harvest', 'wheat']);
    const baseline = score(task, 'BotA');

    bb.setActiveRulesForBotResolver(() => [{
      id: 'rule-3', townId: 't1', text: 'mining blocks',
      keywords: ['mining', 'blocks'], priority: 1, active: true, createdAt: Date.now(),
    }]);

    expect(score(task, 'BotA')).toBeCloseTo(baseline, 3);
  });
});
