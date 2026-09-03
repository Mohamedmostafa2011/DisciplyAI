/**
 * markdown.js — tiny, dependency-free, XSS-safe Markdown renderer.
 * Everything is escaped first; only our own generated tags survive.
 * Supports: headings, bold, italic, inline code, code blocks, links,
 * bullet/numbered lists, task lists, tables, blockquotes and rules.
 */

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function renderMarkdown(src) {
  const lines = escapeHtml(String(src || '').replace(/\r\n/g, '\n')).split('\n');
  const out = [];
  let i = 0;

  const flushParagraph = (buf) => { if (buf.length) { out.push(`<p>${inline(buf.join(' '))}</p>`); buf.length = 0; } };
  const para = [];

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^\s*```/.test(line)) {
      flushParagraph(para);
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    // table
    if (/\|/.test(line) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || '')) {
      flushParagraph(para);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(
        `<div class="tbl-wrap"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      );
      continue;
    }

    // heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushParagraph(para); const lv = Math.min(h[1].length + 1, 4); out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); i++; continue; }

    // horizontal rule
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { flushParagraph(para); out.push('<hr />'); i++; continue; }

    // blockquote
    if (/^\s*&gt;\s?/.test(line)) {
      flushParagraph(para);
      const buf = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*&gt;\s?/, ''));
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // task list
    if (/^\s*[-*]\s+\[( |x|X)\]\s+/.test(line)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+\[( |x|X)\]\s+/.test(lines[i])) {
        const m = lines[i++].match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
        const done = m[1].toLowerCase() === 'x';
        items.push(`<li><span class="tick${done ? ' done' : ''}" aria-hidden="true">${done ? '✓' : ''}</span><span>${inline(m[2])}</span></li>`);
      }
      out.push(`<ul class="task-list">${items.join('')}</ul>`);
      continue;
    }

    // bullet list
    if (/^\s*[-*•]\s+/.test(line)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*[-*•]\s+/, ''))}</li>`);
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // numbered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // blank line
    if (!line.trim()) { flushParagraph(para); i++; continue; }

    para.push(line.trim());
    i++;
  }
  flushParagraph(para);
  return out.join('');
}
