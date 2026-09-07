/**
 * Swiggy MCP OAuth Token Helper
 *
 * Run this script to obtain a Swiggy access token:
 *   npx tsx scripts/swiggy-auth.ts
 *
 * It will:
 *  1. Register a dynamic client with Swiggy
 *  2. Generate PKCE verifier + challenge
 *  3. Start a local HTTP server on port 9876
 *  4. Open your browser for Swiggy phone+OTP login
 *  5. Catch the redirect, exchange the code for a token
 *  6. Print the token — paste it into .env as SWIGGY_ACCESS_TOKEN
 */

import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';

const SWIGGY_BASE = 'https://mcp.swiggy.com';
const LOCAL_PORT = 9876;
const REDIRECT_URI = `http://localhost:${LOCAL_PORT}/callback`;

// ── Step 1: Dynamic Client Registration ──
async function registerClient(): Promise<{ client_id: string }> {
  console.log('\n[1/5] Registering dynamic client with Swiggy...');
  const res = await fetch(`${SWIGGY_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'tivr-whatsapp-bot',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Client registration failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { client_id: string };
  console.log(`      ✓ Client ID: ${data.client_id}`);
  return data;
}

// ── Step 2: Generate PKCE ──
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

// ── Step 3-5: Start local server, open browser, exchange code ──
async function runOAuthFlow(clientId: string): Promise<string> {
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString('hex');

  const authorizeUrl = new URL(`${SWIGGY_BASE}/auth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scope', 'mcp:tools mcp:resources mcp:prompts');

  return new Promise<string>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || '/', `http://localhost:${LOCAL_PORT}`);

      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = reqUrl.searchParams.get('code');
      const returnedState = reqUrl.searchParams.get('state');

      if (!code) {
        res.writeHead(400);
        res.end('Missing authorization code');
        reject(new Error('No code in callback'));
        server.close();
        return;
      }

      if (returnedState !== state) {
        res.writeHead(400);
        res.end('State mismatch — possible CSRF');
        reject(new Error('State mismatch'));
        server.close();
        return;
      }

      console.log('[4/5] Authorization code received. Exchanging for token...');

      try {
        // Exchange code for token
        const tokenRes = await fetch(`${SWIGGY_BASE}/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            code_verifier: codeVerifier,
            redirect_uri: REDIRECT_URI,
            client_id: clientId,
          }),
        });

        if (!tokenRes.ok) {
          const body = await tokenRes.text();
          throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
        }

        const tokenData = (await tokenRes.json()) as {
          access_token: string;
          token_type: string;
          expires_in: number;
          scope: string;
        };

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body style="font-family:system-ui;text-align:center;padding:60px">
            <h1>✅ Swiggy Token Obtained!</h1>
            <p>You can close this tab and go back to the terminal.</p>
          </body></html>
        `);

        server.close();
        resolve(tokenData.access_token);

        const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
        console.log(`[5/5] ✅ Token received!`);
        console.log(`      Token type: ${tokenData.token_type}`);
        console.log(`      Scope: ${tokenData.scope}`);
        console.log(`      Expires: ${expiresAt.toLocaleString()} (~${Math.round(tokenData.expires_in / 86400)} days)`);
      } catch (err) {
        res.writeHead(500);
        res.end('Token exchange failed');
        reject(err);
        server.close();
      }
    });

    server.listen(LOCAL_PORT, () => {
      console.log(`[2/5] PKCE generated. Local callback server started on port ${LOCAL_PORT}.`);
      console.log(`[3/5] Opening browser for Swiggy login...\n`);
      console.log(`      If the browser doesn't open, visit this URL manually:\n`);
      console.log(`      ${authorizeUrl.toString()}\n`);

      // Try to open the browser
      const openCmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      import('node:child_process').then(({ exec }) => {
        exec(`${openCmd} "${authorizeUrl.toString()}"`);
      });
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      reject(new Error('Timed out waiting for OAuth callback (5 minutes)'));
      server.close();
    }, 5 * 60 * 1000);
  });
}

// ── Main ──
async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║    Swiggy MCP — OAuth Token Helper            ║');
  console.log('╚════════════════════════════════════════════════╝');

  try {
    const { client_id } = await registerClient();
    const accessToken = await runOAuthFlow(client_id);

    console.log('\n════════════════════════════════════════════════');
    console.log('  Copy this token and paste it into your .env:');
    console.log('════════════════════════════════════════════════\n');
    console.log(`SWIGGY_ACCESS_TOKEN=${accessToken}\n`);
    console.log('════════════════════════════════════════════════');
    console.log('  Then restart the bot: npm run dev');
    console.log('════════════════════════════════════════════════\n');
  } catch (err: any) {
    console.error('\n❌ OAuth flow failed:', err.message);
    process.exit(1);
  }
}

main();
