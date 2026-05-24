import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '../util/atomicWrite';

/**
 * Project Sid P2-A — "Governance that bites".
 *
 * A `TownRule` is a STANDING mayor directive (vs. the legacy one-shot
 * blackboard task). Active rules bias resident task selection: when the
 * `governance` config flag is on, `BlackboardManager.scoreTaskEnhanced`
 * boosts tasks whose description/keywords match an active rule for the bot's
 * town.
 *
 * Persistence is a plain JSON file (data/town_rules.json) written via
 * `atomicWriteJsonSync` — deliberately NOT the town SQLite schema, so adding
 * governance needs no migration. The file is keyed by townId.
 */
export interface TownRule {
  id: string;
  townId: string;
  text: string;
  keywords: string[];
  /** Higher = stronger scoring boost. Defaults to 1. */
  priority: number;
  active: boolean;
  createdAt: number;
}

export interface AddRuleOptions {
  /** Override the auto-extracted keywords. */
  keywords?: string[];
  /** Scoring weight (higher = stronger boost). Defaults to 1. */
  priority?: number;
}

interface RuleStoreState {
  /** Rules keyed by townId. */
  rules: Record<string, TownRule[]>;
}

/**
 * Stop-words skipped during keyword extraction. Decree text is free-form
 * mayor prose ("All residents must keep the town walls repaired"); we want
 * the content words (walls, repaired, keep) not the glue words.
 */
const STOP_WORDS = new Set<string>([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'into', 'is', 'it', 'its', 'must', 'no', 'not', 'of', 'on', 'or', 'our',
  'shall', 'should', 'so', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'to', 'up', 'was', 'we', 'were', 'will',
  'with', 'you', 'your', 'all', 'any', 'can', 'do', 'each', 'every', 'if',
  'may', 'more', 'most', 'only', 'who', 'whom', 'whose', 'when', 'where',
  'which', 'while', 'whoever',
]);

/**
 * Extract simple keywords from free-form decree text: lowercase, split on
 * non-word characters, drop stop-words and very short tokens, dedupe.
 * Deterministic and order-preserving so tests can pin the output.
 */
export function extractKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9_]+/)) {
    const token = raw.trim();
    if (token.length < 3) continue;
    if (STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/** Default cap on rules interpolated into a resident prompt (P2-B). */
export const MAX_PROMPT_RULES = 5;

/**
 * Project Sid P2-B — pure helper assembling the single-line standing-rule
 * framing that gets interpolated into a resident's task-proposal prompt.
 * Sid's *entire* governance enforcement model is one interpolated line; we
 * mirror its exact framing.
 *
 * Pure + side-effect-free so it can be unit-tested without spinning a bot:
 *   - returns '' (no token cost) when `enabled` is false, the bot is not a
 *     resident, or there are no active rules — callers interpolate it blindly,
 *     and an empty string adds nothing to the prompt;
 *   - otherwise returns exactly one line, highest-priority rules first, capped
 *     at `maxRules` (default 5) so a runaway rule list can't blow the prompt.
 *
 * @param rules     the bot's active town rules (already town-scoped by caller)
 * @param enabled   config.governance.enabled — false ⇒ '' (no-op)
 * @param isResident true only when the bot is a town resident — non-residents
 *                   get '' so there's zero per-tick token cost for free bots
 * @param maxRules  cap on included rules (default MAX_PROMPT_RULES)
 */
export function formatRulesForPrompt(
  rules: TownRule[] | null | undefined,
  enabled: boolean,
  isResident: boolean,
  maxRules: number = MAX_PROMPT_RULES,
): string {
  if (!enabled || !isResident) return '';
  if (!rules || rules.length === 0) return '';
  const top = [...rules]
    .filter((r) => r && r.active && typeof r.text === 'string' && r.text.trim().length > 0)
    // Highest priority first; stable for equal priorities (preserves caller order).
    .sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1))
    .slice(0, Math.max(0, maxRules))
    .map((r) => r.text.trim());
  if (top.length === 0) return '';
  return `Your town's standing rules: ${top.join('; ')}. Consider them when choosing what to do.`;
}

export class RuleStore {
  private filePath: string;
  private state: RuleStoreState;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'town_rules.json');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.state = this.load();
  }

  /**
   * Persist a new standing rule for a town. Keywords are auto-extracted from
   * the text unless explicitly provided in `opts`.
   */
  addRule(townId: string, text: string, opts?: AddRuleOptions): TownRule {
    const trimmed = text.trim();
    const keywords =
      opts?.keywords && opts.keywords.length > 0
        ? opts.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean)
        : extractKeywords(trimmed);
    const rule: TownRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      townId,
      text: trimmed,
      keywords,
      priority: typeof opts?.priority === 'number' ? opts.priority : 1,
      active: true,
      createdAt: Date.now(),
    };
    if (!this.state.rules[townId]) this.state.rules[townId] = [];
    this.state.rules[townId].push(rule);
    this.persist();
    return rule;
  }

  /**
   * All rules for a town (active and inactive), newest-first. Rules are stored
   * in insertion order, so we reverse for newest-first; this stays stable even
   * when two rules share a `createdAt` millisecond (a naive createdAt sort would
   * flap on ties).
   */
  listRules(townId: string): TownRule[] {
    const rules = this.state.rules[townId] ?? [];
    return [...rules].reverse();
  }

  /** Only the active rules for a town, newest-first. */
  getActiveRules(townId: string): TownRule[] {
    return this.listRules(townId).filter((r) => r.active);
  }

  /**
   * Deactivate a rule by id (across all towns). Returns true when a rule was
   * found and flipped from active→inactive; false otherwise (already inactive
   * or unknown id).
   */
  deactivateRule(id: string): boolean {
    for (const rules of Object.values(this.state.rules)) {
      const rule = rules.find((r) => r.id === id);
      if (rule) {
        if (!rule.active) return false;
        rule.active = false;
        this.persist();
        return true;
      }
    }
    return false;
  }

  private load(): RuleStoreState {
    if (!fs.existsSync(this.filePath)) return { rules: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      const rules =
        parsed && typeof parsed === 'object' && parsed.rules && typeof parsed.rules === 'object'
          ? (parsed.rules as Record<string, TownRule[]>)
          : {};
      return { rules };
    } catch {
      return { rules: {} };
    }
  }

  private persist(): void {
    atomicWriteJsonSync(this.filePath, this.state);
  }
}
