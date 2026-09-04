/**
 * api/_extract.js — ZERO-DEPENDENCY TEXT EXTRACTION
 * ===========================================================================
 * Pulls readable text out of the files the student has saved in Notion so the
 * AI can answer questions about their contents and cite where something is.
 *
 * Supported: PDF (digital text), plain text, Markdown, CSV, HTML, JSON.
 * Scanned/image-only PDFs contain no text layer — we detect that and say so
 * rather than pretending the file was empty.
 *
 * No npm packages: PDF streams are inflated with Node's built-in zlib.
 * ===========================================================================
 */

import zlib from 'node:zlib';

/** Decode the PDF text-showing operators inside a content stream. */
function textFromContentStream(str) {
  let out = '';
  // TJ arrays: [(He)-250(llo)] TJ   and   Tj strings: (Hello) Tj
  const re = /\[((?:[^\[\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*Tj|T\*|\bTd\b|\bTD\b|\bET\b/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m[1] !== undefined) {
      // Pull the parenthesised runs out of the array, honouring kerning gaps.
      const inner = m[1];
      const partRe = /\(((?:[^()\\]|\\.)*)\)|(-?\d+(?:\.\d+)?)/g;
      let p;
      while ((p = partRe.exec(inner)) !== null) {
        if (p[1] !== undefined) out += unescapePdf(p[1]);
        else if (Number(p[2]) < -180) out += ' '; // large negative kern = space
      }
    } else if (m[2] !== undefined) {
      out += unescapePdf(m[2]);
    } else {
      out += m[0] === 'ET' ? '\n' : ' ';
    }
  }
  return out;
}

function unescapePdf(s) {
  return s
    .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1');
}

/**
 * Extracts text from a PDF buffer, one entry per page.
 * Returns { pages: [{ page, text }], scanned: boolean }
 */
export function extractPdf(buf) {
  const raw = buf.toString('latin1');
  const chunks = [];

  // Walk every stream object; inflate when Flate-encoded.
  const re = /stream\r?\n?/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end === -1) continue;
    const header = raw.slice(Math.max(0, m.index - 400), m.index);
    let data = Buffer.from(raw.slice(start, end), 'latin1');

    if (/FlateDecode/.test(header)) {
      try { data = zlib.inflateSync(data); }
      catch { try { data = zlib.inflateRawSync(data); } catch { continue; } }
    } else if (/DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode/.test(header)) {
      continue; // an image, not text
    }
    const s = data.toString('latin1');
    if (/(\)\s*Tj|\]\s*TJ|BT\b)/.test(s)) chunks.push(textFromContentStream(s));
    re.lastIndex = end;
  }

  const pages = chunks
    .map((t, i) => ({ page: i + 1, text: cleanText(t) }))
    .filter((p) => p.text.length > 1);

  const total = pages.reduce((n, p) => n + p.text.length, 0);
  // A PDF with images but almost no text layer is a scan.
  const scanned = total < 40 && /DCTDecode|JPXDecode|CCITTFaxDecode/.test(raw);
  return { pages, scanned };
}

function cleanText(t) {
  return t
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strips tags from an HTML document. */
function htmlToText(s) {
  return cleanText(
    s.replace(/<script[\s\S]*?<\/script>/gi, '')
     .replace(/<style[\s\S]*?<\/style>/gi, '')
     .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
     .replace(/<[^>]+>/g, ' ')
     .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
     .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  );
}

/**
 * Downloads a file and returns readable pages.
 * @returns {{ pages: {page:number,text:string}[], kind: string, scanned?: boolean, note?: string }}
 */
export async function extractFromUrl(url, hintName = '') {
  const res = await fetch(url);
  if (!res.ok) {
    const e = new Error(
      res.status === 403 || res.status === 401
        ? 'That file link has expired. Notion download links are only valid for about an hour — ask me to find the file again.'
        : `I couldn't download that file (HTTP ${res.status}).`
    );
    e.code = 'FILE_FETCH';
    throw e;
  }

  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  const name = (hintName || url).toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());

  const isPdf = ctype.includes('pdf') || name.includes('.pdf') ||
                buf.subarray(0, 5).toString('latin1') === '%PDF-';

  if (isPdf) {
    const { pages, scanned } = extractPdf(buf);
    if (scanned || !pages.length) {
      return {
        pages: [], kind: 'pdf', scanned: true,
        note: 'This PDF has no selectable text — it looks like a scan or photos of pages. I can\'t read its contents, only its title.'
      };
    }
    return { pages, kind: 'pdf' };
  }

  if (/officedocument|msword|\.docx?$|\.pptx?$|\.xlsx?$/.test(ctype + name)) {
    return {
      pages: [], kind: 'office',
      note: 'I can\'t read Word, PowerPoint or Excel files directly yet. Export it to PDF in Notion and I\'ll be able to read it.'
    };
  }
  if (/^image\//.test(ctype) || /\.(png|jpe?g|gif|webp|heic)$/.test(name)) {
    return { pages: [], kind: 'image', note: 'That\'s an image, so there\'s no text for me to read.' };
  }

  let text = buf.toString('utf8');
  let kind = 'text';
  if (ctype.includes('html') || /\.html?$/.test(name)) { text = htmlToText(text); kind = 'html'; }
  else text = cleanText(text);

  if (!text) return { pages: [], kind, note: 'That file appears to be empty.' };

  // Chunk long plain text into ~3000-character "pages" so citations stay useful.
  const pages = [];
  const SIZE = 3000;
  for (let i = 0; i < text.length && pages.length < 40; i += SIZE) {
    pages.push({ page: pages.length + 1, text: text.slice(i, i + SIZE) });
  }
  return { pages, kind };
}

/** Keeps the excerpt inside a sane token budget for the model. */
export function budget(pages, max = 14000) {
  const out = [];
  let used = 0;
  for (const p of pages) {
    if (used >= max) break;
    const room = max - used;
    const text = p.text.length > room ? p.text.slice(0, room) + '…' : p.text;
    out.push({ page: p.page, text });
    used += text.length;
  }
  return { pages: out, truncated: used >= max };
}
