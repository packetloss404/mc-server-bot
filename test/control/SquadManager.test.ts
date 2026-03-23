import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before importing the module
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { SquadManager } from '../../src/control/SquadManager';

function createMockIO() {
  return { emit: vi.fn() } as any;
}

describe('SquadManager', () => {
  let sm: SquadManager;
  let io: ReturnType<typeof createMockIO>;

  beforeEach(() => {
    vi.clearAllMocks();
    io = createMockIO();
    sm = new SquadManager(io);
  });

  it('creates a squad', () => {
    const squad = sm.createSquad({ name: 'Alpha Team', botNames: [] });

    expect(squad).toBeDefined();
    expect(squad.id).toMatch(/^sqd_/);
    expect(squad.name).toBe('Alpha Team');
    expect(squad.botNames).toEqual([]);
    expect(squad.createdAt).toBeTypeOf('number');
  });

  it('adds and removes bot members', () => {
    const squad = sm.createSquad({ name: 'Miners', botNames: [] });

    sm.addBotToSquad(squad.id, 'BotA');
    sm.addBotToSquad(squad.id, 'BotB');
    expect(sm.getSquad(squad.id)!.botNames).toEqual(['BotA', 'BotB']);

    // Adding duplicate is a no-op
    sm.addBotToSquad(squad.id, 'BotA');
    expect(sm.getSquad(squad.id)!.botNames).toEqual(['BotA', 'BotB']);

    sm.removeBotFromSquad(squad.id, 'BotA');
    expect(sm.getSquad(squad.id)!.botNames).toEqual(['BotB']);
  });

  it('finds squads for a bot', () => {
    const s1 = sm.createSquad({ name: 'Team 1', botNames: ['BotA', 'BotB'] });
    const s2 = sm.createSquad({ name: 'Team 2', botNames: ['BotB', 'BotC'] });
    const s3 = sm.createSquad({ name: 'Team 3', botNames: ['BotC'] });

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
