// Hamkorlik (shartnomaviy mijoz) mantig'i — endi ALOHIDA Client kolleksiyasisiz.
// Mijoz identifikatsiyasi = telefon (bo'lsa), aks holda ism. Hamkorning standart
// narx/manzili shu identifikatsiyaga tegishli ENG OXIRGI xizmat qatoridan olinadi.
// Shartnoma tuzish — standart qiymatlarni saqlovchi YANGI qator yaratadi (u eng
// oxirgi bo'lgani uchun keyingi tashriflar standartni shu qatordan oladi).
import Service, { SERVICE_STATUS, PAYMENT_STATUS } from '../models/Service.js';
import { normalizePhone } from '../utils/phone.js';

const notDeleted = { isDeleted: { $ne: true } };

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLocationInput(location) {
  if (!location) return { address: '', mapUrl: null, coordinates: null };
  if (typeof location === 'string') return { address: location.trim(), mapUrl: null, coordinates: null };
  const lat = Number(location.coordinates?.lat ?? location.lat);
  const lng = Number(location.coordinates?.lng ?? location.lng);
  const coordinates = Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
  return {
    address: String(location.address || location.text || '').trim(),
    mapUrl: String(location.mapUrl || location.mapLink || location.url || '').trim() || null,
    coordinates,
  };
}

// Ism bo'yicha regex (case-insensitive, to'liq moslik).
function exactNameRegex(name) {
  return new RegExp(`^${escapeRegex(name)}$`, 'i');
}

// Mijoz guruhlash kaliti: telefon (noyob) > ism (kichik harfda). Ikkalasi ham yo'q — null.
export function clientKeyOf(row = {}) {
  const phone = String(row.clientPhone || '').trim();
  if (phone) return `tel:${phone}`;
  const name = String(row.clientName || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return name ? `nom:${name}` : null;
}

// Identifikatsiya (telefon yoki ism) bo'yicha ENG OXIRGI aktiv qatorni topadi.
// "Eng oxirgi" = eng katta serviceDateTime (sanasizlar oxirida createdAt bo'yicha).
export async function findLatestServiceByIdentity({ name = '', phone = '' } = {}) {
  const normalized = normalizePhone(phone);
  if (normalized && /^\+998\d{9}$/.test(normalized)) {
    const byPhone = await Service.findOne({ clientPhone: normalized, ...notDeleted })
      .sort({ createdAt: -1 });
    if (byPhone) return byPhone;
  }
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return Service.findOne({ clientName: exactNameRegex(text), ...notDeleted })
    .sort({ createdAt: -1 });
}

// Ism bo'yicha aniq (case-insensitive) mijoz qatorini topadi. Topilmasa, ismning oxirgi
// so'zidagi o'zbekcha kelishik qo'shimchasini ("Salat sexga" -> "Salat sex") olib
// tashlab qayta uriniladi — AI ba'zan qo'shimcha bilan ajratadi.
export async function findClientRowByExactName(name) {
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const exact = await Service.findOne({ clientName: exactNameRegex(text), ...notDeleted })
    .sort({ createdAt: -1 });
  if (exact) return exact;

  const stripped = text.replace(/(ga|ka|qa|da|ni|ning)$/i, '').trim();
  if (!stripped || stripped === text || stripped.length < 3) return null;
  return Service.findOne({ clientName: exactNameRegex(stripped), ...notDeleted })
    .sort({ createdAt: -1 });
}

// Qatorlar ro'yxatidan hamkor "profili": nom/telefon + standart narx/manzil —
// ENG OXIRGI qatordan (narx 0 bo'lsa, narxi bor eng oxirgi qatordan).
function partnerProfileFromRows(rows) {
  if (!rows.length) return null;
  const latest = rows[0];
  const priced = rows.find((r) => (r.price || 0) > 0);
  const located = rows.find((r) => r.location?.address);
  return {
    name: latest.clientName || '',
    phone: latest.clientPhone || '',
    partnerPrice: latest.price > 0 ? latest.price : priced?.price || 0,
    partnerLocation: latest.location?.address ? latest.location : located?.location || null,
  };
}

// Identifikatsiya bo'yicha hamkor profili (istalgan qatori isPartner bo'lsa — hamkor).
async function findPartnerProfile({ name = '', phone = '' } = {}) {
  const anchor = phone || name ? await findLatestServiceByIdentity({ name, phone }) : null;
  const row = anchor || (name ? await findClientRowByExactName(name) : null);
  if (!row) return null;

  const filter = row.clientPhone
    ? { clientPhone: row.clientPhone, ...notDeleted }
    : { clientName: exactNameRegex(row.clientName || ''), ...notDeleted };
  const rows = await Service.find(filter).sort({ createdAt: -1 }).limit(50).lean();
  if (!rows.some((r) => r.isPartner)) return null;
  return partnerProfileFromRows(rows);
}

// Faqat HAMKOR mijozni ism bo'yicha topadi ("Salat sexga bordim" oqimi uchun).
// Qaytadi: { name, phone, partnerPrice, partnerLocation } yoki null.
export async function findPartnerByName(name) {
  const row = await findClientRowByExactName(name);
  if (!row) return null;
  return findPartnerProfile({ name: row.clientName, phone: row.clientPhone });
}

// Shartnoma boshlash/yangilash: standart narx/manzilni saqlovchi YANGI xizmat qatori
// yaratiladi (isPartner=true, sanasiz, kutilmoqda — balansga ta'sir qilmaydi). Mavjud
// qatorlar ham isPartner deb belgilanadi ("X ga bordim" ularni ham hamkor deb tanisin).
// Qaytaradi: { service, created: true } — post-save "Bekor qilish" qatorni o'chiradi,
// shunda avvalgi eng oxirgi qator (eski standart) o'z-o'zidan qaytadi.
export async function upsertPartnerContract({ clientName, clientPhone, price = null, location = null, notes = '' } = {}) {
  const name = String(clientName || '').replace(/\s+/g, ' ').trim();
  if (!name) throw httpError(400, 'Hamkor mijoz nomi kerak');

  const normalizedPhone = normalizePhone(clientPhone);
  const hasPhone = !!normalizedPhone && /^\+998\d{9}$/.test(normalizedPhone);
  const priceNumber = Number(price);
  const hasPrice = Number.isFinite(priceNumber) && priceNumber > 0;
  const loc = normalizeLocationInput(location);

  // Mavjud qatorlaridan kanonik nom/telefonni olamiz (dublikat identifikatsiya ochilmasin).
  const existing = await findLatestServiceByIdentity({ name, phone: hasPhone ? normalizedPhone : '' })
    || (await findClientRowByExactName(name));

  const canonicalName = existing?.clientName || name;
  const canonicalPhone = hasPhone ? normalizedPhone : existing?.clientPhone || '';

  const service = await Service.create({
    clientName: canonicalName,
    clientPhone: canonicalPhone,
    isPartner: true,
    location: loc.address ? loc : { address: '', mapUrl: null, coordinates: null },
    serviceDateTime: null,
    price: hasPrice ? Math.round(priceNumber) : existing?.price || 0,
    notes: notes || 'Hamkorlik shartnomasi',
    status: SERVICE_STATUS.PENDING,
    paymentStatus: PAYMENT_STATUS.UNPAID,
    // Sanasiz qator — eslatma/tasdiq jadvali yo'q.
    reminderAt: null,
    confirmAt: null,
    reminderSent: true,
    startReminderSent: true,
    confirmSent: true,
  });

  // Mavjud qatorlarni ham hamkor deb belgilaymiz (identifikatsiya bo'yicha).
  const markFilter = canonicalPhone
    ? { clientPhone: canonicalPhone, ...notDeleted }
    : { clientName: exactNameRegex(canonicalName), ...notDeleted };
  await Service.updateMany({ ...markFilter, isPartner: { $ne: true } }, { isPartner: true }).catch((err) =>
    console.error('Hamkor belgilashda xato:', err.message)
  );

  return { service, created: true };
}

// Tashrif sanasi: tarixiy xizmatda serviceDateTime (voqea sanasi), bo'lmasa completedAt.
// Hisobot va oylik hisob BIR XIL ta'rifdan foydalanadi (mos kelmaslik bo'lmasin).
const VISIT_DATE_EXPR = { $ifNull: ['$serviceDateTime', '$completedAt'] };

// Guruhlash ifodasi: telefon bo'lsa "tel:<raqam>", bo'lmasa "nom:<kichik harf ism>".
export const CLIENT_KEY_EXPR = {
  $cond: [
    { $gt: [{ $strLenCP: { $ifNull: ['$clientPhone', ''] } }, 0] },
    { $concat: ['tel:', '$clientPhone'] },
    { $concat: ['nom:', { $toLower: { $trim: { input: { $ifNull: ['$clientName', ''] } } } }] },
  ],
};

// Joriy oy (yoki berilgan oy) ichida hamkorga necha marta borilgan — BAJARILGAN xizmatlar
// (identifikatsiya: telefon yoki ism bo'yicha).
export async function countMonthVisits({ name = '', phone = '' } = {}, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const match = phone
    ? { clientPhone: phone }
    : { clientName: exactNameRegex(name) };
  const rows = await Service.aggregate([
    { $match: { ...match, isDeleted: { $ne: true }, status: SERVICE_STATUS.DONE } },
    { $addFields: { visitDate: VISIT_DATE_EXPR } },
    { $match: { visitDate: { $gte: from, $lte: to } } },
    { $count: 'visits' },
  ]);
  return rows[0]?.visits || 0;
}

// Hisobot uchun: har bir hamkor mijoz (kamida bitta isPartner qatori bor identifikatsiya) —
// davr ichidagi tashriflar soni va jami daromad (bajarilgan xizmatlar narxi yig'indisi).
export async function getPartnerReportRows({ from = null, to = null } = {}) {
  const visitMatch = { visitDate: {} };
  if (from) visitMatch.visitDate.$gte = new Date(from);
  if (to) visitMatch.visitDate.$lte = new Date(to);
  const hasRange = !!(from || to);

  const rows = await Service.aggregate([
    { $match: { isDeleted: { $ne: true } } },
    { $addFields: { clientKey: CLIENT_KEY_EXPR, visitDate: VISIT_DATE_EXPR } },
    { $match: { clientKey: { $nin: ['tel:', 'nom:'] } } },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: '$clientKey',
        isPartner: { $max: '$isPartner' },
        name: { $last: '$clientName' },
        phone: { $last: '$clientPhone' },
        partnerPrice: { $last: '$price' },
        lastPricedPrice: { $max: { $cond: [{ $gt: ['$price', 0] }, '$price', 0] } },
        address: { $last: '$location.address' },
        visits: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', SERVICE_STATUS.DONE] },
                  ...(hasRange
                    ? [
                        ...(from ? [{ $gte: ['$visitDate', new Date(from)] }] : []),
                        ...(to ? [{ $lte: ['$visitDate', new Date(to)] }] : []),
                      ]
                    : []),
                ],
              },
              1,
              0,
            ],
          },
        },
        total: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', SERVICE_STATUS.DONE] },
                  ...(hasRange
                    ? [
                        ...(from ? [{ $gte: ['$visitDate', new Date(from)] }] : []),
                        ...(to ? [{ $lte: ['$visitDate', new Date(to)] }] : []),
                      ]
                    : []),
                ],
              },
              { $ifNull: ['$price', 0] },
              0,
            ],
          },
        },
      },
    },
    { $match: { isPartner: true } },
    { $sort: { name: 1 } },
  ]);

  return rows.map((row) => ({
    clientKey: String(row._id),
    name: row.name || '',
    phone: row.phone || '',
    partnerPrice: row.partnerPrice > 0 ? row.partnerPrice : row.lastPricedPrice || 0,
    address: row.address || '',
    visits: row.visits,
    total: row.total,
  }));
}

export default {
  clientKeyOf,
  findLatestServiceByIdentity,
  findClientRowByExactName,
  findPartnerByName,
  upsertPartnerContract,
  countMonthVisits,
  getPartnerReportRows,
};
