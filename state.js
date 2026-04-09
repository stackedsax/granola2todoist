import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const STATE_PATH = join(homedir(), '.granola2todoist-state.json');

const DEFAULT_STATE = () => ({
  lastProcessedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  processedMeetingIds: [],
  pendingIds: [],
});

export async function readState() {
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return DEFAULT_STATE();
  }
}

export async function writeState(state) {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}
