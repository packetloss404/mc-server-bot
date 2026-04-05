/**
 * CommanderService — command templates, context-aware suggestions, and saved routines.
 *
 * Templates are structured NL command patterns with typed placeholders.
 * Suggestions are templates filtered/ranked by the current fleet state.
 * Routines are user-saved sequences of template invocations.
 */

import fs from 'fs';
import path from 'path';
import { BotManager } from '../bot/BotManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlaceholderType = 'bot' | 'zone' | 'item' | 'number' | 'player' | 'position';

export interface TemplatePlaceholder {
  key: string;          // e.g. "bot", "zone", "amount"
  type: PlaceholderType;
  label: string;        // human-readable label
  default?: string;
}

export interface CommandTemplate {
  id: string;
  category: 'fleet' | 'combat' | 'gathering' | 'building' | 'exploration' | 'utility';
  name: string;
  description: string;
  /** The NL command text with {placeholder} tokens */
  template: string;
  placeholders: TemplatePlaceholder[];
  /** Tags used for suggestion matching */
  tags: string[];
  /** Icon hint for the frontend (emoji) */
  icon: string;
}

export interface ContextSuggestion {
  template: CommandTemplate;
  reason: string;
  priority: number; // higher = more relevant
}

export interface SavedRoutine {
  id: string;
  name: string;
  description: string;
  /** Ordered list of template IDs with filled-in placeholder values */
  steps: RoutineStep[];
  createdAt: number;
  updatedAt: number;
}

export interface RoutineStep {
  templateId: string;
  /** Filled placeholder values keyed by placeholder key */
  values: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Built-in templates (15 total)
// ---------------------------------------------------------------------------

export const COMMAND_TEMPLATES: CommandTemplate[] = [
  {
    id: 'fleet-pause-all',
    category: 'fleet',
    name: 'Pause All Bots',
    description: 'Immediately pause every active bot',
    template: 'Pause all bots',
    placeholders: [],
    tags: ['pause', 'all', 'stop', 'idle', 'fleet'],
    icon: '⏸',
  },
  {
    id: 'fleet-resume-all',
    category: 'fleet',
    name: 'Resume All Bots',
    description: 'Resume every paused bot',
    template: 'Resume all bots',
    placeholders: [],
    tags: ['resume', 'all', 'start', 'fleet'],
    icon: '▶',
  },
  {
    id: 'fleet-send-guards',
    category: 'fleet',
    name: 'Send Guards to Base',
    description: 'Order all guard-role bots to return to base',
    template: 'Send all guards to the base',
    placeholders: [],
    tags: ['guard', 'base', 'move', 'defend', 'fleet'],
    icon: '🛡',
  },
  {
    id: 'gather-item',
    category: 'gathering',
    name: 'Gather Resources',
    description: 'Have a bot gather a specific amount of an item',
    template: 'Have {bot} gather {amount} {item}',
    placeholders: [
      { key: 'bot', type: 'bot', label: 'Bot name' },
      { key: 'amount', type: 'number', label: 'Amount', default: '64' },
      { key: 'item', type: 'item', label: 'Item name', default: 'iron_ore' },
    ],
    tags: ['gather', 'mine', 'collect', 'resource', 'item'],
    icon: '⛏',
  },
  {
    id: 'gather-wood',
    category: 'gathering',
    name: 'Chop Wood',
    description: 'Send a bot to chop wood',
    template: 'Have {bot} chop {amount} wood logs',
    placeholders: [
      { key: 'bot', type: 'bot', label: 'Bot name' },
      { key: 'amount', type: 'number', label: 'Amount', default: '64' },
    ],
    tags: ['wood', 'chop', 'log', 'gather', 'tree'],
    icon: '🪓',
  },
  {
    id: 'combat-patrol',
    category: 'combat',
    name: 'Start Patrol',
    description: 'Have a bot patrol a zone',
    template: 'Have {bot} patrol the {zone} zone',
    placeholders: [
      { key: 'bot', type: 'bot', label: 'Bot name' },
      { key: 'zone', type: 'zone', label: 'Zone name', default: 'base' },
    ],
    tags: ['patrol', 'guard', 'combat', 'zone', 'defend'],
    icon: '🗡',
  },
  {
    id: 'combat-guard-player',
    category: 'combat',
    name: 'Guard a Player',
    description: 'Assign a bot to follow and protect a player',
    template: 'Have {bot} guard player {player}',
    placeholders: [
      { key: 'bot', type: 'bot', label: 'Bot name' },
      { key: 'player', type: 'player', label: 'Player name' },
    ],
    tags: ['guard', 'follow', 'protect', 'player', 'combat'],
    icon: '🛡',
  },
  {
    id: 'exploration-scout',
    category: 'exploration',
    name: 'Scout Area',
    description: 'Send a bot to explore and report on an area',
    template: 'Have {bot} scout the area around {position}',
    placeholders: [
      { key: 'bot', type: 'bot', label: 'Bot name' },
      { key: 'position', type: 'position', label: 'Coordinates (x, y, z)', default: '0, 64, 0' },
    ],
    tags: ['scout', 'explore', 'recon', 'area'],
    icon: '🔭',
  },
  {
    id: 'exploration-find-biome',
    category: 'exploration',
    name: 'Find Biome',
    description: 'Send a bot to locate a specific biome type',
    template: 'Have {bot} find a {item} biome',
    placeholders: [
      { key: 'bot', type: 'bot', label: 'Bot name' },
      { key: 'item', type: 'item', label: 'Biome type', default: 'desert' },
    ],
    tags: ['find', 'biome', 'explore', 'locate'],
    icon: '🧭',
  },
  {
    id: 'building-build-at',
    category: 'building',
    name: 'Build Structure',
    description: 'Have a bot build a structure at a location',
    template: 'Have {bot} build a {item} at {position}',
    placeholders: [
      { key: 'bot', type: 'bot', label: 'Bot name' },
      { key: 'item', type: 'item', label: 'Structure type', default: 'house' },
      { key: 'position', type: 'position', label: 'Coordinates (x, y, z)', default: '0, 64, 0' },
    ],
    tags: ['build', 'construct', 'place', 'structure'],
    icon: '🏗',
  },
  {
    id: 'utility-follow-player',
    category: 'utility',
    name: 'Follow Player',
    description: 'Have a bot follow a player around',
    template: 'Have {bot} follow player {player}',
    placeholders: [
      { key: 'bot', type: 'bot', label: 'Bot name' },
      { key: 'player', type: 'player', label: 'Player name' },
    ],
    tags: ['follow', 'player', 'move', 'utility'],
    icon: '🚶',
  },
  {
    id: 'utility-move-to',
    category: 'utility',
    name: 'Move Bot to Position',
    description: 'Walk a bot to specific coordinates',
    template: 'Move {bot} to {position}',
    placeholders: [
      { key: 'bot', type: 'bot', label: 'Bot name' },
      { key: 'position', type: 'position', label: 'Coordinates (x, y, z)', default: '0, 64, 0' },
    ],
    tags: ['move', 'walk', 'go', 'position', 'utility'],
    icon: '📍',
  },
  {
    id: 'fleet-mining-op',
    category: 'gathering',
    name: 'Start Mining Operation',
    description: 'Start a coordinated mining operation at a zone',
    template: 'Start mining operation at {zone}',
    placeholders: [
      { key: 'zone', type: 'zone', label: 'Zone name', default: 'mine' },
    ],
    tags: ['mine', 'operation', 'zone', 'fleet', 'gather'],
    icon: '⚒',
  },
  {
    id: 'utility-craft-item',
    category: 'utility',
    name: 'Craft Items',
    description: 'Have a bot craft a specific item',
    template: 'Have {bot} craft {amount} {item}',
    placeholders: [
      { key: 'bot', type: 'bot', label: 'Bot name' },
      { key: 'amount', type: 'number', label: 'Amount', default: '1' },
      { key: 'item', type: 'item', label: 'Item name', default: 'iron_pickaxe' },
    ],
    tags: ['craft', 'make', 'create', 'item'],
    icon: '🔨',
  },
  {
    id: 'fleet-recall-all',
    category: 'fleet',
    name: 'Recall All to Base',
    description: 'Bring every bot back to the base location',
    template: 'Recall all bots to base',
    placeholders: [],
    tags: ['recall', 'base', 'return', 'all', 'fleet'],
    icon: '🏠',
  },
];

// ---------------------------------------------------------------------------
// Routines persistence
// ---------------------------------------------------------------------------

const ROUTINES_PATH = path.join(process.cwd(), 'data', 'routines.json');

function loadRoutines(): SavedRoutine[] {
  try {
    if (fs.existsSync(ROUTINES_PATH)) {
      return JSON.parse(fs.readFileSync(ROUTINES_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveRoutines(routines: SavedRoutine[]): void {
  const dir = path.dirname(ROUTINES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ROUTINES_PATH, JSON.stringify(routines, null, 2));
}

// ---------------------------------------------------------------------------
// CommanderService
// ---------------------------------------------------------------------------

export class CommanderService {
  private routines: SavedRoutine[];

  constructor(private botManager?: BotManager) {
    this.routines = loadRoutines();
  }

  // -- Templates -----------------------------------------------------------

  /** Return all built-in templates */
  getTemplates(): CommandTemplate[] {
    return COMMAND_TEMPLATES;
  }

  /** Get templates filtered by category */
  getTemplatesByCategory(category: string): CommandTemplate[] {
    return COMMAND_TEMPLATES.filter((t) => t.category === category);
  }

  /** Search templates by keyword (matches name, description, tags) */
  searchTemplates(query: string): CommandTemplate[] {
    const q = query.toLowerCase().trim();
    if (!q) return COMMAND_TEMPLATES;
    return COMMAND_TEMPLATES.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q)),
    );
  }

  /** Fill a template with provided values, returning the NL command string */
  fillTemplate(templateId: string, values: Record<string, string>): string | null {
    const tmpl = COMMAND_TEMPLATES.find((t) => t.id === templateId);
    if (!tmpl) return null;
    let text = tmpl.template;
    for (const ph of tmpl.placeholders) {
      const val = values[ph.key] ?? ph.default ?? `{${ph.key}}`;
      text = text.replace(`{${ph.key}}`, val);
    }
    return text;
  }

  // -- Context-aware suggestions -------------------------------------------

  /**
   * Generate suggestions based on current bot states.
   * Returns templates ranked by relevance to fleet state.
   */
  getSuggestions(): ContextSuggestion[] {
    const suggestions: ContextSuggestion[] = [];
    if (!this.botManager) return suggestions;

    const statuses = this.botManager.getAllBotStatuses();
    if (statuses.length === 0) return suggestions;

    const idleBots = statuses.filter((b) => b.state === 'IDLE' || b.state === 'idle');
    const activeBots = statuses.filter((b) => b.state !== 'IDLE' && b.state !== 'idle' && b.state !== 'DISCONNECTED');
    const pausedBots = statuses.filter((b) => b.state === 'PAUSED' || b.state === 'paused');
    const guardBots = statuses.filter((b) => b.personality === 'guard');
    const farmerBots = statuses.filter((b) => b.personality === 'farmer');

    // If there are idle bots, suggest patrol / gather / exploration
    if (idleBots.length > 0) {
      suggestions.push({
        template: COMMAND_TEMPLATES.find((t) => t.id === 'combat-patrol')!,
        reason: `${idleBots.length} bot${idleBots.length > 1 ? 's' : ''} idle -- start a patrol`,
        priority: 80,
      });
      suggestions.push({
        template: COMMAND_TEMPLATES.find((t) => t.id === 'gather-item')!,
        reason: `${idleBots.length} bot${idleBots.length > 1 ? 's' : ''} idle -- put them to work gathering`,
        priority: 75,
      });
      suggestions.push({
        template: COMMAND_TEMPLATES.find((t) => t.id === 'exploration-scout')!,
        reason: `${idleBots.length} idle bot${idleBots.length > 1 ? 's' : ''} could scout new areas`,
        priority: 60,
      });
    }

    // If there are paused bots, suggest resume
    if (pausedBots.length > 0) {
      suggestions.push({
        template: COMMAND_TEMPLATES.find((t) => t.id === 'fleet-resume-all')!,
        reason: `${pausedBots.length} bot${pausedBots.length > 1 ? 's' : ''} paused -- resume them`,
        priority: 90,
      });
    }

    // If all bots are active, suggest pause or recall
    if (activeBots.length === statuses.length && statuses.length > 0) {
      suggestions.push({
        template: COMMAND_TEMPLATES.find((t) => t.id === 'fleet-pause-all')!,
        reason: 'All bots active -- pause if needed',
        priority: 40,
      });
      suggestions.push({
        template: COMMAND_TEMPLATES.find((t) => t.id === 'fleet-recall-all')!,
        reason: 'All bots active -- recall to regroup',
        priority: 35,
      });
    }

    // Guards available? suggest guard duties
    if (guardBots.length > 0) {
      suggestions.push({
        template: COMMAND_TEMPLATES.find((t) => t.id === 'fleet-send-guards')!,
        reason: `${guardBots.length} guard bot${guardBots.length > 1 ? 's' : ''} available`,
        priority: 65,
      });
      suggestions.push({
        template: COMMAND_TEMPLATES.find((t) => t.id === 'combat-guard-player')!,
        reason: 'Guard bots can protect a player',
        priority: 55,
      });
    }

    // Farmers available? suggest gathering
    if (farmerBots.length > 0) {
      suggestions.push({
        template: COMMAND_TEMPLATES.find((t) => t.id === 'gather-wood')!,
        reason: `${farmerBots.length} farmer bot${farmerBots.length > 1 ? 's' : ''} -- could gather wood`,
        priority: 60,
      });
    }

    // Mining operation suggestion when 2+ bots
    if (statuses.length >= 2) {
      suggestions.push({
        template: COMMAND_TEMPLATES.find((t) => t.id === 'fleet-mining-op')!,
        reason: `${statuses.length} bots available for a mining operation`,
        priority: 50,
      });
    }

    // Sort by priority descending, deduplicate by template id
    const seen = new Set<string>();
    return suggestions
      .filter((s) => s.template != null)
      .sort((a, b) => b.priority - a.priority)
      .filter((s) => {
        if (seen.has(s.template.id)) return false;
        seen.add(s.template.id);
        return true;
      })
      .slice(0, 6);
  }

  // -- Routines ------------------------------------------------------------

  getRoutines(): SavedRoutine[] {
    return this.routines;
  }

  getRoutine(id: string): SavedRoutine | undefined {
    return this.routines.find((r) => r.id === id);
  }

  createRoutine(name: string, description: string, steps: RoutineStep[]): SavedRoutine {
    const routine: SavedRoutine = {
      id: `routine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description,
      steps,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.routines.push(routine);
    saveRoutines(this.routines);
    return routine;
  }

  updateRoutine(id: string, patch: Partial<Pick<SavedRoutine, 'name' | 'description' | 'steps'>>): SavedRoutine | null {
    const idx = this.routines.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    this.routines[idx] = { ...this.routines[idx], ...patch, updatedAt: Date.now() };
    saveRoutines(this.routines);
    return this.routines[idx];
  }

  deleteRoutine(id: string): boolean {
    const idx = this.routines.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.routines.splice(idx, 1);
    saveRoutines(this.routines);
    return true;
  }

  /** Expand a routine into a list of filled NL command strings */
  expandRoutine(id: string): string[] | null {
    const routine = this.getRoutine(id);
    if (!routine) return null;
    return routine.steps
      .map((step) => this.fillTemplate(step.templateId, step.values))
      .filter((s): s is string => s !== null);
  }
}
