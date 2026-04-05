/* ── World marker, zone, and route types ── */

export interface Marker {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  description?: string;
  createdAt: number;
}

export type ZoneShape = 'rectangular' | 'circular';

export interface Zone {
  id: string;
  name: string;
  shape: ZoneShape;
  center: { x: number; y: number; z: number };
  /** For rectangular: half-widths. For circular: radius stored in x, y ignored */
  size: { x: number; y: number; z: number };
  description?: string;
  createdAt: number;
}

export interface Route {
  id: string;
  name: string;
  waypoints: Array<{ x: number; y: number; z: number }>;
  loop: boolean;
  description?: string;
  createdAt: number;
}
