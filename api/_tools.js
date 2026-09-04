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
      database: { type: 'string', enum: ['tasks', 'homework', 'quizzes'] },
      query: { type: 'string', description: 'Words from the item title' },
      subject: { type: 'string' }
    } }
  },
  {
    name: 'get_quizzes',
    description: 'Read upcoming quizzes and exams. Use for any question about quizzes, exams, tests or assessments.',
    parameters: { type: 'object', properties: {
      from: { type: 'string', description: 'YYYY-MM-DD' },
      to: { type: 'string', description: 'YYYY-MM-DD' },
      subject: { type: 'string' },
      includeDone: { type: 'boolean' }
    } }
  },
  {
    name: 'create_quiz',
    description: 'Add a quiz or exam. Requires the exact calendar date. Do not invent a date.',
    parameters: { type: 'object', required: ['title'], properties: {
      title: { type: 'string' }, subject: { type: 'string' },
      dueDate: { type: 'string', description: 'YYYY-MM-DD — the day of the quiz' },
      notes: { type: 'string' }
    } }
  },
  {
    name: 'update_quiz',
    description: 'Update a quiz or exam by its Notion page id (obtain it from find_item).',
    parameters: { type: 'object', required: ['id'], properties: {
      id: { type: 'string' }, title: { type: 'string' }, subject: { type: 'string' },
      dueDate: { type: 'string' }, status: { type: 'string' }, notes: { type: 'string' }
    } }
  },
  {
    name: 'delete_quiz',
    description: 'Delete a quiz or exam. Requires explicit user confirmation.',
    parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }
  },
  {
    name: 'read_file',
    description: "Read the actual CONTENTS of one saved file so you can explain it, answer questions about it, quiz the student, or say exactly where something appears. Use whenever they ask about what is inside a file, or ask you to teach/explain/summarise it.",
    parameters: { type: 'object', required: ['name'], properties: {
      name: { type: 'string', description: 'The file name or words from it, e.g. "Cells revision notes"' },
      subject: { type: 'string' },
      page: { type: 'number', description: 'Optional: read one specific page number.' }
    } }
  },
  {
    name: 'search_in_files',
    description: "Search INSIDE the student's saved files for a word or topic and return the matching passages with their file name and page number. Use when they ask where something is explained, or to find every mention of a topic.",
    parameters: { type: 'object', required: ['query'], properties: {
      query: { type: 'string', description: 'The word or phrase to find inside the files.' },
      subject: { type: 'string', description: 'Optional subject to narrow the search.' }
    } }
  },
  {
    name: 'find_files',
    description: "Search the student's saved files, resources, notes or past papers in Notion and return direct links. Use whenever they ask for a file, document, PDF, past paper, revision notes or study material for a subject.",
    parameters: { type: 'object', properties: {
      query: { type: 'string', description: 'Words from the file or resource name, e.g. "past paper", "chapter 3"' },
      subject: { type: 'string', description: 'Subject to filter by, e.g. "Biology"' }
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
  get_quizzes: 'Checking your quizzes and exams…',
  create_quiz: 'Adding quiz…',
  update_quiz: 'Updating quiz…',
  delete_quiz: 'Deleting quiz…',
  find_item: 'Finding the right item…',
  find_files: 'Searching your saved files…',
  read_file: 'Reading the file…',
  search_in_files: 'Searching inside your files…',
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
  get_quizzes: 'Done — quizzes loaded.',
  create_quiz: 'Done — quiz added.',
  update_quiz: 'Done — quiz updated.',
  delete_quiz: 'Done — quiz deleted.',
  find_item: 'Done — item located.',
  find_files: 'Done — files found.',
  read_file: 'Done — file read.',
  search_in_files: 'Done — searched your files.',
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
    case 'get_quizzes':
      return { items: await Notion.getQuizzes(cleanFilters(args)) };

    case 'create_task':
    case 'create_homework':
    case 'create_quiz': {
      if (!args.title) return { error: 'A title is required.' };
      if (args.dueDate && !isDate(args.dueDate)) return { error: 'dueDate must be YYYY-MM-DD.' };
      if (name === 'create_quiz' && !args.dueDate) {
        return { error: 'A quiz needs its calendar date. Ask the student which day it is on.' };
      }
      const fn = name === 'create_task' ? Notion.createTask
               : name === 'create_quiz' ? Notion.createQuiz
               : Notion.createHomework;
      return { created: await fn(pick(args, ['title', 'subject', 'dueDate', 'notes'])) };
    }

    case 'find_files': {
      const { query = '', subject = '' } = args;
      const res = await Notion.searchFiles({ query, subject, limit: 10 });
      if (!res.count) {
        return {
          found: 0,
          message: `No files matched${query ? ` "${query}"` : ''}${subject ? ` for ${subject}` : ''} in "${res.database}". Tell the student what you searched for and ask them to check the name.`
        };
      }
      return res;
    }

    case 'read_file': {
      const { name: q, subject = '', page } = args;
      const res = await Notion.searchFiles({ query: q, subject, limit: 4 });
      if (!res.count) return { found: 0, message: `No file matched "${q}". Ask the student to check the name.` };

      const target = res.files.find((f) => f.links.length) || res.files[0];
      if (!target.links.length) {
        return { found: 1, name: target.name, message: 'That entry has no attached file — only a Notion page. Nothing to read.' };
      }
      const link = target.links[0];
      const { extractFromUrl, budget } = await import('./_extract.js');
      const doc = await extractFromUrl(link.url, link.name);
      if (!doc.pages.length) {
        return { name: target.name, subject: target.subject, readable: false, message: doc.note || 'No readable text in that file.' };
      }
      const chosen = page ? doc.pages.filter((p) => p.page === Number(page)) : doc.pages;
      if (page && !chosen.length) {
        return { name: target.name, error: `That file only has ${doc.pages.length} page(s).` };
      }
      const { pages, truncated } = budget(chosen);
      return {
        name: target.name, subject: target.subject, link: link.url,
        totalPages: doc.pages.length, truncated,
        instruction: 'Cite page numbers when you refer to the content, e.g. "on page 3".',
        pages
      };
    }

    case 'search_in_files': {
      const { query: q, subject = '' } = args;
      if (!q) return { error: 'A search term is required.' };
      const res = await Notion.searchFiles({ query: '', subject, limit: 6 });
      if (!res.count) return { found: 0, message: 'No saved files to search.' };

      const { extractFromUrl } = await import('./_extract.js');
      const needle = q.toLowerCase();
      const hits = [];
      let skipped = 0;

      for (const f of res.files) {
        if (!f.links.length) continue;
        let doc;
        try { doc = await extractFromUrl(f.links[0].url, f.links[0].name); }
        catch { skipped++; continue; }
        if (!doc.pages.length) { skipped++; continue; }

        for (const pg of doc.pages) {
          const idx = pg.text.toLowerCase().indexOf(needle);
          if (idx === -1) continue;
          hits.push({
            file: f.name, subject: f.subject, page: pg.page, link: f.links[0].url,
            excerpt: pg.text.slice(Math.max(0, idx - 160), idx + 240).trim()
          });
          if (hits.length >= 12) break;
        }
        if (hits.length >= 12) break;
      }
      if (!hits.length) {
        return { found: 0, message: `I read your${subject ? ' ' + subject : ''} files but couldn't find "${q}" in any of them.${skipped ? ` ${skipped} file(s) had no readable text.` : ''}` };
      }
      return { found: hits.length, instruction: 'Always name the file and page number for each hit.', hits };
    }

    case 'find_item': {
      const db = ['homework', 'quizzes', 'tasks'].includes(args.database) ? args.database : 'tasks';
      const { match, candidates } = await Notion.findPage(db, args);
      return { match, candidates, database: db };
    }

    case 'update_task':
    case 'update_homework':
    case 'update_quiz': {
      if (!args.id) return { error: 'A page id is required. Call find_item first.' };
      if (args.dueDate && !isDate(args.dueDate)) return { error: 'dueDate must be YYYY-MM-DD.' };
      const fn = name === 'update_task' ? Notion.updateTask
               : name === 'update_quiz' ? Notion.updateQuiz
               : Notion.updateHomework;
      return { updated: await fn(args.id, pick(args, ['title', 'subject', 'dueDate', 'status', 'notes'])) };
    }

    case 'delete_task':
    case 'delete_homework':
    case 'delete_quiz': {
      if (!args.id) return { error: 'A page id is required. Call find_item first.' };
      // Destructive actions require confirmation that came from the UI.
      if (!args.confirmed && !ctx.confirmed) {
        return { needsConfirmation: true, id: args.id, tool: name };
      }
      const fn = name === 'delete_task' ? Notion.deleteTask
               : name === 'delete_quiz' ? Notion.deleteQuiz
               : Notion.deleteHomework;
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
You manage the student's academic information stored in Notion: a Tasks database, a Homework database, a Quizzes & Exams database, and a collection of saved files and study resources.
Each item has a title, a subject (e.g. Biology, Physics), a due date and a status.

Today's date is ${today} and the student's timezone is ${timezone}.
Resolve relative dates ("today", "tomorrow", "Monday", "next week", "this weekend") to exact YYYY-MM-DD values relative to today.
If a request is ambiguous or a required date is missing, ask ONE concise clarifying question instead of guessing. Never invent dates.

Rules:
- Use the provided tools for every read or write. Never claim an action succeeded unless the tool returned success.
- Before update_* or delete_*, call find_item to identify the exact Notion page. If the match is ambiguous, ask which item the student means.
- Deletion always requires explicit user confirmation before delete_* is executed.
- Quizzes and exams live on a calendar: each has a title, a subject and a single date. When creating one, the date is required — if the student hasn't given a day, ask for it. Never guess.
- When the student asks how to prepare or revise for a quiz, first call get_quizzes to confirm the date and subject, then call find_files with that subject to see what study material they actually have. Build the advice around those real files and the number of days left, and link them. If no files exist for the subject, say so plainly and give a study plan anyway.
- When giving a revision plan, be specific and realistic: work back from the exam date, break it into days, and prioritise by how close the exam is and how much else is due that week (check get_homework and get_tasks when the week looks busy). Keep it encouraging, never preachy.
- You can read the student's saved files. When they ask what a file says, ask you to explain, summarise, teach or quiz them on it, call read_file. When they ask where a topic is covered, call search_in_files. Always cite the file name and page number, e.g. "on page 3 of your Cells notes".
- Act as a patient tutor when explaining file content: explain in plain language at IGCSE level, use short examples, and check understanding with a question at the end. Base every explanation on the text the tool returned — if it isn't in the file, say so rather than filling the gap from memory.
- If a file has no readable text (a scan or photos), tell the student plainly and suggest they upload a text-based PDF instead.
- When the student asks for a file, document, PDF, past paper, revision notes or study material, call find_files. Present each result as a Markdown link using the url from the tool result, e.g. [Biology Paper 2](https://...). If a result has several links, list them under the item name. Never invent a link — only use urls returned by the tool.
- Note that file links from Notion uploads expire after about an hour, so tell the student to open them soon rather than saving the link for later.
- Reply in concise, natural, encouraging language. Use Markdown: short headings, bullet or task lists, and simple tables for schedules.
- Never mention tokens, environment variables, database IDs, internal errors or the Notion API itself.`;
}
