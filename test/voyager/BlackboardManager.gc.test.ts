/**
 * Followup #68 — regression test for BlackboardManager.gcStaleScheduleTasks.
 *
 * The schedule-task GC sweep was added by ScheduleManager (Phase 9) to keep
 * the blackboard from growing without bound when unclaimed day/night tasks
 * pile up over many in-game days. Its scope is intentionally narrow:
 *
 *   sweep iff (source === 'swarm')
 *           && (keywords ⊇ {'town'} ∧ keywords ⊇ {'day' ∨ 'night'})
 *           && (status === 'pending')
 *           && (createdAt < now - maxAgeMs)
 *
 * Allied trade-route tasks (TradeRouteManager, Phase 7-B) also use `source:
 * 'swarm'` and tag with `'town'` — but intentionally lack the day/night
 * phase keyword so they survive the sweep. This test pins that invariant
 * so a future agent can't add `'day'` to the trade-route keyword list and
 * silently destroy ally trade tasks during the next GC pass.
 *
 * We use a real BlackboardManager rooted at a temp directory (the manager
 * writes JSON via fs); no DB or mocking required.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BlackboardManager } from '../../src/voyager/BlackboardManager';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dyobot-bb-gc-'));
}

/**
 * Push a task onto the blackboard via the public `addTask` API, then mutate
 * its `createdAt` so the GC cutoff window applies. We mutate via the public
 * `getState`-shaped accessor only as a last resort — the underlying tasks
 * array isn't reachable that way, so we reach into the private `state`
 * field. Tests are the only place this is acceptable.
 */
function seedSwarmTask(
  bb: BlackboardManager,
  opts: { description: string; keywords: string[]; ageMs: number; status?: 'pending' | 'claimed' },
): void {
  const task = bb.addTask(
    { description: opts.description, keywords: opts.keywords },
    'swarm',
    undefined,
    'high',
  );
  // Reach into private state to backdate createdAt. The manager has no
  // public setter for this (and shouldn't — production code never wants it).
  const state = (bb as unknown as { state: { tasks: Array<{ id: string; createdAt: number; status: string }> } }).state;
  const found = state.tasks.find((t) => t.id === task.id);
  if (!found) throw new Error('seedSwarmTask: task not present after addTask');
  found.createdAt = Date.now() - opts.ageMs;
  if (opts.status) found.status = opts.status;
}

function listTaskDescriptions(bb: BlackboardManager): string[] {
  return bb.getState().tasks.map((t) => t.description);
}

describe('BlackboardManager.gcStaleScheduleTasks', () => {
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

  it('does not sweep trade-route tasks (no day/night keyword, regression for #68)', () => {
    // The canonical keyword set TradeRouteManager.queueRoute emits.
    // See src/town/TradeRouteManager.ts — note the absence of 'day'/'night'.
    const tradeKeywords = ['wood', 'trade', 'town', 'ally', 'supply', 'target'];
    seedSwarmTask(bb, {
      description: 'town:source ally trade — deliver 64 wood to Target',
      keywords: tradeKeywords,
      ageMs: 25 * 60 * 60 * 1000, // 25h old → past the 24h cutoff
      status: 'pending',
    });

    const removed = bb.gcStaleScheduleTasks();

    expect(removed).toBe(0);
    expect(listTaskDescriptions(bb)).toContain(
      'town:source ally trade — deliver 64 wood to Target',
    );
  });

  it('sweeps schedule-source tasks (town + day keyword, pending, >24h old)', () => {
    // The canonical keyword shape ScheduleManager.emitForRole pushes.
    // See src/town/ScheduleManager.ts — ['town', `town:${id}`, 'phase', phase, role, ...extra].
    const scheduleKeywords = ['town', 'town:t1', 'phase', 'day', 'farmer', 'farm', 'crop'];
    seedSwarmTask(bb, {
      description: 'tend crops, plant seeds, and harvest mature food',
      keywords: scheduleKeywords,
      ageMs: 25 * 60 * 60 * 1000, // 25h → past the 24h cutoff
      status: 'pending',
    });

    const removed = bb.gcStaleScheduleTasks();

    expect(removed).toBe(1);
    expect(listTaskDescriptions(bb)).not.toContain(
      'tend crops, plant seeds, and harvest mature food',
    );
  });

  it('does not sweep recent schedule tasks (under the maxAgeMs cutoff)', () => {
    // Same schedule keyword shape, but only 1h old → must survive.
    const scheduleKeywords = ['town', 'town:t1', 'phase', 'night', 'guard', 'patrol'];
    seedSwarmTask(bb, {
      description: 'patrol aggressively and fight hostile mobs near town',
      keywords: scheduleKeywords,
      ageMs: 60 * 60 * 1000, // 1h old → well under the 24h cutoff
      status: 'pending',
    });

    const removed = bb.gcStaleScheduleTasks();

    expect(removed).toBe(0);
    expect(listTaskDescriptions(bb)).toContain(
      'patrol aggressively and fight hostile mobs near town',
    );
  });
});
