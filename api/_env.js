/**
 * api/_env.js — safe reading of environment variables.
 *
 * Hosting dashboards very often introduce invisible problems when values are
 * pasted: a trailing newline, surrounding quotes, or the whole "KEY=value"
 * line. These silently break API keys, so we normalise them here.
 *
 * No value is ever logged or returned to the browser.
 */

export function cleanEnv(raw, name) {
  if (!raw) return '';
  let v = String(raw).trim();
  if (name && v.toUpperCase().startsWith(name.toUpperCase() + '=')) v = v.slice(name.length + 1).trim();
  v = v.replace(/^['"]|['"]$/g, '').trim();   // surrounding quotes
  v = v.replace(/[\r\n\t]/g, '');             // stray newlines / tabs
  return v;
}

/** Read + clean in one step. */
export const env = (name, fallback = '') => cleanEnv(process.env[name], name) || fallback;

/** Describes a secret's SHAPE for diagnostics — never reveals it. */
export function shape(name) {
  const raw = process.env[name];
  if (!raw) return 'not set';
  const cleaned = cleanEnv(raw, name);
  const notes = [];
  if (raw !== raw.trim()) notes.push('leading/trailing spaces');
  if (/[\r\n]/.test(raw)) notes.push('contains a line break');
  if (/^['"]|['"]$/.test(raw.trim())) notes.push('wrapped in quotes');
  if (raw.trim().toUpperCase().startsWith(name.toUpperCase() + '=')) notes.push(`includes the "${name}=" prefix`);
  if (!cleaned) return 'empty after cleaning';
  return `length ${cleaned.length}, starts "${cleaned.slice(0, 4)}…", ends "…${cleaned.slice(-4)}"`
       + (notes.length ? ` — ⚠️ ${notes.join(', ')} (auto-corrected)` : '');
}

/**
 * Normalises a Notion database ID.
 *
 * Accepts anything a user is likely to paste:
 *   https://notion.so/me/24f8a1b2c3d4805e9f01234567890abc?v=...
 *   https://www.notion.so/Homework-24f8a1b2c3d4805e9f01234567890abc
 *   24f8a1b2-c3d4-805e-9f01-234567890abc
 *   24f8a1b2c3d4805e9f01234567890abc
 * and returns the canonical dashed UUID Notion's REST API expects.
 *
 * Returns '' when no 32-hex-character id can be found.
 */
export function normalizeNotionId(raw) {
  const v = cleanEnv(raw);
  if (!v) return '';

  // Ignore any query string / fragment so ?v=<view-id> is never mistaken for the id.
  const path = v.split(/[?#]/)[0];

  // 1. A properly dashed UUID anywhere in the string wins.
  const dashed = path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (dashed) return toDashed(dashed[0].replace(/-/g, ''));

  // 2. Otherwise take the last run of exactly 32 hex characters that is not
  //    part of a longer word (avoids picking up letters from a page title).
  const runs = path.match(/(?<![0-9a-z])[0-9a-f]{32}(?![0-9a-z])/gi);
  if (runs && runs.length) return toDashed(runs[runs.length - 1]);

  return '';
}

function toDashed(hex) {
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
