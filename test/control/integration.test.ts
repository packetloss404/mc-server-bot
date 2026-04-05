/**
 * Cross-Feature Integration Tests for the Control Platform
 *
 * Tests cross-manager interactions between CommandCenter, MissionManager,
 * RoleManager, SquadManager, RoutineManager, TemplateManager, CommanderService,
 * and MarkerStore.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { CommandCenter } from '../../src/control/CommandCenter';
import { MissionManager } from '../../src/control/MissionManager';
import { RoleManager } from '../../src/control/RoleManager';
import { SquadManager } from '../../src/control/SquadManager';
import { RoutineManager } from '../../src/control/RoutineManager';
import { TemplateManager } from '../../src/control/TemplateManager';
import { CommanderService, ParsedPlan } from '../../src/control/CommanderService';
import { MarkerStore } from '../../src/control/MarkerStore';
import { Command, CommandResult } from '../../src/control/CommandTypes';

/* ── Shared helpers ── */

/** A dispatcher that always succeeds */
const okDispatcher = async (_bot: string, _cmd: Command): Promise<CommandResult> => ({
  commandId: _cmd.id,
  success: true,
});

/** A dispatcher that always fails */
const failDispatcher = async (_bot: string, _cmd: Command): Promise<CommandResult> => ({
  commandId: _cmd.id,
  success: false,
  error: 'dispatch failed',
});

/** Wire up all managers with their cross-references */
function createPlatform() {
  const commandCenter = new CommandCenter();
  const missionManager = new MissionManager();
  const roleManager = new RoleManager();
  const squadManager = new SquadManager();
  const routineManager = new RoutineManager();
  const templateManager = new TemplateManager();
  const commanderService = new CommanderService(commandCenter, missionManager);
  const markerStore = new MarkerStore();

  // Wire cross-references
  commandCenter.setMissionManager(missionManager);
  commandCenter.setRoleManager(roleManager);
  missionManager.setRoleManager(roleManager);
  routineManager.setCommandCenter(commandCenter);
  templateManager.setMissionManager(missionManager);

  // Default: commands succeed
  commandCenter.setDispatcher(okDispatcher);

  return {
    commandCenter,
    missionManager,
    roleManager,
    squadManager,
    routineManager,
    templateManager,
    commanderService,
    markerStore,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   TEST CASES
   ═══════════════════════════════════════════════════════════════════ */

describe('Cross-Feature Integration Tests', () => {
  let platform: ReturnType<typeof createPlatform>;

  beforeEach(() => {
    platform = createPlatform();
  });

  /* ── 1. Role assignment with autonomy levels ── */
  it('1: manual autonomy blocks auto-generation, autonomous allows it', () => {
    const { missionManager, roleManager } = platform;

    // Autonomous role allows auto-generation
    roleManager.assign('BotA', 'farmer', 'autonomous');
    expect(missionManager.canAutoGenerate('BotA')).toBe(true);

    // Manual role blocks auto-generation
    roleManager.assign('BotB', 'guard', 'manual');
    expect(missionManager.canAutoGenerate('BotB')).toBe(false);

    // Assisted mode still allows (it requires approval, but generation is fine)
    roleManager.assign('BotC', 'explorer', 'assisted');
    expect(missionManager.canAutoGenerate('BotC')).toBe(true);
  });

  /* ── 2. Override prevents mission generation; clearing resumes it ── */
  it('2: override blocks mission start; clearing override resumes', () => {
    const { missionManager, roleManager } = platform;

    roleManager.assign('BotA', 'farmer', 'autonomous');
    expect(missionManager.canAutoGenerate('BotA')).toBe(true);

    // Set override
    roleManager.setOverride('BotA');
    expect(missionManager.canAutoGenerate('BotA')).toBe(false);

    // Mission start should also be blocked
    const mission = missionManager.create({
      name: 'Gather wheat',
      description: 'Gather 64 wheat',
      botName: 'BotA',
    });
    const started = missionManager.start(mission.id);
    expect(started).toBeUndefined();
    expect(mission.error).toBe('Bot is under manual override');

    // Clear override — auto-generation resumes
    roleManager.clearOverride('BotA');
    expect(missionManager.canAutoGenerate('BotA')).toBe(true);

    // Now we can start the mission (clear previous error first)
    mission.error = undefined;
    const started2 = missionManager.start(mission.id);
    expect(started2).toBeDefined();
    expect(started2!.status).toBe('running');
  });

  /* ── 3. Interrupt policy: command rejected when bot has critical mission ── */
  it('3: command is rejected when bot has a critical mission', async () => {
    const { commandCenter, missionManager } = platform;

    // Create and start a critical mission
    const mission = missionManager.create({
      name: 'Critical defense',
      description: 'Defend the base',
      botName: 'BotA',
      priority: 'critical',
    });
    missionManager.start(mission.id);
    expect(mission.status).toBe('running');

    // Attempt a command — should be rejected
    const cmd = await commandCenter.dispatch('move', 'BotA', { target: { x: 0, y: 0, z: 0 } }, 'user');
    expect(cmd.status).toBe('rejected');
    expect(cmd.error).toContain('critical mission');

    // Non-critical mission should not block
    const mission2 = missionManager.create({
      name: 'Patrol area',
      description: 'Walk around',
      botName: 'BotB',
      priority: 'normal',
    });
    missionManager.start(mission2.id);
    const cmd2 = await commandCenter.dispatch('move', 'BotB', { target: { x: 10, y: 0, z: 10 } }, 'user');
    expect(cmd2.status).toBe('completed');
  });

  /* ── 4. Commander parse + execute end-to-end (mock LLM) ── */
  it('4: commander parse + execute end-to-end with mock LLM', async () => {
    const { commanderService, commandCenter, missionManager } = platform;

    // Mock LLM parser
    const mockPlan: ParsedPlan = {
      needsClarification: false,
      commands: [
        { type: 'move', botName: 'BotA', payload: { target: { x: 100, y: 64, z: 200 } } },
      ],
      missions: [
        {
          name: 'Build a house',
          description: 'Build a small oak house',
          botName: 'BotA',
          priority: 'normal',
          steps: [
            { description: 'Gather 32 oak logs' },
            { description: 'Craft planks' },
            { description: 'Build structure' },
          ],
        },
      ],
    };

    commanderService.setLLMParser(async (_input: string) => mockPlan);

    // Parse
    const plan = await commanderService.parse('Send BotA to 100,64,200 and have it build a house');
    expect(plan.needsClarification).toBe(false);
    expect(plan.commands).toHaveLength(1);
    expect(plan.missions).toHaveLength(1);

    // Execute
    const result = await commanderService.execute(plan, 'test');
    expect(result.commandIds).toHaveLength(1);
    expect(result.missionIds).toHaveLength(1);
    expect(result.errors).toHaveLength(0);

    // Verify command was created
    const cmd = commandCenter.get(result.commandIds[0]);
    expect(cmd).toBeDefined();
    expect(cmd!.type).toBe('move');
    expect(cmd!.status).toBe('completed');

    // Verify mission was created
    const mission = missionManager.get(result.missionIds[0]);
    expect(mission).toBeDefined();
    expect(mission!.name).toBe('Build a house');
    expect(mission!.steps).toHaveLength(3);
  });

  /* ── 5. Routine CRUD + execution ── */
  it('5: routine CRUD and execution dispatches steps', async () => {
    const { routineManager, commandCenter } = platform;

    // Track dispatched commands
    const dispatched: string[] = [];
    commandCenter.setDispatcher(async (_bot, cmd) => {
      dispatched.push(cmd.type);
      return { commandId: cmd.id, success: true };
    });

    // Create
    const routine = routineManager.create('patrol-morning', 'Morning patrol route', [
      { commandType: 'move', payload: { target: { x: 0, y: 64, z: 0 } } },
      { commandType: 'guard', payload: { target: { x: 0, y: 64, z: 0 } } },
      { commandType: 'move', payload: { target: { x: 100, y: 64, z: 100 } } },
    ]);
    expect(routine.steps).toHaveLength(3);

    // Read
    expect(routineManager.get(routine.id)).toBeDefined();
    expect(routineManager.list()).toHaveLength(1);

    // Update
    routineManager.update(routine.id, { name: 'patrol-evening' });
    expect(routineManager.get(routine.id)!.name).toBe('patrol-evening');

    // Execute
    const exec = await routineManager.execute(routine.id, 'BotA');
    expect(exec.stepsCompleted).toBe(3);
    expect(exec.errors).toHaveLength(0);
    expect(dispatched).toEqual(['move', 'guard', 'move']);

    // Delete
    routineManager.delete(routine.id);
    expect(routineManager.list()).toHaveLength(0);
  });

  /* ── 6. Mission queue reorder / clear ── */
  it('6: mission queue reorder and clear operations', () => {
    const { missionManager } = platform;

    const m1 = missionManager.create({ name: 'M1', description: 'First', botName: 'BotA', priority: 'low' });
    const m2 = missionManager.create({ name: 'M2', description: 'Second', botName: 'BotA', priority: 'high' });
    const m3 = missionManager.create({ name: 'M3', description: 'Third', botName: 'BotA', priority: 'normal' });

    // Queue should be auto-sorted by priority: high, normal, low
    const queue = missionManager.getQueue('BotA');
    expect(queue.missions[0]).toBe(m2.id); // high
    expect(queue.missions[1]).toBe(m3.id); // normal
    expect(queue.missions[2]).toBe(m1.id); // low

    // Manual reorder
    missionManager.reorderQueue('BotA', [m1.id, m3.id, m2.id]);
    const reordered = missionManager.getQueue('BotA');
    expect(reordered.missions).toEqual([m1.id, m3.id, m2.id]);

    // Clear
    const cleared = missionManager.clearQueue('BotA');
    expect(cleared).toHaveLength(3);
    expect(missionManager.getQueue('BotA').missions).toHaveLength(0);
  });

  /* ── 7. Template creation + execution ── */
  it('7: template creation and instantiation produces missions', () => {
    const { templateManager, missionManager } = platform;

    const template = templateManager.create(
      'mining-run',
      'Mine iron and smelt into ingots',
      [{ description: 'Mine 32 iron ore' }, { description: 'Smelt into ingots' }],
      'high',
      false,
      2
    );
    expect(template.steps).toHaveLength(2);
    expect(template.retriesLeft).toBe(2);

    // Instantiate for two bots
    const m1 = templateManager.instantiate(template.id, 'BotA');
    const m2 = templateManager.instantiate(template.id, 'BotB');
    expect(m1).toBeDefined();
    expect(m2).toBeDefined();
    expect(m1!.templateId).toBe(template.id);
    expect(m1!.priority).toBe('high');
    expect(m1!.retriesLeft).toBe(2);
    expect(m2!.botName).toBe('BotB');

    // Verify missions are in the mission manager
    expect(missionManager.list()).toHaveLength(2);
  });

  /* ── 8. Squad CRUD + member management ── */
  it('8: squad CRUD and member management', () => {
    const { squadManager } = platform;

    // Create
    const squad = squadManager.create('Alpha', 'First squad');
    expect(squad.members).toHaveLength(0);

    // Add members
    expect(squadManager.addMember(squad.id, 'BotA')).toBe(true);
    expect(squadManager.addMember(squad.id, 'BotB')).toBe(true);
    // Duplicate add returns false
    expect(squadManager.addMember(squad.id, 'BotA')).toBe(false);
    expect(squadManager.get(squad.id)!.members).toEqual(['BotA', 'BotB']);

    // Update
    squadManager.update(squad.id, { name: 'Bravo' });
    expect(squadManager.get(squad.id)!.name).toBe('Bravo');

    // Find squads for bot
    const squad2 = squadManager.create('Charlie', 'Second squad');
    squadManager.addMember(squad2.id, 'BotA');
    const squadsForA = squadManager.getSquadsForBot('BotA');
    expect(squadsForA).toHaveLength(2);

    // Remove member
    expect(squadManager.removeMember(squad.id, 'BotA')).toBe(true);
    expect(squadManager.removeMember(squad.id, 'BotA')).toBe(false); // already removed
    expect(squadManager.get(squad.id)!.members).toEqual(['BotB']);

    // Delete squad
    expect(squadManager.delete(squad.id)).toBe(true);
    expect(squadManager.list()).toHaveLength(1);
  });

  /* ── 9. Role + Mission interaction (assisted mode with approval flow) ── */
  it('9: assisted mode requires approval before mission can start', () => {
    const { missionManager, roleManager } = platform;

    roleManager.assign('BotA', 'builder', 'assisted');

    // Create mission that requires approval
    const mission = missionManager.create({
      name: 'Build fence',
      description: 'Build a fence around the farm',
      botName: 'BotA',
      requiresApproval: true,
    });

    expect(mission.approved).toBe(false);

    // Cannot start without approval
    const started = missionManager.start(mission.id);
    expect(started).toBeUndefined();
    expect(mission.error).toBe('Mission requires approval before starting');

    // Approve the mission
    missionManager.approve(mission.id);
    expect(mission.approved).toBe(true);

    // Now it can start
    mission.error = undefined;
    const started2 = missionManager.start(mission.id);
    expect(started2).toBeDefined();
    expect(started2!.status).toBe('running');
  });

  /* ── 10. Commander clarification flow ── */
  it('10: commander handles clarification flow', async () => {
    const { commanderService } = platform;

    let callCount = 0;
    commanderService.setLLMParser(async (_input: string) => {
      callCount++;
      if (callCount === 1) {
        return {
          needsClarification: true,
          clarificationQuestion: 'Which bot should perform this task?',
          commands: [],
          missions: [],
        };
      }
      return {
        needsClarification: false,
        commands: [{ type: 'patrol', botName: 'BotA', payload: {} }],
        missions: [],
      };
    });

    // First parse needs clarification
    const plan1 = await commanderService.parse('patrol the area');
    expect(plan1.needsClarification).toBe(true);
    expect(plan1.clarificationQuestion).toBeDefined();

    // Executing a plan that needs clarification returns an error
    const result1 = await commanderService.execute(plan1);
    expect(result1.errors).toHaveLength(1);
    expect(result1.errors[0]).toContain('clarification');

    // Second parse with more info succeeds
    const plan2 = await commanderService.parse('BotA should patrol the area');
    expect(plan2.needsClarification).toBe(false);

    const result2 = await commanderService.execute(plan2);
    expect(result2.commandIds).toHaveLength(1);
    expect(result2.errors).toHaveLength(0);
  });

  /* ── 11. Concurrent dispatch to multiple bots (fan-out) ── */
  it('11: fan-out dispatches commands to multiple bots concurrently', async () => {
    const { commandCenter } = platform;

    const botNames = ['BotA', 'BotB', 'BotC'];
    const received: string[] = [];
    commandCenter.setDispatcher(async (bot, cmd) => {
      received.push(bot);
      return { commandId: cmd.id, success: true };
    });

    const commands = await commandCenter.fanOut(
      'pause',
      botNames,
      {},
      'admin'
    );

    expect(commands).toHaveLength(3);
    expect(commands.every((c) => c.status === 'completed')).toBe(true);
    expect(received.sort()).toEqual(['BotA', 'BotB', 'BotC']);
  });

  /* ── 12. Error recovery: mission retry after failure ── */
  it('12: mission retry after failure decrements retries and resets status', () => {
    const { missionManager } = platform;

    const mission = missionManager.create({
      name: 'Mine diamonds',
      description: 'Deep mine run',
      botName: 'BotA',
      retriesLeft: 2,
    });

    missionManager.start(mission.id);
    expect(mission.status).toBe('running');

    // Fail
    missionManager.fail(mission.id, 'Lava encountered');
    expect(mission.status).toBe('failed');
    expect(mission.error).toBe('Lava encountered');

    // Retry — should reset to pending
    expect(missionManager.retry(mission.id)).toBe(true);
    expect(mission.status).toBe('pending');
    expect(mission.retriesLeft).toBe(1);
    expect(mission.error).toBeUndefined();

    // Second failure and retry
    missionManager.start(mission.id);
    missionManager.fail(mission.id, 'Creeper attack');
    expect(missionManager.retry(mission.id)).toBe(true);
    expect(mission.retriesLeft).toBe(0);

    // Third failure — no retries left
    missionManager.start(mission.id);
    missionManager.fail(mission.id, 'Ran out of pickaxes');
    expect(missionManager.retry(mission.id)).toBe(false);
    expect(mission.status).toBe('failed');
  });

  /* ── 13. Persistence round-trips for all managers ── */
  it('13: persistence round-trip preserves state across save/load', () => {
    const { commandCenter, missionManager, roleManager, squadManager, routineManager, templateManager, markerStore } = platform;

    // Populate state
    roleManager.assign('BotA', 'farmer', 'autonomous');
    const squad = squadManager.create('Alpha', 'Test squad');
    squadManager.addMember(squad.id, 'BotA');

    const mission = missionManager.create({
      name: 'Test mission',
      description: 'Test',
      botName: 'BotA',
      steps: [{ description: 'Step 1' }],
    });

    const routine = routineManager.create('test-routine', 'Test', [
      { commandType: 'move', payload: { target: { x: 1, y: 2, z: 3 } } },
    ]);

    const template = templateManager.create('test-template', 'Test', [{ description: 'Step' }]);

    markerStore.createMarker('spawn', { x: 0, y: 64, z: 0 }, 'Spawn point');
    markerStore.createZone('farm', 'rectangular', { x: 50, y: 64, z: 50 }, { x: 10, y: 5, z: 10 });
    markerStore.createRoute('patrol', [{ x: 0, y: 64, z: 0 }, { x: 100, y: 64, z: 100 }], true);

    // Serialize
    const rolesJson = roleManager.toJSON();
    const squadsJson = squadManager.toJSON();
    const missionsJson = missionManager.toJSON();
    const routinesJson = routineManager.toJSON();
    const templatesJson = templateManager.toJSON();
    const markersJson = markerStore.toJSON();

    // Create fresh platform and restore
    const fresh = createPlatform();
    fresh.roleManager.loadFrom(rolesJson);
    fresh.squadManager.loadFrom(squadsJson);
    fresh.missionManager.loadFrom(missionsJson);
    fresh.routineManager.loadFrom(routinesJson);
    fresh.templateManager.loadFrom(templatesJson);
    fresh.markerStore.loadFrom(markersJson);

    // Verify
    expect(fresh.roleManager.getByBot('BotA')!.role).toBe('farmer');
    expect(fresh.squadManager.get(squad.id)!.members).toEqual(['BotA']);
    expect(fresh.missionManager.get(mission.id)!.name).toBe('Test mission');
    expect(fresh.routineManager.get(routine.id)!.name).toBe('test-routine');
    expect(fresh.templateManager.get(template.id)!.name).toBe('test-template');
    expect(fresh.markerStore.listMarkers()).toHaveLength(1);
    expect(fresh.markerStore.listZones()).toHaveLength(1);
    expect(fresh.markerStore.listRoutes()).toHaveLength(1);
  });

  /* ── 14. Override expiry auto-clears and resumes auto-generation ── */
  it('14: override with expiry auto-clears after the deadline', () => {
    const { missionManager, roleManager } = platform;

    roleManager.assign('BotA', 'farmer', 'autonomous');

    // Set override that expires in 0ms (immediately expired)
    roleManager.setOverride('BotA', 0);
    // Override is set but expired
    const assignment = roleManager.getByBot('BotA')!;
    expect(assignment.manualOverride).toBe(true);

    // checkExpiry should detect the expired override and clear it
    const wasExpired = roleManager.checkExpiry('BotA');
    expect(wasExpired).toBe(true);
    expect(assignment.manualOverride).toBe(false);

    // Auto-generation should be allowed again
    expect(missionManager.canAutoGenerate('BotA')).toBe(true);
  });

  /* ── 15. Mission dependency chain: start blocked until predecessor completes ── */
  it('15: mission dependency chain blocks start until predecessor completes', () => {
    const { missionManager } = platform;

    const mGather = missionManager.create({
      name: 'Gather materials',
      description: 'Collect wood',
      botName: 'BotA',
    });

    const mBuild = missionManager.create({
      name: 'Build structure',
      description: 'Build using gathered materials',
      botName: 'BotA',
      dependencies: [mGather.id],
    });

    // Cannot start build before gather is completed
    const started1 = missionManager.start(mBuild.id);
    expect(started1).toBeUndefined();
    expect(mBuild.error).toContain('not completed');

    // Complete the gather mission
    missionManager.start(mGather.id);
    missionManager.complete(mGather.id);
    expect(mGather.status).toBe('completed');

    // Now build can start
    mBuild.error = undefined;
    const started2 = missionManager.start(mBuild.id);
    expect(started2).toBeDefined();
    expect(started2!.status).toBe('running');
  });

  /* ── 16. Mission step advancement and auto-completion ── */
  it('16: advancing mission steps auto-completes the mission', () => {
    const { missionManager } = platform;

    const mission = missionManager.create({
      name: 'Multi-step',
      description: 'Three step mission',
      botName: 'BotA',
      steps: [
        { description: 'Step 1' },
        { description: 'Step 2' },
        { description: 'Step 3' },
      ],
    });

    missionManager.start(mission.id);
    expect(mission.steps[0].status).toBe('running');

    // Advance through all steps
    missionManager.advanceStep(mission.id);
    expect(mission.steps[0].status).toBe('completed');
    expect(mission.steps[1].status).toBe('running');
    expect(mission.currentStepIndex).toBe(1);

    missionManager.advanceStep(mission.id);
    expect(mission.steps[1].status).toBe('completed');
    expect(mission.steps[2].status).toBe('running');

    missionManager.advanceStep(mission.id);
    expect(mission.steps[2].status).toBe('completed');
    expect(mission.status).toBe('completed');
    expect(mission.completedAt).toBeDefined();
  });

  /* ── 17. Routine execution handles partial failures gracefully ── */
  it('17: routine handles partial failures and reports errors', async () => {
    const { routineManager, commandCenter } = platform;

    let stepIndex = 0;
    commandCenter.setDispatcher(async (_bot, cmd) => {
      stepIndex++;
      // Second step fails
      if (stepIndex === 2) {
        return { commandId: cmd.id, success: false, error: 'path blocked' };
      }
      return { commandId: cmd.id, success: true };
    });

    const routine = routineManager.create('fragile-patrol', 'May fail', [
      { commandType: 'move', payload: { target: { x: 0, y: 0, z: 0 } } },
      { commandType: 'move', payload: { target: { x: 50, y: 0, z: 50 } } },
      { commandType: 'guard', payload: { target: { x: 50, y: 0, z: 50 } } },
    ]);

    const exec = await routineManager.execute(routine.id, 'BotA');
    expect(exec.stepsCompleted).toBe(2); // step 1 and 3 succeed
    expect(exec.errors).toHaveLength(1);
    expect(exec.errors[0]).toContain('path blocked');
    expect(exec.completedAt).toBeDefined();
  });

  /* ── 18. MarkerStore spatial queries and zone containment ── */
  it('18: marker store spatial queries and zone containment checks', () => {
    const { markerStore } = platform;

    markerStore.createMarker('home', { x: 0, y: 64, z: 0 });
    markerStore.createMarker('mine', { x: 200, y: 30, z: 200 });

    const nearest = markerStore.findNearestMarker({ x: 5, y: 64, z: 5 });
    expect(nearest).toBeDefined();
    expect(nearest!.name).toBe('home');

    // Rectangular zone containment
    const farmZone = markerStore.createZone(
      'farm',
      'rectangular',
      { x: 50, y: 64, z: 50 },
      { x: 10, y: 5, z: 10 }
    );
    expect(markerStore.isInZone(farmZone.id, { x: 55, y: 64, z: 55 })).toBe(true);
    expect(markerStore.isInZone(farmZone.id, { x: 100, y: 64, z: 100 })).toBe(false);

    // Circular zone containment
    const guardZone = markerStore.createZone(
      'guard-tower',
      'circular',
      { x: 0, y: 64, z: 0 },
      { x: 20, y: 0, z: 0 } // radius = 20
    );
    expect(markerStore.isInZone(guardZone.id, { x: 10, y: 64, z: 10 })).toBe(true);
    expect(markerStore.isInZone(guardZone.id, { x: 30, y: 64, z: 0 })).toBe(false);
  });

  /* ── 19. Squad fan-out: dispatch to all members of a squad ── */
  it('19: fan-out command to all squad members', async () => {
    const { commandCenter, squadManager } = platform;

    const squad = squadManager.create('Defense', 'Guard squad');
    squadManager.addMember(squad.id, 'BotA');
    squadManager.addMember(squad.id, 'BotB');
    squadManager.addMember(squad.id, 'BotC');

    const received: string[] = [];
    commandCenter.setDispatcher(async (bot, cmd) => {
      received.push(bot);
      return { commandId: cmd.id, success: true };
    });

    // Fan out to squad members
    const members = squadManager.get(squad.id)!.members;
    const commands = await commandCenter.fanOut('guard', members, { target: { x: 0, y: 64, z: 0 } }, 'squad-commander');

    expect(commands).toHaveLength(3);
    expect(received.sort()).toEqual(['BotA', 'BotB', 'BotC']);
    expect(commands.every((c) => c.status === 'completed')).toBe(true);
  });

  /* ── 20. Template + role interaction: template instantiates with approval for assisted bots ── */
  it('20: template instantiation respects role-based approval requirements', () => {
    const { templateManager, missionManager, roleManager } = platform;

    roleManager.assign('BotA', 'builder', 'assisted');

    // Create a template that requires approval
    const template = templateManager.create(
      'wall-build',
      'Build a wall segment',
      [{ description: 'Gather stone' }, { description: 'Build wall' }],
      'normal',
      true, // requiresApproval
      1
    );

    // Instantiate
    const mission = templateManager.instantiate(template.id, 'BotA')!;
    expect(mission.requiresApproval).toBe(true);
    expect(mission.approved).toBe(false);

    // Cannot start without approval
    expect(missionManager.start(mission.id)).toBeUndefined();

    // Approve and start
    missionManager.approve(mission.id);
    mission.error = undefined;
    const started = missionManager.start(mission.id);
    expect(started).toBeDefined();
    expect(started!.status).toBe('running');
  });

  /* ── 21. Command cancellation ── */
  it('21: command cancellation prevents completion', async () => {
    const { commandCenter } = platform;

    // Dispatcher that takes a while
    commandCenter.setDispatcher(async (_bot, cmd) => {
      // Simulate delay — but we cancel before resolution check
      return { commandId: cmd.id, success: true };
    });

    const cmd = await commandCenter.dispatch('patrol', 'BotA', {}, 'user');
    // Command already completed synchronously, so cancel returns false
    expect(commandCenter.cancel(cmd.id)).toBe(false);

    // Create a pending command (no dispatcher)
    const cc2 = new CommandCenter();
    // Without dispatcher, command stays pending
    const cmd2 = await cc2.dispatch('move', 'BotA', {}, 'user');
    expect(cmd2.status).toBe('pending');
    expect(cc2.cancel(cmd2.id)).toBe(true);
    expect(cc2.get(cmd2.id)!.status).toBe('cancelled');
  });

  /* ── 22. Stale mission detection ── */
  it('22: stale mission detection identifies stuck missions', () => {
    const { missionManager } = platform;

    const m1 = missionManager.create({ name: 'Stuck', description: 'Stuck', botName: 'BotA' });
    missionManager.start(m1.id);

    // Manually backdate updatedAt to simulate staleness
    m1.updatedAt = Date.now() - 120_000; // 2 minutes ago

    const stale = missionManager.detectStale(60_000); // 1 minute threshold
    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe(m1.id);

    // Fresh mission should not be stale
    const m2 = missionManager.create({ name: 'Fresh', description: 'Fresh', botName: 'BotB' });
    missionManager.start(m2.id);
    const stale2 = missionManager.detectStale(60_000);
    expect(stale2).toHaveLength(1); // only m1
  });
});
