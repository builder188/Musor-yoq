// Mijozlar bilan ishlash mantig'i.
import Client from '../models/Client.js';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import Transaction from '../models/Transaction.js';
import { findClientByExactName } from './partnerService.js';
import { normalizePhone } from '../utils/phone.js';

const notDeleted = { isDeleted: { $ne: true } };

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Telefon bo'yicha mijozni topadi yoki yangisini yaratadi.
// Manzil berilsa — mijoz manzillari ro'yxatiga qo'shadi (takrorlanmasa).
export async function findOrCreateClient({ name, phone, location = '', mapUrl = '', coordinates = null }) {
  const normalized = normalizePhone(phone);
  if (!normalized || !/^\+998\d{9}$/.test(normalized)) throw httpError(400, 'Telefon raqami noto\'g\'ri');

  let client = await Client.findOne({ phone: normalized });
  if (!client && name) {
    // Telefon bo'yicha topilmadi: xuddi shu NOMLI, TELEFONSIZ mijoz (odatda hamkor)
    // bo'lsa — dublikat ochmay, telefonni o'sha mijozga biriktiramiz.
    const byName = await findClientByExactName(name);
    if (byName && !byName.phone && !byName.isDeleted) {
      byName.phone = normalized;
      client = byName;
    }
  }
  if (!client) {
    client = await Client.create({ name: name || 'Noma\'lum', phone: normalized, locations: [] });
  } else if (client.isDeleted) {
    client.isDeleted = false;
    client.deletedAt = null;
    client.isDeletedByClientDeletion = false;
    if (name) client.name = name;
  } else if (name && client.name !== name) {
    client.name = name;
  }

  // Manzilni mijoz ro'yxatiga qo'shamiz (yangi bo'lsa) yoki xuddi shu nomli mavjud
  // yozuvni yangi pin koordinatasi/mapUrl bilan boyitamiz (dublikat satr ochilmaydi).
  const locationData = normalizeLocationInput(typeof location === 'object' ? location : { address: location, mapUrl, coordinates });
  if (locationData.address && upsertLocation(client.locations, locationData)) {
    client.markModified('locations');
  }
  await client.save();
  return client;
}

// Ro'yxatga qo'shadi yoki bir xil manzil MATNIdagi yozuvni birlashtiradi:
// yangi kelgan koordinata/mapUrl ustuvor (eng so'nggi pin — eng ishonchli),
// bo'lmasa eskisi saqlanadi. true = ro'yxat o'zgardi.
function upsertLocation(locations, incoming) {
  const idx = locations.findIndex(
    (item) => normalizeLocationInput(item).address.toLowerCase() === incoming.address.toLowerCase()
  );
  if (idx === -1) {
    locations.push(incoming);
    return true;
  }
  const existing = normalizeLocationInput(locations[idx]);
  const merged = {
    address: existing.address,
    mapUrl: incoming.mapUrl || existing.mapUrl,
    coordinates: incoming.coordinates || existing.coordinates,
  };
  if (locationKey(merged) === locationKey(existing)) return false;
  locations[idx] = merged;
  return true;
}

// Har mijoz uchun xizmat statistikasi (jadval ustunlari): xizmatlar soni,
// jami to'langan summa va joriy qarz (bajarilgan, lekin to'lanmagan qismi).
// Bitta aggregatsiya — N+1 yo'q; tenant plugin avtomatik scope qiladi.
async function serviceStatsByClient() {
  const rows = await Service.aggregate([
    { $match: { isDeleted: { $ne: true }, clientId: { $ne: null } } },
    {
      $group: {
        _id: '$clientId',
        servicesCount: { $sum: { $cond: [{ $ne: ['$status', SERVICE_STATUS.CANCELLED] }, 1, 0] } },
        totalPaid: {
          $sum: {
            $cond: [{ $ne: ['$status', SERVICE_STATUS.CANCELLED] }, { $ifNull: ['$paidAmount', 0] }, 0],
          },
        },
        // Qarz — faqat BAJARILGAN xizmatning to'lanmagan qismi (kelajakdagi ish qarz emas).
        currentDebt: {
          $sum: {
            $cond: [
              { $eq: ['$status', SERVICE_STATUS.DONE] },
              { $max: [0, { $subtract: [{ $ifNull: ['$price', 0] }, { $ifNull: ['$paidAmount', 0] }] }] },
              0,
            ],
          },
        },
      },
    },
  ]);
  return new Map(rows.map((row) => [String(row._id), row]));
}

function attachServiceStats(clients, statsMap) {
  return clients.map((client) => {
    const stats = statsMap.get(String(client._id));
    return {
      ...client,
      servicesCount: stats?.servicesCount || 0,
      totalPaid: stats?.totalPaid || 0,
      currentDebt: stats?.currentDebt || 0,
    };
  });
}

export async function listClients({ search = '', page = null, limit = null } = {}) {
  const filter = { ...notDeleted };
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { 'locations.address': rx }];
    // Raqamli so'rov ("150000" yoki "150 000") — SUMMA bo'yicha ham qidiradi:
    // shu narxdagi xizmati bor mijozlar natijaga qo'shiladi (bosh sahifa qidiruvi).
    const numeric = Number(String(search).replace(/[\s']/g, ''));
    if (Number.isFinite(numeric) && numeric > 0 && /^[\d\s']+$/.test(String(search).trim())) {
      const ids = await Service.distinct('clientId', {
        isDeleted: { $ne: true },
        clientId: { $ne: null },
        price: numeric,
      });
      if (ids.length) filter.$or.push({ _id: { $in: ids } });
    }
  }
  const pageNumber = Math.max(1, parseInt(page, 10) || 0);
  const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 0, 1), 100);
  if (!pageNumber || !limitNumber) {
    const [clients, statsMap] = await Promise.all([
      Client.find(filter).sort({ updatedAt: -1 }).lean(),
      serviceStatsByClient(),
    ]);
    return attachServiceStats(clients, statsMap);
  }

  const [items, total, statsMap] = await Promise.all([
    Client.find(filter)
      .sort({ updatedAt: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .lean(),
    Client.countDocuments(filter),
    serviceStatsByClient(),
  ]);
  return { items: attachServiceStats(items, statsMap), page: pageNumber, limit: limitNumber, total };
}

export async function getClientById(id) {
  return Client.findOne({ _id: id, ...notDeleted });
}

// Mijoz tafsiloti: xizmatlar tarixi + jami sarflangan (bajarilgan xizmatlardan hisoblanadi).
export async function getClientDetail(id) {
  const client = await Client.findOne({ _id: id, ...notDeleted }).lean();
  if (!client) return null;
  const services = await Service.find({ clientId: id, ...notDeleted })
    .sort({ serviceDateTime: -1 })
    .lean();
  const totalSpent = services
    .filter((s) => s.status === SERVICE_STATUS.DONE)
    .reduce((sum, s) => sum + (s.price || 0), 0);
  // Joriy oy tashriflari (bajarilgan xizmatlar) — hamkor sahifasida ko'rsatiladi.
  // Tashrif sanasi: serviceDateTime (voqea sanasi), bo'lmasa completedAt.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const currentMonthVisits = services.filter((s) => {
    if (s.status !== SERVICE_STATUS.DONE) return false;
    const visitDate = new Date(s.serviceDateTime || s.completedAt || 0);
    return visitDate >= monthStart && visitDate <= monthEnd;
  }).length;
  const serviceIds = services.map((service) => service._id);
  const paymentHistory = serviceIds.length
    ? await Transaction.find({
        serviceId: { $in: serviceIds },
        type: 'income',
        ...notDeleted,
      })
        .sort({ date: -1 })
        .lean()
    : [];
  return { ...client, services, paymentHistory, totalSpent, currentMonthVisits };
}

export async function updateClient(id, data) {
  const allowed = {};
  if (data.name !== undefined) allowed.name = data.name;
  if (data.phone !== undefined) {
    const rawPhone = String(data.phone || '').trim();
    // Hamkor (shartnomaviy) mijozda telefon ixtiyoriy — bo'sh qoldirish mumkin.
    // Oddiy mijozda telefon majburiy bo'lib qoladi.
    if (!rawPhone) {
      const existing = await Client.findOne({ _id: id, ...notDeleted }).select('isPartner').lean();
      const willBePartner = data.isPartner !== undefined ? !!data.isPartner : !!existing?.isPartner;
      if (!willBePartner) throw httpError(400, 'Telefon raqami noto\'g\'ri');
      allowed.phone = '';
    } else {
      allowed.phone = normalizePhone(rawPhone);
      if (!allowed.phone || !/^\+998\d{9}$/.test(allowed.phone)) throw httpError(400, 'Telefon raqami noto\'g\'ri');
      const duplicate = await Client.findOne({ _id: { $ne: id }, phone: allowed.phone, ...notDeleted }).lean();
      if (duplicate) throw httpError(409, 'Bu telefon raqam boshqa aktiv mijozda bor');
    }
  }

  // Hamkorlik maydonlari (Mini App'dan qo'lda tahrirlanadi).
  if (data.isPartner !== undefined) {
    allowed.isPartner = !!data.isPartner;
    if (allowed.isPartner) {
      const existing = await Client.findOne({ _id: id, ...notDeleted }).select('partnerSince').lean();
      if (!existing?.partnerSince) allowed.partnerSince = new Date();
    }
  }
  if (data.partnerPrice !== undefined) {
    const price = Number(data.partnerPrice);
    if (!Number.isFinite(price) || price < 0) throw httpError(400, 'Standart narx noto\'g\'ri');
    allowed.partnerPrice = Math.round(price);
  }
  if (data.partnerLocation !== undefined) {
    const loc = normalizeLocationInput(data.partnerLocation);
    allowed.partnerLocation = loc.address ? loc : null;
  }

  // Client edit formasidagi manzil birinchi manzilni yangilaydi; yangi xizmatlar esa ro'yxatga qo'shiladi.
  if (data.location) {
    const client = await Client.findOne({ _id: id, ...notDeleted });
    if (!client) return null;
    const location = normalizeLocationInput(data.location);
    Object.assign(client, allowed);
    if (location.address) {
      if (client.locations.length > 0) {
        client.locations[0] = location;
        client.locations = dedupeLocations(client.locations);
      } else {
        client.locations.push(location);
      }
    }
    await client.save();
    return client;
  }

  return Client.findOneAndUpdate({ _id: id, ...notDeleted }, allowed, { new: true });
}

function normalizeLocationInput(location) {
  if (typeof location === 'string') {
    return { address: location.trim(), mapUrl: null, coordinates: null };
  }
  return {
    address: String(location?.address || location?.text || '').trim(),
    mapUrl: normalizeMapUrl(location?.mapUrl || location?.mapLink || location?.url || ''),
    coordinates: normalizeCoordinates(location?.coordinates || location?.coords || location),
  };
}

function dedupeLocations(locations = []) {
  const seen = new Set();
  const result = [];
  for (const location of locations) {
    const normalized = normalizeLocationInput(location);
    if (!normalized.address) continue;
    const key = locationKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function locationKey(location) {
  return [location.address, location.mapUrl || '', coordinatesKey(location.coordinates)].join('\u0000');
}

function coordinatesKey(coordinates) {
  if (!coordinates) return '';
  return `${coordinates.lat},${coordinates.lng}`;
}

function normalizeMapUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : text;
  } catch {
    return text;
  }
}

function normalizeCoordinates(value) {
  if (!value) return null;
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.longitude ?? value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
