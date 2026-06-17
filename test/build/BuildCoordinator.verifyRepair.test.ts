/**
 * Batch-2 hardening (repo review #5d): the build verify-and-repair sweep must
 * be holes-only. It re-places a target only when the spot reads as air/empty
 * (a genuine dropped placement); a DIFFERENT non-air block is preserved (almost
 * always a player edit) instead of being overwritten with /setblock replace —
 * which would silently revert player builds on every completion + re-run.
 *
 * Tests the classifyVerifyRead decision directly (the teleport/chunk-load
 * machinery around it is integration-only).
 */
import { describe, it, expect, vi } from 'vitest';
import { BuildCoordinator } from '../../src/build/BuildCoordinator';

function makeCoord(): any {
  const botManager = { getWorker: vi.fn(), getTownManager: vi.fn().mockReturnValue({ onBuildCompleted: vi.fn() }) } as any;
  return new BuildCoordinator(botManager, { emit: vi.fn() } as any, { push: vi.fn() } as any);
}

describe('BuildCoordinator.classifyVerifyRead — holes-only repair (review #5d)', () => {
  const coord = makeCoord();

  it("returns 'ok' when the world block matches the target", () => {
    expect(coord.classifyVerifyRead('stone', 'stone')).toBe('ok');
  });

  it("returns 'repair' for a genuine hole (air)", () => {
    expect(coord.classifyVerifyRead('air', 'stone')).toBe('repair');
    expect(coord.classifyVerifyRead('cave_air', 'stone')).toBe('repair');
    expect(coord.classifyVerifyRead('void_air', 'stone')).toBe('repair');
  });

  it("returns 'repair' when the read is unknown/empty (null)", () => {
    expect(coord.classifyVerifyRead(null, 'stone')).toBe('repair');
  });

  it("returns 'preserve' when a DIFFERENT non-air block is present (player edit)", () => {
    expect(coord.classifyVerifyRead('chest', 'stone')).toBe('preserve');
    expect(coord.classifyVerifyRead('oak_door', 'oak_planks')).toBe('preserve');
    // The classic revert case: player swapped a wall block for glass.
    expect(coord.classifyVerifyRead('glass', 'stone_bricks')).toBe('preserve');
  });
});
