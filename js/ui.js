/**
 * ui.js — all DOM rendering & presentation concerns.
 */
import { CONFIG, SUGGESTIONS } from './config.js';
import { renderMarkdown, escapeHtml } from './markdown.js';
import { prefs } from './store.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ICONS = {
  calendar: '<path d="M7 3v3M17 3v3M3.5 9h17M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  chat: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 2.5V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  pencil: '<path d="M4 20h4L20 8l-4-4L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
};
const svg = (n, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[n] || ''}</svg>`;

const LOGO_MARK = 'assets/logos/logo-icon.png';

export const time = (ts = Date.now()) =>
  new Date(ts).toLocaleTimeString(CONFIG.LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE });

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */
export function applyTheme(mode = prefs.get('theme')) {
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $$('[data-theme-opt]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeOpt === mode)));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (prefs.get('theme') === 'system') applyTheme('system');
});

export function applyPrefs() {
  document.body.classList.toggle('no-ts', !prefs.get('showTimestamps'));
  applyTheme();
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */
export function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; setTimeout(() => el.remove(), 250); }, 3200);
}

/* ------------------------------------------------------------------ */
/* Home screen                                                         */
/* ------------------------------------------------------------------ */
export function renderSuggestions(onPick) {
  const wrap = $('#suggestions');
  wrap.innerHTML = '';
  SUGGESTIONS.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'card';
    b.type = 'button';
    b.innerHTML = `<span class="ic">${svg(s.icon)}</span><span class="tx">${escapeHtml(s.text)}</span>`;
    b.addEventListener('click', () => onPick(s.text));
    wrap.appendChild(b);
  });
}

export function showHome(show) {
  const home = $('#home');
  if (home) home.hidden = !show;
}

/* ------------------------------------------------------------------ */
/* Thread                                                              */
/* ------------------------------------------------------------------ */
function thread() {
  let t = $('#thread');
  if (!t) {
    t = document.createElement('div');
    t.id = 'thread';
    t.className = 'thread';
    $('#messages').appendChild(t);
  }
  return t;
}

export function clearThread() {
  const t = $('#thread');
  if (t) t.remove();
}

export function scrollToEnd(smooth = true) {
  const m = $('#messages');
  m.scrollTo({ top: m.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

export function addMessage({ role, content, ts = Date.now(), error = false }) {
  showHome(false);
  const el = document.createElement('article');
  el.className = `msg ${role === 'user' ? 'user' : 'ai'}${error ? ' error' : ''}`;
  const avatar = role === 'user'
    ? '<div class="ai-mark" aria-hidden="true">You</div>'
    : `<div class="ai-mark" aria-hidden="true"><img src="${LOGO_MARK}" alt="" /></div>`;
  el.innerHTML = `${avatar}
    <div class="bubble-col">
      <div class="bubble">${role === 'user' ? `<p>${escapeHtml(content).replace(/\n/g, '<br />')}</p>` : renderMarkdown(content)}</div>
      <time class="stamp">${role === 'user' ? 'You' : 'Disciplay AI'} · ${time(ts)}</time>
    </div>`;
  thread().appendChild(el);
  scrollToEnd();
  return el;
}

/* Typing indicator ------------------------------------------------- */
export function showTyping() {
  hideTyping();
  const el = document.createElement('article');
  el.className = 'msg ai';
  el.id = 'typing';
  el.innerHTML = `<div class="ai-mark" aria-hidden="true"><img src="${LOGO_MARK}" alt="" /></div>
    <div class="bubble-col">
      <div class="bubble typing" role="status" aria-label="Disciplay AI is thinking"><i></i><i></i><i></i></div>
      <div class="tool-log" id="tool-log"></div>
    </div>`;
  thread().appendChild(el);
  scrollToEnd();
  return el;
}
export function hideTyping() { $('#typing')?.remove(); }

/** Tool execution status chip shown while the AI works. */
export function toolChip(label, phase = 'start') {
  const log = $('#tool-log');
  if (!log) return;
  const prev = log.lastElementChild;
  if (prev && prev.dataset.phase === 'start') {
    prev.dataset.phase = 'done';
    prev.classList.add('ok');
    prev.innerHTML = `<span aria-hidden="true">✓</span> ${escapeHtml(prev.dataset.raw || 'Done')}`;
  }
  if (phase === 'done' && !label) return;
  const chip = document.createElement('div');
  chip.className = `tool-chip${phase === 'fail' ? ' fail' : phase === 'done' ? ' ok' : ''}`;
  chip.dataset.phase = phase;
  chip.dataset.raw = label;
  chip.innerHTML = phase === 'start'
    ? `<span class="sp" aria-hidden="true"></span> ${escapeHtml(label)}`
    : `<span aria-hidden="true">${phase === 'fail' ? '!' : '✓'}</span> ${escapeHtml(label)}`;
  log.appendChild(chip);
  scrollToEnd();
}

/** Persisted (non-transient) tool summary attached under an AI message. */
export function renderToolSummary(tools = []) {
  if (!tools.length) return;
  const log = document.createElement('div');
  log.className = 'tool-log';
  tools.forEach((t) => {
    const c = document.createElement('div');
    c.className = `tool-chip ${t.ok === false ? 'fail' : 'ok'}`;
    c.innerHTML = `<span aria-hidden="true">${t.ok === false ? '!' : '✓'}</span> ${escapeHtml(t.label || t.name)}`;
    log.appendChild(c);
  });
  thread().appendChild(log);
}

/* Inline confirmation card for destructive actions ------------------ */
export function addConfirmCard(confirm, { onConfirm, onCancel }) {
  const el = document.createElement('article');
  el.className = 'msg ai';
  el.innerHTML = `<div class="ai-mark" aria-hidden="true"><img src="${LOGO_MARK}" alt="" /></div>
    <div class="bubble-col">
      <div class="confirm-card" role="group" aria-label="Confirm deletion">
        <h4>${escapeHtml(confirm.message || 'Are you sure you want to delete this?')}</h4>
        <div class="target">${escapeHtml([confirm.target?.subject, confirm.target?.title].filter(Boolean).join(' — '))}</div>
        <div class="acts">
          <button class="btn btn-ghost" data-act="cancel">Cancel</button>
          <button class="btn btn-danger" data-act="delete">Delete</button>
        </div>
      </div>
    </div>`;
  thread().appendChild(el);
  scrollToEnd();
  const lock = () => $$('button', el).forEach((b) => { b.disabled = true; b.style.opacity = '.55'; });
  $('[data-act="delete"]', el).addEventListener('click', () => { lock(); onConfirm(); });
  $('[data-act="cancel"]', el).addEventListener('click', () => { lock(); onCancel(); });
  return el;
}

/* ------------------------------------------------------------------ */
/* Sidebar chat list                                                   */
/* ------------------------------------------------------------------ */
function groupOf(ts) {
  const d = new Date(ts), n = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(n) - day(d)) / 86400000;
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff <= 7) return 'Previous 7 days';
  return 'Older';
}

export function renderChatList(list, activeId, handlers) {
  const nav = $('#chat-list');
  nav.innerHTML = '';
  if (!list.length) {
    nav.innerHTML = '<p class="chat-empty"><strong>No conversations yet.</strong><br />Start a new chat to begin.</p>';
    return;
  }
  let currentGroup = '';
  list.forEach((c) => {
    const g = groupOf(c.updatedAt || c.createdAt);
    if (g !== currentGroup) {
      currentGroup = g;
      const h = document.createElement('div');
      h.className = 'chat-group-label';
      h.textContent = g;
      nav.appendChild(h);
    }
    const row = document.createElement('div');
    row.className = `chat-item${c.id === activeId ? ' active' : ''}`;
    row.innerHTML = `
      <button class="chat-item-name" title="${escapeHtml(c.title)}">${svg('chat', 15)} ${escapeHtml(c.title)}</button>
      <span class="chat-item-acts">
        <button class="mini-btn ren" aria-label="Rename chat">${svg('pencil', 14)}</button>
        <button class="mini-btn del" aria-label="Delete chat">${svg('trash', 14)}</button>
      </span>`;
    $('.chat-item-name', row).addEventListener('click', () => handlers.onOpen(c.id));
    $('.ren', row).addEventListener('click', (e) => { e.stopPropagation(); handlers.onRename(c); });
    $('.del', row).addEventListener('click', (e) => { e.stopPropagation(); handlers.onDelete(c); });
    nav.appendChild(row);
  });
}

/* ------------------------------------------------------------------ */
/* Status / modals                                                     */
/* ------------------------------------------------------------------ */
export function setNotionStatus(state, text) {
  const el = $('#notion-status');
  el.className = `conn conn-${state}`;
  $('.conn-text', el).textContent = text;
}

export function openModal(sel) {
  const m = $(sel);
  m.hidden = false;
  m.querySelector('input,button,select,textarea')?.focus();
  document.body.style.overflow = 'hidden';
}
export function closeModal(sel) {
  $(sel).hidden = true;
  document.body.style.overflow = '';
}

export function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 190) + 'px';
}
