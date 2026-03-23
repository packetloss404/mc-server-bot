import { describe, it, expect, beforeEach } from 'vitest';
import { SquadManager } from '../../src/control/SquadManager';

describe('SquadManager', () => {
  let sm: SquadManager;

  beforeEach(() => {
    sm = new SquadManager();
  });

  it('creates a squad', () => {
    const squad = sm.createSquad('Alpha Team');

    expect(squad).toBeDefined();
    expect(squad.id).toMatch(/^squad-/);
    expect(squad.name).toBe('Alpha Team');
    expect(squad.members).toEqual([]);
    expect(squad.createdAt).toBeTypeOf('number');
  });

  it('adds and removes bot members', () => {
    const squad = sm.createSquad('Miners');

    sm.addMember(squad.id, 'BotA');
    sm.addMember(squad.id, 'BotB');
    expect(sm.getSquad(squad.id)!.members).toEqual(['BotA', 'BotB']);

    // Adding duplicate is a no-op
    sm.addMember(squad.id, 'BotA');
    expect(sm.getSquad(squad.id)!.members).toEqual(['BotA', 'BotB']);

    sm.removeMember(squad.id, 'BotA');
    expect(sm.getSquad(squad.id)!.members).toEqual(['BotB']);
  });

  it('finds squads for a bot', () => {
    const s1 = sm.createSquad('Team 1', ['BotA', 'BotB']);
    const s2 = sm.createSquad('Team 2', ['BotB', 'BotC']);
    const s3 = sm.createSquad('Team 3', ['BotC']);

    const botBSquads = sm.getSquadsForBot('BotB');
    expect(botBSquads).toHaveLength(2);
    expect(botBSquads.map((s) => s.name).sort()).toEqual(['Team 1', 'Team 2']);

    const botASquads = sm.getSquadsForBot('BotA');
    expect(botASquads).toHaveLength(1);
    expect(botASquads[0].name).toBe('Team 1');

    const botDSquads = sm.getSquadsForBot('BotD');
    expect(botDSquads).toHaveLength(0);
  });
});
