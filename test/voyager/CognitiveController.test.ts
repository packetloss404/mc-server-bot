/**
 * Project Sid P4-B — Cognitive Controller pure decision function.
 *
 * Asserts that `decide()` re-encodes the EXACT priority order of
 * VoyagerLoop.runOneCycle's imperative ladder:
 *
 *   instinct > build_goal > survival/safety override > player_intent >
 *   long_term_goal > player_task > blackboard > resident_idle > curriculum
 *
 * Each test fills lower-priority slots too, then asserts the higher-priority
 * one still wins — so we're testing precedence, not just presence. The
 * `conditioningForTalk` string is asserted to be non-empty so the talk-broadcast
 * always has something to condition on.
 */
import { describe, it, expect } from 'vitest';
import { decide, CognitiveContext } from '../../src/voyager/CognitiveController';
import type { Goal } from '../../src/voyager/GoalGenerator';

/** A context with every slot empty (would resolve to curriculum). */
function emptyCtx(): CognitiveContext {
  return {
    instinctPaused: false,
    buildGoalActive: false,
    survivalGoal: null,
    playerIntent: null,
    longTermGoalTask: null,
    playerTask: null,
    blackboardTask: null,
    isResident: false,
  };
}

/** A context with EVERY slot filled, to test pure precedence. */
function fullCtx(): CognitiveContext {
  return {
    instinctPaused: true,
    instinctReason: 'attack',
    buildGoalActive: true,
    buildGoalDescription: 'build a house',
    survivalGoal: survivalGoal(),
    playerIntent: { player: 'Steve', intent: 'mining', confidence: 0.9, suggestedTask: 'help mine' },
    longTermGoalTask: 'gather iron',
    playerTask: 'fetch wood',
    blackboardTask: 'patrol the wall',
    isResident: true,
  };
}

function survivalGoal(urgency = 9): Goal {
  return { id: 's1', priority: 'survival', urgency, description: 'eat food', keywords: ['eat'], source: 'test' };
}

describe('CognitiveController.decide — priority order matches the ladder', () => {
  it('1. instinct beats everything', () => {
    const d = decide(fullCtx());
    expect(d.action.kind).toBe('instinct');
    expect(d.conditioningForTalk).toBeTruthy();
  });

  it('2. build_goal beats override/intent/goal/player/blackboard/resident', () => {
    const ctx = fullCtx();
    ctx.instinctPaused = false;
    const d = decide(ctx);
    expect(d.action.kind).toBe('build_goal');
    expect(d.action.task).toBe('build a house');
  });

  it('3. survival/safety override beats player_intent and all work', () => {
    const ctx = fullCtx();
    ctx.instinctPaused = false;
    ctx.buildGoalActive = false;
    const d = decide(ctx);
    expect(d.action.kind).toBe('goal_override');
    expect(d.action.task).toBe('eat food');
    expect(d.reason).toContain('survival');
  });

  it('3b. an override below urgency 7 does NOT pre-empt (falls through to next)', () => {
    const ctx = emptyCtx();
    ctx.survivalGoal = survivalGoal(6); // below the >= 7 gate
    ctx.playerTask = 'fetch wood';
    const d = decide(ctx);
    expect(d.action.kind).toBe('player_task');
  });

  it('4. player_intent beats long_term_goal/player_task/blackboard', () => {
    const ctx = fullCtx();
    ctx.instinctPaused = false;
    ctx.buildGoalActive = false;
    ctx.survivalGoal = null;
    const d = decide(ctx);
    expect(d.action.kind).toBe('player_intent');
    expect(d.action.task).toBe('help mine');
    expect(d.reason).toContain('PlayerIntent');
  });

  it('5. long_term_goal beats player_task and blackboard', () => {
    const ctx = emptyCtx();
    ctx.longTermGoalTask = 'gather iron';
    ctx.playerTask = 'fetch wood';
    ctx.blackboardTask = 'patrol the wall';
    const d = decide(ctx);
    expect(d.action.kind).toBe('long_term_goal');
    expect(d.action.task).toBe('gather iron');
  });

  it('6. player_task beats blackboard', () => {
    const ctx = emptyCtx();
    ctx.playerTask = 'fetch wood';
    ctx.blackboardTask = 'patrol the wall';
    const d = decide(ctx);
    expect(d.action.kind).toBe('player_task');
    expect(d.action.task).toBe('fetch wood');
  });

  it('7. blackboard beats resident_idle and curriculum', () => {
    const ctx = emptyCtx();
    ctx.blackboardTask = 'patrol the wall';
    ctx.isResident = true;
    const d = decide(ctx);
    expect(d.action.kind).toBe('blackboard');
    expect(d.action.task).toBe('patrol the wall');
  });

  it('8. resident with no higher-priority work idles (does NOT run curriculum)', () => {
    const ctx = emptyCtx();
    ctx.isResident = true;
    const d = decide(ctx);
    expect(d.action.kind).toBe('resident_idle');
    expect(d.action.task).toBeNull();
  });

  it('9. non-resident with nothing else falls back to curriculum', () => {
    const d = decide(emptyCtx());
    expect(d.action.kind).toBe('curriculum');
  });

  it('every decision carries a non-empty conditioningForTalk', () => {
    const contexts: CognitiveContext[] = [
      fullCtx(),
      { ...emptyCtx(), buildGoalActive: true },
      { ...emptyCtx(), survivalGoal: survivalGoal() },
      { ...emptyCtx(), playerIntent: { player: 'A', intent: 'i', confidence: 0.8, suggestedTask: 't' } },
      { ...emptyCtx(), longTermGoalTask: 'lg' },
      { ...emptyCtx(), playerTask: 'pt' },
      { ...emptyCtx(), blackboardTask: 'bb' },
      { ...emptyCtx(), isResident: true },
      emptyCtx(),
    ];
    for (const ctx of contexts) {
      const d = decide(ctx);
      expect(d.conditioningForTalk.length).toBeGreaterThan(0);
      expect(d.reason.length).toBeGreaterThan(0);
    }
  });
});
