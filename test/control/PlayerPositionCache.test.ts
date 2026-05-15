import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PlayerPositionCache } from '../../src/control/PlayerPositionCache';

describe('PlayerPositionCache', () => {
  let cache: PlayerPositionCache;

  beforeEach(() => {
    cache = new PlayerPositionCache();
  });

  it('returns the recorded position for a known player', () => {
    cache.recordPosition('Steve', { x: 100, y: 64, z: -50 });
    const got = cache.getPosition('Steve');
    expect(got).not.toBeNull();
    expect(got!.position).toEqual({ x: 100, y: 64, z: -50 });
    expect(typeof got!.recordedAt).toBe('number');
  });

  it('returns null for an unknown player', () => {
    expect(cache.getPosition('Nobody')).toBeNull();
  });

  it('marks an entry stale once maxAgeMs elapses', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
      cache.recordPosition('Steve', { x: 0, y: 64, z: 0 });

      // Fresh — not stale.
      expect(cache.isStale('Steve')).toBe(false);

      // Advance just past the default 60s window.
      vi.advanceTimersByTime(60_001);
      expect(cache.isStale('Steve')).toBe(true);

      // Custom maxAge override still works.
      cache.recordPosition('Steve', { x: 0, y: 64, z: 0 });
      vi.advanceTimersByTime(500);
      expect(cache.isStale('Steve', 1_000)).toBe(false);
      vi.advanceTimersByTime(1_000);
      expect(cache.isStale('Steve', 1_000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats unknown players as stale', () => {
    expect(cache.isStale('Ghost')).toBe(true);
  });

  it('clear() removes a player entry', () => {
    cache.recordPosition('Steve', { x: 1, y: 2, z: 3 });
    expect(cache.getPosition('Steve')).not.toBeNull();
    cache.clear('Steve');
    expect(cache.getPosition('Steve')).toBeNull();
    expect(cache.isStale('Steve')).toBe(true);
  });

  it('lookups are case-insensitive', () => {
    cache.recordPosition('Steve', { x: 10, y: 20, z: 30 });
    expect(cache.getPosition('steve')?.position).toEqual({ x: 10, y: 20, z: 30 });
    expect(cache.getPosition('STEVE')?.position).toEqual({ x: 10, y: 20, z: 30 });
    expect(cache.isStale('sTeVe')).toBe(false);

    cache.clear('STEVE');
    expect(cache.getPosition('steve')).toBeNull();
  });

  it('ignores invalid input without throwing', () => {
    expect(() => cache.recordPosition('', { x: 0, y: 0, z: 0 })).not.toThrow();
    expect(() => cache.recordPosition('Steve', null as any)).not.toThrow();
    expect(() => cache.recordPosition('Steve', { x: 'bad' as any, y: 0, z: 0 })).not.toThrow();
    expect(cache.getPosition('Steve')).toBeNull();
  });
});
