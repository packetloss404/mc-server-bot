import { describe, it, expect } from 'vitest';
import { parseBuildIntent } from '../../src/control/BuildIntentResolver';

describe('parseBuildIntent', () => {
  it('parses "build a small house here" as player_position + surface', () => {
    const intent = parseBuildIntent('build a small house here');
    expect(intent).not.toBeNull();
    expect(intent!.anchor).toBe('player_position');
    expect(intent!.mode).toBe('surface');
    expect(intent!.query.toLowerCase()).toContain('small house');
    expect(intent!.offset).toEqual({ x: 0, z: 0 });
    expect(intent!.confidence).toBeGreaterThan(0.5);
  });

  it('parses "build a bunker here" with underground mode', () => {
    const intent = parseBuildIntent('build a bunker here');
    expect(intent).not.toBeNull();
    expect(intent!.mode).toBe('underground');
    expect(intent!.anchor).toBe('player_position');
  });

  it('parses direction offset "construct a wall 10 blocks north"', () => {
    const intent = parseBuildIntent('construct a wall 10 blocks north');
    expect(intent).not.toBeNull();
    expect(intent!.offset).toEqual({ x: 0, z: -10 });
    expect(intent!.query.toLowerCase()).toContain('wall');
  });

  it('parses marker anchor "make a tower at the gate"', () => {
    const intent = parseBuildIntent('make a tower at the gate');
    expect(intent).not.toBeNull();
    expect(intent!.anchor).toBe('marker');
    expect(intent!.markerName).toBe('gate');
    expect(intent!.query.toLowerCase()).toContain('tower');
  });

  it('parses absolute coords "place a chest at 100 64 200"', () => {
    const intent = parseBuildIntent('place a chest at 100 64 200');
    expect(intent).not.toBeNull();
    expect(intent!.anchor).toBe('absolute');
    expect(intent!.absolute).toEqual({ x: 100, y: 64, z: 200 });
    expect(intent!.query.toLowerCase()).toContain('chest');
  });

  it('returns null for "hello there" (no build verb)', () => {
    expect(parseBuildIntent('hello there')).toBeNull();
  });

  it('returns intent but low confidence for bare "build"', () => {
    const intent = parseBuildIntent('build');
    expect(intent).not.toBeNull();
    expect(intent!.confidence).toBeLessThan(0.55);
  });

  it('detects underground mode from message body, not anchor', () => {
    const intent = parseBuildIntent('build a vault underground');
    expect(intent).not.toBeNull();
    expect(intent!.mode).toBe('underground');
    // No explicit "here"/"at <marker>"/"at <x y z>" — defaults to player_position.
    expect(intent!.anchor).toBe('player_position');
  });

  it('parses south direction as +z offset', () => {
    const intent = parseBuildIntent('build a wall 5 blocks south');
    expect(intent).not.toBeNull();
    expect(intent!.offset).toEqual({ x: 0, z: 5 });
  });

  it('parses east/west as +x/-x', () => {
    const east = parseBuildIntent('build a road 7 blocks east');
    expect(east!.offset).toEqual({ x: 7, z: 0 });
    const west = parseBuildIntent('build a road 3 blocks west');
    expect(west!.offset).toEqual({ x: -3, z: 0 });
  });

  it('produces a small offset for "near me"', () => {
    const intent = parseBuildIntent('build a shack near me');
    expect(intent).not.toBeNull();
    expect(intent!.anchor).toBe('player_position');
    // Random 4..8 magnitude, possibly negative — assert ranges.
    expect(Math.abs(intent!.offset.x)).toBeGreaterThanOrEqual(4);
    expect(Math.abs(intent!.offset.x)).toBeLessThanOrEqual(8);
    expect(Math.abs(intent!.offset.z)).toBeGreaterThanOrEqual(4);
    expect(Math.abs(intent!.offset.z)).toBeLessThanOrEqual(8);
  });
});
