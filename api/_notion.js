/**
 * api/_notion.js — Notion service layer (SERVER-SIDE ONLY).
 * ===========================================================================
 * The NOTION_TOKEN is read from process.env here and NEVER leaves the server.
 * No token value is ever included in an API response, log line, or error.
 * ===========================================================================
 */
import { DATABASES, SETTINGS, isConfigured } from './_config.js';

const NOTION_API = 'https://api.notion.com/v1';

function token() {
  const t = process.env.NOTION_TOKEN;
  if (!t) {
    const e = new Error('Notion is not configured on the server.');
    e.code = 'NO_TOKEN';
    throw e;
  }
  return t;
}

async function notion(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,        // server-side only
      'Notion-Version': SETTINGS.notionVersion,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Map Notion errors to safe, user-facing messages. Never leak internals.
    const map = {
      unauthorized: 'The Notion integration token is invalid or was revoked.',
      restricted_resource: 'This integration does not have access to that database.',
      object_not_found: 'That Notion database or page could not be found. Check the ID and that the integration is shared with it.',
      validation_error: 'A property name or value did not match your Notion database schema.',
      rate_limited: 'Notion is rate-limiting requests. Please try again in a moment.',
      conflict_error: 'Notion had a conflict saving that. Please try again.'
    };
    const err = new Error(map[data.code] || 'Notion could not complete that request.');
    err.code = data.code || 'notion_error';
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Property helpers                                                    */
/* ------------------------------------------------------------------ */
function buildProp(def, value) {
  if (value === undefined || value === null || value === '') return null;
  switch (def.type) {
    case 'title':        return { title: [{ text: { content: String(value).slice(0, 2000) } }] };
    case 'rich_text':    return { rich_text: [{ text: { content: String(value).slice(0, 2000) } }] };
    case 'select':       return { select: { name: String(value) } };
    case 'status':       return { status: { name: String(value) } };
    case 'multi_select': return { multi_select: (Array.isArray(value) ? value : [value]).map((n) => ({ name: String(n) })) };
    case 'date':         return { date: { start: String(value) } };
    case 'checkbox':     return { checkbox: !!value };
    case 'number':       return { number: Number(value) };
    case 'url':          return { url: String(value) };
    case 'relation':     return { relation: (Array.isArray(value) ? value : [value]).map((id) => ({ id })) };
    default:             return null;
  }
}

function readProp(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':        return prop.title.map((t) => t.plain_text).join('');
    case 'rich_text':    return prop.rich_text.map((t) => t.plain_text).join('');
    case 'select':       return prop.select?.name || null;
    case 'status':       return prop.status?.name || null;
    case 'multi_select': return prop.multi_select.map((s) => s.name);
    case 'date':         return prop.date?.start || null;
    case 'checkbox':     return prop.checkbox;
    case 'number':       return prop.number;
    case 'url':          return prop.url;
    case 'formula':      return prop.formula?.string ?? prop.formula?.number ?? prop.formula?.date?.start ?? null;
    case 'people':       return prop.people.map((p) => p.name);
    case 'relation':     return prop.relation.map((r) => r.id);
    default:             return null;
  }
}

function mapPage(page, dbKey) {
  const def = DATABASES[dbKey];
  const out = { id: page.id, url: page.url, _db: dbKey };
  for (const [field, p] of Object.entries(def.properties)) {
    out[field] = readProp(page.properties?.[p.name]);
  }
  return out;
}

function buildProperties(dbKey, data) {
  const def = DATABASES[dbKey];
  const props = {};
  for (const [field, p] of Object.entries(def.properties)) {
    const built = buildProp(p, data[field]);
    if (built) props[p.name] = built;
  }
  return props;
}

function assertConfigured(dbKey) {
  if (!isConfigured(dbKey)) {
    const e = new Error(`The "${DATABASES[dbKey]?.label || dbKey}" database is not configured yet. Add its ID in api/_config.js or as an environment variable.`);
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Generic query                                                       */
/* ------------------------------------------------------------------ */
async function queryDb(dbKey, { filter, sorts, pageSize = SETTINGS.pageSize } = {}) {
  assertConfigured(dbKey);
  const def = DATABASES[dbKey];
  const body = { page_size: pageSize };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;
  else if (def.properties.dueDate) body.sorts = [{ property: def.properties.dueDate.name, direction: 'ascending' }];

  const data = await notion(`/databases/${def.id}/query`, { method: 'POST', body });
  return (data.results || []).map((p) => mapPage(p, dbKey));
}

/** Build a Notion filter for a date range / open-status query. */
function buildFilter(dbKey, { from, to, subject, status, includeDone = false } = {}) {
  const def = DATABASES[dbKey];
  const and = [];
  const dueName = def.properties.dueDate?.name;
  const subjName = def.properties.subject?.name;
  const statusDef = def.properties.status;

  if (dueName && from) and.push({ property: dueName, date: { on_or_after: from } });
  if (dueName && to)   and.push({ property: dueName, date: { on_or_before: to } });
  if (subjName && subject) {
    const t = def.properties.subject.type;
    and.push(t === 'relation'
      ? { property: subjName, relation: { is_not_empty: true } }
      : { property: subjName, [t === 'multi_select' ? 'multi_select' : 'select']: { contains: subject } });
  }
  if (statusDef && status) {
    and.push({ property: statusDef.name, [statusDef.type]: { equals: status } });
  } else if (statusDef && !includeDone && def.statusValues?.done) {
    and.push({ property: statusDef.name, [statusDef.type]: { does_not_equal: def.statusValues.done } });
  }
  return and.length ? { and } : undefined;
}

/* ------------------------------------------------------------------ */
/* PUBLIC SERVICE LAYER                                                */
/* ------------------------------------------------------------------ */
export const getTasks     = (opts = {}) => queryDb('tasks', { filter: buildFilter('tasks', opts) });
export const getHomework  = (opts = {}) => queryDb('homework', { filter: buildFilter('homework', opts) });

async function createIn(dbKey, data) {
  assertConfigured(dbKey);
  const def = DATABASES[dbKey];
  if (!data.status && def.statusValues?.open && def.properties.status) data.status = def.statusValues.open;
  const page = await notion('/pages', {
    method: 'POST',
    body: { parent: { database_id: def.id }, properties: buildProperties(dbKey, data) }
  });
  return mapPage(page, dbKey);
}

async function updateIn(dbKey, pageId, data) {
  assertConfigured(dbKey);
  const page = await notion(`/pages/${pageId}`, {
    method: 'PATCH',
    body: { properties: buildProperties(dbKey, data) }
  });
  return mapPage(page, dbKey);
}

/** Notion has no hard delete via API — pages are archived (moved to Trash). */
async function deleteIn(dbKey, pageId) {
  assertConfigured(dbKey);
  await notion(`/pages/${pageId}`, { method: 'PATCH', body: { archived: true } });
  return { id: pageId, deleted: true };
}

export const createTask     = (d) => createIn('tasks', d);
export const createHomework = (d) => createIn('homework', d);
export const updateTask     = (id, d) => updateIn('tasks', id, d);
export const updateHomework = (id, d) => updateIn('homework', id, d);
export const deleteTask     = (id) => deleteIn('tasks', id);
export const deleteHomework = (id) => deleteIn('homework', id);

/** Find the single best-matching page for an update/delete request. */
export async function findPage(dbKey, { query, subject }) {
  const items = dbKey === 'homework' ? await getHomework({ includeDone: true }) : await getTasks({ includeDone: true });
  const q = String(query || '').toLowerCase();
  const scored = items.map((i) => {
    let s = 0;
    const title = String(i.title || '').toLowerCase();
    if (title === q) s += 10;
    if (q && title.includes(q)) s += 5;
    q.split(/\W+/).filter((w) => w.length > 3).forEach((w) => { if (title.includes(w)) s += 2; });
    if (subject && i.subject && String(i.subject).toLowerCase() === String(subject).toLowerCase()) s += 3;
    return { i, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);

  if (!scored.length) return { match: null, candidates: [] };
  const ambiguous = scored.length > 1 && scored[0].s === scored[1].s;
  return { match: ambiguous ? null : scored[0].i, candidates: scored.slice(0, 5).map((x) => x.i) };
}

/** Lightweight connectivity check used by /api/notion?action=status. */
export async function status() {
  const me = await notion('/users/me');
  return { ok: true, workspace: me?.bot?.workspace_name || me?.name || 'Notion workspace' };
}
