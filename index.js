import { ensureAuthenticated } from './oauth.js';
import { listMeetings, getMeeting, parseMeetingsList, extractActionItems, queryMeetingActionItems } from './granola.js';
import { getProjectId, getOrCreateSection, createTask } from './todoist.js';
import { readState, writeState } from './state.js';
import { buildCalendarProjectMap } from './calendar.js';
import { triggerEnhanceNotes } from './enhance.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

// ── Configuration ──────────────────────────────────────────────────────────
async function getConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(await readFile(join(homedir(), '.granola2todoist-config.json'), 'utf8'));
  } catch {}
  return {
    todoistApiToken: process.env.TODOIST_API_TOKEN ?? cfg.todoistApiToken ?? null,
    personName:       cfg.personName       ?? 'Your Name',
    todoistSection:   cfg.todoistSection   ?? 'Generated Tasks',
    defaultProject:   cfg.defaultProject   ?? null,
    domainProjects:   cfg.domainProjects   ?? {},   // { "@example.com": "ProjectName" }
    calendarToProject: cfg.calendarToProject ?? {},  // { "Calendar Name": "ProjectName" }
  };
}

const CONFIG = await getConfig();
const { todoistApiToken: TODOIST_TOKEN, personName: PERSON_NAME, todoistSection: TODOIST_SECTION } = CONFIG;

function getProjectForMeeting(meeting, calendarProjectMap) {
  const id = meeting.id ?? meeting.meeting_id;

  // Primary: exact ID match from local Granola cache
  if (calendarProjectMap.byId[id]) return calendarProjectMap.byId[id];

  // Secondary: title-based match from historical meetings in cache
  const title = (meeting.title ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (title && calendarProjectMap.byTitle[title]) return calendarProjectMap.byTitle[title];

  // Fallback: domain-based participant routing
  const p = (meeting.participants ?? '').toLowerCase();
  for (const [domain, project] of Object.entries(CONFIG.domainProjects)) {
    if (p.includes(domain)) return project;
  }
  return CONFIG.defaultProject;
}

if (!TODOIST_TOKEN) {
  console.error('ERROR: TODOIST_API_TOKEN environment variable is required');
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getMeetingDate(meeting) {
  // list_meetings returns date as a string like "Mar 19, 2026 11:30 AM"
  return meeting.date ?? null;
}

function getMeetingNotes(meetingDetail) {
  // get_meetings returns XML with a <summary> tag containing markdown notes
  const text = meetingDetail?.content?.[0]?.text ?? '';
  const match = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  return match ? match[1].trim() : '';
}

function buildDescription(meeting) {
  const title = meeting.title ?? meeting.name ?? 'Untitled';
  const date = getMeetingDate(meeting);
  const dateStr = date ? new Date(date).toLocaleDateString('en-US', { dateStyle: 'long' }) : 'Unknown date';
  const id = meeting.id ?? meeting.meeting_id;
  const deepLink = id ? `https://notes.granola.ai/d/${id}` : null;

  let desc = `Meeting: ${title}\nDate: ${dateStr}`;
  if (deepLink) desc += `\n[View in Granola](${deepLink})`;
  return desc;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function run() {
  console.log(`[granola2todoist] Starting run at ${new Date().toISOString()}`);

  const state = await readState();
  console.log(`[granola2todoist] Last processed: ${state.lastProcessedAt}`);
  console.log(`[granola2todoist] Already processed ${state.processedMeetingIds.length} meetings`);

  // 1. Load calendar → project map from local Granola cache
  const calendarProjectMap = await buildCalendarProjectMap(CONFIG.calendarToProject);
  console.log(`[granola2todoist] Calendar map loaded: ${Object.keys(calendarProjectMap.byId).length} meetings, ${Object.keys(calendarProjectMap.byTitle).length} unique titles`);

  // 2. Ensure we have a valid OAuth token (runs browser flow on first run)
  const authProvider = await ensureAuthenticated();

  // 3. List meetings
  const rawList = await listMeetings(authProvider);
  const meetingsData = parseMeetingsList(rawList);

  // Normalise to array
  let meetings = Array.isArray(meetingsData)
    ? meetingsData
    : meetingsData?.meetings ?? meetingsData?.data ?? [];

  console.log(`[granola2todoist] Total meetings from MCP: ${meetings.length}`);

  // 4. Filter to new meetings since lastProcessedAt, plus any pending retries
  const since = new Date(state.lastProcessedAt).getTime();
  const pendingIds = new Set(state.pendingIds ?? []);
  const newMeetings = meetings.filter((m) => {
    const id = m.id ?? m.meeting_id;
    if (pendingIds.has(id)) return true; // always re-check pending meetings
    if (state.processedMeetingIds.includes(id)) return false;
    const dateVal = getMeetingDate(m);
    if (!dateVal) return true; // include if date unknown
    return new Date(dateVal).getTime() > since;
  });

  console.log(`[granola2todoist] New meetings to process: ${newMeetings.length}`);

  if (newMeetings.length === 0) {
    console.log('[granola2todoist] Nothing to do.');
    return;
  }

  // 4. Cache project/section IDs keyed by project name (resolved on first use)
  const todoistCache = {};
  async function getTodoistIds(projectName) {
    if (!todoistCache[projectName]) {
      const projectId = await getProjectId(TODOIST_TOKEN, projectName);
      const sectionId = await getOrCreateSection(TODOIST_TOKEN, projectId, TODOIST_SECTION);
      todoistCache[projectName] = { projectId, sectionId };
      console.log(`[granola2todoist] Todoist ${projectName}: project=${projectId} section=${sectionId}`);
    }
    return todoistCache[projectName];
  }

  let tasksCreated = 0;
  const newlyProcessedIds = [];
  const stillPendingIds = new Set(); // meetings to re-check next run
  let latestDate = new Date(state.lastProcessedAt);

  for (const meeting of newMeetings) {
    const meetingId = meeting.id ?? meeting.meeting_id;
    const title = meeting.title ?? meeting.name ?? 'Untitled';
    console.log(`\n[granola2todoist] Processing: "${title}" (${meetingId})`);

    // 5. Get detailed notes
    let notesText = '';
    try {
      const detail = await getMeeting(authProvider, meetingId);
      notesText = getMeetingNotes(detail);
    } catch (err) {
      console.warn(`[granola2todoist] Failed to get notes for ${meetingId}: ${err.message}`);
    }

    // 6. Extract action items — if the structured summary is empty:
    //    a) trigger Enhance Notes via the Granola API so it generates in the background
    //    b) fall back to querying the transcript directly via natural language
    let actionItems = extractActionItems(notesText, PERSON_NAME);
    if (actionItems.length === 0 && !notesText) {
      console.log(`[granola2todoist]   No summary yet — triggering Enhance Notes & querying transcript`);
      await triggerEnhanceNotes(meetingId);
      try {
        const queryText = await queryMeetingActionItems(authProvider, meetingId, PERSON_NAME);
        // Parse bullets from the free-form response, stripping citation links like [[0]](url)
        actionItems = queryText
          .split('\n')
          .map(l => l.replace(/\[\[\d+\]\]\([^)]*\)/g, '').trim())
          .filter(l => /^[-*•]\s+/.test(l))
          .map(l => l.replace(/^[-*•]\s+/, '').trim())
          .filter(Boolean);
      } catch (err) {
        console.warn(`[granola2todoist]   Query fallback failed: ${err.message}`);
      }
    }
    console.log(`[granola2todoist] Action items found: ${actionItems.length}`);

    // 7. Create Todoist tasks
    const projectName = getProjectForMeeting(meeting, calendarProjectMap);
    const { projectId, sectionId } = await getTodoistIds(projectName);
    const description = buildDescription(meeting);
    for (const item of actionItems) {
      console.log(`[granola2todoist]   Creating task in ${projectName}: ${item}`);
      try {
        await createTask(TODOIST_TOKEN, {
          content: item,
          description,
          projectId,
          sectionId,
        });
        tasksCreated++;
      } catch (err) {
        console.error(`[granola2todoist]   Failed to create task: ${err.message}`);
      }
    }

    // Track state — if 0 items and the meeting is less than 4 hours old,
    // keep it in the pending list so we re-check next run (notes may not be
    // ready yet). Otherwise mark it done.
    const meetingDate = getMeetingDate(meeting);
    const meetingAge = meetingDate ? Date.now() - new Date(meetingDate).getTime() : Infinity;
    if (actionItems.length === 0 && meetingAge < 4 * 60 * 60 * 1000) {
      console.log(`[granola2todoist]   Notes not ready yet — will re-check next run`);
      stillPendingIds.add(meetingId);
    } else {
      newlyProcessedIds.push(meetingId);
      if (meetingDate && new Date(meetingDate) > latestDate) {
        latestDate = new Date(meetingDate);
      }
    }
  }

  // 8. Save state
  await writeState({
    lastProcessedAt: latestDate.toISOString(),
    processedMeetingIds: [...state.processedMeetingIds, ...newlyProcessedIds],
    pendingIds: [...stillPendingIds],
  });

  console.log(`\n[granola2todoist] Done. Tasks created: ${tasksCreated}`);
}

run().catch((err) => {
  console.error('[granola2todoist] Fatal error:', err);
  process.exit(1);
});
