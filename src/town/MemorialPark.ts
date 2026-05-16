/**
 * MemorialPark — Phase 5-A.
 *
 * Physical structure on the world map. Each Phoenix-recorded disaster gets a
 * column-plus-plaque marker arrangement at a deterministic offset within the
 * park, computed from the disaster's id so a process restart never duplicates
 * a placement.
 *
 * The park lives at `capital + (+12, 0, +12)` by default (north-east of the
 * town hall — far enough not to collide with the founding district plan, close
 * enough to walk). Markers are stored in the existing `MarkerStore` so the
 * dashboard map renders them for free; we use marker kind 'custom' (the only
 * available freeform kind today) and tag with `'memorial'` + the disaster
 * kind so filters work on the frontend.
 *
 * "Programmatic placement" is the implementation choice:
 *   - The park is a square grid of 8x8 monument slots (64 max).
 *   - Each disaster maps to (slotX, slotZ) by a stable hash of its id.
 *   - Collisions (two disasters claim the same slot) are resolved by linear
 *     probing — try slot+1, slot+2, etc. until an empty slot is found.
 *   - When the grid is full we fall back to extending in +z direction so
 *     long-running towns still get a marker per disaster (graceful overflow).
 *
 * BuildCoordinator integration is intentionally NOT wired in this module —
 * the spec calls out that "BuildCoordinator can hand to bots" the produced
 * coordinates. The marker position IS the coordinate; future phases can read
 * `getMonumentsForTown(townId)` and queue actual block-placement tasks.
 */
import crypto from 'crypto';
import { logger } from '../util/logger';
import type { TownManager } from './TownManager';
import type { MarkerStore } from '../control/MarkerStore';
import type { Disaster } from './DisasterRecorder';
import type { MarkerRecord } from '../control/WorldTypes';

/** Default offset of the park from the town capital. */
export const DEFAULT_PARK_OFFSET = { dx: 12, dy: 0, dz: 12 } as const;

/** Park grid is 8x8 of monument slots, 2 blocks apart. */
const GRID_DIM = 8;
const SLOT_SPACING = 2;

export interface MemorialPark_Bounds {
  /** SW corner (lowest x, z) of the park footprint. */
  minX: number;
  minZ: number;
  /** NE corner (highest x, z) of the park footprint. */
  maxX: number;
  maxZ: number;
  /** Base Y plane the markers sit at (typically capital.y). */
  y: number;
}

export interface MemorialMonument {
  markerId: string;
  disasterId: string;
  position: { x: number; y: number; z: number };
}

export class MemorialPark {
  private readonly townManager: TownManager;
  private markerStore: MarkerStore | null;

  /**
   * Per-town in-memory cache of disaster-id → markerId. Avoids re-querying
   * the markers list on every placement. Survives until process restart;
   * persisted state lives in MarkerStore + disasters.memorialMarkerId.
   */
  private readonly placements: Map<string, Map<string, string>> = new Map();

  constructor(townManager: TownManager, markerStore: MarkerStore | null = null) {
    this.townManager = townManager;
    this.markerStore = markerStore;
  }

  /** Wired post-hoc by the API layer once the MarkerStore exists. */
  setMarkerStore(store: MarkerStore | null): void {
    this.markerStore = store;
    // Rebuild placement cache from MarkerStore when wiring late so we don't
    // re-place over an existing monument.
    if (store) this.rebuildCacheFromStore();
  }

  /** Compute the park bounds for a town. Returns null when the town has no capital. */
  getBounds(townId: string): MemorialPark_Bounds | null {
    const town = this.townManager.getTown(townId);
    if (!town || !town.capital) return null;
    const cx = town.capital.x + DEFAULT_PARK_OFFSET.dx;
    const cz = town.capital.z + DEFAULT_PARK_OFFSET.dz;
    const half = (GRID_DIM * SLOT_SPACING) / 2;
    return {
      minX: cx - half,
      maxX: cx + half,
      minZ: cz - half,
      maxZ: cz + half,
      y: town.capital.y + DEFAULT_PARK_OFFSET.dy,
    };
  }

  /**
   * Add a monument for the given disaster. Returns the MarkerRecord on
   * success, or null when the town/markerStore/capital is missing.
   *
   * Deterministic: re-calling with the same disaster id returns the existing
   * marker (re-fetched from the store) so a Phoenix retry never creates a
   * second monument.
   */
  addMonument(townId: string, disaster: Disaster): MarkerRecord | null {
    if (!this.markerStore) {
      logger.debug({ townId, disasterId: disaster.id }, 'MemorialPark.addMonument: markerStore not wired yet');
      return null;
    }
    const bounds = this.getBounds(townId);
    if (!bounds) {
      logger.debug({ townId, disasterId: disaster.id }, 'MemorialPark.addMonument: town has no capital');
      return null;
    }

    // Idempotent: if we've already placed this disaster, return the existing
    // marker. We check both in-memory cache and the disaster row itself
    // (which has memorialMarkerId once the recorder wires the two together).
    const cache = this.placements.get(townId) ?? new Map<string, string>();
    const knownMarkerId = cache.get(disaster.id) ?? disaster.memorialMarkerId ?? null;
    if (knownMarkerId) {
      const existing = this.markerStore.getMarker(knownMarkerId);
      if (existing) return existing;
      // Marker was deleted out from under us — fall through to re-place.
    }

    const occupiedSlots = this.collectOccupiedSlots(townId, bounds);
    const slot = this.pickSlot(disaster.id, bounds, occupiedSlots);

    const town = this.townManager.getTown(townId);
    const townName = town?.name ?? townId;
    const marker = this.markerStore.createMarker({
      name: `${townName} Memorial — ${disaster.kind}`,
      kind: 'custom',
      position: slot,
      tags: ['memorial', townId, `disaster:${disaster.kind}`, disaster.id],
      notes: disaster.summary ?? `${disaster.kind} disaster`,
    });

    cache.set(disaster.id, marker.id);
    this.placements.set(townId, cache);
    logger.info(
      { townId, disasterId: disaster.id, markerId: marker.id, position: marker.position },
      'MemorialPark: monument placed',
    );
    return marker;
  }

  /** All monument markers for the town. Reads from MarkerStore on demand. */
  getMonumentsForTown(townId: string): MarkerRecord[] {
    if (!this.markerStore) return [];
    const bounds = this.getBounds(townId);
    if (!bounds) return [];
    return this.markerStore.getMarkers().filter((m) => this.markerBelongsToTown(m, townId, bounds));
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Internals
  // ──────────────────────────────────────────────────────────────────────

  private rebuildCacheFromStore(): void {
    if (!this.markerStore) return;
    const markers = this.markerStore.getMarkers();
    for (const m of markers) {
      if (!m.tags?.includes('memorial')) continue;
      // Tag scheme: ['memorial', <townId>, 'disaster:<kind>', <disasterId>].
      // Disaster id always starts with 'dst_'; pluck it.
      const disasterTag = m.tags.find((t) => t.startsWith('dst_') || t.startsWith('disaster_'));
      const townTag = m.tags.find((t) => t.startsWith('town_'));
      if (!disasterTag || !townTag) continue;
      const cache = this.placements.get(townTag) ?? new Map<string, string>();
      cache.set(disasterTag, m.id);
      this.placements.set(townTag, cache);
    }
  }

  private collectOccupiedSlots(townId: string, bounds: MemorialPark_Bounds): Set<string> {
    const taken = new Set<string>();
    if (!this.markerStore) return taken;
    for (const m of this.markerStore.getMarkers()) {
      if (!this.markerBelongsToTown(m, townId, bounds)) continue;
      taken.add(this.slotKey(m.position.x, m.position.z));
    }
    return taken;
  }

  private markerBelongsToTown(
    m: MarkerRecord,
    townId: string,
    bounds: MemorialPark_Bounds,
  ): boolean {
    if (!m.tags?.includes('memorial')) return false;
    // Prefer explicit tag match for towns; fall back to spatial bounds when
    // the tag is missing (legacy marker).
    if (m.tags.includes(townId)) return true;
    return (
      m.position.x >= bounds.minX &&
      m.position.x <= bounds.maxX &&
      m.position.z >= bounds.minZ &&
      m.position.z <= bounds.maxZ
    );
  }

  /**
   * Map a disaster id deterministically into a free grid slot. Uses sha-1 of
   * the disaster id (so a process restart with the same row reproduces the
   * placement) then linear-probes for collisions.
   */
  private pickSlot(
    disasterId: string,
    bounds: MemorialPark_Bounds,
    occupied: Set<string>,
  ): { x: number; y: number; z: number } {
    const hash = crypto.createHash('sha1').update(disasterId).digest();
    const seedX = hash.readUInt16LE(0) % GRID_DIM;
    const seedZ = hash.readUInt16LE(2) % GRID_DIM;
    for (let probe = 0; probe < GRID_DIM * GRID_DIM; probe++) {
      const idx = (seedX * GRID_DIM + seedZ + probe) % (GRID_DIM * GRID_DIM);
      const gx = Math.floor(idx / GRID_DIM);
      const gz = idx % GRID_DIM;
      const x = bounds.minX + gx * SLOT_SPACING;
      const z = bounds.minZ + gz * SLOT_SPACING;
      const key = this.slotKey(x, z);
      if (!occupied.has(key)) {
        return { x, y: bounds.y, z };
      }
    }
    // Grid full — overflow north along +z so each disaster still gets a
    // unique position. Indexed by the disaster id hash so the overflow row
    // is itself deterministic.
    const overflow = hash.readUInt32LE(4);
    return {
      x: bounds.minX + (overflow % GRID_DIM) * SLOT_SPACING,
      y: bounds.y,
      z: bounds.maxZ + SLOT_SPACING + ((overflow >> 8) & 0xff) * SLOT_SPACING,
    };
  }

  private slotKey(x: number, z: number): string {
    return `${x}|${z}`;
  }
}
