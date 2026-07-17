// KO'P-JADVAL (SHEETS) TIZIMI — Google Sheets'dagi tab'lar kabi: har bir jadval sahifasi
// (Xizmatlar / Moliya-Kirim / Moliya-Chiqim / Kategoriyalar) bir nechta nomli jadvaldan
// iborat bo'lishi mumkin. Har scope'da BITTA faol jadval bor — yangi yozuvlar shu yerga
// tushadi. 30 qator to'lganda faol jadval AVTOMATIK arxivlanadi va yangi bo'sh jadval
// ochiladi (egaga bot orqali xabar boradi).
//
// MUHIM: arxivlash FAQAT tashkiliy — arxiv jadval ham to'liq tahrirlanadi, qidiruv va
// hisobotlar esa sheetId'ga qaramaydi (barcha jadvallarni birga qamrab oladi).
//
// Texnik: `sheets` kolleksiyasi RAW (mongoose modelsiz) ishlatiladi — model hook'lari
// ichidan (har qanday ALS kontekstda) ham xavfsiz chaqirilishi uchun; har so'rovda
// telegramUserId ANIQ beriladi.
import mongoose from 'mongoose';
import { currentUserId } from '../db/tenantScope.js';
import { notifyOwner } from '../bot/notify.js';

export const SHEET_SCOPES = ['services', 'income', 'expense', 'categories'];
// Bitta jadvaldagi maksimal qator soni — to'lganda avto-arxiv.
export const SHEET_ROW_LIMIT = 30;

function sheetsCol() {
  return mongoose.connection.db.collection('sheets');
}

function toId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(String(value)) : null;
}

function requireUser(explicitUserId) {
  const uid = String(explicitUserId || currentUserId() || '').trim();
  if (!uid) throw new Error("sheetService: telegramUserId aniqlanmadi");
  return uid;
}

function assertScope(scope) {
  if (!SHEET_SCOPES.includes(scope)) {
    const err = new Error("Noto'g'ri jadval turi (scope)");
    err.status = 400;
    throw err;
  }
  return scope;
}

// Scope'dagi faol jadvalni qaytaradi; yo'q bo'lsa "Jadval 1" yaratadi.
export async function ensureActiveSheet(scope, explicitUserId = null) {
  assertScope(scope);
  const uid = requireUser(explicitUserId);
  const col = sheetsCol();
  const active = await col.findOne({ telegramUserId: uid, scope, status: 'active', isDeleted: { $ne: true } });
  if (active) return active;
  const count = await col.countDocuments({ telegramUserId: uid, scope, isDeleted: { $ne: true } });
  const now = new Date();
  const doc = {
    telegramUserId: uid,
    scope,
    name: `Jadval ${count + 1}`,
    status: 'active',
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };
  const res = await col.insertOne(doc);
  return { ...doc, _id: res.insertedId };
}

// Faol jadval IDsi (yozuv yaratishda sheetId shtampi uchun).
export async function activeSheetIdFor(scope, explicitUserId = null) {
  const sheet = await ensureActiveSheet(scope, explicitUserId);
  return sheet._id;
}

// Scope bo'yicha qator kolleksiyasi va filtri (faqat AKTIV qatorlar sanaladi).
function rowCounterFor(scope) {
  const db = mongoose.connection.db;
  if (scope === 'services') {
    return (uid, sheetId) =>
      db.collection('services').countDocuments({ telegramUserId: uid, sheetId, isDeleted: { $ne: true } });
  }
  if (scope === 'income' || scope === 'expense') {
    return (uid, sheetId) =>
      db.collection('transactions').countDocuments({
        telegramUserId: uid,
        sheetId,
        type: scope === 'income' ? 'income' : 'expense',
        isDeleted: { $ne: true },
      });
  }
  // categories: uch kolleksiyadagi saqlangan kategoriyalar yig'indisi.
  return async (uid, sheetId) => {
    const names = ['expensecategories', 'incomecategories', 'materialcategories'];
    let total = 0;
    for (const name of names) {
      total += await db.collection(name).countDocuments({ telegramUserId: uid, sheetId, isDeleted: { $ne: true } });
    }
    return total;
  };
}

export async function countSheetRows(scope, sheetId, explicitUserId = null) {
  const uid = requireUser(explicitUserId);
  const id = toId(sheetId);
  if (!id) return 0;
  return rowCounterFor(scope)(uid, id);
}

const SCOPE_LABEL = {
  services: 'Xizmatlar',
  income: 'Moliya (Kirim)',
  expense: 'Moliya (Chiqim)',
  categories: 'Kategoriyalar',
};

// AVTO-ARXIV: faol jadval 30 qatorga yetgan bo'lsa — arxivlaydi, yangi bo'sh jadval
// ochadi va egaga xabar beradi. Har yozuv saqlangandan keyin chaqiriladi (idempotent,
// to'lmagan bo'lsa hech narsa qilmaydi). Xatosi asosiy amalni to'xtatmaydi (chaqiruvchi
// .catch bilan chaqiradi).
export async function maybeArchiveFullSheet(scope, explicitUserId = null) {
  assertScope(scope);
  const uid = requireUser(explicitUserId);
  const col = sheetsCol();
  const active = await col.findOne({ telegramUserId: uid, scope, status: 'active', isDeleted: { $ne: true } });
  if (!active) return null;

  const rows = await rowCounterFor(scope)(uid, active._id);
  if (rows < SHEET_ROW_LIMIT) return null;

  const now = new Date();
  // Atomar: faqat hali 'active' bo'lsa arxivlaymiz (parallel yozuvlarda bitta g'olib).
  const archived = await col.findOneAndUpdate(
    { _id: active._id, status: 'active' },
    { $set: { status: 'archived', archivedAt: now, updatedAt: now } },
    { returnDocument: 'after' }
  );
  const archivedDoc = archived?.value ?? archived;
  if (!archivedDoc || archivedDoc.status !== 'archived') return null;

  const total = await col.countDocuments({ telegramUserId: uid, scope, isDeleted: { $ne: true } });
  const fresh = {
    telegramUserId: uid,
    scope,
    name: `Jadval ${total + 1}`,
    status: 'active',
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };
  const res = await col.insertOne(fresh);

  // Egaga bildirish — arxiv hech narsani yashirmasligini ham eslatamiz.
  notifyOwner(
    `📄 ${SCOPE_LABEL[scope]} bo'limida "${active.name}" jadvali to'ldi (${SHEET_ROW_LIMIT} qator) — arxivga o'tkazildi.\n` +
      `Yangi "${fresh.name}" jadvali ochildi, yozuvlar endi shu yerga tushadi.\n` +
      `Arxivdagi jadvalni istalgan vaqt ochib tahrirlashingiz mumkin; qidiruv va hisobotlar barcha jadvallarni birga qamrab oladi.`,
    { explicitTelegramId: uid }
  ).catch(() => {});

  return { archived: archivedDoc, active: { ...fresh, _id: res.insertedId } };
}

// Jadvallar ro'yxati (faol birinchi, keyin eng yangi arxivlar) — qator soni bilan.
export async function listSheets(scope, explicitUserId = null) {
  assertScope(scope);
  const uid = requireUser(explicitUserId);
  await ensureActiveSheet(scope, uid);
  const col = sheetsCol();
  const sheets = await col
    .find({ telegramUserId: uid, scope, isDeleted: { $ne: true } })
    .sort({ createdAt: 1 })
    .toArray();
  const counter = rowCounterFor(scope);
  const out = [];
  for (const sheet of sheets) {
    out.push({
      _id: String(sheet._id),
      scope: sheet.scope,
      name: sheet.name,
      status: sheet.status,
      rowCount: await counter(uid, sheet._id),
      createdAt: sheet.createdAt,
      archivedAt: sheet.archivedAt || null,
    });
  }
  // Faol jadval doim birinchi.
  out.sort((a, b) => (a.status === 'active' ? -1 : b.status === 'active' ? 1 : new Date(b.createdAt) - new Date(a.createdAt)));
  return out;
}

// Yangi jadval yaratish (cheklovsiz, foydalanuvchi nomlaydi) — YANGI jadval faol bo'ladi,
// avvalgi faol arxivga o'tadi (u baribir to'liq tahrirlanadi).
export async function createSheet(scope, name, explicitUserId = null) {
  assertScope(scope);
  const uid = requireUser(explicitUserId);
  const clean = String(name || '').replace(/\s+/g, ' ').trim();
  const col = sheetsCol();
  const now = new Date();
  await col.updateMany(
    { telegramUserId: uid, scope, status: 'active', isDeleted: { $ne: true } },
    { $set: { status: 'archived', archivedAt: now, updatedAt: now } }
  );
  const total = await col.countDocuments({ telegramUserId: uid, scope, isDeleted: { $ne: true } });
  const doc = {
    telegramUserId: uid,
    scope,
    name: clean || `Jadval ${total + 1}`,
    status: 'active',
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };
  const res = await col.insertOne(doc);
  return { ...doc, _id: String(res.insertedId) };
}

// Jadval nomini o'zgartirish.
export async function renameSheet(sheetId, name, explicitUserId = null) {
  const uid = requireUser(explicitUserId);
  const clean = String(name || '').replace(/\s+/g, ' ').trim();
  if (!clean) {
    const err = new Error('Jadval nomini kiriting');
    err.status = 400;
    throw err;
  }
  const id = toId(sheetId);
  if (!id) {
    const err = new Error('Jadval topilmadi');
    err.status = 404;
    throw err;
  }
  const res = await sheetsCol().findOneAndUpdate(
    { _id: id, telegramUserId: uid, isDeleted: { $ne: true } },
    { $set: { name: clean, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  const doc = res?.value ?? res;
  if (!doc) {
    const err = new Error('Jadval topilmadi');
    err.status = 404;
    throw err;
  }
  return { ...doc, _id: String(doc._id) };
}

// Faol jadvaldagi N-qator (1 dan boshlab, createdAt tartibida) — bot "qator raqami"
// bilan murojaat qilganda (masalan lokatsiyani qatorga bog'lash).
export async function findServiceByRowNumber(rowNumber, explicitUserId = null) {
  const uid = requireUser(explicitUserId);
  const n = Number(rowNumber);
  if (!Number.isInteger(n) || n < 1 || n > 500) return null;
  const active = await sheetsCol().findOne({ telegramUserId: uid, scope: 'services', status: 'active', isDeleted: { $ne: true } });
  if (!active) return null;
  const rows = await mongoose.connection.db
    .collection('services')
    .find({ telegramUserId: uid, sheetId: active._id, isDeleted: { $ne: true } })
    .sort({ createdAt: 1 })
    .skip(n - 1)
    .limit(1)
    .toArray();
  return rows[0] || null;
}

export default {
  SHEET_SCOPES,
  SHEET_ROW_LIMIT,
  ensureActiveSheet,
  activeSheetIdFor,
  countSheetRows,
  maybeArchiveFullSheet,
  listSheets,
  createSheet,
  renameSheet,
  findServiceByRowNumber,
};
