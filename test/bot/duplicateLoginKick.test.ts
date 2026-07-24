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

describe('BotInstance.parseVersionMismatchKick', () => {
  it('matches the vanilla/Paper "Outdated client" kick', () => {
    expect(BotInstance.parseVersionMismatchKick('"Outdated client! Please use 26.2"')).toBe(true);
    expect(BotInstance.parseVersionMismatchKick({ text: 'Outdated client! Please use 26.2' })).toBe(true);
  });

  it('matches the "Outdated server" kick (client newer than server)', () => {
    expect(BotInstance.parseVersionMismatchKick('Outdated server! I am still on 1.21.4')).toBe(true);
  });

  it("matches mineflayer's differentVersionError end reason", () => {
    expect(BotInstance.parseVersionMismatchKick('differentVersionError')).toBe(true);
  });

  it('matches the handshake error text', () => {
    expect(
      BotInstance.parseVersionMismatchKick(
        'This server is version 26.2, you are using version 1.21.11, please specify the correct version in the options.',
      ),
    ).toBe(true);
  });

  it('does NOT match throttle / duplicate-login / generic kicks', () => {
    expect(BotInstance.parseVersionMismatchKick('Connection throttled! Please wait before reconnecting.')).toBe(false);
    expect(BotInstance.parseVersionMismatchKick({ translate: 'multiplayer.disconnect.duplicate_login' })).toBe(false);
    expect(BotInstance.parseVersionMismatchKick('socketClosed')).toBe(false);
    expect(BotInstance.parseVersionMismatchKick(undefined)).toBe(false);
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
