// Daromad manbalari taksonomiyasi — YAGONA MANBA (bot, API, hisobotlar shu yerdan oladi).
//
// Har bir kirim (income) tranzaksiyasi qaysi manbadan kelganini o'z `category` maydoni
// orqali aniq saqlaydi:
//   xizmat        -> SERVICE   (musor olib ketish xizmati)
//   material      -> MATERIAL  (paxta, mis va h.k. sotuvi)
//   buyum         -> ITEM      (televizor, divan va h.k. sotuvi)
//   boshqa_kirim  -> OTHER     (qo'lda kiritilgan boshqa kirim)
//
// MOSLASHUVCHANLIK: kelajakda yangi manba turi = (1) Transaction enum'iga yangi income
// kategoriyasi, (2) shu ro'yxatga BITTA qator. Boshqa joyni o'zgartirish shart emas —
// aggregatsiya, API va Mini App avtomatik yangi manbani ko'rsatadi.
import Transaction, { TX_TYPES } from '../models/Transaction.js';
import { periodRange } from '../utils/dates.js';

export const INCOME_SOURCES = [
  { key: 'service', category: 'xizmat', label: 'Xizmat', emoji: '🧹', hasQuantity: false },
  { key: 'material', category: 'material', label: 'Material', emoji: '♻️', hasQuantity: true },
  { key: 'item', category: 'buyum', label: 'Buyum', emoji: '📦', hasQuantity: false },
  { key: 'other', category: 'boshqa_kirim', label: 'Boshqa kirim', emoji: '💰', hasQuantity: false },
];

const CATEGORY_TO_SOURCE = new Map(INCOME_SOURCES.map((source) => [source.category, source.key]));
const OTHER_KEY = 'other';

// Kirim kategoriyasidan manba kalitini aniqlaydi. Noma'lum/eski/null kategoriya — 'other'.
export function incomeSourceKey(category) {
  return CATEGORY_TO_SOURCE.get(category) || OTHER_KEY;
}

// Manba kaliti bo'yicha meta (label/emoji) — bot javoblari va fallback uchun.
export function incomeSourceMeta(key) {
  return INCOME_SOURCES.find((source) => source.key === key) || INCOME_SOURCES.find((s) => s.key === OTHER_KEY);
}

// Davr bo'yicha kirimni MANBA bo'yicha ajratadi: har manba — jami summa + yozuvlar soni.
// Taksonomiyaga tushmagan (noma'lum) kategoriyalar 'other'ga qo'shiladi (yo'qotishsiz).
// Tenant plugin aggregate'ni avtomatik scope qiladi.
export async function getIncomeBySource(period = 'all') {
  const { from, to } = periodRange(period);
  const rows = await Transaction.aggregate([
    { $match: { isDeleted: { $ne: true }, type: TX_TYPES.INCOME, date: { $gte: from, $lte: to } } },
    { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);

  const byCategory = new Map(rows.map((row) => [row._id, row]));
  const sources = INCOME_SOURCES.map((source) => {
    const row = byCategory.get(source.category);
    return {
      key: source.key,
      category: source.category,
      label: source.label,
      emoji: source.emoji,
      hasQuantity: source.hasQuantity,
      total: row?.total || 0,
      count: row?.count || 0,
    };
  });

  // Ro'yxatda yo'q kategoriyalar (kelajakdagi yangi yoki eski/null) — 'other'ga qo'shamiz.
  const other = sources.find((source) => source.key === OTHER_KEY);
  for (const row of rows) {
    if (!CATEGORY_TO_SOURCE.has(row._id)) {
      other.total += row.total;
      other.count += row.count;
    }
  }

  const totalIncome = sources.reduce((sum, source) => sum + source.total, 0);
  return { period, from, to, totalIncome, sources };
}

// Manba sotuvga (material+buyum) tegishli ekanligini bildiradi — hisobotda
// "xizmat vs sotuv" foizini hisoblash uchun.
const SALES_KEYS = new Set(['material', 'item']);

// OYLIK breakdown (PDF/Excel hisobot uchun): davrning har bir oyi bo'yicha — nechta
// xizmat (income yozuvi soni), jami kirim, va manba bo'yicha summa+foiz. Hisobotning
// "necha foizi xizmatdan, necha foizi material/buyum sotuvidan" tahlilining manbai.
// Til/format YO'Q (oy nomi va h.k. — render qatlami localize qiladi). from/to bo'lmasa
// butun tarix oylar bo'yicha qaytariladi.
export async function getMonthlyIncomeBreakdown({ from = null, to = null } = {}) {
  const match = { isDeleted: { $ne: true }, type: TX_TYPES.INCOME };
  if (from || to) {
    match.date = {};
    if (from) match.date.$gte = from;
    if (to) match.date.$lte = to;
  }

  const rows = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: { y: { $year: '$date' }, m: { $month: '$date' }, cat: '$category' },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  // Oy bo'yicha guruhlash (y-m kalit).
  const months = new Map();
  for (const row of rows) {
    const key = `${row._id.y}-${String(row._id.m).padStart(2, '0')}`;
    if (!months.has(key)) months.set(key, { year: row._id.y, month: row._id.m, byCategory: new Map(), total: 0 });
    const bucket = months.get(key);
    bucket.byCategory.set(row._id.cat, { total: row.total, count: row.count });
    bucket.total += row.total;
  }

  return [...months.values()]
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map((bucket) => buildMonthRow(bucket));
}

function buildMonthRow(bucket) {
  const total = bucket.total;
  const pctOf = (value) => (total > 0 ? (value / total) * 100 : 0);

  const sources = INCOME_SOURCES.map((source) => {
    const row = bucket.byCategory.get(source.category) || { total: 0, count: 0 };
    return { key: source.key, total: row.total, count: row.count, pct: pctOf(row.total) };
  });

  // Taksonomiyaga kirmagan kategoriyalarni 'other'ga yig'amiz (forward-compatible).
  const other = sources.find((source) => source.key === 'other');
  for (const [category, row] of bucket.byCategory.entries()) {
    if (!CATEGORY_TO_SOURCE.has(category)) {
      other.total += row.total;
      other.count += row.count;
    }
  }
  other.pct = pctOf(other.total);

  const service = sources.find((source) => source.key === 'service');
  const salesTotal = sources.filter((source) => SALES_KEYS.has(source.key)).reduce((sum, source) => sum + source.total, 0);

  return {
    year: bucket.year,
    month: bucket.month,
    servicesCount: service.count,
    totalIncome: total,
    sources,
    servicePct: service.pct,
    salesTotal,
    salesPct: pctOf(salesTotal),
    otherTotal: other.total,
    otherPct: other.pct,
  };
}

export default {
  INCOME_SOURCES,
  incomeSourceKey,
  incomeSourceMeta,
  getIncomeBySource,
  getMonthlyIncomeBreakdown,
};
