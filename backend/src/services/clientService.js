// Mijozlar bilan ishlash mantig'i.
import Client from '../models/Client.js';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import { normalizePhone } from '../utils/phone.js';

const notDeleted = { isDeleted: { $ne: true } };

// Telefon bo'yicha mijozni topadi yoki yangisini yaratadi.
// Manzil berilsa — mijoz manzillari ro'yxatiga qo'shadi (takrorlanmasa).
export async function findOrCreateClient({ name, phone, location = '', coordinates = null }) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('Telefon raqami noto\'g\'ri');

  let client = await Client.findOne({ phone: normalized, ...notDeleted });
  if (!client) {
    client = await Client.create({ name: name || 'Noma\'lum', phone: normalized, locations: [] });
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

export async function listClients({ search = '' } = {}) {
  const filter = { ...notDeleted };
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { 'locations.address': rx }];
  }
  return Client.find(filter).sort({ updatedAt: -1 }).lean();
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
  return { ...client, services, totalSpent };
}

export async function updateClient(id, data) {
  const allowed = {};
  if (data.name !== undefined) allowed.name = data.name;
  if (data.phone !== undefined) allowed.phone = normalizePhone(data.phone);
  return Client.findOneAndUpdate({ _id: id, ...notDeleted }, allowed, { new: true });
}

// Qarzi bor mijozlar ro'yxati.
export async function listDebtors() {
  return Client.find({ totalDebt: { $gt: 0 }, ...notDeleted }).sort({ totalDebt: -1 }).lean();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
