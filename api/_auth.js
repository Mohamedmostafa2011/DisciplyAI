/**
 * api/_auth.js — server-side session helpers.
 *
 * The password is compared against process.env.DISCIPLAY_PASSWORD using a
 * timing-safe comparison. The plaintext password is never logged or stored.
 * The session is an HMAC-signed, HttpOnly cookie — unreadable by JavaScript.
 */
import crypto from 'node:crypto';

const COOKIE = 'disciplay_session';
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function secret() {
  // SESSION_SECRET is recommended; we derive a fallback so the app still works.
  return process.env.SESSION_SECRET || crypto.createHash('sha256')
    .update(String(process.env.DISCIPLAY_PASSWORD || 'disciplay-dev-secret'))
    .digest('hex');
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(value) {
  if (!value || !value.includes('.')) return null;
  const [body, mac] = value.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

export function checkPassword(input) {
  const expected = process.env.DISCIPLAY_PASSWORD;
  if (!expected) return { ok: false, reason: 'NOT_CONFIGURED' };
  const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return { ok: crypto.timingSafeEqual(a, b) };
}

export function createSessionCookie() {
  const exp = Date.now() + TTL_MS;
  const value = sign({ sub: 'disciplay-user', iat: Date.now(), exp });
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  return {
    cookie: `${COOKIE}=${value}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${Math.floor(TTL_MS / 1000)}`,
    expiresAt: exp
  };
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }).filter(([k]) => k));
}

/** Returns the session payload or null. */
export function readSession(req) {
  const cookies = parseCookies(req.headers?.cookie || '');
  return verify(cookies[COOKIE]);
}

/** Guard for protected endpoints. Returns true when the request may proceed. */
export function requireAuth(req, res) {
  if (readSession(req)) return true;
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Your session expired. Please sign in again.' }));
  return false;
}
