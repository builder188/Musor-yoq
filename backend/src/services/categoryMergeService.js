// Dublikat kategoriyalarni ANIQLASH va BIRLASHTIRISH ("Dublikatlarni birlashtirish"
// vositasi). Aniqlash: deterministik imlo-variant tekshiruvi + AI (Gemini) taklifi
// birlashtiriladi; foydalanuvchi HAR BIR juftlikni Mini App'da tasdiqlaydi (avtomatik
// birlashtirilmaydi) va amal 1990-kod bilan himoyalangan.
import Transaction, { TX_TYPES, MATERIAL_CATEGORY } from '../models/Transaction.js';
import MaterialCategory from '../models/MaterialCategory.js';
import ExpenseCategory from '../models/ExpenseCategory.js';
import IncomeCategory from '../models/IncomeCategory.js';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  expenseKey,
  listKnownMaterialNames,
  listKnownExpenseCategories,
  listKnownIncomeCategories,
  ensureExpenseCategory,
  ensureIncomeCategory,
} from './categoryService.js';
import { DEFAULT_MATERIALS, materialKey, buildMaterialDescription } from './materialService.js';
import { isSpellingVariant } from '../utils/nameVariant.js';
import { suggestDuplicatePairs } from '../ai/gemini.js';
import { notifyOwner } from '../bot/notify.js';
import { formatDateTime } from '../utils/dates.js';

const notDeleted = { isDeleted: { $ne: true } };

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isDefaultMaterial(name) {
  return DEFAULT_MATERIALS.some((d) => materialKey(d) === materialKey(name));
}

function isDefaultExpense(value) {
  const key = expenseKey(value);
  return DEFAULT_EXPENSE_CATEGORIES.some((d) => d.slug === value || expenseKey(d.name) === key);
}

// Har tur bo'yicha nom + qiymat + yozuvlar soni ro'yxatini yig'adi.
async function collectCategoryUsage() {
  const [materialNames, expenseCats, incomeCats, materialAgg, expenseAgg, incomeAgg] = await Promise.all([
    listKnownMaterialNames(),
    listKnownExpenseCategories(),
    listKnownIncomeCategories(),
    Transaction.aggregate([
      { $match: { ...notDeleted, type: TX_TYPES.INCOME, category: MATERIAL_CATEGORY, materialName: { $ne: null } } },
      { $group: { _id: '$materialName', count: { $sum: 1 } } },
    ]),
    Transaction.aggregate([
      { $match: { ...notDeleted, type: TX_TYPES.EXPENSE, category: { $nin: [null, ''] } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
    Transaction.aggregate([
      { $match: { ...notDeleted, type: TX_TYPES.INCOME, category: { $nin: [null, ''] } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
  ]);

  const countByKey = (rows, keyFn) => {
    const map = new Map();
    for (const row of rows) {
      const key = keyFn(row._id);
      map.set(key, (map.get(key) || 0) + row.count);
    }
    return map;
  };
  const materialCounts = countByKey(materialAgg, materialKey);
  const expenseCounts = countByKey(expenseAgg, expenseKey);
  const incomeCounts = countByKey(incomeAgg, expenseKey);

  return {
    material: materialNames.map((name) => ({
      name,
      value: name,
      count: materialCounts.get(materialKey(name)) || 0,
      isDefault: isDefaultMaterial(name),
    })),
    expense: expenseCats.map((c) => ({
      name: c.name,
      value: c.value,
      count: expenseCounts.get(expenseKey(c.name)) || 0,
      isDefault: isDefaultExpense(c.value),
    })),
    income: incomeCats.map((c) => ({
      name: c.name,
      value: c.value,
      count: incomeCounts.get(expenseKey(c.name)) || 0,
      isDefault: false,
    })),
  };
}

// Juftlik uchun taklif qilinadigan "qoladigan" tomon: default bo'lsa — default,
// aks holda ko'proq ishlatilgani (teng bo'lsa birinchisi).
function suggestSurvivor(a, b) {
  if (a.isDefault && !b.isDefault) return a.value;
  if (b.isDefault && !a.isDefault) return b.value;
  return (b.count || 0) > (a.count || 0) ? b.value : a.value;
}

// Ehtimoliy dublikat juftlarni topadi: deterministik variant-tekshiruv + AI taklifi.
// Hech narsa AVTOMATIK birlashtirilmaydi — bu faqat tasdiqlash uchun ro'yxat.
export async function findDuplicateCategories() {
  const usage = await collectCategoryUsage();

  const pairs = [];
  const seen = new Set();
  const addPair = (kind, a, b, source) => {
    if (!a || !b || a.value === b.value) return;
    const key = `${kind}:${[a.value, b.value].sort().join('||')}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ kind, a, b, suggested: suggestSurvivor(a, b), source });
  };

  // 1) Deterministik: har tur ichida imlo-variant juftlari.
  for (const kind of ['material', 'expense', 'income']) {
    const list = usage[kind];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (isSpellingVariant(list[i].name, list[j].name)) addPair(kind, list[i], list[j], 'auto');
      }
    }
  }

  // 2) AI taklifi (bitta Gemini chaqiruvi). Faqat ro'yxatda mavjud nomlar qabul qilinadi.
  const aiPairs = await suggestDuplicatePairs({
    material: usage.material.map((c) => c.name),
    expense: usage.expense.map((c) => c.name),
    income: usage.income.map((c) => c.name),
  });
  for (const p of aiPairs) {
    const list = usage[p.kind] || [];
    const a = list.find((c) => c.name === p.a);
    const b = list.find((c) => c.name === p.b);
    // Ikkalasi ham default bo'lsa — ataylab alohida kategoriyalar (Plastik vs Plassmassa).
    if (a && b && !(a.isDefault && b.isDefault)) addPair(p.kind, a, b, 'ai');
  }

  return { pairs };
}

// Material sotuv yozuvlarini 'from' nomidan 'to' nomiga o'tkazadi (imlo-variant
// yozilishlari ham birga). Auto-qurilgan izoh yangi nom bilan qayta quriladi,
// foydalanuvchi o'zi yozgan izohga TEGILMAYDI.
async function mergeMaterialPair(from, to) {
  const fromKey = materialKey(from);
  const allNames = await Transaction.distinct('materialName', {
    category: MATERIAL_CATEGORY,
    materialName: { $ne: null },
  });
  const namesToMove = allNames.filter((n) => materialKey(n) === fromKey);
  if (!namesToMove.length && !fromKey) return 0;

  const docs = await Transaction.find({ category: MATERIAL_CATEGORY, materialName: { $in: namesToMove } });
  let moved = 0;
  for (const doc of docs) {
    const autoDescription = buildMaterialDescription(doc.materialName, doc.quantityKg);
    doc.materialName = to;
    if (!doc.description || doc.description === autoDescription) {
      doc.description = buildMaterialDescription(to, doc.quantityKg);
    }
    await doc.save();
    moved += 1;
  }
  // Yutqazgan tomonning saqlangan kategoriyasi o'chiriladi (soft delete).
  await MaterialCategory.updateMany({ normalizedName: fromKey }, { isDeleted: true, deletedAt: new Date() });
  return moved;
}

// Xarajat/kirim tranzaksiyalarini 'from' kategoriya qiymatidan 'to' ga o'tkazadi.
async function mergeTransactionCategoryPair(kind, from, to) {
  const type = kind === 'expense' ? TX_TYPES.EXPENSE : TX_TYPES.INCOME;
  const Model = kind === 'expense' ? ExpenseCategory : IncomeCategory;
  const fromKey = expenseKey(from);

  // Imlo-variant yozilishlari ham birga ko'chadi ("Benzin" va "benzin" kabi).
  const allValues = await Transaction.distinct('category', { type, category: { $nin: [null, ''] } });
  const valuesToMove = allValues.filter((v) => v !== to && expenseKey(v) === fromKey);
  if (from !== to && !valuesToMove.includes(from)) valuesToMove.push(from);

  const result = await Transaction.updateMany(
    { type, category: { $in: valuesToMove } },
    { category: to }
  );
  await Model.updateMany({ normalizedName: fromKey }, { isDeleted: true, deletedAt: new Date() });

  // Qoladigan nom saqlangan ro'yxatda ham mavjud bo'lsin (default slug bo'lsa shart emas).
  if (kind === 'expense' && !isDefaultExpense(to)) await ensureExpenseCategory(to, { notify: false });
  if (kind === 'income') await ensureIncomeCategory(to, { notify: false });

  return result.modifiedCount || 0;
}

// Tasdiqlangan juftlarni birlashtiradi. merges = [{ kind, from, to }] — from/to
// kategoriya QIYMATLARI (material: nom; xarajat: nom yoki default slug).
// 1990-kod tekshiruvi route qatlamida (requireDeleteCode). Yakunda bot xabar beradi.
export async function mergeCategoryPairs(merges = []) {
  if (!Array.isArray(merges) || !merges.length) {
    throw httpError(400, 'Birlashtiriladigan juftlik tanlanmagan');
  }

  const results = [];
  for (const merge of merges) {
    const kind = merge?.kind;
    const from = String(merge?.from || '').trim();
    const to = String(merge?.to || '').trim();
    if (!['material', 'expense', 'income'].includes(kind) || !from || !to) {
      throw httpError(400, "Noto'g'ri birlashtirish so'rovi");
    }
    if ((kind === 'material' ? materialKey(from) === materialKey(to) : expenseKey(from) === expenseKey(to))) {
      throw httpError(400, 'Bir xil kategoriyani birlashtirib bo\'lmaydi');
    }
    // Tizim kategoriyalari (xizmat/material/buyum/qarz/boshqa_*) birlashtirilmaydi —
    // ular alohida biznes-mantiqqa bog'langan.
    const SYSTEM_VALUES = new Set(['xizmat', 'material', 'buyum', 'qarz', 'boshqa_kirim', 'boshqa_chiqim']);
    if (kind !== 'material' && (SYSTEM_VALUES.has(expenseKey(from)) || SYSTEM_VALUES.has(expenseKey(to)))) {
      throw httpError(400, "Tizim kategoriyasini birlashtirib bo'lmaydi");
    }
    // Default (asosiy) kategoriya o'chirilmaydi — u tomon faqat "qoladigan" bo'lishi mumkin.
    if (kind === 'material' && isDefaultMaterial(from)) {
      throw httpError(400, `"${from}" — asosiy kategoriya, uni o'chirib bo'lmaydi. Yo'nalishni almashtiring.`);
    }
    if (kind === 'expense' && isDefaultExpense(from)) {
      throw httpError(400, `"${from}" — asosiy kategoriya, uni o'chirib bo'lmaydi. Yo'nalishni almashtiring.`);
    }

    const moved =
      kind === 'material' ? await mergeMaterialPair(from, to) : await mergeTransactionCategoryPair(kind, from, to);
    results.push({ kind, from, to, moved });
  }

  const summary = results.map((r) => `"${r.from}" → "${r.to}" (${r.moved} ta yozuv)`).join('\n');
  await notifyOwner(
    `🔀 Kategoriyalar birlashtirildi:\n${summary}\n📅 ${formatDateTime(new Date())} ✅`
  ).catch(() => {});

  return { ok: true, results };
}

export default { findDuplicateCategories, mergeCategoryPairs };
