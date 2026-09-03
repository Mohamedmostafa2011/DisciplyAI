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
