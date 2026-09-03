/**
 * POST /api/auth  { action: 'login' | 'logout', password? }
 * GET  /api/auth?action=session
 *
 * The password NEVER leaves the server boundary and is never logged.
 */
import { checkPassword, createSessionCookie, clearSessionCookie, readSession } from './_auth.js';

const json = (res, code, body, cookie) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const s = readSession(req);
      return s ? json(res, 200, { ok: true, expiresAt: s.exp }) : json(res, 401, { error: 'No active session.' });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');

    if (body.action === 'logout') return json(res, 200, { ok: true }, clearSessionCookie());

    // --- login -------------------------------------------------------
    const result = checkPassword(body.password);
    if (result.reason === 'NOT_CONFIGURED') {
      return json(res, 500, { error: 'Authentication is not configured on the server. Set DISCIPLAY_PASSWORD.' });
    }
    if (!result.ok) {
      await new Promise((r) => setTimeout(r, 450)); // slow down brute-force attempts
      return json(res, 401, { error: 'Incorrect password. Please try again.' });
    }
    const { cookie, expiresAt } = createSessionCookie();
    return json(res, 200, { ok: true, mode: 'server', expiresAt }, cookie);
  } catch {
    return json(res, 500, { error: 'Authentication failed. Please try again.' });
  }
}
