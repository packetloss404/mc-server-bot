import { describe, it, expect } from 'vitest';

import { BotInstance } from '../../src/bot/BotInstance';

describe('BotInstance.parseDuplicateLoginKick', () => {
  it('matches the vanilla duplicate_login translation key', () => {
    // mineflayer commonly delivers a chat-component object.
    const reason = { translate: 'multiplayer.disconnect.duplicate_login' };
    expect(BotInstance.parseDuplicateLoginKick(reason)).toBe(true);
  });

  it('matches the plain-English "logged in from another location" text', () => {
    expect(BotInstance.parseDuplicateLoginKick('You logged in from another location')).toBe(true);
    expect(BotInstance.parseDuplicateLoginKick('logged in from another')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(BotInstance.parseDuplicateLoginKick('DUPLICATE_LOGIN')).toBe(true);
  });

  it('does NOT match throttle / banned / generic kicks', () => {
    expect(BotInstance.parseDuplicateLoginKick('Connection throttled! Please wait before reconnecting.')).toBe(false);
    expect(BotInstance.parseDuplicateLoginKick('You must wait 23 seconds before logging-in again.')).toBe(false);
    expect(BotInstance.parseDuplicateLoginKick('You are banned from this server')).toBe(false);
    expect(BotInstance.parseDuplicateLoginKick('Server closed')).toBe(false);
    expect(BotInstance.parseDuplicateLoginKick({ translate: 'multiplayer.disconnect.kicked' })).toBe(false);
  });
});

describe('BotInstance.normalizeKickReason', () => {
  it('returns strings unchanged', () => {
    expect(BotInstance.normalizeKickReason('hello')).toBe('hello');
  });

  it('stringifies chat-component objects so translate keys are matchable', () => {
    const out = BotInstance.normalizeKickReason({ translate: 'multiplayer.disconnect.duplicate_login' });
    expect(out).toContain('duplicate_login');
  });
});
