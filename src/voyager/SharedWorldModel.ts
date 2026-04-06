import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface SharedResourceRecord {
  name: string;
  kind: 'resource' | 'workstation' | 'container';
  position: { x: number; y: number; z: number };
  confidence: number;
  observedBy: string[];
  firstSeen: number;
  lastSeen: number;
  metadata?: Record<string, unknown>;
}

export interface SharedThreatRecord {
  type: string;
  source: string;
  position: { x: number; y: number; z: number };
  dangerLevel: number;
  reportedBy: string;
  reportedAt: number;
  expiresAt: number;
}

export interface BotStateRecord {
  name: string;
  position: { x: number; y: number; z: number };
  state: 'idle' | 'working' | 'combat' | 'trading' | 'exploring';
  currentTask?: string;
  health: number;
  food: number;
  updatedAt: number;
}

export interface SharedWorldState {
  resources: SharedResourceRecord[];
  threats: SharedThreatRecord[];
  bots: BotStateRecord[];
  exploredChunks: Set<string>;
  serverTime: number;
  weather: string;
}

// ── Serializable shape for persistence ──────────────────────────────────────

interface PersistedState {
  resources: SharedResourceRecord[];
  threats: SharedThreatRecord[];
  bots: BotStateRecord[];
  exploredChunks: string[];
  serverTime: number;
  weather: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const SPATIAL_MERGE_DISTANCE = 6;
const DEFAULT_THREAT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CONFIDENCE_DECAY_PER_HOUR = 0.05;
const STALE_RESOURCE_THRESHOLD = 0.05;
const PERSIST_DEBOUNCE_MS = 2000;
const MAX_RESOURCES = 500;

// ── Helpers ─────────────────────────────────────────────────────────────────

function dist2d(
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function dist3d(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ── SharedWorldModel ────────────────────────────────────────────────────────

export class SharedWorldModel {
  private resources: SharedResourceRecord[] = [];
  private threats: SharedThreatRecord[] = [];
  private bots: Map<string, BotStateRecord> = new Map();
  private exploredChunks: Set<string> = new Set();
  private serverTime = 0;
  private weather = 'clear';

  private filePath: string;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(persistencePath?: string) {
    this.filePath = persistencePath ?? path.join('data', 'shared_world.json');
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.load();
  }

  // ── Mutation methods ────────────────────────────────────────────────────

  reportResource(botName: string, record: SharedResourceRecord): void {
    const existing = this.resources.find(
      (r) =>
        r.name === record.name &&
        dist3d(r.position, record.position) < SPATIAL_MERGE_DISTANCE,
    );

    if (existing) {
      // Merge: update position to most recent, bump confidence, add observer
      existing.position = record.position;
      existing.confidence = Math.min(1, Math.max(existing.confidence, record.confidence));
      existing.lastSeen = Math.max(existing.lastSeen, record.lastSeen);
      if (!existing.observedBy.includes(botName)) {
        existing.observedBy.push(botName);
      }
      if (record.metadata) {
        existing.metadata = { ...existing.metadata, ...record.metadata };
      }
    } else {
      const newRecord: SharedResourceRecord = {
        ...record,
        observedBy: record.observedBy.includes(botName)
          ? [...record.observedBy]
          : [botName, ...record.observedBy],
      };
      this.resources.push(newRecord);

      // Evict oldest if over limit
      if (this.resources.length > MAX_RESOURCES) {
        this.resources.sort((a, b) => b.lastSeen - a.lastSeen);
        this.resources = this.resources.slice(0, MAX_RESOURCES);
      }
    }

    this.schedulePersist();
  }

  reportThreat(botName: string, threat: SharedThreatRecord): void {
    const now = Date.now();
    const record: SharedThreatRecord = {
      ...threat,
      reportedBy: botName,
      reportedAt: now,
      expiresAt: threat.expiresAt || now + DEFAULT_THREAT_TTL_MS,
    };
    this.threats.push(record);
    logger.debug({ botName, type: threat.type, source: threat.source }, 'Threat reported to shared world');
    this.schedulePersist();
  }

  updateBotState(state: BotStateRecord): void {
    this.bots.set(state.name, { ...state, updatedAt: Date.now() });
    this.schedulePersist();
  }

  markChunkExplored(chunkX: number, chunkZ: number): void {
    const key = `${chunkX},${chunkZ}`;
    if (!this.exploredChunks.has(key)) {
      this.exploredChunks.add(key);
      this.schedulePersist();
    }
  }

  updateServerState(time: number, weather: string): void {
    this.serverTime = time;
    this.weather = weather;
    this.schedulePersist();
  }

  // ── Query methods ───────────────────────────────────────────────────────

  queryResourcesNear(
    x: number,
    z: number,
    radius: number,
    kind?: string,
  ): SharedResourceRecord[] {
    return this.resources.filter((r) => {
      if (kind && r.kind !== kind) return false;
      return dist2d({ x, z }, { x: r.position.x, z: r.position.z }) <= radius;
    });
  }

  queryThreatsNear(
    x: number,
    z: number,
    radius: number,
  ): SharedThreatRecord[] {
    const now = Date.now();
    return this.threats.filter((t) => {
      if (t.expiresAt <= now) return false;
      return dist2d({ x, z }, { x: t.position.x, z: t.position.z }) <= radius;
    });
  }

  getIdleBots(): BotStateRecord[] {
    return Array.from(this.bots.values()).filter((b) => b.state === 'idle');
  }

  getBotPositions(): Array<{ name: string; position: { x: number; y: number; z: number } }> {
    return Array.from(this.bots.values()).map((b) => ({
      name: b.name,
      position: b.position,
    }));
  }

  getExplorationGaps(
    centerX: number,
    centerZ: number,
    radius: number,
  ): Array<{ chunkX: number; chunkZ: number }> {
    const chunkRadius = Math.ceil(radius / 16);
    const centerChunkX = Math.floor(centerX / 16);
    const centerChunkZ = Math.floor(centerZ / 16);
    const gaps: Array<{ chunkX: number; chunkZ: number }> = [];

    for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
      for (let dz = -chunkRadius; dz <= chunkRadius; dz++) {
        const cx = centerChunkX + dx;
        const cz = centerChunkZ + dz;
        if (!this.exploredChunks.has(`${cx},${cz}`)) {
          gaps.push({ chunkX: cx, chunkZ: cz });
        }
      }
    }

    // Sort by distance to center (closest first)
    gaps.sort((a, b) => {
      const da = (a.chunkX - centerChunkX) ** 2 + (a.chunkZ - centerChunkZ) ** 2;
      const db = (b.chunkX - centerChunkX) ** 2 + (b.chunkZ - centerChunkZ) ** 2;
      return da - db;
    });

    return gaps;
  }

  getResourceSupply(): Record<string, number> {
    const supply: Record<string, number> = {};
    for (const r of this.resources) {
      supply[r.name] = (supply[r.name] || 0) + 1;
    }
    return supply;
  }

  isAreaSafe(x: number, z: number, radius: number): boolean {
    return this.queryThreatsNear(x, z, radius).length === 0;
  }

  // ── Maintenance ─────────────────────────────────────────────────────────

  pruneExpired(): void {
    const now = Date.now();

    // Remove expired threats
    const beforeThreats = this.threats.length;
    this.threats = this.threats.filter((t) => t.expiresAt > now);

    // Decay resource confidence and remove stale records
    const beforeResources = this.resources.length;
    for (const r of this.resources) {
      const hoursElapsed = (now - r.lastSeen) / (1000 * 60 * 60);
      if (hoursElapsed > 0) {
        r.confidence = Math.max(0, r.confidence - CONFIDENCE_DECAY_PER_HOUR * hoursElapsed);
      }
    }
    this.resources = this.resources.filter((r) => r.confidence > STALE_RESOURCE_THRESHOLD);

    const removedThreats = beforeThreats - this.threats.length;
    const removedResources = beforeResources - this.resources.length;

    if (removedThreats > 0 || removedResources > 0) {
      logger.debug(
        { removedThreats, removedResources },
        'SharedWorldModel pruned expired records',
      );
      this.schedulePersist();
    }
  }

  getSnapshot(): SharedWorldState {
    return {
      resources: [...this.resources],
      threats: this.threats.filter((t) => t.expiresAt > Date.now()),
      bots: Array.from(this.bots.values()),
      exploredChunks: new Set(this.exploredChunks),
      serverTime: this.serverTime,
      weather: this.weather,
    };
  }

  mergeFromBotMemory(
    botName: string,
    records: Array<{
      kind: string;
      name: string;
      x: number;
      y: number;
      z: number;
      updatedAt: number;
    }>,
  ): void {
    for (const rec of records) {
      const kind = rec.kind as SharedResourceRecord['kind'];
      if (!['resource', 'workstation', 'container'].includes(kind)) continue;

      this.reportResource(botName, {
        name: rec.name,
        kind,
        position: { x: rec.x, y: rec.y, z: rec.z },
        confidence: 1,
        observedBy: [botName],
        firstSeen: rec.updatedAt,
        lastSeen: rec.updatedAt,
      });
    }
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  private persist(): void {
    try {
      const data: PersistedState = {
        resources: this.resources,
        threats: this.threats,
        bots: Array.from(this.bots.values()),
        exploredChunks: Array.from(this.exploredChunks),
        serverTime: this.serverTime,
        weather: this.weather,
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.error({ err }, 'Failed to persist SharedWorldModel');
    }
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data: PersistedState = JSON.parse(raw);

      this.resources = data.resources ?? [];
      this.threats = data.threats ?? [];
      this.serverTime = data.serverTime ?? 0;
      this.weather = data.weather ?? 'clear';

      if (Array.isArray(data.exploredChunks)) {
        this.exploredChunks = new Set(data.exploredChunks);
      }

      if (Array.isArray(data.bots)) {
        for (const b of data.bots) {
          this.bots.set(b.name, b);
        }
      }

      logger.info(
        {
          resources: this.resources.length,
          threats: this.threats.length,
          bots: this.bots.size,
          chunks: this.exploredChunks.size,
        },
        'SharedWorldModel loaded from disk',
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to load SharedWorldModel, starting fresh');
    }
  }
}
