// Personality accent colors matching the design spec
export const PERSONALITY_COLORS: Record<string, string> = {
  merchant: '#F5A623',
  guard: '#4A90D9',
  elder: '#9B59B6',
  explorer: '#27AE60',
  blacksmith: '#E74C3C',
  farmer: '#F39C12',
  builder: '#1ABC9C',
};

export const PERSONALITY_ICONS: Record<string, string> = {
  merchant: '\u{1F4B0}',
  guard: '\u{1F6E1}',
  elder: '\u{1F4D6}',
  explorer: '\u{1F9ED}',
  blacksmith: '\u{2692}',
  farmer: '\u{1F33E}',
  builder: '\u{1F528}',
};

export const STATE_COLORS: Record<string, string> = {
  IDLE: '#6B7280',
  SPAWNING: '#F59E0B',
  WANDERING: '#3B82F6',
  FOLLOWING: '#8B5CF6',
  MINING: '#D97706',
  PATROLLING: '#0EA5E9',
  HOSTILE: '#EF4444',
  INSTINCT: '#EF4444',
  EXECUTING_TASK: '#10B981',
  DISCONNECTED: '#374151',
  CRAFTING: '#A78BFA',
  BUILDING: '#1ABC9C',
  FARMING: '#F39C12',
  TRADING: '#F5A623',
  DEFENDING: '#4A90D9',
  EXPLORING: '#27AE60',
};

export const STATE_LABELS: Record<string, string> = {
  IDLE: 'Idle',
  SPAWNING: 'Spawning',
  WANDERING: 'Wandering',
  FOLLOWING: 'Following',
  MINING: 'Mining',
  PATROLLING: 'Patrolling',
  HOSTILE: 'Hostile',
  INSTINCT: 'Instinct',
  EXECUTING_TASK: 'Working',
  DISCONNECTED: 'Offline',
  CRAFTING: 'Crafting',
  BUILDING: 'Building',
  FARMING: 'Farming',
  TRADING: 'Trading',
  DEFENDING: 'Defending',
  EXPLORING: 'Exploring',
};

export const AFFINITY_TIERS = [
  { min: 0, max: 19, label: 'Hostile', color: '#EF4444' },
  { min: 20, max: 39, label: 'Wary', color: '#F59E0B' },
  { min: 40, max: 59, label: 'Neutral', color: '#6B7280' },
  { min: 60, max: 79, label: 'Friendly', color: '#10B981' },
  { min: 80, max: 100, label: 'Close Friend', color: '#3B82F6' },
] as const;

export function getAffinityTier(score: number) {
  return AFFINITY_TIERS.find((t) => score >= t.min && score <= t.max) ?? AFFINITY_TIERS[2];
}

export function getPersonalityColor(personality: string): string {
  return PERSONALITY_COLORS[personality?.toLowerCase()] ?? '#6B7280';
}

// Player default color for map markers
export const PLAYER_COLOR = '#60A5FA';

// Event type display info
export const EVENT_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  'bot:state': { icon: '>', label: 'State Change', color: '#8B5CF6' },
  'bot:task': { icon: '#', label: 'Task', color: '#10B981' },
  'bot:chat': { icon: '"', label: 'Chat', color: '#3B82F6' },
  'bot:spawn': { icon: '+', label: 'Spawned', color: '#22C55E' },
  'bot:disconnect': { icon: '-', label: 'Disconnected', color: '#EF4444' },
  'bot:skill_learned': { icon: '*', label: 'Skill Learned', color: '#F59E0B' },
  'bot:death': { icon: 'X', label: 'Death', color: '#EF4444' },
  'player:join': { icon: '+', label: 'Player Joined', color: '#60A5FA' },
  'player:leave': { icon: '-', label: 'Player Left', color: '#6B7280' },
  'build:started': { icon: '\u25B6', label: 'Build Started', color: '#1ABC9C' },
  'build:completed': { icon: '\u2713', label: 'Build Complete', color: '#10B981' },
  'build:cancelled': { icon: '\u25A0', label: 'Build Cancelled', color: '#EF4444' },
  'chain:started': { icon: '\u26D3', label: 'Chain Started', color: '#F59E0B' },
  'chain:completed': { icon: '\u26D3', label: 'Chain Complete', color: '#10B981' },
  'chain:failed': { icon: '\u26D3', label: 'Chain Failed', color: '#EF4444' },
  'commander:parse': { icon: '?', label: 'Commander Parse', color: '#06B6D4' },
  'commander:execute': { icon: '!', label: 'Commander Execute', color: '#A855F7' },
};
