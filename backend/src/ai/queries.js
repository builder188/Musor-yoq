// Standartlashtirilgan AI o'qish-so'rovlari (balans, mijozlar, xizmatlar, keyingi mijoz).
//
// MUHIM (umumiy modul): Telegram bot (matn/ovoz) HAM, Mini App AI chat paneli (matn) HAM
// SHU yagona modulni chaqiradi — `agent.runAgent` ikkala interfeys uchun ham `answerReadQuery`'ni
// ishlatadi. Shu sababli shablon va mantiq bir joyda, takrorlanmaydi.
//
// Javoblar DETERMINISTIK shablon (Gemini qayta yozmaydi) — aniq format, tez. Mos kelmasa
// `null` qaytaradi va chaqiruvchi umumiy qidiruvga (executeToolFlow) o'tadi.
import { getBalanceReport } from '../services/financeService.js';
import {
  getTodayPendingServices,
  getNextClient,
  pickNearestByTime,
} from '../services/serviceService.js';
import { formatMoney } from '../utils/money.js';
import { formatDate, formatDateTime, formatTime } from '../utils/dates.js';

// Xarajat toifasi -> ko'rsatiladigan o'zbekcha nom (balans hisobotidagi xarajat satrlari uchun).
const CATEGORY_LABEL = {
  yoqilgi: "Yoqilg'i",
  tamirlash: "Ta'mirlash",
  'oziq-ovqat': 'Oziq-ovqat',
  boshqa_chiqim: 'Boshqa',
};

const PERIOD_LABEL = {
  today: 'bugun',
  week: 'bu hafta',
  month: 'bu oy',
  last_month: "o'tgan oy",
  year: 'bu yil',
  all: 'umumiy',
};

const KEYCAP_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
function listNumber(i) {
  return KEYCAP_EMOJI[i] || `${i + 1}.`;
}

// Balans davri: davr aytilmasa — JORIY (umumiy) balans.
function balancePeriod(fields = {}) {
  const p = fields?.analyticsPeriod;
  if (p && ['today', 'week', 'month', 'last_month', 'year', 'all'].includes(p)) return p;
  return 'all';
}

const addressOf = (s) => s?.location?.address || '-';

// ── Detection (qaysi shablon) ────────────────────────────────────────────────
// Umumiy qoidalar: aniq sana filtri (dateFrom/dateTo) bo'lsa — bu standart "bugungi"
// so'rov emas, oddiy qidiruv. O'tgan zamon ("borganman") yoki aniq joy ("Chilonzordagi")
// ham bu yerda emas — umumiy qidiruvga tushadi.

// 4. KEYINGI MIJOZ: "Endi qaysi mijoz uyiga boraman?", "hozir qayerga borish kerak",
// "keyingi mijoz kim". Bitta — eng yaqin — mijozni batafsil qaytaradi.
function looksLikeNextClient(rawText = '', fields = {}) {
  if (fields?.dateFrom || fields?.dateTo) return false;
  const v = String(rawText || '').toLowerCase();
  if (/\bkeyingi\b[\s\S]{0,16}\b(mijoz|ish|manzil|uy|joy|borish)/.test(v)) return true;
  if (/\bborish\s+vaqti/.test(v)) return true;
  // "endi/hozir/qaysi/kim/qayer ... bor(ish|a)" — kelasi/hozirgi zamon (o'tgan "borganman" emas).
  if (/(endi|hozir|qaysi|kim|qayer)\w*\b[\s\S]{0,20}\bbor(ish|a)/.test(v)) return true;
  return false;
}

// 2. MIJOZLAR: "mijozlar haqida ma'lumot", "bugungi mijozlar", "navbatdagi mijozlar".
function looksLikeTodayClients(rawText = '', fields = {}) {
  if (fields?.dateFrom || fields?.dateTo) return false;
  const v = String(rawText || '').toLowerCase();
  if (/\bnavbat(dagi|da|im)?\b/.test(v)) return true;
  if (/\bbugun(gi)?\b[\s\S]{0,15}\bmijoz/.test(v)) return true;
  if (
    /\bmijoz(lar|im|larim)?\b/.test(v) &&
    /(bugun|hozir|haqida|royxat|ro['’]?yxat|malumot|ma['’]?lumot|kim|qaysi|necha)/.test(v)
  ) {
    return true;
  }
  return false;
}

// 3. XIZMATLAR: "xizmatlar haqida", "bugungi xizmatlar", "bugun qanday ishlarim bor".
// "mijoz" emas — "xizmat/ish/reja" so'zlariga tayanadi (MIJOZLAR'dan kalit so'z bo'yicha ajraladi).
function looksLikeTodayServices(rawText = '', fields = {}) {
  if (fields?.dateFrom || fields?.dateTo) return false;
  const v = String(rawText || '').toLowerCase();
  if (/\bbugun(gi)?\b[\s\S]{0,15}\b(xizmat|ish|reja)/.test(v)) return true;
  if (
    /\b(xizmat(lar|im|larim)?|ish(lar|im|larim)?|reja(m|lar|larim)?)\b/.test(v) &&
    /(bugun|hozir|haqida|royxat|ro['’]?yxat|malumot|ma['’]?lumot|qaysi|qanday|necha|qancha|bor)/.test(v)
  ) {
    return true;
  }
  return false;
}

// ── Shablon quruvchilar ──────────────────────────────────────────────────────

// 1. BALANS SO'ROVI — boy hisobot (real aggregatsiyadan).
async function buildBalanceReport(period) {
  const r = await getBalanceReport(period);
  const lines = [
    `💰 Balans hisoboti (${PERIOD_LABEL[period] || 'umumiy'})`,
    '',
    `💵 Umumiy balans: ${formatMoney(r.balance || 0)}`,
    `📈 Kirim: ${formatMoney(r.income || 0)}`,
    `📉 Chiqim: ${formatMoney(r.expense || 0)}`,
    '',
  ];
  if (r.biggestExpense) {
    lines.push(
      `🔺 Eng katta xarajat: ${formatMoney(r.biggestExpense.amount)} (${CATEGORY_LABEL[r.biggestExpense.category] || 'Boshqa'}, ${formatDate(r.biggestExpense.date)})`
    );
  }
  if (r.smallestExpense) {
    lines.push(
      `🔻 Eng kichik xarajat: ${formatMoney(r.smallestExpense.amount)} (${CATEGORY_LABEL[r.smallestExpense.category] || 'Boshqa'}, ${formatDate(r.smallestExpense.date)})`
    );
  }
  if (r.topService) {
    lines.push(
      `🏆 Eng qimmat xizmat: ${r.topService.clientName || 'mijoz'} — ${formatMoney(r.topService.price)} (${formatDateTime(r.topService.date)})`
    );
  }
  lines.push(`✅ Bajarilgan xizmatlar: ${r.doneCount} ta`);
  lines.push(`⏳ Kutilayotgan xizmatlar: ${r.pendingCount} ta`);
  return { text: lines.join('\n'), tool: 'balance_report' };
}

// 2. MIJOZLAR SO'ROVI — bugungi mijozlar (ism + soat + manzil) + eng yaqin mijoz tavsiyasi.
async function buildTodayClientsReport() {
  const services = await getTodayPendingServices();
  if (!services.length) {
    return { text: 'Bugun uchun barcha ishlar tugadi oka 🎉', tool: 'today_clients' };
  }
  const lines = services.map(
    (s, i) => `${listNumber(i)} ${s.clientName || 'Nomsiz'} — ${formatTime(s.serviceDateTime)} — 📍${addressOf(s)}`
  );
  const nearest = pickNearestByTime(services);
  const text = [
    "Ha bo'ldi oka, mana mijozlar haqida ma'lumot 📋",
    '',
    'Bugungi mijozlar:',
    ...lines,
    '',
    `👉 Hozir siz ${nearest.clientName || 'mijoz'} xizmatiga borishingiz kerak`,
  ].join('\n');
  return { text, tool: 'today_clients' };
}

// 3. XIZMATLAR SO'ROVI — qisqaroq ko'rinish (faqat soat + manzil, ism/tel yo'q) + tavsiya.
async function buildTodayServicesReport() {
  const services = await getTodayPendingServices();
  if (!services.length) {
    return { text: 'Bugun uchun barcha ishlar tugadi oka 🎉', tool: 'today_services' };
  }
  const lines = services.map(
    (s, i) => `${listNumber(i)} ${formatTime(s.serviceDateTime)} — 📍${addressOf(s)}`
  );
  const nearest = pickNearestByTime(services);
  const text = [
    `📦 Bugun ${services.length} ta ish bor oka:`,
    '',
    ...lines,
    '',
    `👉 Hozir ${nearest.clientName || 'mijoz'} ga borish vaqti keldi`,
  ].join('\n');
  return { text, tool: 'today_services' };
}

// 4. KEYINGI MIJOZ — get_next_client(): bugungi, kutilmoqda, joriy vaqtga eng yaqin BITTA mijoz.
async function buildNextClientReport() {
  const s = await getNextClient();
  if (!s) {
    return { text: 'Bugun uchun barcha ishlar tugadi oka 🎉', tool: 'next_client' };
  }
  const text = [
    `👉 Hozir ${s.clientName || 'mijoz'} ga borishingiz kerak, oka`,
    `📍 ${addressOf(s)}  💰 ${formatMoney(s.price)}  ⏰ soat ${formatTime(s.serviceDateTime)}`,
  ].join('\n');
  return { text, tool: 'next_client' };
}

// ── Oddiy suhbat (salom / rahmat / xayr / ahvol) ─────────────────────────────
// Egasi shunchaki salomlashsa yoki rahmat aytsa, dastur buni QIDIRUV deb o'ylamasligi
// kerak ("hech narsa topilmadi" javobi xato edi). Bunday xabarlarga iliq, qisqa javob.
// Juda ehtiyotkor: raqam yoki ma'lumotga ishora (qancha, mijoz, balans, manzil...) bo'lsa —
// suhbat EMAS, oddiy qidiruv/savol sifatida o'tkazib yuboramiz.
// Diqqat: stemlar (qalays-, yaxshimi-) trailing \b SIZ — qo'shimchali shakllarni
// ham ushlash uchun ("qalaysiz", "yaxshimisiz"). "xayr" (xayrlashuv) ESA \bxayr\b —
// "xayrli kun" (salomlashuv) bilan chalkashmasin.
const SMALL_TALK = [
  { cat: 'thanks', re: /\b(rahmat|raxmat|rahmet|rhmat|rhamat|rakhmat|tashakkur|minnatdor)\b/ },
  { cat: 'bye', re: /(\bxayr\b|ko'rishg|korishg|salomat\s*bo|omon\s*bo)/ },
  { cat: 'howareyou', re: /\b(qalays|yaxshimi|naxshimi|ishlaring|tinchlik)/ },
  { cat: 'greeting', re: /\b(assalom|salom|alik|alaykum|hayrli|xayrli)/ },
  { cat: 'ack', re: /^(zo'?r|ok(ay)?|mayli|xo'?p|yaxshi|barakalla|super)\b/ },
];

const SMALL_TALK_REPLY = {
  thanks: "Arzimaydi oka! 😊 Yana biror narsa kerak bo'lsa shu yerdaman.",
  bye: "Xayr oka, omon bo'ling! 👋",
  howareyou: "Rahmat oka, men joyidaman! 😊 Ishlar bo'yicha nima kerak — mijoz, xizmat, xarajat yoki hisobot?",
  greeting: "Va alaykum assalom oka! 👋 Xizmatingizdaman — mijoz, xizmat, xarajat yoki hisobot bo'yicha nima kerak?",
  ack: 'Xizmatingizdaman oka 😊',
};

function smallTalkReply(rawText = '') {
  const v = String(rawText || '').toLowerCase().trim();
  if (!v) return null;
  if (/\d/.test(v)) return null; // raqam bor — suhbat emas
  // Ma'lumotga ishora bo'lgan gap (qidiruv/savol/yozuv) — suhbat emas. Biznes so'zlari STEM
  // sifatida tekshiriladi (qo'shimchali shakllar ham: "mijozlar", "xizmatlar", "narxi") —
  // trailing \b qo'yilsa "mijozlar" tushib qolib, "salom mijozlar" xato suhbat bo'lardi.
  if (/(qancha|nechta|necha|qachon|qayer|qaysi|balans|foyda|daromad|xarajat|qarz|mijoz|xizmat|hisob|royxat|ro'yxat|manzil|narx|telefon|kirim|chiqim|to'lov|tolov)/.test(v)) {
    return null;
  }
  // Qisqa, ko'p ma'noli so'zlar faqat butun so'z sifatida bloklaydi.
  if (/\b(kim|bor)\b/.test(v)) return null;
  const words = v.split(/\s+/).filter(Boolean);
  if (words.length > 6) return null; // uzun gap — ehtimol haqiqiy so'rov
  for (const { cat, re } of SMALL_TALK) {
    if (cat === 'ack' && words.length > 3) continue; // "ok/zo'r" faqat qisqa tasdiq sifatida
    if (re.test(v)) return { text: SMALL_TALK_REPLY[cat], tool: 'small_talk' };
  }
  return null;
}

// Yagona kirish nuqtasi — bot va Mini App ikkalasi shu orqali javob oladi.
// Standart shablon yoki suhbatga mos kelsa {text, tool}, aks holda null (umumiy qidiruvga o'tadi).
export async function answerReadQuery({ rawText = '', fields = {}, isAnalytics = false } = {}) {
  if (isAnalytics) return buildBalanceReport(balancePeriod(fields));
  if (looksLikeNextClient(rawText, fields)) return buildNextClientReport();
  if (looksLikeTodayClients(rawText, fields)) return buildTodayClientsReport();
  if (looksLikeTodayServices(rawText, fields)) return buildTodayServicesReport();
  // Data shabloniga mos kelmadi — oddiy salom/rahmat/xayr bo'lsa qidiruv emas, iliq javob.
  const chat = smallTalkReply(rawText);
  if (chat) return chat;
  return null;
}

export default { answerReadQuery };
