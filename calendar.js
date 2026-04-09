/**
 * Reads the local Granola cache to map meeting IDs to Todoist project names
 * via google_calendar_event.calendarId → calendar summary → project.
 *
 * calendarToProject: configured by the caller via config.calendarToProject, e.g.
 *   { "My Calendar": "ProjectName", "Work Calendar": "Work" }
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const CACHE_PATH = join(homedir(), 'Library', 'Application Support', 'Granola', 'cache-v6.json');

function normalizeTitle(title) {
  return (title ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Returns { byId, byTitle } maps built from the local Granola cache.
 *
 * byId:    meetingId → project  (exact, preferred)
 * byTitle: normalised title → project  (fallback for new instances of recurring
 *          meetings not yet synced to the local cache)
 *
 * When a title maps to more than one project across history, the most common
 * one wins (ties broken in favour of the most recently seen).
 */
export async function buildCalendarProjectMap(calendarToProject = {}) {
  let cache;
  try {
    cache = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
  } catch {
    console.warn('[calendar] Could not read Granola cache — falling back to domain routing');
    return { byId: {}, byTitle: {} };
  }

  const state = cache?.cache?.state;
  const documents = state?.documents ?? {};
  const calendars = state?.calendars ?? [];

  // Build calendarId → project map via calendar summary
  const calIdToProject = {};
  for (const cal of calendars) {
    const project = calendarToProject[cal.summary];
    if (project) calIdToProject[cal.id] = project;
  }

  const byId = {};
  // title → { project → count } for majority-vote fallback
  const titleVotes = {};

  for (const [id, doc] of Object.entries(documents)) {
    const calId = doc?.google_calendar_event?.calendarId;
    const project = calIdToProject[calId];
    if (!project) continue;

    byId[id] = project;

    const title = normalizeTitle(doc.title);
    if (title) {
      titleVotes[title] ??= {};
      titleVotes[title][project] = (titleVotes[title][project] ?? 0) + 1;
    }
  }

  // Resolve each title to its most-seen project
  const byTitle = {};
  for (const [title, votes] of Object.entries(titleVotes)) {
    byTitle[title] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  }

  return { byId, byTitle };
}
