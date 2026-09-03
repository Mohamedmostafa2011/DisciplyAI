/**
 * api.js — the ONLY module allowed to talk to the network.
 *
 * SECURITY: This file never contains, reads, or transmits the Notion token or
 * the AI API key. Those exist exclusively as server-side environment variables
 * (NOTION_TOKEN, AI_API_KEY). The browser only ever calls our own backend.
 *
 *   Browser -> /api/* (backend) -> Notion API / AI service
 */
import { CONFIG } from './config.js';
import * as Mock from './mock.js';

const state = {
  demo: CONFIG.DEMO_MODE,
  backendAvailable: false,
  authMode: 'prototype'
};

export const isDemo = () => state.demo;
export const authMode = () => state.authMode;
export const setDemo = (v) => { state.demo = !!v; };

async function request(path, { method = 'GET', body, timeout = 25000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${CONFIG.API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', // session cookie is HttpOnly, set by backend
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: 'Invalid server response.' }; }
    if (!res.ok) {
      const err = new Error(data.error || friendlyStatus(res.status));
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error('The request took too long. Please try again.');
    if (e instanceof TypeError) throw new Error("I couldn't reach the Disciplay backend. Your data hasn't been changed.");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function friendlyStatus(s) {
  if (s === 401) return 'Your session expired. Please sign in again.';
  if (s === 403) return 'That action is not permitted.';
  if (s === 404) return 'That endpoint is unavailable.';
  if (s === 429) return 'Too many requests right now. Please wait a moment and try again.';
  if (s >= 500) return "Something went wrong on the server. Your data hasn't been changed.";
  return 'Request failed.';
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

/** Detect whether a real backend is deployed; fall back to demo mode. */
export async function detectBackend() {
  if (!CONFIG.AUTO_DETECT_BACKEND) return { demo: state.demo };
  try {
    const health = await request('/health', { timeout: 6000 });
    state.backendAvailable = true;
    // A backend exists, but stay in Demo Mode until its secrets are configured.
    const ready = health.authMode === 'server' && health.notionConfigured && health.aiConfigured;
    state.demo = !ready;
    state.authMode = ready ? 'server' : 'prototype';
    return { demo: state.demo, health };
  } catch {
    state.backendAvailable = false;
    state.demo = true;
    state.authMode = 'prototype';
    return { demo: true };
  }
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

/**
 * Verify the password.
 * Real mode: POST /api/auth {password} — compared server-side against
 * process.env.DISCIPLAY_PASSWORD, which never reaches the browser.
 */
export async function login(password) {
  if (state.demo) return Mock.login(password);
  return request('/auth', { method: 'POST', body: { action: 'login', password } });
}

export async function verifySession() {
  if (state.demo) return Mock.verifySession();
  return request('/auth?action=session');
}

export async function logout() {
  if (state.demo) return { ok: true };
  try { return await request('/auth', { method: 'POST', body: { action: 'logout' } }); }
  catch { return { ok: true }; }
}

/* ------------------------------------------------------------------ */
/* Notion                                                              */
/* ------------------------------------------------------------------ */

export async function notionStatus() {
  if (state.demo) return Mock.notionStatus();
  return request('/notion?action=status');
}

export async function listDatabases() {
  if (state.demo) return Mock.listDatabases();
  return request('/notion?action=databases');
}

/* ------------------------------------------------------------------ */
/* Chat / AI                                                           */
/* ------------------------------------------------------------------ */

/**
 * Send the conversation to the backend. The backend runs the AI tool-calling
 * loop (AI picks a tool -> backend executes it against Notion -> AI replies).
 *
 * @param {{messages:Array, timezone:string, today:string, confirmedAction?:object}} payload
 * @param {(evt:{type:'tool',name:string,label:string,phase:string})=>void} onEvent
 * @returns {Promise<{reply:string, tools:Array, confirm?:object}>}
 */
export async function sendChat(payload, onEvent) {
  if (state.demo) return Mock.sendChat(payload, onEvent);
  const res = await request('/chat', { method: 'POST', body: payload, timeout: 60000 });
  (res.tools || []).forEach((t) => onEvent?.({ type: 'tool', name: t.name, label: t.label, phase: t.ok ? 'done' : 'fail' }));
  return res;
}
