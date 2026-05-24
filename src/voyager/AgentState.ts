import type { ThreatAssessment } from './ThreatAssessor';
import type { OpportunityScan } from './OpportunityDetector';
import type { Goal } from './GoalGenerator';

/**
 * Project Sid P4-A — per-bot shared cognitive state ("AgentState").
 *
 * A tiny, dependency-free holder owned by VoyagerLoop. When the always-on
 * perception tick (`config.cognition.perceptionTick`) is enabled, the
 * BotInstance perception timer runs the synchronous assessors
 * (ThreatAssessor / OpportunityDetector / survival-GoalGenerator) on its OWN
 * short interval and writes the results here; `runOneCycle` then READS the
 * cached values instead of computing them inline. This decouples fast
 * perception from the slow, sequential planning loop (which is blocked during
 * task execution).
 *
 * Each slot carries the wall-clock timestamp it was written, so a reader can
 * fall back to inline compute when the cache is empty or stale (older than a
 * freshness budget). Nothing in here is required when the flag is OFF — the
 * timer is never started, the cache stays empty, and runOneCycle's inline path
 * is byte-for-byte unchanged.
 *
 * This substrate is intentionally minimal; P4-B's CognitiveController and the
 * P2/P3 prompt-injection work reuse the same holder.
 */

/** A cached value plus the epoch-ms timestamp it was produced. */
export interface Timestamped<T> {
  value: T;
  /** Date.now() at the moment the value was written. */
  timestamp: number;
}

export class AgentState {
  /** Latest full threat assessment from ThreatAssessor.assess(). */
  private threat: Timestamped<ThreatAssessment> | null = null;
  /** Latest full opportunity scan from OpportunityDetector.scan(). */
  private opportunities: Timestamped<OpportunityScan> | null = null;
  /**
   * Latest survival/safety goal override candidate — the single top goal the
   * perception tick selected (priority survival|safety, urgency >= 7), or null
   * when no such override applies. Mirrors what runOneCycle pins inline.
   */
  private survivalGoal: Timestamped<Goal | null> | null = null;

  // --------------------------------------------------------------------------
  // Setters — called by the perception tick.
  // --------------------------------------------------------------------------

  setThreat(value: ThreatAssessment, now: number = Date.now()): void {
    this.threat = { value, timestamp: now };
  }

  setOpportunities(value: OpportunityScan, now: number = Date.now()): void {
    this.opportunities = { value, timestamp: now };
  }

  /** `null` value is a valid result (no current survival override). */
  setSurvivalGoal(value: Goal | null, now: number = Date.now()): void {
    this.survivalGoal = { value, timestamp: now };
  }

  // --------------------------------------------------------------------------
  // Raw getters — return the timestamped slot (or null if never written).
  // --------------------------------------------------------------------------

  getThreat(): Timestamped<ThreatAssessment> | null {
    return this.threat;
  }

  getOpportunities(): Timestamped<OpportunityScan> | null {
    return this.opportunities;
  }

  getSurvivalGoal(): Timestamped<Goal | null> | null {
    return this.survivalGoal;
  }

  // --------------------------------------------------------------------------
  // Freshness-aware getters — return the cached value only when it exists and
  // is no older than `maxAgeMs`; otherwise null so the caller computes inline.
  // --------------------------------------------------------------------------

  getFreshThreat(maxAgeMs: number, now: number = Date.now()): ThreatAssessment | null {
    return this.threat && now - this.threat.timestamp <= maxAgeMs ? this.threat.value : null;
  }

  getFreshOpportunities(maxAgeMs: number, now: number = Date.now()): OpportunityScan | null {
    return this.opportunities && now - this.opportunities.timestamp <= maxAgeMs
      ? this.opportunities.value
      : null;
  }

  /**
   * Returns a tuple `[fresh, value]`: `fresh` is true only when a survival-goal
   * slot was written within `maxAgeMs`. The cached `value` may legitimately be
   * `null` (no override), which is indistinguishable from "never written"
   * unless the freshness flag is consulted — hence the tuple.
   */
  getFreshSurvivalGoal(maxAgeMs: number, now: number = Date.now()): [boolean, Goal | null] {
    if (this.survivalGoal && now - this.survivalGoal.timestamp <= maxAgeMs) {
      return [true, this.survivalGoal.value];
    }
    return [false, null];
  }

  /** Drop all cached values (e.g. on teardown). */
  clear(): void {
    this.threat = null;
    this.opportunities = null;
    this.survivalGoal = null;
  }
}
