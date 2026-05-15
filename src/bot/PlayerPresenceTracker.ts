import { DifficultyBalancer, PlayerProfile } from '../voyager/DifficultyBalancer';
import { logger } from '../util/logger';

interface PresenceRecord {
  name: string;
  joinedAt: number;
  deathCount: number;
}

/**
 * Tracks which players are currently online and routes join/leave/death events
 * to the DifficultyBalancer. The Java plugin POSTs to /api/events/player-* and
 * those handlers call into here.
 */
export class PlayerPresenceTracker {
  private players = new Map<string, PresenceRecord>();
  private difficultyBalancer: DifficultyBalancer;

  constructor(difficultyBalancer: DifficultyBalancer) {
    this.difficultyBalancer = difficultyBalancer;
  }

  recordJoin(playerName: string): void {
    const key = playerName.toLowerCase();
    const existing = this.players.get(key);
    if (existing) {
      // Re-join — keep the death count, refresh joinedAt.
      existing.joinedAt = Date.now();
    } else {
      this.players.set(key, { name: playerName, joinedAt: Date.now(), deathCount: 0 });
    }
    this.difficultyBalancer.updatePlayerState(this.buildProfile(this.players.get(key)!));
    logger.info({ player: playerName, online: this.players.size }, 'PlayerPresence: join');
  }

  recordLeave(playerName: string): void {
    const key = playerName.toLowerCase();
    if (!this.players.delete(key)) return;
    this.difficultyBalancer.removePlayer(playerName);
    logger.info({ player: playerName, online: this.players.size }, 'PlayerPresence: leave');
  }

  recordDeath(playerName: string): void {
    const key = playerName.toLowerCase();
    const record = this.players.get(key);
    if (!record) return;
    record.deathCount += 1;
    this.difficultyBalancer.updatePlayerState(this.buildProfile(record));
    logger.info({ player: playerName, deaths: record.deathCount }, 'PlayerPresence: death');
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  getPlayerNames(): string[] {
    return [...this.players.values()].map((p) => p.name);
  }

  private buildProfile(record: PresenceRecord): PlayerProfile {
    const playtimeMinutes = Math.max(0, Math.floor((Date.now() - record.joinedAt) / 60_000));
    return {
      name: record.name,
      hasPlayedBefore: false,
      bestToolTier: 'none',
      hasElytra: false,
      deathCount: record.deathCount,
      playtimeMinutes,
      lastSeen: Date.now(),
    };
  }
}
