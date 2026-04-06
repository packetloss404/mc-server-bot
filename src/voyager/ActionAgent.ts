import { Bot } from 'mineflayer';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import type { NodePath } from '@babel/traverse';
import type { FunctionDeclaration } from '@babel/types';
import { LLMClient } from '../ai/LLMClient';
import { SkillLibrary } from './SkillLibrary';
import { Task } from './CurriculumAgent';
import { renderObservation } from './Observation';
import { buildTaskGuidance } from './TaskGuidance';
import { logger } from '../util/logger';

export interface GeneratedCode {
  functionName: string;
  functionCode: string;
  execCode: string;
}

const ACTION_SYSTEM_PROMPT = `You are a Minecraft bot code generator. You write JavaScript code as a single named async function to complete the task.

## Useful programs already available in scope
Reuse these as much as possible. They are the preferred way to act in the world.

\`\`\`
async function mineBlock(name, count)    // collect blocks/items
async function craftItem(name, count)    // craft items
async function smeltItem(itemName, fuelName, count) // smelt items in a furnace
async function placeItem(name, x, y, z)  // place blocks
async function killMob(name, maxMs)      // fight mobs
async function moveTo(x, y, z, range, timeoutSec) // pathfind to a target
async function exploreUntil(direction, maxTime, callback) // explore until callback returns a target
async function withdrawItem(containerName, itemName, count) // withdraw from chest/barrel/etc
async function depositItem(containerName, itemName, count)  // deposit into chest/barrel/etc
async function inspectContainer(containerName) // inspect container contents
\`\`\`

## Bot state / observation APIs
These are mainly for observing state or selecting a target.

- bot.entity.position, bot.health, bot.food
- bot.inventory.items() — returns array of {name, count}. To find an item: bot.inventory.items().find(i => i.name === 'oak_log')
- bot.findBlock({matching: b => b.name === 'name', maxDistance: 32})
- bot.lookAt(pos), bot.look(yaw, pitch)
- bot.nearestEntity(filter), bot.players
- bot.waitForTicks(ticks)

## Low-level control APIs (for survival situations)
Use these when no primitive covers the task (swimming, eating, fleeing):

- bot.setControlState('jump', true/false) — hold jump key (use for swimming UP in water)
- bot.setControlState('forward', true/false) — hold forward key
- bot.setControlState('sprint', true/false) — hold sprint key
- bot.setControlState('sneak', true/false) — hold sneak key
- bot.clearControlStates() — release all held keys
- await bot.consume() — eat the currently held food item (must equip food to hand first)
- bot.equip(item, 'hand') — equip an item to hand (item = result of bot.inventory.items().find(...))
- bot.toss(itemType, metadata, count) — drop items (itemType is the numeric ID: use item.type from inventory)
- await bot.fish() — start fishing (requires fishing rod equipped)

### Swimming pattern:
\`\`\`
bot.setControlState('jump', true);
bot.setControlState('forward', true);
await bot.waitForTicks(40); // swim up for 2 seconds
bot.clearControlStates();
\`\`\`

### Eating pattern:
\`\`\`
const food = bot.inventory.items().find(i => i.foodRecovery > 0);
if (food) {
  await bot.equip(food, 'hand');
  await bot.consume();
}
\`\`\`

### Flee pattern:
\`\`\`
const threat = bot.nearestEntity(e => e.type === 'hostile');
if (threat) {
  const flee = bot.entity.position.minus(threat.position).normalize().scale(20);
  const target = bot.entity.position.plus(flee);
  await moveTo(target.x, target.y, target.z, 2, 10);
}
\`\`\`

## APIs that do NOT exist — never use these
- bot.inventory.findInventoryItem() — DOES NOT EXIST. Use bot.inventory.items().find(i => i.name === 'x') instead.
- bot.inventory.findItem() — DOES NOT EXIST.
- bot.tossStack() — DOES NOT EXIST. Use bot.toss(itemId, null, count) instead.
- bot.equip() with string argument — use the item object from bot.inventory.items().
- require() — DOES NOT EXIST in this sandbox. Do not import/require any modules.
- bot.creative — DOES NOT EXIST. This is a survival server.
- bot.activateItem() without equipping first — always equip the item to hand before activating.
- mcData or minecraft-data — not available in the sandbox. Use hardcoded values or bot APIs.

## Hard rules
1. Output a SINGLE async function: async function functionName(bot) { ... }
2. The function name must be meaningful camelCase.
3. You may call any previously saved skill functions shown in context - they accept (bot) as parameter.
4. Use await for all async operations.
5. Do NOT wrap the entire function body in try/catch. Let errors propagate so they can be detected. Only use try/catch around specific risky operations if needed.
6. Do NOT call bot.chat(). The bot should work silently.
7. Keep code concise and reusable. Do not assume the inventory already contains required items.
8. Do NOT use bot.on() or bot.once() event listeners.
9. Do NOT write infinite loops or recursive functions.
10. maxDistance must always be 32 for bot.findBlock().
11. Output ONLY the function code. No explanation. No markdown fences.

## Primitive usage requirements
- For mining or collecting tasks, use mineBlock(...). Do NOT use bot.dig(...) directly.
- For crafting tasks, use craftItem(...). Do NOT use bot.craft(...) or bot.recipesFor(...) directly.
- For smelting tasks, use smeltItem(...). Do NOT use bot.openFurnace(...) directly.
- For placement tasks, use placeItem(...). Do NOT use bot.placeBlock(...) directly.
- For combat tasks, use killMob(...). Do NOT use bot.attack(...) directly.
- For chest or container tasks, use withdrawItem(...) and depositItem(...) instead of scripting container UI manually.
- Use inspectContainer(...) when you need to check what is inside a nearby chest/container.
- For movement tasks, use moveTo(...).
- If the target is not nearby or cannot be found immediately, use exploreUntil(...) before giving up.
- Do NOT use bot.pathfinder.setGoal(...) directly unless there is no primitive that can solve the task.

## Behavioral guidance
- First identify the target.
- If the target is nearby, use the appropriate primitive.
- If the target is not nearby, explore outward with exploreUntil(...) and then use the primitive.
- Do not stop after only locating a target when the task implies going to it, collecting it, or interacting with it.

## Previously saved skills
You may call previously saved skill functions shown in context. They accept (bot) as parameter.

## Composition priority
- Prefer composing 2-3 previously saved skills plus primitives over writing long fresh logic from scratch.
- If a retrieved skill already solves a prerequisite (for example gathering wood, crafting a table, moving to a player, or finding a target), call that skill instead of rewriting it.
- For compound tasks, write a short orchestrator function that calls existing skills/primitives in order.`;

export class ActionAgent {
  private static readonly MAX_PREVIOUS_CODE_CHARS = 800;
  private static readonly MAX_ERROR_CHARS = 400;
  private static readonly MAX_EVENT_LOG_CHARS = 300;
  private static readonly MAX_BLOCKER_CHARS = 220;
  private static readonly MAX_WORLD_MEMORY_CHARS = 220;
  private static readonly MAX_CRITIQUE_CHARS = 240;
  private llmClient: LLMClient;
  private maxTokens: number;
  private static MAX_PARSE_RETRIES = 3;

  constructor(llmClient: LLMClient, maxTokens: number) {
    this.llmClient = llmClient;
    this.maxTokens = maxTokens;
  }

  async generateCode(
    bot: Bot,
    task: Task,
    skillLibrary: SkillLibrary,
    previousError?: string,
    previousCode?: string,
    critique?: string,
    eventLog?: string,
    blockerSummary?: string,
    worldMemorySummary?: string
  ): Promise<GeneratedCode> {
    const obs = renderObservation(bot);
    const taskGuidance = buildTaskGuidance(task);
    const obsText = this.formatCompactObservation(obs, taskGuidance.category, !previousError && !previousCode);

    // Enrich skill query with chatlog summary on retries (like original Voyager)
    const chatlogSummary = eventLog ? ActionAgent.summarizeChatlog(eventLog) : '';
    const baseQuery = task.keywords.join(' ') + ' ' + task.description;
    const query = chatlogSummary ? `${baseQuery}\n\n${chatlogSummary}` : baseQuery;

    // Re-retrieve skills each time (query may be enriched with error context)
    const skillSummary = await skillLibrary.buildSkillSummary(query);
    const bestSkillCode = await skillLibrary.getTopKSkillCode(query, 1);
    const composableSkills = await skillLibrary.getComposableMatches(query, 3);

    let lastRaw = previousCode;
    let lastError = previousError;
    let lastCritique = critique;

    for (let attempt = 1; attempt <= ActionAgent.MAX_PARSE_RETRIES; attempt++) {
      const iterativeContext = this.buildIterativeContext(lastRaw, lastError, lastCritique, eventLog, blockerSummary, worldMemorySummary);
      const userMessage = `${iterativeContext}
${obsText}
Task: ${task.description}
Task category: ${taskGuidance.category}
Task guidance: ${taskGuidance.guidance.slice(0, 3).join(' ')}
Preferred skill composition order:
${composableSkills.length > 0
  ? composableSkills.map((skill, index) => `${index + 1}. ${skill.name} (${skill.description})`).join('\n')
  : 'none'}
${skillSummary ? `\nRelevant skill summaries:\n${this.truncateText(skillSummary, 500)}` : ''}
${bestSkillCode ? `\nBest matching saved skill:\n${this.truncateText(bestSkillCode, 1200)}` : ''}

Write the function:`;

      const response = await this.llmClient.generate(ACTION_SYSTEM_PROMPT, userMessage, this.maxTokens);
      lastRaw = response.text;

      logger.info({
        task: task.description,
        parseAttempt: attempt,
        systemPromptChars: ACTION_SYSTEM_PROMPT.length,
        userMessageChars: userMessage.length,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        maxTokens: this.maxTokens,
        rawResponseLength: response.text.length,
      }, 'ActionAgent LLM call stats');

      try {
        const generated = this.parseGeneratedFunction(response.text);
        logger.info({
          task: task.description,
          functionName: generated.functionName,
          codeLength: generated.functionCode.length,
          parseAttempt: attempt,
        }, 'Action agent generated code');
        return generated;
      } catch (err: any) {
        lastError = `Parse error: ${err.message}`;
        lastCritique = 'Return exactly one valid async JavaScript function declaration with balanced parentheses/braces and no extra text.';
        logger.warn({ task: task.description, parseAttempt: attempt, err: err.message }, 'Action agent parse retry');
      }
    }

    throw new Error(`ActionAgent failed to produce valid code after ${ActionAgent.MAX_PARSE_RETRIES} parse attempts: ${lastError || 'unknown parse error'}`);
  }

  private buildIterativeContext(previousCode?: string, previousError?: string, critique?: string, eventLog?: string, blockerSummary?: string, worldMemory?: string): string {
    let iterativeContext = '';
    if (previousCode) {
      iterativeContext += `Code from the last round:\n${this.truncateText(previousCode, ActionAgent.MAX_PREVIOUS_CODE_CHARS)}\n\n`;
    }
    if (previousError) {
      iterativeContext += `Execution error: ${this.truncateText(previousError, ActionAgent.MAX_ERROR_CHARS)}\n\n`;
    }
    iterativeContext += `Chat log: ${eventLog ? this.truncateText(eventLog, ActionAgent.MAX_EVENT_LOG_CHARS) : 'none'}\n\n`;
    if (blockerSummary) {
      iterativeContext += `Known blockers: ${this.truncateText(blockerSummary, ActionAgent.MAX_BLOCKER_CHARS)}\n\n`;
    }
    if (worldMemory) {
      iterativeContext += `Known world memory: ${this.truncateText(worldMemory, ActionAgent.MAX_WORLD_MEMORY_CHARS)}\n\n`;
    }
    if (critique) {
      iterativeContext += `Critique: ${this.truncateText(critique, ActionAgent.MAX_CRITIQUE_CHARS)}\n\n`;
    }
    return iterativeContext;
  }

  private formatCompactObservation(obs: ReturnType<typeof renderObservation>, category: string, firstAttempt: boolean): string {
    const lines: string[] = [
      `Position: ${obs.position}`,
      `Equipment: ${obs.equipment}`,
      `Inventory (${obs.inventorySlots}): ${this.compactInventory(obs.inventory)}`,
      `Nearby blocks: ${this.truncateList(obs.nearbyBlocks, category === 'movement' ? 10 : 6)}`,
    ];

    if (category === 'movement' || category === 'combat' || !firstAttempt) {
      lines.push(`Health: ${obs.health}/20`);
      lines.push(`Hunger: ${obs.hunger}/20`);
      lines.push(`Oxygen: ${obs.oxygen}`);
    }

    if (category === 'movement' || category === 'combat') {
      lines.push(`Nearby entities: ${this.truncateList(obs.nearbyEntities, 6)}`);
    }

    if (category === 'movement' || !firstAttempt) {
      lines.push(`Biome: ${obs.biome}`);
      lines.push(`Time: ${obs.timeOfDay}`);
    }

    return lines.join('\n');
  }

  private compactInventory(inventory: string): string {
    if (inventory === 'empty') return inventory;
    return this.truncateList(inventory, 8);
  }

  private truncateList(value: string, maxItems: number): string {
    if (!value || value === 'none' || value === 'none visible' || value === 'empty') return value;
    const items = value.split(', ').filter(Boolean);
    if (items.length <= maxItems) return value;
    return `${items.slice(0, maxItems).join(', ')} ... (+${items.length - maxItems} more)`;
  }

  private truncateText(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}...`;
  }

  private parseGeneratedFunction(raw: string): GeneratedCode {
    let code = raw.trim();

    // Strip markdown fences
    if (code.startsWith('```')) {
      code = code.replace(/^```(?:javascript|js)?\n?/, '').replace(/\n?```$/, '');
    }

    // Strip any explanation text before the function
    const funcStart = code.search(/^async\s+function\s+/m);
    if (funcStart > 0) {
      code = code.substring(funcStart);
    }

    const parsed = this.extractFunctionWithBabel(code);
    if (parsed) {
      return parsed;
    }

    // Fallback: LLM returned raw body, wrap it in a function
    logger.warn('ActionAgent response was not a named function, wrapping in fallback');
    const fallbackName = 'generatedTask';

    // Strip leading code-like patterns (const, let, await, etc.)
    const codeStart = code.search(/^(const |let |var |await |try |if |for |bot\.|mineBlock|craftItem|placeItem|killMob|moveTo|exploreUntil|console\.)/m);
    if (codeStart > 0) {
      code = code.substring(codeStart);
    }

    const wrappedCode = `async function ${fallbackName}(bot) {\n${code}\n}`;
    this.assertFunctionParses(wrappedCode);
    return {
      functionName: fallbackName,
      functionCode: wrappedCode,
      execCode: `await ${fallbackName}(bot);`,
    };
  }

  private extractFunctionWithBabel(code: string): GeneratedCode | null {
    try {
      const ast = parse(code, {
        sourceType: 'script',
        plugins: ['asyncGenerators'],
      });

      let found: GeneratedCode | null = null;
      traverse(ast, {
        FunctionDeclaration(path: NodePath<FunctionDeclaration>) {
          if (found) return;
          const node = path.node;
          if (!node.async || !node.id?.name) return;
          const functionCode = generate(node).code;
          found = {
            functionName: node.id.name,
            functionCode,
            execCode: `await ${node.id.name}(bot);`,
          };
          path.stop();
        },
      });

      return found;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'ActionAgent Babel parse failed');
      return null;
    }
  }

  /**
   * Extract structured requirements from event logs, matching original Voyager's
   * summarize_chatlog. Picks out "I need X", "no recipe found", "need a crafting table", etc.
   * Used to enrich skill retrieval queries on retries.
   */
  static summarizeChatlog(eventLog: string): string {
    const needs = new Set<string>();

    // "I cannot make X because I need: Y, Z"
    const craftNeed = eventLog.match(/cannot make \w+ because I need[:\s]+([^|.]+)/gi);
    if (craftNeed) {
      for (const m of craftNeed) {
        const items = m.replace(/.*need[:\s]+/i, '').trim();
        if (items) needs.add(items);
      }
    }

    // "no crafting table nearby" / "need a crafting table"
    if (/no crafting.?table nearby|need.*crafting.?table/i.test(eventLog)) {
      needs.add('a nearby crafting table');
    }

    // "I need at least a X to mine Y"
    const toolNeed = eventLog.match(/need at least a ([^|.!]+) to mine/gi);
    if (toolNeed) {
      for (const m of toolNeed) {
        const tool = m.replace(/.*need at least a /i, '').replace(/ to mine.*/i, '').trim();
        if (tool) needs.add(tool);
      }
    }

    // "no recipe found for X"
    const noRecipe = eventLog.match(/no recipe found for ([^|.!]+)/gi);
    if (noRecipe) {
      for (const m of noRecipe) {
        const item = m.replace(/.*no recipe found for /i, '').trim();
        if (item) needs.add(`recipe or materials for ${item}`);
      }
    }

    // "required materials" / "not enough"
    if (/required materials|not enough/i.test(eventLog)) {
      needs.add('required crafting materials');
    }

    if (needs.size === 0) return '';
    return 'I also need ' + Array.from(needs).join(', ') + '.';
  }

  private assertFunctionParses(code: string): void {
    parse(code, {
      sourceType: 'script',
      plugins: ['asyncGenerators'],
    });
  }
}
