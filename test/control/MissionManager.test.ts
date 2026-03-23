import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MissionManager } from '../../src/control/MissionManager';

function createMockIO() {
  return { emit: vi.fn() } as any;
}

describe('MissionManager', () => {
  let mm: MissionManager;
  let io: ReturnType<typeof createMockIO>;

  beforeEach(() => {
    io = createMockIO();
    mm = new MissionManager(io);
  });

  it('creates a mission with valid fields', () => {
    const mission = mm.createMission('TestBot', 'Gather wood', 'Collect 64 oak logs');

    expect(mission).toBeDefined();
    expect(mission.id).toMatch(/^mission-/);
    expect(mission.botName).toBe('TestBot');
    expect(mission.name).toBe('Gather wood');
    expect(mission.description).toBe('Collect 64 oak logs');
    expect(mission.status).toBe('pending');
    expect(mission.createdAt).toBeTypeOf('number');
    expect(mission.updatedAt).toBeTypeOf('number');
  });

  it('transitions mission through status lifecycle', () => {
    const mission = mm.createMission('TestBot', 'Build house');

    expect(mission.status).toBe('pending');

    mm.setStatus(mission.id, 'active');
    expect(mm.getMission(mission.id)!.status).toBe('active');

    mm.setStatus(mission.id, 'paused');
    expect(mm.getMission(mission.id)!.status).toBe('paused');

    mm.setStatus(mission.id, 'active');
    expect(mm.getMission(mission.id)!.status).toBe('active');

    mm.setStatus(mission.id, 'completed');
    expect(mm.getMission(mission.id)!.status).toBe('completed');
  });

  it('emits socket events on status changes', () => {
    const mission = mm.createMission('TestBot', 'Mine diamonds');
    mm.setStatus(mission.id, 'active');
    mm.setStatus(mission.id, 'completed');

    const events = io.emit.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('mission:created');
    expect(events).toContain('mission:active');
    expect(events).toContain('mission:completed');
  });

  it('filters missions by bot name', () => {
    mm.createMission('Alpha', 'Task A');
    mm.createMission('Alpha', 'Task B');
    mm.createMission('Bravo', 'Task C');

    const alphaMissions = mm.getMissions('Alpha');
    expect(alphaMissions).toHaveLength(2);
    expect(alphaMissions.every((m) => m.botName === 'Alpha')).toBe(true);

    const bravoMissions = mm.getMissions('Bravo');
    expect(bravoMissions).toHaveLength(1);

    const allMissions = mm.getMissions();
    expect(allMissions).toHaveLength(3);
  });

  it('supports mission cancellation', () => {
    const mission = mm.createMission('TestBot', 'Explore cave');
    mm.setStatus(mission.id, 'active');

    const cancelled = mm.cancel(mission.id);
    expect(cancelled.status).toBe('cancelled');
  });
});
