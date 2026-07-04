// Kategoriyalar boshqaruvi — Mini App "Kategoriyalar" bo'limi va bot uchun yagona manba.
// Uch xil kategoriya: (1) MATERIAL kategoriyalari (Paxta, Taxta, ... + foydalanuvchi yaratgan),
// (2) "Kerakli buyumlar" — dona buyumlar (UsefulItem), (3) XARAJAT kategoriyalari — DINAMIK
// (Yoqilg'i, Ta'mirlash, Oziq-ovqat + egasi aytgan istalgan nom: "Benzin", "Svalka", ...).
// Toifasiz kirim-chiqimlar "Boshqa kirim-chiqimlar" bo'limida saqlanadi. Yangi kategoriya
// yaratilganda bot orqali egaga xabar beriladi.
import Transaction, {
  TX_TYPES,
  MATERIAL_CATEGORY,
  OTHER_EXPENSE_CATEGORY,
  OTHER_INCOME_CATEGORY,
} from '../models/Transaction.js';
import UsefulItem, { USEFUL_ITEM_STATUS } from '../models/UsefulItem.js';
import MaterialCategory from '../models/MaterialCategory.js';
import ExpenseCategory from '../models/ExpenseCategory.js';
import { DEFAULT_MATERIALS, materialKey, getMaterialStats, listUsedMaterialNames } from './materialService.js';
import { notifyOwner } from '../bot/notify.js';
import { formatDateTime } from '../utils/dates.js';

const notDeleted = { isDeleted: { $ne: true } };

// ── Xarajat kategoriyalari (dinamik) ─────────────────────────────────────────
// Asosiy (doim mavjud, DB'da saqlanmaydigan) xarajat toifalari: DB'da eski slug bilan
// yoziladi, ko'rsatishda o'zbekcha nom ishlatiladi.
export const DEFAULT_EXPENSE_CATEGORIES = [
  { slug: 'yoqilgi', name: "Yoqilg'i" },
  { slug: 'tamirlash', name: "Ta'mirlash" },
  { slug: 'oziq-ovqat', name: 'Oziq-ovqat' },
];

// Kategoriya nomini solishtirish kaliti: kichik harf, apostrof/ortiqcha bo'shliqsiz.
export function expenseKey(name) {
  return String(name || '')
    .replace(/[`‘’ʻʼ']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function defaultExpenseBySlugOrKey(value) {
  const key = expenseKey(value);
  return DEFAULT_EXPENSE_CATEGORIES.find((d) => d.slug === value || expenseKey(d.name) === key) || null;
}

// Saqlangan (default bo'lmagan) kategoriyalar.
export async function listStoredCategories() {
  return MaterialCategory.find(notDeleted).sort({ createdAt: 1 }).lean();
}

// Barcha tanilgan material nomlari: 10 asosiy + saqlangan + sotuvda uchragan (dublikatsiz).
export async function listKnownMaterialNames() {
  const [stored, used] = await Promise.all([listStoredCategories(), listUsedMaterialNames()]);
  const seen = new Set();
  const out = [];
  const add = (name) => {
    const key = materialKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  DEFAULT_MATERIALS.forEach(add);
  stored.forEach((c) => add(c.name));
  used.forEach(add);
  return out;
}

// Kategoriyani kafolatlaydi: default emas va hali yo'q bo'lsa — yaratadi + bot xabar beradi.
// Qaytaradi: { name, created }.
export async function ensureMaterialCategory(rawName, { source = 'bot', notify = true } = {}) {
  const name = String(rawName || '').replace(/\s+/g, ' ').trim();
  if (!name) return { name: null, created: false };
  const key = materialKey(name);

  // Asosiy 10 ta — doim mavjud, yaratilmaydi.
  if (DEFAULT_MATERIALS.some((d) => materialKey(d) === key)) return { name, created: false };

  const existing = await MaterialCategory.findOne({ ...notDeleted, normalizedName: key });
  if (existing) return { name: existing.name, created: false };

  const category = await MaterialCategory.create({ name, normalizedName: key, source });
  if (notify) {
    await notifyOwner(`🆕 Yangi kategoriya yaratildi: "${name}"\n📅 ${formatDateTime(new Date())} ✅`);
  }
  return { name: category.name, created: true };
}

// Mini App'dan qo'lda kategoriya yaratish (har doim xabar beradi).
export async function createMaterialCategory(rawName) {
  const name = String(rawName || '').replace(/\s+/g, ' ').trim();
  if (!name) {
    const err = new Error('Kategoriya nomini kiriting');
    err.status = 400;
    throw err;
  }
  return ensureMaterialCategory(name, { source: 'miniapp', notify: true });
}

// Xarajat kategoriyasini kafolatlaydi: default/legacy bo'lmasa va hali yo'q bo'lsa —
// avtomatik yaratadi + bot egaga xabar beradi. DB'ga yoziladigan KANONIK qiymatni qaytaradi:
// default toifa uchun eski slug ('yoqilgi'), dinamik toifa uchun saqlangan nom ("Benzin").
export async function ensureExpenseCategory(rawName, { source = 'bot', notify = true } = {}) {
  const name = String(rawName || '').replace(/[`‘’ʻʼ]/g, "'").replace(/\s+/g, ' ').trim();
  if (!name) return { value: null, created: false };

  // Toifasiz/umumiy chiqim — dinamik kategoriya emas.
  if (expenseKey(name) === expenseKey(OTHER_EXPENSE_CATEGORY) || name === OTHER_EXPENSE_CATEGORY) {
    return { value: OTHER_EXPENSE_CATEGORY, created: false };
  }

  // Asosiy 3 ta — doim mavjud, DB'da eski slug bilan yoziladi.
  const def = defaultExpenseBySlugOrKey(name);
  if (def) return { value: def.slug, created: false };

  const key = expenseKey(name);
  const existing = await ExpenseCategory.findOne({ ...notDeleted, normalizedName: key });
  if (existing) return { value: existing.name, created: false };

  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  const category = await ExpenseCategory.create({ name: displayName, normalizedName: key, source });
  if (notify) {
    await notifyOwner(`🆕 Yangi xarajat kategoriyasi yaratildi: "${displayName}"\n📅 ${formatDateTime(new Date())} ✅`);
  }
  return { value: category.name, created: true };
}

// Barcha tanilgan xarajat kategoriyalari: 3 asosiy + saqlangan + tranzaksiyalarda uchragan
// (dublikatsiz). Har biri { value (DB qiymati), name (ko'rsatiladigan nom) }.
export async function listKnownExpenseCategories() {
  const [stored, used] = await Promise.all([
    ExpenseCategory.find(notDeleted).sort({ createdAt: 1 }).lean(),
    Transaction.distinct('category', {
      ...notDeleted,
      type: TX_TYPES.EXPENSE,
      category: { $nin: [null, '', OTHER_EXPENSE_CATEGORY, 'qarz'] },
    }),
  ]);
  const seen = new Set();
  const out = [];
  const add = (value, name) => {
    const key = expenseKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ value, name });
  };
  DEFAULT_EXPENSE_CATEGORIES.forEach((d) => add(d.slug, d.name));
  stored.forEach((c) => add(c.name, c.name));
  used.forEach((c) => {
    const def = defaultExpenseBySlugOrKey(c);
    if (def) add(def.slug, def.name);
    else add(c, c);
  });
  return out;
}

// Mini App "Kategoriyalar" ro'yxati: har bir material kategoriyasi (statistikasi bilan) +
// "Kerakli buyumlar" bo'limi (dona buyumlar soni) + XARAJAT kategoriyalari (statistikasi
// bilan) + "Boshqa kirim-chiqimlar" bo'limi (toifasiz kirim va chiqimlar).
export async function getCategoryOverview() {
  const [names, stats, itemAgg, expenseCats, expenseAgg, otherAgg] = await Promise.all([
    listKnownMaterialNames(),
    getMaterialStats('all'),
    UsefulItem.aggregate([
      { $match: notDeleted },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    listKnownExpenseCategories(),
    Transaction.aggregate([
      {
        $match: {
          ...notDeleted,
          type: TX_TYPES.EXPENSE,
          category: { $nin: [null, '', OTHER_EXPENSE_CATEGORY, 'qarz'] },
        },
      },
      { $group: { _id: '$category', count: { $sum: 1 }, total: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      {
        $match: {
          ...notDeleted,
          $or: [
            { type: TX_TYPES.EXPENSE, category: { $in: [null, '', OTHER_EXPENSE_CATEGORY] } },
            { type: TX_TYPES.INCOME, category: { $in: [null, '', OTHER_INCOME_CATEGORY] } },
          ],
        },
      },
      { $group: { _id: '$type', count: { $sum: 1 }, total: { $sum: '$amount' } } },
    ]),
  ]);

  const statByKey = new Map(stats.map((s) => [materialKey(s.material), s]));
  const materials = names.map((name) => {
    const s = statByKey.get(materialKey(name));
    return {
      name,
      kind: 'material',
      count: s?.count || 0,
      total: s?.total || 0,
      totalKg: s?.totalKg || 0,
    };
  });

  const itemCounts = Object.fromEntries(itemAgg.map((r) => [r._id, r.count]));
  const items = {
    kind: 'items',
    available: itemCounts[USEFUL_ITEM_STATUS.AVAILABLE] || 0,
    sold: itemCounts[USEFUL_ITEM_STATUS.SOLD] || 0,
    total: itemAgg.reduce((sum, r) => sum + r.count, 0),
  };

  // Xarajat statistikasi kategoriya kaliti bo'yicha (dinamik nom yoki legacy slug).
  const expStatByKey = new Map();
  for (const row of expenseAgg) {
    const def = defaultExpenseBySlugOrKey(row._id);
    const key = def ? expenseKey(def.name) : expenseKey(row._id);
    const prev = expStatByKey.get(key) || { count: 0, total: 0 };
    expStatByKey.set(key, { count: prev.count + row.count, total: prev.total + row.total });
  }
  const expenses = expenseCats.map((c) => {
    const s = expStatByKey.get(expenseKey(c.name)) || { count: 0, total: 0 };
    return { name: c.name, value: c.value, kind: 'expense', count: s.count, total: s.total };
  });

  // "Boshqa kirim-chiqimlar": toifasiz kirim + chiqim yig'indisi.
  const otherByType = Object.fromEntries(otherAgg.map((r) => [r._id, r]));
  const other = {
    kind: 'other',
    count: (otherByType.income?.count || 0) + (otherByType.expense?.count || 0),
    totalIncome: otherByType.income?.total || 0,
    totalExpense: otherByType.expense?.total || 0,
  };

  return { materials, items, expenses, other };
}

// Tranzaksiyani Mini App kategoriya yozuviga aylantiradi (ovoz + asl matn bilan).
function toCategoryRecord(tx) {
  return {
    id: String(tx._id),
    type: tx.type,
    date: tx.date,
    amount: tx.amount,
    category: tx.category || null,
    description: tx.description || '',
    voiceFileId: tx.voice?.telegramFileId || null,
    sourceText: tx.sourceText || '',
  };
}

// Bitta XARAJAT kategoriyasining yozuvlari (ovoz/sana/summa/izoh bilan) — Mini App'da
// egasi o'sha kategoriyaga kirib asl ovozni qayta eshita oladi.
export async function getExpenseCategoryRecords(name) {
  const key = expenseKey(name);
  if (!key) return { name, records: [] };
  const def = defaultExpenseBySlugOrKey(name);
  const txs = await Transaction.find({
    ...notDeleted,
    type: TX_TYPES.EXPENSE,
    category: { $nin: [null, ''] },
  })
    .sort({ date: -1 })
    .lean();
  const records = txs
    .filter((tx) => {
      const txDef = defaultExpenseBySlugOrKey(tx.category);
      if (def) return txDef && txDef.slug === def.slug;
      return !txDef && expenseKey(tx.category) === key;
    })
    .map(toCategoryRecord);
  return { name: def ? def.name : name, records };
}

// "Boshqa kirim-chiqimlar" yozuvlari: toifasiz chiqimlar (boshqa_chiqim) va toifasiz
// kirimlar (boshqa_kirim) bitta ro'yxatda (yangi birinchi).
export async function getOtherCategoryRecords() {
  const txs = await Transaction.find({
    ...notDeleted,
    $or: [
      { type: TX_TYPES.EXPENSE, category: { $in: [null, '', OTHER_EXPENSE_CATEGORY] } },
      { type: TX_TYPES.INCOME, category: { $in: [null, '', OTHER_INCOME_CATEGORY] } },
    ],
  })
    .sort({ date: -1 })
    .lean();
  return { records: txs.map(toCategoryRecord) };
}

// Bitta material kategoriyasining sotuv yozuvlari (ovoz/sana/kg/narx/balans bayrog'i bilan).
export async function getMaterialCategoryRecords(name) {
  const key = materialKey(name);
  if (!key) return { name, records: [] };
  const txs = await Transaction.find({ ...notDeleted, type: TX_TYPES.INCOME, category: MATERIAL_CATEGORY })
    .sort({ date: -1 })
    .lean();
  const records = txs
    .filter((tx) => materialKey(tx.materialName) === key)
    .map((tx) => ({
      id: String(tx._id),
      date: tx.date,
      quantityKg: tx.quantityKg || null,
      pricePerKg: tx.pricePerKg || null,
      amount: tx.amount,
      // Material sotuvi DOIM kirim sifatida balansga qo'shiladi.
      balanceAdded: true,
      voiceFileId: tx.voice?.telegramFileId || null,
      sourceText: tx.sourceText || tx.description || '',
    }));
  return { name, records };
}

export default {
  listStoredCategories,
  listKnownMaterialNames,
  ensureMaterialCategory,
  createMaterialCategory,
  ensureExpenseCategory,
  listKnownExpenseCategories,
  getCategoryOverview,
  getMaterialCategoryRecords,
  getExpenseCategoryRecords,
  getOtherCategoryRecords,
};
