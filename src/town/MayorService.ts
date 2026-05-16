/**
 * MayorService — Phase 6-A.
 *
 * Singleton service that owns the player-facing "Mayor" presence for every
 * town: which player is mayor of which town, what honorific title to use, and
 * how to format the personality-flavored greeting bots should say when the
 * player walks into town.
 *
 * Cooldowns are in-memory only (persistence is a follow-up). Reset on town
 * abandon via `clearTown(townId)`.
 *
 * Public surface:
 *   - getMayor(townId)
 *   - setMayor(townId, playerName, title)            (round-trips via TownManager.setMayor)
 *   - formatGreeting(townId, botPersonality)
 *   - markGreeted(townId, botName, playerName)
 *   - canGreet(townId, botName, playerName)
 *   - clearTown(townId)
 *
 * Phase 6-B (voting + approvals) will call setMayor on re-election; the
 * setter is exposed here so that path doesn't have to know about TownManager
 * internals.
 */
import type { TownManager } from './TownManager';

/** 5-minute cooldown per (bot, player) pair. Hardcoded — config follow-up. */
export const GREETING_COOLDOWN_MS = 5 * 60 * 1000;

export interface MayorInfo {
  playerName: string;
  title: string;
}

/**
 * Per-personality greeting style. Returns the full greeting text given the
 * mayor's full honorific (e.g. "Mayor Lord Savior packetloss404"). Falls
 * back to a neutral villager line when the personality isn't in the table.
 */
type GreetingFn = (honorific: string) => string;

const GREETERS: Record<string, GreetingFn> = {
  // Guards: terse and formal.
  guard: (h) => `Welcome back, ${h}.`,
  // Elders: warm with a flourish.
  elder: (h) => `Ah — ${h} graces us with their presence once more. Be welcome, friend.`,
  // Farmers: down-to-earth, work-context.
  farmer: (h) => `Mornin' ${h}! Crops are comin' along nicely.`,
  // Merchants: pitch + greeting in one.
  merchant: (h) => `${h}! Always good to see you — care to browse the wares?`,
  // Blacksmiths: gruff but respectful.
  blacksmith: (h) => `${h}. The forge is hot if you've need of it.`,
  // Explorers: excited, slightly distracted.
  explorer: (h) => `Hey ${h}! You wouldn't believe what I saw on the last expedition.`,
  // Builder: practical update.
  builder: (h) => `Good to see you, ${h} — we've made some progress on the new district.`,
};

const DEFAULT_GREETER: GreetingFn = (h) => `Welcome to town, ${h}.`;

export class MayorService {
  private readonly townManager: TownManager;
  /** Cooldown ledger: townId -> botName -> playerName -> lastGreetingAt. */
  private readonly cooldown: Map<string, Map<string, Map<string, number>>> = new Map();
  /** Override the wall-clock for tests. */
  private nowFn: () => number = () => Date.now();

  constructor(townManager: TownManager) {
    this.townManager = townManager;
  }

  /** Test seam — swap the clock. */
  setNowFn(fn: () => number): void {
    this.nowFn = fn;
  }

  /**
   * Return the mayor of a town, or null when no mayor is set or the town is
   * unknown. Reads town.config.mayor (set at founding via FoundTownModal).
   */
  getMayor(townId: string): MayorInfo | null {
    const town = this.townManager.getTown(townId);
    if (!town) return null;
    const mayor = town.config?.mayor;
    const playerName = mayor?.playerName;
    const title = mayor?.title;
    if (!playerName || typeof playerName !== 'string') return null;
    if (!title || typeof title !== 'string') return null;
    return { playerName, title };
  }

  /**
   * Update the mayor for a town. Round-trips through TownManager.setMayor
   * so the config.mayor.* fields are persisted in the towns table. Returns
   * true on success. Phase 6-B (voting / re-election) is the primary caller.
   */
  setMayor(townId: string, playerName: string, title: string): boolean {
    if (!playerName || !title) return false;
    return this.townManager.setMayor(townId, playerName, title);
  }

  /**
   * Build the greeting string a resident bot should say. Mixes the mayor's
   * honorific ("<title> <playerName>", e.g. "Mayor Lord Savior packetloss404")
   * with a personality-specific phrasing.
   *
   * Returns null when no mayor is set — caller should skip the chat in that
   * case rather than say something generic.
   */
  formatGreeting(townId: string, botPersonality: string | null | undefined): string | null {
    const mayor = this.getMayor(townId);
    if (!mayor) return null;
    const honorific = this.buildHonorific(mayor);
    const personality = (botPersonality ?? '').toLowerCase();
    const greeter = GREETERS[personality] ?? DEFAULT_GREETER;
    return greeter(honorific);
  }

  /**
   * True iff the (bot, player) pair is past its cooldown (or has never
   * greeted before). The dispatcher calls this before queuing a chat.
   */
  canGreet(townId: string, botName: string, playerName: string): boolean {
    const last = this.cooldown.get(townId)?.get(botName.toLowerCase())?.get(playerName.toLowerCase());
    if (last == null) return true;
    return this.nowFn() - last >= GREETING_COOLDOWN_MS;
  }

  /**
   * Stamp the cooldown for a (bot, player) pair so the dispatcher knows to
   * skip them for the next GREETING_COOLDOWN_MS.
   */
  markGreeted(townId: string, botName: string, playerName: string): void {
    let townMap = this.cooldown.get(townId);
    if (!townMap) {
      townMap = new Map();
      this.cooldown.set(townId, townMap);
    }
    const botKey = botName.toLowerCase();
    let botMap = townMap.get(botKey);
    if (!botMap) {
      botMap = new Map();
      townMap.set(botKey, botMap);
    }
    botMap.set(playerName.toLowerCase(), this.nowFn());
  }

  /**
   * Drop all cooldown state for a town. Called from TownManager.abandonTown
   * so a re-founded town doesn't start with stale cooldown entries.
   */
  clearTown(townId: string): void {
    this.cooldown.delete(townId);
  }

  // ────────────────────────────────────────────────────────────────────────
  //  Internals
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Compose "<title> <playerName>" but avoid duplicating the player name when
   * the title already ends with it (FoundTownModal pre-bakes that shape:
   * "Mayor Lord Savior packetloss404"). The trim keeps the output clean
   * regardless of which path the title came from.
   */
  private buildHonorific(mayor: MayorInfo): string {
    const title = mayor.title.trim();
    const playerName = mayor.playerName.trim();
    if (!title) return playerName;
    if (title.toLowerCase().endsWith(playerName.toLowerCase())) return title;
    return `${title} ${playerName}`;
  }
}
