/**
 * DecreeManager unit tests (Project Sid P2-C — "Governance that bites").
 *
 * Coverage:
 *   1. proposeDecree opens a `decree` approval, persists a HandlerDescriptor,
 *      and registers a resolveOnce hook. Firing that hook (= approval settles
 *      to 'approved') creates a live standing rule via the real RuleStore and
 *      records a mayor:decree event.
 *   2. The resolveOnce hook is what mints the rule — until the approval is
 *      approved, no rule exists (a denied/expired row mints nothing).
 *   3. The 'decree' rehydrator is registered on construction, and
 *      rehydrateHandler re-attaches a working resolveOnce hook from a
 *      persisted descriptor.
 *   4. Input guards: empty / oversize text and a missing approval manager
 *      yield null and mint no rule.
 *
 * We use the real RuleStore (tmpdir) plus a tiny fake ApprovalManager that
 * captures resolveOnce handlers so we can fire them deterministically, and a
 * fake TownManager that records events. DecreeManager only touches a small
 * surface of each, so a partial cast is safe.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DecreeManager, DECREE_HANDLER_KIND, MAX_DECREE_TEXT_LENGTH } from '../../src/town/DecreeManager';
import { RuleStore } from '../../src/town/RuleStore';
import type { ApprovalManager, HandlerDescriptor } from '../../src/town/ApprovalManager';
import type { TownManager } from '../../src/town/TownManager';

/**
 * Fake ApprovalManager: records created approvals + the resolveOnce handler so
 * a test can simulate the row settling to 'approved' by invoking the handler
 * with the original payload. Mirrors the real createApproval/resolveOnce/
 * registerKindHandler signatures DecreeManager calls.
 */
function makeFakeApprovalManager() {
  let counter = 0;
  const created: Array<{ townId: string; kind: string; payload: unknown; descriptor?: HandlerDescriptor }> = [];
  const resolveHandlers = new Map<string, (payload: unknown) => void | Promise<void>>();
  const registeredKinds = new Map<string, (approvalId: string, descriptor: HandlerDescriptor) => void | Promise<void>>();

  const am = {
    createApproval(input: { townId: string; kind: string; payload: unknown }, descriptor?: HandlerDescriptor) {
      const id = `appr-${++counter}`;
      created.push({ ...input, descriptor });
      return { id, townId: input.townId, kind: input.kind, payload: input.payload, status: 'open' };
    },
    async resolveOnce(approvalId: string, handler: (payload: unknown) => void | Promise<void>) {
      resolveHandlers.set(approvalId, handler);
    },
    registerKindHandler(kind: string, rehydrator: (approvalId: string, descriptor: HandlerDescriptor) => void | Promise<void>) {
      registeredKinds.set(kind, rehydrator);
    },
    /** Test helper: simulate an approval settling to 'approved'. */
    async fireApproved(approvalId: string, payload: unknown) {
      const h = resolveHandlers.get(approvalId);
      if (h) await h(payload);
    },
  } as unknown as ApprovalManager & {
    fireApproved(approvalId: string, payload: unknown): Promise<void>;
  };

  return { am, created, resolveHandlers, registeredKinds };
}

function makeFakeTownManager() {
  const events: Array<{ townId: string; kind: string; payload?: unknown }> = [];
  const tm = {
    recordEvent(input: { townId: string; kind: string; payload?: unknown }) {
      events.push(input);
      return { id: `ev-${events.length}`, ...input };
    },
  } as unknown as TownManager;
  return { tm, events };
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dyobot-decree-'));
}

describe('DecreeManager — P2-C bot-initiated decrees', () => {
  let tmpDir: string;
  let ruleStore: RuleStore;

  beforeEach(() => {
    tmpDir = makeTempDir();
    ruleStore = new RuleStore(tmpDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('registers the decree rehydrator on construction', () => {
    const { am, registeredKinds } = makeFakeApprovalManager();
    const { tm } = makeFakeTownManager();
    new DecreeManager(tm, ruleStore, am);
    expect(registeredKinds.has(DECREE_HANDLER_KIND)).toBe(true);
  });

  it('proposeDecree opens a decree approval with a persisted descriptor', async () => {
    const { am, created } = makeFakeApprovalManager();
    const { tm } = makeFakeTownManager();
    const mgr = new DecreeManager(tm, ruleStore, am);

    const approvalId = await mgr.proposeDecree({ townId: 't1', text: 'Keep the walls repaired', proposedBy: 'BotA' });
    expect(approvalId).toBe('appr-1');
    expect(created).toHaveLength(1);
    expect(created[0].kind).toBe(DECREE_HANDLER_KIND);
    expect(created[0].townId).toBe('t1');
    expect(created[0].descriptor?.kind).toBe(DECREE_HANDLER_KIND);
    expect((created[0].descriptor?.payload as any).text).toBe('Keep the walls repaired');
    // No rule yet — only on approval.
    expect(ruleStore.getActiveRules('t1')).toHaveLength(0);
  });

  it('the resolve handler creates a standing rule on approval (the core wiring)', async () => {
    const { am } = makeFakeApprovalManager();
    const { tm, events } = makeFakeTownManager();
    const mgr = new DecreeManager(tm, ruleStore, am);

    const approvalId = await mgr.proposeDecree({ townId: 't1', text: 'All residents must farm wheat daily', proposedBy: 'BotFarmer' });
    expect(approvalId).not.toBeNull();
    // Still no rule before approval.
    expect(ruleStore.getActiveRules('t1')).toHaveLength(0);

    // Simulate the approval settling to 'approved' — fire the resolveOnce hook.
    await am.fireApproved(approvalId!, { townId: 't1', text: 'All residents must farm wheat daily', proposedBy: 'BotFarmer' });

    const rules = ruleStore.getActiveRules('t1');
    expect(rules).toHaveLength(1);
    expect(rules[0].text).toBe('All residents must farm wheat daily');
    expect(rules[0].active).toBe(true);
    expect(rules[0].keywords).toContain('farm');
    expect(rules[0].keywords).toContain('wheat');

    // A mayor:decree event is recorded so the decree feed surfaces it.
    const decreeEvent = events.find((e) => e.kind === 'mayor:decree');
    expect(decreeEvent).toBeTruthy();
    expect((decreeEvent!.payload as any).source).toBe('proposed_decree');
    expect((decreeEvent!.payload as any).ruleId).toBe(rules[0].id);
  });

  it('rehydrateHandler re-attaches a working resolveOnce hook from a descriptor', async () => {
    const { am } = makeFakeApprovalManager();
    const { tm } = makeFakeTownManager();
    const mgr = new DecreeManager(tm, ruleStore, am);

    const descriptor: HandlerDescriptor = {
      kind: DECREE_HANDLER_KIND,
      payload: { townId: 't2', text: 'Defend the gates', proposedBy: 'town' },
      target: 't2',
    };
    await mgr.rehydrateHandler('appr-restored', descriptor);
    // Firing the rehydrated hook mints the rule, same as the live path.
    await am.fireApproved('appr-restored', descriptor.payload);

    const rules = ruleStore.getActiveRules('t2');
    expect(rules).toHaveLength(1);
    expect(rules[0].text).toBe('Defend the gates');
  });

  it('rejects empty / oversize text and a missing approval manager', async () => {
    const { am, created } = makeFakeApprovalManager();
    const { tm } = makeFakeTownManager();
    const mgr = new DecreeManager(tm, ruleStore, am);

    expect(await mgr.proposeDecree({ townId: 't1', text: '   ' })).toBeNull();
    expect(await mgr.proposeDecree({ townId: 't1', text: 'x'.repeat(MAX_DECREE_TEXT_LENGTH + 1) })).toBeNull();
    expect(created).toHaveLength(0);

    // No approval manager wired ⇒ no-op.
    const noAm = new DecreeManager(tm, ruleStore, null);
    expect(await noAm.proposeDecree({ townId: 't1', text: 'valid text' })).toBeNull();
    expect(ruleStore.getActiveRules('t1')).toHaveLength(0);
  });
});
