import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCP_SERVER_URL } from './oauth.js';

// Creates an MCP client using the OAuth provider for authentication.
// The provider holds saved tokens; the transport handles refresh automatically.
async function createClient(authProvider) {
  const client = new Client(
    { name: 'granola2todoist', version: '1.0.0' },
    { capabilities: {} }
  );

  const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), {
    authProvider,
  });

  await client.connect(transport);
  return client;
}

/**
 * List all meetings from Granola MCP.
 * Returns raw result — caller should inspect on first run.
 */
export async function listMeetings(authProvider) {
  const client = await createClient(authProvider);
  try {
    const result = await client.callTool({ name: 'list_meetings', arguments: {} });
    console.log('[granola] list_meetings raw result:', JSON.stringify(result, null, 2));
    return result;
  } finally {
    await client.close();
  }
}

/**
 * Get detailed notes for a single meeting by ID.
 * Returns raw result — caller should inspect on first run.
 */
export async function getMeeting(authProvider, meetingId) {
  const client = await createClient(authProvider);
  try {
    const result = await client.callTool({
      name: 'get_meetings',
      arguments: { meeting_ids: [meetingId] },
    });
    console.log(`[granola] get_meetings(${meetingId}) raw result:`, JSON.stringify(result, null, 2));
    return result;
  } finally {
    await client.close();
  }
}

/**
 * Query a specific meeting for action items using natural language.
 * Used as a fallback when get_meetings returns no summary (notes not yet generated).
 * Returns the raw text response from query_granola_meetings.
 */
export async function queryMeetingActionItems(authProvider, meetingId, personName) {
  const client = await createClient(authProvider);
  try {
    const result = await client.callTool({
      name: 'query_granola_meetings',
      arguments: {
        query: `List all action items and next steps from this meeting that are assigned to or involve ${personName}. Format each as a bullet point starting with "- ".`,
        document_ids: [meetingId],
      },
    });
    console.log(`[granola] query_granola_meetings(${meetingId}) raw result:`, JSON.stringify(result, null, 2));
    return result?.content?.[0]?.text ?? '';
  } finally {
    await client.close();
  }
}

/**
 * Fetch the raw transcript for a single meeting by ID.
 * Returns plain text, or empty string if unavailable.
 */
export async function getTranscript(authProvider, meetingId) {
  const client = await createClient(authProvider);
  try {
    const result = await client.callTool({
      name: 'get_meeting_transcript',
      arguments: { meeting_id: meetingId },
    });
    return result?.content?.[0]?.text ?? '';
  } finally {
    await client.close();
  }
}

/**
 * Parse meetings list from MCP tool response.
 *
 * The actual response is XML-like text inside content[0].text, e.g.:
 *   <meeting id="UUID" title="..." date="Mar 19, 2026 11:30 AM">
 *     <known_participants>Alex Scammon <alex@...>, ...</known_participants>
 *   </meeting>
 *
 * Returns an array of plain objects: { id, title, date, participants }
 * where participants is the raw text of the <known_participants> block.
 */
export function parseMeetingsList(result) {
  const text = result?.content?.[0]?.text ?? '';
  const meetings = [];

  // Match each full <meeting ...>...</meeting> block
  const blockRe = /<meeting\s+id="([^"]+)"\s+title="([^"]*)"\s+date="([^"]*)"[^>]*>([\s\S]*?)<\/meeting>/g;
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    const participantsMatch = m[4].match(/<known_participants>([\s\S]*?)<\/known_participants>/i);
    meetings.push({
      id: m[1],
      title: m[2],
      date: m[3],
      participants: participantsMatch ? participantsMatch[1].trim() : '',
    });
  }
  return meetings;
}

/**
 * Extract action items from meeting notes text.
 *
 * Handles two formats:
 *
 * 1. Fireflies-style "Action Items" section with person headers:
 *      ### Action Items
 *      Alex Scammon:
 *      - Do the thing
 *    → returns only items under the matching person's header
 *
 * 2. Granola-style "Next Steps" section with per-line person prefixes:
 *      ### Next Steps
 *      - Alex: Follow up on X
 *      - Alex/Tommy: Schedule session
 *      - Martin: Do something
 *    → returns only items attributed to the given person (or with no attribution)
 *
 * Person attribution patterns recognised:
 *   "Alex: task"          — colon-separated prefix
 *   "Alex/Tommy: task"    — shared task, still included if Alex is one of them
 *   "ISC to do X"         — "to" verb form; ISC treated as equivalent to Alex
 *   "Martin to do X"      — filtered out (not Alex)
 *   "Do the thing"        — no attribution, always included
 */
export function extractActionItems(notesText, personName) {
  if (!notesText || typeof notesText !== 'string') return [];

  const firstName = personName.split(' ')[0]; // "Alex Scammon" → "Alex"

  // Returns true if a colon-prefix string looks like a person name or list of names.
  // Accepts: "Alex", "ISC", "Alex B", "Alex Scammon", "Alex/Tommy", "Amanda & Tim", "Alex, Tim"
  // Rejects: "Target start date", "Licensing research needed", "Leo's timeline"
  function isPersonPrefix(prefix) {
    // Each segment (split by / & ,) must start with a capital letter and contain only letters/spaces
    return /^[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*(?:\s*[/&,]\s*[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)*$/.test(prefix);
  }

  // Returns true if an item belongs to this person (or has no clear attribution).
  function isForPerson(item) {
    // Pattern 1: "Name: task" — detect person prefixes including "Alex B", "Amanda & Tim", etc.
    const colonMatch = item.match(/^([^:]{1,60}):\s+\S/);
    if (colonMatch) {
      const prefix = colonMatch[1].trim();
      if (!isPersonPrefix(prefix)) return true; // non-person phrase → general item, include
      // It's a person prefix — include only if Alex/ISC is one of the named people.
      // Match the full segment ("Alex", "Alex Scammon") not just the first word,
      // so "Alex B" (another person) does NOT match Alex Scammon.
      const names = prefix.split(/\s*[/&,]\s*/);
      return names.some(n => {
        const seg = n.trim();
        return (
          seg.toLowerCase() === firstName.toLowerCase() ||
          seg.toLowerCase() === personName.toLowerCase() ||
          /^isc$/i.test(seg)
        );
      });
    }
    // Pattern 2: "Name to verb…" — "Alex to do X", "ISC to do X", "CJ to do X"
    // Use [a-zA-Z]+ to also catch all-caps names like "CJ", "ISC"
    const toMatch = item.match(/^([A-Z][a-zA-Z]*(?:\/[A-Z][a-zA-Z]*)?)\s+to\s+[a-z]/);
    if (toMatch) {
      const names = toMatch[1].split('/');
      return names.some(
        n => n.toLowerCase() === firstName.toLowerCase() || /^isc$/i.test(n)
      );
    }
    // No attribution detected → general action item, include
    return true;
  }

  // For nested Next Steps: does this bullet text look like a person/group header
  // (standalone name with no task content)?
  function looksLikeNestedHeader(text) {
    // "Name: task" → flat task, not a header
    if (/^[^:]{1,60}:\s+\S/.test(text)) return false;
    // "Name to verb" → flat task, not a header
    if (/^[A-Z][a-zA-Z]*(?:\/[A-Z][a-zA-Z]*)?\s+to\s+[a-z]/.test(text)) return false;
    // Strip trailing parenthetical e.g. "Team (London trip — May)" → "Team"
    const base = text.replace(/\s*\(.*\)$/, '').trim();
    return isPersonPrefix(base) || /^(team|everyone|all|shared|group)$/i.test(base);
  }

  // Should tasks under this nested header be included?
  function isNestedHeaderForMe(headerText) {
    const base = headerText.replace(/\s*\(.*\)$/, '').trim();
    if (/^(team|everyone|all|shared|group)$/i.test(base)) return true;
    const names = base.split(/\s*[/&,]\s*/);
    return names.some(n => {
      const seg = n.trim();
      return (
        seg.toLowerCase() === firstName.toLowerCase() ||
        seg.toLowerCase() === personName.toLowerCase() ||
        /^isc$/i.test(seg)
      );
    });
  }

  const lines = notesText.split('\n');
  let sectionType = null; // 'action_items' | 'next_steps' | null
  let currentPerson = null; // for action_items Fireflies-style
  let nextStepsBaseIndent = -1; // indent of first bullet in next_steps
  let nestedHeaderInclude = null; // null=no nested ctx, true/false=nested ctx
  const items = [];

  // Matches a standalone person-name header line, e.g. "Alex Scammon:" or "**Alex Scammon**"
  const personHeaderRe = /^\*{0,2}([A-Z][a-z]+(?: [A-Z][a-z]+)+)\*{0,2}:?\s*$/;

  for (const raw of lines) {
    const line = raw.trim();

    if (sectionType === null) {
      if (/^#{1,3}\s+action items/i.test(line)) {
        sectionType = 'action_items';
        currentPerson = null;
      } else if (/^#{1,3}\s+next steps/i.test(line)) {
        sectionType = 'next_steps';
      }
      continue;
    }

    // A new section header ends the current section
    if (/^#{1,3} /.test(line)) break;
    if (!line) continue;

    const bulletMatch = line.match(/^[-*•]\s+(.+)/);

    if (sectionType === 'action_items') {
      // Fireflies-style standalone header sets the active person for following bullets
      const personMatch = line.match(personHeaderRe);
      if (personMatch) {
        currentPerson = personMatch[1];
        continue;
      }
      if (bulletMatch) {
        const itemText = bulletMatch[1];
        if (currentPerson !== null) {
          // Fireflies-style: filter by the active section-level person header
          if (currentPerson.toLowerCase() === personName.toLowerCase()) {
            items.push(itemText);
          }
        } else {
          // Granola-style inline "Name: task" — use the same per-line filter as next_steps
          if (isForPerson(itemText)) {
            items.push(itemText);
          }
        }
      }
    } else if (sectionType === 'next_steps') {
      if (!bulletMatch) continue;

      const indent = raw.search(/\S/);
      const text = bulletMatch[1];

      // Record indent of first bullet to identify top-level vs sub-bullets
      if (nextStepsBaseIndent === -1) nextStepsBaseIndent = indent;

      if (indent > nextStepsBaseIndent) {
        // Indented sub-bullet → task under current nested header
        if (nestedHeaderInclude === true) {
          items.push(text);
        }
      } else {
        // Top-level bullet — may be a nested person/group header or a flat task
        if (looksLikeNestedHeader(text)) {
          nestedHeaderInclude = isNestedHeaderForMe(text);
        } else {
          nestedHeaderInclude = null; // reset nested context
          if (isForPerson(text)) {
            items.push(text);
          }
        }
      }
    }
  }

  return items;
}
