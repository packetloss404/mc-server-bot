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

  if (lower.includes('follow me')) return { command: 'follow', args: '' };
  if (lower.includes('stay here') || lower.includes('stop following')) return { command: 'stay', args: '' };

  return null;
}

// Extract [TASK: ...] tag from LLM response
export function extractTask(response: string): { cleanText: string; taskDescription: string | null } {
  const match = response.match(/\[TASK:\s*(.+?)\]\s*$/);
  if (match) {
    return {
      cleanText: response.replace(/\n?\[TASK:\s*.+?\]\s*$/, '').trim(),
      taskDescription: match[1].trim(),
    };
  }
  return { cleanText: response, taskDescription: null };
}
