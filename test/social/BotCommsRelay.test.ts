/**
 * Inter-bot message relay (main-thread BotComms) — cross-worker delivery
 * semantics. Project Sid P3, SHOULD-FIX #1.
 *
 * BotComms is the AUTHORITATIVE relay owned by BotManager: every bot's worker
 * reaches it through BotCommsProxy over IPC, so a broadcast/sendMessage issued
 * in one worker fans out to OTHER bots' inboxes here. These tests exercise the
 * relay class directly (no real workers needed — the worker→main hop is just
 * IPC plumbing already proven by the sibling proxies) and lock in the fan-out
 * semantics the proxy depends on:
 *
 *   1. broadcast from A is visible to B's getUnread but NOT echoed back to A.
 *   2. a direct sendMessage routes ONLY to the named recipient.
 *   3. getUnread drains (marks read) so a later drain doesn't re-deliver.
 *   4. getKnownBots reflects the registered roster (drives P3-A peer framing).
 *
 * fs + atomicWrite are mocked so the real data/bot_comms.json is never touched
 * and load() starts from an empty inbox; the singleton is reset per test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// No disk: existsSync=false so load() is a clean no-op; writes are stubbed.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const stub = {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
  return { ...actual, default: { ...actual, ...stub }, ...stub };
});

// Debounced persistence is irrelevant to delivery semantics — make it inert.
vi.mock('../../src/util/atomicWrite', () => ({
  atomicWriteJson: vi.fn().mockResolvedValue(undefined),
  atomicWriteJsonSync: vi.fn(),
}));

import { BotComms } from '../../src/social/BotComms';

function freshRelay(): BotComms {
  // The relay is a singleton (one per main thread). Reset it so each test gets
  // an empty inbox map rather than inheriting the previous test's state.
  (BotComms as any).instance = null;
  return BotComms.getInstance();
}

describe('BotComms relay — cross-worker delivery semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('broadcast from A is visible to B (and C) but NOT echoed back to A', () => {
    const relay = freshRelay();
    relay.registerBot('Alice');
    relay.registerBot('Bob');
    relay.registerBot('Carol');

    relay.broadcast('Alice', 'I believe in eco.', 'chat');

    // Recipients each see exactly one message, attributed to the sender.
    const bob = relay.getUnread('Bob');
    const carol = relay.getUnread('Carol');
    expect(bob).toHaveLength(1);
    expect(carol).toHaveLength(1);
    expect(bob[0].from).toBe('alice');
    expect(bob[0].content).toBe('I believe in eco.');

    // The sender must NOT receive its own broadcast.
    expect(relay.getUnread('Alice')).toHaveLength(0);
  });

  it('a direct sendMessage routes ONLY to the named recipient', () => {
    const relay = freshRelay();
    relay.registerBot('Alice');
    relay.registerBot('Bob');
    relay.registerBot('Carol');

    relay.sendMessage('Alice', 'Bob', 'come mine with me', 'help_request');

    const bob = relay.getUnread('Bob');
    expect(bob).toHaveLength(1);
    expect(bob[0].from).toBe('alice');
    expect(bob[0].type).toBe('help_request');

    // No leakage to the uninvolved bot or back to the sender.
    expect(relay.getUnread('Carol')).toHaveLength(0);
    expect(relay.getUnread('Alice')).toHaveLength(0);
  });

  it('getUnread drains: a second drain does not re-deliver the same message', () => {
    const relay = freshRelay();
    relay.registerBot('Alice');
    relay.registerBot('Bob');

    relay.broadcast('Alice', 'stay fed', 'chat');
    expect(relay.getUnread('Bob')).toHaveLength(1);
    // Already marked read — a subsequent brain-tick drain sees nothing.
    expect(relay.getUnread('Bob')).toHaveLength(0);
  });

  it('routes are case-insensitive on recipient name (worker passes raw names)', () => {
    const relay = freshRelay();
    relay.registerBot('Alice');
    relay.registerBot('Bob');

    // Worker-side callers pass the bot's display name; the relay keys lowercased.
    relay.sendMessage('Alice', 'BOB', 'mixed case', 'chat');
    expect(relay.getUnread('bob')).toHaveLength(1);
  });

  it('getKnownBots reflects the registered roster (drives P3-A peer framing)', () => {
    const relay = freshRelay();
    relay.registerBot('Alice');
    relay.registerBot('Bob');

    const known = relay.getKnownBots().sort();
    expect(known).toEqual(['alice', 'bob']);
  });
});
