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
export async function findOrCreateClient({ name, phone, location = '', coordinates = null }) {
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

  // Manzilni mijoz ro'yxatiga qo'shamiz (agar yangi bo'lsa).
  if (location) {
    const exists = client.locations.some((l) => l.address === location);
    if (!exists) {
      client.locations.push({ address: location, coordinates: coordinates || { lat: null, lng: null } });
    }
  }
  await client.save();
  return client;
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

  // Manzil berilgan bo'lsa va hali ro'yxatda bo'lmasa — qo'shamiz (create bilan bir xil mantiq).
  if (data.location) {
    const client = await Client.findOne({ _id: id, ...notDeleted });
    if (!client) return null;
    Object.assign(client, allowed);
    if (!client.locations.some((l) => l.address === data.location)) {
      client.locations.push({ address: data.location, coordinates: { lat: null, lng: null } });
    }
    await client.save();
    return client;
  }

  return Client.findOneAndUpdate({ _id: id, ...notDeleted }, allowed, { new: true });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
