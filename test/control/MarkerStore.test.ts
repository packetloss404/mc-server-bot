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
});
