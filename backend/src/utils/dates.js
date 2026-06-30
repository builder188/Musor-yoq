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

// Berilgan sanani mahalliy (TZ) vaqt sifatida ofset bilan ISO ko'rinishida beradi —
// "2026-06-29T16:00:00+05:00". UTC 'Z' o'rniga shu ishlatiladi, shunda AI vaqtni
// mahalliy (Asia/Tashkent) deb tushunadi va soatni xato (UTC) chiqarmaydi.
export function localIsoWithOffset(date = new Date(), timeZone = TZ) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour; // ba'zi muhitlar 24:00 beradi
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second);
  const offMin = Math.round((asUTC - date.getTime()) / 60000);
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}${sign}${oh}:${om}`;
}

// Foydalanuvchi matnidan ANIQ soat (va daqiqa) ni ajratadi: "soat 11", "soat 11:30",
// "11:00", "11.30". Topilmasa null. Sana raqamlari (29.06.2026) bilan adashmaslik uchun
// HH.MM dan keyin yana nuqta/raqam kelmasligini tekshiramiz.
export function extractClockTime(input) {
  const text = String(input || '').toLowerCase();
  // HH:MM yoki HH.MM (sana emas — keyin yana .DD kelmasligi shart).
  const hm = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(?![.\d])/);
  if (hm) return { hour: Number(hm[1]), minute: Number(hm[2]) };
  // "soat 11", "соат 9" (daqiqasiz) — keyin raqam/nuqta/ikki nuqta kelmasligi shart.
  const soat = text.match(/(?:soat|соат)\s*([01]?\d|2[0-3])(?![\d:.])/);
  if (soat) return { hour: Number(soat[1]), minute: 0 };
  return null;
}

// AI bergan serviceDateTime ni — vaqt mintaqasini xato (UTC) bergan bo'lsa, ya'ni
// "soat 11" -> 16:00 (Asia/Tashkent) ko'rinib qolsa — foydalanuvchi AYTGAN aniq soatga
// to'g'rilaydi. Faqat matnda aniq soat bo'lganda ishlaydi; aks holda model qiymati
// o'zgarmaydi. Jarayon TZ = Asia/Tashkent, shu sabab getHours()/setHours() mahalliy soat.
export function correctServiceDateTime(serviceDateTime, rawText) {
  const clock = extractClockTime(rawText);
  if (!clock) return serviceDateTime; // aniq soat aytilmagan — modelga ishonamiz

  // Kun so'zi (bugun/ertaga/indin) + aniq soat bo'lsa — to'liq deterministik hisob.
  const parsed = parseHumanDateTime(rawText);
  if (parsed && parsed.getHours() === clock.hour && parsed.getMinutes() === clock.minute) {
    return parsed.toISOString();
  }

  // Aks holda model bergan SANAga aniq soatni mahalliy vaqtda o'rnatamiz.
  const base = serviceDateTime ? new Date(serviceDateTime) : parsed || new Date();
  if (Number.isNaN(base.getTime())) return serviceDateTime;
  if (base.getHours() === clock.hour && base.getMinutes() === clock.minute) {
    return serviceDateTime || base.toISOString(); // allaqachon to'g'ri
  }
  base.setHours(clock.hour, clock.minute, 0, 0);
  return base.toISOString();
}

// Oy nomi -> indeks (0=yanvar). O'zbek (lotin) + ruscha (genitiv) variantlar.
const MONTH_NAMES = {
  yanvar: 0, fevral: 1, mart: 2, aprel: 3, may: 4, iyun: 5, iyul: 6,
  avgust: 7, sentyabr: 8, sentabr: 8, oktyabr: 9, noyabr: 10, dekabr: 11,
  yanvarya: 0, fevralya: 1, marta: 2, aprelya: 3, maya: 4, iyunya: 5, iyulya: 6,
  avgusta: 7, sentyabrya: 8, oktyabrya: 9, noyabrya: 10, dekabrya: 11,
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5, июля: 6,
  августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
};
const MONTH_RE = new RegExp(`\\b(\\d{1,2})[-\\s]*(${Object.keys(MONTH_NAMES).join('|')})`, 'i');

// Aniq o'zbekcha/ruscha "30 iyun", "30-iyunda", "5 may", "30 июня" sanasini Date ga aylantiradi.
// Eslatma (dueDate) uchun — sana o'tib ketgan bo'lsa kelasi yilga suriladi (kelajakdagi eslatma).
// parseHumanDateTime nisbiy/ISO ni eplaydi; bu esa o'zbek oy nomli sanalarni qo'shimcha qoplaydi.
// MUHIM: faqat qarz dueDate oqimida ishlatiladi — xizmat (correctServiceDateTime/reschedule) tegmaydi.
export function parseUzbekDate(input, base = new Date()) {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  const text = String(input || '').toLowerCase().trim();
  if (!text) return null;
  const m = text.match(MONTH_RE);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTH_NAMES[m[2]];
  if (!(day >= 1 && day <= 31) || month === undefined) return null;

  const result = new Date(base);
  result.setMonth(month, day);
  const clock = extractClockTime(text);
  if (clock) result.setHours(clock.hour, clock.minute, 0, 0);
  else result.setHours(9, 0, 0, 0);
  result.setSeconds(0, 0);
  if (Number.isNaN(result.getTime())) return null;
  // O'tib ketgan KUN (bugundan oldingi sana) -> kelasi yil. Kun bo'yicha solishtiramiz,
  // shunda "30 iyun" bugun bo'lsa (lekin 9:00 o'tgan) kelasi yilga sakramaydi — bugun qoladi.
  const resultDay = new Date(result); resultDay.setHours(0, 0, 0, 0);
  const baseDay = new Date(base); baseDay.setHours(0, 0, 0, 0);
  if (resultDay.getTime() < baseDay.getTime()) result.setFullYear(result.getFullYear() + 1);
  return result;
}

// AI uchun joriy kontekst (nisbiy sanalarni hal qilishda yordam beradi).
export function nowContext() {
  const d = new Date();
  // ISO ni UTC (Z) emas, mahalliy (Asia/Tashkent, +05:00) ofset bilan beramiz —
  // shunda model vaqtni mahalliy deb chiqaradi, "soat 11" -> 16:00 xatosi bo'lmaydi.
  const iso = localIsoWithOffset(d, TZ);
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
