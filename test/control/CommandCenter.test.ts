import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandCenter, CommandRecord } from '../../src/control/CommandCenter';

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
    io = createMockIO();
    bm = createMockBotManager();
    cc = new CommandCenter(bm, io);
  });

  it('creates a command with valid fields', () => {
    const cmd = cc.createCommand('TestBot', 'pause_voyager');

    expect(cmd).toBeDefined();
    expect(cmd.id).toMatch(/^cmd-/);
    expect(cmd.botName).toBe('TestBot');
    expect(cmd.type).toBe('pause_voyager');
    expect(cmd.status).toBe('queued');
    expect(cmd.createdAt).toBeTypeOf('number');
    expect(cmd.updatedAt).toBeTypeOf('number');
    expect(cmd.createdAt).toBeLessThanOrEqual(cmd.updatedAt);
  });

  it('rejects commands for nonexistent bot', () => {
    bm.getBot.mockReturnValue(null);
    const cmd = cc.createCommand('GhostBot', 'pause_voyager');

    expect(cmd.status).toBe('failed');
    expect(cmd.error).toBeDefined();
    expect(cmd.error).toContain('GhostBot');
  });

  it('dispatches pause_voyager command', async () => {
    const cmd = cc.createCommand('TestBot', 'pause_voyager');
    const result = await cc.dispatch(cmd.id);

    expect(result.status).toBe('succeeded');
    expect(bm._mockVoyager.pause).toHaveBeenCalledOnce();
  });

  it('dispatches stop_movement command', async () => {
    const cmd = cc.createCommand('TestBot', 'stop_movement');
    const result = await cc.dispatch(cmd.id);

    expect(result.status).toBe('succeeded');
    expect(bm._mockBot.pathfinder.stop).toHaveBeenCalledOnce();
  });

  it('emits socket events on state changes', async () => {
    const cmd = cc.createCommand('TestBot', 'pause_voyager');
    await cc.dispatch(cmd.id);

    const events = io.emit.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('command:queued');
    expect(events).toContain('command:started');
    expect(events).toContain('command:succeeded');
  });

  it('supports command cancellation', () => {
    const cmd = cc.createCommand('TestBot', 'pause_voyager');
    expect(cmd.status).toBe('queued');

    const cancelled = cc.cancel(cmd.id);
    expect(cancelled.status).toBe('cancelled');
  });

  it('queries commands by bot name', () => {
    cc.createCommand('Alpha', 'pause_voyager');
    cc.createCommand('Alpha', 'stop_movement');
    cc.createCommand('Bravo', 'pause_voyager');

    const alphaCommands = cc.getCommands('Alpha');
    expect(alphaCommands).toHaveLength(2);
    expect(alphaCommands.every((c) => c.botName === 'Alpha')).toBe(true);

    const bravoCommands = cc.getCommands('Bravo');
    expect(bravoCommands).toHaveLength(1);

    const allCommands = cc.getCommands();
    expect(allCommands).toHaveLength(3);
  });
});
