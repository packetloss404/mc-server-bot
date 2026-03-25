import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeCommandRecord, normalizeMissionRecord } from '@/lib/api';
import { useControlStore, useMissionStore } from '@/lib/store';

describe('control platform frontend helpers', () => {
  beforeEach(() => {
    useControlStore.setState({ selectedBotIds: new Set(), commandHistory: [] });
    useMissionStore.setState({ missions: [] });
  });

  it('normalizes backend command records for the frontend', () => {
    const command = normalizeCommandRecord({
      id: 'cmd-1',
      type: 'walk_to_coords',
      scope: 'single',
      targets: ['Ada'],
      params: { x: 1, y: 64, z: 2 },
      priority: 'critical',
      source: 'dashboard',
      status: 'queued',
      createdAt: '2026-03-25T12:00:00.000Z',
    });

    expect(command.scope).toBe('bot');
    expect(command.priority).toBe('urgent');
    expect(command.payload).toEqual({ x: 1, y: 64, z: 2 });
    expect(command.createdAt).toBeTypeOf('number');
  });

  it('upserts command history in descending time order', () => {
    const store = useControlStore.getState();

    store.upsertCommand({
      id: 'cmd-1',
      type: 'pause_voyager',
      scope: 'bot',
      targets: ['Ada'],
      payload: {},
      priority: 'normal',
      source: 'dashboard',
      status: 'queued',
      createdAt: 10,
    });

    store.upsertCommand({
      id: 'cmd-2',
      type: 'stop_movement',
      scope: 'bot',
      targets: ['Bee'],
      payload: {},
      priority: 'normal',
      source: 'dashboard',
      status: 'started',
      createdAt: 20,
    });

    expect(useControlStore.getState().commandHistory.map((command) => command.id)).toEqual(['cmd-2', 'cmd-1']);
  });

  it('normalizes mission timestamps and stores mission updates', () => {
    const mission = normalizeMissionRecord({
      id: 'mission-1',
      type: 'queue_task',
      title: 'Guard base',
      assigneeType: 'bot',
      assigneeIds: ['Ada'],
      status: 'queued',
      priority: 'normal',
      steps: [],
      createdAt: 100,
      updatedAt: '2026-03-25T12:00:00.000Z' as unknown as number,
      source: 'role',
    });

    useMissionStore.getState().upsertMission(mission);

    expect(useMissionStore.getState().missions[0].updatedAt).toBeTypeOf('number');
    expect(useMissionStore.getState().missions[0].title).toBe('Guard base');
  });

  it('returns running missions for a specific bot', () => {
    useMissionStore.getState().setMissions([
      {
        id: 'mission-1',
        type: 'queue_task',
        title: 'Mine stone',
        assigneeType: 'bot',
        assigneeIds: ['Ada'],
        status: 'running',
        priority: 'normal',
        steps: [],
        createdAt: 1,
        updatedAt: 2,
        source: 'dashboard',
      },
      {
        id: 'mission-2',
        type: 'queue_task',
        title: 'Guard base',
        assigneeType: 'bot',
        assigneeIds: ['Bee'],
        status: 'queued',
        priority: 'normal',
        steps: [],
        createdAt: 3,
        updatedAt: 4,
        source: 'role',
      },
    ]);

    expect(useMissionStore.getState().getRunningForBot('Ada').map((mission) => mission.id)).toEqual(['mission-1']);
    expect(useMissionStore.getState().getRunningForBot('Bee')).toEqual([]);
  });

  it('keeps selection state unique when selecting all bots', () => {
    useControlStore.getState().selectAll(['Ada', 'Bee', 'Ada']);

    expect(Array.from(useControlStore.getState().selectedBotIds)).toEqual(['Ada', 'Bee']);
  });
});
