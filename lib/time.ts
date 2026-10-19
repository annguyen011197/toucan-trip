import { LOCALE, translator, type Lang } from "./i18n";

/** Accepts "9", "9am", "9:30 pm", "09:30", "21:05" → "HH:mm" */
export function normalizeTime(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase().replace(/[\s.]/g, "");
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm|h)?$/);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (m[3] === "pm" && hour < 12) hour += 12;
  if (m[3] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 24 * 60;
}

/** "09:30 AM" in English; Vietnamese uses the 24h clock ("09:30"). */
export function displayTime(hhmm: string, lang: Lang = "en"): string {
  const total = minutesOf(hhmm);
  if (total >= 24 * 60) return hhmm;
  const h = Math.floor(total / 60), m = total % 60;
  if (lang === "vi") return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// Dates are stored as "yyyy-MM-dd" strings (timezone-safe).
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseISODate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso)!;
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysBetween(a: string, b: string): number {
  const da = parseISODate(a)!, db = parseISODate(b)!;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDateRange(start?: string, end?: string, lang: Lang = "en"): string {
  const s = parseISODate(start);
  if (!s) return translator(lang)("common.datesTbd");
  const e = parseISODate(end);
  if (lang === "vi") {
    const fmt = (d: Date) => d.toLocaleDateString(LOCALE.vi, { day: "numeric", month: "short" }); // "12 thg 3"
    if (!e) return fmt(s);
    return `${e.getMonth() === s.getMonth() && e.getFullYear() === s.getFullYear() ? s.getDate() : fmt(s)} - ${fmt(e)}`;
  }
  const left = `${MONTHS[s.getMonth()]} ${s.getDate()}`;
  if (!e) return left;
  const right = e.getMonth() === s.getMonth() && e.getFullYear() === s.getFullYear() ? `${e.getDate()}` : `${MONTHS[e.getMonth()]} ${e.getDate()}`;
  return `${left} - ${right}`;
}

export function formatLongDate(iso?: string, lang: Lang = "en"): string {
  const d = parseISODate(iso);
  if (!d) return "";
  return d.toLocaleDateString(LOCALE[lang], { weekday: "long", month: "long", day: "numeric" });
}

export function monthName(offset: number, lang: Lang = "en"): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return lang === "vi" ? `tháng ${d.getMonth() + 1}` : MONTHS[d.getMonth()];
}

/** Tiny natural-language date parser for the offline engine. */
export function parseDates(text: string, now = new Date()): { start?: string; days?: number } {
  const lower = text.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let days: number | undefined;
  let start: Date | undefined;

  const dur = lower.match(/(\d+)\s*(day|night|week)/);
  if (dur) {
    const n = Number(dur[1]);
    days = dur[2] === "week" ? n * 7 : dur[2] === "night" ? n + 1 : n;
  } else if (lower.includes("weekend")) days = 3;
  else if (lower.includes("week")) days = 7;

  if (lower.includes("next weekend") || lower.includes("this weekend")) {
    const d = new Date(today);
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
    if (lower.includes("next weekend") && (d.getTime() - today.getTime()) / 86_400_000 < 3) d.setDate(d.getDate() + 7);
    start = d;
  } else if (lower.includes("next month")) {
    start = new Date(today.getFullYear(), today.getMonth() + 1, 10);
  } else if (lower.includes("tomorrow")) {
    start = new Date(today); start.setDate(start.getDate() + 1);
  } else if (/in\s+(\d+)\s+weeks?/.test(lower)) {
    const n = Number(lower.match(/in\s+(\d+)\s+weeks?/)![1]);
    start = new Date(today); start.setDate(start.getDate() + n * 7);
  } else if (/\d{4}-\d{2}-\d{2}/.test(lower)) {
    start = parseISODate(lower.match(/\d{4}-\d{2}-\d{2}/)![0]);
  } else {
    const months = MONTHS.map((m) => m.toLowerCase());
    for (let i = 0; i < 12; i++) {
      const re = new RegExp(`\\b${months[i]}[a-z]*\\b`);
      if (!re.test(lower)) continue;
      let dayNum = 10;
      const after = lower.match(new RegExp(`\\b${months[i]}[a-z]*\\.?\\s*(\\d{1,2})\\b`));
      const before = lower.match(new RegExp(`\\b(\\d{1,2})\\s*${months[i]}`));
      if (after) dayNum = Number(after[1]); else if (before) dayNum = Number(before[1]);
      let d = new Date(today.getFullYear(), i, dayNum);
      if (d < today) d = new Date(today.getFullYear() + 1, i, dayNum);
      start = d;
      break;
    }
  }
  return { start: start ? toISODate(start) : undefined, days };
}
