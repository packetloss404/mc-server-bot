/**
 * ChainCoordinator rewire + #20 guard.
 *
 * Bots run in worker threads, so the coordinator must drive them over the
 * WorkerHandle IPC (queueTask command + voyagerTaskState request) — it
 * previously called WorkerHandle.getVoyagerLoop(), which doesn't exist, so the
 * whole feature threw. These tests pin the IPC wiring and the #20 fix: a stage
 * task that's still current or queued must NOT be re-queued (no double-execution).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ChainCoordinator, type SupplyChain } from '../../src/supplychain/ChainCoordinator';

const TASK = 'Mine 8 iron_ore';

function makeState(over: Partial<{ currentTask: string | null; completedTasks: string[]; failedTasks: string[]; queuedTasks: string[] }> = {}) {
  return { currentTask: null, completedTasks: [], failedTasks: [], queuedTasks: [], ...over };
}

function makeHandle() {
  const state = makeState();
  return {
    state,
    queueTask: vi.fn(),
    getCachedDetailedStatus: () => ({ voyager: { isRunning: true } }),
    getVoyagerTaskState: vi.fn(async () => ({ ...state })),
  };
}

function makeChain(): SupplyChain {
  return {
    id: 'c1',
    name: 'iron',
    stages: [{ id: 's1', botName: 'Sam', task: TASK, status: 'pending', retries: 0 }],
    status: 'idle',
    currentStageIndex: 0,
    loop: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('ChainCoordinator — worker IPC rewire + #20 double-execution guard', () => {
  let tmpRoot: string;
  let originalCwd: string;
  let coord: ChainCoordinator;
  let handle: ReturnType<typeof makeHandle>;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpRoot);
    fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });

    handle = makeHandle();
    const botManager = { getWorker: vi.fn().mockReturnValue(handle) } as any;
    coord = new ChainCoordinator(botManager, { emit: vi.fn() } as any, { push: vi.fn() } as any);
    // Stop the 5s poll timer so we can drive checkChainProgress() by hand.
    clearInterval((coord as any).pollingInterval);
    (coord as any).pollingInterval = null;

    (coord as any).chains.set('c1', makeChain());
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('startChain queues the first stage via the worker command (not getVoyagerLoop)', () => {
    const ok = coord.startChain('c1');
    expect(ok).toBe(true);
    expect(handle.queueTask).toHaveBeenCalledTimes(1);
    expect(handle.queueTask).toHaveBeenCalledWith(TASK, 'supply-chain');
    const stage = (coord as any).chains.get('c1').stages[0];
    expect(stage.status).toBe('running');
  });

  it('advances the stage when the worker reports the task completed', async () => {
    coord.startChain('c1');
    handle.state.completedTasks = [TASK];
    await (coord as any).checkChainProgress();
    // Single-stage chain → advancing past it completes the chain.
    expect((coord as any).chains.get('c1').status).toBe('completed');
  });

  it('#20: does NOT re-queue while the task is still queued on the bot (even past 10s)', async () => {
    coord.startChain('c1');
    expect(handle.queueTask).toHaveBeenCalledTimes(1);
    const stage = (coord as any).chains.get('c1').stages[0];
    stage.startedAt = Date.now() - 11_000; // past the 10s abandonment window
    handle.state.queuedTasks = [TASK];      // still pending on the bot

    await (coord as any).checkChainProgress();

    expect(handle.queueTask).toHaveBeenCalledTimes(1); // NOT re-queued
    expect(stage.retries).toBe(0);
    expect(stage.status).toBe('running');
  });

  it('#20: does NOT re-queue while the task is the bot current task', async () => {
    coord.startChain('c1');
    const stage = (coord as any).chains.get('c1').stages[0];
    stage.startedAt = Date.now() - 11_000;
    handle.state.currentTask = TASK; // actively running

    await (coord as any).checkChainProgress();

    expect(handle.queueTask).toHaveBeenCalledTimes(1);
    expect(stage.retries).toBe(0);
  });

  it('re-queues once when the task is genuinely abandoned (>10s, not current/queued/done)', async () => {
    coord.startChain('c1');
    expect(handle.queueTask).toHaveBeenCalledTimes(1);
    const stage = (coord as any).chains.get('c1').stages[0];
    stage.startedAt = Date.now() - 11_000;
    handle.state.currentTask = 'Something unrelated'; // moved on, original lost

    await (coord as any).checkChainProgress();

    expect(handle.queueTask).toHaveBeenCalledTimes(2); // re-queued exactly once
    expect(stage.retries).toBe(1);
    expect(stage.status).toBe('running');
  });
});
