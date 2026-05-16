/**
 * GreetingDispatcher — Phase 6-A.
 *
 * Wakes up on each TownBrain tick (or as its own 30s timer when tests prefer
 * that). For every resident bot in the town, scans nearby players via the
 * worker's IPC `getPlayers()` and — when a player is within GREETING_RADIUS
 * blocks AND the (bot, player) cooldown is clear — pushes a `chat:say`
 * action through the bot's WorkerHandle.chat() seam.
 *
 * The dispatcher is intentionally fire-and-forget per tick: missed greetings
 * (network blip, paused brain, dead bot) just retry next tick.
 *
 * Cooldown bookkeeping lives in MayorService. We mark the cooldown stamp
 * **before** the chat IPC because the worst case is missing a single
 * greeting; the failure mode of NOT stamping is spamming the player every
 * 30s for as long as they stand in town. The mistake is cheaper than the
 * spam, and the chat IPC is itself non-blocking.
 */
import type { BotManager } from '../bot/BotManager';
import type { TownManager } from './TownManager';
import type { MayorService } from './MayorService';
import type { Resident } from './Town';
import type { WorkerHandle } from '../worker/WorkerHandle';
import { logger } from '../util/logger';

/** Greeting fires when the player is within this many blocks of a resident. */
export const GREETING_RADIUS = 16;
const GREETING_RADIUS_SQ = GREETING_RADIUS * GREETING_RADIUS;

export class GreetingDispatcher {
  private readonly townManager: TownManager;
  private readonly botManager: BotManager;
  private readonly mayorService: MayorService;

  constructor(townManager: TownManager, botManager: BotManager, mayorService: MayorService) {
    this.townManager = townManager;
    this.botManager = botManager;
    this.mayorService = mayorService;
  }

  /**
   * Dispatch one round of greetings for the given town. Safe to call from
   * the brain's tick loop — the brain's runLoopSafe wrapper handles any
   * thrown errors so a misbehaving worker IPC can't crash the tick.
   *
   * The brain itself is responsible for the `paused` short-circuit (it
   * skips every loop while paused). We still check the mayor lookup here
   * so a town with no mayor set is a fast no-op.
   */
  async tick(townId: string): Promise<void> {
    const mayor = this.mayorService.getMayor(townId);
    if (!mayor) return; // no mayor set — nothing to greet

    const residents = this.townManager.listResidents(townId)
      .filter((r) => r.status === 'alive' || r.status == null);
    if (residents.length === 0) return;

    for (const resident of residents) {
      try {
        await this.greetForResident(townId, resident);
      } catch (err: any) {
        // One bad bot mustn't break the whole town's greeting pass.
        logger.debug(
          { err: err?.message, townId, botName: resident.botName },
          'GreetingDispatcher: per-resident pass failed (continuing)',
        );
      }
    }
  }

  /**
   * Check one resident bot: pull nearby players via getPlayers(), find the
   * closest within radius that's also past the cooldown, and queue the chat.
   */
  private async greetForResident(townId: string, resident: Resident): Promise<void> {
    const worker = this.botManager.getWorker(resident.botName);
    if (!worker) return; // bot offline / not yet spawned

    // Bot's own world-space position — we compare distance against this.
    const status = worker.getCachedStatus?.();
    const botPos = status?.position;
    if (!botPos || typeof botPos.x !== 'number') return;

    // IPC: read the live player list off the worker. Returns [] when the
    // bot isn't connected yet; the dispatcher will retry next tick.
    const players = await worker.getPlayers();
    if (!players || players.length === 0) return;

    for (const player of players) {
      if (!player?.name || !player?.position) continue;
      const dx = player.position.x - botPos.x;
      const dy = player.position.y - botPos.y;
      const dz = player.position.z - botPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > GREETING_RADIUS_SQ) continue;

      // Cooldown gate — only the (this bot, this player) pair within the
      // last GREETING_COOLDOWN_MS gets skipped; other residents may still
      // greet the same player independently (which is the desired feel
      // for a town: every resident says hi the first time).
      if (!this.mayorService.canGreet(townId, resident.botName, player.name)) continue;

      const greeting = this.mayorService.formatGreeting(townId, worker.personality);
      if (!greeting) return; // mayor info disappeared mid-tick

      // Stamp the cooldown FIRST so a slow chat IPC can't double-fire on
      // the next tick if we re-enter before the chat resolves.
      this.mayorService.markGreeted(townId, resident.botName, player.name);

      this.queueChat(worker, greeting);
      logger.info(
        { townId, botName: resident.botName, playerName: player.name },
        'GreetingDispatcher: greeted',
      );
      // One greeting per bot per tick — keep the chat noise low even when
      // multiple players cluster around one bot.
      return;
    }
  }

  /**
   * Fire the chat through the bot's existing IPC seam. Wrapped in try/catch
   * because the worker may have crashed between getPlayers() and chat().
   */
  private queueChat(worker: WorkerHandle, message: string): void {
    try {
      worker.chat(message);
    } catch (err: any) {
      logger.debug(
        { err: err?.message, botName: worker.botName },
        'GreetingDispatcher: chat IPC failed',
      );
    }
  }
}
