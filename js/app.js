/**
 * app.js — bootstrap & global wiring for Disciplay AI.
 */
import { CONFIG } from './config.js';
import * as API from './api.js';
import * as UI from './ui.js';
import { $, $$ } from './ui.js';
import { initAuth, restoreSession, unlock, doLogout, watchSession } from './auth.js';
import * as Chat from './chat.js';
import { prefs, chats, session } from './store.js';

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
(async function boot() {
  UI.applyPrefs();
  UI.renderSuggestions((text) => { Chat.send(text); });
  initAuth(onAuthenticated);
  wireGlobalUI();
  watchSession();

  // Detect whether a real backend is deployed (falls back to Demo Mode).
  await API.detectBackend();
  reflectMode();

  if (await restoreSession()) unlock();
  else setTimeout(() => $('#password')?.focus(), 120);
})();

function reflectMode() {
  const demo = API.isDemo();
  $('#mode-badge').hidden = !demo;
  const badge = $('#login-mode-badge');
  badge.textContent = demo ? 'Demo Mode · prototype authentication' : 'Secure server authentication';
  badge.className = demo ? 'badge badge-demo' : 'badge badge-muted';
  $('#set-auth-mode').textContent = demo ? 'Prototype (demo)' : 'Server-side (DISCIPLAY_PASSWORD)';
}

/** Runs after a successful login. */
async function onAuthenticated() {
  const list = chats.all();
  if (list.length) Chat.openChat(list[0].id); else Chat.newChat();
  Chat.initComposer();
  refreshSettings();
  await checkNotion();
}

/* ------------------------------------------------------------------ */
/* Notion connection                                                   */
/* ------------------------------------------------------------------ */
async function checkNotion() {
  UI.setNotionStatus('idle', 'Checking Notion…');
  $('#set-conn').textContent = 'Checking…';
  $('#set-conn').className = 'muted';
  try {
    const s = await API.notionStatus();
    if (s.ok) {
      UI.setNotionStatus(s.demo ? 'demo' : 'ok', s.demo ? 'Notion Connected (demo)' : 'Notion Connected');
      $('#set-conn').textContent = s.demo ? 'Connected — sample data' : `Connected${s.workspace ? ' · ' + s.workspace : ''}`;
      $('#set-conn').className = 'muted ok';
    } else throw new Error('unavailable');
  } catch {
    UI.setNotionStatus('err', 'Notion Connection Error');
    $('#set-conn').textContent = 'Not connected';
    $('#set-conn').className = 'muted err';
  }
  loadDatabases();
}

async function loadDatabases() {
  const box = $('#set-dbs');
  box.innerHTML = '<span class="muted">Loading…</span>';
  try {
    const { databases = [] } = await API.listDatabases();
    if (!databases.length) { box.innerHTML = '<span class="muted">No databases configured yet. See <code>api/config.js</code>.</span>'; return; }
    box.innerHTML = databases.map((d) =>
      `<div class="db-item"><span>${d.name}</span><code>${String(d.id).slice(0, 12)}…</code></div>`).join('');
  } catch {
    box.innerHTML = '<span class="muted err">Could not load databases.</span>';
  }
}

/* ------------------------------------------------------------------ */
/* Global UI wiring                                                    */
/* ------------------------------------------------------------------ */
function wireGlobalUI() {
  const app = $('#app');

  $('#new-chat').addEventListener('click', () => { Chat.newChat(); closeDrawer(); });

  // Sidebar drawer / collapse
  const openDrawer = () => { app.classList.add('drawer-open'); $('#scrim').hidden = false; };
  $('#menu-btn').addEventListener('click', openDrawer);
  $('#sidebar-close').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  $('#collapse-btn').addEventListener('click', () => {
    const c = app.classList.toggle('collapsed');
    prefs.set('sidebarCollapsed', c);
  });
  if (prefs.get('sidebarCollapsed')) app.classList.add('collapsed');

  // Theme quick toggle
  $('#theme-btn').addEventListener('click', () => {
    const order = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(prefs.get('theme')) + 1) % 3];
    prefs.set('theme', next);
    UI.applyTheme(next);
    UI.toast(`Theme: ${next}`);
  });

  // Settings
  $('#open-settings').addEventListener('click', openSettings);
  $('#profile-btn').addEventListener('click', openSettings);
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => {
    UI.closeModal('#settings-modal'); UI.closeModal('#confirm-modal');
  }));

  $('#logout').addEventListener('click', logout);
  $('#set-logout').addEventListener('click', logout);

  $('#test-conn').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Testing…';
    await checkNotion();
    e.currentTarget.disabled = false;
    e.currentTarget.textContent = 'Test connection';
    UI.toast('Connection test complete');
  });

  $$('[data-theme-opt]').forEach((b) => b.addEventListener('click', () => {
    prefs.set('theme', b.dataset.themeOpt);
    UI.applyTheme(b.dataset.themeOpt);
  }));

  $('#opt-enter').addEventListener('change', (e) => prefs.set('enterToSend', e.target.checked));
  $('#opt-ts').addEventListener('change', (e) => {
    prefs.set('showTimestamps', e.target.checked);
    document.body.classList.toggle('no-ts', !e.target.checked);
  });

  $('#clear-history').addEventListener('click', () => {
    if (!confirm('Delete all conversations stored in this browser? Your Notion data is not affected.')) return;
    chats.clear();
    Chat.newChat();
    UI.toast('Chat history cleared');
  });

  // Escape closes modals / drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#settings-modal').hidden) UI.closeModal('#settings-modal');
      else if (!$('#confirm-modal').hidden) UI.closeModal('#confirm-modal');
      else closeDrawer();
    }
    // Ctrl/Cmd+K -> new chat
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !$('#app').hidden) {
      e.preventDefault(); Chat.newChat();
    }
  });
}

function closeDrawer() {
  $('#app').classList.remove('drawer-open');
  $('#scrim').hidden = true;
}

function openSettings() {
  refreshSettings();
  UI.openModal('#settings-modal');
}

function refreshSettings() {
  $('#opt-enter').checked = !!prefs.get('enterToSend');
  $('#opt-ts').checked = !!prefs.get('showTimestamps');
  $('#set-tz').textContent = CONFIG.TIMEZONE;
  UI.applyTheme(prefs.get('theme'));
  const exp = session.expiresAt();
  $('#set-session').textContent = exp
    ? `Active until ${new Date(exp).toLocaleTimeString(CONFIG.LOCALE, { hour: '2-digit', minute: '2-digit' })}`
    : 'Active';
}

async function logout() {
  UI.closeModal('#settings-modal');
  await doLogout();
  UI.toast('Signed out');
}
