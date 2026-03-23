import { LLMClient } from '../ai/LLMClient';
import { BotManager } from '../bot/BotManager';
import { CommandCenter } from './CommandCenter';
import { MissionManager } from './MissionManager';
import { MarkerStore } from './MarkerStore';
import {
  CommanderPlan,
  CommanderPlanCommand,
  CommanderPlanMission,
  CommandRecord,
  CommandType,
} from './CommandTypes';
import { MissionRecord, MissionType } from './MissionTypes';
import { logger } from '../util/logger';

// All valid command types for validation
const VALID_COMMAND_TYPES: CommandType[] = [
  'pause_voyager',
  'resume_voyager',
  'stop_movement',
  'follow_player',
  'walk_to_coords',
  'move_to_marker',
  'return_to_base',
  'regroup',
  'guard_zone',
  'patrol_route',
  'deposit_inventory',
  'equip_best',
  'unstuck',
];

const VALID_MISSION_TYPES: MissionType[] = [
  'queue_task',
  'gather_items',
  'craft_items',
  'smelt_batch',
  'build_schematic',
  'supply_chain',
  'patrol_zone',
  'escort_player',
  'resupply_builder',
];

export interface CommanderServiceDeps {
  llmClient: LLMClient | null;
  botManager: BotManager;
  commandCenter: CommandCenter;
  missionManager: MissionManager;
  markerStore: MarkerStore;
}

export interface CommanderExecuteResult {
  commands: CommandRecord[];
  missions: MissionRecord[];
}

export class CommanderService {
  private llmClient: LLMClient | null;
  private botManager: BotManager;
  private commandCenter: CommandCenter;
  private missionManager: MissionManager;
  private markerStore: MarkerStore;
  private plans: Map<string, CommanderPlan> = new Map();

  constructor(deps: CommanderServiceDeps) {
    this.llmClient = deps.llmClient;
    this.botManager = deps.botManager;
    this.commandCenter = deps.commandCenter;
    this.missionManager = deps.missionManager;
    this.markerStore = deps.markerStore;
  }

  // ── Plan ID generation ──────────────────────────────────

  private generateId(): string {
    return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ── Parse NL input into a structured plan ───────────────

  async parse(input: string): Promise<CommanderPlan> {
    const planId = this.generateId();
    const now = new Date().toISOString();

    // If no LLM client, return a low-confidence stub
    if (!this.llmClient) {
      const plan: CommanderPlan = {
        id: planId,
        input,
        intent: '',
        confidence: 0,
        warnings: ['No LLM configured — natural language parsing is unavailable'],
        requiresConfirmation: true,
        commands: [],
        missions: [],
        createdAt: now,
      };
      this.plans.set(planId, plan);
      logger.warn({ planId }, 'Commander parse: no LLM client configured');
      return plan;
    }

    // Build context for the LLM
    const botNames = this.botManager.getAllBots().map((b) => b.name);
    const botStates = this.botManager.getAllBots().map((b) => {
      const status = b.getStatus();
      return `${b.name} (${b.personality}, ${status.mode}, pos: ${status.position ? `${status.position.x},${status.position.y},${status.position.z}` : 'unknown'})`;
    });
    const markers = this.markerStore.getMarkers();
    const markerNames = markers.map((m) => `${m.name} (${m.kind} at ${m.position.x},${m.position.y},${m.position.z})`);
    const zones = this.markerStore.getZones();
    const zoneNames = zones.map((z) => `${z.name} (${z.mode}, ${z.shape})`);

    const systemPrompt = `You are a Minecraft bot command parser. Given the user's natural language request and the current context, output a JSON plan.

Available bots: ${botNames.length > 0 ? botNames.join(', ') : '(none spawned)'}
Bot states: ${botStates.length > 0 ? botStates.join('; ') : '(none)'}
Available command types: ${VALID_COMMAND_TYPES.join(', ')}
Available mission types: ${VALID_MISSION_TYPES.join(', ')}
Available markers: ${markerNames.length > 0 ? markerNames.join('; ') : '(none)'}
Available zones: ${zoneNames.length > 0 ? zoneNames.join('; ') : '(none)'}

Output ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "intent": "description of what the user wants",
  "confidence": 0.0-1.0,
  "warnings": ["any issues or ambiguities"],
  "commands": [{ "type": "command_type", "targets": ["BotName"], "payload": {} }],
  "missions": [{ "type": "mission_type", "title": "...", "description": "...", "assigneeIds": ["BotName"] }]
}

Rules:
- Only use bot names that exist in the available bots list
- Only use command types from the available command types list
- Only use mission types from the available mission types list
- If the request is ambiguous, set confidence lower and add warnings
- If no bots are available, set confidence to 0 and add a warning
- For movement commands (walk_to_coords), include x, y, z in the payload
- For follow_player, include playerName in the payload
- Use "queue_task" mission type for general tasks that should be queued to a bot's voyager loop
- Commands are immediate actions; missions are longer-running objectives`;

    try {
      const response = await this.llmClient.generate(systemPrompt, input, 1024);
      const parsed = this.extractJson(response.text);

      if (!parsed) {
        const plan: CommanderPlan = {
          id: planId,
          input,
          intent: 'Failed to parse LLM response',
          confidence: 0,
          warnings: ['LLM response was not valid JSON'],
          requiresConfirmation: true,
          commands: [],
          missions: [],
          createdAt: now,
        };
        this.plans.set(planId, plan);
        logger.warn({ planId, rawResponse: response.text.slice(0, 500) }, 'Commander parse: invalid JSON from LLM');
        return plan;
      }

      // Validate and build the plan
      const { commands, missions, warnings } = this.validateParsed(parsed, botNames);

      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
      const allWarnings = [
        ...(Array.isArray(parsed.warnings) ? parsed.warnings : []),
        ...warnings,
      ];

      const plan: CommanderPlan = {
        id: planId,
        input,
        intent: String(parsed.intent || ''),
        confidence,
        warnings: allWarnings,
        requiresConfirmation: confidence < 0.8 || allWarnings.length > 0,
        commands,
        missions,
        createdAt: now,
      };

      this.plans.set(planId, plan);
      logger.info(
        { planId, intent: plan.intent, confidence, commandCount: commands.length, missionCount: missions.length },
        'Commander plan parsed',
      );
      return plan;
    } catch (err: any) {
      const plan: CommanderPlan = {
        id: planId,
        input,
        intent: 'LLM call failed',
        confidence: 0,
        warnings: [`LLM error: ${err?.message ?? String(err)}`],
        requiresConfirmation: true,
        commands: [],
        missions: [],
        createdAt: now,
      };
      this.plans.set(planId, plan);
<<<<<<< HEAD
      logger.error({ planId, err: err?.message }, 'Commander parse: LLM call failed');
=======
      logger.error({ err, planId }, 'Commander parse failed');
>>>>>>> worktree-agent-a92e65cc
      return plan;
    }
  }

  // ── Execute a previously parsed plan ────────────────────

  async execute(planId: string): Promise<CommanderExecuteResult | null> {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    const commands: CommandRecord[] = [];
    const missions: MissionRecord[] = [];

    // Execute commands
    for (const cmd of plan.commands) {
      try {
        const command = this.commandCenter.createCommand({
          type: cmd.type,
          targets: cmd.targets,
          params: cmd.payload,
          source: 'api',
          priority: 'normal',
        });
        await this.commandCenter.dispatchCommand(command);
        commands.push(command);
      } catch (err: any) {
<<<<<<< HEAD
        logger.error({ planId, commandType: cmd.type, err: err?.message }, 'Commander execute: command failed');
=======
        logger.error({ err, planId, commandType: cmd.type }, 'Command dispatch failed');
>>>>>>> worktree-agent-a92e65cc
      }
    }

    // Execute missions
    for (const msn of plan.missions) {
      try {
        const missionType = msn.type as MissionType;
        const mission = this.missionManager.createMission({
          type: missionType,
          title: msn.title,
          description: msn.description,
          assigneeType: 'bot',
          assigneeIds: msn.assigneeIds,
          source: 'commander',
          priority: 'normal',
        });
        missions.push(mission);
      } catch (err: any) {
<<<<<<< HEAD
        logger.error({ planId, missionType: msn.type, err: err?.message }, 'Commander execute: mission creation failed');
=======
        logger.error({ err, planId, missionType: msn.type }, 'Mission creation failed');
>>>>>>> worktree-agent-a92e65cc
      }
    }

    logger.info(
      { planId, commandsCreated: commands.length, missionsCreated: missions.length },
      'Commander plan executed',
    );

    return { commands, missions };
  }

  // ── Get a stored plan ───────────────────────────────────

  getPlan(planId: string): CommanderPlan | undefined {
    return this.plans.get(planId);
  }

  // ── Helpers ─────────────────────────────────────────────

  private extractJson(text: string): any | null {
    // Try direct parse first
    try {
      return JSON.parse(text);
    } catch {
      // Try to find JSON block in the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  private validateParsed(
    parsed: any,
    botNames: string[],
  ): { commands: CommanderPlanCommand[]; missions: CommanderPlanMission[]; warnings: string[] } {
    const commands: CommanderPlanCommand[] = [];
    const missions: CommanderPlanMission[] = [];
    const warnings: string[] = [];
    const botNamesLower = botNames.map((n) => n.toLowerCase());

    // Validate commands
    if (Array.isArray(parsed.commands)) {
      for (const raw of parsed.commands) {
        if (!raw || typeof raw !== 'object') continue;

        const type = raw.type as CommandType;
        if (!VALID_COMMAND_TYPES.includes(type)) {
          warnings.push(`Unknown command type: ${raw.type}`);
          continue;
        }

        const targets = Array.isArray(raw.targets) ? raw.targets : [];
        const validTargets: string[] = [];
        for (const t of targets) {
          const matchIdx = botNamesLower.indexOf(String(t).toLowerCase());
          if (matchIdx >= 0) {
            validTargets.push(botNames[matchIdx]); // use canonical name
          } else {
            warnings.push(`Bot "${t}" not found, skipping from command target`);
          }
        }

        if (validTargets.length === 0) {
          warnings.push(`Command "${type}" has no valid targets, skipping`);
          continue;
        }

        commands.push({
          type,
          targets: validTargets,
          payload: typeof raw.payload === 'object' && raw.payload ? raw.payload : {},
        });
      }
    }

    // Validate missions
    if (Array.isArray(parsed.missions)) {
      for (const raw of parsed.missions) {
        if (!raw || typeof raw !== 'object') continue;

        const type = raw.type;
        if (!VALID_MISSION_TYPES.includes(type as MissionType)) {
          warnings.push(`Unknown mission type: ${raw.type}`);
          continue;
        }

        const assigneeIds = Array.isArray(raw.assigneeIds) ? raw.assigneeIds : [];
        const validAssignees: string[] = [];
        for (const a of assigneeIds) {
          const matchIdx = botNamesLower.indexOf(String(a).toLowerCase());
          if (matchIdx >= 0) {
            validAssignees.push(botNames[matchIdx]);
          } else {
            warnings.push(`Bot "${a}" not found, skipping from mission assignees`);
          }
        }

        if (validAssignees.length === 0) {
          warnings.push(`Mission "${raw.title || type}" has no valid assignees, skipping`);
          continue;
        }

        missions.push({
          type,
          title: String(raw.title || `${type} mission`),
          description: raw.description ? String(raw.description) : undefined,
          assigneeIds: validAssignees,
        });
      }
    }

    return { commands, missions, warnings };
  }
}
