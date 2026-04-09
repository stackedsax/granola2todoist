import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const SUPABASE_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'Granola',
  'supabase.json'
);

export async function getGranolaToken() {
  let raw;
  try {
    raw = await readFile(SUPABASE_PATH, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read Granola auth file at ${SUPABASE_PATH}: ${err.message}`);
  }

  const outer = JSON.parse(raw);
  if (!outer.workos_tokens) {
    throw new Error('No workos_tokens found in supabase.json');
  }

  // workos_tokens is a JSON string, needs second parse
  const tokens = typeof outer.workos_tokens === 'string'
    ? JSON.parse(outer.workos_tokens)
    : outer.workos_tokens;

  const { access_token, expires_in, obtained_at } = tokens;

  if (!access_token) {
    throw new Error('No access_token in workos_tokens');
  }

  const expiresAt = obtained_at + expires_in * 1000;
  if (Date.now() >= expiresAt) {
    throw new Error(
      'Granola access token has expired. Open the Granola app to refresh it, then retry.'
    );
  }

  return access_token;
}
