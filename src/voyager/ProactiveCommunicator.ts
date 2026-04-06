import { logger } from '../util/logger';

export interface Announcement {
  id: string;
  botName: string;
  type: 'discovery' | 'threat_warning' | 'request_help' | 'status_update' | 'resource_alert';
  message: string;
  priority: number; // 0-10
  position?: { x: number; y: number; z: number };
  timestamp: number;
}

export interface CommunicatorState {
  threats: Array<{
    type: string;
    source: string;
    dangerLevel: number;
    distance: number;
    position?: { x: number; y: number; z: number };
  }>;
  opportunities: Array<{
    type: string;
    name: string;
    value: number;
    position: { x: number; y: number; z: number };
  }>;
  health: number;
  food: number;
  currentTask?: string;
}

type Personality = 'guard' | 'explorer' | 'farmer' | 'merchant' | 'blacksmith' | 'elder';

/** Rate-limit cooldowns in milliseconds per announcement type. */
const COOLDOWNS: Record<Announcement['type'], number> = {
  discovery: 60_000,
  threat_warning: 30_000,
  request_help: 45_000,
  status_update: 300_000,
  resource_alert: 120_000,
};

/** Personality-flavored prefixes for announcements. */
const PERSONALITY_FLAVOR: Record<Personality, Record<Announcement['type'], string>> = {
  guard: {
    discovery: 'Intel report:',
    threat_warning: 'Hostile contact!',
    request_help: 'Requesting backup!',
    status_update: 'Status report:',
    resource_alert: 'Supply update:',
  },
  explorer: {
    discovery: 'Amazing find!',
    threat_warning: 'Danger ahead!',
    request_help: 'Could use some help here!',
    status_update: 'Adventure update:',
    resource_alert: 'Heads up,',
  },
  farmer: {
    discovery: 'Look what I found!',
    threat_warning: 'Watch out!',
    request_help: 'Need a hand over here!',
    status_update: 'Working away:',
    resource_alert: 'Ran dry:',
  },
  merchant: {
    discovery: 'Valuable goods located!',
    threat_warning: 'Threat to operations!',
    request_help: 'Requesting assistance!',
    status_update: 'Business update:',
    resource_alert: 'Market notice:',
  },
  blacksmith: {
    discovery: 'Found more ore.',
    threat_warning: 'Trouble nearby.',
    request_help: 'Could use a hand!',
    status_update: 'Still at it:',
    resource_alert: 'Vein tapped out:',
  },
  elder: {
    discovery: 'A discovery worth noting.',
    threat_warning: 'Beware:',
    request_help: 'I require aid.',
    status_update: 'An update:',
    resource_alert: 'Resources waning:',
  },
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatCoords(pos: { x: number; y: number; z: number }): string {
  return `(${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)})`;
}

function formatCoordsXZ(pos: { x: number; y: number; z: number }): string {
  return `(${Math.round(pos.x)},${Math.round(pos.z)})`;
}

function prettifyName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export class ProactiveCommunicator {
  private botName: string;
  private personality: Personality;
  private history: Announcement[] = [];
  private lastAnnouncedAt: Map<string, number> = new Map();
  /** Tracks positions of resources we have previously announced, for depletion detection. */
  private knownResourcePositions: Map<string, { x: number; y: number; z: number }> = new Map();
  /** Track which opportunities we saw on the previous tick so we can detect depletion. */
  private previousOpportunityKeys: Set<string> = new Set();

  private static readonly MAX_HISTORY = 200;

  constructor(botName: string, personality: string) {
    this.botName = botName;
    this.personality = (personality as Personality) || 'farmer';
  }

  /**
   * Evaluate the current state and generate any announcements that should be made.
   * Returns an array of announcements (may be empty if nothing warrants communicating
   * or rate limits suppress it).
   */
  checkAndAnnounce(state: CommunicatorState): Announcement[] {
    const announcements: Announcement[] = [];

    this.checkDiscoveries(state, announcements);
    this.checkThreatWarnings(state, announcements);
    this.checkRequestHelp(state, announcements);
    this.checkResourceAlerts(state, announcements);
    this.checkStatusUpdate(state, announcements);

    // Record new announcements in history
    for (const a of announcements) {
      this.history.push(a);
    }

    // Trim history
    if (this.history.length > ProactiveCommunicator.MAX_HISTORY) {
      this.history = this.history.slice(-ProactiveCommunicator.MAX_HISTORY);
    }

    if (announcements.length > 0) {
      logger.debug(
        { bot: this.botName, count: announcements.length },
        'ProactiveCommunicator: generated announcements',
      );
    }

    return announcements;
  }

  /**
   * Format an announcement for in-game chat. Kept under 100 characters.
   */
  formatForChat(announcement: Announcement): string {
    const flavor = this.getFlavor(announcement.type);
    const pos = announcement.position;
    let msg: string;

    switch (announcement.type) {
      case 'discovery':
        msg = pos
          ? `${flavor} ${announcement.message} at ${formatCoords(pos)}`
          : `${flavor} ${announcement.message}`;
        break;
      case 'threat_warning':
        msg = pos
          ? `${flavor} ${announcement.message} near ${formatCoordsXZ(pos)}`
          : `${flavor} ${announcement.message}`;
        break;
      case 'request_help':
        msg = pos
          ? `${flavor} Under attack at ${formatCoordsXZ(pos)}!`
          : `${flavor} ${announcement.message}`;
        break;
      case 'status_update':
        msg = `${flavor} ${announcement.message}`;
        break;
      case 'resource_alert':
        msg = pos
          ? `${flavor} ${announcement.message} at ${formatCoordsXZ(pos)}`
          : `${flavor} ${announcement.message}`;
        break;
      default:
        msg = announcement.message;
    }

    // Truncate to 100 characters
    if (msg.length > 100) {
      msg = msg.slice(0, 97) + '...';
    }

    return msg;
  }

  /**
   * Format an announcement for inter-bot messaging via BotComms.
   * Returns a structured string: type | position | details.
   */
  formatForBotComms(announcement: Announcement): string {
    const posStr = announcement.position
      ? formatCoords(announcement.position)
      : 'no_pos';
    return `${announcement.type}|${posStr}|${announcement.message}`;
  }

  /**
   * Check if an announcement of the given type should be emitted based on rate limits.
   * The key is composed of type + a discriminator so that e.g. two different discovery
   * types each get their own cooldown window.
   */
  shouldAnnounce(
    type: Announcement['type'],
    lastAnnouncedAt: Map<string, number>,
    discriminator?: string,
  ): boolean {
    const key = discriminator ? `${type}:${discriminator}` : type;
    const last = lastAnnouncedAt.get(key);
    if (last === undefined) return true;
    const cooldown = COOLDOWNS[type];
    return Date.now() - last >= cooldown;
  }

  /**
   * Return recent announcements from this bot, newest first.
   */
  getRecentAnnouncements(limit: number = 20): Announcement[] {
    const slice = this.history.slice(-limit);
    slice.reverse();
    return slice;
  }

  /**
   * Clear the announcement history and rate-limit tracking.
   */
  clearHistory(): void {
    this.history = [];
    this.lastAnnouncedAt.clear();
    this.knownResourcePositions.clear();
    this.previousOpportunityKeys.clear();
  }

  // ---------------------------------------------------------------------------
  // Private announcement generators
  // ---------------------------------------------------------------------------

  private checkDiscoveries(state: CommunicatorState, out: Announcement[]): void {
    for (const opp of state.opportunities) {
      if (opp.value < 7) continue;

      const discriminator = `${opp.type}:${opp.name}`;
      if (!this.shouldAnnounce('discovery', this.lastAnnouncedAt, discriminator)) continue;

      const prettyName = prettifyName(opp.name);
      const announcement: Announcement = {
        id: generateId(),
        botName: this.botName,
        type: 'discovery',
        message: `Found ${prettyName}`,
        priority: Math.min(10, opp.value),
        position: opp.position,
        timestamp: Date.now(),
      };

      out.push(announcement);
      this.lastAnnouncedAt.set(`discovery:${discriminator}`, Date.now());

      // Track the position for future depletion detection
      const posKey = `${opp.name}:${Math.round(opp.position.x)},${Math.round(opp.position.z)}`;
      this.knownResourcePositions.set(posKey, opp.position);
    }
  }

  private checkThreatWarnings(state: CommunicatorState, out: Announcement[]): void {
    for (const threat of state.threats) {
      if (threat.dangerLevel < 6) continue;

      const discriminator = `${threat.type}:${threat.source}`;
      if (!this.shouldAnnounce('threat_warning', this.lastAnnouncedAt, discriminator)) continue;

      const announcement: Announcement = {
        id: generateId(),
        botName: this.botName,
        type: 'threat_warning',
        message: `${prettifyName(threat.source)} spotted`,
        priority: Math.min(10, Math.round(threat.dangerLevel)),
        position: threat.position,
        timestamp: Date.now(),
      };

      out.push(announcement);
      this.lastAnnouncedAt.set(`threat_warning:${discriminator}`, Date.now());
    }
  }

  private checkRequestHelp(state: CommunicatorState, out: Announcement[]): void {
    if (state.health >= 6) return;

    const hostiles = state.threats.filter(
      (t) => t.type === 'hostile_mob' || t.type === 'player_threat',
    );
    if (hostiles.length === 0) return;

    if (!this.shouldAnnounce('request_help', this.lastAnnouncedAt)) return;

    const closestHostile = hostiles.reduce((a, b) => (a.distance < b.distance ? a : b));
    const position = closestHostile.position;

    const announcement: Announcement = {
      id: generateId(),
      botName: this.botName,
      type: 'request_help',
      message: `I need help! Under attack by ${prettifyName(closestHostile.source)}`,
      priority: Math.min(10, Math.round(10 - state.health * 0.5 + closestHostile.dangerLevel * 0.3)),
      position,
      timestamp: Date.now(),
    };

    out.push(announcement);
    this.lastAnnouncedAt.set('request_help', Date.now());
  }

  private checkResourceAlerts(state: CommunicatorState, out: Announcement[]): void {
    // Build a set of current opportunity keys
    const currentKeys = new Set<string>();
    for (const opp of state.opportunities) {
      if (opp.value >= 5) {
        const key = `${opp.name}:${Math.round(opp.position.x)},${Math.round(opp.position.z)}`;
        currentKeys.add(key);
      }
    }

    // Check if any previously known resources have disappeared (depleted)
    for (const [posKey, position] of this.knownResourcePositions.entries()) {
      if (currentKeys.has(posKey)) continue;
      // This resource is no longer present -- it was depleted
      if (!this.previousOpportunityKeys.has(posKey)) continue;

      const resourceName = posKey.split(':')[0];
      const discriminator = posKey;
      if (!this.shouldAnnounce('resource_alert', this.lastAnnouncedAt, discriminator)) continue;

      const announcement: Announcement = {
        id: generateId(),
        botName: this.botName,
        type: 'resource_alert',
        message: `${prettifyName(resourceName)} vein is exhausted`,
        priority: 5,
        position,
        timestamp: Date.now(),
      };

      out.push(announcement);
      this.lastAnnouncedAt.set(`resource_alert:${discriminator}`, Date.now());
      this.knownResourcePositions.delete(posKey);
    }

    // Update previous keys for next tick
    this.previousOpportunityKeys = currentKeys;
  }

  private checkStatusUpdate(state: CommunicatorState, out: Announcement[]): void {
    if (!state.currentTask) return;
    if (!this.shouldAnnounce('status_update', this.lastAnnouncedAt)) return;

    const announcement: Announcement = {
      id: generateId(),
      botName: this.botName,
      type: 'status_update',
      message: `Still working on: ${state.currentTask}`,
      priority: 2,
      timestamp: Date.now(),
    };

    out.push(announcement);
    this.lastAnnouncedAt.set('status_update', Date.now());
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getFlavor(type: Announcement['type']): string {
    const flavors = PERSONALITY_FLAVOR[this.personality];
    if (!flavors) return '';
    return flavors[type] || '';
  }
}
