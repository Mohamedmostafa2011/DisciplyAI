/**
 * GET /api/diagnose — safe self-test.
 *
 * Actually calls Notion and the AI provider and reports which step fails.
 * Returns ONLY booleans and short status text — never a token, key, or value
 * of any environment variable.
 *
 * Requires a valid session (log in first), so it isn't public.
 */
import { requireAuth } from './_auth.js';
import { DATABASES, isConfigured } from './_config.js';
import { cleanEnv, shape, normalizeNotionId } from './_env.js';
import { detectProvider } from './_provider.js';

const scrub = (m) => String(m || '')
  .replace(/(gsk_|sk-|ntn_|secret_)[A-Za-z0-9_-]+/g, '***')
  .replace(/Bearer\s+\S+/gi, 'Bearer ***')
  .slice(0, 240);

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  /* ---------- 0. Which deployment is this? ---------- */
  const vEnv = process.env.VERCEL_ENV || 'self-hosted';
  add('Deployment environment', true,
      `${vEnv}${vEnv === 'preview' ? ' ⚠️ PREVIEW — variables scoped only to "Production" are NOT available here. Use your main domain, or tick Preview for each variable.' : ''}`);

  /* ---------- 1. Environment variables present? ---------- */
  add('DISCIPLAY_PASSWORD set', !!process.env.DISCIPLAY_PASSWORD);
  add('SESSION_SECRET set', !!process.env.SESSION_SECRET,
      process.env.SESSION_SECRET ? '' : 'Optional but recommended.');
  add('NOTION_TOKEN set', !!process.env.NOTION_TOKEN);
  add('AI_API_KEY set', !!cleanEnv(process.env.AI_API_KEY, 'AI_API_KEY'));

  const aiKey = cleanEnv(process.env.AI_API_KEY, 'AI_API_KEY');
  const model = cleanEnv(process.env.AI_MODEL, 'AI_MODEL') || 'openai/gpt-oss-120b';
  const base = (cleanEnv(process.env.AI_BASE_URL, 'AI_BASE_URL') || 'https://api.groq.com/openai/v1').replace(/\/$/, '');

  add('AI_API_KEY shape', !!aiKey, shape('AI_API_KEY'));

  // Which provider does this key actually belong to?
  if (aiKey) {
    const p = detectProvider(aiKey, base);
    add('Provider detected from key', p.id !== 'custom',
        p.id === 'custom'
          ? `Unrecognised key prefix "${aiKey.slice(0, 5)}…". Grok keys start "xai-", Groq keys start "gsk_".`
          : `${p.name} → ${p.base}` + (p.autoRouted ? ` ⚠️ AI_BASE_URL said something else; the app now auto-routes to ${p.base}.` : ''));
  }
  add('AI provider', true, `${base} · model "${model}"`);

  /* ---------- 2. Database IDs ---------- */
  for (const [key, db] of Object.entries(DATABASES)) {
    const varName = `NOTION_DB_${key.toUpperCase()}`;
    const rawVal = cleanEnv(process.env[varName], varName);
    const ok = isConfigured(key);
    add(`${db.label} database ID`, ok,
        ok
          ? `${db.id} ✓`
          : rawVal
            ? `❌ "${rawVal.slice(0, 60)}" is not a valid Notion ID. It must contain 32 hex characters. Copy the database URL from Notion and paste the whole thing into ${varName}.`
            : `Not set. Add ${varName}.`);
  }

  /* ---------- 3. Live Notion call ---------- */
  if (process.env.NOTION_TOKEN) {
    try {
      const r = await fetch('https://api.notion.com/v1/users/me', {
        headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' }
      });
      const d = await r.json().catch(() => ({}));
      add('Notion token valid', r.ok, r.ok ? (d?.bot?.workspace_name || 'connected') : scrub(d.message || `HTTP ${r.status}`));
    } catch (e) { add('Notion token valid', false, scrub(e.message)); }

    // What databases can the integration actually see?
    try {
      const { discoverDatabases } = await import('./_notion.js');
      const found = await discoverDatabases(true);
      add('Databases shared with integration', found.length > 0,
          found.length
            ? found.map((d) => `"${d.title}" [${d.properties.map((p) => p.name).join(', ')}]`).join('  |  ')
            : 'None. In Notion open each database → ••• → Connections → add your integration.');
    } catch (e) { add('Databases shared with integration', false, scrub(e.message)); }

    // Show the auto-resolved schema mapping for each key
    for (const key of ['tasks', 'homework']) {
      try {
        const { resolveSchema } = await import('./_notion.js');
        const { id, map } = await resolveSchema(key);
        add(`"${key}" auto-mapping`, true,
            `db ${id.slice(0, 8)}… → ` + Object.entries(map).map(([f, p]) => `${f}="${p.name}"(${p.type})`).join(', '));
      } catch (e) { add(`"${key}" auto-mapping`, false, scrub(e.message)); }
    }

    // Try reading each configured database
    for (const [key, db] of Object.entries(DATABASES)) {
      if (!isConfigured(key)) continue;
      try {
        const r = await fetch(`https://api.notion.com/v1/databases/${db.id}/query`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ page_size: 1 })
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          const cols = Object.keys(d.results?.[0]?.properties || {});
          add(`Read "${db.label}"`, true, cols.length ? `columns: ${cols.join(', ')}` : 'empty database');

          // Do the configured property names actually exist?
          if (cols.length) {
            const missing = Object.entries(db.properties)
              .filter(([, pr]) => !cols.includes(pr.name))
              .map(([field, pr]) => `_config.js "${field}" expects a column named "${pr.name}"`);
            add(`"${db.label}" column names match`, missing.length === 0,
                missing.length
                  ? `❌ MISMATCH. ${missing.join('; ')}. Your Notion columns are: [${cols.join(', ')}]. `
                    + `Edit api/_config.js so each "name" matches one of those exactly (case-sensitive).`
                  : 'All configured columns exist in Notion.');

            // Type check for the ones that do exist
            const typeIssues = [];
            for (const [field, pr] of Object.entries(db.properties)) {
              const actual = d.results?.[0]?.properties?.[pr.name]?.type;
              if (actual && actual !== pr.type) typeIssues.push(`"${pr.name}" is ${actual} in Notion but _config.js says ${pr.type}`);
            }
            if (typeIssues.length) add(`"${db.label}" column types match`, false, typeIssues.join('; '));
          }
        } else {
          add(`Read "${db.label}"`, false,
              d.code === 'object_not_found'
                ? 'Not found — check the ID, and share the database with your integration (••• → Connections).'
                : scrub(d.message || `HTTP ${r.status}`));
        }
      } catch (e) { add(`Read "${db.label}"`, false, scrub(e.message)); }
    }
  }

  /* ---------- 4. Live AI call ---------- */
  if (aiKey) {
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          max_tokens: 5
        })
      });
      const text = await r.text();
      let why = r.ok ? `responded with "${model}"` : scrub(text);
      if (r.status === 401) why = `401 Unauthorized — the key is not accepted by ${base}. Causes: key deleted/regenerated in the Groq console, key belongs to a different provider, or the free account needs email verification. ${scrub(text)}`;
      add('AI key + model valid', r.ok, why);
    } catch (e) { add('AI key + model valid', false, scrub(e.message)); }

    // What models does this provider actually offer right now?
    try {
      const r = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${aiKey}` }
      });
      if (r.ok) {
        const d = await r.json();
        const ids = (d.data || []).map((m) => m.id).sort();
        add('Configured model exists', ids.includes(model),
            ids.includes(model) ? '' : `"${model}" is NOT offered. Available: ${ids.join(', ')}`);
      }
    } catch { /* provider may not expose /models */ }

    // Does the model support tool calling? (this app requires it)
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'What homework is due today?' }],
          max_tokens: 60,
          tools: [{ type: 'function', function: { name: 'get_homework', description: 'Read homework', parameters: { type: 'object', properties: {} } } }],
          tool_choice: 'auto'
        })
      });
      const text = await r.text();
      add('AI model supports tool calling', r.ok, r.ok ? 'yes' : scrub(text));
    } catch (e) { add('AI model supports tool calling', false, scrub(e.message)); }
  }

  const failed = checks.filter((c) => !c.ok);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: failed.length === 0,
    summary: failed.length === 0 ? 'All checks passed.' : `${failed.length} check(s) failed — see below.`,
    firstProblem: failed[0]?.name || null,
    checks
  }, null, 2));
}
