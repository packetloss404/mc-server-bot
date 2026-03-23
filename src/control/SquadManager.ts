/**
 * SquadManager — manages squads (groups of bots).
 * Stub: real implementation will replace this file.
 */

export interface Squad {
  id: string;
  name: string;
  members: string[];
  createdAt: number;
}

let idCounter = 0;

export class SquadManager {
  private squads: Map<string, Squad> = new Map();

  createSquad(name: string, members: string[] = []): Squad {
    const now = Date.now();
    const id = `squad-${++idCounter}-${now}`;
    const squad: Squad = { id, name, members: [...members], createdAt: now };
    this.squads.set(id, squad);
    return squad;
  }

  addMember(squadId: string, botName: string): Squad {
    const squad = this.squads.get(squadId);
    if (!squad) throw new Error(`Squad ${squadId} not found`);
    if (!squad.members.includes(botName)) {
      squad.members.push(botName);
    }
    return squad;
  }

  removeMember(squadId: string, botName: string): Squad {
    const squad = this.squads.get(squadId);
    if (!squad) throw new Error(`Squad ${squadId} not found`);
    squad.members = squad.members.filter((m) => m !== botName);
    return squad;
  }

  getSquad(id: string): Squad | undefined {
    return this.squads.get(id);
  }

  getSquadsForBot(botName: string): Squad[] {
    return Array.from(this.squads.values()).filter((s) => s.members.includes(botName));
  }

  getAllSquads(): Squad[] {
    return Array.from(this.squads.values());
  }
}
