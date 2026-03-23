import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    io = createMockIO();
    bm = createMockBotManager();
    cc = new CommandCenter(bm, io);
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
});
