import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PlayerPresenceTracker } from '../../src/bot/PlayerPresenceTracker';
import type { DifficultyBalancer } from '../../src/voyager/DifficultyBalancer';

function createMockBalancer() {
  return {
    updatePlayerState: vi.fn(),
    removePlayer: vi.fn(),
  } as unknown as DifficultyBalancer & {
    updatePlayerState: ReturnType<typeof vi.fn>;
    removePlayer: ReturnType<typeof vi.fn>;
  };
}

describe('PlayerPresenceTracker', () => {
  let balancer: ReturnType<typeof createMockBalancer>;
  let tracker: PlayerPresenceTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    balancer = createMockBalancer();
    tracker = new PlayerPresenceTracker(balancer);
  });

  it('recordJoin increases playerCount and notifies the balancer with a fresh profile', () => {
    tracker.recordJoin('Steve');

    expect(tracker.getPlayerCount()).toBe(1);
    expect(balancer.updatePlayerState).toHaveBeenCalledTimes(1);

    const profile = balancer.updatePlayerState.mock.calls[0][0];
    expect(profile).toMatchObject({
      name: 'Steve',
      deathCount: 0,
    });
  });

  it('recordJoin is idempotent — re-joining same player does not increment count', () => {
    tracker.recordJoin('Steve');
    tracker.recordJoin('Steve');

    expect(tracker.getPlayerCount()).toBe(1);
    // It still calls updatePlayerState on re-join (to refresh state), but the
    // playerCount must not grow.
    expect(balancer.updatePlayerState).toHaveBeenCalledTimes(2);
  });

  it('recordLeave decreases playerCount and calls removePlayer', () => {
    tracker.recordJoin('Steve');
    tracker.recordJoin('Alex');
    expect(tracker.getPlayerCount()).toBe(2);

    tracker.recordLeave('Steve');

    expect(tracker.getPlayerCount()).toBe(1);
    expect(balancer.removePlayer).toHaveBeenCalledTimes(1);
    expect(balancer.removePlayer).toHaveBeenCalledWith('Steve');
  });

  it('recordLeave on an unknown player is a no-op', () => {
    tracker.recordLeave('Ghost');

    expect(tracker.getPlayerCount()).toBe(0);
    expect(balancer.removePlayer).not.toHaveBeenCalled();
  });

  it('recordDeath increments deathCount in subsequent updatePlayerState calls', () => {
    tracker.recordJoin('Steve');
    balancer.updatePlayerState.mockClear();

    tracker.recordDeath('Steve');
    tracker.recordDeath('Steve');

    expect(balancer.updatePlayerState).toHaveBeenCalledTimes(2);
    const firstDeathProfile = balancer.updatePlayerState.mock.calls[0][0];
    const secondDeathProfile = balancer.updatePlayerState.mock.calls[1][0];
    expect(firstDeathProfile.deathCount).toBe(1);
    expect(secondDeathProfile.deathCount).toBe(2);
  });

  it('recordDeath on an unknown player is a no-op', () => {
    tracker.recordDeath('Ghost');

    expect(balancer.updatePlayerState).not.toHaveBeenCalled();
    expect(balancer.removePlayer).not.toHaveBeenCalled();
  });

  it('player name matching is case-insensitive', () => {
    tracker.recordJoin('Steve');
    tracker.recordLeave('steve');

    expect(tracker.getPlayerCount()).toBe(0);
    expect(balancer.removePlayer).toHaveBeenCalledTimes(1);
  });

  it('getPlayerNames() returns the original-case names', () => {
    tracker.recordJoin('Steve');
    tracker.recordJoin('Alex');

    const names = tracker.getPlayerNames();
    expect(names).toHaveLength(2);
    expect(names).toContain('Steve');
    expect(names).toContain('Alex');
  });
});
