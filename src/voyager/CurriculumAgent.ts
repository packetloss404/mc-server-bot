import fs from 'fs';
import path from 'path';
import { Bot } from 'mineflayer';
import { LLMClient } from '../ai/LLMClient';
import { SkillLibrary } from './SkillLibrary';
import { renderObservation, formatObservation } from './Observation';
import { logger } from '../util/logger';

export interface Task {
  description: string;
  keywords: string[];
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

Output ONLY a JSON object with no markdown fences: {"reasoning": "why this task", "task": "the task description", "keywords": ["keyword1", "keyword2"]}`;

// Static fallback pools per personality
const PERSONALITY_TASKS: Record<string, Task[]> = {
  merchant: [
    { description: 'Mine 1 oak log', keywords: ['mine', 'oak_log', 'wood'] },
    { description: 'Walk to the nearest player', keywords: ['walk', 'player', 'approach'] },
    { description: 'Announce wares to nearby players', keywords: ['chat', 'announce', 'trade'] },
    { description: 'Explore a new area by walking east', keywords: ['walk', 'explore', 'east'] },
  ],
  guard: [
    { description: 'Mine 1 oak log', keywords: ['mine', 'oak_log', 'wood'] },
    { description: 'Patrol the area by walking to 4 waypoints', keywords: ['patrol', 'walk', 'guard'] },
    { description: 'Walk to the nearest player', keywords: ['walk', 'player', 'approach'] },
    { description: 'Explore and report nearby mobs', keywords: ['explore', 'mob', 'report'] },
  ],
  explorer: [
    { description: 'Mine 3 oak logs', keywords: ['mine', 'oak_log', 'wood'] },
    { description: 'Explore 50 blocks to the north', keywords: ['explore', 'walk', 'north'] },
    { description: 'Mine 3 cobblestone', keywords: ['mine', 'stone', 'cobblestone'] },
    { description: 'Craft a wooden pickaxe', keywords: ['craft', 'pickaxe', 'wood'] },
  ],
  farmer: [
    { description: 'Mine 1 oak log', keywords: ['mine', 'oak_log', 'wood'] },
    { description: 'Walk to the nearest farmland', keywords: ['walk', 'farm', 'crops'] },
    { description: 'Explore and find wheat seeds', keywords: ['explore', 'seeds', 'wheat'] },
    { description: 'Craft a wooden hoe', keywords: ['craft', 'hoe', 'wood'] },
  ],
  blacksmith: [
    { description: 'Mine 3 cobblestone', keywords: ['mine', 'stone', 'cobblestone'] },
    { description: 'Mine 3 oak logs', keywords: ['mine', 'oak_log', 'wood'] },
    { description: 'Craft a wooden pickaxe', keywords: ['craft', 'pickaxe', 'wood'] },
    { description: 'Explore and find iron ore', keywords: ['explore', 'iron', 'ore'] },
  ],
  elder: [
    { description: 'Mine 1 oak log', keywords: ['mine', 'oak_log', 'wood'] },
    { description: 'Walk slowly around and observe', keywords: ['walk', 'explore', 'observe'] },
    { description: 'Share wisdom with nearby players', keywords: ['chat', 'wisdom', 'player'] },
    { description: 'Explore the nearby village area', keywords: ['walk', 'explore', 'village'] },
  ],
};

export class CurriculumAgent {
  private llmClient: LLMClient | null;
  private useLLM: boolean;
  private lastTask: string = '';
  private completedTasks: string[] = [];
  private failedTasks: string[] = [];
  private completedTasksPath: string;
  private failedTasksPath: string;

  constructor(llmClient: LLMClient | null, useLLM: boolean, dataDir: string = './data') {
    this.llmClient = llmClient;
    this.useLLM = useLLM && !!llmClient;

    // Ensure data dir exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.completedTasksPath = path.join(dataDir, 'completed_tasks.json');
    this.failedTasksPath = path.join(dataDir, 'failed_tasks.json');

    // Load persisted state
    this.completedTasks = this.loadJsonArray(this.completedTasksPath);
    this.failedTasks = this.loadJsonArray(this.failedTasksPath);

    if (this.completedTasks.length > 0) {
      this.lastTask = this.completedTasks[this.completedTasks.length - 1];
      logger.info({ completedCount: this.completedTasks.length, failedCount: this.failedTasks.length }, 'Loaded curriculum progress from disk');
    }
  }

  updateProgress(task: Task, success: boolean): void {
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

  async proposeTask(
    bot: Bot,
    personality: string,
    skillLibrary: SkillLibrary
  ): Promise<Task> {
    // First task is always "Mine 1 wood log" (like original Voyager)
    if (this.completedTasks.length === 0 && this.lastTask === '') {
      this.lastTask = 'Mine 1 oak log';
      return { description: 'Mine 1 oak log', keywords: ['mine', 'oak_log', 'wood'] };
    }

    if (this.useLLM && this.llmClient) {
      return this.proposeLLMTask(bot, personality, skillLibrary);
    }
    return this.proposeStaticTask(personality);
  }

  private proposeStaticTask(personality: string): Task {
    const tasks = PERSONALITY_TASKS[personality] || PERSONALITY_TASKS.explorer;
    // Filter out already completed tasks
    const available = tasks.filter(
      (t) => t.description !== this.lastTask && !this.completedTasks.includes(t.description)
    );
    const pool = available.length > 0 ? available : tasks;
    const task = pool[Math.floor(Math.random() * pool.length)];
    this.lastTask = task.description;
    return task;
  }

  private async proposeLLMTask(
    bot: Bot,
    personality: string,
    skillLibrary: SkillLibrary
  ): Promise<Task> {
    try {
      const obs = renderObservation(bot);
      const obsText = formatObservation(obs);

      const completedStr = this.completedTasks.length > 0
        ? this.completedTasks.slice(-15).join(', ')
        : 'none';
      const failedStr = this.failedTasks.length > 0
        ? this.failedTasks.slice(-10).join(', ')
        : 'none';

      const userMessage = `Bot personality: ${personality}
${obsText}
Available skills: ${skillLibrary.buildSkillSummary()}
Completed tasks: ${completedStr}
Failed tasks: ${failedStr}
Last task: ${this.lastTask || 'none'}

Propose the next task:`;

      const response = await this.llmClient!.generate(CURRICULUM_SYSTEM_PROMPT, userMessage, 300);
      const cleaned = response.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      this.lastTask = parsed.task || parsed.description;

      return {
        description: parsed.task || parsed.description,
        keywords: parsed.keywords || [],
      };
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

  private persistTasks(): void {
    fs.writeFileSync(this.completedTasksPath, JSON.stringify(this.completedTasks, null, 2));
    fs.writeFileSync(this.failedTasksPath, JSON.stringify(this.failedTasks, null, 2));
  }
}
