import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';
import { LLMClient } from '../ai/LLMClient';

export interface PlanStep {
  description: string;
  preconditions: string[];
  postconditions: string[];
  estimatedDurationMs: number;
  failureRate: number;
}

export interface PlanTemplate {
  id: string;
  goal: string;
  steps: PlanStep[];
  successCount: number;
  failureCount: number;
  avgCompletionMs: number;
  lastUsed: number;
  keywords: string[];
}

type SparseVector = Map<string, number>;

const PLAN_GENERATION_SYSTEM_PROMPT = `You are a Minecraft task planner. Given a goal, decompose it into concrete sequential steps.

Each step must specify:
- description: what to do
- preconditions: what must be true before this step (array of strings)
- postconditions: what will be true after this step (array of strings)
- estimatedDurationMs: estimated time in milliseconds
- failureRate: estimated probability of failure (0.0-1.0)

Precondition/postcondition format:
- "has:item_name:count" - bot has N of an item (e.g. "has:oak_log:3", "has:crafting_table:1")
- "near:block_name" - bot is near a block type (e.g. "near:crafting_table", "near:oak_log")

Output ONLY a JSON array of step objects with no markdown fences. Example:
[
  {
    "description": "Mine 3 oak logs",
    "preconditions": ["near:oak_log"],
    "postconditions": ["has:oak_log:3"],
    "estimatedDurationMs": 15000,
    "failureRate": 0.1
  },
  {
    "description": "Craft 12 oak planks",
    "preconditions": ["has:oak_log:3"],
    "postconditions": ["has:oak_planks:12"],
    "estimatedDurationMs": 5000,
    "failureRate": 0.05
  }
]`;

export class PlanLibrary {
  private dataDir: string;
  private filePath: string;
  private templates: PlanTemplate[] = [];
  private docFreq: Map<string, number> = new Map();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'plan_templates.json');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.loadFromDisk();
    this.rebuildDocFreq();
  }

  /** Return all templates */
  getAll(): PlanTemplate[] {
    return this.templates;
  }

  /** Exact match lookup by goal */
  getByGoal(goal: string): PlanTemplate | null {
    const lower = goal.toLowerCase().trim();
    return this.templates.find((t) => t.goal.toLowerCase().trim() === lower) ?? null;
  }

  /** Find the best matching plan for a goal using TF-IDF keyword scoring */
  findBestPlan(goal: string, keywords: string[]): PlanTemplate | null {
    if (this.templates.length === 0) return null;

    const queryDoc = `${goal} ${keywords.join(' ')}`.toLowerCase();
    const queryVector = this.buildVector(queryDoc);

    const scored = this.templates.map((template) => {
      const templateDoc = this.buildTemplateDocument(template);
      const templateVector = this.buildVector(templateDoc);
      let score = this.cosineSimilarity(queryVector, templateVector);

      // Keyword overlap bonus
      const queryWords = keywords.map((k) => k.toLowerCase());
      for (const word of queryWords) {
        if (template.keywords.some((k) => k === word)) score += 5;
        else if (template.keywords.some((k) => k.includes(word) || word.includes(k))) score += 2;
        if (template.goal.toLowerCase().includes(word)) score += 3;
      }

      // Multi-word match bonus
      const matchedWords = queryWords.filter(
        (w) =>
          template.keywords.some((k) => k.includes(w) || w.includes(k)) ||
          template.goal.toLowerCase().includes(w),
      );
      if (matchedWords.length > 1) score += matchedWords.length * 2;

      // Exact goal match bonus
      if (template.goal.toLowerCase().trim() === goal.toLowerCase().trim()) score += 20;

      // Quality scoring: deprioritize low success rate templates
      const total = template.successCount + template.failureCount;
      if (total > 0) {
        const successRate = template.successCount / total;
        if (successRate < 0.3) {
          score *= 0.3;
        } else {
          score *= 0.5 + successRate * 0.5;
        }
      }

      return { template, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score <= 0) return null;
    return best.template;
  }

  /** Save a new plan template or update an existing one if the goal matches closely */
  savePlan(goal: string, steps: PlanStep[], keywords: string[]): PlanTemplate {
    const existing = this.getByGoal(goal);

    if (existing) {
      existing.steps = steps;
      existing.keywords = keywords;
      existing.lastUsed = Date.now();
      logger.info({ id: existing.id, goal }, 'Updated existing plan template');
      this.scheduleSave();
      return existing;
    }

    const template: PlanTemplate = {
      id: this.generateId(),
      goal,
      steps,
      successCount: 0,
      failureCount: 0,
      avgCompletionMs: 0,
      lastUsed: Date.now(),
      keywords,
    };

    this.templates.push(template);
    this.rebuildDocFreq();
    this.scheduleSave();
    logger.info({ id: template.id, goal, stepCount: steps.length }, 'Saved new plan template');
    return template;
  }

  /** Record the outcome of executing a plan */
  recordOutcome(planId: string, success: boolean, durationMs: number): void {
    const template = this.templates.find((t) => t.id === planId);
    if (!template) {
      logger.warn({ planId }, 'Cannot record outcome: plan template not found');
      return;
    }

    if (success) {
      template.successCount++;
    } else {
      template.failureCount++;
    }

    // Update rolling average completion time
    const totalRuns = template.successCount + template.failureCount;
    template.avgCompletionMs =
      (template.avgCompletionMs * (totalRuns - 1) + durationMs) / totalRuns;
    template.lastUsed = Date.now();

    this.scheduleSave();
    logger.info(
      { planId, success, durationMs, successCount: template.successCount, failureCount: template.failureCount },
      'Recorded plan outcome',
    );
  }

  /** Ask the LLM to decompose a goal into PlanSteps */
  async generatePlanWithLLM(
    goal: string,
    context: string,
    llmClient: LLMClient,
  ): Promise<PlanStep[]> {
    const userMessage = `Goal: ${goal}\n\nCurrent context:\n${context}\n\nDecompose this goal into sequential steps. Output ONLY a JSON array.`;

    try {
      const response = await llmClient.generate(
        PLAN_GENERATION_SYSTEM_PROMPT,
        userMessage,
        1024,
      );

      const text = response.text.trim();
      // Strip markdown fences if present
      const jsonStr = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) {
        logger.warn({ goal }, 'LLM plan generation did not return an array');
        return [];
      }

      const steps: PlanStep[] = parsed.map((raw: any) => ({
        description: String(raw.description ?? ''),
        preconditions: Array.isArray(raw.preconditions) ? raw.preconditions.map(String) : [],
        postconditions: Array.isArray(raw.postconditions) ? raw.postconditions.map(String) : [],
        estimatedDurationMs: Number(raw.estimatedDurationMs) || 10000,
        failureRate: Math.max(0, Math.min(1, Number(raw.failureRate) || 0.1)),
      }));

      logger.info({ goal, stepCount: steps.length }, 'Generated plan with LLM');
      return steps;
    } catch (err) {
      logger.error({ goal, err }, 'Failed to generate plan with LLM');
      return [];
    }
  }

  /** Adapt an existing template by pruning steps whose preconditions are already satisfied */
  adaptPlan(
    template: PlanTemplate,
    currentInventory: Record<string, number>,
  ): PlanStep[] {
    const satisfied = new Set<string>();

    // Mark inventory-based conditions as satisfied
    for (const [item, count] of Object.entries(currentInventory)) {
      if (count > 0) {
        // Mark all "has:item:N" where N <= count as satisfied
        satisfied.add(`has:${item}`);
        for (let n = 1; n <= count; n++) {
          satisfied.add(`has:${item}:${n}`);
        }
      }
    }

    const adaptedSteps: PlanStep[] = [];
    // Track postconditions accumulated so far
    const accumulated = new Set<string>(satisfied);

    for (const step of template.steps) {
      // Check if all postconditions are already satisfied
      const postconditionsAlreadyMet = step.postconditions.length > 0 &&
        step.postconditions.every((pc) => accumulated.has(pc));

      if (postconditionsAlreadyMet) {
        // Skip this step, but its postconditions are still "available"
        logger.debug({ step: step.description }, 'Pruning step: postconditions already satisfied');
        continue;
      }

      adaptedSteps.push(step);

      // Add this step's postconditions to the accumulated set
      for (const pc of step.postconditions) {
        accumulated.add(pc);
      }
    }

    return adaptedSteps;
  }

  // --- Private helpers ---

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) {
      this.templates = [];
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.templates = parsed;
      } else {
        this.templates = [];
      }
      logger.info({ count: this.templates.length }, 'Loaded plan templates from disk');
    } catch (err) {
      logger.warn({ err }, 'Failed to load plan templates, starting fresh');
      this.templates = [];
    }
  }

  private saveToDisk(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.templates, null, 2));
    } catch (err) {
      logger.error({ err }, 'Failed to save plan templates to disk');
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveToDisk();
    }, 1000);
  }

  private generateId(): string {
    return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private buildTemplateDocument(template: PlanTemplate): string {
    const stepDescs = template.steps.map((s) => s.description).join(' ');
    return `${template.goal} ${template.keywords.join(' ')} ${stepDescs}`.toLowerCase();
  }

  private rebuildDocFreq(): void {
    this.docFreq = new Map();
    for (const template of this.templates) {
      const seen = new Set(this.tokenize(this.buildTemplateDocument(template)));
      for (const token of seen) {
        this.docFreq.set(token, (this.docFreq.get(token) || 0) + 1);
      }
    }
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2);
  }

  private buildVector(text: string): SparseVector {
    const tokens = this.tokenize(text);
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    const vector: SparseVector = new Map();
    const totalDocs = Math.max(this.templates.length, 1);
    for (const [token, count] of tf.entries()) {
      const df = this.docFreq.get(token) || 0;
      const idf = Math.log((totalDocs + 1) / (df + 1)) + 1;
      vector.set(token, count * idf);
    }
    return vector;
  }

  private cosineSimilarity(a: SparseVector, b: SparseVector): number {
    if (a.size === 0 || b.size === 0) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;

    for (const value of a.values()) magA += value * value;
    for (const value of b.values()) magB += value * value;
    for (const [token, valueA] of a.entries()) {
      const valueB = b.get(token);
      if (valueB) dot += valueA * valueB;
    }

    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }
}
