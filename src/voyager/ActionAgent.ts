import { Bot } from 'mineflayer';
import { LLMClient } from '../ai/LLMClient';
import { SkillLibrary } from './SkillLibrary';
import { Task } from './CurriculumAgent';
import { renderObservation, formatObservation } from './Observation';
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
async function placeItem(name, x, y, z)  // place a block from inventory
async function setBlock(name, x, y, z, state?)  // place ANY block via /setblock (no inventory needed). state is optional e.g. "facing=north,half=top"
async function fillBlocks(name, x1, y1, z1, x2, y2, z2, mode?) // fill a region via /fill. mode: "replace"|"hollow"|"outline"|"destroy". Great for walls, floors, clearing areas.
async function killMob(name, maxMs)      // fight mobs
async function moveTo(x, y, z, range, timeoutSec) // pathfind to a target
async function exploreUntil(direction, maxTime, callback) // explore until callback returns a target
\`\`\`

## Bot state / observation APIs
These are mainly for observing state or selecting a target.

- bot.entity.position, bot.health, bot.food
- bot.inventory.items()
- bot.findBlock({matching: b => b.name === 'name', maxDistance: 32})
- bot.lookAt(pos), bot.look(yaw, pitch)
- bot.nearestEntity(filter), bot.players
- bot.waitForTicks(ticks)

## Hard rules
1. Output a SINGLE async function: async function functionName(bot) { ... }
2. The function name must be meaningful camelCase.
3. You may call any previously saved skill functions shown in context - they accept (bot) as parameter.
4. Use await for all async operations.
5. Handle errors with try/catch.
6. Do NOT call bot.chat(). The bot should work silently.
7. Keep code concise and reusable. Do not assume the inventory already contains required items.
8. Do NOT use bot.on() or bot.once() event listeners.
9. Do NOT write infinite loops or recursive functions.
10. maxDistance must always be 32 for bot.findBlock().
11. Output ONLY the function code. No explanation. No markdown fences.

## Primitive usage requirements
- For mining or collecting tasks, use mineBlock(...). Do NOT use bot.dig(...) directly.
- For crafting tasks, use craftItem(...). Do NOT use bot.craft(...) or bot.recipesFor(...) directly.
- For placement tasks, use placeItem(...). Do NOT use bot.placeBlock(...) directly.
- For combat tasks, use killMob(...). Do NOT use bot.attack(...) directly.
- For movement tasks, use moveTo(...).
- If the target is not nearby or cannot be found immediately, use exploreUntil(...) before giving up.
- Do NOT use bot.pathfinder.setGoal(...) directly unless there is no primitive that can solve the task.

## Building guidance
- For building/construction tasks, use setBlock() and fillBlocks() — they work without inventory.
- Use fillBlocks() for walls, floors, ceilings, and clearing areas. It is much faster than individual setBlock() calls.
- Use bot.entity.position to get your current location and build relative to it.
- Build layer by layer from bottom to top.
- Use appropriate materials: stone_bricks, deepslate_bricks, oak_planks, glass, iron_door, glowstone, etc.
- For hollow rooms, use fillBlocks with "outline" or build walls/floor/ceiling separately.
- Add interior details: torches, furniture (stairs as chairs, slabs as tables), carpets, etc.

## Behavioral guidance
- First identify the target.
- If the target is nearby, use the appropriate primitive.
- If the target is not nearby, explore outward with exploreUntil(...) and then use the primitive.
- Do not stop after only locating a target when the task implies going to it, collecting it, or interacting with it.

## Previously saved skills
You may call previously saved skill functions shown in context. They accept (bot) as parameter.`;

export class ActionAgent {
  private llmClient: LLMClient;
  private maxTokens: number;

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
    critique?: string
  ): Promise<GeneratedCode> {
    const obs = renderObservation(bot);
    const obsText = formatObservation(obs);

    // Get top-k relevant skill code for context
    const skillContext = skillLibrary.getTopKSkillCode(
      task.keywords.join(' ') + ' ' + task.description,
      5
    );

    // Build iterative refinement context
    let iterativeContext = '';
    if (previousCode) {
      iterativeContext += `\nCode from the last round:\n${previousCode}\n`;
    }
    if (previousError) {
      iterativeContext += `\nExecution error: ${previousError}\n`;
    }
    if (critique) {
      iterativeContext += `\nCritique: ${critique}\n`;
    }

    const userMessage = `${iterativeContext}
${obsText}
Task: ${task.description}
${skillContext ? `\nPreviously saved skills you can call:\n${skillContext}` : ''}

Write the function:`;

    const response = await this.llmClient.generate(ACTION_SYSTEM_PROMPT, userMessage, this.maxTokens);

    const generated = this.parseGeneratedFunction(response.text);
    logger.info({ task: task.description, functionName: generated.functionName, codeLength: generated.functionCode.length }, 'Action agent generated code');
    return generated;
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

    // Extract function name
    const nameMatch = code.match(/^async\s+function\s+(\w+)\s*\(/m);
    if (nameMatch) {
      return {
        functionName: nameMatch[1],
        functionCode: code,
        execCode: `await ${nameMatch[1]}(bot);`,
      };
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
    return {
      functionName: fallbackName,
      functionCode: wrappedCode,
      execCode: `await ${fallbackName}(bot);`,
    };
  }
}
