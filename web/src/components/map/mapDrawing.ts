import { getPersonalityColor, PLAYER_COLOR } from '@/lib/constants';

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 10;
export const TRAIL_LENGTH = 80;
export const TERRAIN_RADIUS = 96;
export const TERRAIN_STEP = 2;
export const ZOOM_SENSITIVITY = 0.002; // Normalized zoom speed

export type MapMode = 'navigate' | 'select' | 'place-marker' | 'draw-zone' | 'draw-route';

export interface MapEntity {
  name: string;
  x: number;
  z: number;
  color: string;
  type: 'bot' | 'player';
  state?: string;
  personality?: string;
}

export interface ShowState {
  bots: boolean;
  players: boolean;
  trails: boolean;
  grid: boolean;
  coords: boolean;
  terrain: boolean;
}

interface BotLike {
  name: string;
  position: { x: number; y: number; z: number } | null;
  personality?: string;
  state?: string;
}

interface PlayerLike {
  name: string;
  position: { x: number; y: number; z: number } | null;
  isOnline: boolean;
}

export function collectEntities(
  bots: BotLike[],
  players: PlayerLike[],
  showBots: boolean,
  showPlayers: boolean,
): MapEntity[] {
  const entities: MapEntity[] = [];
  const drawnNames = new Set<string>();

  if (showBots) {
    for (const bot of bots) {
      if (!bot.position) continue;
      drawnNames.add(bot.name.toLowerCase());
      entities.push({
        name: bot.name,
        x: bot.position.x,
        z: bot.position.z,
        color: getPersonalityColor(bot.personality ?? ''),
        type: 'bot',
        state: bot.state,
        personality: bot.personality,
      });
    }
  }

  if (showPlayers) {
    for (const player of players) {
      if (!player.isOnline || !player.position || drawnNames.has(player.name.toLowerCase())) continue;
      entities.push({
        name: player.name,
        x: player.position.x,
        z: player.position.z,
        color: PLAYER_COLOR,
        type: 'player',
      });
    }
  }

  return entities;
}
