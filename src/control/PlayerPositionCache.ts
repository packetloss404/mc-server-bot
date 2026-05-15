/**
 * PlayerPositionCache
 *
 * Server-side cache of the most recently observed position for each player,
 * fed by Java-plugin event relays (chat, player-move). Lets the bot resolve
 * "player X's position" reliably, even when the player is briefly offline or
 * out of any bot's render distance.
 *
 * Entries are cleared on player-leave. Lookups are case-insensitive so the
 * cache tolerates inconsistent casing between event sources.
 */

const DEFAULT_MAX_AGE_MS = 60_000;

export interface CachedPlayerPosition {
  position: { x: number; y: number; z: number };
  recordedAt: number;
}

export class PlayerPositionCache {
  private entries: Map<string, CachedPlayerPosition> = new Map();

  /** Record a fresh observation of a player's position. */
  recordPosition(playerName: string, pos: { x: number; y: number; z: number }): void {
    if (typeof playerName !== 'string' || playerName.length === 0) return;
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number' || typeof pos.z !== 'number') {
      return;
    }
    const key = playerName.toLowerCase();
    this.entries.set(key, {
      position: { x: pos.x, y: pos.y, z: pos.z },
      recordedAt: Date.now(),
    });
  }

  /**
   * Return the cached position for the player, or null if we have never seen
   * them. Note: this method does NOT filter on staleness — callers can inspect
   * `recordedAt` themselves or use `isStale()` if they care.
   */
  getPosition(playerName: string): CachedPlayerPosition | null {
    if (typeof playerName !== 'string' || playerName.length === 0) return null;
    const key = playerName.toLowerCase();
    const entry = this.entries.get(key);
    if (!entry) return null;
    // Return a defensive copy so callers can't mutate cache state.
    return {
      position: { ...entry.position },
      recordedAt: entry.recordedAt,
    };
  }

  /**
   * Return true if we have no record for the player, or the record is older
   * than `maxAgeMs` (default 60s).
   */
  isStale(playerName: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS): boolean {
    if (typeof playerName !== 'string' || playerName.length === 0) return true;
    const key = playerName.toLowerCase();
    const entry = this.entries.get(key);
    if (!entry) return true;
    return Date.now() - entry.recordedAt > maxAgeMs;
  }

  /** Drop the cached entry for a player (e.g. on player-leave). */
  clear(playerName: string): void {
    if (typeof playerName !== 'string' || playerName.length === 0) return;
    this.entries.delete(playerName.toLowerCase());
  }
}
