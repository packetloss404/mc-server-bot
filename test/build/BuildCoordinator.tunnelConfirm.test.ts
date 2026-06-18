/**
 * buildTunnel derives its corridor geometry from the LIVE record of what is
 * actually standing — the COMPLETED build jobs (each job's origin + the
 * footprint resolved from its schematic) — plus the TownManager for the hub
 * centre/name. Buildings are NOT sourced from the town registry (town.db only
 * tracks a couple of dimensionless point-landmarks). These tests pin:
 *
 *  1. Safety: carving must require confirm:true. Without confirm (and without
 *     dryRun) buildTunnel returns the plan with refused:true and touches no
 *     bot/world. dryRun returns the plan (no refused). confirm:true proceeds
 *     past the guard and tries to acquire a bot. A computeNetworkPlan try/catch
 *     guarantees an empty state degrades to an empty plan rather than throwing.
 *
 *  2. Dynamic route derivation: with seeded build jobs the plan's hub, floorY
 *     and one spoke-per-standing-build are computed from the resolved
 *     footprints, each riser landing one block OUTSIDE its footprint; stray and
 *     unresolvable builds are excluded; floorOffset is clamped.
 */
import { describe, it, expect, vi } from 'vitest';
import { BuildCoordinator } from '../../src/build/BuildCoordinator';

const HOLLYBROOK_TOWN = { id: 't1', name: 'Hollybrook', status: 'active', capital: { x: 1700, y: 63, z: 180 } };

// schematicFile → footprint size {x,y,z}. 'mystery.schem' is intentionally
// unresolvable (size lookup returns null) so it is excluded as an endpoint.
const SIZES: Record<string, { x: number; y: number; z: number }> = {
  'small medieval town hall.schem': { x: 52, y: 40, z: 54 },
  'victorian palace.schem': { x: 62, y: 70, z: 128 },
  'sam-cottage.schem': { x: 7, y: 5, z: 7 },
  'birch house.schem': { x: 24, y: 22, z: 27 },
  'md castle 2.schem': { x: 52, y: 40, z: 54 },
};

// Completed build jobs as they would appear in BuildCoordinator.jobs.
const JOBS = [
  { id: 'j1', schematicFile: 'small medieval town hall.schem', origin: { x: 1692, y: 66, z: 180 }, status: 'completed_with_errors', createdAt: 1 },
  { id: 'j2', schematicFile: 'victorian palace.schem', origin: { x: 1626, y: 64, z: 194 }, status: 'completed', createdAt: 2 },
  { id: 'j3', schematicFile: 'sam-cottage.schem', origin: { x: 1635, y: 64, z: 120 }, status: 'completed', createdAt: 3 },
  { id: 'j4', schematicFile: 'birch house.schem', origin: { x: 1712, y: 65, z: 188 }, status: 'completed', createdAt: 4 },
  // Stray/test build far from town → excluded by the NEAR_TOWN filter.
  { id: 'j5', schematicFile: 'md castle 2.schem', origin: { x: 829, y: 65, z: 241 }, status: 'completed', createdAt: 5 },
  // Unresolvable schematic (size lookup → null) → excluded.
  { id: 'j6', schematicFile: 'mystery.schem', origin: { x: 1705, y: 64, z: 200 }, status: 'completed', createdAt: 6 },
  // Not yet finished → excluded.
  { id: 'j7', schematicFile: 'birch house.schem', origin: { x: 1750, y: 64, z: 240 }, status: 'running', createdAt: 7 },
];

const aabbOf = (name: string) => {
  const job = JOBS.find((j) => j.schematicFile.replace(/\.schem$/i, '') === name)!;
  const s = SIZES[job.schematicFile];
  return { x1: job.origin.x, x2: job.origin.x + s.x - 1, z1: job.origin.z, z2: job.origin.z + s.z - 1 };
};

/** Bare mock — no town, no jobs → empty plan (original contract harness). */
function makeCoord() {
  const getAllWorkers = vi.fn().mockReturnValue([]);
  const botManager = {
    getAllWorkers,
    getWorker: vi.fn(),
    getTownManager: vi.fn().mockReturnValue({ onBuildCompleted: vi.fn() }),
  } as any;
  const coord = new BuildCoordinator(botManager, { emit: vi.fn() } as any, { push: vi.fn() } as any);
  // The constructor may load persisted jobs from disk; clear them so this is a
  // true "no standing builds" harness.
  (coord as any).jobs.clear();
  return { coord, getAllWorkers };
}

/** Populated mock — town for the hub centre, completed jobs for the buildings. */
function makeCoordWithBuilds() {
  const getAllWorkers = vi.fn().mockReturnValue([]);
  const townManager = {
    onBuildCompleted: vi.fn(),
    listTowns: vi.fn().mockReturnValue([HOLLYBROOK_TOWN]),
    getTown: vi.fn().mockReturnValue(HOLLYBROOK_TOWN),
  };
  const botManager = {
    getAllWorkers,
    getWorker: vi.fn(),
    getTownManager: vi.fn().mockReturnValue(townManager),
  } as any;
  const coord = new BuildCoordinator(botManager, { emit: vi.fn() } as any, { push: vi.fn() } as any);
  // Seed completed build jobs (the data source) + stub schematic size lookup.
  const jobsMap: Map<string, any> = (coord as any).jobs;
  jobsMap.clear(); // drop any jobs the constructor loaded from disk
  for (const j of JOBS) jobsMap.set(j.id, j);
  (coord as any).getSchematicInfoAsync = vi.fn(async (file: string) =>
    SIZES[file] ? { filename: file, size: SIZES[file] } : null);
  return { coord, getAllWorkers, townManager };
}

describe('BuildCoordinator.buildTunnel — confirm gate', () => {
  it('refuses to carve without confirm and never acquires a bot', async () => {
    const { coord, getAllWorkers } = makeCoord();
    const result = await coord.buildTunnel({});
    expect(result.executed).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.plan).toBeTruthy();
    expect(getAllWorkers).not.toHaveBeenCalled();
  });

  it('dryRun returns the plan without carving (and without refused)', async () => {
    const { coord, getAllWorkers } = makeCoord();
    const result = await coord.buildTunnel({ dryRun: true });
    expect(result.executed).toBe(false);
    expect(result.refused).toBeUndefined();
    expect(result.plan).toBeTruthy();
    expect(getAllWorkers).not.toHaveBeenCalled();
  });

  it('with confirm:true it proceeds past the guard (then fails cleanly with no connected bot)', async () => {
    // Populated builds so the network resolves; no connected bot → throws after
    // the guard, proving it got past the confirm gate and tried to acquire one.
    const { coord, getAllWorkers } = makeCoordWithBuilds();
    await expect(coord.buildTunnel({ confirm: true })).rejects.toThrow(/connected bot/i);
    expect(getAllWorkers).toHaveBeenCalled();
  });
});

describe('BuildCoordinator.buildTunnel — dynamic route derivation', () => {
  it('computes the hub at the capital XZ and floorY below the lowest building floor', async () => {
    const { coord } = makeCoordWithBuilds();
    const result = await coord.buildTunnel({ dryRun: true });
    expect(result.executed).toBe(false);
    expect(result.refused).toBeUndefined();
    // Capital 1700,63,180 → hub XZ; FLOOR = min(63, floors 66/64/64/65) - 12 = 51.
    expect(result.plan.hub).toEqual({ x: 1700, y: 51, z: 180 });
    expect(result.plan.floorY).toBe(51);
    expect(result.plan.town).toEqual({ id: 't1', name: 'Hollybrook' });
  });

  it('produces a spoke per standing build near town, excluding stray + unresolvable + unfinished', async () => {
    const { coord } = makeCoordWithBuilds();
    const result = await coord.buildTunnel({ dryRun: true });
    const names = result.plan.spokes.map((s: any) => s.building);
    const skippedNames = (result.plan.skipped || []).map((s: any) => s.building);
    const reached = new Set([...names, ...skippedNames]);
    for (const n of ['small medieval town hall', 'victorian palace', 'sam-cottage', 'birch house']) {
      expect(reached.has(n)).toBe(true);
    }
    // Far stray (NEAR_TOWN filter) and unresolvable schematic are never endpoints.
    expect(reached.has('md castle 2')).toBe(false);
    expect(reached.has('mystery')).toBe(false);
    expect(Array.isArray(result.plan.skipped)).toBe(true);
  });

  it('skips a riser that would land inside another building footprint (birch ⊂ town hall)', async () => {
    const { coord } = makeCoordWithBuilds();
    const result = await coord.buildTunnel({ dryRun: true });
    // birch house (x1712-1735 z188-214) is entirely inside the town hall
    // footprint (x1692-1743 z180-233) → its riser is unusable → skipped.
    const birchSkip = (result.plan.skipped || []).find((s: any) => s.building === 'birch house');
    expect(birchSkip).toBeTruthy();
    expect(birchSkip.reason).toMatch(/inside another building/i);
    expect(result.plan.spokes.some((s: any) => s.building === 'birch house')).toBe(false);
  });

  it('every routed spoke riser/entry sits one block OUTSIDE its building footprint, with a doorway one block inward', async () => {
    const { coord } = makeCoordWithBuilds();
    const result = await coord.buildTunnel({ dryRun: true });
    expect(result.plan.spokes.length).toBeGreaterThan(0);
    for (const sp of result.plan.spokes) {
      const bb = aabbOf(sp.building);
      const insideX = sp.entry.x >= bb.x1 && sp.entry.x <= bb.x2;
      const insideZ = sp.entry.z >= bb.z1 && sp.entry.z <= bb.z2;
      expect(insideX && insideZ).toBe(false);
      const outsideByOne =
        sp.entry.x === bb.x1 - 1 || sp.entry.x === bb.x2 + 1 ||
        sp.entry.z === bb.z1 - 1 || sp.entry.z === bb.z2 + 1;
      expect(outsideByOne).toBe(true);
      // The doorway is the building edge wall: one block inward from the riser.
      const dInsideX = sp.doorway.x >= bb.x1 && sp.doorway.x <= bb.x2;
      const dInsideZ = sp.doorway.z >= bb.z1 && sp.doorway.z <= bb.z2;
      expect(dInsideX && dInsideZ).toBe(true);
    }
  });

  it('clamps floorOffset to a safe minimum (>=6) so the corridor stays below building floors', async () => {
    const { coord } = makeCoordWithBuilds();
    // floorOffset 2 is below the clamp; effective offset = 6 → FLOOR = 63 - 6 = 57.
    const result = await coord.buildTunnel({ dryRun: true, floorOffset: 2 });
    expect(result.plan.floorY).toBe(57);
  });

  it('no builds: a bare mock yields an empty plan and still refuses without confirm', async () => {
    const { coord, getAllWorkers } = makeCoord();
    const dry = await coord.buildTunnel({ dryRun: true });
    expect(dry.plan.hub).toBeNull();
    expect(dry.plan.spokes).toEqual([]);
    expect(getAllWorkers).not.toHaveBeenCalled();

    const refused = await coord.buildTunnel({});
    expect(refused.refused).toBe(true);
    expect(refused.executed).toBe(false);
    expect(getAllWorkers).not.toHaveBeenCalled();
  });

  it('plan.skipped is an array of {building, reason} (drops surfaced, not carved)', async () => {
    const { coord } = makeCoordWithBuilds();
    const result = await coord.buildTunnel({ dryRun: true });
    expect(Array.isArray(result.plan.skipped)).toBe(true);
    for (const s of result.plan.skipped) {
      expect(typeof s.building).toBe('string');
      expect(typeof s.reason).toBe('string');
    }
  });
});
