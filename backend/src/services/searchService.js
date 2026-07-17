// Qidiruv mantig'i: yozuvlarni topish (SEARCH_QUERY) va bot uchun
// holat/to'lov yangilashda mos xizmatni aniqlash.
// MUHIM: qidiruv FAQAT Xizmatlar jadvali ichida ishlaydi — alohida Client kolleksiyasi yo'q.
import Service, { SERVICE_STATUS } from '../models/Service.js';
import { notDeleted } from '../models/softDelete.js';
import { normalizePhone } from '../utils/phone.js';

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Umumiy qidiruv: matn + sana oralig'i bo'yicha xizmatlarni topadi.
// Raqamli matn summa (narx) bo'yicha ham qidiradi.
export async function searchServices({ text = '', dateFrom = null, dateTo = null, limit = 50 } = {}) {
  const filter = { ...notDeleted };
  if (text) {
    const rx = new RegExp(escapeRegex(text), 'i');
    filter.$or = [{ clientName: rx }, { clientPhone: rx }, { 'location.address': rx }, { notes: rx }];
    const numeric = Number(String(text).replace(/[\s']/g, ''));
    if (Number.isFinite(numeric) && numeric > 0 && /^[\d\s']+$/.test(String(text).trim())) {
      filter.$or.push({ price: numeric });
    }
  }
  if (dateFrom || dateTo) {
    filter.serviceDateTime = {};
    if (dateFrom) filter.serviceDateTime.$gte = new Date(dateFrom);
    if (dateTo) filter.serviceDateTime.$lte = new Date(dateTo);
  }
  return Service.find(filter).sort({ serviceDateTime: -1 }).limit(limit).lean();
}

// Ism bo'yicha barcha FARQLI mijoz identifikatsiyalarini topish (bir xil ismlilarni
// aniqlashtirish uchun). Xizmat qatorlari telefon (bo'lmasa ism) bo'yicha guruhlanadi.
// Qaytadi: [{ name, phone }] — eng so'nggi qator ma'lumoti bilan.
export async function findClientsByName(name = '', limit = 8) {
  if (!name) return [];
  const rx = new RegExp(escapeRegex(name), 'i');
  const rows = await Service.aggregate([
    { $match: { clientName: rx, isDeleted: { $ne: true } } },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ['$clientPhone', ''] } }, 0] },
            { $concat: ['tel:', '$clientPhone'] },
            { $concat: ['nom:', { $toLower: { $trim: { input: { $ifNull: ['$clientName', ''] } } } }] },
          ],
        },
        name: { $last: '$clientName' },
        phone: { $last: '$clientPhone' },
        lastAt: { $max: '$createdAt' },
      },
    },
    { $sort: { lastAt: -1 } },
    { $limit: limit },
  ]);
  return rows.map((row) => ({ name: row.name || '', phone: row.phone || '' }));
}

// Mijoz nomi yoki telefoni bo'yicha identifikatsiyani topish (eng so'nggi qatordan).
// Qaytadi: { name, phone } yoki null.
export async function findClientIdentity({ name = '', phone = '' } = {}) {
  if (phone) {
    const normalized = normalizePhone(phone);
    if (normalized) {
      const byPhone = await Service.findOne({ clientPhone: normalized, ...notDeleted })
        .sort({ createdAt: -1 })
        .lean();
      if (byPhone) return { name: byPhone.clientName || '', phone: byPhone.clientPhone || '' };
    }
  }
  if (name) {
    const rx = new RegExp(escapeRegex(name), 'i');
    const byName = await Service.findOne({ clientName: rx, ...notDeleted })
      .sort({ createdAt: -1 })
      .lean();
    if (byName) return { name: byName.clientName || '', phone: byName.clientPhone || '' };
  }
  return null;
}

// Erkin identifikator (ism / telefon / manzil bo'lagi) bo'yicha NOMZOD xizmat
// qatorlarini topadi — lokatsiyani qatorga bog'lash kabi oqimlar uchun.
// Kutilayotganlar birinchi, keyin eng yangilari. Topilmasa kelishik qo'shimchasi
// ("Sardornikiga" -> "Sardor") olib tashlab qayta uriniladi.
export async function findServicesByIdentifier(text, limit = 6) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const run = async (term) => {
    const or = [];
    const phone = normalizePhone(term);
    if (phone && /^\+998\d{9}$/.test(phone)) or.push({ clientPhone: phone });
    const rx = new RegExp(escapeRegex(term), 'i');
    or.push({ clientName: rx }, { 'location.address': rx });
    return Service.find({ ...notDeleted, $or: or })
      .sort({ createdAt: -1 })
      .limit(limit * 3)
      .lean();
  };

  let rows = await run(clean);
  if (!rows.length) {
    const stripped = clean.replace(/(niki(ga|ni)?|ga|ka|qa|da|ni|ning)$/i, '').trim();
    if (stripped && stripped !== clean && stripped.length >= 3) rows = await run(stripped);
  }
  // Kutilayotganlar birinchi (bog'lash odatda hali borilmagan ishga bo'ladi).
  rows.sort((a, b) => {
    const ap = a.status === SERVICE_STATUS.PENDING ? 0 : 1;
    const bp = b.status === SERVICE_STATUS.PENDING ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return rows.slice(0, limit);
}

// Holat/to'lov yangilash uchun eng mos xizmatni topish.
// Odatda mijozning eng oxirgi KUTILMOQDA xizmatini qaytaradi.
export async function findServiceForUpdate({ name = '', phone = '' } = {}) {
  const filter = { ...notDeleted };
  const normalized = phone ? normalizePhone(phone) : null;
  if (normalized && /^\+998\d{9}$/.test(normalized)) {
    filter.clientPhone = normalized;
  } else if (name) {
    filter.clientName = new RegExp(escapeRegex(name), 'i');
  } else {
    return null;
  }

  // Avval kutilayotgan xizmatni qidiramiz.
  const pending = await Service.findOne({ ...filter, status: SERVICE_STATUS.PENDING }).sort({
    serviceDateTime: 1,
  });
  if (pending) return pending;

  // Bo'lmasa — eng oxirgi xizmatni.
  return Service.findOne(filter).sort({ serviceDateTime: -1 });
}
