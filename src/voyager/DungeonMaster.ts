import { logger } from '../util/logger';

export type EventType = 'resource_scarcity' | 'mob_invasion' | 'weather_event' | 'discovery' | 'diplomatic';

export interface WorldEvent {
  id: string;
  type: EventType;
  title: string;
  description: string;
  tasks: Array<{ description: string; keywords: string[]; priority: 'low' | 'normal' | 'high' | 'critical' }>;
  triggerCondition?: string;
  duration: number;
  createdAt: number;
  expiresAt: number;
  resolved: boolean;
}

export interface WorldSnapshot {
  botCount: number;
  playerCount: number;
  serverTimeOfDay: number;
  weather: string;
  totalResources: Record<string, number>;
  recentCompletedTasks: number;
  exploredChunkCount: number;
  activeThreatCount: number;
  averageBotHealth: number;
}

const DIRECTIONS = ['north', 'south', 'east', 'west'] as const;
const MOB_TYPES = ['zombies', 'skeletons', 'spiders', 'creepers'] as const;
const DISCOVERY_TYPES = ['an ancient ruin', 'an abandoned mineshaft', 'a village', 'a dungeon'] as const;
const CRITICAL_RESOURCES = ['iron_ingot', 'iron_ore', 'coal', 'oak_log', 'cobblestone', 'food'];

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const MAX_HISTORY = 200;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function genId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function scaledDistance(botCount: number): number {
  const base = 50;
  const extra = Math.min(botCount * 25, 250);
  return base + randInt(0, extra);
}

export class DungeonMaster {
  private events: WorldEvent[] = [];
  private lastEventTime = 0;

  evaluateAndGenerate(snapshot: WorldSnapshot): WorldEvent | null {
    const now = Date.now();
    if (now - this.lastEventTime < COOLDOWN_MS) return null;

    this.expireOldEvents();

    const event =
      this.tryResourceScarcity(snapshot) ??
      this.tryMobInvasion(snapshot) ??
      this.tryWeatherEvent(snapshot) ??
      this.tryDiscovery(snapshot) ??
      this.tryDiplomaticEvent(snapshot);

    if (event) {
      this.events.push(event);
      this.lastEventTime = now;
      if (this.events.length > MAX_HISTORY) {
        this.events = this.events.slice(-MAX_HISTORY);
      }
      logger.info({ eventId: event.id, type: event.type }, `DungeonMaster generated event: ${event.title}`);
    }

    return event;
  }

  getActiveEvents(): WorldEvent[] {
    const now = Date.now();
    return this.events.filter((e) => !e.resolved && e.expiresAt > now);
  }

  resolveEvent(eventId: string): void {
    const event = this.events.find((e) => e.id === eventId);
    if (event) {
      event.resolved = true;
      logger.info({ eventId }, 'DungeonMaster resolved event');
    }
  }

  expireOldEvents(): void {
    const now = Date.now();
    for (const event of this.events) {
      if (!event.resolved && event.expiresAt <= now) {
        event.resolved = true;
        logger.debug({ eventId: event.id }, 'DungeonMaster expired event');
      }
    }
  }

  getEventHistory(limit = 50): WorldEvent[] {
    return this.events.slice(-limit).reverse();
  }

  // --- private generators ---

  private tryResourceScarcity(snap: WorldSnapshot): WorldEvent | null {
    const scarce = CRITICAL_RESOURCES.find((r) => (snap.totalResources[r] ?? 0) < 5);
    if (!scarce) return null;

    const dir = pick(DIRECTIONS);
    const dist = scaledDistance(snap.botCount);
    const templates = [
      `The ${scarce} veins near base have been depleted. Scouts report a new deposit ${dist} blocks to the ${dir}.`,
      `Supplies of ${scarce} are critically low. A fresh source was spotted ${dist} blocks ${dir}.`,
      `${scarce} reserves are nearly empty! Prospectors found deposits ${dist} blocks to the ${dir}.`,
      `Warning: ${scarce} stockpile is dangerously low. New veins detected ${dist} blocks ${dir}ward.`,
    ];

    const duration = this.scaledDuration(snap, 20 * 60_000);
    const now = Date.now();
    return {
      id: genId(),
      type: 'resource_scarcity',
      title: `${scarce} Shortage`,
      description: pick(templates),
      tasks: [
        { description: `Explore ${dir} for ${dist} blocks to find new ${scarce}`, keywords: ['explore', scarce, dir], priority: 'high' },
        { description: `Mine the new ${scarce} deposit`, keywords: ['mine', scarce], priority: 'high' },
      ],
      triggerCondition: `${scarce} supply < 5`,
      duration,
      createdAt: now,
      expiresAt: now + duration,
      resolved: false,
    };
  }

  private tryMobInvasion(snap: WorldSnapshot): WorldEvent | null {
    const isNight = snap.serverTimeOfDay >= 13000 && snap.serverTimeOfDay <= 23000;
    if (!isNight && Math.random() > 0.2) return null;

    const mob = pick(MOB_TYPES);
    const dir = pick(DIRECTIONS);
    const mobCount = Math.max(3, snap.botCount * 2 + randInt(1, 5));
    const difficulty = snap.averageBotHealth < 10 ? 'easy' : 'hard';

    const templates = [
      `A horde of ${mobCount} ${mob} is approaching from the ${dir}!`,
      `${mobCount} ${mob} have been spotted advancing from the ${dir}!`,
      `Alert! A wave of ${mob} (${mobCount} strong) storms in from the ${dir}!`,
      `The ${dir}ern perimeter is under threat: ${mobCount} ${mob} incoming!`,
    ];

    const priority = difficulty === 'easy' ? 'normal' as const : 'critical' as const;
    const duration = this.scaledDuration(snap, 10 * 60_000);
    const now = Date.now();
    return {
      id: genId(),
      type: 'mob_invasion',
      title: `${mob} Invasion`,
      description: pick(templates),
      tasks: [
        { description: 'Equip weapons and armor', keywords: ['equip', 'weapon', 'armor', 'combat'], priority },
        { description: `Guard the ${dir} perimeter`, keywords: ['guard', 'patrol', dir, 'combat'], priority },
        { description: `Clear all ${mob} in the area`, keywords: ['fight', 'kill', mob, 'combat'], priority },
      ],
      triggerCondition: isNight ? 'nighttime' : 'random invasion chance',
      duration,
      createdAt: now,
      expiresAt: now + duration,
      resolved: false,
    };
  }

  private tryWeatherEvent(snap: WorldSnapshot): WorldEvent | null {
    if (snap.weather !== 'rain' && snap.weather !== 'thunder') return null;

    const templates = [
      'A thunderstorm is approaching. Lightning may strike exposed builds.',
      'Dark clouds gather overhead. Seek shelter before the storm hits!',
      'Thunder rumbles in the distance. Protect exposed structures now.',
      'Storm warning! Lightning threatens anything left in the open.',
    ];

    const duration = this.scaledDuration(snap, 15 * 60_000);
    const now = Date.now();
    return {
      id: genId(),
      type: 'weather_event',
      title: 'Thunderstorm Warning',
      description: pick(templates),
      tasks: [
        { description: 'Craft lightning rods for exposed builds', keywords: ['craft', 'lightning', 'rod', 'build'], priority: 'normal' },
        { description: 'Build or reinforce shelters', keywords: ['build', 'shelter', 'roof'], priority: 'high' },
        { description: 'Stay indoors until the storm passes', keywords: ['shelter', 'wait', 'indoor'], priority: 'low' },
      ],
      triggerCondition: `weather=${snap.weather}`,
      duration,
      createdAt: now,
      expiresAt: now + duration,
      resolved: false,
    };
  }

  private tryDiscovery(snap: WorldSnapshot): WorldEvent | null {
    if (snap.exploredChunkCount < 10) return null;
    // Discovery events unlock after bots have explored a meaningful area
    // Higher recent task completion means bots are ready for harder content
    if (snap.recentCompletedTasks < 3 && Math.random() > 0.3) return null;

    const discovery = pick(DISCOVERY_TYPES);
    const x = randInt(-300, 300);
    const z = randInt(-300, 300);

    const templates = [
      `Scouts have reported ${discovery} at coordinates (${x}, ${z}).`,
      `Explorers discovered ${discovery} near (${x}, ${z}). Investigate!`,
      `A curious structure -- ${discovery} -- was found at (${x}, ${z}).`,
      `New finding: ${discovery} spotted at (${x}, ${z}). Worth exploring.`,
    ];

    const duration = this.scaledDuration(snap, 25 * 60_000);
    const now = Date.now();
    return {
      id: genId(),
      type: 'discovery',
      title: `Discovery: ${discovery}`,
      description: pick(templates),
      tasks: [
        { description: `Travel to (${x}, ${z}) to investigate ${discovery}`, keywords: ['explore', 'travel', 'investigate'], priority: 'normal' },
        { description: 'Clear any threats at the site', keywords: ['fight', 'clear', 'combat'], priority: 'high' },
        { description: 'Loot and gather resources from the site', keywords: ['loot', 'gather', 'mine', 'collect'], priority: 'normal' },
      ],
      triggerCondition: `exploredChunks=${snap.exploredChunkCount}, recentTasks=${snap.recentCompletedTasks}`,
      duration,
      createdAt: now,
      expiresAt: now + duration,
      resolved: false,
    };
  }

  private tryDiplomaticEvent(snap: WorldSnapshot): WorldEvent | null {
    if (snap.playerCount < 1) return null;
    if (Math.random() > 0.15) return null;

    const templates = [
      'A wandering trader has arrived with unusual goods.',
      'A mysterious merchant appeared near spawn offering rare trades.',
      'A traveling cartographer offers maps to hidden treasure.',
      'A foreign diplomat seeks an audience and brings gifts.',
    ];

    const duration = this.scaledDuration(snap, 15 * 60_000);
    const now = Date.now();
    return {
      id: genId(),
      type: 'diplomatic',
      title: 'Wandering Trader Arrives',
      description: pick(templates),
      tasks: [
        { description: 'Meet the wandering trader at spawn', keywords: ['meet', 'trader', 'travel', 'spawn'], priority: 'normal' },
        { description: 'Negotiate and trade for rare items', keywords: ['trade', 'negotiate', 'merchant'], priority: 'normal' },
        { description: 'Gather emeralds for trading', keywords: ['gather', 'emerald', 'mine', 'collect'], priority: 'low' },
      ],
      triggerCondition: `players online: ${snap.playerCount}`,
      duration,
      createdAt: now,
      expiresAt: now + duration,
      resolved: false,
    };
  }

  /**
   * Scale event duration based on difficulty.
   * Low health bots get longer durations (easier). High task completion = shorter (harder).
   */
  private scaledDuration(snap: WorldSnapshot, baseMs: number): number {
    let factor = 1.0;
    // Low health: give bots a break with longer duration
    if (snap.averageBotHealth < 10) factor += 0.5;
    // High task completion: shorten duration (harder)
    if (snap.recentCompletedTasks > 10) factor -= 0.2;
    // More bots: slightly shorter (harder coordination needed)
    if (snap.botCount > 3) factor -= 0.1;
    factor = Math.max(0.5, Math.min(2.0, factor));
    return Math.round(baseMs * factor);
  }
}
