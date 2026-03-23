import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before importing the module
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { MarkerStore } from '../../src/control/MarkerStore';

function createMockIO() {
  return { emit: vi.fn() } as any;
}

describe('MarkerStore', () => {
  let store: MarkerStore;
  let io: ReturnType<typeof createMockIO>;

  beforeEach(() => {
    vi.clearAllMocks();
    io = createMockIO();
    store = new MarkerStore(io);
  });

  it('creates a marker with valid fields', () => {
    const marker = store.createMarker({
      name: 'Home Base',
      kind: 'base',
      position: { x: 100, y: 64, z: -200 },
    });

    expect(marker).toBeDefined();
    expect(marker.id).toMatch(/^mkr_/);
    expect(marker.name).toBe('Home Base');
    expect(marker.position.x).toBe(100);
    expect(marker.position.y).toBe(64);
    expect(marker.position.z).toBe(-200);
    expect(marker.kind).toBe('base');
    expect(marker.createdAt).toBeTypeOf('number');
    expect(marker.updatedAt).toBeTypeOf('number');
  });

  it('updates a marker', () => {
    const marker = store.createMarker({
      name: 'Old Name',
      kind: 'custom',
      position: { x: 0, y: 0, z: 0 },
    });
    const updated = store.updateMarker(marker.id, { name: 'New Name', position: { x: 50, y: 0, z: 0 } });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe('New Name');
    expect(updated!.position.x).toBe(50);
    expect(updated!.position.y).toBe(0); // unchanged
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(marker.createdAt);

    // Verify persistence via getMarker
    const fetched = store.getMarker(marker.id);
    expect(fetched!.name).toBe('New Name');
  });

  it('deletes a marker', () => {
    const marker = store.createMarker({
      name: 'Temp',
      kind: 'custom',
      position: { x: 10, y: 20, z: 30 },
    });
    expect(store.getMarkers()).toHaveLength(1);

    const deleted = store.deleteMarker(marker.id);
    expect(deleted).toBe(true);
    expect(store.getMarker(marker.id)).toBeUndefined();
    expect(store.getMarkers()).toHaveLength(0);

    // Deleting nonexistent returns false
    expect(store.deleteMarker('nonexistent')).toBe(false);
  });

  it('creates and retrieves zones', () => {
    const zone = store.createZone({
      name: 'Mining Area',
      mode: 'mine' as any,
      shape: 'rectangle',
      rectangle: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 },
    });

    expect(zone).toBeDefined();
    expect(zone.id).toMatch(/^zne_/);
    expect(zone.name).toBe('Mining Area');
    expect(zone.shape).toBe('rectangle');

    const fetched = store.getZone(zone.id);
    expect(fetched).toEqual(zone);

    const all = store.getZones();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(zone.id);
  });

  it('creates and retrieves routes', () => {
    const route = store.createRoute({
      name: 'Patrol Path',
      waypointIds: ['mkr_a', 'mkr_b', 'mkr_c'],
      loop: true,
    });

    expect(route).toBeDefined();
    expect(route.id).toMatch(/^rte_/);
    expect(route.name).toBe('Patrol Path');
    expect(route.waypointIds).toEqual(['mkr_a', 'mkr_b', 'mkr_c']);
    expect(route.loop).toBe(true);

    const fetched = store.getRoute(route.id);
    expect(fetched).toEqual(route);

    const allRoutes = store.getRoutes();
    expect(allRoutes).toHaveLength(1);
  });

  it('updates and deletes zones', () => {
    const zone = store.createZone({
      name: 'Old Zone',
      mode: 'farm',
      shape: 'circle',
      circle: { x: 0, z: 0, radius: 50 },
    });

    const updated = store.updateZone(zone.id, { name: 'New Zone' });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('New Zone');

    expect(store.deleteZone(zone.id)).toBe(true);
    expect(store.getZones()).toHaveLength(0);
    expect(store.deleteZone('nonexistent')).toBe(false);
  });

  it('updates and deletes routes', () => {
    const route = store.createRoute({
      name: 'Old Route',
      waypointIds: ['a'],
      loop: false,
    });

    const updated = store.updateRoute(route.id, { name: 'New Route', loop: true });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('New Route');
    expect(updated!.loop).toBe(true);

    expect(store.deleteRoute(route.id)).toBe(true);
    expect(store.getRoutes()).toHaveLength(0);
    expect(store.deleteRoute('nonexistent')).toBe(false);
  });

  // ── Spatial helpers ─────────────────────────────────────

  it('findNearestMarker returns the closest marker', () => {
    store.createMarker({ name: 'Far', kind: 'base', position: { x: 1000, y: 64, z: 1000 } });
    store.createMarker({ name: 'Near', kind: 'base', position: { x: 5, y: 64, z: 5 } });
    store.createMarker({ name: 'Medium', kind: 'custom', position: { x: 50, y: 64, z: 50 } });

    const nearest = store.findNearestMarker({ x: 0, y: 64, z: 0 });
    expect(nearest).toBeDefined();
    expect(nearest!.name).toBe('Near');
  });

  it('findNearestMarker filters by kind', () => {
    store.createMarker({ name: 'Near Custom', kind: 'custom', position: { x: 1, y: 1, z: 1 } });
    store.createMarker({ name: 'Far Base', kind: 'base', position: { x: 100, y: 64, z: 100 } });

    const nearestBase = store.findNearestMarker({ x: 0, y: 0, z: 0 }, 'base');
    expect(nearestBase).toBeDefined();
    expect(nearestBase!.name).toBe('Far Base');
  });

  it('findNearestMarker returns undefined when no markers exist', () => {
    const result = store.findNearestMarker({ x: 0, y: 0, z: 0 });
    expect(result).toBeUndefined();
  });

  it('isInsideZone checks rectangle containment', () => {
    const zone = store.createZone({
      name: 'Rect Zone',
      mode: 'build',
      shape: 'rectangle',
      rectangle: { minX: -50, minZ: -50, maxX: 50, maxZ: 50 },
    });

    expect(store.isInsideZone(0, 0, zone.id)).toBe(true);
    expect(store.isInsideZone(50, 50, zone.id)).toBe(true);
    expect(store.isInsideZone(51, 0, zone.id)).toBe(false);
    expect(store.isInsideZone(0, -51, zone.id)).toBe(false);
  });

  it('isInsideZone checks circle containment', () => {
    const zone = store.createZone({
      name: 'Circle Zone',
      mode: 'guard',
      shape: 'circle',
      circle: { x: 0, z: 0, radius: 10 },
    });

    expect(store.isInsideZone(0, 0, zone.id)).toBe(true);
    expect(store.isInsideZone(7, 7, zone.id)).toBe(true);
    expect(store.isInsideZone(8, 8, zone.id)).toBe(false);
  });

  it('isInsideZone returns false for nonexistent zone', () => {
    expect(store.isInsideZone(0, 0, 'nonexistent')).toBe(false);
  });
});
