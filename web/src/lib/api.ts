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

// Control platform types
export interface Zone {
  id: string;
  name: string;
  type: 'guard' | 'build' | 'farm' | 'mine' | 'custom';
  shape: 'rect' | 'circle';
  center: { x: number; z: number };
  // rect: half-widths; circle: radius
  rx?: number;
  rz?: number;
  radius?: number;
  color?: string;
  assignedBots?: string[];
  activeMission?: string | null;
}

export interface Marker {
  id: string;
  name: string;
  x: number;
  y?: number;
  z: number;
  icon?: string;
  color?: string;
}

export interface Route {
  id: string;
  name: string;
  waypoints: { x: number; y?: number; z: number }[];
  loop?: boolean;
  color?: string;
  assignedBots?: string[];
}

export interface Mission {
  id: string;
  type: string;
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
  botName: string;
  description: string;
  zoneId?: string;
  routeId?: string;
  targetCoords?: { x: number; y?: number; z: number };
  createdAt: number;
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

// ===================================
//  ROUTINE TYPES (agent 2-1)
// ===================================

export interface RoutineStep {
  type: 'command' | 'mission';
  data: Record<string, any>;
}

export interface Routine {
  id: string;
  name: string;
  description: string;
  steps: RoutineStep[];
  createdAt: string;
  updatedAt: string;
}

export interface RoutineExecution {
  routineId: string;
  routineName: string;
  targetBots: string[];
  startedAt: string;
  stepsCompleted: number;
  totalSteps: number;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

// ===================================
//  TEMPLATE TYPES (agent 2-2)
// ===================================

export type FieldType = 'string' | 'number' | 'position' | 'string[]' | 'boolean';

export interface TemplateField {
  name: string;
  label: string;
  type: FieldType;
  description?: string;
  default?: unknown;
  required?: boolean;
  options?: string[];
}

export interface LoadoutPolicy {
  requiredItems?: { name: string; count: number }[];
  optionalItems?: { name: string; count: number }[];
  equipBestArmor?: boolean;
}

export interface MissionTemplate {
  id: string;
  name: string;
  description: string;
  category: 'combat' | 'gathering' | 'crafting' | 'logistics' | 'building';
  missionType: string;
  defaultParams: Record<string, unknown>;
  requiredFields: TemplateField[];
  optionalFields?: TemplateField[];
  suggestedBotCount: number;
  loadoutPolicy?: LoadoutPolicy;
  builtIn: boolean;
}

export interface TemplateExecuteResult {
  success: boolean;
  template: string;
  taskDescription: string;
  loadoutPolicy: LoadoutPolicy | null;
  results: { bot: string; queued: boolean; error?: string }[];
}

// ===================================
//  DIAGNOSTIC TYPES (agent 2-6)
// ===================================

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
}

export interface DiagnosticAction {
  id: string;
  label: string;
  description: string;
  available: boolean;
  endpoint: string;
  method: string;
}

export interface DiagnosticReport {
  botName: string;
  timestamp: number;
  overallStatus: 'ok' | 'warn' | 'error';
  checks: DiagnosticCheck[];
  actions: DiagnosticAction[];
  raw: {
    state: string;
    connected: boolean;
    health: number;
    food: number;
    instinctActive: boolean;
    voyagerRunning: boolean;
    voyagerPaused: boolean;
    currentTask: string | null;
    queuedTaskCount: number;
    recentFailedTasks: string[];
    lastExecution: {
      attempt: number;
      task: string;
      success: boolean;
      timestamp: number;
    } | null;
  };
}

// ===================================
//  COMMANDER CLARIFICATION TYPES (agent 2-9)
// ===================================

export interface ClarificationQuestion {
  id: string;
  question: string;
  options: string[];
  field: string;
}

// ===================================
//  COMMANDER TEMPLATE TYPES (agent 2-10)
// ===================================

export type PlaceholderType = 'bot' | 'zone' | 'item' | 'number' | 'player' | 'position';

export interface TemplatePlaceholder {
  key: string;
  type: PlaceholderType;
  label: string;
  default?: string;
}

export interface CommandTemplate {
  id: string;
  category: 'fleet' | 'combat' | 'gathering' | 'building' | 'exploration' | 'utility';
  name: string;
  description: string;
  template: string;
  placeholders: TemplatePlaceholder[];
  tags: string[];
  icon: string;
}

export interface ContextSuggestion {
  template: CommandTemplate;
  reason: string;
  priority: number;
}

export interface SavedRoutine {
  id: string;
  name: string;
  description: string;
  steps: CommanderRoutineStep[];
  createdAt: number;
  updatedAt: number;
}

export interface CommanderRoutineStep {
  templateId: string;
  values: Record<string, string>;
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

export interface BuildJob {
  id: string;
  schematicFile: string;
  origin: { x: number; y: number; z: number };
  status: 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  createdAt: number;
  totalBlocks: number;
  placedBlocks: number;
  assignments: { botName: string; yMin: number; yMax: number; status: string; blocksTotal: number; blocksPlaced: number; currentY: number }[];
}

export interface SupplyChain {
  id: string;
  name: string;
  description?: string;
  stages: { id: string; botName: string; task: string; status: string }[];
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  currentStageIndex: number;
  loop: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CommanderHistoryEntry {
  id: string;
  nlInput: string;
  parsedIntent: string;
  resultingCommandIds: string[];
  resultingMissionIds: string[];
  createdAt: string;
  botName?: string;
}

// Extended commander plan types (agent 2-9 clarification + agent 2-10 templates)
export interface CommanderPlanCommand {
  type: string;
  targets: string[];
  payload: Record<string, unknown>;
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
  parsedIntent?: string;
  confidence: number;
  warnings: string[];
  requiresConfirmation: boolean;
  commands: CommanderPlanCommand[];
  missions: CommanderPlanMission[];
  clarificationQuestions: ClarificationQuestion[];
  needsClarification: boolean;
  suggestedCommands: string[];
  createdAt: string;
}

export interface CommanderResult {
  commandResults: { command: CommanderPlanCommand; success: boolean; error?: string }[];
  missionsCreated: CommanderPlanMission[];
}

export interface CommanderPlanHistoryEntry {
  planId: string;
  input: string;
  plan: CommanderPlan;
  result?: CommanderResult;
  status: 'parsed' | 'executed' | 'partial_failure' | 'clarification_needed';
  createdAt: string;
  executedAt?: string;
}

export interface CommanderDraft {
  id: string;
  input: string;
  plan?: CommanderPlan;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ZoneCreatePayload = Omit<ZoneRecord, 'id'>;

// API functions
export const api = {
  // Bots
  getBots: () => fetchJSON<{ bots: BotStatus[] }>('/api/bots'),
  getBotDetailed: (name: string) => fetchJSON<{ bot: BotDetailed }>(`/api/bots/${name}/detailed`),
  getBotRelationships: (name: string) => fetchJSON<{ relationships: Record<string, number> }>(`/api/bots/${name}/relationships`),
  getBotConversations: (name: string) => fetchJSON<{ conversations: Record<string, ChatMessage[]> }>(`/api/bots/${name}/conversations`),
  getBotTasks: (name: string) => fetchJSON<{ currentTask: string | null; completedTasks: string[]; failedTasks: string[] }>(`/api/bots/${name}/tasks`),
  getBotDiagnostics: (name: string) => fetchJSON<DiagnosticReport>(`/api/bots/${name}/diagnostics`),

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

  // Commands & Missions (control platform)
  getCommands: (bot?: string) => {
    const params = new URLSearchParams();
    if (bot) params.set('bot', bot);
    const qs = params.toString();
    return fetchJSON<{ commands: CommandRecord[] }>(`/api/commands${qs ? `?${qs}` : ''}`);
  },
  getCommand: (id: string) => fetchJSON<{ command: CommandRecord }>(`/api/commands/${id}`),
  getMissions: (bot?: string) => {
    const params = new URLSearchParams();
    if (bot) params.set('bot', bot);
    const qs = params.toString();
    return fetchJSON<{ missions: MissionRecord[] }>(`/api/missions${qs ? `?${qs}` : ''}`);
  },
  getMission: (id: string) => fetchJSON<{ mission: MissionRecord }>(`/api/missions/${id}`),
  getCommanderHistory: (opts?: { limit?: number }) =>
    fetchJSON<{ entries: CommanderHistoryEntry[] }>(
      `/api/commander/history${opts?.limit ? `?limit=${opts.limit}` : ''}`,
    ),

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
  returnToBase: (botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/return-to-base`, { method: 'POST' }),
  unstuck: (botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/unstuck`, { method: 'POST' }),
  equipBest: (botName: string) =>
    fetchJSON<{ success: boolean }>(`/api/bots/${botName}/equip-best`, { method: 'POST' }),

  // Control platform — zones
  getZones: () => fetchJSON<{ zones: Zone[] }>('/api/zones').catch(() => ({ zones: [] })),
  createZone: (zone: Omit<Zone, 'id'>) =>
    fetchJSON<{ zone: Zone }>('/api/zones', { method: 'POST', body: JSON.stringify(zone) }),
  updateZone: (id: string, patch: Partial<Zone>) =>
    fetchJSON<{ zone: Zone }>(`/api/zones/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteZone: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/zones/${id}`, { method: 'DELETE' }),

  // Control platform — markers
  getMarkers: () => fetchJSON<{ markers: Marker[] }>('/api/markers').catch(() => ({ markers: [] })),
  createMarker: (marker: Omit<Marker, 'id'>) =>
    fetchJSON<{ marker: Marker }>('/api/markers', { method: 'POST', body: JSON.stringify(marker) }),
  deleteMarker: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/markers/${id}`, { method: 'DELETE' }),

  // Control platform — routes
  getRoutes: () => fetchJSON<{ routes: Route[] }>('/api/routes').catch(() => ({ routes: [] })),
  createRoute: (route: Omit<Route, 'id'>) =>
    fetchJSON<{ route: Route }>('/api/routes', { method: 'POST', body: JSON.stringify(route) }),
  deleteRoute: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/routes/${id}`, { method: 'DELETE' }),

  // Control platform — missions (simple)
  getSimpleMissions: () => fetchJSON<{ missions: Mission[] }>('/api/missions').catch(() => ({ missions: [] })),
  createMission: (mission: Omit<Mission, 'id' | 'createdAt'>) =>
    fetchJSON<{ mission: Mission }>('/api/missions', { method: 'POST', body: JSON.stringify(mission) }),

  // Control platform — commands (fleet-level)
  createCommand: (cmd: { type: string; botName?: string; targets?: string[]; params?: Record<string, any> }) =>
    fetchJSON<{ success: boolean; id?: string }>('/api/commands', { method: 'POST', body: JSON.stringify(cmd) }),

  // Routines (macros) — agent 2-1
  getRoutines: () => fetchJSON<{ routines: Routine[] }>('/api/routines'),
  getRoutine: (id: string) => fetchJSON<{ routine: Routine }>(`/api/routines/${id}`),
  createRoutine: (data: { name: string; description?: string; steps?: RoutineStep[] }) =>
    fetchJSON<{ routine: Routine }>('/api/routines', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRoutine: (id: string, data: { name?: string; description?: string; steps?: RoutineStep[] }) =>
    fetchJSON<{ routine: Routine }>(`/api/routines/${id}`, {
      method: 'PUT',
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
    fetchJSON<{ recording: boolean; draft: Routine | null }>('/api/routines/recording/status'),
  startRecording: (name: string) =>
    fetchJSON<{ draft: Routine }>('/api/routines/recording/start', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  stopRecording: (save: boolean) =>
    fetchJSON<{ routine: Routine | null; saved: boolean }>('/api/routines/recording/stop', {
      method: 'POST',
      body: JSON.stringify({ save }),
    }),

  // Mission templates — agent 2-2
  getTemplates: (category?: string) => {
    const params = category ? `?category=${category}` : '';
    return fetchJSON<{ templates: MissionTemplate[] }>(`/api/templates${params}`);
  },
  getTemplate: (id: string) =>
    fetchJSON<{ template: MissionTemplate }>(`/api/templates/${id}`),
  createTemplate: (template: Omit<MissionTemplate, 'builtIn'>) =>
    fetchJSON<{ template: MissionTemplate }>('/api/templates', {
      method: 'POST',
      body: JSON.stringify(template),
    }),
  updateTemplate: (id: string, patch: Partial<MissionTemplate>) =>
    fetchJSON<{ template: MissionTemplate }>(`/api/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteTemplate: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/templates/${id}`, { method: 'DELETE' }),
  executeTemplate: (id: string, params: Record<string, unknown>, assignees: string[], priority?: string) =>
    fetchJSON<TemplateExecuteResult>(`/api/templates/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify({ params, assignees, priority }),
    }),

  // Commander — parse, clarify, execute (agent 2-9)
  parseCommanderInput: (input: string) =>
    fetchJSON<{ plan: CommanderPlan }>('/api/commander/parse', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),
  clarifyCommanderInput: (originalInput: string, clarifications: Record<string, string>) =>
    fetchJSON<{ plan: CommanderPlan }>('/api/commander/clarify', {
      method: 'POST',
      body: JSON.stringify({ originalInput, clarifications }),
    }),
  executeCommanderPlan: (planId: string) =>
    fetchJSON<{ result: CommanderResult }>('/api/commander/execute', {
      method: 'POST',
      body: JSON.stringify({ planId }),
    }),
  getCommanderSuggestions: () =>
    fetchJSON<{ suggestions: string[] | ContextSuggestion[] }>('/api/commander/suggestions'),
  getCommanderDrafts: () =>
    fetchJSON<{ drafts: CommanderDraft[] }>('/api/commander/drafts'),
  saveCommanderDraft: (data: { input: string; plan?: CommanderPlan; notes?: string; id?: string }) =>
    fetchJSON<{ draft: CommanderDraft }>('/api/commander/drafts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteCommanderDraft: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/commander/drafts/${id}`, {
      method: 'DELETE',
    }),

  // Commander — templates, suggestions, routines (agent 2-10)
  getCommanderTemplates: (params?: { category?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.q) qs.set('q', params.q);
    const query = qs.toString();
    return fetchJSON<{ templates: CommandTemplate[] }>(`/api/commander/templates${query ? `?${query}` : ''}`);
  },
  fillTemplate: (templateId: string, values: Record<string, string>) =>
    fetchJSON<{ text: string }>('/api/commander/templates/fill', {
      method: 'POST',
      body: JSON.stringify({ templateId, values }),
    }),
  getCommanderRoutines: () =>
    fetchJSON<{ routines: SavedRoutine[] }>('/api/commander/routines'),
  createCommanderRoutine: (name: string, description: string, steps: CommanderRoutineStep[]) =>
    fetchJSON<{ routine: SavedRoutine }>('/api/commander/routines', {
      method: 'POST',
      body: JSON.stringify({ name, description, steps }),
    }),
  deleteCommanderRoutine: (id: string) =>
    fetchJSON<{ success: boolean }>(`/api/commander/routines/${id}`, { method: 'DELETE' }),
  expandCommanderRoutine: (id: string) =>
    fetchJSON<{ commands: string[] }>(`/api/commander/routines/${id}/expand`),
};
