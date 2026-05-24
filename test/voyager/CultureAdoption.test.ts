/**
 * VoyagerLoop culture adoption + behavior-bias tests (Project Sid P3-B).
 *
 * The adoption logic + the behavior-bias hook live on VoyagerLoop's private
 * methods (`maybeAdoptMeme`, `getAdoptedMemeLabels`). Constructing a full
 * VoyagerLoop needs a live mineflayer bot, so — mirroring NullGuards.test.ts —
 * we exercise the methods against an `Object.create(VoyagerLoop.prototype)`
 * instance with only the fields those methods touch injected.
 *
 * Coverage:
 *   1. Adoption happens ONLY from a high-affinity (trusted) peer.
 *   2. No adoption from a low-affinity peer (below trust threshold).
 *   3. Everything no-ops when `config.social.culture` is off.
 *   4. The adopted meme drives the ambient/goal behavior-bias hook
 *      (getAdoptedMemeLabels returns the adopted labels).
 */
import { describe, it, expect, vi } from 'vitest';
import { VoyagerLoop } from '../../src/voyager/VoyagerLoop';

/** A tiny in-memory stand-in for the CultureManager/CultureProxy surface. */
function fakeCulture() {
  const adopted = new Map<string, Set<string>>(); // bot -> memeIds
  const memes: Record<string, { id: string; label: string; keywords: string[]; strength: number }> = {
    'm-eco': { id: 'm-eco', label: 'eco', keywords: ['plant', 'tree'], strength: 0.5 },
  };
  return {
    observed: [] as string[],
    broadcasts: [] as string[],
    matchMeme(text: string) {
      const lower = text.toLowerCase();
      for (const m of Object.values(memes)) {
        if (m.keywords.some((k) => lower.includes(k))) return { ...m };
      }
      return null;
    },
    getAdoptedMemes(bot: string) {
      const ids = adopted.get(bot.toLowerCase()) ?? new Set();
      return [...ids].map((id) => ({ ...memes[id] }));
    },
    adopt(memeId: string, bot: string) {
      const key = bot.toLowerCase();
      if (!adopted.has(key)) adopted.set(key, new Set());
      adopted.get(key)!.add(memeId);
    },
    observeChat(text: string) { this.observed.push(text); },
    addMeme() { /* unused here */ },
  };
}

/** Build a VoyagerLoop-shaped object with just the fields the P3-B methods read. */
function makeLoop(opts: {
  cultureEnabled: boolean;
  affinityForPeer?: number; // bot->peer score; undefined = no edge
  trustThreshold?: number;
}) {
  const loop: any = Object.create(VoyagerLoop.prototype);
  loop.botName = 'Listener';
  loop.config = {
    social: { botAffinity: true, culture: opts.cultureEnabled },
    affinity: { trustThreshold: opts.trustThreshold ?? 70 },
  };
  loop.cultureManager = fakeCulture();
  loop.adoptedMemeIds = new Set(); // field initializer is bypassed by Object.create
  loop.affinityManager = {
    getAllForBot: vi.fn().mockResolvedValue(
      opts.affinityForPeer === undefined ? {} : { speaker: opts.affinityForPeer },
    ),
  };
  loop.socialMemory = { addMemory: vi.fn() };
  loop.botComms = { broadcast: vi.fn((from: string, content: string) => loop.cultureManager.broadcasts.push(content)) };
  return loop;
}

const MEME_MSG = { from: 'Speaker', type: 'chat', content: 'we should plant a tree' };

describe('VoyagerLoop P3-B — meme adoption gating', () => {
  it('adopts a meme from a HIGH-affinity (trusted) peer', async () => {
    const loop = makeLoop({ cultureEnabled: true, affinityForPeer: 85 });
    await loop.maybeAdoptMeme(MEME_MSG);
    expect(loop.cultureManager.getAdoptedMemes('Listener').map((m: any) => m.label)).toContain('eco');
    // Emergence observation always runs (cheap, no LLM).
    expect(loop.cultureManager.observed).toContain(MEME_MSG.content);
    // Adoption re-broadcasts the belief along the social graph (uses broadcast()).
    expect(loop.botComms.broadcast).toHaveBeenCalled();
  });

  it('does NOT re-adopt / re-broadcast an already-held belief (no meme storm)', async () => {
    const loop = makeLoop({ cultureEnabled: true, affinityForPeer: 85 });
    await loop.maybeAdoptMeme(MEME_MSG);
    await loop.maybeAdoptMeme(MEME_MSG); // hears it again
    await loop.maybeAdoptMeme(MEME_MSG);
    // Adopted once; broadcast fired only on the first (novel) adoption.
    expect(loop.cultureManager.getAdoptedMemes('Listener')).toHaveLength(1);
    expect(loop.botComms.broadcast).toHaveBeenCalledTimes(1);
  });

  it('does NOT adopt from a LOW-affinity peer (below trust threshold)', async () => {
    const loop = makeLoop({ cultureEnabled: true, affinityForPeer: 40 });
    await loop.maybeAdoptMeme(MEME_MSG);
    expect(loop.cultureManager.getAdoptedMemes('Listener')).toHaveLength(0);
    expect(loop.botComms.broadcast).not.toHaveBeenCalled();
  });

  it('does NOT adopt when there is no affinity edge to the peer', async () => {
    const loop = makeLoop({ cultureEnabled: true, affinityForPeer: undefined });
    await loop.maybeAdoptMeme(MEME_MSG);
    expect(loop.cultureManager.getAdoptedMemes('Listener')).toHaveLength(0);
  });

  it('is a complete no-op when social.culture is OFF', async () => {
    const loop = makeLoop({ cultureEnabled: false, affinityForPeer: 99 });
    await loop.maybeAdoptMeme(MEME_MSG);
    // Nothing observed, nothing adopted, no broadcast — byte-for-byte unchanged.
    expect(loop.cultureManager.observed).toHaveLength(0);
    expect(loop.cultureManager.getAdoptedMemes('Listener')).toHaveLength(0);
    expect(loop.botComms.broadcast).not.toHaveBeenCalled();
  });
});

describe('VoyagerLoop P3-B — adopted meme drives the behavior-bias hook', () => {
  it('getAdoptedMemeLabels surfaces adopted labels (ambient/goal bias source)', async () => {
    const loop = makeLoop({ cultureEnabled: true, affinityForPeer: 85 });
    await loop.maybeAdoptMeme(MEME_MSG);
    const labels = await loop.getAdoptedMemeLabels(3);
    expect(labels).toContain('eco');
  });

  it('getAdoptedMemeLabels returns [] when culture is OFF', async () => {
    const loop = makeLoop({ cultureEnabled: false, affinityForPeer: 85 });
    const labels = await loop.getAdoptedMemeLabels(3);
    expect(labels).toEqual([]);
  });
});
