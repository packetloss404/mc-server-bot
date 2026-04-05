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
  metadata?: Record<string, unknown>;
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

export interface SchematicInfo {
  filename: string;
  size: { x: number; y: number; z: number };
  blockCount: number;
}

export interface BotAssignment {
  botName: string;
  yMin: number;
  yMax: number;
  status: 'waiting' | 'building' | 'completed' | 'failed';
  blocksTotal: number;
  blocksPlaced: number;
  currentY: number;
}

export interface BuildJob {
  id: string;
  schematicFile: string;
  origin: { x: number; y: number; z: number };
  status: 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  createdAt: number;
  totalBlocks: number;
  placedBlocks: number;
  assignments: BotAssignment[];
}

export interface ChestLocation { x: number; y: number; z: number; label: string; }

export interface ChainStage {
  id: string;
  botName: string;
  task: string;
  inputChest?: ChestLocation;
  outputChest?: ChestLocation;
  inputItems?: { item: string; count: number }[];
  outputItems?: { item: string; count: number }[];
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  retries: number;
  error?: string;
}

export interface SupplyChain {
  id: string;
  name: string;
  description?: string;
  stages: ChainStage[];
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  currentStageIndex: number;
  loop: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChainTemplate {
  id: string;
  name: string;
  description: string;
  stages: { task: string; inputItems?: { item: string; count: number }[]; outputItems?: { item: string; count: number }[] }[];
}

// ===================================
//  CONTROL PLATFORM TYPES
// ===================================

export type CommandType =
  | 'pause_voyager' | 'resume_voyager' | 'stop_movement' | 'follow_player'
  | 'walk_to_coords' | 'move_to_marker' | 'return_to_base' | 'regroup'
  | 'guard_zone' | 'patrol_route' | 'deposit_inventory' | 'equip_best' | 'unstuck';

export type CommandStatus = 'queued' | 'started' | 'succeeded' | 'failed' | 'cancelled';
export type MissionStatus = 'draft' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface CommandRecord {
  id: string;
  type: CommandType;
  scope: 'bot' | 'squad' | 'selection';
  targets: string[];
  payload: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  source: string;
  requestedBy?: string;
  status: CommandStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean };
}

type RawCommandRecord = {
  id: string;
  type: CommandType;
  scope: 'single' | 'bot' | 'squad' | 'selection' | 'all';
  targets: string[];
  payload?: Record<string, unknown>;
  params?: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high' | 'urgent' | 'critical';
  source: string;
  requestedBy?: string;
  status: CommandStatus;
  createdAt: number | string;
  startedAt?: number | string;
  completedAt?: number | string;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean };
};

export interface MissionRecord {
  id: string;
  type: string;
  title: string;
  description?: string;
  assigneeType: 'bot' | 'squad';
  assigneeIds: string[];
  status: MissionStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  steps: MissionStep[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  blockedReason?: string;
  linkedCommandIds?: string[];
  source: string;
}

export interface MissionStep {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  error?: string;
}

export type MarkerKind = 'base' | 'storage' | 'build-site' | 'mine' | 'village' | 'custom';

export interface MarkerRecord {
  id: string;
  name: string;
  kind: MarkerKind;
  position: { x: number; y: number; z: number };
  tags: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** Alias kept for backward compatibility */
export type Marker = MarkerRecord;
/** Alias kept for backward compatibility */
export type Zone = ZoneRecord;

export interface ZoneRecord {
  id: string;
  name: string;
  mode: string;
  shape: 'circle' | 'rectangle';
  circle?: { x: number; z: number; radius: number };
  rectangle?: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export interface RouteRecord {
  id: string;
  name: string;
  waypointIds: string[];
  loop: boolean;
}

export interface SquadRecord {
  id: string;
  name: string;
  botNames: string[];
  defaultRole?: string;
  homeMarkerId?: string;
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
  allowedZoneIds: string[];
  preferredMissionTypes: string[];
  interruptPolicy?: 'always' | 'confirm-if-busy' | 'never-while-critical';
  loadoutPolicy?: Record<string, unknown>;
}

export interface RoleOverrideRecord {
  reason: string;
  commandId: string;
  at: number;
}

export interface RoleApprovalRecord {
  id: string;
  assignmentId: string;
  assignmentUpdatedAt: number;
  botName: string;
  role: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: number;
  expiresAt: number;
  decidedAt?: number;
  decidedBy?: string;
  decisionNote?: string;
  missionDraft: {
    type: string;
    title: string;
    description: string;
    assigneeType: 'bot';
    assigneeIds: string[];
    priority: 'normal';
    source: 'role';
  };
}

export interface CommanderPlan {
  id: string;
  input: string;
  parsedIntent: string;
  confidence: number;
  requiresConfirmation: boolean;
  warnings: string[];
  commands: CommandRecord[];
  missions: MissionRecord[];
}

export interface CommanderCommandResult {
  success: boolean;
  command: { id?: string; type: string; targets: string[]; status?: string; source?: string };
  error?: string;
}

export interface CommanderMissionResult {
  id?: string;
  title: string;
  assigneeIds: string[];
  status?: string;
}

export interface CommanderResult {
  success: boolean;
  commandResults: CommanderCommandResult[];
  missionsCreated: CommanderMissionResult[];
}

export interface CommanderHistoryEntry {
  planId: string;
  input: string;
  plan: CommanderPlan;
  result?: CommanderResult;
  status: 'parsed' | 'executed' | 'partial_failure';
  createdAt: string;
  executedAt?: string;
}

function toTimestamp(value?: number | string): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function normalizeCommandScope(scope: RawCommandRecord['scope']): CommandRecord['scope'] {
  if (scope === 'single' || scope === 'all') {
    return 'bot';
  }
  return scope;
}

function normalizeCommandPriority(priority: RawCommandRecord['priority']): CommandRecord['priority'] {
  return priority === 'critical' ? 'urgent' : priority;
}

export function normalizeCommandRecord(command: RawCommandRecord): CommandRecord {
  return {
    id: command.id,
    type: command.type,
    scope: normalizeCommandScope(command.scope),
    targets: command.targets ?? [],
    payload: command.payload ?? command.params ?? {},
    priority: normalizeCommandPriority(command.priority),
    source: command.source,
    requestedBy: command.requestedBy,
    status: command.status,
    createdAt: toTimestamp(command.createdAt) ?? Date.now(),
    startedAt: toTimestamp(command.startedAt),
    completedAt: toTimestamp(command.completedAt),
    result: command.result,
    error: command.error,
  };
}

export function normalizeMissionRecord(mission: MissionRecord): MissionRecord {
  return {
    ...mission,
    createdAt: toTimestamp(mission.createdAt) ?? Date.now(),
    updatedAt: toTimestamp(mission.updatedAt) ?? Date.now(),
    startedAt: toTimestamp(mission.startedAt),
    completedAt: toTimestamp(mission.completedAt),
  };
}

// API functions
export const api = {
  // Bots
  getBots: () => fetchJSON<{ bots: BotStatus[] }>('/api/bots'),
  getBotDetailed: (name: string) => fetchJSON<{ bot: BotDetailed }>(`/api/bots/${name}/detailed`),
  getBotRelationships: (name: string) => fetchJSON<{ relationships: Record<string, number> }>(`/api/bots/${name}/relationships`),
  getBotConversations: (name: string) => fetchJSON<{ conversations: Record<string, ChatMessage[]> }>(`/api/bots/${name}/conversations`),
  getBotTasks: (name: string) => fetchJSON<{
    currentTask: string | null;
    queuedTasks: string[];
    longTermGoal: {
      id: string; requestedBy: string; rawRequest: string; kind: string; status: string;
      buildState: string | null; pendingSubtasks: string[]; completedSubtasks: string[];
      updatedAt: number;
    } | null;
    completedTasks: string[];
    failedTasks: string[];
  }>(`/api/bots/${name}/tasks`),
  getBotMissions: (name: string) => fetchJSON<{ missions: { id: string; title: string; type: string; priority: number; status: string; createdAt: number }[] }>(`/api/bots/${name}/missions`),

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
  getTerrainHeight: (x: number, z: number) =>
    fetchJSON<{ x: number; z: number; y: number; block: string }>(`/api/terrain/height?x=${x}&z=${z}`),

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
  queueTask: (botName: string, description: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/task`, {
      method: 'POST',
      body: JSON.stringify({ description }),
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

  // Schematics & Builds
  getSchematics: () => fetchJSON<{ schematics: SchematicInfo[] }>('/api/schematics'),
  getSchematic: (filename: string) => fetchJSON<{ schematic: SchematicInfo }>(`/api/schematics/${encodeURIComponent(filename)}`),
  getBuilds: () => fetchJSON<{ builds: BuildJob[] }>('/api/builds'),
  getBuild: (id: string) => fetchJSON<{ build: BuildJob }>(`/api/builds/${id}`),
  startBuild: (schematicFile: string, origin: { x: number; y: number; z: number }, botNames: string[], cleanupBotNames?: string[], options?: { fillFoundation?: boolean; snapToGround?: boolean }) =>
    fetchJSON<{ success: boolean; build: BuildJob }>('/api/builds', {
      method: 'POST',
      body: JSON.stringify({ schematicFile, origin, botNames, cleanupBotNames, ...options }),
    }),
  cancelBuild: (id: string) => fetchJSON<{ success: boolean }>(`/api/builds/${id}/cancel`, { method: 'POST' }),
  pauseBuild: (id: string) => fetchJSON<{ success: boolean }>(`/api/builds/${id}/pause`, { method: 'POST' }),
  resumeBuild: (id: string) => fetchJSON<{ success: boolean }>(`/api/builds/${id}/resume`, { method: 'POST' }),

  // Supply Chains
  getChainTemplates: () => fetchJSON<{ templates: ChainTemplate[] }>('/api/chain-templates'),
  getChains: () => fetchJSON<{ chains: SupplyChain[] }>('/api/chains'),
  getChain: (id: string) => fetchJSON<{ chain: SupplyChain }>(`/api/chains/${id}`),
  createChain: (data: Record<string, unknown>) => fetchJSON<{ success: boolean; chain: SupplyChain }>('/api/chains', { method: 'POST', body: JSON.stringify(data) }),
  deleteChain: (id: string) => fetchJSON<{ success: boolean }>(`/api/chains/${id}`, { method: 'DELETE' }),
  startChain: (id: string) => fetchJSON<{ success: boolean }>(`/api/chains/${id}/start`, { method: 'POST' }),
  pauseChain: (id: string) => fetchJSON<{ success: boolean }>(`/api/chains/${id}/pause`, { method: 'POST' }),
  cancelChain: (id: string) => fetchJSON<{ success: boolean }>(`/api/chains/${id}/cancel`, { method: 'POST' }),

  // ===================================
  //  CONTROL PLATFORM
  // ===================================

  // Commands
  createCommand: async (data: { type: CommandType; scope: 'bot' | 'squad' | 'selection'; targets: string[]; payload?: Record<string, unknown>; priority?: string; source?: string }) => {
    const scope = data.scope === 'bot' ? 'single' : data.scope;
    const priority = data.priority === 'urgent' ? 'critical' : data.priority;
    const result = await fetchJSON<{ command: RawCommandRecord }>('/api/commands', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        scope,
        priority,
        params: data.payload ?? {},
      }),
    });
    return { command: normalizeCommandRecord(result.command) };
  },
  getCommands: (params?: { bot?: string; status?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.bot) query.set('bot', params.bot);
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return fetchJSON<{ commands: RawCommandRecord[] }>(`/api/commands${qs ? '?' + qs : ''}`)
      .then((result) => ({ commands: result.commands.map(normalizeCommandRecord) }));
  },
  getCommand: (id: string) => fetchJSON<{ command: RawCommandRecord }>(`/api/commands/${id}`)
    .then((result) => ({ command: normalizeCommandRecord(result.command) })),
  cancelCommand: (id: string) => fetchJSON<{ command: RawCommandRecord }>(`/api/commands/${id}/cancel`, { method: 'POST' })
    .then((result) => ({ command: normalizeCommandRecord(result.command) })),

  // Missions
  createMission: (data: { type: string; title: string; description?: string; assigneeType: 'bot' | 'squad'; assigneeIds: string[]; priority?: string; steps?: Array<Record<string, unknown>>; source?: string }) =>
    fetchJSON<{ mission: MissionRecord }>('/api/missions', { method: 'POST', body: JSON.stringify(data) }),
  getMissions: (params?: { bot?: string; squad?: string; status?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.bot) query.set('bot', params.bot);
    if (params?.squad) query.set('squad', params.squad);
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return fetchJSON<{ missions: MissionRecord[] }>(`/api/missions${qs ? '?' + qs : ''}`)
      .then((result) => ({ missions: result.missions.map(normalizeMissionRecord) }));
  },
  getMission: (id: string) => fetchJSON<{ mission: MissionRecord }>(`/api/missions/${id}`)
    .then((result) => ({ mission: normalizeMissionRecord(result.mission) })),
  pauseMission: (id: string) => fetchJSON<{ mission: MissionRecord }>(`/api/missions/${id}/pause`, { method: 'POST' })
    .then((result) => ({ mission: normalizeMissionRecord(result.mission) })),
  resumeMission: (id: string) => fetchJSON<{ mission: MissionRecord }>(`/api/missions/${id}/resume`, { method: 'POST' })
    .then((result) => ({ mission: normalizeMissionRecord(result.mission) })),
  cancelMission: (id: string) => fetchJSON<{ mission: MissionRecord }>(`/api/missions/${id}/cancel`, { method: 'POST' })
    .then((result) => ({ mission: normalizeMissionRecord(result.mission) })),
  retryMission: (id: string) => fetchJSON<{ mission: MissionRecord }>(`/api/missions/${id}/retry`, { method: 'POST' })
    .then((result) => ({ mission: normalizeMissionRecord(result.mission) })),
  getBotMissionQueue: (botName: string) =>
    fetchJSON<{ missions: MissionRecord[]; voyagerTasks?: unknown[] }>(`/api/bots/${botName}/mission-queue`)
      .then((result) => ({ ...result, missions: result.missions.map(normalizeMissionRecord) })),
  updateBotMissionQueue: (botName: string, data: { action: string; missionId?: string; fromIndex?: number; toIndex?: number }) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/mission-queue`, { method: 'PATCH', body: JSON.stringify(data) }),

  // World Planning - Markers
  getMarkers: () => fetchJSON<{ markers: MarkerRecord[] }>('/api/markers'),
  createMarker: (data: Partial<MarkerRecord>) =>
    fetchJSON<{ marker: MarkerRecord }>('/api/markers', { method: 'POST', body: JSON.stringify(data) }),
  updateMarker: (id: string, data: Partial<MarkerRecord>) =>
    fetchJSON<{ marker: MarkerRecord }>(`/api/markers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMarker: (id: string) => fetchJSON<{ success: boolean }>(`/api/markers/${id}`, { method: 'DELETE' }),

  // World Planning - Zones
  getZones: () => fetchJSON<{ zones: ZoneRecord[] }>('/api/zones'),
  createZone: (data: Partial<ZoneRecord>) =>
    fetchJSON<{ zone: ZoneRecord }>('/api/zones', { method: 'POST', body: JSON.stringify(data) }),
  updateZone: (id: string, data: Partial<ZoneRecord>) =>
    fetchJSON<{ zone: ZoneRecord }>(`/api/zones/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteZone: (id: string) => fetchJSON<{ success: boolean }>(`/api/zones/${id}`, { method: 'DELETE' }),

  // World Planning - Routes
  getRoutes: () => fetchJSON<{ routes: RouteRecord[] }>('/api/routes'),
  createRoute: (data: Partial<RouteRecord>) =>
    fetchJSON<{ route: RouteRecord }>('/api/routes', { method: 'POST', body: JSON.stringify(data) }),
  updateRoute: (id: string, data: Partial<RouteRecord>) =>
    fetchJSON<{ route: RouteRecord }>(`/api/routes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRoute: (id: string) => fetchJSON<{ success: boolean }>(`/api/routes/${id}`, { method: 'DELETE' }),

  // Squads
  getSquads: () => fetchJSON<{ squads: SquadRecord[] }>('/api/squads'),
  createSquad: (data: Partial<SquadRecord>) =>
    fetchJSON<{ squad: SquadRecord }>('/api/squads', { method: 'POST', body: JSON.stringify(data) }),
  getSquad: (id: string) => fetchJSON<{ squad: SquadRecord }>(`/api/squads/${id}`),
  updateSquad: (id: string, data: Partial<SquadRecord>) =>
    fetchJSON<{ squad: SquadRecord }>(`/api/squads/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSquad: (id: string) => fetchJSON<{ success: boolean }>(`/api/squads/${id}`, { method: 'DELETE' }),
  addSquadMember: (id: string, botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/squads/${id}/members`, { method: 'POST', body: JSON.stringify({ botName }) }),
  removeSquadMember: (id: string, botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/squads/${id}/members/${encodeURIComponent(botName)}`, { method: 'DELETE' }),
  sendSquadCommand: (id: string, data: Record<string, unknown>) =>
    fetchJSON<{ command: CommandRecord }>(`/api/squads/${id}/commands`, { method: 'POST', body: JSON.stringify(data) }),
  sendSquadMission: (id: string, data: Record<string, unknown>) =>
    fetchJSON<{ mission: MissionRecord }>(`/api/squads/${id}/missions`, { method: 'POST', body: JSON.stringify(data) }),

  // Roles
  getRoleAssignments: () => fetchJSON<{ assignments: RoleAssignmentRecord[]; overrides?: Record<string, RoleOverrideRecord>; approvalRequests?: RoleApprovalRecord[] }>('/api/roles'),
  createRoleAssignment: (data: Partial<RoleAssignmentRecord>) =>
    fetchJSON<{ assignment: RoleAssignmentRecord }>('/api/roles/assignments', { method: 'POST', body: JSON.stringify(data) }),
  updateRoleAssignment: (id: string, data: Partial<RoleAssignmentRecord>) =>
    fetchJSON<{ assignment: RoleAssignmentRecord }>(`/api/roles/assignments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRoleAssignment: (id: string) => fetchJSON<{ success: boolean }>(`/api/roles/assignments/${id}`, { method: 'DELETE' }),
  clearBotOverride: (botName: string) => fetchJSON<{ success: boolean }>(`/api/bots/${encodeURIComponent(botName)}/override`, { method: 'DELETE' }),
  approveRoleApproval: (id: string, data?: { decidedBy?: string; decisionNote?: string }) =>
    fetchJSON<{ approvalRequest: RoleApprovalRecord; missionId: string }>(`/api/roles/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  rejectRoleApproval: (id: string, data?: { decidedBy?: string; decisionNote?: string }) =>
    fetchJSON<{ approvalRequest: RoleApprovalRecord }>(`/api/roles/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify(data ?? {}) }),

  // Blackboard / Coordination
  getBlackboard: () => fetchJSON<{
    blackboard: {
      swarmGoal: { id: string; rawRequest: string; requestedBy: string; scope: string; status: string; createdAt: number; updatedAt: number } | null;
      goals: { id: string; rawRequest: string; requestedBy: string; scope: string; botName?: string; status: string; createdAt: number; updatedAt: number }[];
      tasks: { id: string; description: string; keywords: string[]; status: string; assignedBot?: string; source: string; goalId?: string; blocker?: string; createdAt: number; updatedAt: number }[];
      messages: { id: string; botName: string; kind: string; text: string; createdAt: number }[];
      reservations: { id: string; type: string; key: string; botName: string; goalId?: string; createdAt: number; expiresAt?: number }[];
    };
  }>('/api/blackboard'),

  sendSwarmDirective: (description: string, requestedBy = 'dashboard') =>
    fetchJSON<{ success: boolean }>('/api/swarm', {
      method: 'POST',
      body: JSON.stringify({ description, requestedBy }),
    }),

  // Commander
  parseCommanderInput: (input: string) =>
    fetchJSON<{ plan: Omit<CommanderPlan, 'parsedIntent'> & { intent?: string; parsedIntent?: string } }>('/api/commander/parse', { method: 'POST', body: JSON.stringify({ input }) })
      .then((result) => ({
        plan: {
          ...result.plan,
          parsedIntent: result.plan.parsedIntent ?? result.plan.intent ?? 'unknown',
        },
      })),
  executeCommanderPlan: (planId: string) =>
    fetchJSON<
      | { commands: CommandRecord[]; missions: MissionRecord[] }
      | CommanderResult
      | { success: boolean; result: CommanderResult }
    >('/api/commander/execute', { method: 'POST', body: JSON.stringify({ planId }) })
      .then((result) => {
        if ('result' in result) {
          return result;
        }
        if ('commands' in result && 'missions' in result) {
          return {
            success: true,
            result: {
              success: true,
              commandResults: result.commands.map((command) => ({
                success: command.status !== 'failed',
                command: {
                  id: command.id,
                  type: command.type,
                  targets: command.targets,
                  status: command.status,
                  source: command.source,
                },
                error: command.error?.message,
              })),
              missionsCreated: result.missions.map((mission) => ({
                id: mission.id,
                title: mission.title,
                assigneeIds: mission.assigneeIds,
                status: mission.status,
              })),
            },
          };
        }
        return { success: true, result };
      }),
  getCommanderHistory: (params?: { limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return fetchJSON<{ entries: Array<Omit<CommanderHistoryEntry, 'plan' | 'result'> & { plan: Omit<CommanderPlan, 'parsedIntent'> & { intent?: string; parsedIntent?: string }; result?: CommanderResult | { success: boolean; result: CommanderResult } | { commands: CommandRecord[]; missions: MissionRecord[] } }> }>(`/api/commander/history${qs ? '?' + qs : ''}`)
      .then((response) => ({
        entries: response.entries.map((entry) => ({
          ...entry,
          plan: {
            ...entry.plan,
            parsedIntent: entry.plan.parsedIntent ?? entry.plan.intent ?? 'unknown',
          },
          result: entry.result
            ? ('result' in entry.result
              ? entry.result.result
              : ('commands' in entry.result && 'missions' in entry.result
                ? {
                    success: true,
                    commandResults: entry.result.commands.map((command) => ({
                      success: command.status !== 'failed',
                      command: { id: command.id, type: command.type, targets: command.targets, status: command.status, source: command.source },
                      error: command.error?.message,
                    })),
                    missionsCreated: entry.result.missions.map((mission) => ({ id: mission.id, title: mission.title, assigneeIds: mission.assigneeIds, status: mission.status })),
                  }
                : entry.result))
            : undefined,
        })),
      }));
  },
};
