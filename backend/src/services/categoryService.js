// Kategoriyalar boshqaruvi — Mini App "Kategoriyalar" bo'limi va bot uchun yagona manba.
// Ikki xil kategoriya: (1) MATERIAL kategoriyalari (Paxta, Taxta, ... + foydalanuvchi yaratgan),
// (2) "Kerakli buyumlar" — dona buyumlar (UsefulItem). Yangi kategoriya yaratilganda bot
// orqali egaga xabar beriladi.
import Transaction, { TX_TYPES, MATERIAL_CATEGORY } from '../models/Transaction.js';
import UsefulItem, { USEFUL_ITEM_STATUS } from '../models/UsefulItem.js';
import MaterialCategory from '../models/MaterialCategory.js';
import { DEFAULT_MATERIALS, materialKey, getMaterialStats, listUsedMaterialNames } from './materialService.js';
import { notifyOwner } from '../bot/notify.js';
import { formatDate } from '../utils/dates.js';

const notDeleted = { isDeleted: { $ne: true } };

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
    await notifyOwner(`🆕 Yangi kategoriya yaratildi: "${name}"\n📅 ${formatDate(new Date())} ✅`);
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

// Mini App "Kategoriyalar" ro'yxati: har bir material kategoriyasi (statistikasi bilan) +
// "Kerakli buyumlar" bo'limi (dona buyumlar soni).
export async function getCategoryOverview() {
  const [names, stats, itemAgg] = await Promise.all([
    listKnownMaterialNames(),
    getMaterialStats('all'),
    UsefulItem.aggregate([
      { $match: notDeleted },
      { $group: { _id: '$status', count: { $sum: 1 } } },
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

  return { materials, items };
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
  getCategoryOverview,
  getMaterialCategoryRecords,
};
