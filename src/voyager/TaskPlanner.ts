import { Task } from './CurriculumAgent';
import { inferTaskSpec, TaskSpec } from './TaskSpec';
import { ProgressionState } from './Progression';
import { BlockerRecord } from './BlockerMemory';
import { WorldMemory } from './WorldMemory';

export interface PlannedStep {
  description: string;
  keywords: string[];
  spec?: TaskSpec;
}

export interface TaskPlan {
  steps: PlannedStep[];
}

export function buildTaskPlan(task: Task, progression: ProgressionState): TaskPlan {
  const spec = inferTaskSpec(task);

  if (spec.kind === 'craft' && spec.target === 'wooden_hoe') {
    const steps: PlannedStep[] = [];
    if (!progression.hasWood) {
      steps.push(step('Mine 3 oak logs', ['mine', 'oak_log', 'wood'], { kind: 'harvest', target: 'oak_log', count: 3 }));
    }
    steps.push(step('Craft a wooden hoe', ['craft', 'hoe', 'wood'], spec));
    return { steps };
  }

  if (spec.kind === 'craft' && spec.target === 'wooden_pickaxe') {
    const steps: PlannedStep[] = [];
    if (!progression.hasWood) {
      steps.push(step('Mine 3 oak logs', ['mine', 'oak_log', 'wood'], { kind: 'harvest', target: 'oak_log', count: 3 }));
    }
    steps.push(step('Craft a wooden pickaxe', ['craft', 'pickaxe', 'wood'], spec));
    return { steps };
  }

  if (spec.kind === 'movement' && spec.target === 'iron_ore' && !progression.hasWoodenPickaxe) {
    return {
      steps: [
        step('Mine 3 oak logs', ['mine', 'oak_log', 'wood'], { kind: 'harvest', target: 'oak_log', count: 3 }),
        step('Craft a wooden pickaxe', ['craft', 'pickaxe', 'wood'], { kind: 'craft', target: 'wooden_pickaxe', count: 1, prerequisites: ['oak_log', 'crafting_table'] }),
        step(task.description, task.keywords, spec),
      ],
    };
  }

  if (spec.kind === 'harvest' && spec.target === 'wheat_seeds' && !progression.canFarm) {
    return {
      steps: [
        step('Walk to the nearest farmland', ['walk', 'farm', 'crops'], { kind: 'movement', destination: 'farmland', target: 'farmland', count: 1 }),
        step(task.description, task.keywords, spec),
      ],
    };
  }

  return { steps: [step(task.description, task.keywords, spec)] };
}

export function replanTaskStep(task: Task, blockers: BlockerRecord[], worldMemory: WorldMemory): TaskPlan | null {
  const spec = inferTaskSpec(task);
  const blockerKinds = new Set(blockers.map((b) => b.blocker));

  if (blockerKinds.has('materials') && spec.kind === 'craft' && spec.target === 'wooden_hoe') {
    return {
      steps: [
        step('Mine 3 oak logs', ['mine', 'oak_log', 'wood'], { kind: 'harvest', target: 'oak_log', count: 3 }),
        step('Craft a wooden hoe', ['craft', 'hoe', 'wood'], spec),
      ],
    };
  }

  if (blockerKinds.has('movement') && spec.target === 'farmland') {
    const knownFarmland = worldMemory.findNearest('farmland', 'resource');
    if (knownFarmland) {
      return {
        steps: [
          step(`Move to known farmland at ${Math.round(knownFarmland.x)}, ${Math.round(knownFarmland.y)}, ${Math.round(knownFarmland.z)}`, ['walk', 'farm', 'crops'], { kind: 'movement', target: 'farmland', destination: 'farmland', count: 1 }),
        ],
      };
    }
  }

  if (blockerKinds.has('targeting') && spec.target === 'wheat_seeds') {
    return {
      steps: [
        step('Walk to the nearest farmland', ['walk', 'farm', 'crops'], { kind: 'movement', destination: 'farmland', target: 'farmland', count: 1 }),
        step('Explore and find wheat seeds', ['explore', 'seeds', 'wheat'], { kind: 'harvest', target: 'wheat_seeds', count: 1 }),
      ],
    };
  }

  return null;
}

function step(description: string, keywords: string[], spec?: TaskSpec): PlannedStep {
  return { description, keywords, spec };
}
