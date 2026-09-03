/**
 * auth.js — password gate for the private Disciplay AI app.
 * ---------------------------------------------------------------------------
 * SECURITY MODEL
 *  - The real password lives ONLY in the server environment variable
 *    DISCIPLAY_PASSWORD and is compared server-side (see api/auth.js).
 *  - The browser posts the typed password over HTTPS to /api/auth and receives
 *    an HttpOnly session cookie. The plaintext password is never stored,
 *    logged, cached, or sent to Notion.
 *  - localStorage never holds credentials. sessionStorage holds only session
 *    timestamps so the user isn't re-prompted on every message.
 *
 *  When no backend is deployed the app falls back to:
 *    Prototype authentication only.
 *    Use server-side authentication for real security.
 * ---------------------------------------------------------------------------
 */
import * as API from './api.js';
import { session } from './store.js';
import { $ } from './ui.js';

let onSuccess = () => {};

export function initAuth(callback) {
  onSuccess = callback;

  const form = $('#login-form');
  const input = $('#password');
  const btn = $('#login-btn');
  const err = $('#login-error');

  $('#toggle-pw').addEventListener('click', (e) => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    input.focus();
  });

  input.addEventListener('input', () => { input.classList.remove('err'); err.hidden = true; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = input.value; // never logged, never persisted
    if (!password) { showError('Please enter your password.'); return; }
    setLoading(true);
    try {
      const res = await API.login(password);
      session.start(res.expiresAt);
      input.value = '';
      unlock();
    } catch (ex) {
      showError(ex.status === 401 ? 'Incorrect password. Please try again.' : (ex.message || 'Unable to sign in right now.'));
      input.select();
    } finally {
      setLoading(false);
    }
  });

  function setLoading(on) {
    btn.disabled = on;
    $('.btn-label', btn).textContent = on ? 'Verifying…' : 'Enter Disciplay AI';
    $('.spinner', btn).hidden = !on;
  }
  function showError(msg) {
    err.textContent = msg;
    err.hidden = false;
    input.classList.remove('err');
    void input.offsetWidth;
    input.classList.add('err');
  }
}

export function unlock() {
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  onSuccess();
}

export function lock() {
  $('#app').hidden = true;
  const login = $('#login-screen');
  login.hidden = false;
  $('#password').value = '';
  $('#login-error').hidden = true;
  setTimeout(() => $('#password').focus(), 60);
}

export async function doLogout() {
  await API.logout();
  session.end();
  lock();
}

/** Restore an existing browser session (and revalidate against the backend). */
export async function restoreSession() {
  if (!session.active()) return false;
  try {
    const res = await API.verifySession();
    if (res?.ok) return true;
  } catch { /* backend rejected or unreachable */ }
  session.end();
  return false;
}

/** Periodically enforce session expiry -> show the login screen again. */
export function watchSession() {
  setInterval(() => {
    if (!$('#app').hidden && !session.active()) {
      lock();
      const t = document.createElement('div');
      t.className = 'toast';
      t.textContent = 'Your session expired. Please sign in again.';
      $('#toasts').appendChild(t);
      setTimeout(() => t.remove(), 3600);
    }
  }, 30000);
}
