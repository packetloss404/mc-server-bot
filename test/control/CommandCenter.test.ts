import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs before importing the module
vi.mock('fs', () => {
  const fns = {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{"commands":[]}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
  };
  return { default: fns, ...fns };
});

import { CommandCenter } from '../../src/control/CommandCenter';
import { CommandRecord } from '../../src/control/CommandTypes';

function createMockIO() {
  return { emit: vi.fn() } as any;
}

function createMockBotManager() {
  const mockWorker = {
    sendCommand: vi.fn(),
    isAlive: vi.fn().mockReturnValue(true),
    name: 'TestBot',
  };
  const workers = new Map<string, any>();
  workers.set('testbot', mockWorker);
  return {
    getWorker: vi.fn((name: string) => workers.get(name.toLowerCase())),
    getAllWorkers: vi.fn(() => [...workers.values()]),
    _mockWorker: mockWorker,
    _workers: workers,
  } as any;
}

describe('CommandCenter', () => {
  let cc: CommandCenter;
  let io: ReturnType<typeof createMockIO>;
  let bm: ReturnType<typeof createMockBotManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    io = createMockIO();
    bm = createMockBotManager();
    cc = new CommandCenter(bm, io);
  });

  afterEach(() => {
    cc.destroy();
    vi.useRealTimers();
  });

  it('creates a command with valid fields', () => {
    const cmd = cc.createCommand({
      type: 'pause_voyager',
      targets: ['TestBot'],
    });

    expect(cmd).toBeDefined();
    expect(cmd.id).toMatch(/^cmd_/);
    expect(cmd.targets).toContain('TestBot');
    expect(cmd.type).toBe('pause_voyager');
    expect(cmd.status).toBe('queued');
    expect(cmd.createdAt).toBeTypeOf('string');
  });

  it('dispatches pause_voyager command', async () => {
    const cmd = cc.createCommand({
      type: 'pause_voyager',
      targets: ['TestBot'],
    });
    const result = await cc.dispatchCommand(cmd);

    expect(result.status).toBe('succeeded');
    expect(bm._mockWorker.sendCommand).toHaveBeenCalledWith('setMode', { pause: true });
  });

  it('dispatches stop_movement command', async () => {
    const cmd = cc.createCommand({
      type: 'stop_movement',
      targets: ['TestBot'],
    });
    const result = await cc.dispatchCommand(cmd);

    expect(result.status).toBe('succeeded');
    expect(bm._mockWorker.sendCommand).toHaveBeenCalledWith('stopMovement', {});
  });

  it('emits socket events on state changes', async () => {
    const cmd = cc.createCommand({
      type: 'pause_voyager',
      targets: ['TestBot'],
    });
    await cc.dispatchCommand(cmd);

    const events = io.emit.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('command:queued');
    expect(events).toContain('command:started');
    expect(events).toContain('command:succeeded');
  });

  it('supports command cancellation', () => {
    const cmd = cc.createCommand({
      type: 'pause_voyager',
      targets: ['TestBot'],
    });
    expect(cmd.status).toBe('queued');

    const cancelled = cc.cancelCommand(cmd.id);
    expect(cancelled).toBeDefined();
    expect(cancelled!.status).toBe('cancelled');
  });

  it('queries commands by bot name', () => {
    cc.createCommand({ type: 'pause_voyager', targets: ['Alpha'] });
    cc.createCommand({ type: 'stop_movement', targets: ['Alpha'] });
    cc.createCommand({ type: 'pause_voyager', targets: ['Bravo'] });

    const alphaCommands = cc.getCommands({ bot: 'Alpha' });
    expect(alphaCommands).toHaveLength(2);
    expect(alphaCommands.every((c) => c.targets.includes('Alpha'))).toBe(true);

    const bravoCommands = cc.getCommands({ bot: 'Bravo' });
    expect(bravoCommands).toHaveLength(1);

    const allCommands = cc.getCommands();
    expect(allCommands).toHaveLength(3);
  });

  it('fans out squad-scoped commands across squad members', async () => {
    const secondWorker = {
      sendCommand: vi.fn(),
      isAlive: vi.fn().mockReturnValue(true),
      name: 'Bravo',
    };
    bm._workers.set('bravo', secondWorker);

    const parent = cc.createCommand({
      type: 'pause_voyager',
      scope: 'squad',
      targets: ['TestBot', 'Bravo'],
    });

    const result = await cc.dispatchCommand(parent);

    expect(result.status).toBe('succeeded');
    expect(result.childCommandIds).toHaveLength(2);
    expect(bm._mockWorker.sendCommand).toHaveBeenCalledWith('setMode', { pause: true });
    expect(secondWorker.sendCommand).toHaveBeenCalledWith('setMode', { pause: true });
  });

  // ── Task 1: Cancellation transitions status correctly ──
  // Note: pathfinder-stop on cancel was removed; cancellation only changes status now.

  it('cancelling a started command transitions it to cancelled', () => {
    const cmd = cc.createCommand({
      type: 'follow_player',
      targets: ['TestBot'],
      params: { playerName: 'Steve' },
    });
    (cmd as any).status = 'started';
    (cmd as any).startedAt = new Date().toISOString();

    cc.cancelCommand(cmd.id);
    expect(cmd.status).toBe('cancelled');
  });

  it('cancelling a non-movement command transitions it to cancelled', () => {
    const cmd = cc.createCommand({
      type: 'pause_voyager',
      targets: ['TestBot'],
    });
    (cmd as any).status = 'started';
    (cmd as any).startedAt = new Date().toISOString();

    cc.cancelCommand(cmd.id);
    expect(cmd.status).toBe('cancelled');
  });

  it('includes reason in cancellation error', () => {
    const cmd = cc.createCommand({
      type: 'walk_to_coords',
      targets: ['TestBot'],
      params: { x: 0, y: 64, z: 0 },
    });
    cc.cancelCommand(cmd.id, 'superseded');

    expect(cmd.status).toBe('cancelled');
    expect(cmd.error?.code).toBe('CANCELLED');
    expect(cmd.error?.message).toBe('superseded');
  });

  // ── Task 2: Timeout handling ──

  it('times out commands that stay in started too long', () => {
    const cmd = cc.createCommand({
      type: 'walk_to_coords',
      targets: ['TestBot'],
      params: { x: 0, y: 64, z: 0 },
    });
    // Force into started with a past startedAt
    (cmd as any).status = 'started';
    (cmd as any).startedAt = new Date(Date.now() - 70_000).toISOString();

    cc.checkTimeouts();

    expect(cmd.status).toBe('failed');
    expect(cmd.error?.code).toBe('TIMEOUT');
    expect(cmd.error?.message).toBe('Command timed out');
  });

  it('does not time out commands under the threshold', () => {
    const cmd = cc.createCommand({
      type: 'walk_to_coords',
      targets: ['TestBot'],
      params: { x: 0, y: 64, z: 0 },
    });
    (cmd as any).status = 'started';
    (cmd as any).startedAt = new Date(Date.now() - 30_000).toISOString();

    cc.checkTimeouts();

    expect(cmd.status).toBe('started');
  });

  it('timeout checker runs on interval', () => {
    const cmd = cc.createCommand({
      type: 'walk_to_coords',
      targets: ['TestBot'],
      params: { x: 0, y: 64, z: 0 },
    });
    (cmd as any).status = 'started';
    (cmd as any).startedAt = new Date(Date.now() - 70_000).toISOString();

    // Advance by 10 seconds to trigger interval
    vi.advanceTimersByTime(10_000);

    expect(cmd.status).toBe('failed');
    expect(cmd.error?.code).toBe('TIMEOUT');
  });

  // ── Task 3: Concurrent command protection ──

  it('cancels active command when a new command is dispatched for same bot', async () => {
    // First command: manually force into started state
    const cmd1 = cc.createCommand({
      type: 'walk_to_coords',
      targets: ['TestBot'],
      params: { x: 10, y: 64, z: 10 },
    });
    (cmd1 as any).status = 'started';
    (cmd1 as any).startedAt = new Date().toISOString();

    // Second command dispatched for same bot
    const cmd2 = cc.createCommand({
      type: 'stop_movement',
      targets: ['TestBot'],
    });
    await cc.dispatchCommand(cmd2);

    // First command should have been cancelled with 'superseded' reason
    expect(cmd1.status).toBe('cancelled');
    expect(cmd1.error?.message).toBe('superseded');

    // Second command should have succeeded
    expect(cmd2.status).toBe('succeeded');
  });

  // ── Task 4: Bot validation ──

  it('fails with BOT_NOT_FOUND if bot does not exist', async () => {
    const cmd = cc.createCommand({
      type: 'pause_voyager',
      targets: ['NonExistentBot'],
    });
    const result = await cc.dispatchCommand(cmd);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('BOT_NOT_FOUND');
  });

  it('fails with BOT_OFFLINE if bot is not connected', async () => {
    bm._mockWorker.isAlive.mockReturnValue(false);

    const cmd = cc.createCommand({
      type: 'stop_movement',
      targets: ['TestBot'],
    });
    const result = await cc.dispatchCommand(cmd);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('BOT_OFFLINE');
  });

  it('fails with NO_TARGET if no target specified', async () => {
    const cmd = cc.createCommand({
      type: 'pause_voyager',
      targets: [],
    });
    const result = await cc.dispatchCommand(cmd);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('NO_TARGET');
  });

  // ── Task 6: Structured logging ──

  it('logs lifecycle transitions with structured fields', async () => {
    // We just verify the command gets timestamps set correctly on transitions
    const cmd = cc.createCommand({
      type: 'pause_voyager',
      targets: ['TestBot'],
    });
    await cc.dispatchCommand(cmd);

    expect(cmd.startedAt).toBeTypeOf('string');
    expect(cmd.completedAt).toBeTypeOf('string');

    // Verify durations are calculable
    const started = new Date(cmd.startedAt!).getTime();
    const completed = new Date(cmd.completedAt!).getTime();
    expect(completed).toBeGreaterThanOrEqual(started);
  });

  // ── Cleanup: removes old commands ──

  it('cleanup removes commands older than 24 hours', () => {
    const old = cc.createCommand({ type: 'pause_voyager', targets: ['TestBot'] });
    const fresh = cc.createCommand({ type: 'pause_voyager', targets: ['TestBot'] });
    (old as any).createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    const removed = cc.cleanup();
    expect(removed).toBe(1);
    expect(cc.getCommand(old.id)).toBeUndefined();
    expect(cc.getCommand(fresh.id)).toBeDefined();
  });

  it('cleanup caps at 500 commands', () => {
    for (let i = 0; i < 600; i++) {
      cc.createCommand({ type: 'pause_voyager', targets: ['TestBot'] });
    }
    cc.cleanup();
    expect(cc.getCommands({ limit: 1000 }).length).toBe(500);
  });

  // ── Shutdown: cancels active commands ──

  it('shutdown cancels all active commands', () => {
    const cmd = cc.createCommand({ type: 'pause_voyager', targets: ['TestBot'] });
    (cmd as any).status = 'started';
    (cmd as any).startedAt = new Date().toISOString();

    cc.shutdown();
    expect(cmd.status).toBe('cancelled');
    expect(cmd.error?.code).toBe('CANCELLED');
    expect(cmd.error?.message).toBe('shutdown');
  });

  // ── Persistence ──

  it('persist writes to disk after creating commands (debounced + flush)', async () => {
    const fs = await import('fs');
    const writeFileSync = vi.mocked(fs.writeFileSync);
    writeFileSync.mockClear();

    cc.createCommand({ type: 'pause_voyager', targets: ['TestBot'] });
    cc.createCommand({ type: 'pause_voyager', targets: ['TestBot'] });
    cc.createCommand({ type: 'pause_voyager', targets: ['TestBot'] });

    // persist() is debounced — flush to force the write
    cc.flush();
    expect(writeFileSync.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
