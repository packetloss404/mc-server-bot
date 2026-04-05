import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';

// -- Types --

export type MissionType =
  | 'patrol'
  | 'gather'
  | 'craft'
  | 'escort'
  | 'supply_run'
  | 'guard'
  | 'build'
  | 'resupply'
  | 'queue_task';

export type FieldType = 'string' | 'number' | 'position' | 'string[]' | 'boolean';

export interface TemplateField {
  name: string;
  label: string;
  type: FieldType;
  description?: string;
  default?: unknown;
  required?: boolean;
  options?: string[];
}

export interface LoadoutPolicy {
  requiredItems?: { name: string; count: number }[];
  optionalItems?: { name: string; count: number }[];
  equipBestArmor?: boolean;
}

export interface MissionTemplate {
  id: string;
  name: string;
  description: string;
  category: 'combat' | 'gathering' | 'crafting' | 'logistics' | 'building';
  missionType: MissionType;
  defaultParams: Record<string, unknown>;
  requiredFields: TemplateField[];
  optionalFields?: TemplateField[];
  suggestedBotCount: number;
  loadoutPolicy?: LoadoutPolicy;
  builtIn: boolean;
}

// -- Built-in Templates --

const BUILT_IN_TEMPLATES: MissionTemplate[] = [
  {
    id: 'patrol-zone',
    name: 'Patrol Zone',
    description: 'Assign bots to patrol a defined area, visiting waypoints in sequence.',
    category: 'combat',
    missionType: 'patrol',
    defaultParams: { loopForever: true, pauseBetweenPoints: 2 },
    requiredFields: [
      { name: 'zoneName', label: 'Zone Name', type: 'string', description: 'Name of the zone or area to patrol' },
      { name: 'waypoints', label: 'Waypoints', type: 'string', description: 'Comma-separated coordinates: x1,z1;x2,z2;...' },
    ],
    optionalFields: [
      { name: 'loopForever', label: 'Loop Forever', type: 'boolean', default: true },
      { name: 'pauseBetweenPoints', label: 'Pause (seconds)', type: 'number', default: 2 },
      { name: 'alertOnHostiles', label: 'Alert on Hostiles', type: 'boolean', default: true },
    ],
    suggestedBotCount: 2,
    loadoutPolicy: { requiredItems: [{ name: 'iron_sword', count: 1 }], equipBestArmor: true },
    builtIn: true,
  },
  {
    id: 'gather-items',
    name: 'Gather Items',
    description: 'Send bots to mine or collect specific items from the world.',
    category: 'gathering',
    missionType: 'gather',
    defaultParams: { returnToBase: true },
    requiredFields: [
      { name: 'itemName', label: 'Item to Gather', type: 'string', description: 'Minecraft item name (e.g. oak_log, iron_ore)' },
      { name: 'quantity', label: 'Quantity', type: 'number', description: 'How many to collect' },
    ],
    optionalFields: [
      { name: 'searchRadius', label: 'Search Radius', type: 'number', default: 64 },
      { name: 'returnToBase', label: 'Return to Base', type: 'boolean', default: true },
      { name: 'basePosition', label: 'Base Position', type: 'position' },
    ],
    suggestedBotCount: 1,
    loadoutPolicy: { requiredItems: [{ name: 'iron_pickaxe', count: 1 }] },
    builtIn: true,
  },
  {
    id: 'craft-batch',
    name: 'Craft Batch',
    description: 'Craft a batch of items, gathering missing materials if needed.',
    category: 'crafting',
    missionType: 'craft',
    defaultParams: { gatherMissing: true },
    requiredFields: [
      { name: 'itemName', label: 'Item to Craft', type: 'string', description: 'Minecraft item name to craft' },
      { name: 'quantity', label: 'Quantity', type: 'number', description: 'How many to craft' },
    ],
    optionalFields: [
      { name: 'gatherMissing', label: 'Gather Missing Materials', type: 'boolean', default: true },
      { name: 'useCraftingTable', label: 'Use Crafting Table', type: 'boolean', default: true },
    ],
    suggestedBotCount: 1,
    builtIn: true,
  },
  {
    id: 'escort-player',
    name: 'Escort Player',
    description: 'Follow and protect a player, engaging any threats within range.',
    category: 'combat',
    missionType: 'escort',
    defaultParams: { followDistance: 4, engageHostiles: true },
    requiredFields: [
      { name: 'playerName', label: 'Player to Escort', type: 'string', description: 'Name of the player to follow' },
    ],
    optionalFields: [
      { name: 'followDistance', label: 'Follow Distance', type: 'number', default: 4 },
      { name: 'engageHostiles', label: 'Engage Hostiles', type: 'boolean', default: true },
      { name: 'engageRadius', label: 'Engage Radius', type: 'number', default: 8 },
    ],
    suggestedBotCount: 1,
    loadoutPolicy: { requiredItems: [{ name: 'iron_sword', count: 1 }, { name: 'shield', count: 1 }], equipBestArmor: true },
    builtIn: true,
  },
  {
    id: 'supply-run',
    name: 'Supply Run',
    description: 'Transport items between two locations.',
    category: 'logistics',
    missionType: 'supply_run',
    defaultParams: { repeat: true },
    requiredFields: [
      { name: 'fromPosition', label: 'Pick-up Location', type: 'position', description: 'Source coordinates (x, y, z)' },
      { name: 'toPosition', label: 'Drop-off Location', type: 'position', description: 'Destination coordinates (x, y, z)' },
      { name: 'items', label: 'Items to Transport', type: 'string', description: 'Comma-separated list: item:count, ...' },
    ],
    optionalFields: [
      { name: 'repeat', label: 'Repeat', type: 'boolean', default: true },
      { name: 'maxRuns', label: 'Max Runs', type: 'number', default: 0, description: '0 = unlimited' },
    ],
    suggestedBotCount: 1,
    builtIn: true,
  },
  {
    id: 'guard-area',
    name: 'Guard Area',
    description: 'Station bots to guard a specific area and engage hostile mobs or players.',
    category: 'combat',
    missionType: 'guard',
    defaultParams: { radius: 16, engagePlayers: false, engageMobs: true },
    requiredFields: [
      { name: 'position', label: 'Guard Position', type: 'position', description: 'Center of the guard zone' },
    ],
    optionalFields: [
      { name: 'radius', label: 'Guard Radius', type: 'number', default: 16 },
      { name: 'engageMobs', label: 'Engage Mobs', type: 'boolean', default: true },
      { name: 'engagePlayers', label: 'Engage Players', type: 'boolean', default: false },
    ],
    suggestedBotCount: 2,
    loadoutPolicy: { requiredItems: [{ name: 'iron_sword', count: 1 }], equipBestArmor: true },
    builtIn: true,
  },
  {
    id: 'build-schematic',
    name: 'Build Schematic',
    description: 'Build a structure at the given position using a task description for the AI.',
    category: 'building',
    missionType: 'build',
    defaultParams: {},
    requiredFields: [
      { name: 'description', label: 'Build Description', type: 'string', description: 'What to build (e.g. "a 5x5 cobblestone house")' },
      { name: 'position', label: 'Build Position', type: 'position', description: 'Where to build' },
    ],
    optionalFields: [
      { name: 'materials', label: 'Preferred Materials', type: 'string', description: 'Comma-separated block names' },
      { name: 'gatherMaterials', label: 'Gather Materials First', type: 'boolean', default: true },
    ],
    suggestedBotCount: 1,
    builtIn: true,
  },
  {
    id: 'resupply-builder',
    name: 'Resupply Builder',
    description: 'Keep a builder bot stocked with materials by ferrying supplies from storage.',
    category: 'logistics',
    missionType: 'resupply',
    defaultParams: { checkInterval: 30 },
    requiredFields: [
      { name: 'targetBot', label: 'Builder Bot', type: 'string', description: 'Name of the bot to resupply' },
      { name: 'storagePosition', label: 'Storage Location', type: 'position', description: 'Where to get materials' },
      { name: 'items', label: 'Items to Deliver', type: 'string', description: 'Comma-separated: item:count, ...' },
    ],
    optionalFields: [
      { name: 'checkInterval', label: 'Check Interval (sec)', type: 'number', default: 30 },
      { name: 'threshold', label: 'Restock Threshold', type: 'number', default: 16, description: 'Deliver when target has fewer than this many' },
    ],
    suggestedBotCount: 1,
    builtIn: true,
  },
];

// -- TemplateManager --

export class TemplateManager {
  private templates: Map<string, MissionTemplate> = new Map();
  private dataPath: string;

  constructor(dataDir?: string) {
    this.dataPath = path.join(dataDir || path.join(process.cwd(), 'data'), 'templates.json');
    this.loadBuiltIns();
    this.loadCustom();
  }

  private loadBuiltIns(): void {
    for (const t of BUILT_IN_TEMPLATES) {
      this.templates.set(t.id, { ...t });
    }
  }

  private loadCustom(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
        if (Array.isArray(raw)) {
          for (const t of raw) {
            if (t.id && !t.builtIn) {
              this.templates.set(t.id, { ...t, builtIn: false });
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load custom templates');
    }
  }

  private saveCustom(): void {
    const custom = Array.from(this.templates.values()).filter((t) => !t.builtIn);
    const dir = path.dirname(this.dataPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.dataPath, JSON.stringify(custom, null, 2), 'utf-8');
  }

  // -- Public API --

  getAll(): MissionTemplate[] {
    return Array.from(this.templates.values());
  }

  getById(id: string): MissionTemplate | undefined {
    return this.templates.get(id);
  }

  getByCategory(category: string): MissionTemplate[] {
    return this.getAll().filter((t) => t.category === category);
  }

  create(template: Omit<MissionTemplate, 'builtIn'>): MissionTemplate {
    const record: MissionTemplate = { ...template, builtIn: false };
    this.templates.set(record.id, record);
    this.saveCustom();
    return record;
  }

  update(id: string, patch: Partial<Omit<MissionTemplate, 'id' | 'builtIn'>>): MissionTemplate | null {
    const existing = this.templates.get(id);
    if (!existing) return null;
    if (existing.builtIn) return null;
    const updated = { ...existing, ...patch };
    this.templates.set(id, updated);
    this.saveCustom();
    return updated;
  }

  delete(id: string): boolean {
    const existing = this.templates.get(id);
    if (!existing || existing.builtIn) return false;
    this.templates.delete(id);
    this.saveCustom();
    return true;
  }

  buildTaskDescription(templateId: string, params: Record<string, unknown>): string | null {
    const template = this.templates.get(templateId);
    if (!template) return null;

    const merged = { ...template.defaultParams, ...params };
    const parts: string[] = [`[${template.name}]`];

    for (const field of template.requiredFields) {
      const val = merged[field.name];
      if (val !== undefined && val !== null && val !== '') {
        parts.push(`${field.label}: ${val}`);
      }
    }

    if (template.optionalFields) {
      for (const field of template.optionalFields) {
        const val = merged[field.name];
        if (val !== undefined && val !== null && val !== '' && val !== field.default) {
          parts.push(`${field.label}: ${val}`);
        }
      }
    }

    return parts.join(' | ');
  }
}
