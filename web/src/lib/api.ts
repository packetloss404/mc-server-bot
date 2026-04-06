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

// Control platform types
export interface Command {
  id: string;
  type: string;
  botName: string;
  params: Record<string, unknown>;
  status: 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
}

export interface Mission {
  id: string;
  type: string;
  botName: string;
  description: string;
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  createdAt: number;
  updatedAt: number;
  progress?: number;
  result?: string;
  error?: string;
}

export interface Marker {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  icon?: string;
  color?: string;
  notes?: string;
  createdAt: number;
}

export interface Zone {
  id: string;
  name: string;
  type: 'guard' | 'build' | 'farm' | 'mine' | 'restricted' | 'custom';
  shape: 'rect' | 'circle';
  center: { x: number; z: number };
  radius?: number;
  width?: number;
  height?: number;
  color?: string;
  notes?: string;
  createdAt: number;
}

export interface Route {
  id: string;
  name: string;
  waypoints: { x: number; y: number; z: number }[];
  loop: boolean;
  notes?: string;
  createdAt: number;
}

export interface CommanderPlan {
  intent: string;
  commands: Array<{ type: string; botName: string; params: Record<string, unknown> }>;
  missions: Array<{ type: string; botName: string; description: string; priority?: number }>;
}

// Aliases for backend record types (used by control platform pages)
export type MarkerRecord = Marker;
export type ZoneRecord = Zone;

export interface SchematicInfo {
  filename: string;
  size: { x: number; y: number; z: number };
  blockCount: number;
}

export interface ChainStage {
  id: string;
  botName: string;
  task: string;
  status: string;
  inputChest?: { x: number; y: number; z: number };
  outputChest?: { x: number; y: number; z: number };
  inputItems?: string[];
  outputItems?: string[];
}

export interface ChainTemplate {
  id: string;
  name: string;
  description?: string;
  stages: ChainStage[];
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

export interface RoleAssignmentRecord {
  id: string;
  botName: string;
  role: string;
  autonomyLevel: string;
  interruptPolicy?: string;
  preferredMissionTypes?: string[];
  loadoutPolicy?: Record<string, unknown>;
  createdAt: string;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  options: string[];
  field?: string;
}

export interface CommanderDraft {
  id: string;
  input: string;
  plan?: CommanderPlan;
  createdAt: string;
}

export interface CommanderResult {
  commands: Array<{ id: string; type: string; status: string }>;
  missions: Array<{ id: string; type: string; status: string }>;
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
}

export interface DiagnosticAction {
  label: string;
  endpoint: string;
  method: string;
  description: string;
}

export interface DiagnosticReport {
  checks: DiagnosticCheck[];
  actions: DiagnosticAction[];
  overallStatus: 'ok' | 'warn' | 'error';
  raw?: Record<string, any>;
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
  getCommands: () => fetchJSON<{ commands: Command[] }>('/api/commands'),
  createCommand: (type: string, botName: string, params: Record<string, unknown>) =>
    fetchJSON<{ command: Command }>('/api/commands', {
      method: 'POST',
      body: JSON.stringify({ type, botName, params }),
    }),
  getCommand: (id: string) => fetchJSON<{ command: Command }>(`/api/commands/${id}`),
  cancelCommand: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/commands/${id}/cancel`, { method: 'POST' }),

  // Missions
  getMissions: () => fetchJSON<{ missions: Mission[] }>('/api/missions'),
  createMission: (type: string, botName: string, description: string, priority?: number) =>
    fetchJSON<{ mission: Mission }>('/api/missions', {
      method: 'POST',
      body: JSON.stringify({ type, botName, description, priority }),
    }),
  getMission: (id: string) => fetchJSON<{ mission: Mission }>(`/api/missions/${id}`),
  missionAction: (id: string, action: 'start' | 'pause' | 'resume' | 'cancel' | 'retry') =>
    fetchJSON<{ success: boolean }>(`/api/missions/${id}/${action}`, { method: 'POST' }),

  // Markers
  getMarkers: () => fetchJSON<{ markers: Marker[] }>('/api/markers'),
  createMarker: (data: Omit<Marker, 'id' | 'createdAt'>) =>
    fetchJSON<{ marker: Marker }>('/api/markers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateMarker: (id: string, data: Partial<Marker>) =>
    fetchJSON<{ marker: Marker }>(`/api/markers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteMarker: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/markers/${id}`, { method: 'DELETE' }),

  // Zones
  getZones: () => fetchJSON<{ zones: Zone[] }>('/api/zones'),
  createZone: (data: Omit<Zone, 'id' | 'createdAt'>) =>
    fetchJSON<{ zone: Zone }>('/api/zones', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateZone: (id: string, data: Partial<Zone>) =>
    fetchJSON<{ zone: Zone }>(`/api/zones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteZone: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/zones/${id}`, { method: 'DELETE' }),

  // Routes
  getRoutes: () => fetchJSON<{ routes: Route[] }>('/api/routes'),
  createRoute: (data: Omit<Route, 'id' | 'createdAt'>) =>
    fetchJSON<{ route: Route }>('/api/routes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRoute: (id: string, data: Partial<Route>) =>
    fetchJSON<{ route: Route }>(`/api/routes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteRoute: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/routes/${id}`, { method: 'DELETE' }),

  // Commander
  commanderParse: (input: string) =>
    fetchJSON<{ plan: CommanderPlan }>('/api/commander/parse', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),
  commanderExecute: (plan: CommanderPlan) =>
    fetchJSON<{ success: boolean; results: unknown[] }>('/api/commander/execute', {
      method: 'POST',
      body: JSON.stringify({ plan }),
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
  getChainTemplates: () => fetchJSON<{ templates: ChainTemplate[] }>('/api/chains/templates').catch(() => ({ templates: [] })),
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

  // Mission helpers
  createMission: (data: any) =>
    fetchJSON<any>('/api/missions', { method: 'POST', body: JSON.stringify(data) }),
  cancelMission: (id: string) =>
    fetchJSON<any>(`/api/missions/${id}/cancel`, { method: 'POST' }),
  retryMission: (id: string) =>
    fetchJSON<any>(`/api/missions/${id}/retry`, { method: 'POST' }),

  // Bot action helpers
  returnToBase: (botName: string) =>
    fetchJSON<any>(`/api/bots/${botName}/return-to-base`, { method: 'POST' }),
  unstuck: (botName: string) =>
    fetchJSON<any>(`/api/bots/${botName}/unstuck`, { method: 'POST' }),
  equipBest: (botName: string) =>
    fetchJSON<any>(`/api/bots/${botName}/equip-best`, { method: 'POST' }),

  // Routines
  getRoutines: () => fetchJSON<{ routines: any[] }>('/api/routines').catch(() => ({ routines: [] })),
  getRoutine: (id: string) => fetchJSON<any>(`/api/routines/${id}`),
  createRoutine: (data: any) =>
    fetchJSON<any>('/api/routines', { method: 'POST', body: JSON.stringify(data) }),
  updateRoutine: (id: string, data: any) =>
    fetchJSON<any>(`/api/routines/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoutine: (id: string) =>
    fetchJSON<any>(`/api/routines/${id}`, { method: 'DELETE' }),
  executeRoutine: (id: string, botNames: string[]) =>
    fetchJSON<any>(`/api/routines/${id}/execute`, { method: 'POST', body: JSON.stringify({ botNames }) }),
  getRecordingStatus: () => fetchJSON<any>('/api/routines/recording/status').catch(() => ({ recording: false })),
  startRecording: (name: string) =>
    fetchJSON<any>('/api/routines/recording/start', { method: 'POST', body: JSON.stringify({ name }) }),
  stopRecording: (save: boolean) =>
    fetchJSON<any>('/api/routines/recording/stop', { method: 'POST', body: JSON.stringify({ save }) }),

  // Commander
  parseCommanderInput: (input: string) =>
    fetchJSON<any>('/api/commander/parse', { method: 'POST', body: JSON.stringify({ input }) }),
  clarifyCommanderInput: (originalInput: string, clarifications: Record<string, string>) =>
    fetchJSON<any>('/api/commander/clarify', { method: 'POST', body: JSON.stringify({ originalInput, clarifications }) }),
  executeCommanderPlan: (planId: string) =>
    fetchJSON<any>('/api/commander/execute', { method: 'POST', body: JSON.stringify({ planId }) }),
  getCommanderHistory: () => fetchJSON<any>('/api/commander/history').catch(() => ({ history: [] })),
  getCommanderDrafts: () => fetchJSON<any>('/api/commander/drafts').catch(() => ({ drafts: [] })),
  saveCommanderDraft: (draft: any) =>
    fetchJSON<any>('/api/commander/drafts', { method: 'POST', body: JSON.stringify(draft) }),
  deleteCommanderDraft: (id: string) =>
    fetchJSON<any>(`/api/commander/drafts/${id}`, { method: 'DELETE' }),
  getCommanderSuggestions: () => fetchJSON<any>('/api/commander/suggestions').catch(() => ({ suggestions: [] })),

  // Roles
  createRoleAssignment: (data: any) =>
    fetchJSON<any>('/api/roles/assignments', { method: 'POST', body: JSON.stringify(data) }),
  updateRoleAssignment: (id: string, data: any) =>
    fetchJSON<any>(`/api/roles/assignments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRoleAssignment: (id: string) =>
    fetchJSON<any>(`/api/roles/assignments/${id}`, { method: 'DELETE' }),
  approveRoleApproval: (id: string) =>
    fetchJSON<any>(`/api/roles/approvals/${id}/approve`, { method: 'POST' }),
  rejectRoleApproval: (id: string) =>
    fetchJSON<any>(`/api/roles/approvals/${id}/reject`, { method: 'POST' }),
  clearBotOverride: (botName: string) =>
    fetchJSON<any>(`/api/bots/${botName}/override`, { method: 'DELETE' }),

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
