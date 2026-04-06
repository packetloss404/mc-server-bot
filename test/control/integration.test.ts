import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs before importing modules
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('[]'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { CommandCenter } from '../../src/control/CommandCenter';
import { MissionManager } from '../../src/control/MissionManager';
import { MarkerStore } from '../../src/control/MarkerStore';
import { SquadManager } from '../../src/control/SquadManager';

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

describe('Control Platform Integration', () => {
  let io: ReturnType<typeof createMockIO>;
  let bm: ReturnType<typeof createMockBotManager>;
  let cc: CommandCenter;
  let mm: MissionManager;
  let ms: MarkerStore;
  let sm: SquadManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    io = createMockIO();
    bm = createMockBotManager();
    cc = new CommandCenter(bm, io);
    mm = new MissionManager(bm, io);
    ms = new MarkerStore(io);
    sm = new SquadManager(io);
  });

  afterEach(() => {
    cc.destroy();
    vi.useRealTimers();
  });

  // ── Command → getCommands ─────────────────────────────

  it('created command appears in getCommands', () => {
    const cmd = cc.createCommand({
      type: 'pause_voyager',
      targets: ['TestBot'],
    });

    const commands = cc.getCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe(cmd.id);
    expect(commands[0].type).toBe('pause_voyager');
    expect(commands[0].targets).toContain('TestBot');
  });

  // ── Mission → getMissions ─────────────────────────────

  it('created mission appears in getMissions', () => {
    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Collect wood',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
    });

    const missions = mm.getMissions();
    expect(missions).toHaveLength(1);
    expect(missions[0].id).toBe(mission.id);
    expect(missions[0].title).toBe('Collect wood');
    expect(missions[0].assigneeIds).toContain('TestBot');
  });

  // ── Marker → getMarkers ───────────────────────────────

  it('created marker appears in getMarkers', () => {
    const marker = ms.createMarker({
      name: 'Iron Mine',
      kind: 'mine',
      position: { x: 100, y: 20, z: -50 },
      tags: ['resource'],
    });

    const markers = ms.getMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0].id).toBe(marker.id);
    expect(markers[0].name).toBe('Iron Mine');
    expect(markers[0].kind).toBe('mine');
  });

  // ── Squad + members → getSquadsForBot ─────────────────

  it('created squad with added members appears in getSquadsForBot', () => {
    const squad = sm.createSquad({
      name: 'Mining Team',
      botNames: [],
    });

    sm.addBotToSquad(squad.id, 'TestBot');
    sm.addBotToSquad(squad.id, 'Helper');

    const testBotSquads = sm.getSquadsForBot('TestBot');
    expect(testBotSquads).toHaveLength(1);
    expect(testBotSquads[0].name).toBe('Mining Team');
    expect(testBotSquads[0].botNames).toContain('TestBot');
    expect(testBotSquads[0].botNames).toContain('Helper');

    const helperSquads = sm.getSquadsForBot('Helper');
    expect(helperSquads).toHaveLength(1);

    const unknownSquads = sm.getSquadsForBot('Unknown');
    expect(unknownSquads).toHaveLength(0);
  });

  // ── Cross-service: Command + Mission linked ───────────

  it('mission linked to command respects dependency', async () => {
    mm.setCommandCenter(cc);

    // Create a command
    const cmd = cc.createCommand({
      type: 'pause_voyager',
      targets: ['TestBot'],
    });

    // Create a mission linked to that command
    const mission = mm.createMission({
      type: 'gather_items',
      title: 'Wait for pause',
      assigneeType: 'bot',
      assigneeIds: ['TestBot'],
      linkedCommandIds: [cmd.id],
    });

    // Before command succeeds, mission cannot start
    expect(mm.canStart(mission)).toBe(false);

    // Dispatch the command (it will succeed)
    await cc.dispatchCommand(cmd);
    expect(cmd.status).toBe('succeeded');

    // Now mission can start
    expect(mm.canStart(mission)).toBe(true);
  });

  // ── Marker spatial lookup ─────────────────────────────

  it('findNearestMarker returns the closest marker', () => {
    ms.createMarker({
      name: 'Far Base',
      kind: 'base',
      position: { x: 1000, y: 64, z: 1000 },
    });
    ms.createMarker({
      name: 'Near Base',
      kind: 'base',
      position: { x: 10, y: 64, z: 10 },
    });

    const nearest = ms.findNearestMarker({ x: 0, y: 64, z: 0 }, 'base');
    expect(nearest).toBeDefined();
    expect(nearest!.name).toBe('Near Base');
  });

  // ── Zone containment ──────────────────────────────────

  it('isInsideZone checks rectangle containment', () => {
    const zone = ms.createZone({
      name: 'Build Area',
      mode: 'build',
      shape: 'rectangle',
      rectangle: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 },
    });

    expect(ms.isInsideZone(50, 50, zone.id)).toBe(true);
    expect(ms.isInsideZone(150, 50, zone.id)).toBe(false);
    expect(ms.isInsideZone(-1, 50, zone.id)).toBe(false);
  });

  it('isInsideZone checks circle containment', () => {
    const zone = ms.createZone({
      name: 'Guard Post',
      mode: 'guard',
      shape: 'circle',
      circle: { x: 50, z: 50, radius: 25 },
    });

    expect(ms.isInsideZone(50, 50, zone.id)).toBe(true);  // center
    expect(ms.isInsideZone(60, 50, zone.id)).toBe(true);   // within radius
    expect(ms.isInsideZone(100, 100, zone.id)).toBe(false); // outside
  });
});
