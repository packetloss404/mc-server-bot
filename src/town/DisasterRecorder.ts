/**
 * DisasterRecorder — Phase 5-A of the Autonomous Town Builder.
 *
 * Thin facade over TownManager.insertDisaster() + ChronicleGenerator.generateMilestone()
 * so the Phoenix self-healing pipeline has a single seam to file an entry in
 * the disasters table, emit a Socket.IO event, and (best-effort) cue the
 * chronicler to write a milestone narrative for the catastrophe.
 *
 * "Phoenix-relevant" kinds — `raid`, `lava`, `lost_bot`, `crash` — mirror the
 * schema enum in §10 of TOWN_BUILDER_SPEC.md. Severity defaults to 'major'
 * (raids and crashes get the chronicler's attention by default); callers may
 * override with 'critical' for catastrophic events.
 *
 * Failure isolation: a wedged chronicler (rate-limited LLM, network blip)
 * must never block disaster recording. The chronicle call is fire-and-forget
 * with its own try/catch.
 */
import { logger } from '../util/logger';
import type { TownManager } from './TownManager';
import type { ChronicleGenerator } from './ChronicleGenerator';
import type { Server as SocketIOServer } from 'socket.io';
import type { Disaster as DisasterRow } from './Town';

/** Kind enum mirrors the `disasters.kind` column in §10. */
export type DisasterKind = 'raid' | 'lava' | 'lost_bot' | 'crash' | string;

export type DisasterSeverity = 'minor' | 'major' | 'critical';

/** Re-export the canonical row type so Phoenix callers keep one import line. */
export type Disaster = DisasterRow;

export interface RecordDisasterOptions {
  severity?: DisasterSeverity;
  memorialMarkerId?: string | null;
  /** Extra payload merged into the chronicle:milestone event/prompt. */
  payload?: Record<string, unknown>;
  /** Override the timestamp (mostly for tests). */
  occurredAt?: number;
  /**
   * Caller's natural-key for cross-restart dedup. When set, a disaster row
   * with the same (townId, dedupeKey) is returned unchanged instead of
   * inserting a duplicate. PhoenixManager passes `lost_bot:<residentId>`
   * for deaths so a process restart doesn't fire a fresh disaster + monument
   * for residents already memorialized.
   */
  dedupeKey?: string | null;
}

export class DisasterRecorder {
  private readonly townManager: TownManager;
  private chronicleGenerator: ChronicleGenerator | null;
  private io: SocketIOServer | null;

  constructor(
    townManager: TownManager,
    chronicleGenerator: ChronicleGenerator | null = null,
    io: SocketIOServer | null = null,
  ) {
    this.townManager = townManager;
    this.chronicleGenerator = chronicleGenerator;
    this.io = io;
  }

  /** Wired post-hoc by the API layer once the chronicler exists. */
  setChronicleGenerator(gen: ChronicleGenerator | null): void {
    this.chronicleGenerator = gen;
  }

  /** Wired post-hoc by the API layer once Socket.IO is ready. */
  setIo(io: SocketIOServer | null): void {
    this.io = io;
  }

  /**
   * Record a disaster row + emit `disaster:recorded` + (best-effort) generate
   * a chronicle milestone. Returns the canonical Disaster.
   */
  recordDisaster(
    townId: string,
    kind: DisasterKind,
    summary: string,
    opts: RecordDisasterOptions = {},
  ): Disaster {
    const severity: DisasterSeverity = opts.severity ?? 'major';
    const disaster = this.townManager.insertDisaster({
      townId,
      kind,
      severity,
      summary,
      memorialMarkerId: opts.memorialMarkerId ?? null,
      occurredAt: opts.occurredAt ?? Date.now(),
      dedupeKey: opts.dedupeKey ?? null,
    });

    // Mirror into the events table for the live dashboard feed. Chronicle:milestone
    // will fire below — we intentionally drop a separate `disaster:recorded`
    // event row too so an LLM-less deployment still surfaces the row.
    try {
      this.townManager.recordEvent({
        townId,
        kind: 'disaster:recorded',
        severity,
        payload: {
          disasterId: disaster.id,
          disasterKind: kind,
          summary,
          memorialMarkerId: disaster.memorialMarkerId,
          ...opts.payload,
        },
        highlightScore: severity === 'critical' ? 90 : severity === 'major' ? 70 : 40,
        occurredAt: opts.occurredAt,
      });
    } catch (err: any) {
      // Already logged inside recordEvent's fallback path; swallow here.
      logger.debug(
        { err: err?.message, townId, kind },
        'DisasterRecorder: event mirror failed',
      );
    }

    // Best-effort socket emit so the dashboard can react instantly.
    if (this.io) {
      try {
        this.io.emit('town:disaster', { townId, disaster });
      } catch (err: any) {
        logger.debug({ err: err?.message }, 'DisasterRecorder: io.emit failed');
      }
    }

    // Chronicle milestone — fire-and-forget. The Phoenix loop must not block
    // on the LLM round-trip.
    if (this.chronicleGenerator) {
      const payload = {
        disasterId: disaster.id,
        kind,
        summary,
        severity,
        memorialMarkerId: disaster.memorialMarkerId,
        ...(opts.payload ?? {}),
      };
      // Use a milestone-id matching the disaster kind so the chronicler's
      // prompt has a stable label.
      const milestoneKind = `disaster:${kind}`;
      this.chronicleGenerator.generateMilestone(townId, milestoneKind, payload).catch((err) => {
        logger.warn(
          { err: err?.message, townId, kind: milestoneKind },
          'DisasterRecorder: chronicle milestone failed',
        );
      });
    }

    logger.info(
      { townId, kind, severity, disasterId: disaster.id, memorialMarkerId: disaster.memorialMarkerId },
      'Disaster recorded',
    );
    return disaster;
  }
}
