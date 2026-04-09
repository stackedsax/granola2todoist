/**
 * OAuth provider for the Granola MCP server.
 *
 * Uses the MCP SDK's built-in OAuthClientProvider interface, which handles:
 *   - Dynamic Client Registration (DCR) — no pre-registered client_id needed
 *   - PKCE authorization code flow
 *   - Token refresh
 *
 * On first run this opens a browser for Granola login and saves the resulting
 * tokens to ~/.granola2todoist-oauth.json. Subsequent runs reuse saved tokens.
 */

import { createServer } from 'http';
import { exec } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';

export const MCP_SERVER_URL = 'https://mcp.granola.ai/mcp';
const STATE_FILE = join(homedir(), '.granola2todoist-oauth.json');
const REDIRECT_PORT = 3333;
const REDIRECT_URL = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

// ── Persisted state helpers ────────────────────────────────────────────────

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function saveState(updates) {
  const current = await loadState();
  await writeFile(STATE_FILE, JSON.stringify({ ...current, ...updates }, null, 2));
}

// ── OAuthClientProvider implementation ────────────────────────────────────

export function createOAuthProvider() {
  return {
    // The local redirect URL the browser will return to after login
    get redirectUrl() {
      return REDIRECT_URL;
    },

    // Metadata sent during Dynamic Client Registration
    get clientMetadata() {
      return {
        client_name: 'granola2todoist',
        redirect_uris: [REDIRECT_URL],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
    },

    // Returns previously registered client info (client_id etc.), or undefined on first run
    async clientInformation() {
      const state = await loadState();
      return state.clientInformation;
    },

    // Saves the client_id returned by DCR so we don't re-register on every run
    async saveClientInformation(info) {
      await saveState({ clientInformation: info });
    },

    // Returns saved access/refresh tokens, or undefined if not yet authenticated
    async tokens() {
      const state = await loadState();
      return state.tokens;
    },

    // Saves tokens to disk after a successful auth exchange or refresh
    async saveTokens(tokens) {
      await saveState({ tokens });
    },

    // Called by auth() when it needs the user to log in — opens the browser
    async redirectToAuthorization(url) {
      console.log('\n[auth] Opening browser for Granola login...');
      console.log(`[auth] If the browser does not open automatically, visit:\n  ${url}\n`);
      exec(`open "${url}"`);
    },

    // Saves the PKCE code verifier so it survives the redirect round-trip
    async saveCodeVerifier(verifier) {
      await saveState({ codeVerifier: verifier });
    },

    // Returns the saved PKCE code verifier for the token exchange step
    async codeVerifier() {
      const state = await loadState();
      return state.codeVerifier;
    },
  };
}

// ── Local callback server ──────────────────────────────────────────────────

/**
 * Starts a temporary HTTP server on localhost that captures the OAuth
 * authorization code from the browser redirect, then shuts itself down.
 */
function waitForCallback() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h2>Authentication complete - you can close this tab.</h2></body></html>');
      server.close();

      if (error) reject(new Error(`OAuth error: ${error}`));
      else if (code) resolve(code);
      else reject(new Error('No authorization code in callback URL'));
    });

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      console.log(`[auth] Waiting for browser callback on port ${REDIRECT_PORT}...`);
    });

    server.on('error', reject);

    // Give the user 2 minutes to complete the browser login
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth timeout: no browser callback received within 2 minutes'));
    }, 120_000);
  });
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Ensures we have a valid Granola MCP token, running the browser OAuth flow
 * if needed. Returns the provider (which the MCP transport uses for auth).
 */
export async function ensureAuthenticated() {
  const provider = createOAuthProvider();

  // First check if we already have valid tokens — no server needed in that case.
  const result = await auth(provider, { serverUrl: MCP_SERVER_URL });

  if (result === 'AUTHORIZED') {
    console.log('[auth] Using saved Granola credentials');
    return provider;
  }

  // result === 'REDIRECT': auth() opened the browser. NOW start the local
  // callback server — the user still needs to click through the browser UI,
  // so there's plenty of time before the redirect arrives.
  const code = await waitForCallback();
  if (!code) throw new Error('Did not receive authorization code from browser');

  const finalResult = await auth(provider, { serverUrl: MCP_SERVER_URL, authorizationCode: code });
  if (finalResult !== 'AUTHORIZED') {
    throw new Error('OAuth flow did not complete successfully');
  }

  console.log('[auth] Successfully authenticated with Granola MCP');
  return provider;
}
