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

const scrub = (m) => String(m || '')
  .replace(/(gsk_|sk-|ntn_|secret_)[A-Za-z0-9_-]+/g, '***')
  .replace(/Bearer\s+\S+/gi, 'Bearer ***')
  .slice(0, 240);

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  /* ---------- 1. Environment variables present? ---------- */
  add('DISCIPLAY_PASSWORD set', !!process.env.DISCIPLAY_PASSWORD);
  add('SESSION_SECRET set', !!process.env.SESSION_SECRET,
      process.env.SESSION_SECRET ? '' : 'Optional but recommended.');
  add('NOTION_TOKEN set', !!process.env.NOTION_TOKEN);
  add('AI_API_KEY set', !!process.env.AI_API_KEY);

  const model = process.env.AI_MODEL || 'openai/gpt-oss-120b';
  const base = (process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  add('AI provider', true, `${base} · model "${model}"`);

  /* ---------- 2. Database IDs ---------- */
  for (const [key, db] of Object.entries(DATABASES)) {
    add(`${db.label} database ID`, isConfigured(key),
        isConfigured(key) ? '' : `Set NOTION_DB_${key === 'fixedCommitments' ? 'COMMITMENTS' : key.toUpperCase()}.`);
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
              .filter(([, p]) => !cols.includes(p.name))
              .map(([field, p]) => `${field} -> "${p.name}"`);
            add(`"${db.label}" column names match`, missing.length === 0,
                missing.length ? `Not found in Notion: ${missing.join(', ')}. Fix api/_config.js.` : '');
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
  if (process.env.AI_API_KEY) {
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
          max_tokens: 5
        })
      });
      const text = await r.text();
      add('AI key + model valid', r.ok, r.ok ? `responded with "${model}"` : scrub(text));
    } catch (e) { add('AI key + model valid', false, scrub(e.message)); }

    // What models does this provider actually offer right now?
    try {
      const r = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${process.env.AI_API_KEY}` }
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
        headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' },
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
