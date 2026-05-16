/**
 * DistrictManager — Phase 5-B.
 *
 * Owns the *evolutionary* lifecycle of a town's districts. Phase 1's
 * TownManager only knows how to drop a single 64x64 "Old Town" district at
 * founding; this manager extends that with:
 *
 *   - `addDistrict(townId, input)` — append a new district row offset from
 *     the existing ones (default +64 along +X — keeps the new district's
 *     bounds non-overlapping with the founding one).
 *   - `getActiveDistrictFor(townId, kind)` — pick the district whose style
 *     preset best matches the requested building kind. Today this is a
 *     simple "match the styleSeed family" lookup; Phase 6 may add per-kind
 *     overrides (e.g. forcing `town_hall` into a mid-century downtown even
 *     when the town's founding style was medieval).
 *   - `onTierUpgrade(townId, fromTier, toTier)` — fires when a town
 *     transitions village → town. Adds a second district seeded with the
 *     *other* style preset so the town gets the spec's "medieval village →
 *     mid-century downtown" arc.
 *
 * Idempotency: addDistrict-on-tier-upgrade checks listDistricts first and
 * returns the existing second district when one is already present. The
 * brain calls `onTierUpgrade` on every tick where it sees the tier flip; we
 * never want to splash two new districts on the same town.
 */
import path from 'path';
import type { TownManager } from './TownManager';
import type { District, Town, TownTier, Vec3 } from './Town';
import { defaultDistrictBounds } from './Town';
import { buildSeedStyle } from './seedStyle';
import { writeStyle, styleDocPath, type StyleDoc, type StyleSeed } from './StyleDoc';
import { logger } from '../util/logger';
import fs from 'fs';

/** District-level offset between the founding district and any new ones. */
const DISTRICT_OFFSET_BLOCKS = 64;

export interface AddDistrictInput {
  /** Name shown on the dashboard ("Old Town", "Downtown", "North District", …). */
  name: string;
  /** Style preset for the district — drives its own style.json. */
  stylePreset: StyleSeed;
  /**
   * Optional centerpoint override. When omitted, the manager picks a coord
   * offset from existing districts (+X by default) so footprints don't
   * collide. The capital y is reused so the new district stays at the
   * town's working elevation.
   */
  center?: Vec3;
}

export interface AddDistrictResult {
  district: District;
  /** True iff the manager actually inserted a new row (vs. returned an existing duplicate). */
  created: boolean;
}

export class DistrictManager {
  private readonly townManager: TownManager;
  /** Resolves to `<dataDir>/towns/<townId>/districts/<districtId>/style.json`. */
  private readonly dataDir: string;

  constructor(townManager: TownManager, dataDir?: string) {
    this.townManager = townManager;
    this.dataDir = dataDir ?? townManager.getDataDir?.() ?? path.join(process.cwd(), 'data');
  }

  /**
   * Insert a new district row + drop its style.json seed. Idempotent on
   * `(townId, stylePreset)` — if the town already has a district with the
   * requested style, we return that district and `created: false` instead
   * of inserting a duplicate. Bounds are auto-picked by offsetting from
   * existing districts.
   */
  addDistrict(townId: string, input: AddDistrictInput): AddDistrictResult | null {
    const town = this.townManager.getTown(townId);
    if (!town) {
      logger.warn({ townId }, 'DistrictManager.addDistrict: town not found');
      return null;
    }
    if (!town.capital) {
      logger.warn({ townId }, 'DistrictManager.addDistrict: town has no capital, cannot place district');
      return null;
    }

    const existing = this.listDistricts(townId);
    const duplicate = existing.find((d) => d.stylePreset === input.stylePreset);
    if (duplicate) {
      return { district: duplicate, created: false };
    }

    // Pick a center: caller override, or +X offset from the last district.
    const center = input.center ?? this.pickNonOverlappingCenter(town, existing);

    // Reuse TownManager's createDistrict — keeps the schema mapping in one
    // place. The dropped style.json is the *district's* style doc, which
    // P4-A's LlmDesigner reads when building inside this district.
    const district = this.townManager.createDistrict({
      townId,
      name: input.name,
      stylePreset: input.stylePreset,
      center,
      isDefault: false,
    });
    if (!district) {
      logger.warn({ townId, name: input.name }, 'DistrictManager.addDistrict: createDistrict failed');
      return null;
    }

    // Drop the per-district style.json so LLMDesigner can pick it up via
    // styleDocPathForDistrict. Failures are non-fatal — the brain falls
    // back to the town-level style.json if no district doc is found.
    try {
      const seed = buildSeedStyle(input.stylePreset, townId);
      // Per-district style doc lives at:
      //   <dataDir>/towns/<townId>/districts/<districtId>/style.json
      const file = path.join(
        this.dataDir,
        'towns',
        townId,
        'districts',
        district.id,
        'style.json',
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // We reuse writeStyle by passing a temporary doc with a tweaked file
      // location — easiest is to write the JSON directly here.
      fs.writeFileSync(file, JSON.stringify(seed, null, 2), 'utf8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, townId, districtId: district.id },
        'DistrictManager.addDistrict: style.json seed write failed (non-fatal)',
      );
    }

    this.townManager.recordEvent({
      townId,
      kind: 'district:created',
      severity: 'major',
      payload: {
        districtId: district.id,
        name: district.name,
        stylePreset: district.stylePreset,
        center,
      },
      highlightScore: 70,
    });
    logger.info(
      { townId, districtId: district.id, name: district.name, stylePreset: district.stylePreset },
      'DistrictManager.addDistrict: created',
    );
    return { district, created: true };
  }

  /**
   * Pick the district whose style preset matches the building kind. For
   * now this is a coarse "which district has a style preset that matches
   * the town's seed style" lookup — if the town has multiple districts
   * with different presets, we route the building to the district whose
   * preset family matches the town's `styleSeed`. When there's only one
   * district (the common case for founding/village towns), we return it.
   * Returns null when the town has no districts (shouldn't happen — every
   * town gets an Old Town at founding).
   */
  getActiveDistrictFor(townId: string, _kind: string): District | null {
    const districts = this.listDistricts(townId);
    if (districts.length === 0) return null;
    if (districts.length === 1) return districts[0];

    // Phase 5: prefer the most-recently-added (non-default) district when
    // there are multiple. The "medieval village → mid-century downtown"
    // arc means the new district is the one where most new construction
    // should land. Phase 6 will add per-kind routing.
    const nonDefault = districts.filter((d) => !d.isDefault);
    if (nonDefault.length > 0) {
      // Pick the newest non-default district.
      return nonDefault.reduce((a, b) => (a.foundedAt > b.foundedAt ? a : b));
    }
    return districts[0];
  }

  /**
   * Hook fired by the brain on tier transition. Adds the *other* style's
   * district when the town reaches `town` tier. Idempotent — checks
   * existing districts before inserting.
   *
   * Returns the new district when one was created, null otherwise.
   */
  onTierUpgrade(
    townId: string,
    fromTier: TownTier,
    toTier: TownTier,
  ): AddDistrictResult | null {
    if (toTier !== 'town') return null;
    if (fromTier === 'town') return null;

    const town = this.townManager.getTown(townId);
    if (!town) return null;

    const existing = this.listDistricts(townId);
    // If the town already has 2+ districts, the second one has already
    // been seeded — nothing to do.
    if (existing.length >= 2) return null;

    const currentPreset = (town.styleSeed ?? 'medieval-communal') as StyleSeed;
    const otherPreset: StyleSeed =
      currentPreset === 'medieval-communal' ? 'mid-century-civic' : 'medieval-communal';
    const newDistrictName = otherPreset === 'mid-century-civic' ? 'Downtown' : 'Old Quarter';

    logger.info(
      { townId, fromTier, toTier, otherPreset },
      'DistrictManager.onTierUpgrade: seeding second district',
    );

    return this.addDistrict(townId, {
      name: newDistrictName,
      stylePreset: otherPreset,
    });
  }

  /** Thin pass-through to TownManager.listDistricts so callers can use just this manager. */
  listDistricts(townId: string): District[] {
    return this.townManager.listDistricts(townId);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Pick a center for the new district that doesn't visibly overlap the
   * existing ones. We simply offset +X by DISTRICT_OFFSET_BLOCKS per
   * existing district, which is enough to push the 64x64 default bounds
   * clear of any current district.
   */
  private pickNonOverlappingCenter(town: Town, existing: District[]): Vec3 {
    if (!town.capital) {
      // Shouldn't reach here — guarded above — but keep a safe fallback.
      return { x: 0, y: 64, z: 0 };
    }
    // Re-anchor on the founding capital and offset by the count. This is
    // deterministic per-town so the layout doesn't shift between ticks.
    const dx = DISTRICT_OFFSET_BLOCKS * Math.max(1, existing.length);
    return {
      x: town.capital.x + dx,
      y: town.capital.y,
      z: town.capital.z,
    };
  }

  /**
   * Resolve the absolute path to a district's style.json. Mirrors
   * `styleDocPath` in StyleDoc.ts but scoped to a district subdirectory.
   * Returned even when the file doesn't exist — callers should existsSync
   * before reading.
   */
  districtStyleDocPath(townId: string, districtId: string): string {
    return path.join(
      this.dataDir,
      'towns',
      townId,
      'districts',
      districtId,
      'style.json',
    );
  }

  /**
   * Load a district's style.json. Returns null when the file is missing
   * or fails to parse — callers fall back to the town-level style doc.
   */
  loadDistrictStyle(townId: string, districtId: string): StyleDoc | null {
    const file = this.districtStyleDocPath(townId, districtId);
    try {
      if (!fs.existsSync(file)) return null;
      const raw = fs.readFileSync(file, 'utf8');
      return JSON.parse(raw) as StyleDoc;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, townId, districtId, file }, 'loadDistrictStyle: read/parse failed');
      return null;
    }
  }

  /** Reference the town-level seed path to keep the import alive. */
  static townStyleDocPath(dataDir: string, townId: string): string {
    return styleDocPath(dataDir, townId);
  }

  /** No-op helper retained so writeStyle stays importable from this module. */
  static rewriteTownStyle = writeStyle;
}
