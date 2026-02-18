import { Client, OAuth2, type OAuth2Token } from '@xdevplatform/xdk';
import { loadConfig } from '../config.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

const TOKENS_PATH = join(homedir(), '.x-recon', 'tokens.json');
const SCOPES = ['bookmark.read', 'tweet.read', 'users.read', 'offline.access'];

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // unix ms
}

// --- Token persistence ---

export function loadTokens(): StoredTokens | null {
  if (!existsSync(TOKENS_PATH)) return null;
  try {
    const raw = readFileSync(TOKENS_PATH, 'utf-8');
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: StoredTokens): void {
  mkdirSync(dirname(TOKENS_PATH), { recursive: true });
  writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
}

// --- OAuth2 client ---

let _userClient: Client | null = null;
let _userId: string | null = null;

function createOAuth2(): OAuth2 {
  const config = loadConfig();
  if (!config.X_API_CLIENT_ID) {
    throw new Error('X_API_CLIENT_ID is required for OAuth 2.0');
  }
  return new OAuth2({
    clientId: config.X_API_CLIENT_ID,
    clientSecret: config.X_API_CLIENT_SECRET,
    redirectUri: 'http://localhost:3000/callback',
    scope: SCOPES,
  });
}

/**
 * Get or create an OAuth2-authenticated Client.
 * Loads stored tokens from disk, refreshes if expired.
 * Returns null if no tokens are available (user hasn't authorized yet).
 */
export async function getUserClient(): Promise<Client | null> {
  if (_userClient) return _userClient;

  const stored = loadTokens();
  if (!stored) return null;

  const config = loadConfig();
  if (!config.X_API_CLIENT_ID) return null;

  // Check if token is expired
  const now = Date.now();
  if (stored.expires_at && stored.expires_at < now && stored.refresh_token) {
    // Refresh the token
    try {
      const oauth2 = createOAuth2();
      const refreshed = await oauth2.refreshToken(stored.refresh_token);
      const newTokens: StoredTokens = {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? stored.refresh_token,
        expires_at: now + (refreshed.expires_in ?? 7200) * 1000,
      };
      saveTokens(newTokens);
      _userClient = new Client({ accessToken: newTokens.access_token });
      return _userClient;
    } catch (err) {
      console.error('[x-recon] Token refresh failed:', err);
      return null;
    }
  }

  _userClient = new Client({ accessToken: stored.access_token });
  return _userClient;
}

/**
 * Get the authenticated user's ID (cached).
 */
export async function getAuthUserId(): Promise<string> {
  if (_userId) return _userId;

  const client = await getUserClient();
  if (!client) throw new Error('No OAuth 2.0 user client available');

  const me = await client.users.getMe();
  if (!me.data) throw new Error('Failed to get authenticated user');
  _userId = (me.data as any).id;
  return _userId!;
}

/**
 * Check whether OAuth 2.0 user auth is available.
 */
export function hasOAuthTokens(): boolean {
  return loadTokens() !== null;
}

export { createOAuth2, SCOPES, TOKENS_PATH };
