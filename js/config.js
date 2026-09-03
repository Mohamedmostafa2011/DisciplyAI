/**
 * Disciplay AI — Frontend configuration
 * -------------------------------------
 * SAFE TO COMMIT. Nothing secret may ever live in this file.
 * Secrets (NOTION_TOKEN, DISCIPLAY_PASSWORD, AI_API_KEY) live ONLY in
 * server-side environment variables. See README.md.
 */

export const CONFIG = {
  APP_NAME: 'Disciplay AI',

  /**
   * DEMO_MODE = true  -> no backend needed; mock AI + mock Notion data.
   * DEMO_MODE = false -> all calls go to the backend under API_BASE.
   *
   * If `AUTO_DETECT_BACKEND` is true the app pings `${API_BASE}/health` on
   * startup and automatically switches to real mode when a backend answers.
   */
  DEMO_MODE: true,
  AUTO_DETECT_BACKEND: true,

  API_BASE: '/api',

  /** Used for natural-language date resolution ("tomorrow", "Monday"). */
  TIMEZONE: 'Africa/Cairo',
  LOCALE: 'en-GB',

  /** Session lifetime for the authenticated browser session (ms). */
  SESSION_TTL_MS: 12 * 60 * 60 * 1000,

  STORAGE_KEYS: {
    chats: 'disciplay.chats.v1',
    prefs: 'disciplay.prefs.v1',
    session: 'disciplay.session.v1' // stores ONLY {issuedAt, expiresAt} — never the password
  }
};

/**
 * Suggestion cards on the chat home screen.
 */
export const SUGGESTIONS = [
  { icon: 'calendar', text: "What's due today?" },
  { icon: 'plus',     text: 'Add homework' },
  { icon: 'list',     text: 'Show my tasks' },
  { icon: 'sparkle',  text: 'Plan my week' },
  { icon: 'clock',    text: "What's due tomorrow?" },
  { icon: 'pin',      text: 'What homework is left this week?' }
];
