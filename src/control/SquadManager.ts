import { Server as SocketIOServer } from 'socket.io';
import { SquadRecord, FLEET_EVENTS } from './FleetTypes';
import { logger } from '../util/logger';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const SQUADS_FILE = path.join(DATA_DIR, 'squads.json');
const DEBOUNCE_MS = 1_000;

function generateId(): string {
  return `sqd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class SquadManager {
  private squads: Map<string, SquadRecord> = new Map();
  private io: SocketIOServer;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.load();
  }

  // ── Persistence ──────────────────────────────────────

  private load(): void {
    try {
      if (!fs.existsSync(SQUADS_FILE)) return;

      const raw = fs.readFileSync(SQUADS_FILE, 'utf-8');
      const records = JSON.parse(raw);

      if (!Array.isArray(records)) {
        logger.warn('squads.json is corrupt (not an array), starting fresh');
        return;
      }

      for (const rec of records) {
        this.squads.set(rec.id, rec);
      }
      logger.info({ count: records.length }, 'Loaded squads from disk');
    } catch (err) {
      logger.warn({ err }, 'Failed to load squads.json, starting fresh');
      this.squads.clear();
    }
  }

  /** Schedule a debounced save */
  private save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveImmediate();
    }, DEBOUNCE_MS);
  }

  /** Write to disk immediately */
  private saveImmediate(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const records = Array.from(this.squads.values());
      fs.writeFileSync(SQUADS_FILE, JSON.stringify(records, null, 2), 'utf-8');
    } catch (err) {
      logger.error({ err }, 'Failed to save squads.json');
    }
  }

  /** Flush pending saves and clear timers */
  shutdown(): void {
    this.saveImmediate();
  }

  private emitUpdate(): void {
    this.io.emit(FLEET_EVENTS.SQUAD_UPDATED, this.getSquads());
  }

  // ── CRUD ─────────────────────────────────────────────

  createSquad(data: {
    name: string;
    botNames: string[];
    defaultRole?: string;
    homeMarkerId?: string;
  }): SquadRecord {
    const now = Date.now();
    const squad: SquadRecord = {
      id: generateId(),
      name: data.name,
      botNames: data.botNames ?? [],
      defaultRole: data.defaultRole,
      homeMarkerId: data.homeMarkerId,
      createdAt: now,
      updatedAt: now,
    };
    this.squads.set(squad.id, squad);
    this.save();
    this.emitUpdate();
    logger.info({ squadId: squad.id, name: squad.name, action: 'create' }, 'Squad created');
    return squad;
  }

  getSquads(): SquadRecord[] {
    return Array.from(this.squads.values());
  }

  getSquad(id: string): SquadRecord | null {
    return this.squads.get(id) ?? null;
  }

  updateSquad(id: string, data: Partial<SquadRecord>): SquadRecord | null {
    const existing = this.squads.get(id);
    if (!existing) return null;

    // Prevent overwriting immutable fields
    const { id: _id, createdAt: _ca, ...safeData } = data;

    const updated: SquadRecord = {
      ...existing,
      ...safeData,
      updatedAt: Date.now(),
    };
    this.squads.set(id, updated);
    this.save();
    this.emitUpdate();
    logger.info({ squadId: id, name: updated.name, action: 'update' }, 'Squad updated');
    return updated;
  }

  deleteSquad(id: string): boolean {
    const squad = this.squads.get(id);
    const existed = this.squads.delete(id);
    if (existed) {
      this.save();
      this.emitUpdate();
      logger.info({ squadId: id, name: squad?.name, action: 'delete' }, 'Squad deleted');
    }
    return existed;
  }

  // ── Membership helpers ───────────────────────────────

  addBotToSquad(squadId: string, botName: string): boolean {
    const squad = this.squads.get(squadId);
    if (!squad) return false;
    if (squad.botNames.includes(botName)) return true; // already a member

    squad.botNames.push(botName);
    squad.updatedAt = Date.now();
    this.save();
    this.emitUpdate();
    logger.info({ squadId, name: squad.name, action: 'add_bot' }, 'Bot added to squad');
    return true;
  }

  removeBotFromSquad(squadId: string, botName: string): boolean {
    const squad = this.squads.get(squadId);
    if (!squad) return false;

    const idx = squad.botNames.indexOf(botName);
    if (idx === -1) return false;

    squad.botNames.splice(idx, 1);
    squad.updatedAt = Date.now();
    this.save();
    this.emitUpdate();
    logger.info({ squadId, name: squad.name, action: 'remove_bot' }, 'Bot removed from squad');
    return true;
  }

  getSquadsForBot(botName: string): SquadRecord[] {
    return this.getSquads().filter((s) => s.botNames.includes(botName));
  }
}
