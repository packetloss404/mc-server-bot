/**
 * Project Sid P4-A — per-bot AgentState cache.
 *
 * Verifies set/get round-trips, staleness-aware reads (the freshness budget
 * that lets VoyagerLoop fall back to inline compute), and the null-vs-unset
 * distinction for the survival-goal slot.
 */
import { describe, it, expect } from 'vitest';
import { AgentState } from '../../src/voyager/AgentState';
import type { ThreatAssessment } from '../../src/voyager/ThreatAssessor';
import type { OpportunityScan } from '../../src/voyager/OpportunityDetector';
import type { Goal } from '../../src/voyager/GoalGenerator';

function makeThreat(level = 5): ThreatAssessment {
  return { overallThreatLevel: level, threats: [], suggestedAction: 'none', timestamp: 0 };
}
function makeScan(): OpportunityScan {
  return { opportunities: [], timestamp: 0, botPosition: { x: 0, y: 0, z: 0 } };
}
function makeGoal(): Goal {
  return {
    id: 'g1', priority: 'survival', urgency: 9,
    description: 'Eat food', keywords: ['eat'], source: 'test',
  };
}

describe('AgentState', () => {
  it('starts empty (all raw getters null)', () => {
    const s = new AgentState();
    expect(s.getThreat()).toBeNull();
    expect(s.getOpportunities()).toBeNull();
    expect(s.getSurvivalGoal()).toBeNull();
  });

  it('round-trips threat / opportunities / survival goal with timestamps', () => {
    const s = new AgentState();
    const threat = makeThreat(7);
    const scan = makeScan();
    const goal = makeGoal();

    s.setThreat(threat, 1000);
    s.setOpportunities(scan, 1001);
    s.setSurvivalGoal(goal, 1002);

    expect(s.getThreat()).toEqual({ value: threat, timestamp: 1000 });
    expect(s.getOpportunities()).toEqual({ value: scan, timestamp: 1001 });
    expect(s.getSurvivalGoal()).toEqual({ value: goal, timestamp: 1002 });
  });

  it('getFreshThreat returns the value within maxAge and null when stale', () => {
    const s = new AgentState();
    const threat = makeThreat();
    s.setThreat(threat, 1000);

    // 500ms later, budget 3000 → fresh
    expect(s.getFreshThreat(3000, 1500)).toBe(threat);
    // exactly at the boundary → still fresh (<=)
    expect(s.getFreshThreat(3000, 4000)).toBe(threat);
    // 1ms past the boundary → stale
    expect(s.getFreshThreat(3000, 4001)).toBeNull();
  });

  it('getFreshOpportunities respects the freshness budget', () => {
    const s = new AgentState();
    const scan = makeScan();
    s.setOpportunities(scan, 1000);
    expect(s.getFreshOpportunities(3000, 2000)).toBe(scan);
    expect(s.getFreshOpportunities(3000, 9999)).toBeNull();
  });

  it('getFreshThreat returns null when nothing was ever written', () => {
    const s = new AgentState();
    expect(s.getFreshThreat(3000, 1000)).toBeNull();
    expect(s.getFreshOpportunities(3000, 1000)).toBeNull();
  });

  it('getFreshSurvivalGoal distinguishes "fresh null override" from "never written"', () => {
    const s = new AgentState();

    // Never written → not fresh, null value.
    expect(s.getFreshSurvivalGoal(3000, 1000)).toEqual([false, null]);

    // A null override IS a valid, fresh result (no survival goal this tick).
    s.setSurvivalGoal(null, 1000);
    expect(s.getFreshSurvivalGoal(3000, 1500)).toEqual([true, null]);

    // A real goal, fresh.
    const goal = makeGoal();
    s.setSurvivalGoal(goal, 2000);
    expect(s.getFreshSurvivalGoal(3000, 2500)).toEqual([true, goal]);

    // Stale → not fresh, null value (caller must recompute).
    expect(s.getFreshSurvivalGoal(3000, 6000)).toEqual([false, null]);
  });

  it('clear() empties every slot', () => {
    const s = new AgentState();
    s.setThreat(makeThreat(), 1);
    s.setOpportunities(makeScan(), 1);
    s.setSurvivalGoal(makeGoal(), 1);
    s.clear();
    expect(s.getThreat()).toBeNull();
    expect(s.getOpportunities()).toBeNull();
    expect(s.getSurvivalGoal()).toBeNull();
  });
});
