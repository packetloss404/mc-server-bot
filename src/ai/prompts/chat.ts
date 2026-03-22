// Keyword-based sentiment analysis (replaces LLM sentiment call)
const NEGATIVE_WORDS = ['hate', 'stupid', 'ugly', 'die', 'kill', 'worst', 'terrible', 'idiot', 'dumb', 'suck'];
const POSITIVE_WORDS = ['love', 'great', 'awesome', 'thanks', 'friend', 'cool', 'best', 'nice', 'good', 'amazing'];

export function analyzeSentiment(message: string): 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' {
  const lower = message.toLowerCase();
  const negScore = NEGATIVE_WORDS.filter((w) => lower.includes(w)).length;
  const posScore = POSITIVE_WORDS.filter((w) => lower.includes(w)).length;

  if (negScore > posScore) return 'NEGATIVE';
  if (posScore > negScore) return 'POSITIVE';
  return 'NEUTRAL';
}

// Detect special direct commands in chat (simple primitives only — complex actions go through Voyager)
export function parseCommand(message: string): { command: string; args: string } | null {
  const lower = message.toLowerCase().trim();

  // Require commands at the start of message or as the whole message to avoid false positives
  if (/^follow me\b/i.test(lower)) return { command: 'follow', args: '' };
  if (/^stay here\b/i.test(lower) || /^stop following\b/i.test(lower)) return { command: 'stay', args: '' };
  if (/^list (?:schematics|builds)\b/i.test(lower)) return { command: 'list-schematics', args: '' };

  // "build <filename>" command
  const buildMatch = lower.match(/^build\s+(\S+\.(?:schem|schematic))(?:\s|$)/);
  if (buildMatch) return { command: 'build-schematic', args: buildMatch[1] };

  return null;
}

// Extract >>>TASK / >>>GOAL tags from LLM response (also handles legacy [TASK:] format)
export function extractTask(response: string): { cleanText: string; taskDescription: string | null; goalDescription: string | null } {
  const goalMatch = response.match(/\n?>>>GOAL:\s*(.+?)\s*$/);
  if (goalMatch) {
    return {
      cleanText: response.replace(/\n?>>>GOAL:\s*.+?\s*$/, '').trim(),
      taskDescription: null,
      goalDescription: goalMatch[1].trim(),
    };
  }
  // New format: >>>TASK: description
  const newMatch = response.match(/\n?>>>TASK:\s*(.+?)\s*$/);
  if (newMatch) {
    return {
      cleanText: response.replace(/\n?>>>TASK:\s*.+?\s*$/, '').trim(),
      taskDescription: newMatch[1].trim(),
      goalDescription: null,
    };
  }
  // Legacy format: [TASK: description]
  const oldMatch = response.match(/\n?\[TASK:\s*(.+?)\]\s*$/);
  if (oldMatch) {
    return {
      cleanText: response.replace(/\n?\[TASK:\s*.+?\]\s*$/, '').trim(),
      taskDescription: oldMatch[1].trim(),
      goalDescription: null,
    };
  }
  return { cleanText: response, taskDescription: null, goalDescription: null };
}
