/**
 * MarkerStore — stores map markers and zones.
 * Stub: real implementation will replace this file.
 */

export interface Marker {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  type: string;
  createdAt: number;
  updatedAt: number;
}

export interface Zone {
  id: string;
  label: string;
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
  type: string;
  createdAt: number;
}

let idCounter = 0;

export class MarkerStore {
  private markers: Map<string, Marker> = new Map();
  private zones: Map<string, Zone> = new Map();

  createMarker(label: string, x: number, y: number, z: number, type: string = 'default'): Marker {
    const now = Date.now();
    const id = `marker-${++idCounter}-${now}`;
    const marker: Marker = { id, label, x, y, z, type, createdAt: now, updatedAt: now };
    this.markers.set(id, marker);
    return marker;
  }

  updateMarker(id: string, updates: Partial<Pick<Marker, 'label' | 'x' | 'y' | 'z' | 'type'>>): Marker {
    const marker = this.markers.get(id);
    if (!marker) throw new Error(`Marker ${id} not found`);
    Object.assign(marker, updates, { updatedAt: Date.now() });
    return marker;
  }

  deleteMarker(id: string): boolean {
    return this.markers.delete(id);
  }

  getMarker(id: string): Marker | undefined {
    return this.markers.get(id);
  }

  getAllMarkers(): Marker[] {
    return Array.from(this.markers.values());
  }

  createZone(
    label: string,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    type: string = 'default'
  ): Zone {
    const now = Date.now();
    const id = `zone-${++idCounter}-${now}`;
    const zone: Zone = { id, label, x1, y1, z1, x2, y2, z2, type, createdAt: now };
    this.zones.set(id, zone);
    return zone;
  }

  getZone(id: string): Zone | undefined {
    return this.zones.get(id);
  }

  getAllZones(): Zone[] {
    return Array.from(this.zones.values());
  }
}
