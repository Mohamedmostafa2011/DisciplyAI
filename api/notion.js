/**
 * GET /api/notion?action=status | databases
 * Protected: requires a valid Disciplay session cookie.
 */
import { requireAuth } from './_auth.js';
import { configuredDatabases } from './_config.js';
import * as Notion from './_notion.js';

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || 'status';

  try {
    if (action === 'databases') {
      return json(res, 200, { ok: true, databases: configuredDatabases() });
    }
    if (!process.env.NOTION_TOKEN) {
      return json(res, 200, { ok: false, error: 'Notion is not configured on the server.' });
    }
    const s = await Notion.status();
    return json(res, 200, { ...s, databases: configuredDatabases().length });
  } catch (err) {
    // Safe message only — never a token, env var, or stack trace.
    return json(res, 200, { ok: false, error: err.message || 'Could not reach Notion.' });
  }
}
