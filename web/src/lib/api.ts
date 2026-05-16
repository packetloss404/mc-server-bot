export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * Redirect to the login page when a 401 comes back from the backend.
 * Guarded so we only fire it once per page-load and never during the
 * login page itself (which would loop). SSR-safe (window check).
 */
let redirectingToLogin = false;
function handleUnauthorized(): void {
  if (typeof window === 'undefined') return;
  if (redirectingToLogin) return;
  if (window.location.pathname === '/login') return;
  redirectingToLogin = true;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/login?next=${next}`);
}

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function fetchVoid(path: string, options?: RequestInit): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('unauthorized');
  }
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

export interface RetryAttempt {
  attempt: number;
  error: string;
  timestamp: number;
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
    /** Map of task description -> retry attempts. Surfaced in the Tasks tab. */
    retryHistory?: Record<string, RetryAttempt[]>;
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
  /**
   * Per-block-type counts (block name → block count). Populated by the
   * server when the schematic is small enough to fully parse; absent for
   * very large schematics that we only size-estimate.
   */
  palette?: Record<string, number>;
}

export type BuildOriginMode = 'coords' | 'auto-flat' | `bot:${string}` | `player:${string}`;

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

// Bot-to-bot message (BotComms.peekUnread payload)
export interface BotMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  type: 'chat' | 'help_request' | 'status' | 'trade_offer' | 'alert';
  timestamp: number;
  read: boolean;
}

// Social memory entry
export interface SocialMemoryEntry {
  id: string;
  botName: string;
  type: 'chat' | 'task_complete' | 'task_failure' | 'combat' | 'gift' | 'trade' | 'observation';
  subject: string;
  description: string;
  timestamp: number;
  emotionalValence: number;
}

export interface EmotionalState {
  mood: 'happy' | 'neutral' | 'sad' | 'angry' | 'fearful';
  intensity: number;
  lastUpdated: number;
}

// LLM trace timeline entry — one bar on the AgentOps-style waterfall
export interface LLMTraceEntry {
  id: string;
  taskType: string;
  provider: string;
  model: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  error?: string;
}

// API functions
export const api = {
  // ─── Auth ───
  getAuthStatus: () =>
    fetchJSON<{ enabled: boolean; authenticated: boolean; pluginAuthEnabled: boolean }>(
      '/api/auth/status',
    ),
  login: (secret: string) =>
    fetchJSON<{ ok: boolean; enabled?: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ secret }),
    }),
  logout: () =>
    fetchJSON<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Bots
  getBots: () => fetchJSON<{ bots: BotStatus[] }>('/api/bots'),
  getBotDetailed: (name: string) => fetchJSON<{ bot: BotDetailed }>(`/api/bots/${name}/detailed`),
  // Fetches the prismarine-viewer HTTP port for a bot. Lazy-mounted on the
  // server: the first call spins up the viewer, subsequent calls return the
  // cached port. Returns { port: null } when the bot isn't connected yet or
  // the viewer failed to initialize.
  getBotViewerPort: (name: string) =>
    fetchJSON<{ port: number | null }>(`/api/bots/${name}/viewer-port`).catch(
      () => ({ port: null as number | null }),
    ),
  getBotRelationships: (name: string) => fetchJSON<{ relationships: Record<string, number> }>(`/api/bots/${name}/relationships`),
  getBotConversations: (name: string) => fetchJSON<{ conversations: Record<string, ChatMessage[]> }>(`/api/bots/${name}/conversations`),
  getBotTasks: (name: string) => fetchJSON<{
    currentTask: string | null;
    completedTasks: string[];
    failedTasks: string[];
    queuedTasks?: string[];
    longTermGoal?: unknown;
    retries?: Record<string, RetryAttempt[]>;
  }>(`/api/bots/${name}/tasks`),
  getBotDecisions: (name: string, limit = 30) =>
    fetchJSON<{ decisions: Array<Record<string, unknown>> }>(`/api/bots/${name}/decisions?limit=${limit}`).catch(() => ({ decisions: [] })),
  getBotReputation: (name: string) =>
    fetchJSON<{
      reputation: {
        botName?: string;
        name?: string;
        overall: number;
        reliability: number;
        cooperation: number;
        competence: number;
        recentTrend: 'rising' | 'falling' | 'stable' | string;
        totalEvents: number;
        lastUpdated: number;
      };
    }>(`/api/reputation/${name}`),

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
  updateSkill: (name: string, data: { code: string; description?: string; keywords?: string[] }) =>
    fetchJSON<{ skill: { name: string; description: string | null; keywords: string[]; code: string } }>(
      `/api/skills/${encodeURIComponent(name)}`,
      { method: 'PUT', body: JSON.stringify(data) },
    ),
  deleteSkill: (name: string) =>
    fetchJSON<{ success: boolean }>(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // Schematic upload — multipart/form-data; bypasses fetchJSON's JSON header.
  uploadSchematic: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/api/schematics/upload`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { error?: string }));
      throw new Error(body.error || `Upload failed: ${res.status}`);
    }
    return res.json() as Promise<{ schematic: SchematicInfo }>;
  },
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
  getSchematic: (filename: string) =>
    fetchJSON<{ schematic: SchematicInfo }>(`/api/schematics/${encodeURIComponent(filename)}`),
  getBuilds: () =>
    fetchJSON<{ builds: BuildRecord[] }>('/api/builds').catch(() => ({ builds: [] })),
  getBuild: (id: string) =>
    fetchJSON<{ build: BuildRecord }>(`/api/builds/${encodeURIComponent(id)}`),
  startBuild: (
    filename: string,
    origin: { x: number; y: number; z: number } | null,
    botNames: string[],
    cleanupBotNames?: string[],
    options?: {
      fillFoundation?: boolean;
      snapToGround?: boolean;
      clearSite?: boolean;
      originMode?: BuildOriginMode;
    },
  ) => {
    const body: Record<string, unknown> = { filename, botNames, cleanupBotNames, ...options };
    if (origin) body.origin = origin;
    return fetchJSON<{ build: BuildRecord }>('/api/builds', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
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

  // ─── LLM trace timeline (AgentOps-style waterfall) ───
  getBotLLMTrace: (name: string, limit = 50) =>
    fetchJSON<{ trace: LLMTraceEntry[] }>(`/api/bots/${name}/llm-trace?limit=${limit}`).catch(() => ({
      trace: [] as LLMTraceEntry[],
    })),

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

  // ─── Bot-to-bot messages & social memory ───
  getBotMessages: (name: string) =>
    fetchJSON<{ messages: BotMessage[] }>(`/api/bots/${name}/messages`).catch(() => ({
      messages: [] as BotMessage[],
    })),
  getBotMemories: (name: string) =>
    fetchJSON<{ memories: SocialMemoryEntry[]; emotionalState: EmotionalState | null }>(
      `/api/bots/${name}/memories`,
    ).catch(() => ({ memories: [] as SocialMemoryEntry[], emotionalState: null })),

  // ─── Skill stats & difficulty ───
  getSkillStats: () =>
    fetchJSON<SkillStatsResponse>('/api/skills/stats'),
  getDifficulty: () =>
    fetchJSON<DifficultyResponse>('/api/difficulty'),

  // ─── Runtime config (behavior / affinity / instincts / voyager) ───
  getConfig: () =>
    fetchJSON<{ sections: Record<string, Record<string, unknown>> }>('/api/config'),
  getConfigSection: (section: string) =>
    fetchJSON<{ section: string; values: Record<string, unknown>; restartRequired: string[] }>(
      `/api/config/${section}`,
    ),
  patchConfigSection: (section: string, values: Record<string, unknown>) =>
    fetchJSON<{ section: string; values: Record<string, unknown>; restartRequiredFields: string[] }>(
      `/api/config/${section}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ values }),
      },
    ),

  // ─── Operational / admin ───
  getAdminInfo: () =>
    fetchJSON<AdminInfo>('/api/admin/info'),
  triggerHeapSnapshot: () =>
    fetchJSON<{ success: boolean; filePath?: string; error?: string }>(
      '/api/admin/heap-snapshot',
      { method: 'POST' },
    ),
  triggerRestart: () =>
    fetchJSON<{ accepted: boolean; message: string }>(
      '/api/admin/restart',
      { method: 'POST' },
    ),
  /**
   * URL for the streaming backup download — return as a string so the caller
   * can hand it to an <a download> or window.location to trigger the browser
   * download flow. We don't fetch this through fetchJSON because the response
   * is a binary tar.gz stream, not JSON.
   */
  getBackupDownloadUrl: () => `${API_BASE}/api/admin/backup`,

  // ─── Towns (Autonomous Town Builder, Phase 1) ───
  //
  // Backend is being implemented in parallel by another agent against the
  // contract documented in TOWN_BUILDER_SPEC.md §12 and reflected here.
  // We swallow GET failures so the dashboard doesn't blow up when the
  // backend hasn't shipped these endpoints yet — the page renders an
  // empty state.
  listTowns: () =>
    fetchJSON<{ towns: TownDTO[] }>('/api/towns').catch(() => ({ towns: [] as TownDTO[] })),
  getTown: (id: string) =>
    fetchJSON<{ town: TownDTO }>(`/api/towns/${encodeURIComponent(id)}`),
  createTown: (data: {
    name: string;
    capital: { x: number; y: number; z: number };
    stylePreset: 'medieval-communal' | 'mid-century-civic';
    mayorTitle?: string;
  }) =>
    fetchJSON<{ town: TownDTO }>('/api/towns', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateTown: (id: string, data: Partial<TownDTO>) =>
    fetchJSON<{ town: TownDTO }>(`/api/towns/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteTown: (id: string) =>
    fetchJSON<{ ok: boolean }>(`/api/towns/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  getTownBuildings: (id: string) =>
    fetchJSON<{ buildings: TownBuildingDTO[] }>(
      `/api/towns/${encodeURIComponent(id)}/buildings`,
    ).catch(() => ({ buildings: [] as TownBuildingDTO[] })),
  getTownResidents: (id: string) =>
    fetchJSON<{ residents: TownResidentDTO[] }>(
      `/api/towns/${encodeURIComponent(id)}/residents`,
    ).catch(() => ({ residents: [] as TownResidentDTO[] })),
  getTownDistricts: (id: string) =>
    fetchJSON<{ districts: TownDistrictDTO[] }>(
      `/api/towns/${encodeURIComponent(id)}/districts`,
    ).catch(() => ({ districts: [] as TownDistrictDTO[] })),
  getTownEvents: (id: string, params?: { limit?: number; since?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    if (params?.since !== undefined) q.set('since', String(params.since));
    const qs = q.toString();
    return fetchJSON<{ events: TownEventDTO[] }>(
      `/api/towns/${encodeURIComponent(id)}/events${qs ? `?${qs}` : ''}`,
    ).catch(() => ({ events: [] as TownEventDTO[] }));
  },
  addTownResident: (id: string, data: { botName: string; role: string }) =>
    fetchJSON<{ resident: TownResidentDTO }>(
      `/api/towns/${encodeURIComponent(id)}/residents`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
  // The pause/resume backend ships in parallel with this client wiring (Phase
  // 2 — other agent). Errors propagate to the caller so the toast layer can
  // surface "Backend not ready yet."
  pauseTown: (id: string) =>
    fetchJSON<{ town: TownDTO }>(
      `/api/towns/${encodeURIComponent(id)}/pause`,
      { method: 'POST' },
    ),
  resumeTown: (id: string) =>
    fetchJSON<{ town: TownDTO }>(
      `/api/towns/${encodeURIComponent(id)}/resume`,
      { method: 'POST' },
    ),

  // ─── Town roles & schedules (Phase 3 — parallel backend agent) ───
  //
  // GET endpoints swallow errors so the UI can fall back to a "no role data
  // yet" empty state if the backend hasn't shipped yet. The POST surfaces
  // errors so the caller can revert optimistic state + toast.
  listTownRoles: (id: string) =>
    fetchJSON<TownRolesResponse>(
      `/api/towns/${encodeURIComponent(id)}/roles`,
    ).catch(() => null as TownRolesResponse | null),
  setResidentRole: (id: string, botName: string, role: string) =>
    fetchJSON<{ ok: true; botName: string; role: string }>(
      `/api/towns/${encodeURIComponent(id)}/roles/${encodeURIComponent(botName)}`,
      { method: 'POST', body: JSON.stringify({ role }) },
    ),
  getTownSchedules: (id: string) =>
    fetchJSON<TownSchedulesResponse>(
      `/api/towns/${encodeURIComponent(id)}/schedules`,
    ).catch(() => null as TownSchedulesResponse | null),

  // ─── Town chronicle (Phase 4-B) ───────────────────────────────────────
  //
  // Daily LLM-narrated story entries (last 7 by default) and the manual
  // "Generate now" trigger. GET swallows errors so the dashboard renders an
  // empty state when the backend hasn't finished booting; POST surfaces so
  // toasts can show "Backend not ready yet."
  listTownChronicle: (id: string, params?: { limit?: number; kind?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    if (params?.kind !== undefined) q.set('kind', params.kind);
    const qs = q.toString();
    return fetchJSON<{ entries: ChronicleEntryDTO[] }>(
      `/api/towns/${encodeURIComponent(id)}/chronicle${qs ? `?${qs}` : ''}`,
    ).catch(() => ({ entries: [] as ChronicleEntryDTO[] }));
  },
  generateChronicleNow: (
    id: string,
    body?: { dayNumber?: number; force?: boolean },
  ) =>
    fetchJSON<{ entry?: ChronicleEntryDTO; ok?: false; reason?: string; dayNumber?: number }>(
      `/api/towns/${encodeURIComponent(id)}/chronicle/generate`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    ),
  listBotJournals: (id: string, params?: { botName?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.botName !== undefined) q.set('botName', params.botName);
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    const qs = q.toString();
    return fetchJSON<{ journals: BotJournalDTO[] }>(
      `/api/towns/${encodeURIComponent(id)}/journals${qs ? `?${qs}` : ''}`,
    ).catch(() => ({ journals: [] as BotJournalDTO[] }));
  },

  // ─── Phase 5-A Disasters + Memorial Park ──────────────────────────────
  //
  // Disaster rows from the Phoenix self-healing loop + the Memorial Park
  // monument markers. Both GETs swallow errors so the panel renders an
  // empty state when the backend hasn't booted yet.
  listTownDisasters: (id: string, params?: { limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    const qs = q.toString();
    return fetchJSON<{ disasters: TownDisasterDTO[] }>(
      `/api/towns/${encodeURIComponent(id)}/disasters${qs ? `?${qs}` : ''}`,
    ).catch(() => ({ disasters: [] as TownDisasterDTO[] }));
  },
  getMemorialPark: (id: string) =>
    fetchJSON<{ bounds: MemorialParkBoundsDTO | null; markers: Marker[] }>(
      `/api/towns/${encodeURIComponent(id)}/memorial`,
    ).catch(() => ({ bounds: null, markers: [] as Marker[] })),

  // ─── Phase 5-B: districts (style evolution) + child towns (self-expansion)
  //
  // listTownDistricts hits the existing /districts endpoint (it existed in
  // Phase 1 but the client wasn't using it from a dedicated card). The two
  // new endpoints — /children and /expand — ship in Phase 5-B. GETs swallow
  // errors so the cards render an empty state until the backend boots.
  // requestExpansion surfaces errors so the toast layer can show
  // "Not eligible" reasons (tier shortfall, daily cap, pending approval).
  listTownDistricts: (id: string) =>
    fetchJSON<{ districts: TownDistrictDTO[] }>(
      `/api/towns/${encodeURIComponent(id)}/districts`,
    ).catch(() => ({ districts: [] as TownDistrictDTO[] })),
  listChildTowns: (id: string) =>
    fetchJSON<{ children: ChildTownDTO[] }>(
      `/api/towns/${encodeURIComponent(id)}/children`,
    ).catch(() => ({ children: [] as ChildTownDTO[] })),
  requestExpansion: (id: string) =>
    fetchJSON<ExpansionResponse>(
      `/api/towns/${encodeURIComponent(id)}/expand`,
      { method: 'POST' },
    ),
};

// ─── Town DTOs (mirror townStore types — kept here so api.ts stays
// self-contained and import order doesn't matter). The Town* prefix avoids
// clashing with any backend types the rest of api.ts may grow into. ─

export interface TownDTO {
  id: string;
  name: string;
  foundedAt: number;
  capital: { x: number; y: number; z: number };
  tier: 'founding' | 'village' | 'town';
  status: 'active' | 'dormant' | 'abandoned';
  population: number;
  alliance: 'allied' | 'rival' | 'neutral' | null;
  parentTownId?: string | null;
  styleSeed: 'medieval-communal' | 'mid-century-civic';
  mayorTitle?: string;
  /** Town Brain frozen — Phase 2. Defaults to false on older payloads. */
  paused?: boolean;
}

export interface TownDistrictDTO {
  id: string;
  townId: string;
  name: string;
  stylePreset: 'medieval-communal' | 'mid-century-civic';
  isDefault: boolean;
  /** Phase 5-B — when the district row was inserted. Optional for backwards
   *  compat with older API payloads that omitted it. */
  foundedAt?: number;
}

export interface TownBuildingDTO {
  id: string;
  townId: string;
  districtId?: string | null;
  name: string;
  status: 'planned' | 'building' | 'complete' | 'damaged' | 'destroyed';
  origin?: { x: number; y: number; z: number };
}

export interface TownResidentDTO {
  id: string;
  townId: string;
  botName: string;
  joinedAt: number;
  currentRole?: string | null;
  status: 'alive' | 'dead' | 'departed';
}

export interface TownEventDTO {
  id: string;
  townId: string;
  kind: string;
  severity: string;
  payload: unknown;
  occurredAt: number;
  highlightScore: number;
}

// ─── Town chronicle (Phase 4-B) ────────────────────────────────────────────
//
// Mirrors `ChronicleEntry` in src/town/TownManager.ts. `kind` is open-ended
// because milestone kinds are spec-defined string ids ('tier_upgrade', etc.).

export interface ChronicleEntryDTO {
  id: string;
  townId: string;
  dayNumber: number;
  kind: 'daily' | 'milestone' | 'disaster' | 'voice' | string;
  body: string;
  generatedAt: number | null;
  model: string | null;
}

export interface BotJournalDTO {
  id: string;
  townId: string;
  botName: string;
  dayNumber: number | null;
  body: string;
  generatedAt: number | null;
}

// ─── Town disasters + Memorial Park (Phase 5-A) ────────────────────────────
//
// Mirrors `Disaster` in src/town/Town.ts and the Memorial Park bounds shape.
// `kind` is open-ended so a future Phase 5 extension can add new disaster
// kinds without a client-side schema bump.

export interface TownDisasterDTO {
  id: string;
  townId: string;
  /** 'raid' | 'lava' | 'lost_bot' | 'crash' | <future-kinds> */
  kind: string;
  severity: string | null;
  occurredAt: number | null;
  memorialMarkerId: string | null;
  summary: string | null;
}

export interface MemorialParkBoundsDTO {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
}

// ─── Phase 5-B child towns + expansion proposals ──────────────────────────
//
// Children mirror TownDTO with one extra: the world-space distance from the
// parent capital (rounded blocks). Expansion proposals are emitted by the
// backend on /expand — `executed: true` means the child town was already
// founded; `executed: false` means the proposal awaits approval (Phase 6).

export interface ChildTownDTO extends TownDTO {
  /** Rounded XZ-plane distance from the parent town's capital, in blocks. */
  distanceFromParent: number | null;
}

export interface ExpansionProposalDTO {
  parentTownId: string;
  parentTownName: string;
  childName: string;
  childCapital: { x: number; y: number; z: number };
  styleSeed: 'medieval-communal' | 'mid-century-civic';
  direction: 'North' | 'East' | 'South' | 'West';
  autoApprove: boolean;
}

export interface ExpansionResponse {
  proposal: ExpansionProposalDTO;
  executed: boolean;
  /** Populated when executed === true (auto-approved first child). */
  childTown?: TownDTO;
  /** Populated when executed === false (pending approval, etc.). */
  reason?: string;
}

// ─── Town roles (Phase 3) ─────────────────────────────────────────────────
//
// Mirrors the contract P3-A is exposing under /api/towns/:id/roles and
// /api/towns/:id/schedules. Kept loose (`Record<string, number>`) on the
// breakdown so unknown future roles still render without a code change.

export type TownRoleKey =
  | 'lumberjack'
  | 'miner'
  | 'farmer'
  | 'blacksmith'
  | 'builder'
  | 'guard'
  | 'gatherer'
  | 'idle';

export interface TownRolesResponse {
  breakdown: Record<string, number>;
  residents: Array<{ botName: string; role: string }>;
}

export interface TownSchedulesResponse {
  phase: 'day' | 'night';
  roleSchedules: Record<string, { day: string[]; night: string[] }>;
}

export interface AdminInfo {
  uptimeSec: number;
  pid: number;
  nodeVersion: string;
  platform: string;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  logPath: string;
}

// Response shapes confirmed from src/server/api.ts (/api/skills/stats handler)
// and src/voyager/DifficultyBalancer.ts (DifficultyState interface).
export interface SkillStatsEntry {
  name: string;
  description: string | null;
  successCount: number;
  failureCount: number;
  quality: number | null;
}

export interface SkillStatsResponse {
  total: number;
  totalSuccesses: number;
  totalFailures: number;
  averageQuality: number;
  neverUsed: number;
  topPerformers: SkillStatsEntry[];
  topFailures: SkillStatsEntry[];
}

export type DifficultyTier = 'peaceful' | 'easy' | 'normal' | 'hard' | 'challenge';

export interface DifficultyResponse {
  tier: DifficultyTier;
  playerCount: number;
  averagePlayerSkill: number;
  botAutonomy: number;
  eventFrequency: number;
  botChatFrequency: number;
  combatAggressiveness: number;
  helpfulness: number;
}
