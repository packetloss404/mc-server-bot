import { Server as SocketIOServer } from 'socket.io';
import { MarkerRecord, ZoneRecord, RouteRecord } from './WorldTypes';
import { WORLD_EVENTS } from './FleetTypes';
import { logger } from '../util/logger';
import { atomicWriteJsonSync, atomicWriteJson } from '../util/atomicWrite';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const DEBOUNCE_MS = 1_000;

function loadJson<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    logger.warn({ err, filePath }, 'Failed to load JSON file, using fallback');
  }
  return fallback;
}

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export class MarkerStore {
  private markers: Map<string, MarkerRecord> = new Map();
  private zones: Map<string, ZoneRecord> = new Map();
  private routes: Map<string, RouteRecord> = new Map();

  private markersPath = path.join(DATA_DIR, 'markers.json');
  private zonesPath = path.join(DATA_DIR, 'zones.json');
  private routesPath = path.join(DATA_DIR, 'routes.json');

  private markerSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private zoneSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private routeSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private io: SocketIOServer) {
    this.load();
    logger.info(
      { markers: this.markers.size, zones: this.zones.size, routes: this.routes.size },
      'MarkerStore loaded',
    );
  }

  // -- Persistence --

  private load(): void {
    const markers = loadJson<MarkerRecord[]>(this.markersPath, []);
    for (const m of markers) this.markers.set(m.id, m);

    const zones = loadJson<ZoneRecord[]>(this.zonesPath, []);
    for (const z of zones) this.zones.set(z.id, z);

    const routes = loadJson<RouteRecord[]>(this.routesPath, []);
    for (const r of routes) this.routes.set(r.id, r);
  }

  private saveMarkers(): void {
    if (this.markerSaveTimer) return;
    this.markerSaveTimer = setTimeout(() => {
      this.markerSaveTimer = null;
      atomicWriteJson(this.markersPath, Array.from(this.markers.values())).catch((err) => {
        logger.error({ err, filePath: this.markersPath }, 'Failed to save markers');
      });
    }, DEBOUNCE_MS);
  }

  private saveMarkersImmediate(): void {
    if (this.markerSaveTimer) { clearTimeout(this.markerSaveTimer); this.markerSaveTimer = null; }
    try {
      atomicWriteJsonSync(this.markersPath, Array.from(this.markers.values()));
    } catch (err) {
      logger.error({ err, filePath: this.markersPath }, 'Failed to save markers');
    }
  }

  private saveZones(): void {
    if (this.zoneSaveTimer) return;
    this.zoneSaveTimer = setTimeout(() => {
      this.zoneSaveTimer = null;
      atomicWriteJson(this.zonesPath, Array.from(this.zones.values())).catch((err) => {
        logger.error({ err, filePath: this.zonesPath }, 'Failed to save zones');
      });
    }, DEBOUNCE_MS);
  }

  private saveZonesImmediate(): void {
    if (this.zoneSaveTimer) { clearTimeout(this.zoneSaveTimer); this.zoneSaveTimer = null; }
    try {
      atomicWriteJsonSync(this.zonesPath, Array.from(this.zones.values()));
    } catch (err) {
      logger.error({ err, filePath: this.zonesPath }, 'Failed to save zones');
    }
  }

  private saveRoutes(): void {
    if (this.routeSaveTimer) return;
    this.routeSaveTimer = setTimeout(() => {
      this.routeSaveTimer = null;
      atomicWriteJson(this.routesPath, Array.from(this.routes.values())).catch((err) => {
        logger.error({ err, filePath: this.routesPath }, 'Failed to save routes');
      });
    }, DEBOUNCE_MS);
  }

  private saveRoutesImmediate(): void {
    if (this.routeSaveTimer) { clearTimeout(this.routeSaveTimer); this.routeSaveTimer = null; }
    try {
      atomicWriteJsonSync(this.routesPath, Array.from(this.routes.values()));
    } catch (err) {
      logger.error({ err, filePath: this.routesPath }, 'Failed to save routes');
    }
  }

  /** Flush all pending saves and clear timers */
  shutdown(): void {
    this.saveMarkersImmediate();
    this.saveZonesImmediate();
    this.saveRoutesImmediate();
  }

  // -- Markers --

  createMarker(data: {
    name: string;
    kind: MarkerRecord['kind'];
    position: MarkerRecord['position'];
    tags?: string[];
    notes?: string;
  }): MarkerRecord {
    const now = Date.now();
    const marker: MarkerRecord = {
      id: genId('mkr'),
      name: data.name,
      kind: data.kind,
      position: data.position,
      tags: data.tags ?? [],
      notes: data.notes,
      createdAt: now,
      updatedAt: now,
    };
    this.markers.set(marker.id, marker);
    this.saveMarkers();
    this.io.emit(WORLD_EVENTS.MARKER_CREATED, marker);
    logger.info({ markerId: marker.id, name: marker.name, kind: marker.kind }, 'Marker created');
    return marker;
  }

  getMarkers(): MarkerRecord[] {
    return Array.from(this.markers.values());
  }

  getMarker(id: string): MarkerRecord | undefined {
    return this.markers.get(id);
  }

  updateMarker(id: string, data: Partial<Omit<MarkerRecord, 'id' | 'createdAt'>>): MarkerRecord | undefined {
    const existing = this.markers.get(id);
    if (!existing) return undefined;
    const updated: MarkerRecord = { ...existing, ...data, id: existing.id, createdAt: existing.createdAt, updatedAt: Date.now() };
    this.markers.set(id, updated);
    this.saveMarkers();
    this.io.emit(WORLD_EVENTS.MARKER_UPDATED, updated);
    logger.info({ markerId: id, name: updated.name, kind: updated.kind }, 'Marker updated');
    return updated;
  }

  deleteMarker(id: string): boolean {
    const marker = this.markers.get(id);
    const existed = this.markers.delete(id);
    if (existed) {
      this.saveMarkers();
      this.io.emit(WORLD_EVENTS.MARKER_UPDATED, { id, deleted: true });
      logger.info({ markerId: id, name: marker?.name, kind: marker?.kind }, 'Marker deleted');
    }
    return existed;
  }

  // -- Zones --

  createZone(data: Omit<ZoneRecord, 'id'>): ZoneRecord {
    const zone: ZoneRecord = { id: genId('zne'), ...data };
    this.zones.set(zone.id, zone);
    this.saveZones();
    this.io.emit(WORLD_EVENTS.ZONE_UPDATED, zone);
    logger.info({ zoneId: zone.id, name: zone.name }, 'Zone created');
    return zone;
  }

  getZones(): ZoneRecord[] {
    return Array.from(this.zones.values());
  }

  getZone(id: string): ZoneRecord | undefined {
    return this.zones.get(id);
  }

  updateZone(id: string, data: Partial<Omit<ZoneRecord, 'id'>>): ZoneRecord | undefined {
    const existing = this.zones.get(id);
    if (!existing) return undefined;
    const updated: ZoneRecord = { ...existing, ...data, id: existing.id };
    this.zones.set(id, updated);
    this.saveZones();
    this.io.emit(WORLD_EVENTS.ZONE_UPDATED, updated);
    logger.info({ zoneId: id }, 'Zone updated');
    return updated;
  }

  deleteZone(id: string): boolean {
    const existed = this.zones.delete(id);
    if (existed) {
      this.saveZones();
      this.io.emit(WORLD_EVENTS.ZONE_UPDATED, { id, deleted: true });
      logger.info({ zoneId: id }, 'Zone deleted');
    }
    return existed;
  }

  // -- Routes --

  createRoute(data: Omit<RouteRecord, 'id'>): RouteRecord {
    const route: RouteRecord = { id: genId('rte'), ...data };
    this.routes.set(route.id, route);
    this.saveRoutes();
    this.io.emit(WORLD_EVENTS.ROUTE_UPDATED, route);
    logger.info({ routeId: route.id, name: route.name }, 'Route created');
    return route;
  }

  getRoutes(): RouteRecord[] {
    return Array.from(this.routes.values());
  }

  getRoute(id: string): RouteRecord | undefined {
    return this.routes.get(id);
  }

  updateRoute(id: string, data: Partial<Omit<RouteRecord, 'id'>>): RouteRecord | undefined {
    const existing = this.routes.get(id);
    if (!existing) return undefined;
    const updated: RouteRecord = { ...existing, ...data, id: existing.id };
    this.routes.set(id, updated);
    this.saveRoutes();
    this.io.emit(WORLD_EVENTS.ROUTE_UPDATED, updated);
    logger.info({ routeId: id }, 'Route updated');
    return updated;
  }

  deleteRoute(id: string): boolean {
    const existed = this.routes.delete(id);
    if (existed) {
      this.saveRoutes();
      this.io.emit(WORLD_EVENTS.ROUTE_UPDATED, { id, deleted: true });
      logger.info({ routeId: id }, 'Route deleted');
    }
    return existed;
  }

  // -- Spatial Helpers --

  findNearestMarker(
    position: { x: number; y: number; z: number },
    kind?: MarkerRecord['kind'],
  ): MarkerRecord | undefined {
    let nearest: MarkerRecord | undefined;
    let bestDist = Infinity;

    for (const marker of this.markers.values()) {
      if (kind && marker.kind !== kind) continue;
      const dx = marker.position.x - position.x;
      const dy = marker.position.y - position.y;
      const dz = marker.position.z - position.z;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        nearest = marker;
      }
    }
    return nearest;
  }

  isInsideZone(x: number, z: number, zoneId: string): boolean {
    const zone = this.zones.get(zoneId);
    if (!zone) return false;

    if (zone.shape === 'circle' && zone.circle) {
      const dx = x - zone.circle.x;
      const dz = z - zone.circle.z;
      return dx * dx + dz * dz <= zone.circle.radius * zone.circle.radius;
    }

    if (zone.shape === 'rectangle' && zone.rectangle) {
      const r = zone.rectangle;
      return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
    }

    return false;
  }
}
