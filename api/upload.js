/**
 * api/upload.js — receive a file from the browser and file it in Notion.
 *
 * Vercel serverless functions cap the request body at 4.5 MB, so the frontend
 * blocks anything larger before sending. Notion's own single-part cap is 20 MB.
 */

import { readSession } from './_auth.js';
import * as Notion from './_notion.js';

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 4 * 1024 * 1024; // stay safely under Vercel's 4.5 MB

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooBig = false;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BYTES + 512 * 1024) {
        // Keep draining so we can still send a clean 413 instead of a dropped
        // connection, but stop buffering the payload.
        tooBig = true;
        chunks.length = 0;
        return;
      }
      if (!tooBig) chunks.push(c);
    });
    req.on('end', () => (tooBig ? reject(new Error('TOO_LARGE')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

/** Minimal multipart/form-data parser — no dependencies. */
function parseMultipart(buf, boundary) {
  const out = { fields: {}, file: null };
  const delim = Buffer.from(`--${boundary}`);
  let pos = 0;

  while (pos < buf.length) {
    const start = buf.indexOf(delim, pos);
    if (start === -1) break;
    const partStart = start + delim.length;
    if (buf.slice(partStart, partStart + 2).toString() === '--') break; // final boundary
    const headEnd = buf.indexOf('\r\n\r\n', partStart);
    if (headEnd === -1) break;

    const head = buf.slice(partStart, headEnd).toString('utf8');
    const next = buf.indexOf(delim, headEnd);
    const body = buf.slice(headEnd + 4, (next === -1 ? buf.length : next) - 2);

    const nameM = /name="([^"]*)"/i.exec(head);
    const fileM = /filename="([^"]*)"/i.exec(head);
    const typeM = /Content-Type:\s*([^\r\n]+)/i.exec(head);

    if (fileM && fileM[1]) {
      out.file = {
        filename: fileM[1],
        contentType: (typeM ? typeM[1] : 'application/octet-stream').trim(),
        buffer: body
      };
    } else if (nameM) {
      out.fields[nameM[1]] = body.toString('utf8');
    }
    pos = next === -1 ? buf.length : next;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed.' });
  if (!readSession(req)) return json(res, 401, { ok: false, error: 'Your session expired. Please sign in again.' });

  try {
    const ctype = req.headers['content-type'] || '';
    const bM = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
    if (!ctype.includes('multipart/form-data') || !bM) {
      return json(res, 400, { ok: false, error: 'Expected a file upload.' });
    }

    let raw;
    try { raw = await readBody(req); }
    catch { return json(res, 413, { ok: false, error: 'That file is too large. The limit is 4 MB.' }); }

    const { fields, file } = parseMultipart(raw, (bM[1] || bM[2]).trim());
    if (!file || !file.buffer.length) return json(res, 400, { ok: false, error: 'No file received.' });
    if (file.buffer.length > MAX_BYTES) {
      return json(res, 413, { ok: false, error: 'That file is too large. The limit is 4 MB.' });
    }

    const saved = await Notion.saveFile({
      filename: file.filename,
      contentType: file.contentType,
      buffer: file.buffer,
      subject: (fields.subject || '').trim(),
      title: (fields.title || '').trim()
    });

    return json(res, 200, { ok: true, file: saved });
  } catch (err) {
    const msg = String(err?.message || 'Upload failed.');
    return json(res, 400, { ok: false, error: msg.replace(/ntn_[A-Za-z0-9]+/g, '***') });
  }
}
