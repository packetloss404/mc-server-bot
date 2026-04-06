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

// ═══════════════════════════════════════════════════════════
//  Control platform types — matching backend exactly
// ═══════════════════════════════════════════════════════════

// Command types (matches src/control/CommandTypes.ts)
export type CommandType =
  | 'pause_voyager'
  | 'resume_voyager'
  | 'stop_movement'
  | 'follow_player'
  | 'walk_to_coords'
  | 'move_to_marker'
  | 'return_to_base'
  | 'regroup'
  | 'guard_zone'
  | 'patrol_route'
  | 'deposit_inventory'
  | 'equip_best'
  | 'unstuck';

export type CommandScope = 'single' | 'squad' | 'selection' | 'all';

export type CommandPriority = 'low' | 'normal' | 'high' | 'critical';

export type CommandSource = 'dashboard' | 'api' | 'hotkey' | 'automated' | 'commander';

export type CommandStatus = 'queued' | 'started' | 'succeeded' | 'failed' | 'cancelled';

export interface CommandError {
  code: string;
  message: string;
  botName?: string;
}

export interface CommandRecord {
  id: string;
  type: CommandType;
  scope: CommandScope;
  priority: CommandPriority;
  source: CommandSource;
  status: CommandStatus;
  targets: string[];            // bot names
  params: Record<string, any>;  // type-specific parameters
  createdAt: string;            // ISO timestamp
  startedAt?: string;
  completedAt?: string;
  error?: CommandError;
  result?: Record<string, any>;
  childCommandIds?: string[];   // for fan-out commands
  parentCommandId?: string;
}

// Mission types (matches src/control/MissionTypes.ts)
export type MissionType =
  | 'queue_task'
  | 'gather_items'
  | 'craft_items'
  | 'smelt_batch'
  | 'build_schematic'
  | 'supply_chain'
  | 'patrol_zone'
  | 'escort_player'
  | 'resupply_builder';

export type MissionStatus = 'draft' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type MissionPriority = 'low' | 'normal' | 'high' | 'urgent';

export type MissionSource = 'dashboard' | 'map' | 'role' | 'routine' | 'commander';

export interface MissionStep {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  error?: string;
}

export interface MissionRecord {
  id: string;
  type: MissionType;
  title: string;
  description?: string;
  assigneeType: 'bot' | 'squad';
  assigneeIds: string[];
  status: MissionStatus;
  priority: MissionPriority;
  steps: MissionStep[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  blockedReason?: string;
  linkedCommandIds?: string[];
  source: MissionSource;
}

// World types (matches src/control/WorldTypes.ts)
export interface MarkerRecord {
  id: string;
  name: string;
  kind: 'base' | 'storage' | 'build-site' | 'mine' | 'village' | 'custom';
  position: { x: number; y: number; z: number };
  tags: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ZoneRecord {
  id: string;
  name: string;
  mode: 'guard' | 'avoid' | 'farm' | 'build' | 'gather' | 'custom';
  shape: 'circle' | 'rectangle';
  circle?: { x: number; z: number; radius: number };
  rectangle?: { minX: number; minZ: number; maxX: number; maxZ: number };
  markerIds?: string[];
  rules?: Record<string, unknown>;
}

export interface RouteRecord {
  id: string;
  name: string;
  waypointIds: string[];
  loop: boolean;
}

// Fleet types (matches src/control/FleetTypes.ts)
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

export type RoleType = 'guard' | 'builder' | 'hauler' | 'farmer' | 'miner' | 'scout' | 'merchant' | 'free-agent';

export type AutonomyLevel = 'manual' | 'assisted' | 'autonomous';

export type InterruptPolicy = 'always' | 'confirm-if-busy' | 'never-while-critical';

export type RoleApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface RoleApprovalRecord {
  id: string;
  assignmentId: string;
  assignmentUpdatedAt: number;
  botName: string;
  role: RoleType;
  status: RoleApprovalStatus;
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

export interface RoleAssignmentRecord {
  id: string;
  botName: string;
  role: RoleType;
  autonomyLevel: AutonomyLevel;
  homeMarkerId?: string;
  allowedZoneIds: string[];
  preferredMissionTypes: string[];
  loadoutPolicy?: Record<string, unknown>;
  interruptPolicy?: InterruptPolicy;
  updatedAt: number;
}

export interface RoleOverrideRecord {
  botName: string;
  reason?: string;
  expiresAt?: number;
}

// Commander plan types (matches src/control/CommandTypes.ts)
export interface CommanderPlanCommand {
  type: CommandType;
  targets: string[];
  payload: Record<string, any>;
}

export interface CommanderPlanMission {
  type: string;
  title: string;
  description?: string;
  assigneeIds: string[];
}

export interface CommanderPlan {
  id: string;
  input: string;
  intent: string;
  confidence: number;
  warnings: string[];
  requiresConfirmation: boolean;
  commands: CommanderPlanCommand[];
  missions: CommanderPlanMission[];
  clarificationQuestions: { id: string; question: string; options: string[]; field: string }[];
  needsClarification: boolean;
  suggestedCommands: string[];
  createdAt: string;
}

// Build & Supply Chain types
export interface BuildJob {
  id: string;
  name?: string;
  status: 'started' | 'in-progress' | 'completed' | 'cancelled';
  progress?: number;
  botName?: string;
  metadata?: Record<string, any>;
}

export interface SupplyChain {
  id: string;
  name?: string;
  status: 'started' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  currentStage?: string;
  metadata?: Record<string, any>;
}

export interface SchematicInfo {
  filename: string;
  size: { x: number; y: number; z: number };
  blockCount: number;
}

export interface Routine {
  id: string;
  name: string;
  description?: string;
  steps: RoutineStep[];
  createdAt: string;
  updatedAt: string;
}

export interface RoutineStep {
  type: 'command' | 'mission';
  data: Record<string, any>;
}

// Map overlay types
export interface MapOverlayMission {
  id: string;
  title: string;
  status: MissionStatus;
  assigneeIds: string[];
}

export interface MapOverlayZone {
  id: string;
  name: string;
  mode: string;
  shape: 'circle' | 'rectangle';
  circle?: { x: number; z: number; radius: number };
  rectangle?: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export interface MapOverlaySquad {
  id: string;
  name: string;
  botNames: string[];
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

  // Commands
  getCommands: () => fetchJSON<{ commands: CommandRecord[] }>('/api/commands'),
  createCommand: (data: { type: CommandType; scope?: CommandScope; targets: string[]; params?: Record<string, unknown>; priority?: CommandPriority; source?: CommandSource }) =>
    fetchJSON<{ command: CommandRecord }>('/api/commands', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getCommand: (id: string) => fetchJSON<{ command: CommandRecord }>(`/api/commands/${id}`),
  cancelCommand: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/commands/${id}/cancel`, { method: 'POST' }),

  // Missions
  getMissions: () => fetchJSON<{ missions: MissionRecord[] }>('/api/missions'),
  createMission: (data: { type: MissionType; title: string; description?: string; assigneeType?: 'bot' | 'squad'; assigneeIds: string[]; priority?: MissionPriority; source?: MissionSource }) =>
    fetchJSON<{ mission: MissionRecord }>('/api/missions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getMission: (id: string) => fetchJSON<{ mission: MissionRecord }>(`/api/missions/${id}`),
  missionAction: (id: string, action: 'start' | 'pause' | 'resume' | 'cancel' | 'retry') =>
    fetchJSON<{ success: boolean }>(`/api/missions/${id}/${action}`, { method: 'POST' }),
  cancelMission: (id: string) =>
    fetchJSON<any>(`/api/missions/${id}/cancel`, { method: 'POST' }),
  retryMission: (id: string) =>
    fetchJSON<any>(`/api/missions/${id}/retry`, { method: 'POST' }),

  // Markers
  getMarkers: () => fetchJSON<{ markers: MarkerRecord[] }>('/api/markers'),
  createMarker: (data: Omit<MarkerRecord, 'id' | 'createdAt' | 'updatedAt'>) =>
    fetchJSON<{ marker: MarkerRecord }>('/api/markers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateMarker: (id: string, data: Partial<MarkerRecord>) =>
    fetchJSON<{ marker: MarkerRecord }>(`/api/markers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteMarker: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/markers/${id}`, { method: 'DELETE' }),

  // Zones
  getZones: () => fetchJSON<{ zones: ZoneRecord[] }>('/api/zones'),
  createZone: (data: Omit<ZoneRecord, 'id'>) =>
    fetchJSON<{ zone: ZoneRecord }>('/api/zones', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateZone: (id: string, data: Partial<ZoneRecord>) =>
    fetchJSON<{ zone: ZoneRecord }>(`/api/zones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteZone: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/zones/${id}`, { method: 'DELETE' }),

  // Routes
  getRoutes: () => fetchJSON<{ routes: RouteRecord[] }>('/api/routes'),
  createRoute: (data: Omit<RouteRecord, 'id'>) =>
    fetchJSON<{ route: RouteRecord }>('/api/routes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRoute: (id: string, data: Partial<RouteRecord>) =>
    fetchJSON<{ route: RouteRecord }>(`/api/routes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteRoute: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/routes/${id}`, { method: 'DELETE' }),

  // Squads
  getSquads: () => fetchJSON<{ squads: SquadRecord[] }>('/api/squads'),
  createSquad: (data: { name: string; botNames: string[] }) =>
    fetchJSON<{ squad: SquadRecord }>('/api/squads', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateSquad: (id: string, data: Partial<SquadRecord>) =>
    fetchJSON<{ squad: SquadRecord }>(`/api/squads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteSquad: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/squads/${id}`, { method: 'DELETE' }),
  addBotToSquad: (squadId: string, botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/squads/${squadId}/members`, {
      method: 'POST',
      body: JSON.stringify({ botName }),
    }),
  removeBotFromSquad: (squadId: string, botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/squads/${squadId}/members/${botName}`, { method: 'DELETE' }),

  // Roles
  getRoleAssignments: () => fetchJSON<{ assignments: RoleAssignmentRecord[] }>('/api/roles/assignments'),
  createRoleAssignment: (data: any) =>
    fetchJSON<any>('/api/roles/assignments', { method: 'POST', body: JSON.stringify(data) }),
  updateRoleAssignment: (id: string, data: any) =>
    fetchJSON<any>(`/api/roles/assignments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRoleAssignment: (id: string) =>
    fetchJSON<any>(`/api/roles/assignments/${id}`, { method: 'DELETE' }),
  getBotOverride: (botName: string) =>
    fetchJSON<any>(`/api/bots/${botName}/override`),
  clearBotOverride: (botName: string) =>
    fetchJSON<any>(`/api/bots/${botName}/override`, { method: 'DELETE' }),
  approveRoleApproval: (id: string) =>
    fetchJSON<any>(`/api/roles/approvals/${id}/approve`, { method: 'POST' }),
  rejectRoleApproval: (id: string) =>
    fetchJSON<any>(`/api/roles/approvals/${id}/reject`, { method: 'POST' }),

  // Commander
  parseCommanderInput: (input: string) =>
    fetchJSON<{ plan: CommanderPlan }>('/api/commander/parse', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),
  executeCommanderPlan: (planId: string) =>
    fetchJSON<any>('/api/commander/execute', {
      method: 'POST',
      body: JSON.stringify({ planId }),
    }),

  // Build endpoints
  getSchematics: () => fetchJSON<{ schematics: SchematicInfo[] }>('/api/schematics').catch(() => ({ schematics: [] })),
  getBuilds: () => fetchJSON<{ builds: any[] }>('/api/builds').catch(() => ({ builds: [] })),
  startBuild: (filename: string, origin: { x: number; y: number; z: number }, botNames: string[], cleanupBotNames?: string[], options?: Record<string, any>) =>
    fetchJSON<any>('/api/builds', {
      method: 'POST',
      body: JSON.stringify({ filename, origin, botNames, cleanupBotNames, options }),
    }),
  cancelBuild: (id: string) =>
    fetchJSON<any>(`/api/builds/${id}/cancel`, { method: 'POST' }),
  pauseBuild: (id: string) =>
    fetchJSON<any>(`/api/builds/${id}/pause`, { method: 'POST' }),
  resumeBuild: (id: string) =>
    fetchJSON<any>(`/api/builds/${id}/resume`, { method: 'POST' }),
  getTerrainHeight: (x: number, z: number) =>
    fetchJSON<{ height: number }>(`/api/terrain/height?x=${x}&z=${z}`).catch(() => ({ height: 64 })),

  // Supply chain endpoints
  getChains: () => fetchJSON<{ chains: any[] }>('/api/chains').catch(() => ({ chains: [] })),
  createChain: (data: any) =>
    fetchJSON<any>('/api/chains', { method: 'POST', body: JSON.stringify(data) }),
  startChain: (id: string) =>
    fetchJSON<any>(`/api/chains/${id}/start`, { method: 'POST' }),
  pauseChain: (id: string) =>
    fetchJSON<any>(`/api/chains/${id}/pause`, { method: 'POST' }),
  cancelChain: (id: string) =>
    fetchJSON<any>(`/api/chains/${id}/cancel`, { method: 'POST' }),
  deleteChain: (id: string) =>
    fetchJSON<any>(`/api/chains/${id}`, { method: 'DELETE' }),

  // Bot action helpers
  returnToBase: (botName: string) =>
    fetchJSON<any>(`/api/bots/${botName}/return-to-base`, { method: 'POST' }),
  unstuck: (botName: string) =>
    fetchJSON<any>(`/api/bots/${botName}/unstuck`, { method: 'POST' }),
  equipBest: (botName: string) =>
    fetchJSON<any>(`/api/bots/${botName}/equip-best`, { method: 'POST' }),

  // Routines
  getRoutines: () => fetchJSON<{ routines: Routine[] }>('/api/routines').catch(() => ({ routines: [] })),
  getRoutine: (id: string) => fetchJSON<any>(`/api/routines/${id}`),
  createRoutine: (data: any) =>
    fetchJSON<any>('/api/routines', { method: 'POST', body: JSON.stringify(data) }),
  updateRoutine: (id: string, data: any) =>
    fetchJSON<any>(`/api/routines/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoutine: (id: string) =>
    fetchJSON<any>(`/api/routines/${id}`, { method: 'DELETE' }),
  executeRoutine: (id: string, botNames: string[]) =>
    fetchJSON<any>(`/api/routines/${id}/execute`, { method: 'POST', body: JSON.stringify({ botNames }) }),

  // Mission queue
  reorderBotMissionQueue: (botName: string, order: string[]) =>
    fetchJSON<any>(`/api/bots/${botName}/mission-queue`, { method: 'PUT', body: JSON.stringify({ order }) }),
  clearBotMissionQueue: (botName: string) =>
    fetchJSON<any>(`/api/bots/${botName}/mission-queue`, { method: 'DELETE' }),

  // Diagnostics
  getBotDiagnostics: (botName: string) =>
    fetchJSON<any>(`/api/bots/${botName}/diagnostics`).catch(() => ({ checks: [], actions: [], overallStatus: 'unknown' })),

  // Metrics
  getMetrics: () => fetchJSON<any>('/api/metrics').catch(() => ({})),

  // Blackboard
  getBlackboard: () => fetchJSON<any>('/api/blackboard').catch(() => ({ state: {} })),

  // Swarm
  sendSwarmDirective: (description: string, requestedBy: string) =>
    fetchJSON<any>('/api/swarm', { method: 'POST', body: JSON.stringify({ description, requestedBy }) }),
};
