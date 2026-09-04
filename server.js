/**
 * server.js — zero-dependency local/self-hosted server.
 *
 * Serves the static frontend and routes /api/* to the same handler files that
 * Vercel/Netlify would run, so local development matches production exactly.
 *
 *   node server.js         (reads .env if present)
 *
 * Secrets are read from process.env and NEVER served to the browser.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/* -------- minimal .env loader (no dependencies) -------- */
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2'
};

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  /* ----------------------- API routes ----------------------- */
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
    const file = path.join(__dirname, 'api', `${name}.js`);
    if (!name || name.startsWith('_') || !fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not found.' }));
    }
    try {
      const mod = await import(pathToFileURL(file).href);
      // Multipart uploads must reach the handler as a raw stream.
      const isMultipart = (req.headers['content-type'] || '').includes('multipart/form-data');
      req.body = (req.method === 'POST' && !isMultipart) ? await readBody(req) : {};
      await mod.default(req, res);
      if (!res.writableEnded) res.end();
    } catch (err) {
      console.error('[api error]', err?.message); // message only — never secrets
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error. Your data hasn\'t been changed.' }));
    }
    return;
  }

  /* --------------------- Static files ----------------------- */
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(__dirname, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

  // Never serve secrets or server internals.
  if (/(^|[/\\])(\.env|\.git|node_modules|server\.js|package\.json)/.test(rel) || rel.includes('/api/')) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404</h1><p>Not found.</p>');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Disciplay AI running at http://localhost:${PORT}`);
  console.log(`  Auth   : ${process.env.DISCIPLAY_PASSWORD ? 'server-side (DISCIPLAY_PASSWORD set)' : 'NOT configured — frontend stays in Demo Mode'}`);
  console.log(`  Notion : ${process.env.NOTION_TOKEN ? 'token loaded' : 'no NOTION_TOKEN'}`);
  console.log(`  AI     : ${process.env.AI_API_KEY ? 'key loaded' : 'no AI_API_KEY'}\n`);
});
