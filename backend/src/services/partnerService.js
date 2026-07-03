// Hamkorlik (shartnomaviy mijoz) mantig'i — bot va API BIR XIL funksiyalarni ishlatadi.
// Hamkor: standart narx + standart manzil saqlanadi; "X ga bordim/boraman" deganda
// avtomatik ishlatiladi; tashrifda farqli qiymat aytilsa standart YANGILANADI.
import mongoose from 'mongoose';
import Client from '../models/Client.js';
import Service, { SERVICE_STATUS } from '../models/Service.js';
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

// Ism bo'yicha aniq (case-insensitive) mijozni topadi. Topilmasa, ismning oxirgi
// so'zidagi o'zbekcha kelishik qo'shimchasini ("Salat sexga" -> "Salat sex") olib
// tashlab qayta uriniladi — AI ba'zan qo'shimcha bilan ajratadi.
export async function findClientByExactName(name) {
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const exact = await Client.findOne({
    name: new RegExp(`^${escapeRegex(text)}$`, 'i'),
    ...notDeleted,
  }).sort({ updatedAt: -1 });
  if (exact) return exact;

  const stripped = text.replace(/(ga|ka|qa|da|ni|ning)$/i, '').trim();
  if (!stripped || stripped === text || stripped.length < 3) return null;
  return Client.findOne({
    name: new RegExp(`^${escapeRegex(stripped)}$`, 'i'),
    ...notDeleted,
  }).sort({ updatedAt: -1 });
}

// Faqat HAMKOR mijozni ism bo'yicha topadi ("Salat sexga bordim" oqimi uchun).
export async function findPartnerByName(name) {
  const client = await findClientByExactName(name);
  return client?.isPartner ? client : null;
}

// Shartnoma boshlash/yangilash: mijoz topiladi (telefon yoki ism bo'yicha) yoki
// yaratiladi (telefon SHART EMAS — hamkorlar ko'pincha korxona), hamkor deb belgilanadi,
// standart narx/manzil yoziladi. Qaytaradi: { client, created, prev } — prev bekor
// qilish (post-save "Bekor qilish") uchun oldingi hamkorlik holati.
export async function upsertPartnerContract({ clientName, clientPhone, price = null, location = null, notes = '' } = {}) {
  const name = String(clientName || '').replace(/\s+/g, ' ').trim();
  if (!name) throw httpError(400, 'Hamkor mijoz nomi kerak');

  const normalizedPhone = normalizePhone(clientPhone);
  const hasPhone = !!normalizedPhone && /^\+998\d{9}$/.test(normalizedPhone);
  const priceNumber = Number(price);
  const hasPrice = Number.isFinite(priceNumber) && priceNumber > 0;
  const loc = normalizeLocationInput(location);

  let client = null;
  if (hasPhone) client = await Client.findOne({ phone: normalizedPhone, ...notDeleted });
  if (!client) client = await findClientByExactName(name);

  if (!client) {
    client = await Client.create({
      name,
      phone: hasPhone ? normalizedPhone : '',
      locations: loc.address ? [loc] : [],
      isPartner: true,
      partnerPrice: hasPrice ? Math.round(priceNumber) : 0,
      partnerLocation: loc.address ? loc : null,
      partnerSince: new Date(),
    });
    return { client, created: true, prev: null };
  }

  const prev = {
    isPartner: !!client.isPartner,
    partnerPrice: client.partnerPrice || 0,
    partnerLocation: client.partnerLocation ? { ...toPlainLocation(client.partnerLocation) } : null,
    partnerSince: client.partnerSince || null,
  };

  client.isPartner = true;
  if (!client.partnerSince) client.partnerSince = new Date();
  if (hasPrice) client.partnerPrice = Math.round(priceNumber);
  if (loc.address) {
    client.partnerLocation = loc;
    addLocationIfNew(client, loc);
  }
  if (hasPhone && !client.phone) client.phone = normalizedPhone;
  await client.save();
  return { client, created: false, prev };
}

function toPlainLocation(location) {
  if (!location) return null;
  const obj = typeof location.toObject === 'function' ? location.toObject() : location;
  return { address: obj.address || '', mapUrl: obj.mapUrl || null, coordinates: obj.coordinates || null };
}

function addLocationIfNew(client, loc) {
  const exists = (client.locations || []).some(
    (item) => String(item.address || '').trim().toLowerCase() === loc.address.toLowerCase()
  );
  if (!exists) {
    client.locations.push(loc);
    client.markModified('locations');
  }
}

// Tashrifda aytilgan YANGI qiymatlar standartni yangilaydi (spec: farqli narx/manzil
// aytilsa — shu tashrifga ham, standartga ham yoziladi). Teng qiymat — hech narsa qilmaydi.
export async function syncPartnerDefaultsFromVisit(clientId, { price = null, location = null } = {}) {
  const client = await Client.findOne({ _id: clientId, ...notDeleted });
  if (!client || !client.isPartner) return null;

  let dirty = false;
  const priceNumber = Number(price);
  if (Number.isFinite(priceNumber) && priceNumber > 0 && Math.round(priceNumber) !== (client.partnerPrice || 0)) {
    client.partnerPrice = Math.round(priceNumber);
    dirty = true;
  }
  const loc = normalizeLocationInput(location);
  if (loc.address) {
    const currentAddress = String(client.partnerLocation?.address || '').trim().toLowerCase();
    if (loc.address.toLowerCase() !== currentAddress) {
      client.partnerLocation = loc;
      addLocationIfNew(client, loc);
      dirty = true;
    }
  }
  if (!dirty) return null;
  await client.save();
  return client;
}

// Post-save "Bekor qilish" uchun: yangi yaratilgan hamkor mijoz o'chiriladi (soft),
// mavjud mijoz esa oldingi hamkorlik holatiga qaytariladi.
export async function revertPartnerContract({ clientId, created = false, prev = null } = {}) {
  const client = await Client.findOne({ _id: clientId });
  if (!client) return null;
  if (created) {
    client.isDeleted = true;
    client.deletedAt = new Date();
    await client.save();
    return client;
  }
  client.isPartner = prev ? !!prev.isPartner : false;
  client.partnerPrice = prev?.partnerPrice || 0;
  client.partnerLocation = prev?.partnerLocation || null;
  client.partnerSince = prev?.partnerSince || null;
  await client.save();
  return client;
}

// Tashrif sanasi: tarixiy xizmatda serviceDateTime (voqea sanasi), bo'lmasa completedAt.
// Hisobot va oylik hisob BIR XIL ta'rifdan foydalanadi (mos kelmaslik bo'lmasin).
const VISIT_DATE_EXPR = { $ifNull: ['$serviceDateTime', '$completedAt'] };

// Joriy oy (yoki berilgan oy) ichida hamkorga necha marta borilgan — BAJARILGAN xizmatlar.
export async function countMonthVisits(clientId, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const rows = await Service.aggregate([
    {
      $match: {
        clientId: typeof clientId === 'string' ? new mongoose.Types.ObjectId(clientId) : clientId,
        isDeleted: { $ne: true },
        status: SERVICE_STATUS.DONE,
      },
    },
    { $addFields: { visitDate: VISIT_DATE_EXPR } },
    { $match: { visitDate: { $gte: from, $lte: to } } },
    { $count: 'visits' },
  ]);
  return rows[0]?.visits || 0;
}

// Hisobot uchun: har bir hamkor mijoz — davr ichidagi tashriflar soni va jami daromad
// (bajarilgan xizmatlar narxi yig'indisi; xizmat daromadi "bajarildi"da yoziladi).
export async function getPartnerReportRows({ from = null, to = null } = {}) {
  const partners = await Client.find({ isPartner: true, ...notDeleted }).sort({ name: 1 }).lean();
  if (!partners.length) return [];

  const visitMatch = { visitDate: {} };
  if (from) visitMatch.visitDate.$gte = new Date(from);
  if (to) visitMatch.visitDate.$lte = new Date(to);
  const hasRange = !!(from || to);

  const pipeline = [
    {
      $match: {
        clientId: { $in: partners.map((p) => p._id) },
        isDeleted: { $ne: true },
        status: SERVICE_STATUS.DONE,
      },
    },
    { $addFields: { visitDate: VISIT_DATE_EXPR } },
    ...(hasRange ? [{ $match: visitMatch }] : []),
    { $group: { _id: '$clientId', visits: { $sum: 1 }, total: { $sum: { $ifNull: ['$price', 0] } } } },
  ];
  const rows = await Service.aggregate(pipeline);
  const byClient = new Map(rows.map((row) => [String(row._id), row]));

  return partners.map((partner) => {
    const stats = byClient.get(String(partner._id)) || { visits: 0, total: 0 };
    return {
      clientId: String(partner._id),
      name: partner.name || '',
      phone: partner.phone || '',
      partnerPrice: partner.partnerPrice || 0,
      address: partner.partnerLocation?.address || '',
      visits: stats.visits,
      total: stats.total,
    };
  });
}

export default {
  findClientByExactName,
  findPartnerByName,
  upsertPartnerContract,
  syncPartnerDefaultsFromVisit,
  revertPartnerContract,
  countMonthVisits,
  getPartnerReportRows,
};
