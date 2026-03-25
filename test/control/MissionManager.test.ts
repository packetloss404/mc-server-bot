import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
import { SquadManager } from '../../src/control/SquadManager';

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
  let squadManager: SquadManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    io = createMockIO();
    bm = createMockBotManager();
    mm = new MissionManager(bm, io);
    squadManager = new SquadManager(io as any);
    mm.setSquadManager(squadManager);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('includes squad missions when filtering by bot name', () => {
    const squad = squadManager.createSquad({ name: 'Builders', botNames: ['Alpha', 'Bravo'] });

    const squadMission = mm.createMission({
      type: 'build_schematic',
      title: 'Build watchtower',
      assigneeType: 'squad',
      assigneeIds: [squad.id],
    });

    const alphaMissions = mm.getMissions({ bot: 'Alpha' });
    expect(alphaMissions.map((mission) => mission.id)).toContain(squadMission.id);

    const bravoMissions = mm.getMissions({ bot: 'Bravo' });
    expect(bravoMissions.map((mission) => mission.id)).toContain(squadMission.id);

    const charlieMissions = mm.getMissions({ bot: 'Charlie' });
    expect(charlieMissions).toHaveLength(0);
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

  // ── VoyagerLoop bridge (queue_task) ──────────────────

  it('queues task to VoyagerLoop when starting a queue_task mission', async () => {
    const mockQueuePlayerTask = vi.fn();
    const mockVoyager = {
      queuePlayerTask: mockQueuePlayerTask,
      getCompletedTasks: vi.fn().mockReturnValue([]),
      getFailedTasks: vi.fn().mockReturnValue([]),
    };
    const mockBot = {
      getVoyagerLoop: vi.fn().mockReturnValue(mockVoyager),
    };
    bm.getBot.mockReturnValue(mockBot);

    const mission = mm.createMission({
      type: 'queue_task',
      title: 'Mine 10 diamonds',
      description: 'Mine 10 diamonds near spawn',
      assigneeType: 'bot',
      assigneeIds: ['Miner'],
    });

    const started = await mm.startMission(mission.id);
    expect(started).toBeDefined();
    expect(started!.status).toBe('running');
    expect(mockQueuePlayerTask).toHaveBeenCalledWith('Mine 10 diamonds near spawn', 'mission');
  });

  it('uses title as fallback when description is undefined for queue_task', async () => {
    const mockQueuePlayerTask = vi.fn();
    const mockVoyager = {
      queuePlayerTask: mockQueuePlayerTask,
      getCompletedTasks: vi.fn().mockReturnValue([]),
      getFailedTasks: vi.fn().mockReturnValue([]),
    };
    bm.getBot.mockReturnValue({ getVoyagerLoop: vi.fn().mockReturnValue(mockVoyager) });

    const mission = mm.createMission({
      type: 'queue_task',
      title: 'Gather wood',
      assigneeType: 'bot',
      assigneeIds: ['Worker'],
    });

    await mm.startMission(mission.id);
    expect(mockQueuePlayerTask).toHaveBeenCalledWith('Gather wood', 'mission');
  });

  // ── Mission completion tracking ──────────────────────

  it('marks mission completed when VoyagerLoop completes the task', async () => {
    const mockVoyager = {
      queuePlayerTask: vi.fn(),
      getCompletedTasks: vi.fn().mockReturnValue(['Mine 10 diamonds']),
      getFailedTasks: vi.fn().mockReturnValue([]),
    };
    bm.getBot.mockReturnValue({ getVoyagerLoop: vi.fn().mockReturnValue(mockVoyager) });

    const mission = mm.createMission({
      type: 'queue_task',
      title: 'Mine 10 diamonds',
      assigneeType: 'bot',
      assigneeIds: ['Miner'],
    });

    await mm.startMission(mission.id);
    expect(mm.getMission(mission.id)!.status).toBe('running');

    mm.checkMissionProgress();
    expect(mm.getMission(mission.id)!.status).toBe('completed');
  });

  it('marks mission failed when VoyagerLoop fails the task', async () => {
    const mockVoyager = {
      queuePlayerTask: vi.fn(),
      getCompletedTasks: vi.fn().mockReturnValue([]),
      getFailedTasks: vi.fn().mockReturnValue(['Mine 10 diamonds']),
    };
    bm.getBot.mockReturnValue({ getVoyagerLoop: vi.fn().mockReturnValue(mockVoyager) });

    const mission = mm.createMission({
      type: 'queue_task',
      title: 'Mine 10 diamonds',
      assigneeType: 'bot',
      assigneeIds: ['Miner'],
    });

    await mm.startMission(mission.id);
    mm.checkMissionProgress();
    expect(mm.getMission(mission.id)!.status).toBe('failed');

    const events = io.emit.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('mission:failed');
  });

  // ── Stale mission detection ──────────────────────────

  it('flags stale missions running for over 30 minutes', () => {
    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Long task',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
    });

    mm.updateMissionStatus(mission.id, 'running');
    // Manually backdate startedAt to simulate a stale mission
    const record = mm.getMission(mission.id)!;
    record.startedAt = Date.now() - 31 * 60 * 1000;

    mm.checkMissionProgress();
    expect(record.blockedReason).toBe('Stale - running for over 30 minutes');
    // Status should remain 'running'
    expect(record.status).toBe('running');
  });

  it('does not flag missions under 30 minutes as stale', () => {
    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Quick task',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
    });

    mm.updateMissionStatus(mission.id, 'running');

    mm.checkMissionProgress();
    expect(mm.getMission(mission.id)!.blockedReason).toBeUndefined();
  });

  // ── Dependency check (canStart) ──────────────────────

  it('canStart returns true when no linkedCommandIds', () => {
    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Free mission',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
    });

    expect(mm.canStart(mission)).toBe(true);
  });

  it('canStart returns false when CommandCenter not set and linkedCommandIds present', () => {
    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Dependent mission',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
      linkedCommandIds: ['cmd_123'],
    });

    expect(mm.canStart(mission)).toBe(false);
  });

  it('canStart returns true when all linked commands have succeeded', () => {
    const mockCC = {
      getCommand: vi.fn().mockReturnValue({ status: 'succeeded' }),
    } as any;
    mm.setCommandCenter(mockCC);

    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Dependent mission',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
      linkedCommandIds: ['cmd_1', 'cmd_2'],
    });

    expect(mm.canStart(mission)).toBe(true);
    expect(mockCC.getCommand).toHaveBeenCalledTimes(2);
  });

  it('canStart returns false when a linked command has not succeeded', () => {
    const mockCC = {
      getCommand: vi.fn()
        .mockReturnValueOnce({ status: 'succeeded' })
        .mockReturnValueOnce({ status: 'queued' }),
    } as any;
    mm.setCommandCenter(mockCC);

    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Blocked mission',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
      linkedCommandIds: ['cmd_ok', 'cmd_pending'],
    });

    expect(mm.canStart(mission)).toBe(false);
  });

  it('startMission blocks when dependencies not met', async () => {
    const mockCC = {
      getCommand: vi.fn().mockReturnValue({ status: 'queued' }),
    } as any;
    mm.setCommandCenter(mockCC);

    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Blocked mission',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
      linkedCommandIds: ['cmd_pending'],
    });

    const result = await mm.startMission(mission.id);
    expect(result).toBeDefined();
    expect(result!.status).toBe('queued');
    expect(result!.blockedReason).toContain('cmd_pending');
  });

  // ── Per-bot queue ordering ──────────────────────────

  it('getBotMissionQueue preserves explicit queue order', () => {
    mm.createMission({
      type: 'gather_items',
      title: 'Low priority task',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
      priority: 'low',
    });
    mm.createMission({
      type: 'gather_items',
      title: 'Urgent task',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
      priority: 'urgent',
    });
    mm.createMission({
      type: 'gather_items',
      title: 'Normal task',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
      priority: 'normal',
    });

    const queue = mm.getBotMissionQueue('TestBot');
    expect(queue).toHaveLength(3);
    expect(queue[0].title).toBe('Low priority task');
    expect(queue[1].title).toBe('Urgent task');
    expect(queue[2].title).toBe('Normal task');
  });

  // ── Socket event completeness ────────────────────────

  it('emits mission:failed event on failure', () => {
    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Fail task',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
    });
    mm.updateMissionStatus(mission.id, 'running');
    mm.updateMissionStatus(mission.id, 'failed', { error: 'timeout' });

    const events = io.emit.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('mission:failed');
    expect(events).toContain('mission:updated');
  });

  it('emits mission:cancelled event on cancel', () => {
    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Cancel task',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
    });
    mm.cancelMission(mission.id);

    const events = io.emit.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('mission:cancelled');
    expect(events).toContain('mission:updated');
  });

  // ── Cleanup ──────────────────────────────────────

  it.todo('cleanup removes old completed/failed missions — cleanup() not yet implemented on MissionManager');

  it.todo('cleanup caps at 200 missions — cleanup() not yet implemented on MissionManager');

  // ── Shutdown ──────────────────────────────────────

  it.todo('shutdown cancels all running and queued missions — shutdown() not yet implemented on MissionManager');

  // ── Persistence ──────────────────────────────────

  it('save writes synchronously on each mutation', async () => {
    const fs = await import('fs');
    const writeFileSync = vi.mocked(fs.default.writeFileSync);
    writeFileSync.mockClear();

    mm.createMission({
      type: 'gather_items',
      title: 'Task 1',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
    });
    mm.createMission({
      type: 'gather_items',
      title: 'Task 2',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
    });

    // save() is called synchronously on each createMission, not debounced
    expect(writeFileSync.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
