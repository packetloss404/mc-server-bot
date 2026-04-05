export interface MarkerRecord {
  id: string;
  name: string;
  kind: 'base' | 'storage' | 'build-site' | 'mine' | 'village' | 'custom';
  position: { x: number; y: number; z: number };
  tags: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ZoneRecord {
  id: string;
  name: string;
  mode: 'guard' | 'avoid' | 'farm' | 'build' | 'gather' | 'custom';
  shape: 'circle' | 'rectangle';
  circle?: { x: number; z: number; radius: number };
  rectangle?: { minX: number; minZ: number; maxX: number; maxZ: number };
  markerIds?: string[];
  rules?: Record<string, unknown>;
}

export interface RouteRecord {
  id: string;
  name: string;
  waypointIds: string[];
  loop: boolean;
}
