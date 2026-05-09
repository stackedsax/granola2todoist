import Anthropic from '@anthropic-ai/sdk';

const GROUP_ASSIGNEES = new Set(['team', 'everyone', 'all', 'group', 'shared']);

/**
 * Extract action items from meeting text (transcript or notes) using Claude.
 * Returns a plain string[] of action items assigned to personName or the team.
 *
 * Strategy: ask Claude to list ALL action items with assignee (using the
 * participant list to resolve Speaker A/B labels), then filter in code.
 */
export async function extractWithClaude(text, personName, apiKey, { participants = '' } = {}) {
  if (!text?.trim()) return [];

  const firstName = personName.split(' ')[0];
  const client = new Anthropic({ apiKey });

  const participantContext = participants
    ? `\nParticipants in this meeting: ${participants}\n`
    : '';

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: 'You extract action items from meeting content. Respond with ONLY a valid JSON array — no explanation, no markdown fences, just the raw array.',
    messages: [
      {
        role: 'user',
        content: `List every action item from this meeting. For each item, identify who it is assigned to by their first name.
${participantContext}
Return a JSON array of objects:
[{"assignee": "first name or 'Team'", "task": "action item in plain English"}]

Rules:
- Use first names only (e.g. "Alex", not "Alex Scammon")
- Use "Team" for items assigned to everyone, the whole group, or with genuinely no clear owner
- Only include genuine commitments, not discussion points or suggestions
- If speakers are labeled "Speaker A" or "Speaker B", use the participant list and context clues to identify them by name. If you still cannot tell, assign to "Team" rather than leaving as "Speaker A/B"
- Return [] if there are no action items

Meeting content:
${text}`,
      },
    ],
  });

  const raw = message.content[0].text.trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { return []; }
    } else {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(item => {
      if (!item?.assignee || !item?.task) return false;
      const assignee = item.assignee.trim().toLowerCase();
      return (
        assignee === firstName.toLowerCase() ||
        assignee === personName.toLowerCase() ||
        GROUP_ASSIGNEES.has(assignee)
      );
    })
    .map(item => item.task.trim())
    .filter(Boolean);
}
