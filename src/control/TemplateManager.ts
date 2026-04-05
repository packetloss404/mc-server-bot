/* ── TemplateManager: reusable mission templates ── */

import { randomUUID } from 'crypto';
import { MissionManager } from './MissionManager';
import { MissionPriority, Mission } from './MissionTypes';

export interface MissionTemplate {
  id: string;
  name: string;
  description: string;
  priority: MissionPriority;
  steps: Array<{ description: string }>;
  requiresApproval: boolean;
  retriesLeft: number;
  createdAt: number;
  updatedAt: number;
}

export class TemplateManager {
  private templates: Map<string, MissionTemplate> = new Map();
  private missionManager: MissionManager | null = null;

  setMissionManager(mm: MissionManager): void {
    this.missionManager = mm;
  }

  create(
    name: string,
    description: string,
    steps: Array<{ description: string }>,
    priority: MissionPriority = 'normal',
    requiresApproval = false,
    retriesLeft = 0
  ): MissionTemplate {
    const id = randomUUID();
    const now = Date.now();
    const template: MissionTemplate = {
      id,
      name,
      description,
      priority,
      steps,
      requiresApproval,
      retriesLeft,
      createdAt: now,
      updatedAt: now,
    };
    this.templates.set(id, template);
    return template;
  }

  get(templateId: string): MissionTemplate | undefined {
    return this.templates.get(templateId);
  }

  list(): MissionTemplate[] {
    return [...this.templates.values()];
  }

  update(templateId: string, patch: Partial<Pick<MissionTemplate, 'name' | 'description' | 'steps' | 'priority' | 'requiresApproval' | 'retriesLeft'>>): MissionTemplate | undefined {
    const t = this.templates.get(templateId);
    if (!t) return undefined;
    if (patch.name !== undefined) t.name = patch.name;
    if (patch.description !== undefined) t.description = patch.description;
    if (patch.steps !== undefined) t.steps = patch.steps;
    if (patch.priority !== undefined) t.priority = patch.priority;
    if (patch.requiresApproval !== undefined) t.requiresApproval = patch.requiresApproval;
    if (patch.retriesLeft !== undefined) t.retriesLeft = patch.retriesLeft;
    t.updatedAt = Date.now();
    return t;
  }

  delete(templateId: string): boolean {
    return this.templates.delete(templateId);
  }

  /** Instantiate a mission from a template for a specific bot */
  instantiate(templateId: string, botName: string, source = 'template'): Mission | undefined {
    const t = this.templates.get(templateId);
    if (!t || !this.missionManager) return undefined;

    return this.missionManager.create({
      name: t.name,
      description: t.description,
      botName,
      priority: t.priority,
      steps: t.steps,
      requiresApproval: t.requiresApproval,
      retriesLeft: t.retriesLeft,
      source,
      templateId: t.id,
    });
  }

  toJSON(): MissionTemplate[] {
    return this.list();
  }

  loadFrom(templates: MissionTemplate[]): void {
    this.templates.clear();
    for (const t of templates) this.templates.set(t.id, t);
  }
}
