/**
 * formatRulesForPrompt unit tests (Project Sid P2-B — rule injection).
 *
 * The helper is the pure, testable seam around the resident prompt's
 * standing-rule line. Coverage:
 *   1. Returns '' (no token cost) when governance is disabled.
 *   2. Returns '' when the bot isn't a resident.
 *   3. Returns '' when there are no active rules.
 *   4. Includes the rule text in Sid's exact framing when enabled + resident.
 *   5. Caps the number of rules and orders by priority (highest first).
 *   6. Skips inactive / blank rules.
 */
import { describe, it, expect } from 'vitest';
import { formatRulesForPrompt, MAX_PROMPT_RULES, type TownRule } from '../../src/town/RuleStore';

function rule(text: string, priority = 1, active = true): TownRule {
  return {
    id: `rule-${Math.random().toString(36).slice(2, 8)}`,
    townId: 't1',
    text,
    keywords: [],
    priority,
    active,
    createdAt: Date.now(),
  };
}

describe('formatRulesForPrompt — P2-B prompt injection', () => {
  const rules = [rule('Keep the walls repaired'), rule('Farm wheat daily')];

  it('returns empty when governance is disabled (no token cost)', () => {
    expect(formatRulesForPrompt(rules, false, true)).toBe('');
  });

  it('returns empty when the bot is not a resident', () => {
    expect(formatRulesForPrompt(rules, true, false)).toBe('');
  });

  it('returns empty when there are no active rules', () => {
    expect(formatRulesForPrompt([], true, true)).toBe('');
    expect(formatRulesForPrompt(null, true, true)).toBe('');
    expect(formatRulesForPrompt(undefined, true, true)).toBe('');
  });

  it("includes rule text in Sid's exact framing when enabled + resident", () => {
    const out = formatRulesForPrompt([rule('Keep the walls repaired')], true, true);
    expect(out).toBe("Your town's standing rules: Keep the walls repaired. Consider them when choosing what to do.");
  });

  it('joins multiple rules with a semicolon', () => {
    const out = formatRulesForPrompt(rules, true, true);
    expect(out).toContain("Your town's standing rules:");
    expect(out).toContain('Keep the walls repaired');
    expect(out).toContain('Farm wheat daily');
    expect(out).toContain('. Consider them when choosing what to do.');
  });

  it('caps the number of rules and orders by priority (highest first)', () => {
    const many: TownRule[] = [];
    for (let i = 0; i < MAX_PROMPT_RULES + 3; i++) many.push(rule(`low rule ${i}`, 1));
    const top = rule('TOP PRIORITY RULE', 9);
    const out = formatRulesForPrompt([...many, top], true, true);
    // Highest-priority rule leads the list.
    expect(out).toContain('Your town\'s standing rules: TOP PRIORITY RULE');
    // Only MAX_PROMPT_RULES rules survive the cap → at most that many '; ' joins.
    const ruleCount = out
      .replace("Your town's standing rules: ", '')
      .replace('. Consider them when choosing what to do.', '')
      .split('; ').length;
    expect(ruleCount).toBe(MAX_PROMPT_RULES);
  });

  it('skips inactive and blank rules', () => {
    const out = formatRulesForPrompt(
      [rule('  ', 1, true), rule('inactive one', 5, false), rule('Active visible rule', 1, true)],
      true,
      true,
    );
    expect(out).toContain('Active visible rule');
    expect(out).not.toContain('inactive one');
    // The blank rule contributes nothing.
    expect(out).toBe("Your town's standing rules: Active visible rule. Consider them when choosing what to do.");
  });
});
