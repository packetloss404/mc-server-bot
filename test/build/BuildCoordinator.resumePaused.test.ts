/**
 * Batch-2 hardening (repo review #5e): a build persisted as 'paused' must NOT
 * silently resume building on restart. resumePendingJobs() should re-park it
 * (status stays 'paused', pausedJobs re-armed, execution loop relaunched so it
 * blocks at the pause-wait) rather than driving it to 'running'. Running jobs
 * must still resume normally.
 *
 * executeBuild + loadSchematicCached are stubbed on the instance so the test
 * isolates the resume/re-park decision from the placement engine.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BuildCoordinator, type BuildJob } from '../../src/build/BuildCoordinator';

function makeIoStub() {
  return { emit: vi.fn() } as any;
}
function makeEventLogStub() {
  return { push: vi.fn() } as any;
}
function makeBotManagerStub() {
  return {
    getWorker: vi.fn().mockReturnValue({
      isBotConnected: vi.fn().mockResolvedValue(true),
      isAlive: vi.fn().mockReturnValue(true),
      chat: vi.fn(),
    }),
    getTownManager: vi.fn().mockReturnValue({ onBuildCompleted: vi.fn() }),
  } as any;
}

function makeJob(id: string, status: BuildJob['status']): BuildJob {
  return {
    id,
    schematicFile: 'test.schem',
    origin: { x: 0, y: 64, z: 0 },
    status,
    createdAt: Date.now(),
    totalBlocks: 1,
    placedBlocks: 0,
    assignments: [{ botName: 'Sam', yMin: 0, yMax: 255, blocksPlaced: 0, status: 'building' } as any],
  };
}

describe('BuildCoordinator.resumePendingJobs — paused jobs stay paused (review #5e)', () => {
  let tmpRoot: string;
  let originalCwd: string;
  let coord: BuildCoordinator;
  let executeCalls: string[];

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-resume-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpRoot);
    fs.mkdirSync(path.join(tmpRoot, 'schematics'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'schematics', 'test.schem'), 'stub');

    coord = new BuildCoordinator(makeBotManagerStub(), makeIoStub(), makeEventLogStub());
    executeCalls = [];
    // Stub the placement engine + schematic loader so we test only the
    // resume/re-park decision.
    (coord as any).executeBuild = async (jobId: string) => { executeCalls.push(jobId); };
    (coord as any).loadSchematicCached = async () => ({
      size: { x: 1, y: 1, z: 1 },
      blocks: [{ rx: 0, ry: 0, rz: 0, name: 'stone', stateStr: '' }],
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('re-parks a paused job (stays paused, re-arms pausedJobs) and relaunches the loop', async () => {
    const paused = makeJob('job-paused', 'paused');
    (coord as any).jobs.set(paused.id, paused);

    await coord.resumePendingJobs();

    expect(paused.status).toBe('paused');
    expect((coord as any).pausedJobs.has('job-paused')).toBe(true);
    // The loop is relaunched (so a later resumeBuild can unblock it) — but it
    // parks at the pause-wait rather than building.
    expect(executeCalls).toContain('job-paused');
  });

  it('resumes a running job to running', async () => {
    const running = makeJob('job-running', 'running');
    (coord as any).jobs.set(running.id, running);

    await coord.resumePendingJobs();

    expect(running.status).toBe('running');
    expect((coord as any).pausedJobs.has('job-running')).toBe(false);
    expect(executeCalls).toContain('job-running');
  });

  it('does not resume terminal jobs (completed/cancelled/failed)', async () => {
    for (const s of ['completed', 'cancelled', 'failed'] as const) {
      (coord as any).jobs.set(`job-${s}`, makeJob(`job-${s}`, s));
    }

    await coord.resumePendingJobs();

    expect(executeCalls).toEqual([]);
  });

  it('after re-park, resumeBuild clears the pause flag so the parked loop can build', async () => {
    const paused = makeJob('job-resumable', 'paused');
    (coord as any).jobs.set(paused.id, paused);

    await coord.resumePendingJobs();
    expect((coord as any).pausedJobs.has('job-resumable')).toBe(true);

    const ok = coord.resumeBuild('job-resumable');
    expect(ok).toBe(true);
    expect(paused.status).toBe('running');
    expect((coord as any).pausedJobs.has('job-resumable')).toBe(false);
  });
});
