'use client';

/**
 * @deprecated The authoritative marker/zone state lives in useWorldStore (from '@/lib/store').
 * This file previously held duplicate MapMarker/MapZone types and lists.
 * It has been replaced by useWorldStore for data and this shim is kept only
 * for backward compatibility of the type re-exports.
 */
export { useWorldStore } from './store';
export type { MarkerRecord as MapMarker, ZoneRecord as MapZone } from './api';
