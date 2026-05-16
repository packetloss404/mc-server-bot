/**
 * Town domain model — TypeScript interfaces used by the API layer and the
 * TownManager. Row shapes from the DB are normalised into these objects
 * (JSON fields parsed, boolean ints cast, naming camelCased).
 */

export type StylePreset = 'medieval-communal' | 'mid-century-civic';
export type TownTier = 'founding' | 'village' | 'town';
export type TownStatus = 'active' | 'dormant' | 'abandoned';
export type AllianceState = 'allied' | 'rival' | 'neutral' | null;
export type ResidentStatus = 'alive' | 'dead' | 'departed';
export type BuildingStatus = 'planned' | 'building' | 'complete' | 'damaged' | 'destroyed';
export type EventSeverity = 'info' | 'minor' | 'major' | 'critical';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MayorConfig {
  playerName?: string;
  title?: string;
  stealth?: boolean;
  voteWeight?: number;
}

export interface TownConfig {
  mayor?: MayorConfig;
  sliders?: Record<string, number>;
  [key: string]: unknown;
}

export interface Town {
  id: string;
  name: string;
  foundedAt: number;
  capital: Vec3 | null;
  tier: TownTier;
  status: TownStatus;
  populationTarget: number | null;
  allianceState: AllianceState;
  parentTownId: string | null;
  styleSeed: StylePreset | string | null;
  config: TownConfig;
}

export interface District {
  id: string;
  townId: string;
  name: string | null;
  stylePreset: StylePreset | string;
  bounds: unknown | null;
  foundedAt: number;
  isDefault: boolean;
}

export interface Resident {
  id: string;
  townId: string;
  botName: string;
  joinedAt: number;
  currentRole: string | null;
  status: ResidentStatus | string | null;
}

export interface Building {
  id: string;
  townId: string;
  districtId: string | null;
  name: string | null;
  schematicSource: string | null;
  schematicRef: string | null;
  origin: Vec3 | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  builtAt: number | null;
  destroyedAt: number | null;
  status: BuildingStatus | string | null;
}

export interface TownEvent {
  id: string;
  townId: string;
  kind: string;
  severity: EventSeverity | string | null;
  payload: unknown;
  occurredAt: number;
  highlightScore: number | null;
}

/**
 * Disaster row — Phase 5-A "Phoenix" self-healing.
 *
 * `kind` follows the schema enum (`raid` | `lava` | `lost_bot` | `crash`) but
 * is intentionally typed as a free string so Phase-5 extensions can add new
 * kinds without a schema bump. `memorialMarkerId` links to MarkerStore.
 */
export interface Disaster {
  id: string;
  townId: string;
  kind: string;
  severity: EventSeverity | string | null;
  occurredAt: number | null;
  memorialMarkerId: string | null;
  summary: string | null;
  /** Caller's natural-key for cross-restart dedup. Null for legacy rows. */
  dedupeKey: string | null;
}

export interface CreateTownInput {
  name: string;
  capital: Vec3;
  stylePreset: StylePreset;
  mayorTitle?: string;
  mayorPlayerName?: string;
  parentTownId?: string;
}

export interface CreateResidentInput {
  botName: string;
  role?: string;
}

/**
 * Default district footprint used at founding. 64×64 horizontal square
 * centered on the capital, extending the full vertical world for now.
 */
export function defaultDistrictBounds(capital: Vec3): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const half = 32;
  return {
    minX: capital.x - half,
    maxX: capital.x + half,
    minZ: capital.z - half,
    maxZ: capital.z + half,
  };
}
