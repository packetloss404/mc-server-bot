import { describe, it, expect, vi, afterEach } from 'vitest';

import { BotInstance } from '../../src/bot/BotInstance';

/** Build a BotInstance shell without running the constructor (which wires
 *  SocialMemory/BotComms). Only the fields forceReconnect touches are set. */
function makeInstance(overrides: Record<string, unknown> = {}): BotInstance {
  const instance = Object.create(BotInstance.prototype) as BotInstance;
  Object.assign(instance, {
    name: 'TestBot',
    destroyed: false,
    quarantined: false,
    pendingConnectTimeout: null,
    lastInboundPacketAt: 0,
    stopAmbientBehaviors: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  return instance;
}

describe('BotInstance.forceReconnect watchdog guard', () => {
  const timers: NodeJS.Timeout[] = [];
  afterEach(() => {
    while (timers.length) clearTimeout(timers.pop()!);
  });

  it('skips when a reconnect is already queued (slow backoff must survive the watchdog)', () => {
    const timer = setTimeout(() => {}, 900_000);
    timers.push(timer);
    const instance = makeInstance({ pendingConnectTimeout: timer });

    instance.forceReconnect();

    expect((instance as any).connect).not.toHaveBeenCalled();
    // The queued timer must be left in place for its own firing.
    expect((instance as any).pendingConnectTimeout).toBe(timer);
  });

  it('still reconnects a true zombie socket (no queued retry)', () => {
    const instance = makeInstance();

    instance.forceReconnect();

    expect((instance as any).connect).toHaveBeenCalledWith(true);
  });

  it('remains a no-op when quarantined', () => {
    const instance = makeInstance({ quarantined: true });

    instance.forceReconnect();

    expect((instance as any).connect).not.toHaveBeenCalled();
  });
});
