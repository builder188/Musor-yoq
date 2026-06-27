// Material sotuvi (musordan chiqqan xom-ashyo) — kategoriya boshqaruvi va statistikasi.
//
// Material sotuvi mavjud "kirim" tizimining bir qismi: u oddiy income Transaction sifatida
// saqlanadi (category='material'), shuning uchun balans, oylik grafik va hisobotlarga
// avtomatik kiradi. Bu modul faqat materialga XOS narsani qiladi: kategoriya nomini
// kanonik shaklga keltirish (dublikatlarning oldini olish) va material bo'yicha statistika.
import Transaction, { TX_TYPES, MATERIAL_CATEGORY } from '../models/Transaction.js';
import { periodRange } from '../utils/dates.js';

// Oldindan tanilgan 10 ta asosiy kategoriya. Bular doim tanilgan deb hisoblanadi;
// ro'yxatda yo'q narsa aytilsa — yangi kategoriya o'sha nom bilan yaratiladi.
export const DEFAULT_MATERIALS = [
  'Paxta',
  'Taxta',
  'Yengil temir',
  "Og'ir temir",
  'Salafan',
  'Plastik',
  'Plassmassa',
  'Alyuminiy',
  'Mis',
  "G'isht",
];

const notDeleted = { isDeleted: { $ne: true } };

// Taqqoslash kaliti: kichik harf, apostrof variantlarini olib tashlash, bo'shliqlarni
// bittaga keltirish. "Paxtani", "paxta", "PAXTA" -> hammasi bir xil kalit ("paxta").
export function materialKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[`'‘’ʼ´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Material nomini ko'rinadigan toza shaklga keltiradi (bo'shliqlar normallashtirilgan,
// bosh harf katta). Yangi kategoriya uchun ishlatiladi.
function cleanDisplayName(name) {
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Avval saqlangan (tenant'ga tegishli) material nomlari — "keyingi safar ham tanilsin" uchun.
export async function listUsedMaterialNames() {
  const names = await Transaction.distinct('materialName', {
    ...notDeleted,
    category: MATERIAL_CATEGORY,
    materialName: { $ne: null },
  });
  return names.filter(Boolean);
}

// Tanilgan barcha kategoriyalar: 10 ta asosiy + foydalanuvchi yaratgan qo'shimchalar.
export async function listKnownMaterials() {
  const used = await listUsedMaterialNames();
  const seen = new Set(DEFAULT_MATERIALS.map(materialKey));
  const extra = [];
  for (const name of used) {
    const key = materialKey(name);
    if (!seen.has(key)) {
      seen.add(key);
      extra.push(name);
    }
  }
  return [...DEFAULT_MATERIALS, ...extra];
}

// Xom material nomini KANONIK nomga keltiradi:
//  1) Asosiy 10 ro'yxatga mos kelsa (qo'shimchali shakllar ham: "paxtani" -> "Paxta").
//  2) Avval ishlatilgan kategoriya bilan bir xil bo'lsa — o'sha (eski) nom.
//  3) Aks holda — YANGI kategoriya: tozalangan nom (rad etmaymiz, "boshqa" demaymiz).
export async function resolveMaterialName(rawName) {
  const cleaned = cleanDisplayName(rawName);
  if (!cleaned) return null;
  const key = materialKey(cleaned);

  // 1) Asosiy ro'yxat. Aniq mos yoki morfologik qo'shimcha (kalit asosiy nom bilan boshlanadi).
  for (const def of DEFAULT_MATERIALS) {
    const dk = materialKey(def);
    if (key === dk || key.startsWith(`${dk} `) || key.startsWith(dk)) return def;
  }

  // 2) Avval yaratilgan kategoriya — bir xil kalit bo'lsa o'sha nomni qaytaramiz.
  const used = await listUsedMaterialNames();
  for (const name of used) {
    if (materialKey(name) === key) return name;
  }

  // 3) Yangi kategoriya.
  return cleaned;
}

// Tranzaksiya izohi (ro'yxat/hisobot uchun): "Paxta · 30 kg".
export function buildMaterialDescription(name, quantityKg) {
  const parts = [name || 'Material'];
  if (typeof quantityKg === 'number' && quantityKg > 0) parts.push(`${formatKg(quantityKg)} kg`);
  return parts.join(' · ');
}

// Miqdorni ixcham ko'rsatadi: butun bo'lsa "30", kasrli bo'lsa "1.5".
export function formatKg(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

// Material bo'yicha statistika (davr filtri bilan): har kategoriya — jami summa, jami kg, soni.
export async function getMaterialStats(period = 'all') {
  const { from, to } = periodRange(period);
  const rows = await Transaction.aggregate([
    {
      $match: {
        ...notDeleted,
        type: TX_TYPES.INCOME,
        category: MATERIAL_CATEGORY,
        date: { $gte: from, $lte: to },
      },
    },
    {
      $group: {
        _id: '$materialName',
        total: { $sum: '$amount' },
        totalKg: { $sum: { $ifNull: ['$quantityKg', 0] } },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ]);

  return rows.map((row) => ({
    material: row._id || 'Boshqa',
    total: row.total,
    totalKg: row.totalKg,
    count: row.count,
  }));
}

export default {
  DEFAULT_MATERIALS,
  materialKey,
  listUsedMaterialNames,
  listKnownMaterials,
  resolveMaterialName,
  buildMaterialDescription,
  formatKg,
  getMaterialStats,
};
