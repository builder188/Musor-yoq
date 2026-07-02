// Mijozlar bilan ishlash mantig'i.
import Client from '../models/Client.js';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import Transaction from '../models/Transaction.js';
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

export async function listClients({ search = '', page = null, limit = null } = {}) {
  const filter = { ...notDeleted };
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { 'locations.address': rx }];
  }
  const pageNumber = Math.max(1, parseInt(page, 10) || 0);
  const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 0, 1), 100);
  if (!pageNumber || !limitNumber) return Client.find(filter).sort({ updatedAt: -1 }).lean();

  const [items, total] = await Promise.all([
    Client.find(filter)
      .sort({ updatedAt: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .lean(),
    Client.countDocuments(filter),
  ]);
  return { items, page: pageNumber, limit: limitNumber, total };
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
  return { ...client, services, paymentHistory, totalSpent };
}

export async function updateClient(id, data) {
  const allowed = {};
  if (data.name !== undefined) allowed.name = data.name;
  if (data.phone !== undefined) {
    allowed.phone = normalizePhone(data.phone);
    if (!allowed.phone || !/^\+998\d{9}$/.test(allowed.phone)) throw httpError(400, 'Telefon raqami noto\'g\'ri');
    const duplicate = await Client.findOne({ _id: { $ne: id }, phone: allowed.phone, ...notDeleted }).lean();
    if (duplicate) throw httpError(409, 'Bu telefon raqam boshqa aktiv mijozda bor');
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
