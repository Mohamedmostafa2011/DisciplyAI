/**
 * dates.js — timezone-aware natural-language date helpers.
 * Never invents a date: returns null when a phrase is ambiguous.
 */
import { CONFIG } from './config.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Today's date in the configured timezone, as YYYY-MM-DD. */
export function todayISO(tz = CONFIG.TIMEZONE) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date());
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(iso) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/** Friendly label: Today / Tomorrow / Mon 8 Sep. */
export function label(iso, base = todayISO()) {
  if (!iso) return 'No date';
  const day = iso.slice(0, 10);
  if (day === base) return 'Today';
  if (day === addDays(base, 1)) return 'Tomorrow';
  if (day === addDays(base, -1)) return 'Yesterday';
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString(CONFIG.LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function longLabel(iso, base = todayISO()) {
  if (!iso) return 'No date';
  const rel = label(iso, base);
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const full = d.toLocaleDateString(CONFIG.LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return ['Today', 'Tomorrow', 'Yesterday'].includes(rel) ? `${rel} (${full})` : full;
}

/**
 * Parse a natural-language date phrase.
 * @returns {string|null} YYYY-MM-DD or null when nothing confident was found.
 */
export function parseDate(text, base = todayISO()) {
  if (!text) return null;
  const t = ` ${text.toLowerCase()} `;

  if (/\btoday\b|\btonight\b/.test(t)) return base;
  if (/\btomorrow\b|\btmrw\b/.test(t)) return addDays(base, 1);
  if (/\bday after tomorrow\b/.test(t)) return addDays(base, 2);
  if (/\byesterday\b/.test(t)) return addDays(base, -1);

  // ISO date
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 12/09 or 12/09/2026 (day-first, matching en-GB locale)
  const slash = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const d = +slash[1], m = +slash[2];
    let y = slash[3] ? +slash[3] : +base.slice(0, 4);
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // "5 September" / "September 5" / "5th Sep"
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const mRe = new RegExp(`\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+)?(${months.map(m=>m.slice(0,3)).join('|')})[a-z]*\\.?(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?)?\\b`);
  const mm = t.match(mRe);
  if (mm && (mm[1] || mm[3])) {
    const monthIdx = months.findIndex((m) => m.startsWith(mm[2]));
    const day = +(mm[1] || mm[3]);
    let year = +base.slice(0, 4);
    const cand = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return cand < base ? `${year + 1}${cand.slice(4)}` : cand;
  }

  // "this weekend"
  if (/\bthis weekend\b|\bweekend\b/.test(t)) {
    let d = base;
    for (let i = 0; i < 7; i++) { if (weekdayOf(d) === 6) return d; d = addDays(d, 1); }
  }

  // "next week" -> next Monday
  if (/\bnext week\b/.test(t)) return nextWeekday(base, 1, true);

  // "in 3 days"
  const inN = t.match(/\bin (\d{1,2}) days?\b/);
  if (inN) return addDays(base, +inN[1]);

  // weekday names, optionally prefixed by next/this
  for (let i = 0; i < 7; i++) {
    const re = new RegExp(`\\b(next |this |on )?${DAYS[i]}\\b`);
    const m = t.match(re);
    if (m) return nextWeekday(base, i, (m[1] || '').trim() === 'next');
  }
  return null;
}

function nextWeekday(base, target, forceNextWeek) {
  let diff = (target - weekdayOf(base) + 7) % 7;
  if (diff === 0) diff = 7;                 // "Monday" on a Monday means the next one
  if (forceNextWeek && diff < 7) diff += 0; // "next Monday" -> the upcoming Monday
  return addDays(base, diff);
}

/** Inclusive [start,end] range for "this week" / "next week" / "today". */
export function parseRange(text, base = todayISO()) {
  const t = ` ${text.toLowerCase()} `;
  if (/\bthis week\b|\bthe week\b/.test(t)) {
    const monday = addDays(base, -(((weekdayOf(base) + 6) % 7)));
    return { start: base < monday ? monday : base, end: addDays(monday, 6), name: 'this week' };
  }
  if (/\bnext week\b/.test(t)) {
    const monday = addDays(base, -(((weekdayOf(base) + 6) % 7)) + 7);
    return { start: monday, end: addDays(monday, 6), name: 'next week' };
  }
  if (/\bthis weekend\b/.test(t)) {
    const sat = parseDate('this weekend', base);
    return { start: sat, end: addDays(sat, 1), name: 'this weekend' };
  }
  const single = parseDate(text, base);
  if (single) return { start: single, end: single, name: label(single, base).toLowerCase() };
  return null;
}
