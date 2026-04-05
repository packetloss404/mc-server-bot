/**
 * Deterministic mock data for E2E tests.
 * These payloads mirror the shapes returned by the backend API
 * (see web/src/lib/api.ts for type definitions).
 */

export const BOTS = {
  bots: [
    {
      name: 'Farmer_Joe',
      personality: 'farmer',
      mode: 'codegen' as const,
      state: 'WANDERING',
      position: { x: 100, y: 64, z: -200 },
    },
    {
      name: 'Guard_Rex',
      personality: 'guard',
      mode: 'codegen' as const,
      state: 'PATROLLING',
      position: { x: 50, y: 70, z: -150 },
    },
    {
      name: 'Miner_Sam',
      personality: 'blacksmith',
      mode: 'primitive' as const,
      state: 'MINING',
      position: { x: -30, y: 45, z: 80 },
    },
  ],
};

export const PLAYERS = {
  players: [
    { name: 'Steve', position: { x: 10, y: 65, z: -20 }, isOnline: true },
    { name: 'Alex', position: { x: 200, y: 72, z: 100 }, isOnline: true },
  ],
};

export const WORLD = {
  timeOfDay: 'Day',
  timeOfDayTicks: 1000,
  day: 42,
  isRaining: false,
  onlineBots: 3,
  onlinePlayers: 2,
};

export const ACTIVITY = {
  events: [
    {
      type: 'task_complete',
      botName: 'Farmer_Joe',
      description: 'Harvested 64 wheat',
      timestamp: Date.now() - 60_000,
    },
    {
      type: 'combat',
      botName: 'Guard_Rex',
      description: 'Defeated a zombie',
      timestamp: Date.now() - 120_000,
    },
    {
      type: 'movement',
      botName: 'Miner_Sam',
      description: 'Reached diamond level',
      timestamp: Date.now() - 180_000,
    },
  ],
};

export const BOT_DETAILED = {
  bot: {
    name: 'Farmer_Joe',
    personality: 'farmer',
    personalityDisplayName: 'The Farmer',
    mode: 'codegen' as const,
    state: 'WANDERING',
    position: { x: 100, y: 64, z: -200 },
    health: 18,
    food: 15,
    equipment: { name: 'diamond_hoe', count: 1 },
    inventory: [
      { name: 'wheat', count: 64, slot: 9 },
      { name: 'wheat_seeds', count: 32, slot: 10 },
      { name: 'bone_meal', count: 16, slot: 11 },
    ],
    world: {
      biome: 'plains',
      timeOfDay: 'Day',
      isRaining: false,
      nearbyBlocks: 'farmland, wheat, water',
      nearbyEntities: 'cow x2, chicken x3',
    },
    voyager: {
      isRunning: true,
      isPaused: false,
      currentTask: 'Plant and harvest wheat field',
      completedTasks: ['Craft diamond hoe', 'Find water source', 'Till farmland'],
      failedTasks: ['Breed animals'],
      internalState: 'executing',
      queuedTaskCount: 2,
    },
    armor: {
      helmet: { name: 'iron_helmet', count: 1 },
      chestplate: { name: 'iron_chestplate', count: 1 },
      leggings: null,
      boots: { name: 'leather_boots', count: 1 },
    },
    offhand: null,
    hotbar: [
      { name: 'diamond_hoe', count: 1, slot: 0 },
      { name: 'wheat_seeds', count: 32, slot: 1 },
      null, null, null, null, null, null, null,
    ],
    experience: { level: 12, points: 450, progress: 0.65 },
    stats: {
      mined: { dirt: 120, stone: 45 },
      crafted: { diamond_hoe: 1, bread: 30 },
      smelted: {},
      placed: { wheat_seeds: 200 },
      killed: {},
      withdrew: {},
      deposited: { wheat: 512 },
      deaths: 1,
      interrupts: 3,
      movementTimeouts: 2,
      damageTaken: 45,
    },
    combat: {
      lastAttackerName: null,
      lastAttackedAt: 0,
      instinctActive: false,
    },
  },
};

export const BOT_RELATIONSHIPS = {
  relationships: {
    Steve: 75,
    Alex: 40,
  },
};

export const BOT_CONVERSATIONS = {
  conversations: {
    Steve: [
      { role: 'user' as const, text: 'How is the farm going?', timestamp: Date.now() - 300_000 },
      { role: 'model' as const, text: 'Great! I just harvested 64 wheat.', timestamp: Date.now() - 295_000 },
    ],
  },
};

export const SKILLS = {
  skills: [
    { name: 'harvestWheat', code: 'async function harvestWheat(bot) { /* ... */ }' },
    { name: 'plantSeeds', code: 'async function plantSeeds(bot) { /* ... */ }' },
  ],
  count: 2,
};

export const COMMANDS_LIST = {
  commands: [
    {
      id: 'cmd-001',
      type: 'move',
      botName: 'Farmer_Joe',
      status: 'completed',
      params: { x: 100, z: -200 },
      createdAt: Date.now() - 60_000,
    },
  ],
};

export const MISSIONS_LIST = {
  missions: [
    {
      id: 'msn-001',
      name: 'Wheat harvest cycle',
      type: 'queue_task',
      status: 'running',
      botName: 'Farmer_Joe',
      createdAt: Date.now() - 120_000,
    },
  ],
};

export const MARKERS = {
  markers: [
    { id: 'mk-1', name: 'Farm Center', x: 100, y: 64, z: -200, color: '#27AE60' },
    { id: 'mk-2', name: 'Mine Entrance', x: -30, y: 45, z: 80, color: '#E74C3C' },
  ],
};

export const ZONES = {
  zones: [
    {
      id: 'zn-1',
      name: 'Wheat Farm',
      type: 'rectangular',
      x1: 80, z1: -220, x2: 120, z2: -180,
      color: '#27AE60',
    },
    {
      id: 'zn-2',
      name: 'Guard Post',
      type: 'circular',
      cx: 50, cz: -150, radius: 20,
      color: '#4A90D9',
    },
  ],
};

export const ROUTES = {
  routes: [
    {
      id: 'rt-1',
      name: 'Patrol Route Alpha',
      waypoints: [
        { x: 0, y: 64, z: 0 },
        { x: 50, y: 64, z: 0 },
        { x: 50, y: 64, z: 50 },
        { x: 0, y: 64, z: 50 },
      ],
    },
  ],
};

export const COMMANDER_PARSE = {
  plan: {
    intent: 'Send Farmer_Joe to the mine entrance',
    steps: [
      { type: 'command', action: 'move', botName: 'Farmer_Joe', params: { x: -30, z: 80 } },
    ],
    confidence: 0.92,
  },
};

export const COMMANDER_EXECUTE = {
  success: true,
  results: [
    { stepIndex: 0, status: 'completed', commandId: 'cmd-002' },
  ],
};

export const TERRAIN = {
  cx: 0,
  cz: 0,
  radius: 96,
  step: 2,
  size: 96,
  blocks: Array(96 * 96).fill('grass_block'),
};
