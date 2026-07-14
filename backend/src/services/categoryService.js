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
import IncomeCategory from '../models/IncomeCategory.js';
import { DEFAULT_MATERIALS, materialKey, getMaterialStats, listUsedMaterialNames } from './materialService.js';
import { notifyOwner } from '../bot/notify.js';
import { formatDateTime } from '../utils/dates.js';
import { findVariantMatch } from '../utils/nameVariant.js';

const notDeleted = { isDeleted: { $ne: true } };

// ── Xarajat kategoriyalari (dinamik) ─────────────────────────────────────────
// Asosiy (doim mavjud, DB'da saqlanmaydigan) xarajat toifalari: DB'da eski slug bilan
// yoziladi, ko'rsatishda o'zbekcha nom ishlatiladi.
export const DEFAULT_EXPENSE_CATEGORIES = [
  { slug: 'yoqilgi', name: "Yoqilg'i" },
  { slug: 'tamirlash', name: "Ta'mirlash" },
  { slug: 'oziq-ovqat', name: 'Oziq-ovqat' },
  { slug: 'svalka', name: 'Svalka' },
  { slug: 'jarima', name: 'Moshina jarimasi' },
];

export const SYSTEM_INCOME_CATEGORIES = [
  { slug: 'xizmat', name: 'Xizmat' },
  { slug: MATERIAL_CATEGORY, name: 'Material' },
  { slug: 'buyum', name: 'Buyum' },
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

function defaultIncomeBySlugOrKey(value) {
  const key = expenseKey(value);
  return SYSTEM_INCOME_CATEGORIES.find((d) => d.slug === value || expenseKey(d.name) === key) || null;
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

  // Imlo varianti ("plasmasa" ~ "Plassmassa") — yangi kategoriya OCHILMAYDI,
  // mavjudining aniq yozilishi qaytariladi (dublikat statistikaning oldini oladi).
  const knownNames = await listKnownMaterialNames();
  const variant = findVariantMatch(name, knownNames);
  if (variant) return { name: variant, created: false };

  const category = await MaterialCategory.create({ name, normalizedName: key, source });
  if (notify) {
    await notifyOwner(`🆕 Yangi kategoriya yaratildi: "${name}"\n📅 ${formatDateTime(new Date())} ✅`);
  }
  return { name: category.name, created: true };
}

// Mini App'dan qo'lda kategoriya yaratish (har doim xabar beradi).
export async function createMaterialCategory(rawName, { notify = true } = {}) {
  const name = String(rawName || '').replace(/\s+/g, ' ').trim();
  if (!name) {
    const err = new Error('Kategoriya nomini kiriting');
    err.status = 400;
    throw err;
  }
  return ensureMaterialCategory(name, { source: 'miniapp', notify });
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

  // Asosiy toifalar doim mavjud, DB'da eski/tizim slug bilan yoziladi.
  const def = defaultExpenseBySlugOrKey(name);
  if (def) return { value: def.slug, created: false };

  const key = expenseKey(name);
  const existing = await ExpenseCategory.findOne({ ...notDeleted, normalizedName: key });
  if (existing) return { value: existing.name, created: false };

  // Imlo varianti — mavjud kategoriyaga yoziladi, dublikat yaratilmaydi.
  // (Default nomlar defaultExpenseBySlugOrKey'da aniq mos kelmagan bo'lsa ham
  // variant sifatida shu yerda ushlanadi, mas. "yoqilgilar".)
  const known = await listKnownExpenseCategories();
  const variant = known.find((c) => findVariantMatch(name, [c.name]));
  if (variant) return { value: variant.value, created: false };

  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  const category = await ExpenseCategory.create({ name: displayName, normalizedName: key, source });
  if (notify) {
    await notifyOwner(`🆕 Yangi xarajat kategoriyasi yaratildi: "${displayName}"\n📅 ${formatDateTime(new Date())} ✅`);
  }
  return { value: category.name, created: true };
}

// Kirim kategoriyasini kafolatlaydi. Xizmat/material/buyum/qarz va boshqa_kirim tizim
// qiymatlari yaratilmaydi; aniq yangi daromad nomlari esa IncomeCategory'ga yoziladi.
export async function ensureIncomeCategory(rawName, { source = 'bot', notify = true } = {}) {
  const name = String(rawName || '').replace(/[`‘’ʻʼ]/g, "'").replace(/\s+/g, ' ').trim();
  if (!name) return { value: null, created: false };

  if (expenseKey(name) === expenseKey(OTHER_INCOME_CATEGORY) || name === OTHER_INCOME_CATEGORY) {
    return { value: OTHER_INCOME_CATEGORY, created: false };
  }
  if (expenseKey(name) === 'qarz' || name === 'qarz') {
    return { value: 'qarz', created: false };
  }

  const def = defaultIncomeBySlugOrKey(name);
  if (def) return { value: def.slug, created: false };

  const key = expenseKey(name);
  const existing = await IncomeCategory.findOne({ ...notDeleted, normalizedName: key });
  if (existing) return { value: existing.name, created: false };

  // Imlo varianti — mavjud kirim kategoriyasiga yoziladi, dublikat yaratilmaydi.
  const known = await listKnownIncomeCategories();
  const variant = known.find((c) => findVariantMatch(name, [c.name]));
  if (variant) return { value: variant.value, created: false };

  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  const category = await IncomeCategory.create({ name: displayName, normalizedName: key, source });
  if (notify) {
    await notifyOwner(`🆕 Yangi kirim kategoriyasi yaratildi: "${displayName}"\n📅 ${formatDateTime(new Date())} ✅`);
  }
  return { value: category.name, created: true };
}

// Barcha tanilgan xarajat kategoriyalari: asosiy + saqlangan + tranzaksiyalarda uchragan
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

// Barcha tanilgan erkin kirim kategoriyalari: saqlangan + tranzaksiyalarda uchragan dinamik
// nomlar. Xizmat/material/buyum alohida maxsus bo'limlarda yurgani uchun bu ro'yxatga kirmaydi.
export async function listKnownIncomeCategories() {
  const system = SYSTEM_INCOME_CATEGORIES.map((c) => c.slug);
  const [stored, used] = await Promise.all([
    IncomeCategory.find(notDeleted).sort({ createdAt: 1 }).lean(),
    Transaction.distinct('category', {
      ...notDeleted,
      type: TX_TYPES.INCOME,
      category: { $nin: [null, '', OTHER_INCOME_CATEGORY, 'qarz', ...system] },
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
  stored.forEach((c) => add(c.name, c.name));
  used.forEach((c) => {
    const def = defaultIncomeBySlugOrKey(c);
    if (def) add(def.slug, def.name);
    else add(c, c);
  });
  return out;
}

// Mini App "Kategoriyalar" ro'yxati: har bir material kategoriyasi (statistikasi bilan) +
// "Kerakli buyumlar" bo'limi (dona buyumlar soni) + XARAJAT kategoriyalari (statistikasi
// bilan) + "Boshqa kirim-chiqimlar" bo'limi (toifasiz kirim va chiqimlar).
export async function getCategoryOverview() {
  const incomeSystem = SYSTEM_INCOME_CATEGORIES.map((c) => c.slug);
  const [names, stats, itemAgg, incomeCats, incomeAgg, expenseCats, expenseAgg, otherAgg] = await Promise.all([
    listKnownMaterialNames(),
    getMaterialStats('all'),
    UsefulItem.aggregate([
      { $match: notDeleted },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    listKnownIncomeCategories(),
    Transaction.aggregate([
      {
        $match: {
          ...notDeleted,
          type: TX_TYPES.INCOME,
          category: { $nin: [null, '', OTHER_INCOME_CATEGORY, 'qarz', ...incomeSystem] },
        },
      },
      { $group: { _id: '$category', count: { $sum: 1 }, total: { $sum: '$amount' } } },
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

  const incStatByKey = new Map();
  for (const row of incomeAgg) {
    const key = expenseKey(row._id);
    const prev = incStatByKey.get(key) || { count: 0, total: 0 };
    incStatByKey.set(key, { count: prev.count + row.count, total: prev.total + row.total });
  }
  const incomes = incomeCats.map((c) => {
    const s = incStatByKey.get(expenseKey(c.name)) || { count: 0, total: 0 };
    return { name: c.name, value: c.value, kind: 'income', count: s.count, total: s.total };
  });

  // "Boshqa kirim-chiqimlar": toifasiz kirim + chiqim yig'indisi.
  const otherByType = Object.fromEntries(otherAgg.map((r) => [r._id, r]));
  const other = {
    kind: 'other',
    count: (otherByType.income?.count || 0) + (otherByType.expense?.count || 0),
    totalIncome: otherByType.income?.total || 0,
    totalExpense: otherByType.expense?.total || 0,
  };

  return { materials, items, incomes, expenses, other };
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

// Bitta KIRIM kategoriyasining yozuvlari. Xizmat/material/buyum tizim manbalari boshqa
// maxsus bo'limlarda yurgani uchun odatda bu route erkin daromad toifalari uchun ishlatiladi.
export async function getIncomeCategoryRecords(name) {
  const key = expenseKey(name);
  if (!key) return { name, records: [] };
  const def = defaultIncomeBySlugOrKey(name);
  const txs = await Transaction.find({
    ...notDeleted,
    type: TX_TYPES.INCOME,
    category: { $nin: [null, ''] },
  })
    .sort({ date: -1 })
    .lean();
  const records = txs
    .filter((tx) => {
      const txDef = defaultIncomeBySlugOrKey(tx.category);
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
  ensureIncomeCategory,
  listKnownIncomeCategories,
  ensureExpenseCategory,
  listKnownExpenseCategories,
  getCategoryOverview,
  getMaterialCategoryRecords,
  getIncomeCategoryRecords,
  getExpenseCategoryRecords,
  getOtherCategoryRecords,
};
