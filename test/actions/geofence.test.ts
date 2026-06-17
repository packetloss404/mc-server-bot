/**
 * Geofence tests — Batch-2 hardening (repo review #5b).
 *
 * Focus on intersectsProtectedZone, the AABB-overlap helper used by the build
 * engine's clearSite to refuse `/fill ... air destroy` over a protected build
 * (op /fill bypasses the per-block bot.dig geofence). Also covers isProtected
 * to lock in the existing point-containment behaviour.
 *
 * loadConfig is mocked so we can inject `mining.protectedZones` without a real
 * config.yml; _resetGeofenceCache() clears the module cache between cases.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const protectedZones = [
  { name: 'town-hall', minX: 100, minY: 60, minZ: 100, maxX: 120, maxY: 80, maxZ: 120 },
];

vi.mock('../../src/config', () => ({
  loadConfig: () => ({ mining: { protectedZones } }),
}));

import { isProtected, intersectsProtectedZone, _resetGeofenceCache } from '../../src/actions/geofence';

describe('geofence', () => {
  beforeEach(() => {
    _resetGeofenceCache();
  });

  describe('isProtected (point containment)', () => {
    it('flags a point inside the zone', () => {
      expect(isProtected(110, 70, 110)).toBe(true);
    });
    it('treats zone bounds as inclusive', () => {
      expect(isProtected(100, 60, 100)).toBe(true);
      expect(isProtected(120, 80, 120)).toBe(true);
    });
    it('clears a point outside the zone', () => {
      expect(isProtected(99, 70, 110)).toBe(false);
      expect(isProtected(110, 81, 110)).toBe(false);
    });
  });

  describe('intersectsProtectedZone (box overlap)', () => {
    it('returns the zone when a box overlaps it', () => {
      const hit = intersectsProtectedZone({ x: 115, y: 70, z: 115 }, { x: 130, y: 75, z: 130 });
      expect(hit?.name).toBe('town-hall');
    });

    it('returns the zone when the box fully encloses the zone', () => {
      const hit = intersectsProtectedZone({ x: 0, y: 0, z: 0 }, { x: 200, y: 200, z: 200 });
      expect(hit?.name).toBe('town-hall');
    });

    it('detects overlap touching a single edge (inclusive bounds)', () => {
      const hit = intersectsProtectedZone({ x: 120, y: 80, z: 120 }, { x: 121, y: 81, z: 121 });
      expect(hit?.name).toBe('town-hall');
    });

    it('returns null when the box is clear (separated in X)', () => {
      expect(intersectsProtectedZone({ x: 121, y: 70, z: 110 }, { x: 130, y: 75, z: 120 })).toBeNull();
    });

    it('returns null when the box is clear (separated in Y, e.g. a higher clearance slab)', () => {
      expect(intersectsProtectedZone({ x: 110, y: 81, z: 110 }, { x: 115, y: 90, z: 115 })).toBeNull();
    });

    it('normalizes min/max so swapped corners still detect overlap', () => {
      const hit = intersectsProtectedZone({ x: 130, y: 75, z: 130 }, { x: 115, y: 70, z: 115 });
      expect(hit?.name).toBe('town-hall');
    });
  });
});
