/**
 * SchematicEncoder — Phase 5 follow-up #44.
 *
 * Encodes an LLM-produced JSON BlockPlan (see `LlmDesigner.BlockPlan`) into a
 * gzip-compressed Sponge schematic v2 (.schem) byte buffer that the existing
 * BuildCoordinator can swing as if it had come out of `schematics/*.schem`.
 *
 * Why this exists:
 *   Phase 4-A persists LLM designs as JSON for cheap re-use, but the actual
 *   build path only consumes `.schem`. Without an encoder the LLM call ran,
 *   the style doc evolved, and yet the bots built whatever SchematicMatcher
 *   coughed up from the library. This module closes that gap so the LLM's
 *   actual geometry reaches the swing-time setblock loop.
 *
 * Pipeline per call:
 *   1. Validate the plan (bounds, non-empty blocks, recognised names).
 *      Unknown block names degrade to `minecraft:stone` with a warn; out-of-
 *      bounds or empty plans fail the encode entirely so the caller can fall
 *      back to the library matcher.
 *   2. Normalise names — BlockPlan emits bare `stone_bricks` but
 *      prismarine-schematic's writer expects the `minecraft:` prefix when it
 *      runs the palette through `Block.fromStateId(...)`.
 *   3. Build a state-id palette via `minecraft-data`'s `blocksByName` table.
 *      For blockstates (`facing=north,half=upper`), apply the same offset
 *      math that `prismarine-schematic`'s own state writer uses.
 *   4. Construct a Schematic instance and call `.write()` for a gzipped NBT
 *      Sponge-v2 buffer.
 *
 * Performance budget: a 9x6x11 house plan (≈ 600 blocks) encodes in well
 * under 50ms; the volume of every plan is small (3000-6000 voxels max) so we
 * walk the palette + block list once with no per-block heap allocations
 * inside the hot loop.
 */
import fs from 'fs';
import path from 'path';
import { Vec3 } from 'vec3';
import { logger } from '../util/logger';
import type { BlockPlan, BlockPlanEntry } from './LlmDesigner';

/**
 * Default Minecraft data version we encode against. The build coordinator
 * autodetects the bot's version when it reads the file back, so the producer
 * side just needs to pick a version whose block table is broad enough to
 * cover modern LLM output. 1.21.x is the same default the bot manager uses.
 */
const DEFAULT_MC_VERSION = '1.21.11';

/**
 * Fallback block when the LLM emits a name our minecraft-data registry doesn't
 * recognise. The validator rejects out-of-bounds and empty plans entirely,
 * but unknown blocks (e.g. 1.20+ blocks the encoder version doesn't know
 * about) are too easy for the LLM to produce to be worth failing the entire
 * encode over — a stone placeholder lets the build proceed.
 */
const UNKNOWN_BLOCK_FALLBACK = 'minecraft:stone';

/**
 * Hard size cap. Plans larger than this are rejected outright; BuildCoordinator
 * caps schematic volume at 2M voxels but anything past 50x30x50 (75k voxels)
 * is suspicious for an LLM-driven single-building design. Caller should fall
 * back to the library matcher.
 */
const MAX_PLAN_VOLUME = 50 * 30 * 50;

export interface EncodeResult {
  /** Just the basename (matches what BuildCoordinator.listSchematics returns). */
  filename: string;
  /** Bytes written to disk. */
  byteSize: number;
  /** Absolute path on disk. */
  filePath: string;
}

/** Thrown when the BlockPlan can't be encoded. Caller falls back. */
export class SchematicEncodeError extends Error {
  constructor(message: string, public readonly reasons: string[]) {
    super(message);
    this.name = 'SchematicEncodeError';
  }
}

/**
 * Strip a `minecraft:` prefix (if present) for lookup against the bare-name
 * minecraft-data table. The schematic writer adds the prefix back when it
 * serialises the palette.
 */
function bareName(name: string): string {
  const lc = name.toLowerCase().trim();
  return lc.startsWith('minecraft:') ? lc.slice('minecraft:'.length) : lc;
}

/**
 * Parse a `state` string like `facing=north,half=upper` into an array of
 * [key, value] tuples. Empty / undefined input returns an empty array.
 */
function parseStateString(state: string | undefined): Array<[string, string]> {
  if (!state) return [];
  return state
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((kv) => {
      const eq = kv.indexOf('=');
      if (eq < 0) return [kv, ''] as [string, string];
      return [kv.slice(0, eq).trim(), kv.slice(eq + 1).trim()] as [string, string];
    })
    .filter(([k]) => k.length > 0);
}

/**
 * Compute a per-property offset for a blockstate. Mirrors
 * `prismarine-schematic/lib/states.js`'s `getStateValue` so palette entries we
 * encode survive a `Schematic.read` round-trip with identical block + state.
 */
function getStateValue(states: any[], key: string, value: string): number {
  let offset = 1;
  for (let i = states.length - 1; i >= 0; i--) {
    const state = states[i];
    if (state.name === key) {
      if (state.type === 'enum') {
        const idx = state.values.indexOf(value);
        // Unknown enum value -> 0 (matches the default).
        return offset * (idx >= 0 ? idx : 0);
      }
      // bool: 'true' -> 0, 'false' -> 1 (mirrors prismarine-schematic's parseValue)
      if (value === 'true') return 0;
      if (value === 'false') return offset * 1;
      const n = parseInt(value, 10);
      return offset * (Number.isNaN(n) ? 0 : n);
    }
    offset *= state.num_values;
  }
  return 0;
}

/**
 * Compute the state ID for a normalised block name + parsed properties using
 * the minecraft-data registry. Returns null when the name isn't registered,
 * so the caller can swap in the fallback block.
 */
function computeStateId(
  mcData: any,
  bareBlockName: string,
  properties: Array<[string, string]>,
): number | null {
  const block = mcData.blocksByName[bareBlockName];
  if (!block) return null;
  if (block.minStateId === undefined) {
    // Pre-1.13 fallback — collapses metadata into the high bits.
    let meta = 0;
    for (const [k, v] of properties) {
      // Best-effort: most 1.13+ schematic consumers won't see this path.
      const n = parseInt(v, 10);
      if (!Number.isNaN(n)) meta = n;
      else if (v === 'true') meta = 1;
      void k;
    }
    return (block.id << 4) + meta;
  }
  let stateOffset = 0;
  if (properties.length > 0 && Array.isArray(block.states) && block.states.length > 0) {
    for (const [key, value] of properties) {
      stateOffset += getStateValue(block.states, key, value);
    }
  }
  return block.minStateId + stateOffset;
}

export interface ValidationReport {
  ok: boolean;
  reasons: string[];
  /** Names the LLM emitted that we don't recognise — used for warn logging. */
  unknownNames: string[];
}

/**
 * Pre-encode gate. Returns ok:false when the plan is unsalvageable (empty,
 * out-of-bounds, oversized); a list of unknown names is returned regardless
 * so the encoder can log + substitute.
 */
export function validatePlanForEncode(
  plan: BlockPlan,
  mcVersion: string = DEFAULT_MC_VERSION,
): ValidationReport {
  const reasons: string[] = [];
  const unknownNames: string[] = [];

  if (!plan || typeof plan !== 'object') {
    return { ok: false, reasons: ['plan is missing or not an object'], unknownNames };
  }
  const dims = plan.dimensions;
  if (
    !dims ||
    !Number.isFinite(dims.w) ||
    !Number.isFinite(dims.h) ||
    !Number.isFinite(dims.d) ||
    dims.w <= 0 ||
    dims.h <= 0 ||
    dims.d <= 0
  ) {
    return {
      ok: false,
      reasons: ['plan.dimensions must be {w,h,d} with positive integers'],
      unknownNames,
    };
  }
  if (!Array.isArray(plan.blocks) || plan.blocks.length === 0) {
    return { ok: false, reasons: ['plan.blocks must be a non-empty array'], unknownNames };
  }

  const volume = dims.w * dims.h * dims.d;
  if (volume > MAX_PLAN_VOLUME) {
    reasons.push(
      `plan volume ${volume} exceeds encoder cap ${MAX_PLAN_VOLUME} (${dims.w}x${dims.h}x${dims.d}); fall back to library`,
    );
  }

  // Bounds: every block must be inside [0, dim-1].
  let outOfBounds = 0;
  for (const b of plan.blocks) {
    if (
      !b ||
      !Number.isFinite(b.x) ||
      !Number.isFinite(b.y) ||
      !Number.isFinite(b.z) ||
      typeof b.name !== 'string' ||
      b.name.length === 0
    ) {
      reasons.push('every block must have numeric x/y/z and a non-empty name');
      return { ok: false, reasons, unknownNames };
    }
    if (b.x < 0 || b.y < 0 || b.z < 0) outOfBounds++;
    else if (b.x >= dims.w || b.y >= dims.h || b.z >= dims.d) outOfBounds++;
  }
  if (outOfBounds > 0) {
    reasons.push(`${outOfBounds} block(s) fall outside dims ${dims.w}x${dims.h}x${dims.d}`);
  }

  // Unknown-name pass. We only need to look up each unique name once.
  const mcData = require('minecraft-data')(mcVersion);
  const seen = new Set<string>();
  for (const b of plan.blocks) {
    const bare = bareName(b.name);
    if (seen.has(bare)) continue;
    seen.add(bare);
    if (!mcData.blocksByName[bare]) {
      unknownNames.push(bare);
    }
  }

  return { ok: reasons.length === 0, reasons, unknownNames };
}

export interface EncoderOptions {
  /** Override the minecraft-data version (mainly for tests). */
  mcVersion?: string;
}

/**
 * Encode a BlockPlan into a Sponge-v2 .schem byte buffer. Throws
 * SchematicEncodeError when the plan is unencodable; the caller is expected
 * to fall back to SchematicMatcher.
 */
export async function encode(plan: BlockPlan, opts: EncoderOptions = {}): Promise<Buffer> {
  const mcVersion = opts.mcVersion ?? DEFAULT_MC_VERSION;
  const report = validatePlanForEncode(plan, mcVersion);
  if (!report.ok) {
    throw new SchematicEncodeError(
      `BlockPlan failed pre-encode validation: ${report.reasons.join('; ')}`,
      report.reasons,
    );
  }
  if (report.unknownNames.length > 0) {
    logger.warn(
      { kind: plan.kind, unknown: report.unknownNames.slice(0, 5), total: report.unknownNames.length },
      `SchematicEncoder: ${report.unknownNames.length} unknown block name(s); substituting ${UNKNOWN_BLOCK_FALLBACK}`,
    );
  }

  const dims = plan.dimensions;
  const sizeX = dims.w;
  const sizeY = dims.h;
  const sizeZ = dims.d;
  const totalCells = sizeX * sizeY * sizeZ;

  const mcData = require('minecraft-data')(mcVersion);
  // Resolve the fallback once so we don't re-lookup per unknown-block.
  const fallbackBare = bareName(UNKNOWN_BLOCK_FALLBACK);
  const fallbackStateId = computeStateId(mcData, fallbackBare, []);
  if (fallbackStateId == null) {
    throw new SchematicEncodeError(
      `Encoder fallback block "${UNKNOWN_BLOCK_FALLBACK}" not found in minecraft-data ${mcVersion}; encoder cannot run`,
      [`fallback block ${UNKNOWN_BLOCK_FALLBACK} missing in mcData ${mcVersion}`],
    );
  }

  // Palette: map state-id -> palette-index. Index 0 must be air for unfilled
  // cells (otherwise the entire bounding box would render as the first
  // encountered block when round-tripped). minecraft-data lists air at state
  // 0, but we resolve it explicitly to stay safe.
  const airStateId = computeStateId(mcData, 'air', []) ?? 0;
  const stateIdToPaletteIdx = new Map<number, number>();
  const palette: number[] = [];
  // Reserve index 0 for air.
  stateIdToPaletteIdx.set(airStateId, 0);
  palette.push(airStateId);

  // The Schematic ctor takes a flat blocks array of palette indices,
  // ordered (y, z, x) — index = x + z*size.x + y*size.x*size.z. Initialise
  // to 0 (air); we only overwrite the cells the plan declares.
  const blocks = new Array<number>(totalCells).fill(0);

  // Helper: resolve a BlockPlanEntry to a palette index, adding to palette
  // on first use.
  const resolvePaletteIdx = (entry: BlockPlanEntry): number => {
    const bare = bareName(entry.name);
    const props = parseStateString(entry.state);
    let stateId = computeStateId(mcData, bare, props);
    if (stateId == null) {
      stateId = fallbackStateId;
    }
    let idx = stateIdToPaletteIdx.get(stateId);
    if (idx == null) {
      idx = palette.length;
      palette.push(stateId);
      stateIdToPaletteIdx.set(stateId, idx);
    }
    return idx;
  };

  // Fill the blocks grid. Last write wins when the plan lists the same cell
  // twice (matches the original BlockPlan list-order semantics).
  for (const b of plan.blocks) {
    const x = b.x | 0;
    const y = b.y | 0;
    const z = b.z | 0;
    // Validator already enforced bounds, but belt-and-braces because we'd
    // otherwise write past the end of the flat blocks array.
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) continue;
    const idx = resolvePaletteIdx(b);
    const cell = x + z * sizeX + y * sizeX * sizeZ;
    blocks[cell] = idx;
  }

  // Construct a Schematic via prismarine-schematic's class and use the same
  // `.write()` it ships with so we never have to hand-roll the NBT layout.
  const { Schematic } = require('prismarine-schematic');
  const schematic = new Schematic(
    mcVersion,
    new Vec3(sizeX, sizeY, sizeZ),
    new Vec3(0, 0, 0),
    palette,
    blocks,
  );
  const buf: Buffer = await schematic.write();
  return buf;
}

/**
 * Encode the plan, then atomically persist it under
 * `<rootDir>/<townId>/<filename>`. Returns the filename basename so callers
 * can hand it straight to BuildCoordinator.
 *
 * The directory layout matches DesignCache so the JSON and .schem companion
 * files share a folder.
 */
export async function encodeAndSave(
  plan: BlockPlan,
  opts: {
    rootDir: string;
    townId: string;
    filename: string;
    mcVersion?: string;
  },
): Promise<EncodeResult> {
  const buf = await encode(plan, { mcVersion: opts.mcVersion });
  const dir = path.join(opts.rootDir, opts.townId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, opts.filename);
  // We can't use atomicWriteJsonSync (it stringifies); instead do the same
  // tmp + rename dance manually so a crash doesn't leave a half-written
  // .schem the BuildCoordinator might then try to read.
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, buf);
  fs.renameSync(tmpPath, filePath);
  return { filename: opts.filename, byteSize: buf.length, filePath };
}
