/**
 * api/_notion.js — Notion service layer (SERVER-SIDE ONLY).
 * ===========================================================================
 * The NOTION_TOKEN is read from process.env here and NEVER leaves the server.
 * No token value is ever included in an API response, log line, or error.
 * ===========================================================================
 */
import { DATABASES, SETTINGS, isConfigured } from './_config.js';
import { cleanEnv } from './_env.js';

const NOTION_API = 'https://api.notion.com/v1';

function token() {
  const t = cleanEnv(process.env.NOTION_TOKEN, 'NOTION_TOKEN');
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
      conflict_error: 'Notion had a conflict saving that. Please try again.',
      invalid_request_url: 'Invalid request URL — the database ID is malformed. Paste the full Notion database URL into the NOTION_DB_* variable.',
      invalid_request: 'Notion rejected the request format.',
      invalid_json: 'Notion could not read the request.',
      missing_version: 'The Notion API version header is missing.'
    };
    // Include Notion's own wording for schema problems — it names the exact
    // property that is wrong, which is what the user needs to fix _config.js.
    const detail = (data.message || '').replace(/\s+/g, ' ').slice(0, 260);
    const base = map[data.code] || 'Notion could not complete that request.';
    const err = new Error(
      ['validation_error', 'object_not_found', 'invalid_request_url', 'invalid_request'].includes(data.code) && detail
        ? `${base} Notion says: "${detail}"`
        : base
    );
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
    case 'files':        return (prop.files || []).map((f) => ({
                           name: f.name,
                           url: f.type === 'external' ? f.external?.url : f.file?.url
                         })).filter((f) => f.url);
    case 'relation':     return prop.relation.map((r) => r.id);
    default:             return null;
  }
}

function mapPage(page, dbKey, map) {
  const props = map || DATABASES[dbKey].properties;
  const out = { id: page.id, url: page.url, _db: dbKey };
  for (const [field, p] of Object.entries(props)) {
    out[field] = readProp(page.properties?.[p.name]);
  }
  return out;
}

async function buildProperties(dbKey, data, map) {
  const defs = map || DATABASES[dbKey].properties;
  const props = {};
  for (const [field, p] of Object.entries(defs)) {
    const value = data[field];
    if (value === undefined || value === null || value === '') continue;

    if (p.type === 'relation') {
      // The AI gives us a name; Notion needs page ids.
      const ids = await resolveRelationIds(p.relationDb, value);
      if (ids.length) props[p.name] = { relation: ids.map((id) => ({ id })) };
      continue;
    }
    const built = buildProp(p, value);
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
async function queryDb(dbKey, { filterOpts, sorts, pageSize = SETTINGS.pageSize } = {}) {
  const { id, map } = await resolveSchema(dbKey);
  const body = { page_size: pageSize };

  // A subject filter arrives as a NAME. If Subject is a relation we must turn
  // it into a page id before Notion will accept the filter.
  const opts = { ...(filterOpts || {}) };
  if (opts.subject && map.subject?.type === 'relation') {
    const ids = await resolveRelationIds(map.subject.relationDb, opts.subject, { create: false });
    if (ids.length) opts.subject = ids[0];
    else delete opts.subject;   // unknown subject: don't filter everything away
  }
  const filter = buildFilter(dbKey, map, opts);
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;
  else if (map.dueDate) body.sorts = [{ property: map.dueDate.name, direction: 'ascending' }];

  const data = await notion(`/databases/${id}/query`, { method: 'POST', body });
  const rows = (data.results || []).map((p) => mapPage(p, dbKey, map));

  // Turn relation page-ids back into readable names for the AI.
  if (map.subject?.type === 'relation') {
    const unique = [...new Set(rows.flatMap((r) => r.subject || []))];
    const names = await expandRelationNames(unique);
    const lookup = Object.fromEntries(unique.map((id, i) => [id, names[i]]));
    rows.forEach((r) => {
      if (Array.isArray(r.subject)) r.subject = r.subject.map((id) => lookup[id] || id).join(', ') || null;
    });
  }
  return rows;
}

/** Build a Notion filter for a date range / open-status query. */
function buildFilter(dbKey, map, { from, to, subject, status, includeDone = false } = {}) {
  const def = DATABASES[dbKey];
  const and = [];

  if (map.dueDate && from) and.push({ property: map.dueDate.name, date: { on_or_after: from } });
  if (map.dueDate && to)   and.push({ property: map.dueDate.name, date: { on_or_before: to } });

  if (map.subject && subject && map.subject.type === 'relation') {
    // Resolved by the caller into `subjectIds` — filter on the relation itself.
    const ids = Array.isArray(subject) ? subject : [subject];
    if (ids.length && /^[0-9a-f-]{32,36}$/i.test(String(ids[0]))) {
      and.push({ property: map.subject.name, relation: { contains: String(ids[0]) } });
    }
  } else if (map.subject && subject) {
    const t = map.subject.type;
    const op = t === 'multi_select' ? 'multi_select' : t === 'rich_text' ? 'rich_text' : 'select';
    and.push({ property: map.subject.name, [op]: { contains: subject } });
  }

  if (map.status && map.status.type !== 'checkbox') {
    if (status) and.push({ property: map.status.name, [map.status.type]: { equals: status } });
    else if (!includeDone && def.statusValues?.done) {
      and.push({ property: map.status.name, [map.status.type]: { does_not_equal: def.statusValues.done } });
    }
  } else if (map.status?.type === 'checkbox' && !includeDone) {
    and.push({ property: map.status.name, checkbox: { equals: false } });
  }
  return and.length ? { and } : undefined;
}

/* ------------------------------------------------------------------ */
/* PUBLIC SERVICE LAYER                                                */
/* ------------------------------------------------------------------ */
export const getTasks     = (opts = {}) => queryDb('tasks', { filterOpts: opts });
export const getHomework  = (opts = {}) => queryDb('homework', { filterOpts: opts });

async function createIn(dbKey, data) {
  const { id, map } = await resolveSchema(dbKey);
  const def = DATABASES[dbKey];
  // Only set a status when the column is a select/status with a known value.
  if (!data.status && map.status && map.status.type !== 'checkbox' && def.statusValues?.open) {
    data = { ...data, status: def.statusValues.open };
  }
  let page;
  try {
    page = await notion('/pages', { method: 'POST', body: { parent: { database_id: id }, properties: await buildProperties(dbKey, data, map) } });
  } catch (err) {
    // A rejected status value is the most common validation failure — retry
    // without it rather than losing the student's homework entry.
    if (/status|select/i.test(err.message) && data.status) {
      const { status, ...rest } = data;
      page = await notion('/pages', { method: 'POST', body: { parent: { database_id: id }, properties: await buildProperties(dbKey, rest, map) } });
    } else throw err;
  }
  return expandRow(mapPage(page, dbKey, map), map);
}

async function updateIn(dbKey, pageId, data) {
  const { map } = await resolveSchema(dbKey);
  const page = await notion(`/pages/${pageId}`, { method: 'PATCH', body: { properties: await buildProperties(dbKey, data, map) } });
  return expandRow(mapPage(page, dbKey, map), map);
}

/** Notion has no hard delete via API — pages are archived (moved to Trash). */
async function deleteIn(dbKey, pageId) {
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

/* ------------------------------------------------------------------ */
/* AUTO-DISCOVERY                                                      */
/* ------------------------------------------------------------------ */
/**
 * Finds the databases this integration can see, so the app works even when
 * NOTION_DB_* is missing or malformed. Uses Notion's /search endpoint, which
 * only ever returns pages explicitly shared with the integration.
 *
 * Results are cached for the lifetime of the serverless instance.
 */
let _discovered = null;

export async function discoverDatabases(force = false) {
  if (_discovered && !force) return _discovered;
  const data = await notion('/search', {
    method: 'POST',
    body: { filter: { property: 'object', value: 'database' }, page_size: 100 }
  });
  _discovered = (data.results || []).map((db) => ({
    id: db.id,
    title: (db.title || []).map((t) => t.plain_text).join('').trim() || 'Untitled',
    properties: Object.entries(db.properties || {}).map(([name, p]) => ({ name, type: p.type }))
  }));
  return _discovered;
}

/** Picks the best database for a key ("tasks" / "homework") by name. */
export function matchDatabase(list, key) {
  const want = key.toLowerCase();
  const alt = { homework: ['homework', 'hw', 'assignments', 'assignment'], tasks: ['tasks', 'task', 'to-do', 'todo'] }[want] || [want];
  const scored = list.map((db) => {
    const t = db.title.toLowerCase();
    let s = 0;
    if (t === want) s += 100;
    alt.forEach((a) => { if (t === a) s += 90; else if (t.includes(a)) s += 40; });
    return { db, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.length ? scored[0].db : null;
}

/**
 * Resolves the real database id for a config key, falling back to discovery
 * when the configured id is missing or invalid.
 */
export async function resolveDatabaseId(key) {
  if (isConfigured(key)) return DATABASES[key].id;
  const list = await discoverDatabases();
  const hit = matchDatabase(list, key);
  if (!hit) {
    const names = list.map((d) => `"${d.title}"`).join(', ') || 'none';
    const e = new Error(
      `I couldn't find a "${DATABASES[key]?.label || key}" database in Notion. ` +
      `Databases shared with the integration: ${names}. ` +
      `Either rename one to "${DATABASES[key]?.label || key}", or set NOTION_DB_${key.toUpperCase()} to its URL.`
    );
    e.code = 'NOT_CONFIGURED';
    throw e;
  }
  DATABASES[key].id = hit.id;      // cache for this instance
  return hit.id;
}

/**
 * Auto-maps config fields to REAL Notion columns.
 *
 * `api/_config.js` guesses names like "Name"/"Due Date"/"Status". Real
 * workspaces use "Task", "Deadline", "Done?" etc. Rather than fail, we match
 * by property TYPE plus common aliases, so the app adapts to any schema.
 */
const ALIASES = {
  title:   ['name', 'title', 'task', 'assignment', 'homework', 'item', 'topic'],
  status:  ['status', 'state', 'progress', 'done', 'complete', 'completed'],
  dueDate: ['due date', 'due', 'deadline', 'date', 'due on', 'when'],
  subject: ['subject', 'course', 'class', 'module', 'topic', 'category'],
  notes:   ['notes', 'note', 'details', 'description', 'comment']
};

const _schemaCache = new Map();

export async function resolveSchema(dbKey) {
  if (_schemaCache.has(dbKey)) return _schemaCache.get(dbKey);

  const id = await resolveDatabaseId(dbKey);
  const meta = await notion(`/databases/${id}`);
  const cols = Object.entries(meta.properties || {}).map(([name, p]) => ({ name, type: p.type, raw: p }));
  const def = DATABASES[dbKey];
  const map = {};

  for (const [field, want] of Object.entries(def.properties)) {
    // 1. exact configured name
    let hit = cols.find((c) => c.name === want.name);
    // 2. case-insensitive configured name
    if (!hit) hit = cols.find((c) => c.name.toLowerCase() === want.name.toLowerCase());
    // 3. alias match
    if (!hit) {
      const aliases = ALIASES[field] || [];
      hit = cols.find((c) => aliases.includes(c.name.toLowerCase()))
         || cols.find((c) => aliases.some((a) => c.name.toLowerCase().includes(a)));
    }
    // 4. type-based fallback (title and date are unambiguous)
    if (!hit && field === 'title') hit = cols.find((c) => c.type === 'title');
    if (!hit && field === 'dueDate') hit = cols.find((c) => c.type === 'date');
    if (!hit && field === 'status') hit = cols.find((c) => c.type === 'status')
                                        || cols.find((c) => c.type === 'checkbox');

    if (hit) {
      map[field] = { name: hit.name, type: hit.type };
      // Relations need the target database so we can turn names into page IDs.
      if (hit.type === 'relation') map[field].relationDb = hit.raw?.relation?.database_id || null;
    }
  }

  const resolved = { id, map, columns: cols };
  _schemaCache.set(dbKey, resolved);
  return resolved;
}

/** Replaces relation page-ids on a single row with readable names. */
async function expandRow(row, map) {
  if (map.subject?.type === 'relation' && Array.isArray(row.subject) && row.subject.length) {
    row.subject = (await expandRelationNames(row.subject)).join(', ') || null;
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* RELATION SUPPORT                                                    */
/* ------------------------------------------------------------------ */
/**
 * A Notion relation stores PAGE IDS, but the AI only ever knows a name
 * ("Biology"). This looks up the page in the related database by title and
 * returns its id, creating the page when it genuinely doesn't exist yet.
 */
const _relCache = new Map();   // `${dbId}:${lowercased name}` -> pageId
const _titleProp = new Map();  // dbId -> title column name

async function titlePropertyOf(dbId) {
  if (_titleProp.has(dbId)) return _titleProp.get(dbId);
  const meta = await notion(`/databases/${dbId}`);
  const entry = Object.entries(meta.properties || {}).find(([, p]) => p.type === 'title');
  const name = entry ? entry[0] : 'Name';
  _titleProp.set(dbId, name);
  return name;
}

export async function resolveRelationIds(dbId, value, { create = true } = {}) {
  if (!dbId || value === undefined || value === null || value === '') return [];
  const names = (Array.isArray(value) ? value : [value])
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (!names.length) return [];

  const titleName = await titlePropertyOf(dbId);
  const ids = [];

  for (const name of names) {
    // Already a page id? Pass it straight through.
    if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(name)) {
      ids.push(name);
      continue;
    }
    const key = `${dbId}:${name.toLowerCase()}`;
    if (_relCache.has(key)) { ids.push(_relCache.get(key)); continue; }

    // Exact match first, then a forgiving contains match ("bio" -> "Biology").
    let hit = null;
    try {
      const exact = await notion(`/databases/${dbId}/query`, {
        method: 'POST',
        body: { page_size: 1, filter: { property: titleName, title: { equals: name } } }
      });
      hit = exact.results?.[0] || null;
      if (!hit) {
        const loose = await notion(`/databases/${dbId}/query`, {
          method: 'POST',
          body: { page_size: 5, filter: { property: titleName, title: { contains: name } } }
        });
        hit = loose.results?.[0] || null;
      }
    } catch { /* fall through to create */ }

    if (!hit && create) {
      hit = await notion('/pages', {
        method: 'POST',
        body: {
          parent: { database_id: dbId },
          properties: { [titleName]: { title: [{ text: { content: name } }] } }
        }
      });
    }
    if (hit) { _relCache.set(key, hit.id); ids.push(hit.id); }
  }
  return ids;
}

/** Reads a relation as human names instead of opaque page ids. */
export async function expandRelationNames(ids) {
  const out = [];
  for (const id of (ids || []).slice(0, 10)) {
    try {
      const page = await notion(`/pages/${id}`);
      const tp = Object.values(page.properties || {}).find((p) => p.type === 'title');
      out.push(tp ? tp.title.map((t) => t.plain_text).join('') : id);
    } catch { out.push(id); }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* FILE / RESOURCE LOOKUP                                              */
/* ------------------------------------------------------------------ */
/**
 * Finds the database holding saved files/resources. Matched by name so the
 * student never has to configure an id.
 */
const FILE_DB_ALIASES = ['files', 'file', 'resources', 'resource', 'materials',
                         'material', 'notes', 'documents', 'docs', 'library',
                         'saved', 'attachments', 'past papers', 'papers'];

export async function findFilesDatabase() {
  const list = await discoverDatabases();
  const scored = list.map((db) => {
    const t = db.title.toLowerCase();
    let s = 0;
    FILE_DB_ALIASES.forEach((a) => { if (t === a) s += 100; else if (t.includes(a)) s += 40; });
    // A database with an actual files column is very likely the right one.
    if (db.properties.some((p) => p.type === 'files')) s += 50;
    return { db, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.length ? scored[0].db : null;
}

/**
 * Searches saved files by free text and/or subject and returns direct links.
 *
 * Handles both common layouts:
 *   - a "Files" column holding uploads/external links
 *   - a URL column pointing at the resource
 * Falls back to the page link itself so the student always gets something.
 */
export async function searchFiles({ query = '', subject = '', limit = 10 } = {}) {
  const db = await findFilesDatabase();
  if (!db) {
    const names = (await discoverDatabases()).map((d) => `"${d.title}"`).join(', ') || 'none';
    const e = new Error(
      `I couldn't find a files or resources database in Notion. ` +
      `Databases shared with the integration: ${names}. ` +
      `Share the database holding your files with the integration (••• → Connections).`
    );
    e.code = 'NOT_CONFIGURED';
    throw e;
  }

  const meta = await notion(`/databases/${db.id}`);
  const cols = Object.entries(meta.properties || {}).map(([name, p]) => ({ name, type: p.type, raw: p }));
  const titleCol = cols.find((c) => c.type === 'title');
  const fileCols = cols.filter((c) => c.type === 'files');
  const urlCols  = cols.filter((c) => c.type === 'url');
  const subjCol  = cols.find((c) => /subject|course|class|topic|module/i.test(c.name));

  // Build a filter; keep it forgiving so a near-miss still returns rows.
  const and = [];
  if (query && titleCol) and.push({ property: titleCol.name, title: { contains: query } });
  if (subject && subjCol) {
    if (subjCol.type === 'relation') {
      const ids = await resolveRelationIds(subjCol.raw?.relation?.database_id, subject, { create: false });
      if (ids.length) and.push({ property: subjCol.name, relation: { contains: ids[0] } });
    } else if (subjCol.type === 'multi_select') {
      and.push({ property: subjCol.name, multi_select: { contains: subject } });
    } else if (subjCol.type === 'select') {
      and.push({ property: subjCol.name, select: { equals: subject } });
    } else if (subjCol.type === 'rich_text') {
      and.push({ property: subjCol.name, rich_text: { contains: subject } });
    }
  }

  let results = [];
  const run = async (filter) => {
    const body = { page_size: Math.min(limit, 50) };
    if (filter) body.filter = filter;
    const data = await notion(`/databases/${db.id}/query`, { method: 'POST', body });
    return data.results || [];
  };

  results = await run(and.length ? { and } : undefined);
  // Nothing matched both terms? Retry on subject alone, then title alone.
  if (!results.length && and.length > 1) results = await run(and[and.length - 1]);
  if (!results.length && and.length) results = await run(undefined);

  const out = [];
  for (const page of results.slice(0, limit)) {
    const props = page.properties || {};
    const name = titleCol
      ? (props[titleCol.name]?.title || []).map((t) => t.plain_text).join('') || 'Untitled'
      : 'Untitled';

    const links = [];
    for (const c of fileCols) {
      for (const f of (props[c.name]?.files || [])) {
        const url = f.type === 'external' ? f.external?.url : f.file?.url;
        if (url) links.push({ name: f.name || name, url });
      }
    }
    for (const c of urlCols) if (props[c.name]?.url) links.push({ name, url: props[c.name].url });

    let subjectName = null;
    if (subjCol) {
      const v = readProp(props[subjCol.name]);
      subjectName = Array.isArray(v)
        ? (subjCol.type === 'relation' ? (await expandRelationNames(v)).join(', ') : v.join(', '))
        : v;
    }
    out.push({ name, subject: subjectName, page: page.url, links });
  }
  return { database: db.title, count: out.length, files: out };
}
