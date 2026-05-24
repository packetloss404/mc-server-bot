import { IPCChannel } from '../IPCChannel';
import type { Meme } from '../../social/CultureManager';

/**
 * Project Sid P3-B — worker-side proxy for the main-thread CultureManager.
 *
 * Mirrors AffinityProxy: read methods `request` (await response), mutating
 * methods `notify` (fire-and-forget). The authoritative meme registry lives in
 * the main thread so a meme observed/adopted in one worker is visible to every
 * other worker and to `GET /api/culture` — the verified cross-worker substrate
 * (each bot's in-worker BotComms/CultureManager singleton would NOT share state
 * otherwise).
 *
 * Only constructed when `config.social.culture` is true (see botWorker.ts), so
 * with the flag OFF there is zero IPC traffic and zero behavior change.
 *
 * Surface matches `VoyagerLoop.CultureLike`.
 */
export class CultureProxy {
  constructor(private ipc: IPCChannel) {}

  /** Cheap keyword scan against the registry; null when nothing matches. */
  async matchMeme(text: string): Promise<Meme | null> {
    return this.ipc.request('culture.matchMeme', [text]);
  }

  /** Memes this bot has adopted, strongest first. */
  async getAdoptedMemes(botName: string): Promise<Meme[]> {
    return this.ipc.request('culture.getAdoptedMemes', [botName]).then((r: any) => (r ?? []) as Meme[]);
  }

  /** Record an adoption (fire-and-forget). */
  adopt(memeId: string, botName: string, townId = ''): void {
    this.ipc.notify('culture.adopt', [memeId, botName, townId]);
  }

  /** Feed observed chat into the emergence tally (fire-and-forget). */
  observeChat(text: string): void {
    this.ipc.notify('culture.observeChat', [text]);
  }

  /** Seed a meme (carrier archetype / influencer) — fire-and-forget. */
  addMeme(label: string, keywords: string[], originBot = ''): void {
    this.ipc.notify('culture.addMeme', [label, keywords, originBot]);
  }
}
