import { describe, it, expect, beforeEach } from 'vitest';
import { MarkerStore } from '../../src/control/MarkerStore';

describe('MarkerStore', () => {
  let store: MarkerStore;

  beforeEach(() => {
    store = new MarkerStore();
  });

  it('creates a marker with valid fields', () => {
    const marker = store.createMarker('Home Base', 100, 64, -200, 'base');

    expect(marker).toBeDefined();
    expect(marker.id).toMatch(/^marker-/);
    expect(marker.label).toBe('Home Base');
    expect(marker.x).toBe(100);
    expect(marker.y).toBe(64);
    expect(marker.z).toBe(-200);
    expect(marker.type).toBe('base');
    expect(marker.createdAt).toBeTypeOf('number');
    expect(marker.updatedAt).toBeTypeOf('number');
  });

  it('updates a marker', () => {
    const marker = store.createMarker('Old Name', 0, 0, 0);
    const updated = store.updateMarker(marker.id, { label: 'New Name', x: 50 });

    expect(updated.label).toBe('New Name');
    expect(updated.x).toBe(50);
    expect(updated.y).toBe(0); // unchanged
    expect(updated.updatedAt).toBeGreaterThanOrEqual(marker.createdAt);

    // Verify persistence via getMarker
    const fetched = store.getMarker(marker.id);
    expect(fetched!.label).toBe('New Name');
  });

  it('deletes a marker', () => {
    const marker = store.createMarker('Temp', 10, 20, 30);
    expect(store.getAllMarkers()).toHaveLength(1);

    const deleted = store.deleteMarker(marker.id);
    expect(deleted).toBe(true);
    expect(store.getMarker(marker.id)).toBeUndefined();
    expect(store.getAllMarkers()).toHaveLength(0);

    // Deleting nonexistent returns false
    expect(store.deleteMarker('nonexistent')).toBe(false);
  });

  it('creates and retrieves zones', () => {
    const zone = store.createZone('Mining Area', 0, 0, 0, 100, 64, 100, 'mine');

    expect(zone).toBeDefined();
    expect(zone.id).toMatch(/^zone-/);
    expect(zone.label).toBe('Mining Area');
    expect(zone.x1).toBe(0);
    expect(zone.y2).toBe(64);
    expect(zone.type).toBe('mine');

    const fetched = store.getZone(zone.id);
    expect(fetched).toEqual(zone);

    const all = store.getAllZones();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(zone.id);
  });
});
