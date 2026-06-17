/**
 * Batch-2 hardening tests (repo review #4) against a REAL town.db.
 *
 * Two low-risk idempotency/hygiene fixes:
 *   1. ExpansionManager.executeProposal must NOT found a duplicate child town
 *      when fired twice for the same (already-executed) proposal. Child names
 *      are deterministic, so the guard keys on an existing same-named child.
 *   2. ApprovalManager must null out handler_descriptor_json once an approval
 *      settles (approved/denied/expired), so a settled row can never be
 *      reconsidered by a future rehydrate path.
 *
 * Uses the same tmpdir-backed real TownManager harness as
 * ApprovalManager.rehydrate.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TownManager } from '../../src/town/TownManager';
import { ApprovalManager, type HandlerDescriptor } from '../../src/town/ApprovalManager';
import { ExpansionManager, type ChildProposal } from '../../src/town/ExpansionManager';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dyobot-appr-idem-'));
}

function descriptorColumn(tm: TownManager, approvalId: string): string | null {
  const sqlite = (tm as unknown as { handle: { sqlite: import('better-sqlite3').Database } }).handle.sqlite;
  const row = sqlite
    .prepare(`SELECT handler_descriptor_json FROM approvals WHERE id = ?`)
    .get(approvalId) as { handler_descriptor_json: string | null } | undefined;
  return row?.handler_descriptor_json ?? null;
}

describe('ExpansionManager.executeProposal — idempotency guard (real town.db)', () => {
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

  it('founds the child once and returns the existing town on a second fire', () => {
    const parent = tm.createTown({
      name: 'Parentville',
      capital: { x: 0, y: 64, z: 0 },
      stylePreset: 'medieval-communal',
    }).town;

    const em = new ExpansionManager(tm);
    const proposal: ChildProposal = {
      parentTownId: parent.id,
      parentTownName: parent.name,
      childName: 'Parentville-North',
      childCapital: { x: 0, y: 64, z: -256 },
      styleSeed: 'medieval-communal' as ChildProposal['styleSeed'],
      direction: 'North',
      autoApprove: true,
    };

    const first = em.executeProposal(proposal);
    expect(first.ok).toBe(true);
    expect(first.childTown).not.toBeNull();
    const firstId = first.childTown!.id;

    // Second fire of the SAME proposal must not create a duplicate.
    const second = em.executeProposal(proposal);
    expect(second.ok).toBe(true);
    expect(second.reason).toBe('already exists');
    expect(second.childTown!.id).toBe(firstId);

    const children = tm.getChildTowns(parent.id);
    expect(children.length).toBe(1);
    expect(children[0].name).toBe('Parentville-North');
  });
});

describe('ApprovalManager.clearDescriptor — descriptor cleared on settle (real town.db)', () => {
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

  it('nulls handler_descriptor_json when a mayor approves', async () => {
    const town = tm.createTown({
      name: 'Descriptorton',
      capital: { x: 10, y: 64, z: 10 },
      stylePreset: 'medieval-communal',
    }).town;

    const am = new ApprovalManager(tm);
    const descriptor: HandlerDescriptor = {
      kind: 'expansion',
      payload: { parentTownId: town.id, childName: 'Descriptorton-East' },
      target: town.id,
    };
    const approval = am.createApproval(
      { townId: town.id, kind: 'expansion', payload: descriptor.payload },
      descriptor,
    );
    expect(approval).not.toBeNull();
    // Descriptor is persisted at create time.
    expect(descriptorColumn(tm, approval!.id)).not.toBeNull();

    const decided = await am.mayorDecide(approval!.id, 'approved');
    expect(decided?.status).toBe('approved');
    // After settling, the descriptor column must be cleared.
    expect(descriptorColumn(tm, approval!.id)).toBeNull();
  });

  it('nulls handler_descriptor_json when a mayor denies', async () => {
    const town = tm.createTown({
      name: 'Denyburg',
      capital: { x: 20, y: 64, z: 20 },
      stylePreset: 'medieval-communal',
    }).town;

    const am = new ApprovalManager(tm);
    const descriptor: HandlerDescriptor = {
      kind: 'expansion',
      payload: { parentTownId: town.id, childName: 'Denyburg-West' },
      target: town.id,
    };
    const approval = am.createApproval(
      { townId: town.id, kind: 'expansion', payload: descriptor.payload },
      descriptor,
    );
    expect(approval).not.toBeNull();
    expect(descriptorColumn(tm, approval!.id)).not.toBeNull();

    const decided = await am.mayorDecide(approval!.id, 'denied');
    expect(decided?.status).toBe('denied');
    expect(descriptorColumn(tm, approval!.id)).toBeNull();
  });
});
