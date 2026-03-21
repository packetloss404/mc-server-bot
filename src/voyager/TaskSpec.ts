import { Task } from './CurriculumAgent';

export type TaskKind = 'harvest' | 'craft' | 'smelt' | 'movement' | 'combat' | 'chat' | 'general';

export interface TaskSpec {
  kind: TaskKind;
  target?: string;
  count?: number;
  destination?: string;
  prerequisites?: string[];
}

export function inferTaskSpec(task: Task): TaskSpec {
  if (task.spec) return task.spec;
  const lower = task.description.toLowerCase();
  const count = Number(lower.match(/\b(\d+)\b/)?.[1] || 1);

  if (lower.includes('craft')) {
    return { kind: 'craft', target: inferTarget(lower), count, prerequisites: inferPrerequisites(lower) };
  }
  if (lower.includes('smelt')) {
    return { kind: 'smelt', target: inferTarget(lower), count, prerequisites: inferPrerequisites(lower) };
  }
  if (lower.includes('mine') || lower.includes('collect') || lower.includes('gather') || lower.includes('chop')) {
    return { kind: 'harvest', target: inferTarget(lower), count };
  }
  if (lower.includes('walk') || lower.includes('go to') || lower.includes('explore') || lower.includes('patrol') || lower.includes('move')) {
    return { kind: 'movement', destination: inferDestination(lower), target: inferTarget(lower), count };
  }
  if (lower.includes('kill') || lower.includes('attack') || lower.includes('fight')) {
    return { kind: 'combat', target: inferCombatTarget(lower), count };
  }
  if (lower.includes('chat') || lower.includes('announce') || lower.includes('say') || lower.includes('talk') || lower.includes('wisdom')) {
    return { kind: 'chat', count: 1 };
  }
  return { kind: 'general', target: inferTarget(lower), count };
}

function inferTarget(lower: string): string | undefined {
  const explicit = lower.match(/oak log|crafting table|iron ore|coal ore|wheat seeds|wooden hoe|wooden pickaxe|cobblestone|farmland|water/);
  if (explicit?.[0]) return explicit[0].replace(/\s+/g, '_');
  const words = lower.replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter(Boolean);
  const stop = new Set(['mine','collect','gather','chop','craft','smelt','walk','go','to','the','nearest','find','explore','and','a','an','by','with','use','attack','fight','kill','report','player','slowly','around','observe']);
  const candidates = words.filter((word) => !stop.has(word) && !/^\d+$/.test(word));
  return candidates.length ? candidates.slice(-2).join('_') : undefined;
}

function inferCombatTarget(lower: string): string | undefined {
  return (lower.match(/kill\s+(?:a|an|the)?\s*([a-z_]+)/) || lower.match(/attack\s+(?:a|an|the)?\s*([a-z_]+)/) || lower.match(/fight\s+(?:a|an|the)?\s*([a-z_]+)/))?.[1];
}

function inferDestination(lower: string): string | undefined {
  if (lower.includes('farmland')) return 'farmland';
  if (lower.includes('player')) return 'player';
  if (lower.includes('village')) return 'village';
  if (lower.includes('north')) return 'north';
  if (lower.includes('east')) return 'east';
  if (lower.includes('water')) return 'water';
  return undefined;
}

function inferPrerequisites(lower: string): string[] {
  if (lower.includes('wooden hoe')) return ['oak_log', 'crafting_table'];
  if (lower.includes('wooden pickaxe')) return ['oak_log', 'crafting_table'];
  return [];
}
