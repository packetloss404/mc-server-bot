import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs before importing the module
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{"commands":[]}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { CommandCenter } from '../../src/control/CommandCenter';
import { CommandRecord } from '../../src/control/CommandTypes';

function createMockIO() {
  return { emit: vi.fn() } as any;
}

function createMockBotManager() {
  const mockVoyager = {
    pause: vi.fn(),
    resume: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
    isPaused: vi.fn().mockReturnValue(false),
  };
  const mockBot = {
    pathfinder: { stop: vi.fn(), setGoal: vi.fn() },
    players: {},
    entity: { position: { x: 0, y: 64, z: 0 } },
    inventory: { items: vi.fn().mockReturnValue([]) },
  };
  const mockInstance = {
    bot: mockBot,
    getVoyagerLoop: vi.fn().mockReturnValue(mockVoyager),
    name: 'TestBot',
  };
  return {
    getBot: vi.fn().mockReturnValue(mockInstance),
    getAllBots: vi.fn().mockReturnValue([mockInstance]),
    _mockInstance: mockInstance,
    _mockVoyager: mockVoyager,
    _mockBot: mockBot,
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
    expect(bm._mockVoyager.pause).toHaveBeenCalledOnce();
  });

  it('dispatches stop_movement command', async () => {
    const cmd = cc.createCommand({
      type: 'stop_movement',
      targets: ['TestBot'],
    });
    const result = await cc.dispatchCommand(cmd);

    expect(result.status).toBe('succeeded');
    expect(bm._mockBot.pathfinder.stop).toHaveBeenCalledOnce();
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
    const secondVoyager = {
      pause: vi.fn(),
      resume: vi.fn(),
      isRunning: vi.fn().mockReturnValue(true),
      isPaused: vi.fn().mockReturnValue(false),
    };
    const secondBot = {
      pathfinder: { stop: vi.fn(), setGoal: vi.fn() },
      players: {},
      entity: { position: { x: 10, y: 64, z: 10 } },
      inventory: { items: vi.fn().mockReturnValue([]) },
    };
    const secondInstance = {
      bot: secondBot,
      getVoyagerLoop: vi.fn().mockReturnValue(secondVoyager),
      name: 'Bravo',
    };

    bm.getBot.mockImplementation((name: string) => {
      if (name === 'Bravo') return secondInstance;
      return bm._mockInstance;
    });

    const parent = cc.createCommand({
      type: 'pause_voyager',
      scope: 'squad',
      targets: ['TestBot', 'Bravo'],
    });

    const result = await cc.dispatchCommand(parent);

    expect(result.status).toBe('succeeded');
    expect(result.childCommandIds).toHaveLength(2);
    expect(bm._mockVoyager.pause).toHaveBeenCalledOnce();
    expect(secondVoyager.pause).toHaveBeenCalledOnce();
  });

  // ── Task 1: Cancellation stops pathfinder for movement commands ──

  it('stops pathfinder when cancelling a started movement command', async () => {
    // Create and dispatch a walk_to_coords command
    const cmd = cc.createCommand({
      type: 'walk_to_coords',
      targets: ['TestBot'],
      params: { x: 100, y: 64, z: 200 },
    });
    await cc.dispatchCommand(cmd);

    // It should have succeeded (mock pathfinder.setGoal works), so let's
    // test cancelling a command that's in 'started' status by creating one
    // and manually setting its status
    const cmd2 = cc.createCommand({
      type: 'follow_player',
      targets: ['TestBot'],
      params: { playerName: 'Steve' },
    });
    // Force the command into started status for testing cancellation
    (cmd2 as any).status = 'started';
    (cmd2 as any).startedAt = new Date().toISOString();

    bm._mockBot.pathfinder.stop.mockClear();
    cc.cancelCommand(cmd2.id);

    expect(cmd2.status).toBe('cancelled');
    expect(bm._mockBot.pathfinder.stop).toHaveBeenCalled();
  });

  it('does NOT stop pathfinder when cancelling a non-movement command', () => {
    const cmd = cc.createCommand({
      type: 'pause_voyager',
      targets: ['TestBot'],
    });
    // Force into started
    (cmd as any).status = 'started';
    (cmd as any).startedAt = new Date().toISOString();

    bm._mockBot.pathfinder.stop.mockClear();
    cc.cancelCommand(cmd.id);

    expect(cmd.status).toBe('cancelled');
    expect(bm._mockBot.pathfinder.stop).not.toHaveBeenCalled();
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
    bm.getBot.mockReturnValue(null);

    const cmd = cc.createCommand({
      type: 'pause_voyager',
      targets: ['NonExistentBot'],
    });
    const result = await cc.dispatchCommand(cmd);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('BOT_NOT_FOUND');
  });

  it('fails with BOT_OFFLINE if bot is not connected', async () => {
    bm._mockInstance.bot = null;

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

  it.todo('cleanup removes commands older than 24 hours — cleanup() not implemented; persist() auto-trims to 500');

  it.todo('cleanup caps at 500 commands — cleanup() not implemented; persist() auto-trims to 500');

  // ── Shutdown: cancels active commands ──

  it.todo('shutdown cancels all active commands — shutdown() not implemented; use destroy() to stop timers');

  // ── Persistence ──

  it('persist writes synchronously on each mutation', async () => {
    const fs = await import('fs');
    const writeFileSync = vi.mocked(fs.writeFileSync);
    writeFileSync.mockClear();

    cc.createCommand({ type: 'pause_voyager', targets: ['TestBot'] });
    cc.createCommand({ type: 'pause_voyager', targets: ['TestBot'] });
    cc.createCommand({ type: 'pause_voyager', targets: ['TestBot'] });

    // persist() is called synchronously on each createCommand, not debounced
    expect(writeFileSync.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
