/**
 * BuildIntentResolver
 *
 * Lightweight, regex-driven parser that converts free-form player chat like
 *   "build a small house here"
 *   "build a tower 10 blocks north"
 *   "construct a bunker at 100 64 200"
 * into a structured ResolvedBuildIntent the BuildCoordinator can consume.
 *
 * No LLM call — this is intentionally cheap so it can run on every chat
 * message before the heavyweight chat handler. If we can't confidently parse
 * a build intent we return null and the chat path proceeds as normal.
 */

export interface ResolvedBuildIntent {
  /** Free-text from the player's message describing what to build. */
  query: string;
  /** Compass offset in blocks from the anchor (defaults to 0,0). */
  offset: { x: number; z: number };
  /** Anchor type. */
  anchor: 'player_position' | 'absolute' | 'marker';
  /** Marker name when anchor==='marker'. */
  markerName?: string;
  /** Absolute world coords when anchor==='absolute'. */
  absolute?: { x: number; y: number; z: number };
  /** Detected build mode. */
  mode?: 'surface' | 'underground';
  /** Confidence 0..1 — used for clarification prompts. */
  confidence: number;
}

const BUILD_VERB_RE = /\b(build|construct|make|create|place)\b/i;

const UNDERGROUND_RE = /\b(bunker|underground|buried|hidden|vault|tunnel)\b/i;

// "N blocks <direction>" — direction may follow optional words like "to the".
const DIRECTION_RE = /(\d+)\s*blocks?\s+(?:to\s+the\s+)?(north|south|east|west)\b/i;

// "near me" → small random offset
const NEAR_ME_RE = /\bnear\s+me\b/i;

// "at X Y Z" absolute coordinates (integers, may be negative)
const ABSOLUTE_COORDS_RE = /\bat\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\b/i;

// "here" / "at me" / "where I am"
const PLAYER_POSITION_RE = /\b(here|at\s+me|where\s+i\s+am)\b/i;

// "at <marker>" / "by the <marker>" — captures a short noun phrase as marker name.
// Tries "at the <name>", "by the <name>", "at <name>" — name is 1-3 lowercase words.
const MARKER_RE = /\b(?:at|by)\s+(?:the\s+)?([a-z][a-z0-9_-]*(?:\s+[a-z][a-z0-9_-]*){0,2})\b/i;

/**
 * Apply a compass-direction offset to (x, z) using Minecraft conventions:
 *   north → -z, south → +z, east → +x, west → -x.
 */
function applyDirection(
  direction: string,
  blocks: number,
  offset: { x: number; z: number }
): void {
  switch (direction.toLowerCase()) {
    case 'north':
      offset.z -= blocks;
      break;
    case 'south':
      offset.z += blocks;
      break;
    case 'east':
      offset.x += blocks;
      break;
    case 'west':
      offset.x -= blocks;
      break;
  }
}

/**
 * Extract a description of the thing to build by removing the build verb and
 * any location clauses we've already matched. Falls back to a trimmed version
 * of the original message when our removals leave nothing useful.
 */
function extractQuery(
  message: string,
  consumed: RegExp[],
): string {
  let q = message;
  // Strip the leading build verb and an optional article.
  q = q.replace(/^\s*(?:please\s+)?(build|construct|make|create|place)\s+(?:a|an|the|some)?\s*/i, '');
  // Strip each location/mode clause we already consumed.
  for (const re of consumed) {
    q = q.replace(re, ' ');
  }
  // Strip stray prepositional fragments left behind ("at the", "by the").
  q = q.replace(/\b(at|by|near)\s+(the\s+)?$/i, '');
  // Strip the underground mode keyword from the query so it doesn't read awkwardly.
  q = q.replace(UNDERGROUND_RE, (m) => m);
  return q.replace(/\s+/g, ' ').trim();
}

export function parseBuildIntent(message: string): ResolvedBuildIntent | null {
  if (!message || typeof message !== 'string') return null;
  const trimmed = message.trim();
  if (!trimmed) return null;

  if (!BUILD_VERB_RE.test(trimmed)) return null;

  const offset = { x: 0, z: 0 };
  let anchor: ResolvedBuildIntent['anchor'] = 'player_position';
  let markerName: string | undefined;
  let absolute: { x: number; y: number; z: number } | undefined;
  let mode: 'surface' | 'underground' = 'surface';
  let confidence = 0.4; // Base: we matched a build verb.

  const consumed: RegExp[] = [];

  // Mode detection — substring scan of the entire message.
  if (UNDERGROUND_RE.test(trimmed)) {
    mode = 'underground';
    confidence += 0.1;
  }

  // Direction offset, e.g. "10 blocks north".
  const dirMatch = trimmed.match(DIRECTION_RE);
  if (dirMatch) {
    const blocks = parseInt(dirMatch[1], 10);
    applyDirection(dirMatch[2], blocks, offset);
    consumed.push(DIRECTION_RE);
    confidence += 0.15;
  }

  // "near me" — small random 4..8 block offset on a random axis sign.
  if (NEAR_ME_RE.test(trimmed)) {
    const r = () => (Math.random() < 0.5 ? -1 : 1) * (4 + Math.floor(Math.random() * 5));
    offset.x += r();
    offset.z += r();
    anchor = 'player_position';
    consumed.push(NEAR_ME_RE);
    confidence += 0.15;
  }

  // Anchor detection — absolute coords win, then marker, then player position.
  const absMatch = trimmed.match(ABSOLUTE_COORDS_RE);
  if (absMatch) {
    absolute = {
      x: parseInt(absMatch[1], 10),
      y: parseInt(absMatch[2], 10),
      z: parseInt(absMatch[3], 10),
    };
    anchor = 'absolute';
    consumed.push(ABSOLUTE_COORDS_RE);
    confidence += 0.2;
  } else if (PLAYER_POSITION_RE.test(trimmed)) {
    anchor = 'player_position';
    consumed.push(PLAYER_POSITION_RE);
    confidence += 0.2;
  } else {
    // Marker only if it doesn't conflict with the underground keyword set —
    // "at the bunker" should still be a marker but flagged underground via mode.
    const markerMatch = trimmed.match(MARKER_RE);
    if (markerMatch) {
      const candidate = markerMatch[1].trim().toLowerCase();
      // Skip if the candidate is just a directional/positional keyword.
      const noiseWords = new Set([
        'north', 'south', 'east', 'west',
        'me', 'here',
      ]);
      if (!noiseWords.has(candidate)) {
        markerName = candidate;
        anchor = 'marker';
        consumed.push(MARKER_RE);
        confidence += 0.15;
      }
    }
  }

  // Compose the natural-language query describing the thing to build.
  const query = extractQuery(trimmed, consumed);
  if (query) confidence += 0.1;

  // Clamp confidence to [0, 1]. A bare "build" with no description and no
  // location should land low (~0.4) so callers can prompt for clarification.
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    query,
    offset,
    anchor,
    markerName,
    absolute,
    mode,
    confidence,
  };
}
