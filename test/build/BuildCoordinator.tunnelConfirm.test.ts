/**
 * Batch-2 hardening (repo review #5c): buildTunnel uses HARD-CODED world
 * coordinates for the current town's halls. Carving must require an explicit
 * confirm:true so it can't be triggered accidentally for another town/world
 * (which would /fill stone through whatever is at those coords). Without confirm
 * (and without dryRun) it returns the plan with refused:true and touches nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { BuildCoordinator } from '../../src/build/BuildCoordinator';

function makeCoord() {
  const getAllWorkers = vi.fn().mockReturnValue([]);
  const botManager = {
    getAllWorkers,
    getWorker: vi.fn(),
    getTownManager: vi.fn().mockReturnValue({ onBuildCompleted: vi.fn() }),
  } as any;
  const coord = new BuildCoordinator(botManager, { emit: vi.fn() } as any, { push: vi.fn() } as any);
  return { coord, getAllWorkers };
}

describe('BuildCoordinator.buildTunnel — confirm gate (review #5c)', () => {
  it('refuses to carve without confirm and never acquires a bot', async () => {
    const { coord, getAllWorkers } = makeCoord();
    const result = await coord.buildTunnel({});
    expect(result.executed).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.plan).toBeTruthy();
    // The guard returns before opBot(), so no bot/world interaction happened.
    expect(getAllWorkers).not.toHaveBeenCalled();
  });

  it('dryRun returns the plan without carving (and without refused)', async () => {
    const { coord, getAllWorkers } = makeCoord();
    const result = await coord.buildTunnel({ dryRun: true });
    expect(result.executed).toBe(false);
    expect(result.refused).toBeUndefined();
    expect(result.plan).toBeTruthy();
    expect(getAllWorkers).not.toHaveBeenCalled();
  });

  it('with confirm:true it proceeds past the guard (then fails cleanly with no connected bot)', async () => {
    const { coord, getAllWorkers } = makeCoord();
    // No connected bots → buildTunnel throws "No connected bot available...".
    // The point is it got PAST the confirm guard and tried to acquire a bot.
    await expect(coord.buildTunnel({ confirm: true })).rejects.toThrow(/connected bot/i);
    expect(getAllWorkers).toHaveBeenCalled();
  });
});
