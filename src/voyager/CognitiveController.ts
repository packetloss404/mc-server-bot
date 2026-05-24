import type { Goal } from './GoalGenerator';
import type { ThreatAssessment } from './ThreatAssessor';
import type { OpportunityScan } from './OpportunityDetector';

/**
 * Project Sid P4-B — Cognitive Controller + decision broadcast.
 *
 * The PIANO "cognitive controller" is the single bottleneck through which all
 * of the bot's fast-perception + slow-planning signals are funneled into ONE
 * structured decision per cycle. Today that selection lives as an imperative
 * priority ladder inline in `VoyagerLoop.runOneCycle` (instinct > build-goal >
 * survival/safety override > player-intent > long-term-goal > player-task >
 * blackboard > resident-idle > curriculum). `decide()` re-encodes that EXACT
 * order as a pure, testable function.
 *
 * The point of P4-B is NOT to change which action is chosen — with
 * `config.cognition.cognitiveController` ON the chosen `action.kind` is
 * identical to what the ladder would pick. The added value is twofold:
 *   1. a STRUCTURED `Decision` (kind + reason) the loop and dashboard can read;
 *   2. a `conditioningForTalk` string that BOTH `handleChat` and the
 *      `ProactiveCommunicator` are conditioned on, so the bot can't say one
 *      thing in chat while doing another (Sid's "talk coheres with action").
 *
 * With the flag OFF this module is never invoked; the loop runs its existing
 * inline ladder unchanged and talk uses `getInternalState()` exactly as today.
 */

/** The kinds of action the controller can select, in strict priority order. */
export type DecisionActionKind =
  /** Instinct (damage/hazard) has paused the loop — react, do nothing else. */
  | 'instinct'
  /** An active long-term build_structure goal owns this cycle. */
  | 'build_goal'
  /** A survival/safety GoalGenerator override (urgency >= 7) pre-empts work. */
  | 'goal_override'
  /** A confident nearby-player-intent suggestion to assist. */
  | 'player_intent'
  /** An active (non-build) long-term goal subtask. */
  | 'long_term_goal'
  /** A player-queued task. */
  | 'player_task'
  /** A claimed blackboard / swarm task. */
  | 'blackboard'
  /** Town resident with nothing higher-priority — idle this tick. */
  | 'resident_idle'
  /** Autonomous curriculum-proposed task (the catch-all fallback). */
  | 'curriculum';

/** The structured action the controller selected. */
export interface DecisionAction {
  kind: DecisionActionKind;
  /** Human/LLM-readable description of what the bot is about to do, if any.
   *  Null for kinds that don't carry a task description (instinct/build/idle). */
  task: string | null;
}

/** One cognitive decision: what to do, why, and how speech should be framed. */
export interface Decision {
  action: DecisionAction;
  /** Short rationale (mirrors the DecisionTrace reason strings). */
  reason: string;
  /**
   * The single string fed to the talk modules so chat + proactive speech are
   * conditioned on the SAME current decision. Reads like the bot's present
   * intent ("Currently working on: X" / "Reacting to a threat" / "Idle …").
   */
  conditioningForTalk: string;
}

/**
 * The BOTTLENECKED view the controller decides from. Each field mirrors a
 * signal the inline ladder consults, reduced to exactly what the priority
 * decision needs (a controller bottleneck, not the full world state).
 */
export interface CognitiveContext {
  /** True when instinct has paused the loop (the loop's `this.paused`). */
  instinctPaused: boolean;
  /** Optional reason instinct paused (attack/hazard), for talk conditioning. */
  instinctReason?: string | null;

  /** An active long-term build_structure goal owns the cycle when set. */
  buildGoalActive: boolean;
  /** Description of the active build goal, for talk conditioning. */
  buildGoalDescription?: string | null;

  /** The survival/safety override goal the ladder pins (urgency >= 7), or null. */
  survivalGoal: Goal | null;

  /** A confident player-intent suggestion to adopt, or null. */
  playerIntent: { player: string; intent: string; confidence: number; suggestedTask: string } | null;

  /** Active (non-build) long-term goal subtask description, or null. */
  longTermGoalTask: string | null;

  /** Next player-queued task description, or null. */
  playerTask: string | null;

  /** Claimed blackboard task description, or null. */
  blackboardTask: string | null;

  /** True when the bot is a non-idle town resident (gates the idle fallback). */
  isResident: boolean;

  /** Latest threat assessment (for talk conditioning only — never reorders). */
  topThreat?: ThreatAssessment | null;
  /** Latest opportunity scan (for talk conditioning only — never reorders). */
  topOpportunity?: OpportunityScan | null;
}

/**
 * Pure decision function. Encodes the EXACT priority order of
 * `VoyagerLoop.runOneCycle`'s imperative ladder so the selected action.kind is
 * identical to what the ladder picks for the same inputs. No side effects, no
 * I/O — fully unit-testable.
 *
 * Priority (highest first), matching the loop verbatim:
 *   1. instinct (loop paused)                       — runOneCycle returns early
 *   2. build_goal (active build_structure goal)     — runBuildGoalCycle
 *   3. goal_override (survival/safety urgency >= 7)  — beats player-intent + work
 *   4. player_intent (confident nearby suggestion)   — only when no goal_override
 *   5. long_term_goal (non-build goalTask)
 *   6. player_task (playerTaskQueue head)
 *   7. blackboard (claimed swarm task)
 *   8. resident_idle (resident with nothing higher)  — idle instead of curriculum
 *   9. curriculum (autonomous fallback)
 *
 * NOTE on gating that the loop applies BEFORE building this context: the loop
 * only pins a survival override / player-intent when `playerTaskQueue` is
 * empty. The caller reflects that by passing `survivalGoal`/`playerIntent` as
 * null when a player task is queued, so this function never needs to know the
 * queue length — it just honors the same precedence.
 */
export function decide(ctx: CognitiveContext): Decision {
  // 1. Instinct — immediate reaction has paused the loop; nothing else runs.
  if (ctx.instinctPaused) {
    const why = ctx.instinctReason ? `instinct: ${ctx.instinctReason}` : 'instinct reaction';
    return {
      action: { kind: 'instinct', task: null },
      reason: why,
      conditioningForTalk: `Reacting to immediate danger (${ctx.instinctReason || 'threat'}); pausing other work.`,
    };
  }

  // 2. Active build_structure long-term goal owns the cycle.
  if (ctx.buildGoalActive) {
    const desc = ctx.buildGoalDescription || 'a structure';
    return {
      action: { kind: 'build_goal', task: ctx.buildGoalDescription ?? null },
      reason: 'active build_structure goal',
      conditioningForTalk: `Currently building: ${desc}.`,
    };
  }

  // 3. Survival/safety GoalGenerator override (urgency >= 7) pre-empts work.
  if (ctx.survivalGoal && (ctx.survivalGoal.priority === 'survival' || ctx.survivalGoal.priority === 'safety') && ctx.survivalGoal.urgency >= 7) {
    return {
      action: { kind: 'goal_override', task: ctx.survivalGoal.description },
      reason: `GoalGenerator: ${ctx.survivalGoal.priority} override (urgency ${ctx.survivalGoal.urgency})`,
      conditioningForTalk: `Prioritizing ${ctx.survivalGoal.priority}: ${ctx.survivalGoal.description}.`,
    };
  }

  // 4. Confident nearby-player-intent suggestion (only when no survival override).
  if (ctx.playerIntent) {
    const pi = ctx.playerIntent;
    return {
      action: { kind: 'player_intent', task: pi.suggestedTask },
      reason: `PlayerIntent: ${pi.intent} (confidence ${pi.confidence.toFixed(2)}) for ${pi.player}`,
      conditioningForTalk: `Helping ${pi.player} (${pi.intent}): ${pi.suggestedTask}.`,
    };
  }

  // 5. Active (non-build) long-term goal subtask.
  if (ctx.longTermGoalTask) {
    return {
      action: { kind: 'long_term_goal', task: ctx.longTermGoalTask },
      reason: 'long-term-goal subtask',
      // Keep the source tag in `reason` (for traces), not in the spoken line.
      conditioningForTalk: `Currently working on: ${ctx.longTermGoalTask}.`,
    };
  }

  // 6. Player-queued task.
  if (ctx.playerTask) {
    return {
      action: { kind: 'player_task', task: ctx.playerTask },
      reason: 'player-requested task',
      conditioningForTalk: `Currently working on: ${ctx.playerTask}.`,
    };
  }

  // 7. Claimed blackboard / swarm task.
  if (ctx.blackboardTask) {
    return {
      action: { kind: 'blackboard', task: ctx.blackboardTask },
      reason: 'claimed blackboard task',
      conditioningForTalk: `Currently working on: ${ctx.blackboardTask}.`,
    };
  }

  // 8. Town resident with nothing higher-priority — idle rather than wander off
  //    on an exploratory curriculum quest.
  if (ctx.isResident) {
    return {
      action: { kind: 'resident_idle', task: null },
      reason: 'resident has no swarm/player task; idling (skipping curriculum)',
      conditioningForTalk: 'Idle, waiting for town work.',
    };
  }

  // 9. Autonomous curriculum-proposed task (the catch-all).
  return {
    action: { kind: 'curriculum', task: null },
    reason: 'curriculum (autonomous) task',
    conditioningForTalk: 'Looking for something useful to do next.',
  };
}
