const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function fetchVoid(path: string, options?: RequestInit): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }
}

// Types matching the backend
export interface BotStatus {
  name: string;
  personality: string;
  mode: 'primitive' | 'codegen';
  state: string;
  position: { x: number; y: number; z: number } | null;
}

export interface InventoryItem {
  name: string;
  count: number;
  slot: number;
}

export interface EquipmentSlot {
  name: string;
  count: number;
}

export interface BotArmor {
  helmet: EquipmentSlot | null;
  chestplate: EquipmentSlot | null;
  leggings: EquipmentSlot | null;
  boots: EquipmentSlot | null;
}

export interface BotStatsData {
  mined: Record<string, number>;
  crafted: Record<string, number>;
  smelted: Record<string, number>;
  placed: Record<string, number>;
  killed: Record<string, number>;
  withdrew: Record<string, number>;
  deposited: Record<string, number>;
  deaths: number;
  interrupts: number;
  movementTimeouts: number;
  damageTaken: number;
}

export interface BotExperience {
  level: number;
  points: number;
  progress: number;
}

export interface BotCombat {
  lastAttackerName: string | null;
  lastAttackedAt: number;
  instinctActive: boolean;
}

export interface BotDetailed extends BotStatus {
  personalityDisplayName: string;
  health: number;
  food: number;
  equipment: EquipmentSlot | null;
  inventory: InventoryItem[];
  world: {
    biome: string;
    timeOfDay: string;
    isRaining: boolean;
    nearbyBlocks: string;
    nearbyEntities: string;
  } | null;
  voyager: {
    isRunning: boolean;
    isPaused: boolean;
    currentTask: string | null;
    completedTasks: string[];
    failedTasks: string[];
    internalState?: string;
    queuedTaskCount?: number;
  } | null;
  armor?: BotArmor;
  offhand?: EquipmentSlot | null;
  hotbar?: (EquipmentSlot & { slot: number } | null)[];
  experience?: BotExperience;
  stats?: BotStatsData;
  combat?: BotCombat;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp?: number;
}

export interface BotEvent {
  type: string;
  botName: string;
  description: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface WorldState {
  timeOfDay: string | null;
  timeOfDayTicks: number | null;
  day: number | null;
  isRaining: boolean | null;
  onlineBots: number;
  onlinePlayers?: number;
}

export interface PlayerInfo {
  name: string;
  position: { x: number; y: number; z: number } | null;
  isOnline: boolean;
}

export interface TerrainData {
  cx: number;
  cz: number;
  radius: number;
  step: number;
  size: number;
  blocks: string[];
}

// Control platform types
export interface SquadRecord {
  id: string;
  name: string;
  botNames: string[];
  defaultRole?: string;
  activeMissionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RoleAssignmentRecord {
  id: string;
  botName: string;
  role: string;
  autonomyLevel: 'manual' | 'assisted' | 'autonomous';
  homeMarkerId?: string;
  allowedZoneIds?: string[];
  interruptPolicy?: string;
  preferredMissionTypes?: string[];
  loadoutPolicy?: Record<string, unknown>;
  createdAt: string;
}

export interface RoleOverrideRecord {
  botName: string;
  reason: string;
  at: number;
}

export interface RoleApprovalRecord {
  id: string;
  botName: string;
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  missionDraft: { title: string; description: string };
  expiresAt: number;
}

export interface CommandRecord {
  id: string;
  type: string;
  botName: string;
  params: Record<string, unknown>;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface MissionRecord {
  id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  assigneeIds: string[];
  blockedReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Marker {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  x: number;
  y: number;
  z: number;
  type?: string;
  color?: string;
  metadata?: Record<string, any>;
}

export interface Zone {
  id: string;
  name: string;
  type: string;
  bounds: Record<string, any>;
  x1?: number;
  z1?: number;
  x2?: number;
  z2?: number;
  color?: string;
  metadata?: Record<string, any>;
}

export interface Route {
  id: string;
  name: string;
  waypoints: { x: number; y: number; z: number }[];
  loop?: boolean;
  color?: string;
  metadata?: Record<string, any>;
}

export type MarkerRecord = Marker;
export type ZoneRecord = Zone;
export type RouteRecord = Route;

export interface SchematicInfo {
  filename: string;
  size: { x: number; y: number; z: number };
  blockCount: number;
  palette?: string[];
}

export interface BuildRecord {
  id: string;
  schematicFile: string;
  status: string;
  origin: { x: number; y: number; z: number };
  totalBlocks: number;
  placedBlocks?: number;
  assignments?: { botName: string; status: string; blocksPlaced?: number; blocksTotal?: number; yMin?: number; yMax?: number; currentY?: number }[];
  metadata?: Record<string, any>;
}

export type CampaignStructureStatus = 'pending' | 'building' | 'completed' | 'failed' | 'cancelled';
export type CampaignStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface CampaignStructure {
  id: string;
  schematicFile: string;
  origin: { x: number; y: number; z: number };
  botCountHint?: number;
  buildJobId?: string;
  status: CampaignStructureStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface Campaign {
  id: string;
  name: string;
  structures: CampaignStructure[];
  status: CampaignStatus;
  createdAt: number;
  updatedAt: number;
  maxParallel?: number;
  autoSpawn?: boolean;
  spawnPersonality?: string;
  cleanupBots?: boolean;
  spawnedBotNames?: string[];
}

export interface CampaignCreateInput {
  name: string;
  structures: Array<{
    schematicFile: string;
    origin: { x: number; y: number; z: number };
    botCountHint?: number;
  }>;
  maxParallel?: number;
  autoSpawn?: boolean;
  spawnPersonality?: string;
  cleanupBots?: boolean;
  start?: boolean;
}

export interface Routine {
  id: string;
  name: string;
  description?: string;
  steps: RoutineStep[];
  createdAt?: string;
  updatedAt?: string;
}

export interface RoutineStep {
  type: string;
  command?: string;
  params?: Record<string, any>;
  data?: Record<string, any>;
}

export interface RoutineExecution {
  id: string;
  routineId: string;
  routineName: string;
  status: string;
  stepsCompleted: number;
  error?: string;
}

export interface RoutineDraft {
  name: string;
  steps: RoutineStep[];
}

export interface CommanderPlan {
  id: string;
  input: string;
  intent: string;
  parsedIntent?: string;
  confidence: number;
  warnings: string[];
  requiresConfirmation: boolean;
  commands: any[];
  missions: any[];
  clarificationQuestions: (string | ClarificationQuestion)[];
  needsClarification: boolean;
  suggestedCommands: any[];
  createdAt: string;
}

export interface ClarificationQuestion {
  question: string;
  options?: string[];
}

export interface CommanderResult {
  success: boolean;
  commandResults?: { id: string; status: string; error?: string }[];
  missionResults?: { id: string; status: string; error?: string }[];
  message?: string;
}

export interface CommanderDraft {
  id: string;
  input: string;
  plan?: CommanderPlan;
  createdAt?: string;
  updatedAt?: string;
}

export interface SupplyChain {
  id: string;
  name: string;
  description?: string;
  status: string;
  loop?: boolean;
  stages: ChainStage[];
  currentStageIndex?: number;
  metadata?: Record<string, any>;
  createdAt?: number;
  updatedAt?: number;
}

export interface ChainTemplate {
  id: string;
  name: string;
  description?: string;
  stages: Omit<ChainStage, 'status'>[];
}

export interface ChainStage {
  botName: string;
  task: string;
  status?: string;
  inputChest?: { x: number; y: number; z: number; label?: string };
  outputChest?: { x: number; y: number; z: number; label?: string };
  inputItems?: { item: string; count: number }[];
  outputItems?: { item: string; count: number }[];
}

export interface MetricsData {
  uptime: number;
  botCount: number;
  activeBots: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  avgTaskTime?: number;
  tasksByBot?: Record<string, number>;
  eventCounts?: Record<string, number>;
  memoryUsage?: Record<string, number>;
  [key: string]: any;
}

// API functions
export const api = {
  // Bots
  getBots: () => fetchJSON<{ bots: BotStatus[] }>('/api/bots'),
  getBotDetailed: (name: string) => fetchJSON<{ bot: BotDetailed }>(`/api/bots/${name}/detailed`),
  getBotRelationships: (name: string) => fetchJSON<{ relationships: Record<string, number> }>(`/api/bots/${name}/relationships`),
  getBotConversations: (name: string) => fetchJSON<{ conversations: Record<string, ChatMessage[]> }>(`/api/bots/${name}/conversations`),
  getBotTasks: (name: string) => fetchJSON<{ currentTask: string | null; completedTasks: string[]; failedTasks: string[] }>(`/api/bots/${name}/tasks`),

  // Create / delete
  createBot: (name: string, personality: string, mode?: string) =>
    fetchJSON<{ success: boolean; bot: BotStatus }>('/api/bots', {
      method: 'POST',
      body: JSON.stringify({ name, personality, mode }),
    }),
  deleteBot: (name: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${name}`, { method: 'DELETE' }),
  setMode: (name: string, mode: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${name}/mode`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  // Players
  getPlayers: () => fetchJSON<{ players: PlayerInfo[] }>('/api/players').catch(() => ({ players: [] })),

  // Terrain
  getTerrain: (cx: number, cz: number, radius = 64, step = 1) =>
    fetchJSON<TerrainData>(`/api/terrain?cx=${cx}&cz=${cz}&radius=${radius}&step=${step}`),

  // Global
  getRelationships: () => fetchJSON<{ relationships: Record<string, Record<string, number>> }>('/api/relationships'),
  getSkills: () => fetchJSON<{ skills: { name: string; code: string | null }[]; count: number }>('/api/skills'),
  getSkill: (name: string) => fetchJSON<{ name: string; code: string }>(`/api/skills/${name}`),
  getWorld: () => fetchJSON<WorldState>('/api/world'),
  getActivity: (limit = 50, bot?: string, type?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (bot) params.set('bot', bot);
    if (type) params.set('type', type);
    return fetchJSON<{ events: BotEvent[] }>(`/api/activity?${params}`);
  },

  // Actions
  sendChat: (botName: string, playerName: string, message: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/chat`, {
      method: 'POST',
      body: JSON.stringify({ playerName, message }),
    }),
  queueTask: (botName: string, description: string, prepend?: boolean) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/task`, {
      method: 'POST',
      body: JSON.stringify({ description, prepend }),
    }),

  // Bot commands
  pauseBot: (botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/pause`, { method: 'POST' }),
  resumeBot: (botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/resume`, { method: 'POST' }),
  followPlayer: (botName: string, playerName: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/follow`, {
      method: 'POST',
      body: JSON.stringify({ playerName }),
    }),
  stopBot: (botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/stop`, { method: 'POST' }),
  walkTo: (botName: string, x: number, y: number | null, z: number) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/walkto`, {
      method: 'POST',
      body: JSON.stringify({ x, y, z }),
    }),

  // Markers
  getMarkers: () => fetchJSON<{ markers: Marker[] }>('/api/markers'),
  getZones: () => fetchJSON<{ zones: Zone[] }>('/api/zones'),

  // Squads
  getSquads: () => fetchJSON<{ squads: SquadRecord[] }>('/api/squads'),

  // Missions
  getMission: (id: string) => fetchJSON<{ mission: MissionRecord }>(`/api/missions/${id}`),

  // Roles
  getRoleAssignments: () => fetchJSON<{ assignments: RoleAssignmentRecord[] }>('/api/roles/assignments'),
  createRoleAssignment: (data: Partial<RoleAssignmentRecord>) =>
    fetchJSON<{ assignment: RoleAssignmentRecord }>('/api/roles/assignments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRoleAssignment: (id: string, data: Partial<RoleAssignmentRecord>) =>
    fetchJSON<{ assignment: RoleAssignmentRecord }>(`/api/roles/assignments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteRoleAssignment: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/roles/assignments/${id}`, { method: 'DELETE' }),
  approveRoleApproval: (id: string, data?: { decidedBy?: string }) =>
    fetchJSON<{ success: boolean }>(`/api/roles/approvals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    }),
  rejectRoleApproval: (id: string, data?: { decidedBy?: string }) =>
    fetchJSON<{ success: boolean }>(`/api/roles/approvals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    }),
  clearBotOverride: (botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/override`, { method: 'DELETE' }),

  // ─── Commands ───
  getCommands: () =>
    fetchJSON<{ commands: CommandRecord[] }>('/api/commands').catch(() => ({ commands: [] })),
  createCommand: (data: { type: string; botName: string; params?: Record<string, unknown> }) =>
    fetchJSON<{ command: CommandRecord }>('/api/commands', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  cancelCommand: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/commands/${id}/cancel`, { method: 'POST' }),

  // ─── Missions ───
  getMissions: () =>
    fetchJSON<{ missions: MissionRecord[] }>('/api/missions').catch(() => ({ missions: [] })),
  createMission: (...args: [data: Record<string, any>] | [type: string, botName: string, description: string, priority?: number]) => {
    const data = typeof args[0] === 'object' && !Array.isArray(args[0]) && args.length === 1
      ? args[0]
      : { type: args[0], botName: args[1], description: args[2], priority: args[3] };
    return fetchJSON<{ mission: MissionRecord }>('/api/missions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  missionAction: (id: string, action: 'start' | 'pause' | 'resume' | 'cancel' | 'retry') =>
    fetchJSON<{ success: boolean }>(`/api/missions/${id}/${action}`, { method: 'POST' }),
  cancelMission: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/missions/${id}/cancel`, { method: 'POST' }),

  // ─── Markers ───
  createMarker: (data: { name: string; x: number; y: number; z: number; type?: string }) =>
    fetchJSON<{ marker: Marker }>('/api/markers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteMarker: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/markers/${id}`, { method: 'DELETE' }),

  // ─── Zones ───
  createZone: (data: Record<string, any>) =>
    fetchJSON<{ zone: Zone }>('/api/zones', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateZone: (id: string, data: Record<string, any>) =>
    fetchJSON<{ zone: Zone }>(`/api/zones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteZone: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/zones/${id}`, { method: 'DELETE' }),

  // ─── Routes ───
  getRoutes: () =>
    fetchJSON<{ routes: Route[] }>('/api/routes').catch(() => ({ routes: [] })),
  createRoute: (data: { name: string; waypoints: { x: number; y: number; z: number }[]; loop?: boolean }) =>
    fetchJSON<{ route: Route }>('/api/routes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteRoute: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/routes/${id}`, { method: 'DELETE' }),

  // ─── Builds ───
  getSchematics: () =>
    fetchJSON<{ schematics: SchematicInfo[] }>('/api/schematics').catch(() => ({ schematics: [] })),
  getBuilds: () =>
    fetchJSON<{ builds: BuildRecord[] }>('/api/builds').catch(() => ({ builds: [] })),
  startBuild: (
    filename: string,
    origin: { x: number; y: number; z: number },
    botNames: string[],
    cleanupBotNames?: string[],
    options?: { fillFoundation?: boolean; snapToGround?: boolean },
  ) =>
    fetchJSON<{ build: BuildRecord }>('/api/builds', {
      method: 'POST',
      body: JSON.stringify({ filename, origin, botNames, cleanupBotNames, ...options }),
    }),
  cancelBuild: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/builds/${id}/cancel`, { method: 'POST' }),
  pauseBuild: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/builds/${id}/pause`, { method: 'POST' }),
  resumeBuild: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/builds/${id}/resume`, { method: 'POST' }),
  getTerrainHeight: (x: number, z: number) =>
    fetchJSON<{ y: number; block: string }>(`/api/terrain/height?x=${x}&z=${z}`),

  // ─── Campaigns ───
  listCampaigns: () =>
    fetchJSON<{ campaigns: Campaign[] }>('/api/campaigns').catch(() => ({ campaigns: [] as Campaign[] })),
  getCampaign: (id: string) =>
    fetchJSON<{ campaign: Campaign }>(`/api/campaigns/${id}`),
  createCampaign: (input: CampaignCreateInput) =>
    fetchJSON<{ campaign: Campaign }>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  startCampaign: (id: string) =>
    fetchVoid(`/api/campaigns/${id}/start`, { method: 'POST' }),
  pauseCampaign: (id: string) =>
    fetchVoid(`/api/campaigns/${id}/pause`, { method: 'POST' }),
  resumeCampaign: (id: string) =>
    fetchVoid(`/api/campaigns/${id}/resume`, { method: 'POST' }),
  cancelCampaign: (id: string) =>
    fetchVoid(`/api/campaigns/${id}/cancel`, { method: 'POST' }),
  deleteCampaign: (id: string) =>
    fetchVoid(`/api/campaigns/${id}`, { method: 'DELETE' }),

  // ─── Supply Chains ───
  getChains: () =>
    fetchJSON<{ chains: any[] }>('/api/chains').catch(() => ({ chains: [] })),
  getChainTemplates: () =>
    fetchJSON<{ templates: any[] }>('/api/chains/templates').catch(() => ({ templates: [] })),
  createChain: (data: Record<string, any>) =>
    fetchJSON<{ chain: any }>('/api/chains', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  startChain: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/chains/${id}/start`, { method: 'POST' }),
  pauseChain: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/chains/${id}/pause`, { method: 'POST' }),
  cancelChain: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/chains/${id}/cancel`, { method: 'POST' }),
  deleteChain: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/chains/${id}`, { method: 'DELETE' }),

  // ─── Routines ───
  getRoutines: () =>
    fetchJSON<{ routines: Routine[] }>('/api/routines').catch(() => ({ routines: [] })),
  createRoutine: (data: { name: string; steps?: RoutineStep[] }) =>
    fetchJSON<{ routine: Routine }>('/api/routines', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRoutine: (id: string, data: { steps?: RoutineStep[]; name?: string }) =>
    fetchJSON<{ routine: Routine }>(`/api/routines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteRoutine: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/routines/${id}`, { method: 'DELETE' }),
  executeRoutine: (id: string, botNames: string[]) =>
    fetchJSON<{ execution: RoutineExecution }>(`/api/routines/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify({ botNames }),
    }),
  getRecordingStatus: () =>
    fetchJSON<{ recording: boolean; draft: RoutineDraft | null }>('/api/routines/recording').catch(() => ({ recording: false, draft: null })),
  startRecording: (name: string) =>
    fetchJSON<{ draft: RoutineDraft }>('/api/routines/recording/start', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  stopRecording: (save: boolean) =>
    fetchJSON<{ routine: Routine | null }>('/api/routines/recording/stop', {
      method: 'POST',
      body: JSON.stringify({ save }),
    }),

  // ─── Commander ───
  parseCommanderInput: (input: string) =>
    fetchJSON<{ plan: CommanderPlan }>('/api/commander/parse', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),
  clarifyCommanderInput: (input: string, answers: Record<string, string>) =>
    fetchJSON<{ plan: CommanderPlan }>('/api/commander/parse', {
      method: 'POST',
      body: JSON.stringify({ input, clarificationAnswers: answers }),
    }),
  executeCommanderPlan: (planId: string) =>
    fetchJSON<{ result: any }>('/api/commander/execute', {
      method: 'POST',
      body: JSON.stringify({ planId }),
    }),
  getCommanderHistory: (params?: { limit?: number }) =>
    fetchJSON<{ entries?: any[]; history?: any[] }>(`/api/commander/history${params?.limit ? `?limit=${params.limit}` : ''}`).catch(() => ({ entries: [], history: [] })),
  getCommanderDrafts: () =>
    fetchJSON<{ drafts: CommanderDraft[] }>('/api/commander/drafts').catch(() => ({ drafts: [] })),
  saveCommanderDraft: (data: { input: string }) =>
    fetchJSON<{ draft: CommanderDraft }>('/api/commander/drafts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteCommanderDraft: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/commander/drafts/${id}`, { method: 'DELETE' }),
  getCommanderSuggestions: () =>
    fetchJSON<{ suggestions: string[] }>('/api/commander/suggestions').catch(() => ({ suggestions: [] })),

  // ─── Legacy CommanderPanel aliases ───
  commanderParse: (input: string) =>
    fetchJSON<{ plan: any }>('/api/commander/parse', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),
  commanderExecute: (plan: any) =>
    fetchJSON<{ result: any }>('/api/commander/execute', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }),

  // ─── Bot actions ───
  returnToBase: (botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/return-to-base`, { method: 'POST' }),
  unstuck: (botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/unstuck`, { method: 'POST' }),
  equipBest: (botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/equip-best`, { method: 'POST' }),

  // ─── Diagnostics / Metrics / Blackboard ───
  getBotDiagnostics: (botName: string) =>
    fetchJSON<any>(`/api/bots/${botName}/diagnostics`).catch(() => null),
  getMetrics: () =>
    fetchJSON<any>('/api/metrics').catch(() => null),
  getBlackboard: () =>
    fetchJSON<{ blackboard: { messages: any[]; tasks: any[]; goals: any[]; swarmGoal: string | null; reservations: any[] } }>('/api/blackboard').catch(() => ({
      blackboard: { messages: [], tasks: [], goals: [], swarmGoal: null, reservations: [] },
    })),
  sendSwarmDirective: (directive: string) =>
    fetchJSON<{ success: boolean }>('/api/blackboard/swarm-directive', {
      method: 'POST',
      body: JSON.stringify({ directive }),
    }),

  // ─── Bot mission queue ───
  reorderBotMissionQueue: (botName: string, order: string[]) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/mission-queue`, {
      method: 'PATCH',
      body: JSON.stringify({ order }),
    }),
  clearBotMissionQueue: (botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/mission-queue`, {
      method: 'DELETE',
    }),
};
