/**
 * chat.js — conversation state + the send/receive loop.
 */
import { CONFIG } from './config.js';
import * as API from './api.js';
import * as UI from './ui.js';
import { chats, prefs } from './store.js';
import { todayISO } from './dates.js';

let activeId = null;
let busy = false;

export const getActiveId = () => activeId;
export const isBusy = () => busy;

/* ------------------------------------------------------------------ */
/* Conversation lifecycle                                              */
/* ------------------------------------------------------------------ */
export function newChat() {
  activeId = null;
  UI.clearThread();
  UI.showHome(true);
  UI.$('#chat-title').textContent = 'Disciplay AI';
  refreshList();
  UI.$('#input').focus();
}

export function openChat(id) {
  const chat = chats.get(id);
  if (!chat) return newChat();
  activeId = id;
  UI.clearThread();
  UI.showHome(false);
  UI.$('#chat-title').textContent = chat.title;
  chat.messages.forEach((m) => {
    UI.addMessage(m);
    if (m.tools?.length) UI.renderToolSummary(m.tools);
  });
  if (!chat.messages.length) UI.showHome(true);
  refreshList();
  UI.scrollToEnd(false);
}

export function refreshList() {
  UI.renderChatList(chats.all(), activeId, {
    onOpen: (id) => { openChat(id); closeDrawer(); },
    onRename: (c) => {
      const name = prompt('Rename conversation', c.title);
      if (name && name.trim()) {
        chats.update(c.id, { title: name.trim().slice(0, 60) });
        if (c.id === activeId) UI.$('#chat-title').textContent = name.trim();
        refreshList();
      }
    },
    onDelete: (c) => {
      if (!confirm(`Delete "${c.title}"? This only removes the conversation from this browser — your Notion data is unaffected.`)) return;
      chats.remove(c.id);
      if (c.id === activeId) newChat(); else refreshList();
      UI.toast('Conversation deleted');
    }
  });
}

function closeDrawer() {
  document.querySelector('.app')?.classList.remove('drawer-open');
  const s = UI.$('#scrim'); if (s) s.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */
export async function send(text) {
  const content = (text || '').trim();
  if (!content || busy) return;

  if (!activeId) activeId = chats.create().id;

  const userMsg = { role: 'user', content, ts: Date.now() };
  UI.addMessage(userMsg);
  chats.addMessage(activeId, userMsg);
  UI.$('#chat-title').textContent = chats.get(activeId).title;
  refreshList();

  await runTurn();
}

/** Executes one AI turn against the current conversation. */
async function runTurn(confirmedAction = null) {
  busy = true;
  setComposerBusy(true);
  UI.showTyping();

  const chat = chats.get(activeId);
  const payload = {
    messages: (chat?.messages || []).slice(-20).map(({ role, content }) => ({ role, content })),
    timezone: CONFIG.TIMEZONE,
    today: todayISO(),
    confirmedAction: confirmedAction || undefined
  };

  try {
    const res = await API.sendChat(payload, (evt) => {
      if (evt.type === 'tool') UI.toolChip(evt.label, evt.phase);
    });
    UI.hideTyping();

    const aiMsg = { role: 'assistant', content: res.reply || 'Done.', ts: Date.now(), tools: res.tools || [] };
    UI.addMessage(aiMsg);
    if (aiMsg.tools.length) UI.renderToolSummary(aiMsg.tools);
    chats.addMessage(activeId, aiMsg);

    if (res.confirm) askConfirmation(res.confirm);
  } catch (err) {
    UI.hideTyping();
    const msg = {
      role: 'assistant',
      content: safeError(err),
      ts: Date.now(),
      error: true
    };
    UI.addMessage(msg);
    chats.addMessage(activeId, msg);
  } finally {
    busy = false;
    setComposerBusy(false);
    refreshList();
    UI.$('#input').focus();
  }
}

/** Destructive actions always require explicit confirmation. */
function askConfirmation(confirm) {
  UI.addConfirmCard(confirm, {
    onConfirm: async () => { await runTurn({ tool: confirm.tool, target: confirm.target }); },
    onCancel: () => {
      const msg = { role: 'assistant', content: 'Cancelled — nothing was deleted.', ts: Date.now() };
      UI.addMessage(msg);
      chats.addMessage(activeId, msg);
    }
  });
}

/** Never surface tokens, env vars or stack traces to the user. */
function safeError(err) {
  const m = String(err?.message || '');
  const clean = /token|env|api[_ ]key|secret|stack|at .*\.js:/i.test(m)
    ? "Something went wrong while completing that request."
    : m;
  return `${clean || "I couldn't complete that request."}\n\n_Your Notion data hasn't been changed._`;
}

function setComposerBusy(on) {
  const input = UI.$('#input');
  const send = UI.$('#send');
  input.disabled = on;
  send.disabled = on || !input.value.trim();
  input.placeholder = on ? 'Disciplay AI is working…' : 'Type a message…';
}

/* ------------------------------------------------------------------ */
/* Composer wiring                                                     */
/* ------------------------------------------------------------------ */
export function initComposer() {
  const input = UI.$('#input');
  const sendBtn = UI.$('#send');
  const form = UI.$('#composer');

  const sync = () => { UI.autoGrow(input); sendBtn.disabled = busy || !input.value.trim(); };
  input.addEventListener('input', sync);

  input.addEventListener('keydown', (e) => {
    const enterSends = prefs.get('enterToSend');
    if (e.key === 'Enter' && !e.shiftKey && enterSends) {
      e.preventDefault();
      form.requestSubmit();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value;
    if (!text.trim() || busy) return;
    input.value = '';
    sync();
    await send(text);
  });

  sync();
}
