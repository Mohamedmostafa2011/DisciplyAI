/**
 * api/_tools.js — the CONTROLLED tool surface exposed to the AI.
 *
 * The AI can never issue arbitrary Notion API calls. It may only choose one of
 * the tools below and supply validated arguments; the backend executes them.
 */
import * as Notion from './_notion.js';
import { SETTINGS } from './_config.js';

/* ---------------- JSON schema shared with the AI model ---------------- */
export const TOOL_SCHEMAS = [
  {
    name: 'get_tasks',
    description: 'Read tasks from Notion. Optionally filter by inclusive date range (YYYY-MM-DD), subject, or status.',
    parameters: { type: 'object', properties: {
      from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD' },
      to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD' },
      subject: { type: 'string' },
      includeDone: { type: 'boolean', description: 'Include completed items (default false)' }
    } }
  },
  {
    name: 'get_homework',
    description: 'Read homework from Notion. Same filters as get_tasks.',
    parameters: { type: 'object', properties: {
      from: { type: 'string' }, to: { type: 'string' }, subject: { type: 'string' }, includeDone: { type: 'boolean' }
    } }
  },

  {
    name: 'create_task',
    description: 'Create a task. Do not invent a due date — ask the student if it is unclear.',
    parameters: { type: 'object', required: ['title'], properties: {
      title: { type: 'string' }, subject: { type: 'string' },
      dueDate: { type: 'string', description: 'YYYY-MM-DD' }, notes: { type: 'string' }
    } }
  },
  {
    name: 'create_homework',
    description: 'Create a homework item. Do not invent a due date.',
    parameters: { type: 'object', required: ['title'], properties: {
      title: { type: 'string' }, subject: { type: 'string' },
      dueDate: { type: 'string', description: 'YYYY-MM-DD' }, notes: { type: 'string' }
    } }
  },
  {
    name: 'find_item',
    description: 'Locate the exact Notion page for an update or delete. ALWAYS call this before update_* or delete_*.',
    parameters: { type: 'object', required: ['database', 'query'], properties: {
      database: { type: 'string', enum: ['tasks', 'homework'] },
      query: { type: 'string', description: 'Words from the item title' },
      subject: { type: 'string' }
    } }
  },
  {
    name: 'update_task',
    description: 'Update a task by its Notion page id (obtain it from find_item).',
    parameters: { type: 'object', required: ['id'], properties: {
      id: { type: 'string' }, title: { type: 'string' }, subject: { type: 'string' },
      dueDate: { type: 'string' }, status: { type: 'string' }, notes: { type: 'string' }
    } }
  },
  {
    name: 'update_homework',
    description: 'Update a homework item by its Notion page id (obtain it from find_item).',
    parameters: { type: 'object', required: ['id'], properties: {
      id: { type: 'string' }, title: { type: 'string' }, subject: { type: 'string' },
      dueDate: { type: 'string' }, status: { type: 'string' }, notes: { type: 'string' }
    } }
  },
  {
    name: 'delete_task',
    description: 'Delete (archive) a task. Requires the user to have confirmed. Set confirmed=true only after explicit confirmation.',
    parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, confirmed: { type: 'boolean' } } }
  },
  {
    name: 'delete_homework',
    description: 'Delete (archive) a homework item. Requires explicit user confirmation.',
    parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, confirmed: { type: 'boolean' } } }
  }
];

export const TOOL_LABELS = {
  get_tasks: 'Reading your tasks…',
  get_homework: 'Reading your homework…',
  find_item: 'Finding the right item…',
  create_task: 'Creating task…',
  create_homework: 'Creating homework…',
  update_task: 'Updating your task…',
  update_homework: 'Updating your homework…',
  delete_task: 'Deleting task…',
  delete_homework: 'Deleting homework…'
};

export const DONE_LABELS = {
  get_tasks: 'Done — tasks loaded.',
  get_homework: 'Done — homework loaded.',
  find_item: 'Done — item located.',
  create_task: 'Done — task added.',
  create_homework: 'Done — homework added.',
  update_task: 'Done — task updated.',
  update_homework: 'Done — homework updated.',
  delete_task: 'Done — task deleted.',
  delete_homework: 'Done — homework deleted.'
};

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Execute one tool call with validation. Returns a plain JSON-serialisable result. */
export async function executeTool(name, args = {}, ctx = {}) {
  switch (name) {
    case 'get_tasks':
      return { items: await Notion.getTasks(cleanFilters(args)) };
    case 'get_homework':
      return { items: await Notion.getHomework(cleanFilters(args)) };

    case 'create_task':
    case 'create_homework': {
      if (!args.title) return { error: 'A title is required.' };
      if (args.dueDate && !isDate(args.dueDate)) return { error: 'dueDate must be YYYY-MM-DD.' };
      const fn = name === 'create_task' ? Notion.createTask : Notion.createHomework;
      return { created: await fn(pick(args, ['title', 'subject', 'dueDate', 'notes'])) };
    }

    case 'find_item': {
      const db = args.database === 'homework' ? 'homework' : 'tasks';
      const { match, candidates } = await Notion.findPage(db, args);
      return { match, candidates, database: db };
    }

    case 'update_task':
    case 'update_homework': {
      if (!args.id) return { error: 'A page id is required. Call find_item first.' };
      if (args.dueDate && !isDate(args.dueDate)) return { error: 'dueDate must be YYYY-MM-DD.' };
      const fn = name === 'update_task' ? Notion.updateTask : Notion.updateHomework;
      return { updated: await fn(args.id, pick(args, ['title', 'subject', 'dueDate', 'status', 'notes'])) };
    }

    case 'delete_task':
    case 'delete_homework': {
      if (!args.id) return { error: 'A page id is required. Call find_item first.' };
      // Destructive actions require confirmation that came from the UI.
      if (!args.confirmed && !ctx.confirmed) {
        return { needsConfirmation: true, id: args.id, tool: name };
      }
      const fn = name === 'delete_task' ? Notion.deleteTask : Notion.deleteHomework;
      return { deleted: await fn(args.id) };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function cleanFilters(a) {
  const o = {};
  if (isDate(a.from)) o.from = a.from;
  if (isDate(a.to)) o.to = a.to;
  if (a.subject) o.subject = String(a.subject);
  if (a.includeDone) o.includeDone = true;
  return o;
}
function pick(o, keys) {
  const out = {};
  keys.forEach((k) => { if (o[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k]; });
  return out;
}

export function systemPrompt(today, timezone = SETTINGS.timezone) {
  return `You are Disciplay AI, a private academic assistant for an IGCSE student.
You manage the student's academic information stored in two Notion databases: Tasks and Homework.
Each item has a title, a subject (e.g. Biology, Physics), a due date and a status.

Today's date is ${today} and the student's timezone is ${timezone}.
Resolve relative dates ("today", "tomorrow", "Monday", "next week", "this weekend") to exact YYYY-MM-DD values relative to today.
If a request is ambiguous or a required date is missing, ask ONE concise clarifying question instead of guessing. Never invent dates.

Rules:
- Use the provided tools for every read or write. Never claim an action succeeded unless the tool returned success.
- Before update_* or delete_*, call find_item to identify the exact Notion page. If the match is ambiguous, ask which item the student means.
- Deletion always requires explicit user confirmation before delete_* is executed.
- Reply in concise, natural, encouraging language. Use Markdown: short headings, bullet or task lists, and simple tables for schedules.
- Never mention tokens, environment variables, database IDs, internal errors or the Notion API itself.`;
}
