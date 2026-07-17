// BIR MARTALIK migratsiya: eski `clients` kolleksiyasidagi HAR BIR ma'lumotni
// Xizmatlar (services) qatorlariga ko'chiradi — endi mijoz ma'lumoti FAQAT o'sha yerda:
//   1) Mijozning xizmat qatorlarida bo'sh qolgan ism/telefon to'ldiriladi (backfill).
//   2) Hamkor (isPartner) mijozning qatorlari isPartner deb belgilanadi.
//   3) Xizmati YO'Q mijoz uchun "profil" qatori yaratiladi (ism/tel/manzil saqlanib qolsin).
//   4) Hamkorning standart narx/manzili eng oxirgi qatorda aks etmagan bo'lsa —
//      standartni saqlovchi shartnoma qatori yaratiladi (sanasiz, kutilmoqda, balansga ta'sirsiz).
//   5) Tekshiruv: har bir aktiv mijoz uchun kamida bitta aktiv qator borligi tasdiqlanadi.
//
// IDEMPOTENT: muvaffaqiyatli o'tgach `migrations` kolleksiyasiga bayroq yoziladi —
// keyingi startuplarda no-op. `clients` kolleksiyasi O'CHIRILMAYDI (zaxira sifatida
// qoladi), lekin kod endi uni o'qimaydi.
import mongoose from 'mongoose';
import { runGlobal } from './tenantScope.js';
import { legacyOwnerId } from '../config/env.js';

const FLAG_KEY = 'clients_into_services_v1';

function toLocation(loc) {
  if (!loc) return { address: '', mapUrl: null, coordinates: null };
  return {
    address: String(loc.address || '').trim(),
    mapUrl: loc.mapUrl || null,
    coordinates: loc.coordinates && Number.isFinite(Number(loc.coordinates.lat))
      ? { lat: Number(loc.coordinates.lat), lng: Number(loc.coordinates.lng) }
      : null,
  };
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mijozning barcha AKTIV xizmat qatorlari (clientId, telefon yoki aniq ism bo'yicha).
async function identityRowsFor(services, client) {
  const or = [{ clientId: client._id }];
  if (client.phone) or.push({ clientPhone: client.phone });
  if (client.name) or.push({ clientName: { $regex: `^${escapeRegex(client.name)}$`, $options: 'i' } });
  return services
    .find({ telegramUserId: client.telegramUserId, isDeleted: { $ne: true }, $or: or })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function migrateClientsIntoServices() {
  return runGlobal(async () => {
    const db = mongoose.connection.db;
    const migrations = db.collection('migrations');
    const done = await migrations.findOne({ key: FLAG_KEY });
    if (done) return { skipped: true };

    const clientsCol = db.collection('clients');
    const services = db.collection('services');
    const clients = await clientsCol.find({}).toArray();
    if (!clients.length) {
      await migrations.insertOne({ key: FLAG_KEY, at: new Date(), clients: 0 });
      console.log('[MIGRATION] clients kolleksiyasi bo\'sh — ko\'chirish shart emas.');
      return { clients: 0 };
    }

    const fallbackOwner = legacyOwnerId() ? String(legacyOwnerId()) : null;
    let backfilledNames = 0;
    let backfilledPhones = 0;
    let partnerMarked = 0;
    let createdRows = 0;
    const problems = [];

    for (const client of clients) {
      const owner = client.telegramUserId ? String(client.telegramUserId) : fallbackOwner;
      if (!owner) {
        problems.push(`Egasi noma'lum mijoz o'tkazib yuborildi: ${client.name || client._id}`);
        continue;
      }
      client.telegramUserId = owner;

      // 1) Backfill: shu mijozga bog'langan qatorlarda bo'sh ism/telefonni to'ldiramiz.
      if (client.name) {
        const res = await services.updateMany(
          { clientId: client._id, $or: [{ clientName: { $exists: false } }, { clientName: null }, { clientName: '' }] },
          { $set: { clientName: client.name } }
        );
        backfilledNames += res.modifiedCount || 0;
      }
      if (client.phone) {
        const res = await services.updateMany(
          { clientId: client._id, $or: [{ clientPhone: { $exists: false } }, { clientPhone: null }, { clientPhone: '' }] },
          { $set: { clientPhone: client.phone } }
        );
        backfilledPhones += res.modifiedCount || 0;
      }

      // 2) Hamkor belgisi — mijozning barcha qatorlariga (identifikatsiya bo'yicha).
      if (client.isPartner) {
        const or = [{ clientId: client._id }];
        if (client.phone) or.push({ clientPhone: client.phone });
        if (client.name) or.push({ clientName: { $regex: `^${escapeRegex(client.name)}$`, $options: 'i' } });
        const res = await services.updateMany(
          { telegramUserId: owner, $or: or, isPartner: { $ne: true } },
          { $set: { isPartner: true } }
        );
        partnerMarked += res.modifiedCount || 0;
      }

      // O'chirilgan mijoz uchun yangi qator yaratilmaydi (tarixi qatorlarda saqlanadi).
      if (client.isDeleted) continue;

      const rows = await identityRowsFor(services, client);
      const latest = rows[0] || null;

      // Qatorlarda yo'q manzillar (kamdan-kam — manzillar odatda xizmatlardan yig'ilgan).
      const rowAddresses = new Set(
        rows.map((r) => String(r.location?.address || '').trim().toLowerCase()).filter(Boolean)
      );
      const clientAddresses = (client.locations || []).map(toLocation).filter((l) => l.address);
      const partnerLoc = client.partnerLocation ? toLocation(client.partnerLocation) : null;
      const missingAddresses = clientAddresses.filter(
        (l) => !rowAddresses.has(l.address.toLowerCase())
      );

      const needProfileRow = rows.length === 0;
      const latestAddress = String(latest?.location?.address || '').trim().toLowerCase();
      const needContractRow =
        client.isPartner &&
        ((client.partnerPrice > 0 && (latest?.price || 0) !== client.partnerPrice) ||
          (partnerLoc?.address && latestAddress !== partnerLoc.address.toLowerCase()));

      if (needProfileRow || needContractRow || missingAddresses.length) {
        const location = partnerLoc?.address
          ? partnerLoc
          : missingAddresses[0] || clientAddresses[0] || { address: '', mapUrl: null, coordinates: null };
        const noteParts = [
          client.isPartner ? 'Hamkorlik shartnomasi' : 'Mijoz profili',
          "(Mijozlar bo'limidan ko'chirildi)",
        ];
        const extraAddresses = missingAddresses
          .filter((l) => l.address.toLowerCase() !== location.address.toLowerCase())
          .map((l) => l.address);
        if (extraAddresses.length) noteParts.push(`Boshqa manzillar: ${extraAddresses.join('; ')}`);

        const now = new Date();
        await services.insertOne({
          telegramUserId: owner,
          clientName: client.name || '',
          clientPhone: client.phone || '',
          isPartner: !!client.isPartner,
          location,
          serviceDateTime: null,
          isHistorical: false,
          price: client.isPartner && client.partnerPrice > 0 ? client.partnerPrice : 0,
          originalAmount: null,
          originalCurrency: null,
          exchangeRateUsed: null,
          paymentMethod: 'naqd',
          paymentStatus: 'tolanmagan',
          paidAmount: 0,
          status: 'kutilmoqda',
          cancellationReason: null,
          completedAt: null,
          reminderAt: null,
          reminderSent: true,
          startReminderSent: true,
          confirmAt: null,
          confirmSent: true,
          notes: noteParts.join(' '),
          images: [],
          incomeTransactionId: null,
          incomeManuallyRemoved: false,
          isDeletedByClientDeletion: false,
          clientDeletionNote: '',
          isDeleted: false,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        createdRows += 1;
      }
    }

    // 5) Tekshiruv: har bir aktiv mijoz uchun kamida bitta aktiv qator bormi?
    let verified = 0;
    for (const client of clients) {
      if (client.isDeleted || !client.telegramUserId) continue;
      const rows = await identityRowsFor(services, client);
      if (rows.length) verified += 1;
      else problems.push(`TEKSHIRUV: ${client.name || client._id} uchun qator topilmadi!`);
    }

    if (problems.length) {
      // Muammo bor — bayroq YOZILMAYDI, keyingi startupda qayta uriniladi (idempotent).
      for (const p of problems) console.error(`[MIGRATION][CLIENTS] ${p}`);
      console.error('[MIGRATION][CLIENTS] Ko\'chirish TO\'LIQ tasdiqlanmadi — bayroq yozilmadi, keyingi startupda qayta uriniladi.');
    } else {
      await migrations.insertOne({
        key: FLAG_KEY,
        at: new Date(),
        clients: clients.length,
        verified,
        createdRows,
        backfilledNames,
        backfilledPhones,
        partnerMarked,
      });
    }

    console.log(
      `[MIGRATION][CLIENTS] ${clients.length} ta mijoz ko'rildi: ${verified} tasi qatorlarda tasdiqlandi, ` +
        `${createdRows} ta yangi qator yaratildi, ism backfill=${backfilledNames}, tel backfill=${backfilledPhones}, ` +
        `hamkor belgisi=${partnerMarked}. 'clients' kolleksiyasi zaxira sifatida saqlanib qoldi (kod uni o'qimaydi).`
    );
    return { clients: clients.length, verified, createdRows, problems: problems.length };
  });
}

export default migrateClientsIntoServices;
