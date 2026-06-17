/**
 * Batch-2 hardening (repo review #5a): timed-out site-prep must actually STOP
 * mutating the world. withTimeout only rejects the caller; withCancelableTimeout
 * aborts an AbortSignal on timeout, and the destructive ops (runClearSite,
 * prepareBunkerSite) break out of their /fill loops when the signal aborts.
 */
import { describe, it, expect, vi } from 'vitest';
import { BuildCoordinator } from '../../src/build/BuildCoordinator';
import { prepareBunkerSite } from '../../src/actions/bunkerSite';

function makeCoord(): any {
  const botManager = { getWorker: vi.fn(), getTownManager: vi.fn().mockReturnValue({ onBuildCompleted: vi.fn() }) } as any;
  return new BuildCoordinator(botManager, { emit: vi.fn() } as any, { push: vi.fn() } as any);
}

describe('site-prep cancellation (review #5a)', () => {
  it('withCancelableTimeout aborts the signal when the deadline elapses', async () => {
    vi.useFakeTimers();
    const coord = makeCoord();
    let captured: AbortSignal | null = null;
    const p = coord.withCancelableTimeout(
      (signal: AbortSignal) => { captured = signal; return new Promise(() => { /* never resolves */ }); },
      50,
      'test-op',
    );
    // Attach a rejection handler before advancing so the rejection is observed.
    const assertion = expect(p).rejects.toThrow(/test-op timed out/);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(captured).not.toBeNull();
    expect(captured!.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('withCancelableTimeout does NOT abort when the op finishes in time', async () => {
    const coord = makeCoord();
    let captured: AbortSignal | null = null;
    const result = await coord.withCancelableTimeout(
      async (signal: AbortSignal) => { captured = signal; return 'done'; },
      1000,
      'fast-op',
    );
    expect(result).toBe('done');
    expect(captured!.aborted).toBe(false);
  });

  it('runClearSite stops issuing /fill once the signal is aborted', async () => {
    const coord = makeCoord();
    const chat = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const res = await coord.runClearSite(
      { chat, botName: 'Sam' },
      { footprintMin: { x: 0, y: 64, z: 0 }, footprintMax: { x: 5, y: 70, z: 5 }, clearanceHeight: 12 },
      controller.signal,
    );
    expect(res.cleared).toBe(0);
    expect(chat).not.toHaveBeenCalled();
  });

  it('prepareBunkerSite stops excavating when aborted (no /fill, aborted warning)', async () => {
    const chat = vi.fn();
    const getBlockAt = vi.fn().mockResolvedValue({ name: 'stone' });
    const controller = new AbortController();
    controller.abort();
    const res = await prepareBunkerSite(
      { chat, getBlockAt, botName: 'Sam' } as any,
      { x: 0, y: 60, z: 0 },
      { x: 4, y: 6, z: 4 },
      controller.signal,
    );
    expect(chat).not.toHaveBeenCalled();
    expect(res.warnings.some((w) => /aborted/i.test(w))).toBe(true);
  });
});
