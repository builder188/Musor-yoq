// Sana/vaqt yordamchilari (Asia/Tashkent mintaqasi).
import env from '../config/env.js';

const TZ = env.TZ || 'Asia/Tashkent';

// Hozirgi vaqt.
export function now() {
  return new Date();
}

// Berilgan sananing kun boshi (00:00) — mahalliy mintaqada.
export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function startOfMonth(d = new Date()) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfMonth(d = new Date()) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function startOfYear(d = new Date()) {
  const x = new Date(d);
  x.setMonth(0, 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Davr nomidan {from, to} oralig'ini qaytaradi.
// period: 'today' | 'month' | 'last_month' | 'year' | 'all'
export function periodRange(period) {
  const today = new Date();
  switch (period) {
    case 'today':
      return { from: startOfDay(today), to: endOfDay(today) };
    case 'month':
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case 'last_month': {
      const lastMonth = new Date(today);
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    }
    case 'year':
      return { from: startOfYear(today), to: endOfDay(today) };
    case 'all':
    default:
      return { from: new Date(0), to: endOfDay(today) };
  }
}

// O'zbekcha sana-vaqt formati: "08.06.2026 10:00"
export function formatDateTime(d) {
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat('uz-UZ', {
      timeZone: TZ,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(d));
  } catch {
    return new Date(d).toISOString();
  }
}

export function formatDate(d) {
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat('uz-UZ', {
      timeZone: TZ,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(d));
  } catch {
    return new Date(d).toISOString().slice(0, 10);
  }
}

// AI uchun joriy kontekst (nisbiy sanalarni hal qilishda yordam beradi).
export function nowContext() {
  const d = new Date();
  const iso = d.toISOString();
  const human = new Intl.DateTimeFormat('uz-UZ', {
    timeZone: TZ,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return { iso, human, timezone: TZ };
}
