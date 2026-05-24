/**
 * CultureManager + formatCultureForPrompt unit tests (Project Sid P3-B).
 *
 * Coverage:
 *   - Registry: addMeme (idempotent on label, keyword merge), listMemes, matchMeme.
 *   - Emergence: a recurring keyword is promoted into a meme (no LLM, cheap).
 *   - Adoption: idempotent per bot+meme; bumps strength; tracked per bot/town.
 *   - Measurement: getSummary mirrors per-town meme curves.
 *   - formatCultureForPrompt pure seam: '' when disabled / empty; one line,
 *     strongest first, capped, when enabled (mirrors formatRulesForPrompt).
 *
 * Uses a throwaway temp dir so the real data/culture.json is never touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CultureManager, formatCultureForPrompt, MAX_PROMPT_MEMES } from '../../src/social/CultureManager';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'culture-test-'));
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function mgr(): CultureManager {
  return new CultureManager(dir);
}

describe('CultureManager — registry', () => {
  it('registers a meme and matches by keyword', () => {
    const c = mgr();
    const m = c.addMeme('eco', ['plant', 'cleanup'], 'gaia');
    expect(m.label).toBe('eco');
    expect(m.keywords).toContain('plant');
    expect(m.originBot).toBe('gaia');
    const hit = c.matchMeme('we should plant more trees');
    expect(hit?.id).toBe(m.id);
    expect(c.matchMeme('totally unrelated text')).toBeNull();
  });

  it('addMeme is idempotent on label and merges new keywords', () => {
    const c = mgr();
    const a = c.addMeme('eco', ['plant']);
    const b = c.addMeme('eco', ['cleanup']);
    expect(b.id).toBe(a.id);
    expect(c.listMemes()).toHaveLength(1);
    expect(c.getMeme(a.id)!.keywords).toEqual(expect.arrayContaining(['plant', 'cleanup']));
  });
});

describe('CultureManager — emergence (no LLM)', () => {
  it('promotes a recurring keyword into a meme after the threshold', () => {
    const c = mgr();
    // 'pyramid' must recur a few times before it emerges.
    expect(c.observeChat('build a pyramid')).toBeNull();
    expect(c.observeChat('another pyramid here')).toBeNull();
    expect(c.observeChat('pyramid power')).toBeNull();
    const emerged = c.observeChat('pyramid forever');
    expect(emerged).not.toBeNull();
    expect(emerged!.label).toBe('pyramid');
    // Now it's a real meme that matches.
    expect(c.matchMeme('I love a good pyramid')?.label).toBe('pyramid');
  });

  it('does not double-count words already covered by an existing meme', () => {
    const c = mgr();
    c.addMeme('eco', ['plant']);
    // 'plant' is already a meme keyword; observing it should not emerge a dup.
    for (let i = 0; i < 10; i++) c.observeChat('plant plant plant');
    expect(c.listMemes().filter((m) => m.label === 'plant')).toHaveLength(0);
  });
});

describe('CultureManager — adoption', () => {
  it('records adoption, is idempotent, and bumps strength', () => {
    const c = mgr();
    const m = c.addMeme('eco', ['plant']);
    const before = c.getMeme(m.id)!.strength;
    expect(c.adopt(m.id, 'Alice', 'town1')).toBe(true);
    expect(c.adopt(m.id, 'Alice', 'town1')).toBe(false); // idempotent
    expect(c.getMeme(m.id)!.strength).toBeGreaterThan(before);
    const adopted = c.getAdoptedMemes('Alice');
    expect(adopted.map((x) => x.id)).toContain(m.id);
    expect(c.getAdoptedMemes('Bob')).toHaveLength(0);
  });

  it('adopt returns false for an unknown meme', () => {
    const c = mgr();
    expect(c.adopt('nope', 'Alice')).toBe(false);
  });
});

describe('CultureManager — getSummary (per-town meme curves)', () => {
  it('aggregates adoption + per-town keyword counts', () => {
    const c = mgr();
    const m = c.addMeme('eco', ['plant', 'cleanup']);
    c.adopt(m.id, 'Alice', 'town1');
    c.adopt(m.id, 'Bob', 'town1');
    c.adopt(m.id, 'Carol', 'town2');
    const s = c.getSummary();
    expect(s.totalAdoptions).toBe(3);
    const memeRow = s.memes.find((x) => x.id === m.id)!;
    expect(memeRow.adoptionCount).toBe(3);
    expect(s.towns['town1'].adoptions).toBe(2);
    expect(s.towns['town2'].adoptions).toBe(1);
    expect(s.towns['town1'].keywordCounts['plant']).toBe(2);
  });
});

describe('formatCultureForPrompt — P3-B prompt-bias seam', () => {
  const memes = [
    { label: 'eco', strength: 0.5 },
    { label: 'stay-fed', strength: 0.3 },
  ];

  it('returns empty when culture is disabled (no token cost)', () => {
    expect(formatCultureForPrompt(memes, false)).toBe('');
  });

  it('returns empty when there are no adopted memes', () => {
    expect(formatCultureForPrompt([], true)).toBe('');
    expect(formatCultureForPrompt(null, true)).toBe('');
    expect(formatCultureForPrompt(undefined, true)).toBe('');
  });

  it('includes meme labels, strongest first, when enabled', () => {
    const out = formatCultureForPrompt(memes, true);
    expect(out).toContain("Beliefs you've taken to heart: eco; stay-fed");
    expect(out).toContain('Let them shape what you choose to do.');
  });

  it('caps the number of memes and orders by strength', () => {
    const many = [];
    for (let i = 0; i < MAX_PROMPT_MEMES + 3; i++) many.push({ label: `weak${i}`, strength: 0.1 });
    const top = { label: 'STRONGEST', strength: 0.99 };
    const out = formatCultureForPrompt([...many, top], true);
    expect(out).toContain("Beliefs you've taken to heart: STRONGEST");
    const count = out
      .replace("Beliefs you've taken to heart: ", '')
      .replace('. Let them shape what you choose to do.', '')
      .split('; ').length;
    expect(count).toBe(MAX_PROMPT_MEMES);
  });
});
