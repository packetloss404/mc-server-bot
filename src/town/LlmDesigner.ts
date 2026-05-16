/**
 * LlmDesigner — Phase 4 LLM-driven building design pipeline.
 *
 * Replaces the Phase 2 `<schematicQuery>.schem` placeholder used by the
 * TownBrain's build loop. The flow per call:
 *
 *   1. Read the town's style.json (block palette + dimensions + patterns).
 *   2. Build a prompt that asks the LLM for a self-contained BlockPlan JSON.
 *   3. Validate the response. On failure, retry up to 3 times, feeding the
 *      validator's complaints back into the prompt for self-correction.
 *   4. Hand the plan to the caller. The caller is responsible for caching
 *      (DesignCache) and triggering the build (BuildCoordinator).
 *
 * Failure modes:
 *   - LLM client unavailable or AIDisabledError → throws, caller falls back.
 *   - 3x validation failure → throws, caller falls back.
 *   - Daily budget exceeded → caller is expected to gate before this point.
 *
 * The block plan is local-coords (origin at (0,0,0)); the build coordinator
 * resolves it to world coords downstream.
 */
import type { LLMClient } from '../ai/LLMClient';
import type { TaskType } from '../ai/TaskType';
import type { StyleDoc } from './StyleDoc';
import type { Town, Building, Vec3 } from './Town';
import type { PlanItem } from './PlanItem';
import { validate } from './DesignValidator';
import { logger } from '../util/logger';

/** Minimum dimensions per kind — used when the style doc lacks an entry. */
const DEFAULT_DIMENSIONS: Record<string, { w: number; h: number; d: number }> = {
  town_hall: { w: 13, h: 9, d: 15 },
  guildhall: { w: 15, h: 10, d: 17 },
  blacksmith: { w: 9, h: 6, d: 11 },
  tavern: { w: 11, h: 7, d: 13 },
  market: { w: 9, h: 5, d: 9 },
  library: { w: 11, h: 8, d: 13 },
  watchtower: { w: 7, h: 12, d: 7 },
  storage: { w: 9, h: 6, d: 9 },
  farm: { w: 9, h: 3, d: 9 },
  well: { w: 5, h: 4, d: 5 },
  walls: { w: 17, h: 5, d: 3 },
  plaza: { w: 13, h: 1, d: 13 },
  courthouse: { w: 13, h: 9, d: 15 },
  post_office: { w: 9, h: 6, d: 11 },
  fire_station: { w: 11, h: 7, d: 13 },
  house: { w: 9, h: 6, d: 11 },
};

/** Time-box every LLM round-trip. Keeps the brain tick bounded. */
const LLM_DESIGN_TIMEOUT_MS = 60_000;

/** Hard ceiling: we never bother the LLM more than 3 times per request. */
const MAX_VALIDATION_RETRIES = 3;

/** Approximate per-call output token budget. Plans are sparse — 4k is plenty. */
const LLM_MAX_OUTPUT_TOKENS = 4096;

/** A single block in local-space coords. */
export interface BlockPlanEntry {
  x: number;
  y: number;
  z: number;
  /** Minecraft block id, e.g. 'oak_planks' or 'minecraft:oak_planks'. */
  name: string;
  /** Optional blockstate string (`facing=north,half=upper`). Stays as-is. */
  state?: string;
}

export interface BlockPlan {
  /** Origin-relative bounding box. Validator enforces blocks within these. */
  dimensions: { w: number; h: number; d: number };
  /** Block kind label echoed back from the prompt, for chronicle/observers. */
  kind: string;
  /** Human-readable style tag (style preset + facade features). */
  style: string;
  /** The block list. */
  blocks: BlockPlanEntry[];
  /** Free-form designer notes; chronicle-friendly but optional. */
  notes?: string;
}

/** Neighbor context passed in so the LLM avoids overlap with built rows. */
export interface NeighborContext {
  /** Built or planned neighbors as world-space boxes. */
  neighbors: Array<{
    name: string | null;
    kind: string | null;
    origin: Vec3 | null;
    width: number | null;
    height: number | null;
    depth: number | null;
  }>;
}

export interface DesignerDeps {
  llmClient: LLMClient;
}

export interface DesignBuildingArgs {
  town: Town;
  plan: PlanItem;
  styleDoc: StyleDoc | null;
  neighbors: NeighborContext;
}

/** Pre-compute a {w,h,d} for the kind, with style.json overrides applied. */
export function dimensionsFor(
  kind: string,
  styleDoc: StyleDoc | null,
): { w: number; h: number; d: number } {
  const fallback = DEFAULT_DIMENSIONS[kind] ?? DEFAULT_DIMENSIONS.house;
  if (!styleDoc) return fallback;
  // Treat 'house' kind as housing, everything else as civic (a coarse split
  // — the style doc only carries two averages today).
  const target = kind === 'house' ? styleDoc.dimensions.house_avg : styleDoc.dimensions.civic_avg;
  if (target && target.w > 0 && target.h > 0 && target.d > 0) return target;
  return fallback;
}

/**
 * Strip ```json fences and parse. Returns null when the body is unparseable
 * — the designer's retry loop treats null as a validation failure.
 */
function parseJsonResponse(raw: string): unknown {
  let body = raw.trim();
  const fenceMatch = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) body = fenceMatch[1].trim();
  // Some models prefix the JSON with a sentence; pluck the first {...} block.
  if (!body.startsWith('{')) {
    const firstBrace = body.indexOf('{');
    const lastBrace = body.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      body = body.slice(firstBrace, lastBrace + 1);
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Coerce/sanitize the parsed JSON into a BlockPlan shape. Best-effort. */
function coerceBlockPlan(parsed: any, fallbackKind: string, fallbackStyle: string): BlockPlan | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const dims = parsed.dimensions ?? parsed.dims ?? parsed.size;
  if (!dims) return null;
  const blocksRaw = parsed.blocks ?? parsed.block_list ?? parsed.list;
  if (!Array.isArray(blocksRaw)) return null;
  const blocks: BlockPlanEntry[] = [];
  for (const b of blocksRaw) {
    if (!b || typeof b !== 'object') continue;
    const x = Number(b.x ?? b[0]);
    const y = Number(b.y ?? b[1]);
    const z = Number(b.z ?? b[2]);
    const name = typeof b.name === 'string' ? b.name : (typeof b.block === 'string' ? b.block : null);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !name) continue;
    const entry: BlockPlanEntry = { x: Math.round(x), y: Math.round(y), z: Math.round(z), name };
    if (typeof b.state === 'string') entry.state = b.state;
    blocks.push(entry);
  }
  return {
    dimensions: {
      w: Math.round(Number(dims.w ?? dims.x ?? dims.width)),
      h: Math.round(Number(dims.h ?? dims.y ?? dims.height)),
      d: Math.round(Number(dims.d ?? dims.z ?? dims.depth)),
    },
    kind: typeof parsed.kind === 'string' ? parsed.kind : fallbackKind,
    style: typeof parsed.style === 'string' ? parsed.style : fallbackStyle,
    blocks,
    notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
  };
}

const SYSTEM_PROMPT = `You are a Minecraft architect for a Voyager-style autonomous town builder.

You generate self-contained block plans as strict JSON. Plans are LOCAL-coords:
(0,0,0) is the south-west-bottom corner. y grows up; x and z fill the footprint.
Every coordinate MUST be within [0, dimension-1] on its axis.

Rules:
- Use vanilla Minecraft block ids. Either "oak_planks" or "minecraft:oak_planks" is fine.
- Match the provided style preset's palette. Walls/roof/floor/accent should come from the palette lists.
- The structure must be supported: no floating blocks except torches/lanterns/signs/banners.
- Include a roof, walls, floor, door opening, and at least a couple of windows.
- Stay strictly within the provided dimensions; the builder will reject anything that overflows.
- Plans should be 50-2000 blocks total; keep it tractable for a small bot crew to build.
- DO NOT add ornament beyond two named facade features.
- Output ONLY a JSON object. No prose, no markdown fences, no commentary.

Response schema:
{
  "kind": "<kind echoed back>",
  "style": "<style preset id>",
  "dimensions": { "w": <int>, "h": <int>, "d": <int> },
  "blocks": [
    { "x": 0, "y": 0, "z": 0, "name": "oak_planks" },
    ...
  ],
  "notes": "<optional short note>"
}`;

function buildPromptBody(args: {
  town: Town;
  plan: PlanItem;
  styleDoc: StyleDoc | null;
  dimensions: { w: number; h: number; d: number };
  neighbors: NeighborContext;
  previousFailure?: { attempt: number; reasons: string[] };
}): string {
  const { town, plan, styleDoc, dimensions, neighbors, previousFailure } = args;
  const styleSummary = styleDoc
    ? {
        seed_style: styleDoc.seed_style,
        block_palette: styleDoc.block_palette,
        patterns: styleDoc.patterns,
      }
    : { seed_style: town.styleSeed ?? 'medieval-communal', note: 'no style.json on disk, use the preset defaults' };

  const neighborSummary = neighbors.neighbors
    .filter((n) => n.origin != null)
    .map((n) => ({
      kind: n.kind,
      name: n.name,
      origin: n.origin,
      size: n.width && n.height && n.depth ? { w: n.width, h: n.height, d: n.depth } : null,
    }))
    .slice(0, 12);

  const body: any = {
    town: { id: town.id, name: town.name, tier: town.tier },
    request: {
      kind: plan.kind,
      schematic_query: plan.schematicQuery,
      count_wanted: plan.count,
      required: plan.required,
    },
    style: styleSummary,
    dimensions,
    neighbors: neighborSummary,
  };

  if (previousFailure) {
    body.previous_attempt = {
      attempt: previousFailure.attempt,
      validator_failures: previousFailure.reasons,
      instruction:
        'Your previous response failed validation. Fix every listed issue. Stay within dimensions; ensure every block has a neighbor, the ground, or is a torch/sign/lantern.',
    };
  }

  return [
    `Design a "${plan.kind}" for the town. Footprint ${dimensions.w} (W) x ${dimensions.h} (H) x ${dimensions.d} (D).`,
    `Style preset: ${styleDoc?.seed_style ?? town.styleSeed ?? 'medieval-communal'}.`,
    'Context as JSON follows. Output ONLY the JSON plan in the response.',
    '',
    JSON.stringify(body, null, 2),
  ].join('\n');
}

/** Wrap a promise in a hard timeout so the brain tick stays bounded. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Token-cost ledger entry returned alongside the plan so callers can apply a
 * daily-budget gate. Tokens come from the LLMClient response when present.
 */
export interface DesignerCost {
  inputTokens: number;
  outputTokens: number;
  /** Rough USD estimate using $3/M-input + $15/M-output (Claude Sonnet ballpark). */
  estUsd: number;
}

export interface DesignResult {
  plan: BlockPlan;
  cost: DesignerCost;
  attempts: number;
}

/** Internal: turn raw LLM token counts into the rough USD estimate. */
function estimateUsd(inputTokens: number, outputTokens: number): number {
  // Per-million-token rates ($3 in / $15 out — a generic mid-tier ballpark).
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
}

export class LlmDesigner {
  private readonly llmClient: LLMClient;

  constructor(deps: DesignerDeps) {
    this.llmClient = deps.llmClient;
  }

  /**
   * Design one building. Throws when the LLM repeatedly returns invalid JSON
   * or the client is unavailable — callers must catch and fall back.
   */
  async designBuilding(args: DesignBuildingArgs): Promise<DesignResult> {
    const { town, plan, styleDoc, neighbors } = args;
    const dimensions = dimensionsFor(plan.kind, styleDoc);
    let lastFailure: { attempt: number; reasons: string[] } | undefined;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let attempt = 1; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
      const userMsg = buildPromptBody({
        town,
        plan,
        styleDoc,
        dimensions,
        neighbors,
        previousFailure: lastFailure,
      });

      let response;
      try {
        response = await withTimeout(
          this.llmClient.generate(SYSTEM_PROMPT, userMsg, LLM_MAX_OUTPUT_TOKENS, {
            taskType: 'codegen' as TaskType,
            botName: '',
          }),
          LLM_DESIGN_TIMEOUT_MS,
          'LlmDesigner',
        );
      } catch (err: any) {
        // Disabled / breaker open / network — bail to caller's fallback.
        logger.warn(
          { townId: town.id, kind: plan.kind, attempt, err: err?.message },
          'LlmDesigner: LLM call failed',
        );
        throw err;
      }

      totalInputTokens += response.inputTokens ?? 0;
      totalOutputTokens += response.outputTokens ?? 0;

      const parsed = parseJsonResponse(response.text);
      const candidate = coerceBlockPlan(
        parsed,
        plan.kind,
        styleDoc?.seed_style ?? town.styleSeed ?? 'medieval-communal',
      );
      if (!candidate) {
        lastFailure = {
          attempt,
          reasons: ['response was not parseable JSON matching the BlockPlan schema'],
        };
        logger.warn(
          { townId: town.id, kind: plan.kind, attempt, preview: response.text.slice(0, 200) },
          'LlmDesigner: parse/coerce failed; will retry',
        );
        continue;
      }
      // Force the dimensions field to what we requested — the LLM doesn't get
      // to redraw the bounding box; we asked for a specific footprint.
      candidate.dimensions = dimensions;
      const result = validate(candidate);
      if (result.ok) {
        return {
          plan: candidate,
          cost: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            estUsd: estimateUsd(totalInputTokens, totalOutputTokens),
          },
          attempts: attempt,
        };
      }
      lastFailure = { attempt, reasons: result.reasons ?? ['unknown validation failure'] };
      logger.warn(
        { townId: town.id, kind: plan.kind, attempt, reasons: result.reasons },
        'LlmDesigner: validation failed; will retry',
      );
    }

    throw new Error(
      `LlmDesigner: validation failed after ${MAX_VALIDATION_RETRIES} attempts (last: ${lastFailure?.reasons?.join('; ') ?? 'unknown'})`,
    );
  }
}
