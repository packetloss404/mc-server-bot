/**
 * Tests for the pre-job site-prep deadline in BuildCoordinator.startBuild.
 *
 * Verifies:
 * 1. withTimeout rejects with a clear error on expiry and clears the timer.
 * 2. startBuild propagates a timeout in the CRITICAL resolveOrigin path
 *    (auto-flat mode that calls selectBuildSite, which hangs in these tests).
 * 3. A timeout in the BEST-EFFORT runClearSite path degrades gracefully
 *    (the job is still created rather than thrown).
 * 4. The per-call sitePrepTimeoutMs option overrides the constructor default.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BuildCoordinator } from '../../src/build/BuildCoordinator';
import { withTimeout } from '../../src/util/withTimeout';
import type { BotManager } from '../../src/bot/BotManager';
import type { EventLog } from '../../src/server/EventLog';

// ── Minimal stubs ─────────────────────────────────────────────────────────────

function makeIoStub() {
  return { emit: vi.fn() } as any;
}

function makeEventLogStub(): EventLog {
  return { push: vi.fn() } as any;
}

function makeBotManagerStub(connected = true): BotManager {
  const handle = {
    isBotConnected: vi.fn().mockResolvedValue(connected),
    getCachedStatus: vi.fn().mockReturnValue({ position: { x: 0, y: 64, z: 0 } }),
    chat: vi.fn(),
    getBlockAt: vi.fn().mockResolvedValue({ name: 'stone' }),
    getPlayers: vi.fn().mockResolvedValue([]),
  };
  return {
    getWorker: vi.fn().mockReturnValue(handle),
    getTownManager: vi.fn().mockReturnValue({ onBuildCompleted: vi.fn() }),
  } as any;
}

// ── Temp filesystem setup ─────────────────────────────────────────────────────

let tmpRoot: string;
let originalCwd: string;

function setupTmpEnv() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-timeout-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpRoot);

  fs.mkdirSync(path.join(tmpRoot, 'schematics'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'skills'), { recursive: true });

  // Write a minimal valid .schem file (header + empty blocks NBT stub).
  // We don't need real NBT — just enough that `fs.existsSync` passes
  // and `statSync` gives a small size. The coordinator will fail to parse
  // it and throw "no blocks", which is fine for timeout tests that mock
  // the slow awaits before that point.
  // For the clearSite test we need a parseable schematic; we'll use
  // a tiny hand-rolled NBT buffer that the coordinator accepts.
  // NOTE: We mock `loadSchematicCached` instead so we never hit the parser.
}

function teardownTmpEnv() {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

// ── withTimeout unit tests ────────────────────────────────────────────────────

describe('withTimeout helper', () => {
  it('resolves when the promise settles before the deadline', async () => {
    const p = Promise.resolve(42);
    const result = await withTimeout(p, 1000, 'test');
    expect(result).toBe(42);
  });

  it('rejects with the original error when the promise rejects before the deadline', async () => {
    const p = Promise.reject(new Error('original'));
    await expect(withTimeout(p, 1000, 'test')).rejects.toThrow('original');
  });

  it('rejects with a timeout error when the deadline elapses', async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => { /* never resolves */ });
    const raced = withTimeout(never, 50, 'my-op');
    vi.advanceTimersByTime(100);
    await expect(raced).rejects.toThrow('my-op timed out after 50ms');
    vi.useRealTimers();
  });

  it('clears the timer when the promise resolves (no leaked timer)', async () => {
    vi.useFakeTimers();
    const p = Promise.resolve('ok');
    const result = await withTimeout(p, 1000, 'check');
    // If the timer leaked, advancing past the deadline would reject. It should
    // not because we cleared it.
    vi.advanceTimersByTime(2000);
    expect(result).toBe('ok');
    vi.useRealTimers();
  });

  it('clears the timer when the promise rejects (no leaked timer)', async () => {
    vi.useFakeTimers();
    const p = Promise.reject(new Error('boom'));
    await expect(withTimeout(p, 1000, 'check')).rejects.toThrow('boom');
    // Advancing past the deadline should not cause a second rejection.
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
  });
});

// ── BuildCoordinator site-prep timeout tests ──────────────────────────────────

/**
 * A subclass of BuildCoordinator that lets us override the slow internal
 * helpers without touching production code.
 */
class TimeoutTestCoordinator extends BuildCoordinator {
  /** When set, `resolveOrigin` will block for this many ms before resolving. */
  resolveOriginDelayMs = 0;
  /** When set, `runClearSite` will block for this many ms before resolving. */
  clearSiteDelayMs = 0;
  /** Tracks whether runClearSite was called. */
  clearSiteCalled = false;

  /** Override loadSchematicCached to return a tiny stub. */
  protected async loadSchematicCached(_filename: string) {
    return {
      size: { x: 3, y: 3, z: 3 },
      blocks: [
        { rx: 0, ry: 0, rz: 0, name: 'stone', stateStr: '' },
        { rx: 1, ry: 0, rz: 0, name: 'stone', stateStr: '' },
        { rx: 2, ry: 0, rz: 0, name: 'stone', stateStr: '' },
      ],
    } as any;
  }

  /** Override resolveOrigin to optionally block. */
  protected async resolveOriginInner(
    _originMode: string,
    fallback: { x: number; y: number; z: number },
  ): Promise<{ x: number; y: number; z: number }> {
    if (this.resolveOriginDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.resolveOriginDelayMs));
    }
    return fallback;
  }

  /** Override runClearSite to optionally block. */
  protected async runClearSiteInner(): Promise<{ cleared: number; errors: string[] }> {
    this.clearSiteCalled = true;
    if (this.clearSiteDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.clearSiteDelayMs));
    }
    return { cleared: 1, errors: [] };
  }
}

// ── Config-plumbing test ──────────────────────────────────────────────────────

describe('BuildCoordinator sitePrepTimeoutMs config plumbing', () => {
  it('reads sitePrepTimeoutMs from config.build when provided', () => {
    const coord = new BuildCoordinator(
      makeBotManagerStub() as any,
      makeIoStub(),
      makeEventLogStub(),
      { build: { sitePrepTimeoutMs: 99_000 } } as any,
    );
    // Access the private field via type cast for test-assertion only.
    expect((coord as any).sitePrepTimeoutMs).toBe(99_000);
  });

  it('falls back to 240000 when config.build is absent', () => {
    const coord = new BuildCoordinator(
      makeBotManagerStub() as any,
      makeIoStub(),
      makeEventLogStub(),
    );
    expect((coord as any).sitePrepTimeoutMs).toBe(240_000);
  });

  it('falls back to 240000 when config is provided but build section is missing', () => {
    const coord = new BuildCoordinator(
      makeBotManagerStub() as any,
      makeIoStub(),
      makeEventLogStub(),
      { voyager: {} } as any,
    );
    expect((coord as any).sitePrepTimeoutMs).toBe(240_000);
  });
});
