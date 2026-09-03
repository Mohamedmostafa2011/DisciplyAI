/**
 * GET /api/health — public, secret-free readiness probe.
 * Reports only booleans; never any value of any environment variable.
 */
import { configuredDatabases, SETTINGS } from './_config.js';

export default async function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: true,
    service: 'Disciplay AI backend',
    authMode: process.env.DISCIPLAY_PASSWORD ? 'server' : 'unconfigured',
    notionConfigured: !!process.env.NOTION_TOKEN,
    aiConfigured: !!process.env.AI_API_KEY,
    databasesConfigured: configuredDatabases().length,
    timezone: SETTINGS.timezone
  }));
}
