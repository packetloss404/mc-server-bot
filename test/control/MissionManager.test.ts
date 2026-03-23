import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before importing the module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{"missions":[],"botQueues":{}}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{"missions":[],"botQueues":{}}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { MissionManager } from '../../src/control/MissionManager';

function createMockIO() {
  return { emit: vi.fn() } as any;
}

function createMockBotManager() {
  return {
    getBot: vi.fn().mockReturnValue(null),
    getAllBots: vi.fn().mockReturnValue([]),
  } as any;
}

describe('MissionManager', () => {
  let mm: MissionManager;
  let io: ReturnType<typeof createMockIO>;
  let bm: ReturnType<typeof createMockBotManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    io = createMockIO();
    bm = createMockBotManager();
    mm = new MissionManager(bm, io);
  });

  it('creates a mission with valid fields', () => {
    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Gather wood',
      description: 'Collect 64 oak logs',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
    });

    expect(mission).toBeDefined();
    expect(mission.id).toMatch(/^msn_/);
    expect(mission.assigneeIds).toContain('TestBot');
    expect(mission.title).toBe('Gather wood');
    expect(mission.description).toBe('Collect 64 oak logs');
    expect(mission.status).toBe('queued');
    expect(mission.createdAt).toBeTypeOf('number');
    expect(mission.updatedAt).toBeTypeOf('number');
  });

  it('transitions mission through status lifecycle', () => {
    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Build house',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
    });

    expect(mission.status).toBe('queued');

    mm.updateMissionStatus(mission.id, 'running');
    expect(mm.getMission(mission.id)!.status).toBe('running');

    mm.updateMissionStatus(mission.id, 'paused');
    expect(mm.getMission(mission.id)!.status).toBe('paused');

    mm.updateMissionStatus(mission.id, 'running');
    expect(mm.getMission(mission.id)!.status).toBe('running');

    mm.updateMissionStatus(mission.id, 'completed');
    expect(mm.getMission(mission.id)!.status).toBe('completed');
  });

  it('emits socket events on status changes', () => {
    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Mine diamonds',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
    });
    mm.updateMissionStatus(mission.id, 'running');
    mm.updateMissionStatus(mission.id, 'completed');

    const events = io.emit.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('mission:created');
    expect(events).toContain('mission:updated');
    expect(events).toContain('mission:completed');
  });

  it('filters missions by bot name', () => {
    mm.createMission({ type: 'gather_items', title: 'Task A', assigneeType: 'bot', assigneeIds: ['Alpha'] });
    mm.createMission({ type: 'gather_items', title: 'Task B', assigneeType: 'bot', assigneeIds: ['Alpha'] });
    mm.createMission({ type: 'gather_items', title: 'Task C', assigneeType: 'bot', assigneeIds: ['Bravo'] });

    const alphaMissions = mm.getMissions({ bot: 'Alpha' });
    expect(alphaMissions).toHaveLength(2);
    expect(alphaMissions.every((m) => m.assigneeIds.includes('Alpha'))).toBe(true);

    const bravoMissions = mm.getMissions({ bot: 'Bravo' });
    expect(bravoMissions).toHaveLength(1);

    const allMissions = mm.getMissions();
    expect(allMissions).toHaveLength(3);
  });

  it('supports mission cancellation', () => {
    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Explore cave',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
    });
    mm.updateMissionStatus(mission.id, 'running');

    const cancelled = mm.cancelMission(mission.id);
    expect(cancelled).toBeDefined();
    expect(cancelled!.status).toBe('cancelled');
  });
});
