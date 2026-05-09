import Anthropic from '@anthropic-ai/sdk';

/**
 * Extract action items from meeting text (transcript or notes) using Claude.
 * Returns a plain string[] of action items assigned to personName or the team.
 */
export async function extractWithClaude(text, personName, apiKey) {
  if (!text?.trim()) return [];

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: 'You extract action items from meeting content. Respond with ONLY a valid JSON array of strings — no explanation, no markdown fences, just the raw array.',
    messages: [
      {
        role: 'user',
        content: `Extract action items from this meeting assigned to ${personName}.

Include:
- Items explicitly assigned to ${personName} by name
- First-person commitments ("I will...", "I'll...") when context suggests ${personName} is the speaker
- Items assigned to everyone, the team, or with no specific assignee

Exclude items assigned to other specific named people.

If speakers are labeled "Speaker A" or "Speaker B", use context clues (role, prior statements, first-person commits) to determine if it is ${personName} speaking.

Return a JSON array of concise action item strings. Each item should be a clear task in plain English. If there are no action items, return [].

Meeting content:
${text}`,
      },
    ],
  });

  const raw = message.content[0].text.trim();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(s => typeof s === 'string' && s.trim())
      : [];
  } catch {
    // Model occasionally wraps the array in markdown fences — strip and retry
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]).filter(s => typeof s === 'string' && s.trim());
      } catch { /* fall through */ }
    }
    return [];
  }
}
