#!/usr/bin/env node
/**
 * One-time CLI script to authorize x-recon with your X account.
 *
 * Usage:
 *   npx tsx src/auth/authorize.ts
 *   # or after build:
 *   node dist/auth/authorize.js
 *
 * Opens your browser to X's authorization page. After you approve,
 * it catches the callback on localhost:3000 and saves your tokens
 * to ~/.x-recon/tokens.json.
 */

import { createServer } from 'http';
import { URL } from 'url';
import {
  OAuth2,
  generateCodeVerifier,
  generateCodeChallenge,
} from '@xdevplatform/xdk';
import { loadConfig } from '../config.js';
import { saveTokens, TOKENS_PATH } from './oauth.js';

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = ['bookmark.read', 'tweet.read', 'users.read', 'offline.access'];

async function main() {
  const config = loadConfig();

  if (!config.X_API_CLIENT_ID) {
    console.error('Error: X_API_CLIENT_ID environment variable is required.');
    console.error('Set it in your .env file or environment.');
    process.exit(1);
  }

  const oauth2 = new OAuth2({
    clientId: config.X_API_CLIENT_ID,
    clientSecret: config.X_API_CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    scope: SCOPES,
  });

  // Generate PKCE parameters
  const state = Math.random().toString(36).substring(2);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  await oauth2.setPkceParameters(codeVerifier, codeChallenge);

  // Get authorization URL
  const authUrl = await oauth2.getAuthorizationUrl(state);

  console.log('\n🔐 x-recon OAuth Authorization\n');
  console.log('Open this URL in your browser:\n');
  console.log(`  ${authUrl}\n`);
  console.log(`Waiting for callback on http://localhost:${PORT}/callback ...\n`);

  // Try to open browser automatically
  try {
    const { exec } = await import('child_process');
    exec(`open "${authUrl}"`);
  } catch {
    // User will manually open the URL
  }

  // Start local callback server
  return new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${PORT}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
        server.close();
        reject(new Error(`Authorization error: ${error}`));
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Invalid callback</h1><p>Missing code or state mismatch.</p>');
        server.close();
        reject(new Error('Invalid callback parameters'));
        return;
      }

      try {
        // Exchange code for tokens
        const tokens = await oauth2.exchangeCode(code, codeVerifier);

        // Save tokens
        saveTokens({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: Date.now() + (tokens.expires_in ?? 7200) * 1000,
        });

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <h1>✅ x-recon authorized!</h1>
          <p>Tokens saved to <code>${TOKENS_PATH}</code></p>
          <p>You can close this window.</p>
        `);

        console.log('✅ Authorization successful!');
        console.log(`   Tokens saved to: ${TOKENS_PATH}`);
        console.log('   Bookmarks and home timeline tools are now available.\n');

        server.close();
        resolve();
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h1>Token exchange failed</h1><p>${err}</p>`);
        server.close();
        reject(err);
      }
    });

    server.listen(PORT, () => {
      // Server is ready, waiting for callback
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      console.error('\n⏰ Authorization timed out after 5 minutes.');
      server.close();
      reject(new Error('Authorization timeout'));
    }, 5 * 60 * 1000);
  });
}

main().catch((err) => {
  console.error('Authorization failed:', err);
  process.exit(1);
});
