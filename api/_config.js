/**
 * api/_config.js — CENTRALISED NOTION DATABASE CONFIGURATION
 * ===========================================================================
 * ✏️  THIS IS THE ONLY FILE YOU NEED TO EDIT TO CONNECT YOUR OWN NOTION SETUP.
 *
 * Fill in:
 *   1. Database IDs  — either here, or (recommended) via environment variables.
 *   2. Property names — must match EXACTLY the column names in your Notion DBs.
 *   3. Property types — so the backend builds the right Notion payload.
 *
 * Supported property types:
 *   'title' | 'rich_text' | 'select' | 'multi_select' | 'status' | 'date'
 *   | 'checkbox' | 'number' | 'url' | 'relation'
 *
 * NEVER put your NOTION_TOKEN in this file. It is read from process.env only.
 * ===========================================================================
 */

const env = (k, fallback = '') => (process.env[k] || fallback).trim();

export const DATABASES = {
  /* ----------------------------- TASKS ----------------------------- */
  tasks: {
    label: 'Tasks',
    // Get the ID from the database URL:
    // https://notion.so/<workspace>/<DATABASE_ID>?v=...
    id: env('NOTION_DB_TASKS', 'PASTE_TASKS_DATABASE_ID_HERE'),
    properties: {
      title:   { name: 'Name',     type: 'title'     }, // ← your title column
      status:  { name: 'Status',   type: 'status'    }, // 'status' or 'select'
      dueDate: { name: 'Due Date', type: 'date'      },
      subject: { name: 'Subject',  type: 'select'    }, // or 'relation'
      notes:   { name: 'Notes',    type: 'rich_text' }
    },
    // Values your Notion status column actually uses:
    statusValues: { open: 'Not started', inProgress: 'In progress', done: 'Done' }
  },

  /* --------------------------- HOMEWORK ---------------------------- */
  homework: {
    label: 'Homework',
    id: env('NOTION_DB_HOMEWORK', 'PASTE_HOMEWORK_DATABASE_ID_HERE'),
    properties: {
      title:   { name: 'Name',     type: 'title'     },
      status:  { name: 'Status',   type: 'status'    },
      dueDate: { name: 'Due Date', type: 'date'      },
      subject: { name: 'Subject',  type: 'select'    },
      notes:   { name: 'Notes',    type: 'rich_text' }
    },
    statusValues: { open: 'Not started', inProgress: 'In progress', done: 'Done' }
  }
};

export const SETTINGS = {
  timezone: env('DISCIPLAY_TIMEZONE', 'Africa/Cairo'),
  notionVersion: '2022-06-28',
  /** Max rows fetched per database query. */
  pageSize: 50
};

/** True when a database key has a real (non-placeholder) ID. */
export function isConfigured(key) {
  const id = DATABASES[key]?.id || '';
  return !!id && !id.startsWith('PASTE_');
}

export function configuredDatabases() {
  return Object.entries(DATABASES)
    .filter(([k]) => isConfigured(k))
    .map(([key, db]) => ({ key, name: db.label, id: db.id }));
}
