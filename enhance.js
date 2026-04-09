/**
 * Triggers Granola's "Enhance Notes" (panel generation) for a meeting via
 * the internal API, using the same auth token Granola stores locally.
 *
 * This is equivalent to clicking the "Enhance Notes" button in the UI.
 * Generation is async server-side — call this when notes are missing, then
 * let the pendingIds retry mechanism pick up results on the next run.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

const GRANOLA_API = 'https://api.granola.ai/v1';
const SUPABASE_PATH = join(homedir(), 'Library', 'Application Support', 'Granola', 'supabase.json');
const TEMPLATE_SLUG = 'meeting-summary-consolidated';

async function getGranolaToken() {
  const raw = JSON.parse(await readFile(SUPABASE_PATH, 'utf8'));
  return JSON.parse(raw.workos_tokens).access_token;
}

async function granolaPost(endpoint, body, token) {
  const res = await fetch(`${GRANOLA_API}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${endpoint} → HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Returns true if the meeting already has a generated (non-empty) panel.
 */
export async function hasPanelContent(meetingId) {
  try {
    const token = await getGranolaToken();
    const panels = await granolaPost('get-document-panels', { document_id: meetingId }, token);
    return Array.isArray(panels) && panels.some(p => p.original_content && p.updated_at);
  } catch {
    return false; // assume not generated if we can't check
  }
}

/**
 * Triggers panel (Enhance Notes) generation for a meeting.
 * Returns true if the request was sent successfully.
 */
export async function triggerEnhanceNotes(meetingId) {
  try {
    const token = await getGranolaToken();
    await granolaPost('create-document-panel', {
      document_id: meetingId,
      id: randomUUID(),
      template_slug: TEMPLATE_SLUG,
    }, token);
    return true;
  } catch (err) {
    console.warn(`[enhance] Failed to trigger notes for ${meetingId}: ${err.message}`);
    return false;
  }
}
