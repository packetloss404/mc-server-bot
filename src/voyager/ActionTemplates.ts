/**
 * ActionTemplates — pre-built, tested action sequences for common Minecraft
 * operations. The ActionAgent can use these instead of generating code from
 * scratch, improving reliability for well-known tasks.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateStep {
  action: string;                  // action function name
  args: Record<string, string>;    // params, may contain {param} placeholders
  condition?: string;              // optional JS condition expression
}

export interface ActionTemplate {
  id: string;
  name: string;
  description: string;
  params: string[];                // parameter names the template accepts
  steps: TemplateStep[];
  keywords: string[];              // for matching against task descriptions
  successRate?: number;
}

export interface TemplateMatch {
  template: ActionTemplate;
  confidence: number;              // 0-1
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

const BUILTIN_TEMPLATES: ActionTemplate[] = [
  // 1. mine_and_store
  {
    id: 'mine_and_store',
    name: 'Mine and Store',
    description: 'Find a block type, mine N of it, optionally deposit in a nearby container',
    params: ['resource', 'count', 'containerLocation'],
    steps: [
      {
        action: 'mineBlock',
        args: { name: '{resource}', count: '{count}' },
      },
      {
        action: 'depositItem',
        args: { containerName: 'chest', itemName: '{resource}', count: '{count}' },
        condition: '{containerLocation}',
      },
    ],
    keywords: [
      'mine', 'collect', 'gather', 'dig', 'harvest', 'store', 'deposit',
      'log', 'ore', 'stone', 'coal', 'iron', 'diamond', 'wood', 'block',
    ],
    successRate: 0.85,
  },

  // 2. craft_with_prerequisites
  {
    id: 'craft_with_prerequisites',
    name: 'Craft with Prerequisites',
    description: 'Check recipe, gather materials if missing, find or place a crafting table, then craft the item',
    params: ['item', 'count'],
    steps: [
      {
        action: 'craftItem',
        args: { name: '{item}', count: '{count}' },
      },
    ],
    keywords: [
      'craft', 'make', 'create', 'build', 'recipe', 'table', 'workbench',
      'planks', 'sticks', 'tools', 'sword', 'pickaxe', 'axe', 'shovel',
      'hoe', 'armor', 'shield', 'boat', 'chest', 'furnace', 'door',
    ],
    successRate: 0.75,
  },

  // 3. explore_and_report
  {
    id: 'explore_and_report',
    name: 'Explore and Report',
    description: 'Explore in a direction for a given distance, scan surroundings, and report findings',
    params: ['direction', 'distance'],
    steps: [
      {
        action: 'exploreUntil',
        args: { direction: '{direction}', maxTime: '{distance}' },
      },
    ],
    keywords: [
      'explore', 'scout', 'search', 'find', 'look', 'survey', 'scan',
      'discover', 'locate', 'navigate', 'travel', 'walk', 'wander',
      'north', 'south', 'east', 'west',
    ],
    successRate: 0.80,
  },

  // 4. gather_food
  {
    id: 'gather_food',
    name: 'Gather Food',
    description: 'Find and collect food by harvesting crops, killing animals, or picking up items',
    params: [],
    steps: [
      {
        action: 'killMob',
        args: { name: 'cow', maxMs: '30000' },
        condition: 'nearbyAnimals',
      },
      {
        action: 'killMob',
        args: { name: 'pig', maxMs: '30000' },
        condition: 'nearbyAnimals',
      },
      {
        action: 'killMob',
        args: { name: 'chicken', maxMs: '30000' },
        condition: 'nearbyAnimals',
      },
      {
        action: 'mineBlock',
        args: { name: 'wheat', count: '5' },
        condition: 'nearbyCrops',
      },
    ],
    keywords: [
      'food', 'eat', 'hungry', 'hunger', 'feed', 'harvest', 'crop',
      'wheat', 'carrot', 'potato', 'beetroot', 'melon', 'apple',
      'beef', 'pork', 'chicken', 'mutton', 'bread', 'animal', 'cow',
      'pig', 'sheep', 'steak', 'cook',
    ],
    successRate: 0.70,
  },

  // 5. build_shelter
  {
    id: 'build_shelter',
    name: 'Build Shelter',
    description: 'Place blocks in a small shelter pattern for night safety',
    params: ['material'],
    steps: [
      {
        action: 'placeItem',
        args: { name: '{material}', x: '{bx}', y: '{by}', z: '{bz}' },
      },
    ],
    keywords: [
      'shelter', 'house', 'build', 'construct', 'place', 'wall', 'roof',
      'night', 'safety', 'protect', 'hut', 'base', 'home', 'structure',
      'dirt', 'cobblestone',
    ],
    successRate: 0.60,
  },

  // 6. equip_best_gear
  {
    id: 'equip_best_gear',
    name: 'Equip Best Gear',
    description: 'Scan inventory for best tools and armor, then equip them',
    params: [],
    steps: [],
    keywords: [
      'equip', 'wear', 'armor', 'tool', 'gear', 'sword', 'pickaxe',
      'axe', 'helmet', 'chestplate', 'leggings', 'boots', 'shield',
      'best', 'upgrade', 'weapon',
    ],
    successRate: 0.90,
  },

  // 7. deposit_inventory
  {
    id: 'deposit_inventory',
    name: 'Deposit Inventory',
    description: 'Walk to nearest known chest and deposit non-essential items',
    params: ['keepItems'],
    steps: [
      {
        action: 'depositItem',
        args: { containerName: 'chest', itemName: 'all', count: '64' },
      },
    ],
    keywords: [
      'deposit', 'store', 'chest', 'stash', 'unload', 'empty', 'inventory',
      'dump', 'put away', 'clean', 'organize',
    ],
    successRate: 0.80,
  },

  // 8. smelt_ore
  {
    id: 'smelt_ore',
    name: 'Smelt Ore',
    description: 'Find or place a furnace, insert ore and fuel, wait for smelting, collect result',
    params: ['ore', 'count'],
    steps: [
      {
        action: 'smeltItem',
        args: { itemName: '{ore}', fuelName: 'coal', count: '{count}' },
      },
    ],
    keywords: [
      'smelt', 'furnace', 'ore', 'iron', 'gold', 'copper', 'cook',
      'raw', 'ingot', 'fuel', 'charcoal', 'coal', 'burn', 'heat',
    ],
    successRate: 0.75,
  },
];

// ---------------------------------------------------------------------------
// ActionTemplateRegistry
// ---------------------------------------------------------------------------

export class ActionTemplateRegistry {
  private templates: Map<string, ActionTemplate> = new Map();

  constructor() {
    for (const tpl of BUILTIN_TEMPLATES) {
      this.templates.set(tpl.id, tpl);
    }
  }

  /** Register a custom template (or overwrite an existing one). */
  register(template: ActionTemplate): void {
    this.templates.set(template.id, template);
  }

  /** Return all registered templates. */
  getAll(): ActionTemplate[] {
    return Array.from(this.templates.values());
  }

  /** Get a single template by id. */
  get(id: string): ActionTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Find the best-matching template for a task description.
   * Uses keyword overlap scoring: each keyword match contributes to the
   * confidence score, weighted by how many keywords the template has.
   * The optional `keywords` parameter supplies extra keywords from the
   * task/curriculum system.
   */
  findTemplate(
    taskDescription: string,
    keywords: string[] = [],
  ): TemplateMatch | null {
    const descLower = taskDescription.toLowerCase();
    const taskTokens = new Set([
      ...descLower.split(/\s+/),
      ...keywords.map((k) => k.toLowerCase()),
    ]);

    let bestMatch: TemplateMatch | null = null;

    for (const template of this.templates.values()) {
      let hits = 0;
      const totalKeywords = template.keywords.length;
      if (totalKeywords === 0) continue;

      for (const kw of template.keywords) {
        const kwLower = kw.toLowerCase();
        // Check token-level match or substring match in description
        if (taskTokens.has(kwLower) || descLower.includes(kwLower)) {
          hits++;
        }
      }

      if (hits === 0) continue;

      // Confidence: ratio of matched keywords, capped at 1.0
      // Bonus for successRate if available
      const keywordScore = Math.min(hits / Math.max(totalKeywords * 0.3, 1), 1.0);
      const rateBonus = (template.successRate ?? 0.5) * 0.1;
      const confidence = Math.min(keywordScore + rateBonus, 1.0);

      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { template, confidence };
      }
    }

    return bestMatch;
  }

  /**
   * Replace `{param}` placeholders in step args with actual values.
   * Evaluates conditions and filters out steps whose conditions are not met.
   */
  renderTemplate(
    template: ActionTemplate,
    params: Record<string, string>,
  ): TemplateStep[] {
    const resolved: TemplateStep[] = [];

    for (const step of template.steps) {
      // Evaluate condition
      if (step.condition) {
        const conditionValue = this.resolveString(step.condition, params);
        // Treat empty string, "undefined", "false", "null", "0" as falsy
        if (!conditionValue || conditionValue === 'undefined' || conditionValue === 'false' || conditionValue === 'null' || conditionValue === '0') {
          continue;
        }
      }

      const resolvedArgs: Record<string, string> = {};
      for (const [key, value] of Object.entries(step.args)) {
        resolvedArgs[key] = this.resolveString(value, params);
      }

      resolved.push({
        action: step.action,
        args: resolvedArgs,
        condition: step.condition,
      });
    }

    return resolved;
  }

  /**
   * Convert resolved template steps into an executable JavaScript code string.
   * Produces an async function matching the style ActionAgent generates.
   */
  toCode(steps: TemplateStep[], functionName = 'templateTask'): string {
    const lines: string[] = [];

    for (const step of steps) {
      const argList = this.buildArgList(step.action, step.args);
      lines.push(`  await ${step.action}(${argList});`);
    }

    // If no steps, produce a no-op function
    if (lines.length === 0) {
      lines.push('  // no applicable steps');
    }

    return `async function ${functionName}(bot) {\n${lines.join('\n')}\n}`;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private resolveString(template: string, params: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_match, key) => {
      return params[key] ?? '';
    });
  }

  /**
   * Build the argument list string for a given action call.
   * Maps the step args to the positional parameters each action expects.
   */
  private buildArgList(action: string, args: Record<string, string>): string {
    switch (action) {
      case 'mineBlock':
        return this.quote(args.name) + ', ' + this.numOrDefault(args.count, '1');

      case 'craftItem':
        return this.quote(args.name) + ', ' + this.numOrDefault(args.count, '1');

      case 'smeltItem':
        return this.quote(args.itemName) + ', ' + this.quote(args.fuelName || 'coal') + ', ' + this.numOrDefault(args.count, '1');

      case 'placeItem':
        return this.quote(args.name) + ', ' + (args.x || '0') + ', ' + (args.y || '0') + ', ' + (args.z || '0');

      case 'killMob':
        return this.quote(args.name) + ', ' + this.numOrDefault(args.maxMs, '30000');

      case 'moveTo':
        return (args.x || '0') + ', ' + (args.y || '0') + ', ' + (args.z || '0')
          + (args.range ? ', ' + args.range : '')
          + (args.timeoutSec ? ', ' + args.timeoutSec : '');

      case 'exploreUntil': {
        const dir = this.quote(args.direction || 'north');
        const maxTime = this.numOrDefault(args.maxTime, '60');
        return `${dir}, ${maxTime}, null`;
      }

      case 'depositItem':
        return this.quote(args.containerName || 'chest') + ', ' + this.quote(args.itemName) + ', ' + this.numOrDefault(args.count, '64');

      case 'withdrawItem':
        return this.quote(args.containerName || 'chest') + ', ' + this.quote(args.itemName) + ', ' + this.numOrDefault(args.count, '64');

      case 'inspectContainer':
        return this.quote(args.containerName || 'chest');

      default:
        // Fallback: pass all args as positional values
        return Object.values(args).map((v) => this.maybeQuote(v)).join(', ');
    }
  }

  private quote(value: string): string {
    // Escape single quotes inside the value
    const escaped = value.replace(/'/g, "\\'");
    return `'${escaped}'`;
  }

  private numOrDefault(value: string | undefined, fallback: string): string {
    if (!value || value === '') return fallback;
    // If it looks like a number, return as-is
    if (/^\d+(\.\d+)?$/.test(value)) return value;
    return fallback;
  }

  private maybeQuote(value: string): string {
    if (/^\d+(\.\d+)?$/.test(value)) return value;
    if (value === 'null' || value === 'true' || value === 'false') return value;
    return this.quote(value);
  }
}
