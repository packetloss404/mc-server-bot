/**
 * ChronicleScheduler — Phase 4-B of the Autonomous Town Builder.
 *
 * Wraps the ChronicleGenerator in a periodic timer that fires once per
 * Minecraft day (≈20 real minutes) per active town. Idempotent — the
 * generator itself checks for an existing daily entry before calling the
 * LLM, so the scheduler can tick frequently without re-billing.
 *
 * Failure isolation: a thrown generator call must NOT crash the scheduler.
 * The scheduler's tick is wrapped, errors are logged, and the next tick
 * picks back up. Paused / abandoned towns are skipped entirely.
 *
 * Followup #46 — tick aligned to the 20-minute Minecraft-day cadence (was
 * 5 minutes). The generator's idempotency check still protects against
 * accidental re-billing if the interval is overridden in tests, but the
 * default cadence now produces exactly one DB read per town per day
 * instead of four.
 */
import { logger } from '../util/logger';
import type { TownManager } from './TownManager';
import type { ChronicleGenerator } from './ChronicleGenerator';

/**
 * Fire the scheduler every 20 real minutes — matches the Minecraft-day
 * rollover cadence used by TownManager.getChronicleDayNumber, so each
 * scheduler tick lines up with at most one new daily entry per town and
 * we avoid 3 wasted DB reads per town per day (followup #46).
 */
const DEFAULT_TICK_INTERVAL_MS = 20 * 60 * 1000;

export interface ChronicleSchedulerOptions {
  /** Override the tick cadence (mostly for tests). Default 20 minutes. */
  intervalMs?: number;
  /** When true, skip the initial tick on start() (tests). */
  skipInitialTick?: boolean;
}

export class ChronicleScheduler {
  private readonly townManager: TownManager;
  private readonly generator: ChronicleGenerator;
  private readonly intervalMs: number;
  private readonly skipInitialTick: boolean;
  private timer: NodeJS.Timeout | null = null;
  private tickInFlight = false;
  private tickCount = 0;
  private lastTickAt: number | null = null;

  constructor(
    townManager: TownManager,
    generator: ChronicleGenerator,
    opts: ChronicleSchedulerOptions = {},
  ) {
    this.townManager = townManager;
    this.generator = generator;
    this.intervalMs = opts.intervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.skipInitialTick = opts.skipInitialTick === true;
  }

  /**
   * Begin periodic ticking. Idempotent — a second call is a no-op. Runs an
   * initial tick on the next event-loop turn so freshly-founded towns get
   * their Day 1 entry without waiting the full interval.
   */
  start(): void {
    if (this.timer) return;
    logger.info({ intervalMs: this.intervalMs }, 'ChronicleScheduler start');
    this.timer = setInterval(() => {
      void this.runTick();
    }, this.intervalMs);
    // Don't hold the event loop open at shutdown.
    if (typeof this.timer.unref === 'function') this.timer.unref();
    if (!this.skipInitialTick) {
      // Defer the initial tick — caller may still be wiring deps.
      setImmediate(() => {
        void this.runTick();
      });
    }
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info('ChronicleScheduler stop');
  }

  /** Public for tests — drives one cycle without waiting for the interval. */
  async runTick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      await this.tick();
    } catch (err: any) {
      // Defensive: tick already wraps each town, but a top-level throw must
      // never crash the scheduler. Logged + swallowed.
      logger.warn({ err: err?.message }, 'ChronicleScheduler.tick threw');
    } finally {
      this.tickInFlight = false;
      this.lastTickAt = Date.now();
      this.tickCount++;
    }
  }

  private async tick(): Promise<void> {
    const towns = this.townManager.listTowns().filter((t) => t.status === 'active');
    for (const town of towns) {
      if (this.townManager.isTownPaused(town.id)) {
        logger.debug({ townId: town.id }, 'ChronicleScheduler: town paused, skipping');
        continue;
      }
      try {
        const dayNumber = this.townManager.getChronicleDayNumber(town.id);
        if (dayNumber == null) continue;
        await this.generator.generateDaily(town.id, dayNumber);
      } catch (err: any) {
        // Failure isolated to one town — keep going.
        logger.warn(
          { err: err?.message, townId: town.id },
          'ChronicleScheduler: generateDaily threw for town',
        );
      }
    }
  }

  getStatus(): { running: boolean; ticks: number; lastTickAt: number | null; intervalMs: number } {
    return {
      running: this.timer !== null,
      ticks: this.tickCount,
      lastTickAt: this.lastTickAt,
      intervalMs: this.intervalMs,
    };
  }
}
