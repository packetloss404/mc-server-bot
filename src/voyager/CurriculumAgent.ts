import fs from 'fs';
import path from 'path';
import { Bot } from 'mineflayer';
import { LLMClient } from '../ai/LLMClient';
import { SkillLibrary } from './SkillLibrary';
import { renderObservation, formatObservation, formatObservationWithWarmup, isContextWarmedUp } from './Observation';
import { logger } from '../util/logger';
import { inferTaskSpec } from './TaskSpec';
import { TaskSpec } from './TaskSpec';
import { getProgressionState, taskMatchesProgression } from './Progression';
import { BlockerMemory } from './BlockerMemory';
import { WorldMemory } from './WorldMemory';
import { StatsTracker } from './StatsTracker';

export interface Task {
  description: string;
  keywords: string[];
  guidance?: string[];
  spec?: TaskSpec;
}

const CURRICULUM_SYSTEM_PROMPT = `You are a helpful assistant that tells me the next immediate task to do in Minecraft. My ultimate goal is to discover as many diverse things as possible, accomplish as many diverse tasks as possible and become the best Minecraft player in the world.

I will give you the following information:
- Biome, Time, Nearby blocks, Nearby entities
- Health/Hunger status
- Position and Equipment
- Inventory status
- Completed tasks and failed tasks

You should:
1. Act as a mentor guiding the next task based on learning progress
2. Be specific about required resources, quantities, or targets (e.g., "Mine 3 oak logs" not just "get wood")
3. Format tasks concisely as single action phrases
4. Ensure tasks match current capability and inventory
5. Prioritize novel, interesting tasks — avoid repeating completed tasks
6. Encourage exploration and progression (mine → craft → build → explore)
7. Consider the bot's personality when choosing tasks

Output ONLY a JSON object with no markdown fences: {"reasoning": "brief 1-sentence reason", "task": "the task description", "keywords": ["keyword1", "keyword2"]}
IMPORTANT: Keep reasoning under 20 words. Do NOT write long explanations. The entire JSON must fit in one short response.`;

// Large progression-aware fallback pool used when LLM is unavailable.
// Tasks are ordered by progression stage; proposeStaticTask picks the first feasible & uncompleted one.
const FALLBACK_TASKS: Task[] = [
  // Stage 0: basics
  { description: 'Mine 1 oak log', keywords: ['mine', 'oak_log', 'wood'] },
  { description: 'Mine 3 oak logs', keywords: ['mine', 'oak_log', 'wood'] },
  { description: 'Mine 1 birch log', keywords: ['mine', 'birch_log', 'wood'] },
  { description: 'Mine 1 spruce log', keywords: ['mine', 'spruce_log', 'wood'] },
  { description: 'Craft 4 oak planks', keywords: ['craft', 'oak_planks', 'wood'] },
  { description: 'Craft 4 sticks', keywords: ['craft', 'stick', 'wood'] },
  { description: 'Craft 1 crafting table', keywords: ['craft', 'crafting_table', 'wood'] },
  // Stage 1: wooden tools
  { description: 'Craft a wooden pickaxe', keywords: ['craft', 'wooden_pickaxe', 'tool'] },
  { description: 'Craft a wooden sword', keywords: ['craft', 'wooden_sword', 'tool'] },
  { description: 'Craft a wooden axe', keywords: ['craft', 'wooden_axe', 'tool'] },
  { description: 'Craft a wooden hoe', keywords: ['craft', 'wooden_hoe', 'tool'] },
  { description: 'Craft a wooden shovel', keywords: ['craft', 'wooden_shovel', 'tool'] },
  // Stage 2: stone tier
  { description: 'Mine 3 cobblestone', keywords: ['mine', 'cobblestone', 'stone'] },
  { description: 'Mine 8 cobblestone', keywords: ['mine', 'cobblestone', 'stone'] },
  { description: 'Craft a stone pickaxe', keywords: ['craft', 'stone_pickaxe', 'tool'] },
  { description: 'Craft a stone sword', keywords: ['craft', 'stone_sword', 'tool'] },
  { description: 'Craft a stone axe', keywords: ['craft', 'stone_axe', 'tool'] },
  // Stage 3: exploration & resources
  { description: 'Explore 50 blocks to the north', keywords: ['explore', 'walk', 'north'] },
  { description: 'Explore 50 blocks to the east', keywords: ['explore', 'walk', 'east'] },
  { description: 'Explore 50 blocks to the south', keywords: ['explore', 'walk', 'south'] },
  { description: 'Explore 50 blocks to the west', keywords: ['explore', 'walk', 'west'] },
  { description: 'Mine 3 coal ore', keywords: ['mine', 'coal_ore', 'resource'] },
  { description: 'Mine 3 iron ore', keywords: ['mine', 'iron_ore', 'resource'] },
  { description: 'Walk to the nearest player', keywords: ['walk', 'player', 'approach'] },
  // Stage 4: crafting & smelting
  { description: 'Craft 1 furnace', keywords: ['craft', 'furnace', 'smelt'] },
  { description: 'Smelt 3 raw iron', keywords: ['smelt', 'raw_iron', 'iron'] },
  { description: 'Craft an iron pickaxe', keywords: ['craft', 'iron_pickaxe', 'tool'] },
  { description: 'Craft an iron sword', keywords: ['craft', 'iron_sword', 'tool'] },
  // Stage 5: farming
  { description: 'Walk to the nearest farmland', keywords: ['walk', 'farm', 'crops'] },
  { description: 'Explore and find wheat seeds', keywords: ['explore', 'seeds', 'wheat'] },
  { description: 'Plant 1 wheat seed', keywords: ['plant', 'wheat', 'farm'] },
  { description: 'Harvest 3 wheat', keywords: ['harvest', 'wheat', 'farm'] },
  { description: 'Craft 1 bread', keywords: ['craft', 'bread', 'food'] },
  // Stage 6: misc
  { description: 'Kill 1 zombie', keywords: ['kill', 'zombie', 'combat'] },
  { description: 'Kill 1 skeleton', keywords: ['kill', 'skeleton', 'combat'] },
  { description: 'Craft 1 chest', keywords: ['craft', 'chest', 'storage'] },
  { description: 'Craft 1 bed', keywords: ['craft', 'bed', 'sleep'] },
  { description: 'Mine 3 sand', keywords: ['mine', 'sand', 'resource'] },
  { description: 'Mine 3 dirt', keywords: ['mine', 'dirt', 'resource'] },
  { description: 'Craft a boat', keywords: ['craft', 'boat', 'transport'] },
];

export class CurriculumAgent {
  private llmClient: LLMClient | null;
  private useLLM: boolean;
  private lastTask: string = '';
  private completedTasks: string[] = [];
  private failedTasks: string[] = [];
  private completedTasksPath: string;
  private failedTasksPath: string;
  private lastBotForProgression: Bot | null = null;
  private blockerMemory: BlockerMemory;
  private worldMemory: WorldMemory;
  private qaCachePath: string;
  private qaCache: Record<string, string> = {};
  private qaEmbeddingPath: string;
  private qaEmbeddings: Record<string, number[]> = {};
  private statsTracker: StatsTracker;

  constructor(llmClient: LLMClient | null, useLLM: boolean, dataDir: string = './data') {
    this.llmClient = llmClient;
    this.useLLM = useLLM && !!llmClient;

    // Ensure data dir exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.completedTasksPath = path.join(dataDir, 'completed_tasks.json');
    this.failedTasksPath = path.join(dataDir, 'failed_tasks.json');
    this.qaCachePath = path.join(dataDir, 'qa_cache.json');
    this.qaEmbeddingPath = path.join(dataDir, 'qa_embeddings.json');
    this.blockerMemory = new BlockerMemory(dataDir);
    this.worldMemory = new WorldMemory(dataDir);
    this.statsTracker = new StatsTracker(dataDir);

    // Load persisted state
    this.completedTasks = this.loadJsonArray(this.completedTasksPath);
    this.failedTasks = this.loadJsonArray(this.failedTasksPath);
    this.qaCache = this.loadJsonMap(this.qaCachePath);
    this.qaEmbeddings = this.loadJsonEmbeddingMap(this.qaEmbeddingPath);

    if (this.completedTasks.length > 0) {
      this.lastTask = this.completedTasks[this.completedTasks.length - 1];
      logger.info({ completedCount: this.completedTasks.length, failedCount: this.failedTasks.length }, 'Loaded curriculum progress from disk');
    }
  }

  updateProgress(task: Task, success: boolean): void {
    // Inventory management tasks are excluded from progress (like original Voyager)
    if (this.isInventoryManagementTask(task)) {
      return;
    }
    if (success) {
      if (!this.completedTasks.includes(task.description)) {
        this.completedTasks.push(task.description);
      }
      // Remove from failed if it was there
      this.failedTasks = this.failedTasks.filter((t) => t !== task.description);
    } else {
      if (!this.failedTasks.includes(task.description)) {
        this.failedTasks.push(task.description);
      }
    }
    this.persistTasks();
  }

  private isInventoryManagementTask(task: Task): boolean {
    const desc = task.description.toLowerCase();
    return desc.includes('deposit useless items')
      || desc.includes('drop all')
      || (desc.includes('place') && desc.includes('chest') && desc.includes('deposit'))
      || (desc.startsWith('craft 1 chest') && task.keywords.includes('storage'));
  }

  async proposeTask(
    bot: Bot,
    personality: string,
    skillLibrary: SkillLibrary
  ): Promise<Task> {
    this.lastBotForProgression = bot;
    await this.worldMemory.rememberFromBot(bot);
    // First task is always "Mine 1 wood log" (like original Voyager)
    if (this.completedTasks.length === 0 && this.lastTask === '') {
      this.lastTask = 'Mine 1 oak log';
      return { description: 'Mine 1 oak log', keywords: ['mine', 'oak_log', 'wood'] };
    }

    // Inventory management short-circuit (matches original Voyager behavior)
    const inventoryTask = this.checkInventoryManagement(bot);
    if (inventoryTask) {
      logger.info({ task: inventoryTask.description }, 'Curriculum: inventory management short-circuit');
      return inventoryTask;
    }

    if (this.useLLM && this.llmClient) {
      return this.proposeLLMTask(bot, personality, skillLibrary);
    }
    return this.proposeStaticTask(personality);
  }

  /**
   * If inventory is nearly full (>= 33/36 slots), force an inventory cleanup task.
   * Matches original Voyager's short-circuit: deposit → place chest → craft chest → drop junk.
   * Since we're on a live server (no /give cheats), we add a "drop junk" fallback.
   */
  private checkInventoryManagement(bot: Bot): Task | null {
    const items = bot.inventory.items();
    const slotsUsed = items.length;
    if (slotsUsed < 33) return null;

    // Check if bot has a chest to place
    const hasChest = items.some((i) => i.name === 'chest');
    if (hasChest) {
      return {
        description: 'Place a chest and deposit useless items',
        keywords: ['place', 'chest', 'deposit', 'inventory'],
        spec: { kind: 'general', count: 1 },
      };
    }

    // Check if bot has materials to craft a chest (8 planks)
    const planks = items.filter((i) => i.name.endsWith('_planks')).reduce((sum, i) => sum + i.count, 0);
    if (planks >= 8) {
      return {
        description: 'Craft 1 chest',
        keywords: ['craft', 'chest', 'storage'],
        spec: { kind: 'craft', target: 'chest', count: 1 },
      };
    }

    // Fallback: drop junk items to free space
    const junkItem = this.findJunkItem(items);
    if (junkItem) {
      return {
        description: `Drop all ${junkItem.replace(/_/g, ' ')} to free inventory space`,
        keywords: ['drop', 'inventory', 'cleanup', junkItem],
        spec: { kind: 'general', count: 1 },
      };
    }

    return null;
  }

  /** Find the best junk item to drop, prioritizing low-value items with high stack counts. */
  private findJunkItem(items: Array<{ name: string; count: number }>): string | null {
    // Items considered junk, in priority order (drop first = most disposable)
    const junkPriority = [
      'wheat_seeds', 'beetroot_seeds', 'pumpkin_seeds', 'melon_seeds',
      'dirt', 'grass_block', 'sand', 'gravel', 'andesite', 'diorite', 'granite',
      'cobblestone', 'netherrack', 'cobbled_deepslate', 'tuff',
      'rotten_flesh', 'poisonous_potato', 'spider_eye',
      'flint', 'snowball', 'clay_ball',
    ];
    for (const junk of junkPriority) {
      if (items.some((i) => i.name === junk)) {
        return junk;
      }
    }
    // If nothing matches junk list, drop the item with the highest count
    const sorted = [...items].sort((a, b) => b.count - a.count);
    if (sorted.length > 0 && sorted[0].count > 16) {
      return sorted[0].name;
    }
    return null;
  }

  private proposeStaticTask(_personality: string): Task {
    const progression = this.lastBotForProgression
      ? getProgressionState(this.lastBotForProgression, this.completedTasks)
      : { hasWood: false, hasCraftingTable: false, hasWoodenPickaxe: false, hasWoodenHoe: false, hasCobblestone: false, canMineStoneTier: false, canFarm: false };

    // Only block tasks that failed very recently (last 5 failures), not permanently
    const recentFailures = new Set(this.failedTasks.slice(-5));

    // Find the first uncompleted, feasible task in progression order
    const uncompleted = FALLBACK_TASKS.filter(
      (t) => t.description !== this.lastTask
        && !this.completedTasks.includes(t.description)
        && !recentFailures.has(t.description)
        && taskMatchesProgression(t, progression)
    );

    if (uncompleted.length > 0) {
      // Pick from the first few to maintain progression order with slight variety
      const pick = uncompleted[Math.floor(Math.random() * Math.min(3, uncompleted.length))];
      this.lastTask = pick.description;
      return pick;
    }

    // All tasks completed or blocked — pick a random explore task to keep moving
    const exploreFallback: Task = {
      description: `Explore 50 blocks to the ${['north', 'south', 'east', 'west'][Math.floor(Math.random() * 4)]}`,
      keywords: ['explore', 'walk', 'movement'],
    };
    this.lastTask = exploreFallback.description;
    return exploreFallback;
  }

  private async proposeLLMTask(
    bot: Bot,
    personality: string,
    skillLibrary: SkillLibrary
  ): Promise<Task> {
    try {
      const obs = renderObservation(bot);
      const progress = this.completedTasks.length;
      // Use warm-up gated observation — early tasks see fewer fields to prevent overload
      const obsText = formatObservationWithWarmup(obs, progress);

      const completedStr = this.completedTasks.length > 0
        ? this.completedTasks.slice(-15).join(', ')
        : 'none';
      const failedStr = this.failedTasks.length > 0
        ? this.failedTasks.slice(-10).join(', ')
        : 'none';
      // QA context is gated behind warm-up threshold (15 completed tasks)
      const contextQA = isContextWarmedUp(progress)
        ? await this.buildCurriculumContext(bot, personality)
        : '';

      const userMessage = `Bot personality: ${personality}
${contextQA}
${obsText}
Available skills: ${await skillLibrary.buildSkillSummary()}
Completed tasks: ${completedStr}
Failed tasks: ${failedStr}
Known blockers: ${this.blockerMemory.summarize()}
Known world memory: ${this.worldMemory.summary()}
Stats: ${this.statsTracker.summary(bot.username)}
Last task: ${this.lastTask || 'none'}

Propose the next task:`;

      const response = await this.llmClient!.generate(CURRICULUM_SYSTEM_PROMPT, userMessage, 1000);
      logger.debug({ rawResponse: response.text.slice(0, 500) }, 'Curriculum LLM raw response');
      const cleaned = response.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      // Extract first JSON object if LLM wraps it in extra text
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error(`No JSON object found in response: ${cleaned.slice(0, 200)}`);
      let parsed: any;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        // Truncated JSON — try to salvage the task field via regex
        const taskMatch = jsonMatch[0].match(/"task"\s*:\s*"([^"]+)"/);
        if (!taskMatch) throw new Error(`Truncated JSON, could not extract task: ${cleaned.slice(0, 200)}`);
        const kwMatch = jsonMatch[0].match(/"keywords"\s*:\s*\[([^\]]*)\]/);
        const keywords = kwMatch ? kwMatch[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) || [] : [];
        parsed = { task: taskMatch[1], keywords };
        logger.info({ task: parsed.task }, 'Curriculum: salvaged task from truncated LLM JSON');
      }
      this.lastTask = parsed.task || parsed.description;

      const taskContext = await this.getTaskContext(parsed.task || parsed.description, bot);
      const guidance = [...(parsed.guidance || []), ...(taskContext ? [taskContext] : [])];
      const proposedTask: Task = {
        description: parsed.task || parsed.description,
        keywords: parsed.keywords || [],
        guidance: guidance.length > 0 ? guidance : undefined,
        spec: parsed.spec || inferTaskSpec({ description: parsed.task || parsed.description, keywords: parsed.keywords || [] }),
      };
      const progression = getProgressionState(bot, this.completedTasks);
      if (!this.isTaskFeasible(proposedTask, progression) || !taskMatchesProgression(proposedTask, progression)) {
        logger.info({ task: proposedTask.description }, 'Curriculum proposed infeasible task, falling back to static');
        return this.proposeStaticTask(personality);
      }
      return proposedTask;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Curriculum LLM call failed, falling back to static');
      return this.proposeStaticTask(personality);
    }
  }

  private loadJsonArray(filePath: string): string[] {
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        return [];
      }
    }
    return [];
  }

  private loadJsonMap(filePath: string): Record<string, string> {
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        return {};
      }
    }
    return {};
  }

  private loadJsonEmbeddingMap(filePath: string): Record<string, number[]> {
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        return {};
      }
    }
    return {};
  }

  private persistTasks(): void {
    fs.writeFileSync(this.completedTasksPath, JSON.stringify(this.completedTasks, null, 2));
    fs.writeFileSync(this.failedTasksPath, JSON.stringify(this.failedTasks, null, 2));
    fs.writeFileSync(this.qaCachePath, JSON.stringify(this.qaCache, null, 2));
    fs.writeFileSync(this.qaEmbeddingPath, JSON.stringify(this.qaEmbeddings, null, 2));
  }

  private async buildCurriculumContext(bot: Bot, personality: string): Promise<string> {
    const questions = await this.generateDynamicQuestions(bot, personality);
    const contextBits: string[] = [];
    const baseContext = `Inventory: ${bot.inventory.items().map((item) => `${item.name}x${item.count}`).join(', ') || 'empty'} | World memory: ${this.worldMemory.summary()} | Completed: ${this.completedTasks.slice(-8).join(', ') || 'none'} | Failed: ${this.failedTasks.slice(-5).join(', ') || 'none'}`;

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      let answer = await this.lookupCachedAnswer(question);
      if (!answer && this.llmClient) {
        try {
          const response = await this.llmClient.generate(
            'Answer briefly with 1-2 sentences grounded in the provided Minecraft state.',
            `Question: ${question}\nState: ${baseContext}`,
            120,
          );
          answer = response.text.trim();
          await this.storeCachedAnswer(question, answer);
        } catch {
          answer = 'Unknown';
        }
      }
      if (answer && answer !== 'Unknown') {
        contextBits.push(`Question ${i + 1}: ${question}\nAnswer: ${answer}`);
      }
    }

    return contextBits.length ? `${contextBits.join('\n\n')}\n` : '';
  }

  private async generateDynamicQuestions(bot: Bot, personality: string): Promise<string[]> {
    const obs = renderObservation(bot);
    const biome = obs.biome;
    const worldMemory = this.worldMemory.summary();
    const fallback = [
      `What should a ${personality} bot prioritize next in the ${biome} biome?`,
      'What prerequisite item or workstation is most likely missing for the next useful progression step?',
      `Which remembered location from ${worldMemory} is most actionable right now?`,
    ];
    if (!this.llmClient) return fallback;
    try {
      const response = await this.llmClient.generate(
        'Generate 3 short Minecraft curriculum questions tailored to the bot state. Output only a JSON array of strings.',
        `Personality: ${personality}\nBiome: ${biome}\nInventory: ${obs.inventory}\nNearby blocks: ${obs.nearbyBlocks}\nKnown world memory: ${worldMemory}\nCompleted tasks: ${this.completedTasks.slice(-8).join(', ') || 'none'}`,
        160,
      );
      const cleaned = response.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, 5).filter((q) => typeof q === 'string');
      }
    } catch {
      // ignore
    }
    return fallback;
  }

  private async getTaskContext(taskDescription: string, bot: Bot): Promise<string> {
    const question = `How to ${taskDescription} in Minecraft given this inventory, world memory, and known blockers?`;
    const cached = await this.lookupCachedAnswer(question);
    if (cached) return cached;
    if (!this.llmClient) return '';
    try {
      const obs = renderObservation(bot);
      const response = await this.llmClient.generate(
        'Answer with concise task context for a Minecraft agent. Focus on prerequisites, likely tools, and useful nearby resources. 2-3 sentences max.',
        `Question: ${question}\nInventory: ${obs.inventory}\nNearby blocks: ${obs.nearbyBlocks}\nKnown world memory: ${this.worldMemory.summary()}\nKnown blockers: ${this.blockerMemory.summarize()}\nCompleted tasks: ${this.completedTasks.slice(-8).join(', ') || 'none'}`,
        140,
      );
      const answer = response.text.trim();
      await this.storeCachedAnswer(question, answer);
      return answer;
    } catch {
      return '';
    }
  }

  private async lookupCachedAnswer(question: string): Promise<string | undefined> {
    if (this.qaCache[question]) return this.qaCache[question];
    if (!this.llmClient?.embed) return undefined;
    const queryEmbedding = (await this.llmClient.embed([question]).catch(() => [] as number[][]))[0];
    if (!queryEmbedding) return undefined;
    let bestKey: string | undefined;
    let bestScore = 0;
    for (const [key, embedding] of Object.entries(this.qaEmbeddings)) {
      const score = this.cosineSimilarity(queryEmbedding, embedding);
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }
    if (bestKey && bestScore >= 0.92) {
      return this.qaCache[bestKey];
    }
    return undefined;
  }

  private async storeCachedAnswer(question: string, answer: string): Promise<void> {
    this.qaCache[question] = answer;
    if (this.llmClient?.embed) {
      const embedding = (await this.llmClient.embed([question]).catch(() => [] as number[][]))[0];
      if (embedding) this.qaEmbeddings[question] = embedding;
    }
    this.persistTasks();
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || !b.length || a.length !== b.length) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  private isTaskFeasible(task: Task, progression = this.lastBotForProgression
    ? getProgressionState(this.lastBotForProgression, this.completedTasks)
    : { hasWood: false, hasCraftingTable: false, hasWoodenPickaxe: false, hasWoodenHoe: false, hasCobblestone: false, canMineStoneTier: false, canFarm: false }): boolean {
    const spec = task.spec || inferTaskSpec(task);
    // Only block tasks that failed very recently (last 5), not all historical failures
    const recentFailures = new Set(this.failedTasks.slice(-5));
    if (recentFailures.has(task.description)) return false;
    if (this.blockerMemory.hasStrongBlocker(task)) return false;
    if (spec.target === 'wooden_hoe' && !progression.hasWood) {
      return false;
    }
    if (spec.target === 'wooden_pickaxe' && !progression.hasWood) {
      return false;
    }
    if (spec.target === 'iron_ore' && !progression.hasWoodenPickaxe) {
      return false;
    }
    return true;
  }

  /**
   * Decompose a complex player-requested goal into ordered subtasks.
   * Returns a flat list of Task objects to execute sequentially.
   * If decomposition fails or the task is already simple, returns the task as-is.
   */
  async decomposeTask(bot: Bot, description: string): Promise<Task[]> {
    if (!this.useLLM || !this.llmClient) {
      return [this.makeTask(description)];
    }

    try {
      const obs = renderObservation(bot);
      const obsText = formatObservation(obs);
      const completedStr = this.completedTasks.length > 0
        ? this.completedTasks.slice(-15).join(', ')
        : 'none';

      const systemPrompt = `You are a Minecraft task planner. Given a complex goal and the bot's current state, decompose it into a minimal ordered list of concrete subtasks.

Each subtask must be a single actionable step like "Mine 3 oak logs", "Craft 1 crafting table", "Smelt 3 raw iron", etc.
Only include steps that are actually needed — skip steps the bot can already satisfy with its current inventory.
Order matters: prerequisites must come before the tasks that need them.

Respond with ONLY a JSON array of strings, no markdown fences:
["subtask 1", "subtask 2", "subtask 3"]

If the goal is already a single simple task, return it as a one-element array.`;

      const userMessage = `${obsText}
Completed tasks so far: ${completedStr}

Goal: ${description}

Decompose into ordered subtasks:`;

      const response = await this.llmClient.generate(systemPrompt, userMessage, 1000);
      const cleaned = response.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const subtasks: string[] = JSON.parse(cleaned);

      if (!Array.isArray(subtasks) || subtasks.length === 0) {
        return [this.makeTask(description)];
      }

      logger.info({
        goal: description,
        subtasks,
        count: subtasks.length,
      }, 'Task decomposed into subtasks');

      return subtasks.map((desc) => this.makeTask(desc));
    } catch (err: any) {
      logger.warn({ err: err.message, goal: description }, 'Task decomposition failed, using as-is');
      return [this.makeTask(description)];
    }
  }

  private makeTask(description: string): Task {
    const keywords = description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return { description, keywords, spec: inferTaskSpec({ description, keywords }) };
  }

  getBlockerMemory(): BlockerMemory {
    return this.blockerMemory;
  }

  getWorldMemory(): WorldMemory {
    return this.worldMemory;
  }
}
