/* ── SquadManager: squad CRUD with bot membership ── */

import { randomUUID } from 'crypto';
import { Squad } from './FleetTypes';

export class SquadManager {
  private squads: Map<string, Squad> = new Map();

  create(name: string, description = ''): Squad {
    const id = randomUUID();
    const now = Date.now();
    const squad: Squad = { id, name, description, members: [], createdAt: now, updatedAt: now };
    this.squads.set(id, squad);
    return squad;
  }

  get(squadId: string): Squad | undefined {
    return this.squads.get(squadId);
  }

  list(): Squad[] {
    return [...this.squads.values()];
  }

  update(squadId: string, patch: Partial<Pick<Squad, 'name' | 'description'>>): Squad | undefined {
    const s = this.squads.get(squadId);
    if (!s) return undefined;
    if (patch.name !== undefined) s.name = patch.name;
    if (patch.description !== undefined) s.description = patch.description;
    s.updatedAt = Date.now();
    return s;
  }

  delete(squadId: string): boolean {
    return this.squads.delete(squadId);
  }

  addMember(squadId: string, botName: string): boolean {
    const s = this.squads.get(squadId);
    if (!s) return false;
    if (s.members.includes(botName)) return false;
    s.members.push(botName);
    s.updatedAt = Date.now();
    return true;
  }

  removeMember(squadId: string, botName: string): boolean {
    const s = this.squads.get(squadId);
    if (!s) return false;
    const idx = s.members.indexOf(botName);
    if (idx < 0) return false;
    s.members.splice(idx, 1);
    s.updatedAt = Date.now();
    return true;
  }

  /** Find all squads that contain a given bot */
  getSquadsForBot(botName: string): Squad[] {
    return this.list().filter((s) => s.members.includes(botName));
  }

  toJSON(): Squad[] {
    return this.list();
  }

  loadFrom(squads: Squad[]): void {
    this.squads.clear();
    for (const s of squads) this.squads.set(s.id, s);
  }
}
