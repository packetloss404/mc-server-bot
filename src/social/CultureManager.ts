import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '../util/atomicWrite';
import { logger } from '../util/logger';

/**
 * Project Sid P3-B — "Culture & social spread".
 *
 * A CULTURE LAYER of propagating memes/beliefs that *bias behavior*, not just
 * chat flavor. Sid's most visually compelling result (meme/religion diffusion).
 *
 * A `Meme` is a short labelled belief with a handful of trigger keywords. Memes
 * EMERGE (they are not hand-coded): the manager observes inter-bot / blackboard
 * chat, counts keyword frequency, and promotes a recurring phrase into a meme
 * once it crosses a threshold (cheap, no LLM). An optional bounded periodic LLM
 * extraction can refine candidate labels (see `extractMemesWithLLM`), but the
 * free keyword path is the default so culture works at zero token cost.
 *
 * ADOPTION is per-bot: when a bot hears a meme keyword from a peer it trusts
 * (high bot→bot affinity, P3-A), it adopts the meme. Adoption is tracked
 * per-bot and per-town so `GET /api/culture` can mirror Sid's per-town meme
 * curves.
 *
 * ── Threading ──────────────────────────────────────────────────────────────
 * Each bot runs in its own worker thread. The AUTHORITATIVE culture registry
 * therefore lives in the MAIN thread (owned by BotManager, like AffinityManager)
 * and workers reach it through `CultureProxy` over the existing IPC channel —
 * the same proven cross-worker substrate P3-A uses for affinity. This is what
 * makes a meme observed by bot A actually visible to bot B (and to the API).
 * (The inter-bot MESSAGE BUS is likewise main-thread-authoritative via
 * `BotCommsProxy` → the BotManager-owned `BotComms` relay; SHOULD-FIX #1.)
 *
 * Everything here is gated by the caller on `config.social.culture`; with the
 * flag OFF the worker never wires a CultureProxy, so this class is never
 * touched and there is zero behavior/LLM change.
 *
 * Persistence is a plain JSON file (data/culture.json) via atomicWriteJsonSync,
 * mirroring RuleStore — no schema/migration.
 */

export interface Meme {
  id: string;
  /** Human-readable label, e.g. "eco" or "stay-fed". */
  label: string;
  /** Lowercased trigger keywords; hearing any from a trusted peer adopts it. */
  keywords: string[];
  /** Bot that first seeded/originated the meme (lowercased), or '' if emergent. */
  originBot: string;
  /** 0..1 cultural strength — grows with adoptions, used for behavior-bias weight. */
  strength: number;
  createdAt: number;
}

/** Per-bot adoption record. */
interface Adoption {
  memeId: string;
  bot: string; // lowercased
  town: string; // lowercased town id, or '' when town is unknown
  adoptedAt: number;
}

interface CultureState {
  memes: Meme[];
  adoptions: Adoption[];
  /** Rolling keyword-frequency tally feeding emergence (capped). */
  keywordCounts: Record<string, number>;
}

/** Strength bump per adoption (capped at 1). */
const STRENGTH_PER_ADOPTION = 0.1;

/** Initial strength of a freshly-seeded / freshly-emerged meme. */
const SEED_STRENGTH = 0.2;

/**
 * Keyword observations before a recurring word is promoted to a candidate
 * meme. Deliberately small — at 10 bots a phrase that shows up this many times
 * across inter-bot chat is a real shared idea, not noise.
 */
const EMERGENCE_THRESHOLD = 4;

/** Cap the keyword tally so a long-running process can't grow it unbounded. */
const MAX_KEYWORD_ENTRIES = 500;

/** Cap total memes so the registry (and the prompt seam) stays bounded. */
const MAX_MEMES = 50;

/**
 * Stop-words skipped during emergence keyword counting. Mirrors RuleStore's
 * list — we want content words, not glue words.
 */
const STOP_WORDS = new Set<string>([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'into', 'is', 'it', 'its', 'must', 'no', 'not', 'of', 'on', 'or', 'our',
  'shall', 'should', 'so', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'to', 'up', 'was', 'we', 'were', 'will',
  'with', 'you', 'your', 'all', 'any', 'can', 'do', 'each', 'every', 'if',
  'may', 'more', 'most', 'only', 'who', 'whom', 'whose', 'when', 'where',
  'which', 'while', 'whoever', 'got', 'get', 'now', 'just', 'out', 'one',
  'lets', 'going', 'gonna', 'about', 'over', 'here', 'some', 'what', 'how',
]);

/** Default cap on memes interpolated into a bot's goal prompt (behavior-bias). */
export const MAX_PROMPT_MEMES = 3;

/**
 * Pure helper assembling the single-line meme framing interpolated into a bot's
 * task/goal prompt — the behavior-bias hook that keeps culture from being a
 * chat-only gimmick. Mirrors `formatRulesForPrompt` (P2-B):
 *   - returns '' (no token cost) when `enabled` is false or the bot has adopted
 *     no memes — callers interpolate it blindly, '' adds nothing;
 *   - otherwise one line, strongest memes first, capped at `maxMemes`.
 *
 * @param memes   the bot's adopted memes (already bot-scoped by the caller)
 * @param enabled config.social.culture — false ⇒ '' (no-op)
 * @param maxMemes cap on included memes (default MAX_PROMPT_MEMES)
 */
export function formatCultureForPrompt(
  memes: ReadonlyArray<{ label: string; strength?: number }> | null | undefined,
  enabled: boolean,
  maxMemes: number = MAX_PROMPT_MEMES,
): string {
  if (!enabled) return '';
  if (!memes || memes.length === 0) return '';
  const top = [...memes]
    .filter((m) => m && typeof m.label === 'string' && m.label.trim().length > 0)
    .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))
    .slice(0, Math.max(0, maxMemes))
    .map((m) => m.label.trim());
  if (top.length === 0) return '';
  return `Beliefs you've taken to heart: ${top.join('; ')}. Let them shape what you choose to do.`;
}

export class CultureManager {
  private static instance: CultureManager | null = null;
  private filePath: string;
  private state: CultureState;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'culture.json');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.state = this.load();
  }

  /** Singleton accessor for convenience; the main thread owns the real one. */
  static getInstance(dataDir?: string): CultureManager {
    if (!CultureManager.instance) {
      CultureManager.instance = new CultureManager(dataDir ?? path.join(process.cwd(), 'data'));
    }
    return CultureManager.instance;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Registry
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Register (or seed) a meme. Idempotent on label: re-adding an existing label
   * returns the existing meme (and merges in any new keywords) rather than
   * duplicating. A carrier/influencer bot seeds beliefs through this path.
   */
  addMeme(label: string, keywords: string[], originBot = ''): Meme {
    const cleanLabel = label.trim();
    const cleanKeywords = dedupeLower(keywords);
    const existing = this.state.memes.find(
      (m) => m.label.toLowerCase() === cleanLabel.toLowerCase(),
    );
    if (existing) {
      for (const k of cleanKeywords) {
        if (!existing.keywords.includes(k)) existing.keywords.push(k);
      }
      this.scheduleSave();
      return existing;
    }
    const meme: Meme = {
      id: `meme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: cleanLabel,
      keywords: cleanKeywords.length > 0 ? cleanKeywords : [cleanLabel.toLowerCase()],
      originBot: originBot.toLowerCase(),
      strength: SEED_STRENGTH,
      createdAt: Date.now(),
    };
    this.state.memes.push(meme);
    if (this.state.memes.length > MAX_MEMES) {
      // Drop the weakest meme so the registry stays bounded.
      this.state.memes.sort((a, b) => b.strength - a.strength);
      this.state.memes = this.state.memes.slice(0, MAX_MEMES);
    }
    this.scheduleSave();
    logger.info({ label: cleanLabel, keywords: cleanKeywords, originBot }, 'Culture: meme registered');
    return meme;
  }

  listMemes(): Meme[] {
    return this.state.memes.map((m) => ({ ...m, keywords: [...m.keywords] }));
  }

  getMeme(id: string): Meme | null {
    const m = this.state.memes.find((x) => x.id === id);
    return m ? { ...m, keywords: [...m.keywords] } : null;
  }

  /** Memes a specific bot has adopted, strongest first. */
  getAdoptedMemes(botName: string): Meme[] {
    const key = botName.toLowerCase();
    const ids = new Set(this.state.adoptions.filter((a) => a.bot === key).map((a) => a.memeId));
    return this.state.memes
      .filter((m) => ids.has(m.id))
      .sort((a, b) => b.strength - a.strength)
      .map((m) => ({ ...m, keywords: [...m.keywords] }));
  }

  /**
   * Find the first registered meme whose keyword appears in `text`. Pure
   * keyword scan — NO LLM. Returns null when nothing matches. This is the cheap
   * adoption trigger run on every inter-bot message a bot processes.
   */
  matchMeme(text: string): Meme | null {
    const lower = text.toLowerCase();
    for (const m of this.state.memes) {
      for (const k of m.keywords) {
        if (k && lower.includes(k)) {
          return { ...m, keywords: [...m.keywords] };
        }
      }
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Adoption
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Record that a bot has adopted a meme (idempotent per bot+meme). Bumps the
   * meme's cultural strength — repeated adoption across the fleet makes a meme
   * "stickier" and thus more strongly biasing. Returns true on a NEW adoption.
   */
  adopt(memeId: string, botName: string, townId = ''): boolean {
    const bot = botName.toLowerCase();
    const meme = this.state.memes.find((m) => m.id === memeId);
    if (!meme) return false;
    const already = this.state.adoptions.some((a) => a.memeId === memeId && a.bot === bot);
    if (already) return false;
    this.state.adoptions.push({ memeId, bot, town: townId.toLowerCase(), adoptedAt: Date.now() });
    meme.strength = Math.min(1, meme.strength + STRENGTH_PER_ADOPTION);
    this.scheduleSave();
    logger.info({ meme: meme.label, bot, townId }, 'Culture: meme adopted');
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Emergence (cheap, no LLM)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Feed observed chat text into the keyword-frequency tally and, when a content
   * word crosses EMERGENCE_THRESHOLD, promote it into a fresh emergent meme.
   * Cheap and deterministic — no LLM. Returns the newly-emerged meme, if any.
   *
   * This is how memes EMERGE rather than being hand-coded: a phrase that keeps
   * recurring across the fleet's inter-bot chatter becomes a shared belief.
   */
  observeChat(text: string): Meme | null {
    let emerged: Meme | null = null;
    for (const token of tokenize(text)) {
      // Skip words already covered by an existing meme keyword.
      if (this.state.memes.some((m) => m.keywords.includes(token))) continue;
      const next = (this.state.keywordCounts[token] ?? 0) + 1;
      this.state.keywordCounts[token] = next;
      if (next >= EMERGENCE_THRESHOLD && !emerged) {
        emerged = this.addMeme(token, [token], '');
        delete this.state.keywordCounts[token];
      }
    }
    this.trimKeywordCounts();
    this.scheduleSave();
    return emerged;
  }

  /**
   * Optional BOUNDED LLM refinement. Disabled by default and never called on the
   * hot path — emergence works fully via the free `observeChat` keyword route.
   * Provided so a periodic job can refine emergent labels by reusing
   * ChronicleGenerator's LLM/budget pattern; the caller MUST enforce the budget
   * cap (mirror ChronicleGenerator.isOverBudget) before invoking. Caps response
   * tokens here as a second guard. Failures are swallowed (additive feature).
   */
  async extractMemesWithLLM(
    recentChat: string[],
    llm: { generate: (sys: string, user: string, maxTokens: number, opts?: any) => Promise<{ text: string }> } | null,
    maxResponseTokens = 256,
  ): Promise<Meme[]> {
    if (!llm || recentChat.length === 0) return [];
    const sys =
      'You distill recurring beliefs/slogans from a small group of Minecraft bots into short memes. ' +
      'Output STRICT JSON: an array of at most 3 objects {"label": string (<=4 words), "keywords": string[] (1-4 lowercase words)}. No prose.';
    const user = `Recent inter-bot chatter:\n${recentChat.slice(-40).join('\n')}\n\nDistill the memes:`;
    try {
      const res = await llm.generate(sys, user, maxResponseTokens, { taskType: 'chat' });
      const cleaned = res.text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];
      const out: Meme[] = [];
      for (const cand of parsed.slice(0, 3)) {
        if (cand && typeof cand.label === 'string') {
          const kws = Array.isArray(cand.keywords) ? cand.keywords.map(String) : [];
          out.push(this.addMeme(cand.label, kws, ''));
        }
      }
      return out;
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'Culture: LLM meme extraction failed (ignored)');
      return [];
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Measurement (GET /api/culture)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Aggregate snapshot for the dashboard / `GET /api/culture`. Mirrors Sid's
   * per-town meme curves: meme list (label, strength, adoption count) plus
   * per-town keyword/adoption counts.
   */
  getSummary(): {
    memes: Array<Meme & { adoptionCount: number }>;
    towns: Record<string, { adoptions: number; keywordCounts: Record<string, number> }>;
    totalAdoptions: number;
  } {
    const adoptionCountByMeme: Record<string, number> = {};
    for (const a of this.state.adoptions) {
      adoptionCountByMeme[a.memeId] = (adoptionCountByMeme[a.memeId] ?? 0) + 1;
    }
    const memes = this.state.memes
      .map((m) => ({ ...m, keywords: [...m.keywords], adoptionCount: adoptionCountByMeme[m.id] ?? 0 }))
      .sort((a, b) => b.strength - a.strength);

    const towns: Record<string, { adoptions: number; keywordCounts: Record<string, number> }> = {};
    const memeById = new Map(this.state.memes.map((m) => [m.id, m]));
    for (const a of this.state.adoptions) {
      const town = a.town || '(unaffiliated)';
      if (!towns[town]) towns[town] = { adoptions: 0, keywordCounts: {} };
      towns[town].adoptions += 1;
      const meme = memeById.get(a.memeId);
      if (meme) {
        for (const k of meme.keywords) {
          towns[town].keywordCounts[k] = (towns[town].keywordCounts[k] ?? 0) + 1;
        }
      }
    }
    return { memes, towns, totalAdoptions: this.state.adoptions.length };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Persistence
  // ──────────────────────────────────────────────────────────────────────

  private trimKeywordCounts(): void {
    const entries = Object.entries(this.state.keywordCounts);
    if (entries.length <= MAX_KEYWORD_ENTRIES) return;
    // Keep the highest-count entries; drop the long tail of one-offs.
    entries.sort((a, b) => b[1] - a[1]);
    this.state.keywordCounts = Object.fromEntries(entries.slice(0, MAX_KEYWORD_ENTRIES));
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        atomicWriteJsonSync(this.filePath, this.state);
      } catch (err: any) {
        logger.warn({ err: err?.message, path: this.filePath }, 'Culture: save failed');
      }
    }, 2000);
  }

  shutdown(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      atomicWriteJsonSync(this.filePath, this.state);
    } catch { /* best effort */ }
  }

  private load(): CultureState {
    const empty: CultureState = { memes: [], adoptions: [], keywordCounts: {} };
    if (!fs.existsSync(this.filePath)) return empty;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (!parsed || typeof parsed !== 'object') return empty;
      return {
        memes: Array.isArray(parsed.memes) ? parsed.memes : [],
        adoptions: Array.isArray(parsed.adoptions) ? parsed.adoptions : [],
        keywordCounts:
          parsed.keywordCounts && typeof parsed.keywordCounts === 'object' ? parsed.keywordCounts : {},
      };
    } catch {
      return empty;
    }
  }
}

// ── module-local helpers ────────────────────────────────────────────────────

function dedupeLower(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const t = (w ?? '').toLowerCase().trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function tokenize(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9_]+/)) {
    const token = raw.trim();
    if (token.length < 4) continue;
    if (STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}
