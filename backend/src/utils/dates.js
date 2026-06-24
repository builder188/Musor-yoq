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
// period: 'today' | 'week' | 'month' | 'last_month' | 'year' | 'all'
export function periodRange(period) {
  const today = new Date();
  switch (period) {
    case 'today':
      return { from: startOfDay(today), to: endOfDay(today) };
    case 'week': {
      const from = startOfDay(today);
      const day = from.getDay() || 7; // Monday = 1, Sunday = 7
      from.setDate(from.getDate() - day + 1);
      return { from, to: endOfDay(today) };
    }
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

// Faqat soat:daqiqa (Asia/Tashkent) — eslatma matnlari uchun ("18:00").
export function formatTime(d) {
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat('uz-UZ', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(d));
  } catch {
    return '';
  }
}

// Sanani "Bugun" / "Ertaga" / "DD.MM.YYYY" ko'rinishida (Asia/Tashkent kun chegarasi bo'yicha).
// Eslatma matni "Bugun soat ..." aniq bo'lishi uchun — yarim tunni kesib o'tsa ham xato bermaydi.
export function dayWord(d, base = new Date()) {
  const target = formatDate(d);
  if (!target) return '';
  const tomorrow = new Date(base);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (target === formatDate(base)) return 'Bugun';
  if (target === formatDate(tomorrow)) return 'Ertaga';
  return target;
}

// Foydalanuvchi yozgan sana/vaqtni (nisbiy yoki aniq) Date ga aylantiradi.
// AI'ni chetlab o'tadigan joylar uchun (masalan reschedule). Aniqlab bo'lmasa null.
// Qo'llab-quvvatlaydi: "ertaga", "indinga", "bugun", "N kun/hafta/oy/soat/daqiqadan keyin",
// "ertaga soat 15:00", shuningdek ISO/standart "2026-06-25 14:00".
export function parseHumanDateTime(input, base = new Date()) {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (input === null || input === undefined) return null;
  const text = String(input).toLowerCase().trim();
  if (!text) return null;

  const result = new Date(base);
  let dayShift = false;
  let timeShift = false;

  if (/\bertaga\b/.test(text)) {
    result.setDate(result.getDate() + 1);
    dayShift = true;
  } else if (/\b(indin|indinga|indinaga)\b/.test(text)) {
    result.setDate(result.getDate() + 2);
    dayShift = true;
  } else if (/\bbugun\b/.test(text)) {
    dayShift = true;
  }

  // "N kun/hafta/oy/soat/daqiqa(dan keyin)".
  const rel = text.match(/(\d+)\s*(kun|hafta|oy|soat|daqiqa|minut)/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    switch (rel[2]) {
      case 'kun': result.setDate(result.getDate() + n); dayShift = true; break;
      case 'hafta': result.setDate(result.getDate() + n * 7); dayShift = true; break;
      case 'oy': result.setMonth(result.getMonth() + n); dayShift = true; break;
      case 'soat': result.setHours(result.getHours() + n); timeShift = true; break;
      default: result.setMinutes(result.getMinutes() + n); timeShift = true; break; // daqiqa/minut
    }
  }

  // Nisbiy so'z umuman topilmadi — to'g'ridan-to'g'ri sana sifatida o'qiymiz.
  if (!dayShift && !timeShift) {
    const direct = new Date(text.replace(' ', 'T'));
    return Number.isNaN(direct.getTime()) ? null : direct;
  }

  // Aniq vaqt ("ertaga 15:00", "indinga soat 9") berilgan bo'lsa qo'llaymiz.
  const hm = text.match(/(\d{1,2})[:.](\d{2})/);
  const soatOnly = text.match(/\bsoat\s*(\d{1,2})(?![\d:.])/);
  if (hm && Number(hm[1]) < 24 && Number(hm[2]) < 60) {
    result.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
    timeShift = true;
  } else if (soatOnly && Number(soatOnly[1]) < 24) {
    result.setHours(Number(soatOnly[1]), 0, 0, 0);
    timeShift = true;
  } else if (dayShift && !timeShift) {
    result.setHours(9, 0, 0, 0); // kun siljidi, vaqt aytilmagan -> 09:00
  }
  result.setSeconds(0, 0);
  return result;
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
