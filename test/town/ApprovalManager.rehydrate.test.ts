/**
 * ApprovalManager rehydrate() integration tests against a REAL town.db.
 *
 * Focus: Project Sid P2-C defensive rehydration. When an open approval row
 * carries a `kind` whose proposer module isn't registered this process — e.g.
 * a 'decree' row persisted while governance was ON, then the flag turned OFF so
 * DecreeManager (which registers the 'decree' rehydrator) is never constructed —
 * rehydrate() must log-and-skip rather than throwing.
 *
 * Uses a real TownManager backed by a tmpdir SQLite DB (the same harness
 * DecreeManager.test.ts uses for RuleStore, extended to the town.db). We insert
 * an open approval row carrying a persisted handler descriptor directly via the
 * sqlite handle (town_id NULL is permitted by the nullable FK), then drive
 * rehydrate() through the real descriptor-DB path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TownManager } from '../../src/town/TownManager';
import { ApprovalManager, type HandlerDescriptor } from '../../src/town/ApprovalManager';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dyobot-appr-'));
}

/** Insert an open approval row carrying a persisted handler descriptor. */
function seedDecreeRow(tm: TownManager, id: string): void {
  const sqlite = (tm as unknown as { handle: { sqlite: import('better-sqlite3').Database } }).handle.sqlite;
  const now = Date.now();
  const descriptor: HandlerDescriptor = {
    kind: 'decree',
    payload: { townId: 't-gone', text: 'All residents must farm wheat daily', proposedBy: 'BotFarmer' },
    target: 't-gone',
  };
  sqlite
    .prepare(
      `INSERT INTO approvals (id, town_id, kind, payload_json, status, created_at, expires_at, mayor_decision, votes_json, handler_descriptor_json)
       VALUES (?, NULL, 'decree', ?, 'open', ?, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      JSON.stringify(descriptor.payload),
      now,
      now + 60_000,
      JSON.stringify({ yes: [], no: [] }),
      JSON.stringify(descriptor),
    );
}

describe('ApprovalManager.rehydrate — P2-C defensive handling (real town.db)', () => {
  let tmpDir: string;
  let tm: TownManager;

  beforeEach(() => {
    tmpDir = makeTempDir();
    tm = new TownManager({ dataDir: tmpDir });
  });

  afterEach(() => {
    try { tm.shutdown(); } catch { /* best effort */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('log-and-skips an open decree row when no rehydrator is registered (flag turned off)', async () => {
    seedDecreeRow(tm, 'apv-orphan');
    // Fresh ApprovalManager with NO 'decree' rehydrator — mimics governance
    // disabled, so DecreeManager (the only 'decree' registrant) never built.
    const am = new ApprovalManager(tm);
    // Must NOT throw, and must restore zero handlers.
    const restored = await am.rehydrate();
    expect(restored).toBe(0);
  });

  it('re-registers the hook when a matching rehydrator IS registered', async () => {
    seedDecreeRow(tm, 'apv-live');
    const am = new ApprovalManager(tm);
    const rehydrator = vi.fn(async (_id: string, _desc: HandlerDescriptor) => { /* re-attach */ });
    am.registerKindHandler('decree', rehydrator);

    const restored = await am.rehydrate();
    expect(restored).toBe(1);
    expect(rehydrator).toHaveBeenCalledTimes(1);
    const [calledId, calledDesc] = rehydrator.mock.calls[0];
    expect(calledId).toBe('apv-live');
    expect(calledDesc.kind).toBe('decree');
    expect((calledDesc.payload as any).text).toBe('All residents must farm wheat daily');
  });

  it('does not throw when a rehydrator itself throws (failure isolation)', async () => {
    seedDecreeRow(tm, 'apv-throws');
    const am = new ApprovalManager(tm);
    am.registerKindHandler('decree', () => { throw new Error('boom'); });

    // A throwing rehydrator is caught: rehydrate counts it as not-restored
    // and never propagates the error.
    const restored = await am.rehydrate();
    expect(restored).toBe(0);
  });
});
