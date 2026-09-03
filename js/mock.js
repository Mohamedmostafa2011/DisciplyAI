/**
 * mock.js — DEMO MODE engine.
 * ---------------------------------------------------------------------------
 * Simulates the backend: a lightweight natural-language router that picks a
 * tool, "executes" it against in-memory sample data, and writes a natural
 * reply. Mirrors the exact contract of the real backend (see /api/chat.js) so
 * flipping CONFIG.DEMO_MODE to false changes nothing in the UI.
 *
 * PROTOTYPE AUTHENTICATION ONLY.
 * Use server-side authentication for real security.
 * ---------------------------------------------------------------------------
 */
import { CONFIG } from './config.js';
import { todayISO, addDays, label, longLabel, parseDate, parseRange, weekdayOf } from './dates.js';

/* Prototype authentication only. Use server-side authentication for real security. */
const DEMO_PASSWORD = 'disciplay';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = () => 'demo_' + Math.random().toString(36).slice(2, 10);

/* ---------------------------------------------------------------- */
/* Sample Notion data                                                */
/* ---------------------------------------------------------------- */
const T = todayISO();

const DB = {
  subjects: ['Biology', 'Physics', 'Chemistry', 'Mathematics', 'English', 'ICT', 'Business Studies'],
  homework: [
    { id: uid(), title: 'Revise reproduction', subject: 'Biology', dueDate: addDays(T, 1), status: 'Not started' },
    { id: uid(), title: 'Complete questions 1–10', subject: 'Physics', dueDate: addDays(T, 1), status: 'In progress' },
    { id: uid(), title: 'Past paper: acids and bases', subject: 'Chemistry', dueDate: addDays(T, 4), status: 'Not started' },
    { id: uid(), title: 'Essay draft — Journeys', subject: 'English', dueDate: T, status: 'In progress' },
    { id: uid(), title: 'Trigonometry worksheet', subject: 'Mathematics', dueDate: addDays(T, 3), status: 'Not started' }
  ],
  tasks: [
    { id: uid(), title: 'Make Biology flashcards', subject: 'Biology', dueDate: T, status: 'Not started' },
    { id: uid(), title: 'Print Physics formula sheet', subject: 'Physics', dueDate: addDays(T, 2), status: 'Not started' },
    { id: uid(), title: 'Email Mr. Hassan about coursework', subject: 'Business Studies', dueDate: addDays(T, 1), status: 'Done' },
    { id: uid(), title: 'Organise revision timetable', subject: 'General', dueDate: addDays(T, 5), status: 'Not started' }
  ],
  commitments: [
    { id: uid(), title: 'School', day: 'Sun–Thu', time: '07:30 – 14:30' },
    { id: uid(), title: 'Physics tutoring', day: 'Monday', time: '17:00 – 18:30' },
    { id: uid(), title: 'Football training', day: 'Wednesday', time: '18:00 – 19:30' },
    { id: uid(), title: 'Quran class', day: 'Friday', time: '10:00 – 11:00' }
  ]
};

/* ---------------------------------------------------------------- */
/* Auth (demo)                                                       */
/* ---------------------------------------------------------------- */
export async function login(password) {
  await wait(650);
  if (password === DEMO_PASSWORD) {
    return { ok: true, mode: 'prototype', expiresAt: Date.now() + CONFIG.SESSION_TTL_MS };
  }
  const e = new Error('Incorrect password. Please try again.');
  e.status = 401;
  throw e;
}
export async function verifySession() { return { ok: true, mode: 'prototype' }; }

export async function notionStatus() {
  await wait(420);
  return { ok: true, demo: true, workspace: 'Disciplay (sample data)', databases: 4 };
}
export async function listDatabases() {
  await wait(260);
  return {
    ok: true, demo: true,
    databases: [
      { key: 'tasks', name: 'Tasks', id: 'DEMO_TASKS_DATABASE_ID', items: DB.tasks.length },
      { key: 'homework', name: 'Homework', id: 'DEMO_HOMEWORK_DATABASE_ID', items: DB.homework.length },
      { key: 'fixedCommitments', name: 'Fixed Commitments', id: 'DEMO_COMMITMENTS_DATABASE_ID', items: DB.commitments.length },
      { key: 'subjects', name: 'Subjects', id: 'DEMO_SUBJECTS_DATABASE_ID', items: DB.subjects.length }
    ]
  };
}

/* ---------------------------------------------------------------- */
/* Tool implementations (demo Notion service layer)                  */
/* ---------------------------------------------------------------- */
const TOOL_LABELS = {
  get_tasks: 'Reading your tasks…',
  get_homework: 'Reading your homework…',
  get_fixed_commitments: 'Reading your fixed commitments…',
  get_subjects: 'Reading your subjects…',
  create_task: 'Creating task…',
  create_homework: 'Creating homework…',
  update_task: 'Updating your task…',
  update_homework: 'Updating your homework…',
  delete_task: 'Deleting task…',
  delete_homework: 'Deleting homework…'
};

const inRange = (d, r) => !r || (d && d >= r.start && d <= r.end);
const openOnly = (x) => !/^(done|complete)/i.test(x.status || '');

function fmtList(items, { showStatus = true } = {}) {
  return items.map((i) => {
    const done = /^(done|complete)/i.test(i.status || '');
    const bits = [i.subject ? `**${i.subject}** — ${i.title}` : `**${i.title}**`];
    if (i.dueDate) bits.push(`_${label(i.dueDate)}_`);
    if (showStatus && i.status) bits.push(`· ${i.status}`);
    return `- [${done ? 'x' : ' '}] ${bits.join(' ')}`;
  }).join('\n');
}

/* ---------------------------------------------------------------- */
/* Intent routing                                                    */
/* ---------------------------------------------------------------- */
function pickSubject(text) {
  const t = text.toLowerCase();
  return DB.subjects.find((s) => t.includes(s.toLowerCase()))
      || (t.includes('maths') || t.includes('math') ? 'Mathematics' : null)
      || (t.includes('bio') ? 'Biology' : null)
      || (t.includes('chem') ? 'Chemistry' : null)
      || (t.includes('phys') ? 'Physics' : null);
}

function findItem(list, text) {
  const t = text.toLowerCase();
  const scored = list.map((i) => {
    let s = 0;
    if (i.subject && t.includes(i.subject.toLowerCase())) s += 3;
    const words = i.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    words.forEach((w) => { if (t.includes(w)) s += 2; });
    return { i, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.length ? scored[0].i : null;
}

function extractTitle(text) {
  let t = text
    .replace(/^\s*(please\s+)?(can you\s+)?(add|create|new|make|log|remind me to)\b/i, '')
    .replace(/\b(homework|hw|task|todo|to-do)\b/gi, ' ')
    .replace(/\bfor\b\s*$/i, '');
  const sub = pickSubject(text);
  if (sub) t = t.replace(new RegExp(sub, 'ig'), ' ');
  t = t.replace(/\b(by|due|on|before|for)\s+(today|tomorrow|tmrw|next week|this week|this weekend|the weekend|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\b/gi, ' ');
  t = t.replace(/[:\-–,]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(to|the|my)\s+/i, '').trim();
  if (!t) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * The demo "AI". Returns { reply, tools[], confirm? }
 */
export async function sendChat({ messages, confirmedAction }, onEvent) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const text = (last?.content || '').trim();
  const t = text.toLowerCase();
  const tools = [];

  const run = async (name, fn, ms = 620) => {
    onEvent?.({ type: 'tool', name, label: TOOL_LABELS[name] || name, phase: 'start' });
    await wait(ms);
    const out = fn();
    tools.push({ name, ok: true, label: TOOL_LABELS[name] });
    onEvent?.({ type: 'tool', name, label: out.done || 'Done.', phase: 'done' });
    return out;
  };

  /* ---- 1. A previously-requested destructive action was confirmed ---- */
  if (confirmedAction) {
    const { tool, target } = confirmedAction;
    const list = tool === 'delete_homework' ? DB.homework : DB.tasks;
    const idx = list.findIndex((i) => i.id === target.id);
    return run(tool, () => {
      if (idx >= 0) list.splice(idx, 1);
      return { done: `Done — ${tool === 'delete_homework' ? 'homework' : 'task'} deleted.` };
    }, 700).then(() => ({
      reply: `Deleted.\n\n**${target.subject ? target.subject + ' — ' : ''}${target.title}** has been removed from your Notion ${tool === 'delete_homework' ? 'Homework' : 'Tasks'} database.`,
      tools
    }));
  }

  await wait(340); // "thinking"

  /* ---- 2. DELETE -> requires confirmation ---- */
  if (/\b(delete|remove|cancel)\b/.test(t)) {
    const isHw = /\bhomework|hw\b/.test(t);
    const pool = isHw ? DB.homework : [...DB.tasks, ...DB.homework];
    const match = findItem(pool, text);
    if (!match) {
      return { reply: "I couldn't find a matching item to delete. Could you tell me the subject or the exact title?", tools };
    }
    const isHwItem = DB.homework.includes(match);
    return {
      reply: 'Just to be safe, please confirm this deletion.',
      tools,
      confirm: {
        tool: isHwItem ? 'delete_homework' : 'delete_task',
        target: { id: match.id, title: match.title, subject: match.subject },
        message: `Are you sure you want to delete this ${isHwItem ? 'homework' : 'task'}?`
      }
    };
  }

  /* ---- 3. MARK COMPLETE / UPDATE ---- */
  if (/\b(mark|complete|completed|done|finish(ed)?)\b/.test(t) && !/\bwhat|show|list\b/.test(t)) {
    const match = findItem([...DB.homework, ...DB.tasks], text);
    if (!match) return { reply: 'Which item should I mark as completed? You can say for example "mark Biology revision as done".', tools };
    const isHw = DB.homework.includes(match);
    const out = await run(isHw ? 'update_homework' : 'update_task', () => {
      match.status = 'Done';
      return { done: 'Done — marked as completed.' };
    });
    return { reply: `Marked **${match.subject ? match.subject + ' — ' : ''}${match.title}** as completed. ✅\n\nNice work — ${DB.homework.filter(openOnly).length} pieces of homework left open.`, tools, _:out };
  }

  if (/\b(move|reschedule|change|postpone|push|shift)\b/.test(t)) {
    const match = findItem([...DB.homework, ...DB.tasks], text);
    const newDate = parseDate(text);
    if (!match) return { reply: 'Which item would you like me to move? Mention the subject or title and I\'ll find it.', tools };
    if (!newDate) return { reply: `I found **${match.subject} — ${match.title}**. What date should I move it to?`, tools };
    const isHw = DB.homework.includes(match);
    const old = match.dueDate;
    await run(isHw ? 'update_homework' : 'update_task', () => { match.dueDate = newDate; return { done: 'Done — due date updated.' }; });
    return { reply: `Moved **${match.subject} — ${match.title}** from ${label(old)} to **${longLabel(newDate)}**.`, tools };
  }

  /* ---- 4. CREATE ---- */
  if (/\b(add|create|new|log|remind me)\b/.test(t)) {
    const isHw = /\bhomework|hw\b/.test(t) || (!/\btask|todo|to-do\b/.test(t) && !!pickSubject(text));
    const title = extractTitle(text);
    const subject = pickSubject(text);
    const due = parseDate(text);

    if (!title || title.length < 3) {
      return { reply: `Sure — what should the ${isHw ? 'homework' : 'task'} be called?\n\nFor example: _"Add Biology homework: revise reproduction by Sunday."_`, tools };
    }
    if (!due) {
      return { reply: `Got it — **${subject ? subject + ' — ' : ''}${title}**.\n\nWhen is it due? (e.g. today, tomorrow, Sunday, or a date)`, tools };
    }

    const item = { id: uid(), title, subject: subject || 'General', dueDate: due, status: 'Not started' };
    await run(isHw ? 'create_homework' : 'create_task', () => {
      (isHw ? DB.homework : DB.tasks).push(item);
      return { done: `Done — ${isHw ? 'homework' : 'task'} added.` };
    }, 780);

    return {
      reply: `Done. I added your ${isHw ? 'homework' : 'task'}:\n\n**${item.subject}**\n${item.title}\nDue ${longLabel(item.dueDate)}\n\nWant me to add a reminder task the day before?`,
      tools
    };
  }

  /* ---- 5. FIXED COMMITMENTS ---- */
  if (/\bcommitment|fixed|routine|schedule\b/.test(t) && !/\bhomework|task\b/.test(t)) {
    const out = await run('get_fixed_commitments', () => ({ done: 'Done — commitments loaded.' }));
    const scope = /\btoday\b/.test(t) ? T : /\btomorrow\b/.test(t) ? addDays(T, 1) : null;
    let list = DB.commitments;
    if (scope) {
      const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][weekdayOf(scope)];
      list = DB.commitments.filter((c) => c.day === dayName || (c.day === 'Sun–Thu' && !['Friday','Saturday'].includes(dayName)));
    }
    if (!list.length) return { reply: `**No fixed commitments${scope ? ' ' + label(scope).toLowerCase() : ''}.**\n\nYour schedule is clear.`, tools, _: out };
    return {
      reply: `### Fixed commitments${scope ? ' — ' + longLabel(scope) : ''}\n\n| When | Time | Commitment |\n| --- | --- | --- |\n${list.map((c) => `| ${c.day} | ${c.time} | ${c.title} |`).join('\n')}`,
      tools
    };
  }

  /* ---- 6. PLAN MY WEEK ---- */
  if (/\bplan\b/.test(t) && /\bweek|day|study\b/.test(t)) {
    await run('get_homework', () => ({ done: 'Done — homework loaded.' }));
    await run('get_tasks', () => ({ done: 'Done — tasks loaded.' }), 420);
    const upcoming = [...DB.homework, ...DB.tasks].filter(openOnly)
      .filter((i) => i.dueDate >= T && i.dueDate <= addDays(T, 6))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (!upcoming.length) return { reply: '**Nothing due in the next 7 days.**\n\nYou are all caught up — a good week to get ahead on revision.', tools };
    const byDay = {};
    upcoming.forEach((i) => { (byDay[i.dueDate] ||= []).push(i); });
    const body = Object.entries(byDay).map(([d, items]) =>
      `**${longLabel(d)}**\n${items.map((i) => `- ${i.subject} — ${i.title}`).join('\n')}`).join('\n\n');
    return { reply: `Here's your week, built from Notion:\n\n${body}\n\n---\n\n**Suggestion:** start with **${upcoming[0].subject} — ${upcoming[0].title}** today, and keep your evening free after your fixed commitments.`, tools };
  }

  /* ---- 7. READ tasks / homework ---- */
  const wantsTasks = /\btask|todo|to-do\b/.test(t);
  const wantsHw = /\bhomework|hw\b/.test(t);
  const isQuestion = /\bwhat|show|list|due|have|any|when|remaining|left\b/.test(t) || t.endsWith('?');

  if (wantsTasks || wantsHw || isQuestion) {
    const range = parseRange(text) || (/\bdue\b|\btoday\b/.test(t) ? { start: T, end: T, name: 'today' } : null);
    const subject = pickSubject(text);

    let items = [];
    if (wantsTasks && !wantsHw) { await run('get_tasks', () => ({ done: 'Done — tasks loaded.' })); items = DB.tasks.map((i) => ({ ...i, _k: 'task' })); }
    else if (wantsHw && !wantsTasks) { await run('get_homework', () => ({ done: 'Done — homework loaded.' })); items = DB.homework.map((i) => ({ ...i, _k: 'homework' })); }
    else {
      await run('get_homework', () => ({ done: 'Done — homework loaded.' }));
      await run('get_tasks', () => ({ done: 'Done — tasks loaded.' }), 380);
      items = [...DB.homework.map((i) => ({ ...i, _k: 'homework' })), ...DB.tasks.map((i) => ({ ...i, _k: 'task' }))];
    }

    let filtered = items.filter(openOnly);
    if (subject) filtered = filtered.filter((i) => i.subject === subject);
    if (range) filtered = filtered.filter((i) => inRange(i.dueDate, range));
    filtered.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

    const scopeTxt = [subject, range ? range.name : null].filter(Boolean).join(' ');
    if (!filtered.length) {
      return { reply: `**Nothing found${scopeTxt ? ' for ' + scopeTxt : ''}.**\n\nYou are all caught up. Ask me to add something whenever you need to.`, tools };
    }
    const head = range && range.start === range.end
      ? `You have ${filtered.length} item${filtered.length > 1 ? 's' : ''} due ${label(range.start).toLowerCase()}:`
      : `Here ${filtered.length > 1 ? 'are' : 'is'} ${filtered.length} open item${filtered.length > 1 ? 's' : ''}${scopeTxt ? ' for ' + scopeTxt : ''}:`;
    return { reply: `${head}\n\n${fmtList(filtered)}\n\nWould you like me to organise these into a study plan?`, tools };
  }

  /* ---- 8. Subjects ---- */
  if (/\bsubject/.test(t)) {
    await run('get_subjects', () => ({ done: 'Done — subjects loaded.' }));
    return { reply: `You have **${DB.subjects.length} subjects** in Notion:\n\n${DB.subjects.map((s) => `- ${s}`).join('\n')}`, tools };
  }

  /* ---- 9. Small talk / fallback ---- */
  if (/^(hi|hello|hey|salam|good (morning|evening|afternoon))/.test(t)) {
    const open = DB.homework.filter(openOnly).length;
    return { reply: `Hello! 👋 I'm **Disciplay AI**, your academic assistant.\n\nYou currently have **${open} open pieces of homework**. Ask me things like:\n\n- What's due today?\n- Add Chemistry homework: finish acids and bases by Monday\n- Move my Physics homework to Monday\n- Plan my week`, tools };
  }

  return {
    reply: `I can help you manage your Notion academic workspace. I'm not certain what you'd like me to do here — could you rephrase?\n\nThings I can do:\n\n1. **Read** — "What's due this week?", "Show my Biology tasks"\n2. **Create** — "Add Physics homework: questions 1–10 by tomorrow"\n3. **Update** — "Move my Chemistry homework to Sunday", "Mark Biology revision as done"\n4. **Delete** — "Delete the trigonometry task" (I'll always ask you to confirm)`,
    tools
  };
}
