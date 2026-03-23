import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before importing the module
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { RoleManager } from '../../src/control/RoleManager';

function createMockIO() {
  return { emit: vi.fn() } as any;
}

describe('RoleManager', () => {
  let rm: RoleManager;
  let io: ReturnType<typeof createMockIO>;

  beforeEach(() => {
    vi.clearAllMocks();
    io = createMockIO();
    rm = new RoleManager(io);
  });

  // ── Create assignment ─────────────────────────────────

  it('creates a role assignment with valid fields', () => {
    const assignment = rm.createAssignment({
      botName: 'Miner1',
      role: 'miner',
      autonomyLevel: 'autonomous',
    });

    expect(assignment).toBeDefined();
    expect(assignment.id).toMatch(/^role_/);
    expect(assignment.botName).toBe('Miner1');
    expect(assignment.role).toBe('miner');
    expect(assignment.autonomyLevel).toBe('autonomous');
    expect(assignment.allowedZoneIds).toEqual([]);
    expect(assignment.preferredMissionTypes).toEqual([]);
  });

  it('throws on invalid role', () => {
    expect(() =>
      rm.createAssignment({
        botName: 'Bot1',
        role: 'invalid' as any,
        autonomyLevel: 'manual',
      }),
    ).toThrow('Invalid role: invalid');
  });

  it('throws on invalid autonomy level', () => {
    expect(() =>
      rm.createAssignment({
        botName: 'Bot1',
        role: 'guard',
        autonomyLevel: 'turbo' as any,
      }),
    ).toThrow('Invalid autonomy level: turbo');
  });

  // ── One-role-per-bot replacement ──────────────────────

  it('replaces existing assignment when assigning a new role to the same bot', () => {
    const first = rm.createAssignment({
      botName: 'Worker',
      role: 'farmer',
      autonomyLevel: 'assisted',
    });

    const second = rm.createAssignment({
      botName: 'Worker',
      role: 'builder',
      autonomyLevel: 'autonomous',
    });

    // Only one assignment for the bot
    const all = rm.getAssignments();
    const workerAssignments = all.filter((a) => a.botName === 'Worker');
    expect(workerAssignments).toHaveLength(1);
    expect(workerAssignments[0].role).toBe('builder');
    expect(workerAssignments[0].id).toBe(second.id);

    // Old assignment should not be retrievable
    expect(rm.getAssignment(first.id)).toBeNull();
  });

  // ── Update assignment ─────────────────────────────────

  it('updates an assignment', () => {
    const assignment = rm.createAssignment({
      botName: 'Guard1',
      role: 'guard',
      autonomyLevel: 'manual',
    });

    const updated = rm.updateAssignment(assignment.id, {
      autonomyLevel: 'assisted',
      allowedZoneIds: ['zone1', 'zone2'],
    });

    expect(updated).toBeDefined();
    expect(updated!.autonomyLevel).toBe('assisted');
    expect(updated!.allowedZoneIds).toEqual(['zone1', 'zone2']);
    // Unchanged fields preserved
    expect(updated!.role).toBe('guard');
    expect(updated!.botName).toBe('Guard1');
  });

  it('returns null when updating a nonexistent assignment', () => {
    const result = rm.updateAssignment('nonexistent', { role: 'miner' });
    expect(result).toBeNull();
  });

  it('throws when updating with invalid role', () => {
    const assignment = rm.createAssignment({
      botName: 'Bot1',
      role: 'scout',
      autonomyLevel: 'manual',
    });
    expect(() => rm.updateAssignment(assignment.id, { role: 'pirate' as any })).toThrow(
      'Invalid role: pirate',
    );
  });

  // ── Delete assignment ─────────────────────────────────

  it('deletes an assignment', () => {
    const assignment = rm.createAssignment({
      botName: 'Temp',
      role: 'free-agent',
      autonomyLevel: 'autonomous',
    });

    expect(rm.deleteAssignment(assignment.id)).toBe(true);
    expect(rm.getAssignment(assignment.id)).toBeNull();
    expect(rm.getAssignments()).toHaveLength(0);
  });

  it('returns false when deleting a nonexistent assignment', () => {
    expect(rm.deleteAssignment('nonexistent')).toBe(false);
  });

  // ── getAssignmentForBot ───────────────────────────────

  it('retrieves assignment for a specific bot', () => {
    rm.createAssignment({ botName: 'Alpha', role: 'miner', autonomyLevel: 'autonomous' });
    rm.createAssignment({ botName: 'Bravo', role: 'guard', autonomyLevel: 'manual' });

    const alphaRole = rm.getAssignmentForBot('Alpha');
    expect(alphaRole).toBeDefined();
    expect(alphaRole!.role).toBe('miner');

    const unknownRole = rm.getAssignmentForBot('Charlie');
    expect(unknownRole).toBeNull();
  });

  // ── Override tracking ─────────────────────────────────

  it('sets and retrieves an override', () => {
    rm.setOverride('Bot1', 'emergency recall', 'cmd_123');

    expect(rm.isOverridden('Bot1')).toBe(true);
    const override = rm.getOverride('Bot1');
    expect(override).toBeDefined();
    expect(override!.reason).toBe('emergency recall');
    expect(override!.commandId).toBe('cmd_123');
    expect(override!.at).toBeTypeOf('number');
  });

  it('clears an override', () => {
    rm.setOverride('Bot1', 'test', 'cmd_1');
    expect(rm.isOverridden('Bot1')).toBe(true);

    rm.clearOverride('Bot1');
    expect(rm.isOverridden('Bot1')).toBe(false);
    expect(rm.getOverride('Bot1')).toBeNull();
  });

  it('clearing a nonexistent override is a no-op', () => {
    // Should not throw or emit
    rm.clearOverride('NoSuchBot');
    expect(io.emit).not.toHaveBeenCalled();
  });

  it('getOverrides returns all active overrides', () => {
    rm.setOverride('A', 'reason1', 'cmd_1');
    rm.setOverride('B', 'reason2', 'cmd_2');

    const overrides = rm.getOverrides();
    expect(Object.keys(overrides)).toHaveLength(2);
    expect(overrides['A'].reason).toBe('reason1');
    expect(overrides['B'].reason).toBe('reason2');
  });

  // ── Override expiry ───────────────────────────────────

  it('expires overrides older than 5 minutes', () => {
    rm.setOverride('Bot1', 'old override', 'cmd_old');

    // Manually backdate the override
    const override = rm.getOverride('Bot1')!;
    override.at = Date.now() - 6 * 60 * 1000; // 6 minutes ago

    rm.checkOverrideTimeouts();

    expect(rm.isOverridden('Bot1')).toBe(false);
  });

  it('does not expire overrides under 5 minutes', () => {
    rm.setOverride('Bot1', 'recent override', 'cmd_new');

    rm.checkOverrideTimeouts();

    expect(rm.isOverridden('Bot1')).toBe(true);
  });

  // ── Socket events ─────────────────────────────────────

  it('emits role:updated on assignment creation', () => {
    rm.createAssignment({
      botName: 'Bot1',
      role: 'miner',
      autonomyLevel: 'autonomous',
    });

    const events = io.emit.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('role:updated');
  });

  it('emits role:updated on override set and clear', () => {
    rm.setOverride('Bot1', 'test', 'cmd_1');
    rm.clearOverride('Bot1');

    const events = io.emit.mock.calls.map((c: any[]) => c[0]);
    const roleUpdatedCount = events.filter((e) => e === 'role:updated').length;
    expect(roleUpdatedCount).toBe(2);
  });
});
