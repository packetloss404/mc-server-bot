import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before importing the modules
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

import { CommanderService, CommanderServiceDeps } from '../../src/control/CommanderService';
import { CommandRecord } from '../../src/control/CommandTypes';
import { MissionRecord } from '../../src/control/MissionTypes';

function createMockIO() {
  return { emit: vi.fn() } as any;
}

function createMockBotManager(bots: { name: string; personality: string }[] = []) {
  const mockInstances = bots.map((b) => ({
    name: b.name,
    personality: b.personality,
    getStatus: vi.fn().mockReturnValue({
      mode: 'codegen',
      position: { x: 0, y: 64, z: 0 },
    }),
  }));
  return {
    getBot: vi.fn((name: string) => mockInstances.find((b) => b.name === name) ?? null),
    getAllBots: vi.fn().mockReturnValue(mockInstances),
  } as any;
}

function createMockCommandCenter() {
  const commands: CommandRecord[] = [];
  return {
    createCommand: vi.fn((params: any) => {
      const cmd: CommandRecord = {
        id: `cmd_${Date.now()}_test`,
        type: params.type,
        scope: 'single',
        priority: params.priority ?? 'normal',
        source: params.source ?? 'api',
        status: 'queued',
        targets: params.targets,
        params: params.params ?? {},
        createdAt: new Date().toISOString(),
      };
      commands.push(cmd);
      return cmd;
    }),
    dispatchCommand: vi.fn(async (cmd: CommandRecord) => {
      cmd.status = 'succeeded';
      return cmd;
    }),
    getCommands: vi.fn(() => commands),
  } as any;
}

function createMockMissionManager() {
  const missions: MissionRecord[] = [];
  return {
    createMission: vi.fn((params: any) => {
      const msn: MissionRecord = {
        id: `msn_${Date.now()}_test`,
        type: params.type,
        title: params.title,
        description: params.description,
        assigneeType: params.assigneeType,
        assigneeIds: params.assigneeIds,
        status: 'queued',
        priority: params.priority ?? 'normal',
        steps: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: params.source ?? 'commander',
      };
      missions.push(msn);
      return msn;
    }),
    getMissions: vi.fn(() => missions),
  } as any;
}

function createMockMarkerStore() {
  return {
    getMarkers: vi.fn().mockReturnValue([]),
    getZones: vi.fn().mockReturnValue([]),
    getRoutes: vi.fn().mockReturnValue([]),
  } as any;
}

describe('CommanderService', () => {
  let service: CommanderService;
  let deps: CommanderServiceDeps;
  let commandCenter: ReturnType<typeof createMockCommandCenter>;
  let missionManager: ReturnType<typeof createMockMissionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    commandCenter = createMockCommandCenter();
    missionManager = createMockMissionManager();

    deps = {
      llmClient: null,
      botManager: createMockBotManager(),
      commandCenter,
      missionManager,
      markerStore: createMockMarkerStore(),
    };
    service = new CommanderService(deps);
  });

  // ── Parse with no LLM ────────────────────────────────

  it('returns low confidence plan when no LLM is configured', async () => {
    const plan = await service.parse('send all bots to the mine');

    expect(plan).toBeDefined();
    expect(plan.id).toMatch(/^plan_/);
    expect(plan.input).toBe('send all bots to the mine');
    expect(plan.confidence).toBe(0);
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.warnings).toContain('No LLM configured — natural language parsing is unavailable');
    expect(plan.commands).toEqual([]);
    expect(plan.missions).toEqual([]);
    expect(plan.createdAt).toBeTypeOf('string');
  });

  // ── Parse returns valid plan structure ────────────────

  it('stores the plan and retrieves it by ID', async () => {
    const plan = await service.parse('hello');

    const retrieved = service.getPlan(plan.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(plan.id);
    expect(retrieved!.input).toBe('hello');
  });

  it('returns valid plan structure fields', async () => {
    const plan = await service.parse('test input');

    // All required plan fields must be present
    expect(plan).toHaveProperty('id');
    expect(plan).toHaveProperty('input');
    expect(plan).toHaveProperty('intent');
    expect(plan).toHaveProperty('confidence');
    expect(plan).toHaveProperty('warnings');
    expect(plan).toHaveProperty('requiresConfirmation');
    expect(plan).toHaveProperty('commands');
    expect(plan).toHaveProperty('missions');
    expect(plan).toHaveProperty('createdAt');

    expect(Array.isArray(plan.commands)).toBe(true);
    expect(Array.isArray(plan.missions)).toBe(true);
    expect(Array.isArray(plan.warnings)).toBe(true);
  });

  // ── Parse with LLM (mocked) ──────────────────────────

  it('parses LLM response into a structured plan', async () => {
    const mockLLM = {
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          intent: 'Pause the bot',
          confidence: 0.95,
          warnings: [],
          commands: [{ type: 'pause_voyager', targets: ['TestBot'], payload: {} }],
          missions: [],
        }),
      }),
    };

    const bm = createMockBotManager([{ name: 'TestBot', personality: 'farmer' }]);
    const svc = new CommanderService({
      ...deps,
      llmClient: mockLLM as any,
      botManager: bm,
    });

    const plan = await svc.parse('pause TestBot');

    expect(plan.confidence).toBe(0.95);
    expect(plan.intent).toBe('Pause the bot');
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0].type).toBe('pause_voyager');
    expect(plan.commands[0].targets).toEqual(['TestBot']);
    expect(plan.requiresConfirmation).toBe(false); // high confidence, no warnings
  });

  it('handles LLM returning invalid JSON gracefully', async () => {
    const mockLLM = {
      generate: vi.fn().mockResolvedValue({ text: 'not valid json at all' }),
    };

    const svc = new CommanderService({
      ...deps,
      llmClient: mockLLM as any,
    });

    const plan = await svc.parse('do something');

    expect(plan.confidence).toBe(0);
    expect(plan.warnings).toContain('LLM response was not valid JSON');
    expect(plan.commands).toEqual([]);
    expect(plan.missions).toEqual([]);
  });

  it('handles LLM error gracefully', async () => {
    const mockLLM = {
      generate: vi.fn().mockRejectedValue(new Error('API quota exceeded')),
    };

    const svc = new CommanderService({
      ...deps,
      llmClient: mockLLM as any,
    });

    const plan = await svc.parse('test');

    expect(plan.confidence).toBe(0);
    expect(plan.warnings.some((w) => w.includes('API quota exceeded'))).toBe(true);
  });

  // ── Execute dispatches commands and creates missions ──

  it('executes a plan by dispatching commands and creating missions', async () => {
    // First parse to get a plan (no LLM, so we set up the plan manually)
    const plan = await service.parse('pause TestBot');

    // Manually inject commands/missions into the stored plan for execution test
    const storedPlan = service.getPlan(plan.id)!;
    storedPlan.commands = [
      { type: 'pause_voyager', targets: ['TestBot'], payload: {} },
    ];
    storedPlan.missions = [
      { type: 'gather_items', title: 'Gather wood', assigneeIds: ['TestBot'] },
    ];

    const result = await service.execute(plan.id);

    expect(result).toBeDefined();
    expect(commandCenter.createCommand).toHaveBeenCalledOnce();
    expect(commandCenter.dispatchCommand).toHaveBeenCalledOnce();
    expect(missionManager.createMission).toHaveBeenCalledOnce();

    expect(result!.commands).toHaveLength(1);
    expect(result!.missions).toHaveLength(1);
    expect(result!.commands[0].type).toBe('pause_voyager');
    expect(result!.missions[0].type).toBe('gather_items');
  });

  // ── Unknown plan ID returns null ──────────────────────

  it('returns null when executing a nonexistent plan', async () => {
    const result = await service.execute('plan_nonexistent');
    expect(result).toBeNull();
  });

  it('returns null from getPlan for unknown ID', () => {
    const plan = service.getPlan('plan_does_not_exist');
    expect(plan).toBeUndefined();
  });
});
