/**
 * store.js — localStorage persistence.
 *
 * SECURITY: only chat messages, conversation titles and UI preferences are
 * stored. Never the Notion token, the password, API keys or auth secrets.
 */
import { CONFIG } from './config.js';

const K = CONFIG.STORAGE_KEYS;

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; } // quota / private mode — fail silently
}

/* ------------------------- Preferences ------------------------- */
const DEFAULT_PREFS = { theme: 'system', enterToSend: true, showTimestamps: true, sidebarCollapsed: false };

export const prefs = {
  all: () => ({ ...DEFAULT_PREFS, ...read(K.prefs, {}) }),
  get: (k) => prefs.all()[k],
  set: (k, v) => { const p = prefs.all(); p[k] = v; write(K.prefs, p); return p; }
};

/* --------------------------- Chats ------------------------------ */
export const chats = {
  all: () => read(K.chats, []),
  save: (list) => write(K.chats, list.slice(0, 100)),
  get(id) { return this.all().find((c) => c.id === id) || null; },

  create(title = 'New chat') {
    const list = this.all();
    const chat = { id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    list.unshift(chat);
    this.save(list);
    return chat;
  },

  update(id, patch) {
    const list = this.all();
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: Date.now() };
    const [c] = list.splice(i, 1);
    list.unshift(c);
    this.save(list);
    return c;
  },

  addMessage(id, message) {
    const chat = this.get(id);
    if (!chat) return null;
    const messages = [...chat.messages, message];
    const patch = { messages };
    if (chat.messages.length === 0 && message.role === 'user') {
      patch.title = message.content.replace(/\s+/g, ' ').trim().slice(0, 42) || 'New chat';
    }
    return this.update(id, patch);
  },

  remove(id) { this.save(this.all().filter((c) => c.id !== id)); },
  clear() { write(K.chats, []); }
};

/* -------------------------- Session ----------------------------- */
/** Stores only timestamps — never the password or any secret. */
export const session = {
  start(expiresAt) {
    const data = { issuedAt: Date.now(), expiresAt: expiresAt || Date.now() + CONFIG.SESSION_TTL_MS };
    try { sessionStorage.setItem(K.session, JSON.stringify(data)); } catch {}
    return data;
  },
  active() {
    try {
      const raw = sessionStorage.getItem(K.session);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d?.expiresAt || Date.now() > d.expiresAt) { session.end(); return false; }
      return true;
    } catch { return false; }
  },
  expiresAt() {
    try { return JSON.parse(sessionStorage.getItem(K.session) || '{}').expiresAt || null; } catch { return null; }
  },
  end() { try { sessionStorage.removeItem(K.session); } catch {} }
};
