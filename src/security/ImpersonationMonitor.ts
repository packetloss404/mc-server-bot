/**
 * Tracks impersonation incidents — another client logging in under one of our
 * bots' usernames. Two signals feed it (see BotInstance / BotManager):
 *   - 'duplicate-login': the impersonated bot was kicked with a duplicate_login
 *     reason (high fidelity, the victim itself reports it).
 *   - 'ghost-name': another bot saw a roster name come online while our bot of
 *     that name was offline (corroboration).
 *
 * Repeated signals for the same bot are collapsed into a single open incident
 * (with an incremented `count`) inside a dedup window, so a reconnect/login war
 * produces one alert rather than a flood. The store is in-memory and bounded;
 * it is intended for live operator visibility, not durable audit.
 */

export type ImpersonationSignal = 'duplicate-login' | 'ghost-name';

export interface ImpersonationIncident {
  botName: string;
  signal: ImpersonationSignal;
  reason: string;
  /** Number of signals folded into this incident within the dedup window. */
  count: number;
  firstAt: number;
  lastAt: number;
}

export interface ImpersonationInput {
  botName: string;
  signal: ImpersonationSignal;
  reason: string;
}

export class ImpersonationMonitor {
  /** Most-recent incident per bot key (lowercased name). */
  private byBot: Map<string, ImpersonationIncident> = new Map();
  /** Bounded history, newest last. */
  private history: ImpersonationIncident[] = [];

  constructor(
    /** Repeats for the same bot inside this window fold into one incident. */
    private readonly dedupWindowMs = 30_000,
    private readonly maxHistory = 200,
  ) {}

  /**
   * Record a signal. Returns the (possibly merged) incident and `isNew`, which
   * is true only when this opened a fresh incident — callers gate noisy
   * side-effects (webhook, in-game broadcast) on `isNew` so repeats stay quiet.
   */
  record(input: ImpersonationInput, now = Date.now()): { isNew: boolean; incident: ImpersonationIncident } {
    const key = input.botName.toLowerCase();
    const existing = this.byBot.get(key);

    if (existing && now - existing.lastAt <= this.dedupWindowMs) {
      existing.count += 1;
      existing.lastAt = now;
      // Upgrade the recorded reason/signal to the latest sighting so the
      // operator sees the freshest detail.
      existing.reason = input.reason;
      existing.signal = input.signal;
      return { isNew: false, incident: existing };
    }

    const incident: ImpersonationIncident = {
      botName: input.botName,
      signal: input.signal,
      reason: input.reason,
      count: 1,
      firstAt: now,
      lastAt: now,
    };
    this.byBot.set(key, incident);
    this.history.push(incident);
    if (this.history.length > this.maxHistory) this.history.shift();
    return { isNew: true, incident };
  }

  /** All incidents, newest first. */
  list(): ImpersonationIncident[] {
    return [...this.history].reverse();
  }

  /** The most recent incident for a given bot, or undefined. */
  getForBot(botName: string): ImpersonationIncident | undefined {
    return this.byBot.get(botName.toLowerCase());
  }
}
