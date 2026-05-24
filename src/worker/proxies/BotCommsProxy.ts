import { IPCChannel } from '../IPCChannel';
import type { BotMessage } from '../../social/BotComms';

/**
 * Project Sid P3 (SHOULD-FIX #1) — worker-side proxy for the main-thread
 * BotComms relay.
 *
 * `BotComms.getInstance()` is a PER-WORKER singleton: each bot's worker has its
 * own inbox map, loaded once at construction and never shared. So a
 * `broadcast`/`sendMessage` issued in one worker only ever landed in that same
 * worker's inbox — and `VoyagerLoop`'s drain (`getUnread`) only saw a bot's own
 * intra-worker traffic. That meant P3-A bot→bot affinity and P3-B meme adoption
 * from peers rarely/never fired across the live multi-worker fleet.
 *
 * This proxy mirrors CultureProxy/AffinityProxy exactly: the AUTHORITATIVE
 * inbox/fan-out lives in the MAIN thread (the BotComms instance owned by
 * BotManager — the same one `GET/POST /api/bots/:name/messages` already talks
 * to), and workers reach it through the existing IPC channel. A broadcast from
 * bot A's worker is delivered to bot B's worker inbox (and vice versa), which is
 * what the cross-worker affinity/culture diffusion needs.
 *
 * Convention (matching the sibling proxies):
 *   - mutating sends (`broadcast`, `sendMessage`, `registerBot`, `unregisterBot`)
 *     are fire-and-forget `notify`s;
 *   - reads (`getUnread`, `getKnownBots`) are `request`s that await the
 *     main-thread relay and FAIL SAFE to an empty result on any IPC error, so a
 *     transient relay hiccup degrades to "no messages this tick" rather than
 *     throwing into the brain-tick.
 *
 * Only constructed when `config.social.botAffinity` OR `config.social.culture`
 * is true (see botWorker.ts). With BOTH flags off the worker keeps using the
 * per-worker `BotComms.getInstance()` and there is ZERO new IPC traffic — the
 * flag-off path is byte-identical to before this fix.
 */
export class BotCommsProxy {
  constructor(private ipc: IPCChannel) {}

  /** Direct message to a named recipient (fire-and-forget). */
  sendMessage(from: string, to: string, content: string, type: BotMessage['type'] = 'chat'): void {
    this.ipc.notify('botComms.sendMessage', [from, to, content, type]);
  }

  /** Broadcast to every OTHER known bot (fire-and-forget). */
  broadcast(from: string, content: string, type: BotMessage['type'] = 'chat'): void {
    this.ipc.notify('botComms.broadcast', [from, content, type]);
  }

  /** Drain this bot's unread inbox from the main-thread relay (marks them read). */
  async getUnread(botName: string): Promise<BotMessage[]> {
    try {
      const r = await this.ipc.request('botComms.getUnread', [botName]);
      return (r ?? []) as BotMessage[];
    } catch {
      return [];
    }
  }

  /** Names (lowercased) of all bots the relay knows about, fail-safe to []. */
  async getKnownBots(): Promise<string[]> {
    try {
      const r = await this.ipc.request('botComms.getKnownBots', []);
      return (r ?? []) as string[];
    } catch {
      return [];
    }
  }

  /** Register this bot's inbox on the relay (fire-and-forget). */
  registerBot(botName: string): void {
    this.ipc.notify('botComms.registerBot', [botName]);
  }

  /** Tear down this bot's inbox on the relay (fire-and-forget). */
  unregisterBot(botName: string): void {
    this.ipc.notify('botComms.unregisterBot', [botName]);
  }
}
