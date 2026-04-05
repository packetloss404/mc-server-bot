/* ── CommanderService: natural language command parsing via LLM ── */

import { CommandCenter } from './CommandCenter';
import { MissionManager } from './MissionManager';
import { CommandType, CommandPayload } from './CommandTypes';
import { MissionPriority } from './MissionTypes';

export interface ParsedPlan {
  /** Whether the parser needs more information */
  needsClarification: boolean;
  clarificationQuestion?: string;

  commands: Array<{
    type: CommandType;
    botName: string;
    payload: CommandPayload;
  }>;

  missions: Array<{
    name: string;
    description: string;
    botName: string;
    priority: MissionPriority;
    steps: Array<{ description: string }>;
  }>;
}

export type LLMParser = (input: string) => Promise<ParsedPlan>;

export class CommanderService {
  private commandCenter: CommandCenter;
  private missionManager: MissionManager;
  private llmParser: LLMParser | null = null;

  constructor(commandCenter: CommandCenter, missionManager: MissionManager) {
    this.commandCenter = commandCenter;
    this.missionManager = missionManager;
  }

  setLLMParser(parser: LLMParser): void {
    this.llmParser = parser;
  }

  /** Parse natural language into a structured plan */
  async parse(input: string): Promise<ParsedPlan> {
    if (!this.llmParser) {
      throw new Error('LLM parser not configured');
    }
    return this.llmParser(input);
  }

  /** Execute a previously parsed plan */
  async execute(plan: ParsedPlan, source = 'commander'): Promise<{
    commandIds: string[];
    missionIds: string[];
    errors: string[];
  }> {
    if (plan.needsClarification) {
      return { commandIds: [], missionIds: [], errors: ['Plan needs clarification before execution'] };
    }

    const commandIds: string[] = [];
    const missionIds: string[] = [];
    const errors: string[] = [];

    // Dispatch commands
    for (const c of plan.commands) {
      try {
        const cmd = await this.commandCenter.dispatch(c.type, c.botName, c.payload, source);
        commandIds.push(cmd.id);
        if (cmd.status === 'failed' || cmd.status === 'rejected') {
          errors.push(`Command ${cmd.type} for ${c.botName}: ${cmd.error}`);
        }
      } catch (err: any) {
        errors.push(`Command ${c.type} for ${c.botName}: ${err.message}`);
      }
    }

    // Create missions
    for (const m of plan.missions) {
      try {
        const mission = this.missionManager.create({
          name: m.name,
          description: m.description,
          botName: m.botName,
          priority: m.priority,
          steps: m.steps,
          source,
        });
        missionIds.push(mission.id);
      } catch (err: any) {
        errors.push(`Mission ${m.name}: ${err.message}`);
      }
    }

    return { commandIds, missionIds, errors };
  }
}
