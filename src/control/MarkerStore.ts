/* ── MarkerStore: world markers, zones, and routes ── */

import { randomUUID } from 'crypto';
import { Marker, Route, Zone } from './WorldTypes';

export class MarkerStore {
  private markers: Map<string, Marker> = new Map();
  private zones: Map<string, Zone> = new Map();
  private routes: Map<string, Route> = new Map();

  /* ── Markers ── */

  createMarker(name: string, position: { x: number; y: number; z: number }, description?: string): Marker {
    const m: Marker = { id: randomUUID(), name, position, description, createdAt: Date.now() };
    this.markers.set(m.id, m);
    return m;
  }

  getMarker(id: string): Marker | undefined { return this.markers.get(id); }
  listMarkers(): Marker[] { return [...this.markers.values()]; }
  deleteMarker(id: string): boolean { return this.markers.delete(id); }

  updateMarker(id: string, patch: Partial<Pick<Marker, 'name' | 'position' | 'description'>>): Marker | undefined {
    const m = this.markers.get(id);
    if (!m) return undefined;
    if (patch.name !== undefined) m.name = patch.name;
    if (patch.position !== undefined) m.position = patch.position;
    if (patch.description !== undefined) m.description = patch.description;
    return m;
  }

  findNearestMarker(pos: { x: number; y: number; z: number }): Marker | undefined {
    let best: Marker | undefined;
    let bestDist = Infinity;
    for (const m of this.markers.values()) {
      const d = Math.hypot(m.position.x - pos.x, m.position.y - pos.y, m.position.z - pos.z);
      if (d < bestDist) { bestDist = d; best = m; }
    }
    return best;
  }

  /* ── Zones ── */

  createZone(name: string, shape: Zone['shape'], center: Zone['center'], size: Zone['size'], description?: string): Zone {
    const z: Zone = { id: randomUUID(), name, shape, center, size, description, createdAt: Date.now() };
    this.zones.set(z.id, z);
    return z;
  }

  getZone(id: string): Zone | undefined { return this.zones.get(id); }
  listZones(): Zone[] { return [...this.zones.values()]; }
  deleteZone(id: string): boolean { return this.zones.delete(id); }

  updateZone(id: string, patch: Partial<Pick<Zone, 'name' | 'center' | 'size' | 'description'>>): Zone | undefined {
    const z = this.zones.get(id);
    if (!z) return undefined;
    if (patch.name !== undefined) z.name = patch.name;
    if (patch.center !== undefined) z.center = patch.center;
    if (patch.size !== undefined) z.size = patch.size;
    if (patch.description !== undefined) z.description = patch.description;
    return z;
  }

  /** Check whether a point is inside a zone */
  isInZone(zoneId: string, pos: { x: number; y: number; z: number }): boolean {
    const z = this.zones.get(zoneId);
    if (!z) return false;
    if (z.shape === 'rectangular') {
      return (
        Math.abs(pos.x - z.center.x) <= z.size.x &&
        Math.abs(pos.y - z.center.y) <= z.size.y &&
        Math.abs(pos.z - z.center.z) <= z.size.z
      );
    }
    // circular — radius is size.x
    const dx = pos.x - z.center.x;
    const dz = pos.z - z.center.z;
    return Math.hypot(dx, dz) <= z.size.x;
  }

  /* ── Routes ── */

  createRoute(name: string, waypoints: Route['waypoints'], loop = false, description?: string): Route {
    const r: Route = { id: randomUUID(), name, waypoints, loop, description, createdAt: Date.now() };
    this.routes.set(r.id, r);
    return r;
  }

  getRoute(id: string): Route | undefined { return this.routes.get(id); }
  listRoutes(): Route[] { return [...this.routes.values()]; }
  deleteRoute(id: string): boolean { return this.routes.delete(id); }

  updateRoute(id: string, patch: Partial<Pick<Route, 'name' | 'waypoints' | 'loop' | 'description'>>): Route | undefined {
    const r = this.routes.get(id);
    if (!r) return undefined;
    if (patch.name !== undefined) r.name = patch.name;
    if (patch.waypoints !== undefined) r.waypoints = patch.waypoints;
    if (patch.loop !== undefined) r.loop = patch.loop;
    if (patch.description !== undefined) r.description = patch.description;
    return r;
  }

  /* ── Persistence ── */

  toJSON(): { markers: Marker[]; zones: Zone[]; routes: Route[] } {
    return {
      markers: this.listMarkers(),
      zones: this.listZones(),
      routes: this.listRoutes(),
    };
  }

  loadFrom(data: { markers?: Marker[]; zones?: Zone[]; routes?: Route[] }): void {
    this.markers.clear();
    this.zones.clear();
    this.routes.clear();
    for (const m of data.markers ?? []) this.markers.set(m.id, m);
    for (const z of data.zones ?? []) this.zones.set(z.id, z);
    for (const r of data.routes ?? []) this.routes.set(r.id, r);
  }
}
