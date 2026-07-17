// BIR MARTALIK migratsiya: ko'p-jadval (sheets) tizimi uchun mavjud qatorlarni
// jadvallar bo'ylab taqsimlaydi. Har foydalanuvchi + scope uchun sheetId'siz qatorlar
// createdAt tartibida 30 talik bo'laklarga bo'linadi: "Jadval 1", "Jadval 2", ...
// Oxirgi (to'lmagan) bo'lak FAOL jadval bo'ladi; hammasi to'liq bo'lsa yangi bo'sh
// faol jadval ochiladi. IDEMPOTENT — `migrations` kolleksiyasidagi bayroq bilan.
//
// MUHIM: bu faqat tashkiliy taqsimot — hech qanday qator o'chirilmaydi/yashirilmaydi,
// qidiruv va hisobotlar sheetId'ga qaramaydi.
import mongoose from 'mongoose';
import { runGlobal } from './tenantScope.js';
import { SHEET_ROW_LIMIT } from '../services/sheetService.js';

const FLAG_KEY = 'sheets_v1';

// scope -> qator manbalari: [kolleksiya, qo'shimcha filtr]
const SCOPE_SOURCES = {
  services: [['services', {}]],
  income: [['transactions', { type: 'income' }]],
  expense: [['transactions', { type: 'expense' }]],
  categories: [
    ['expensecategories', {}],
    ['incomecategories', {}],
    ['materialcategories', {}],
  ],
};

export async function migrateSheets() {
  return runGlobal(async () => {
    const db = mongoose.connection.db;
    const migrations = db.collection('migrations');
    if (await migrations.findOne({ key: FLAG_KEY })) return { skipped: true };

    const sheets = db.collection('sheets');
    let createdSheets = 0;
    let stampedRows = 0;

    for (const [scope, sources] of Object.entries(SCOPE_SOURCES)) {
      // Shu scope'da qatori bor barcha foydalanuvchilar.
      const userIds = new Set();
      for (const [colName, extra] of sources) {
        const ids = await db.collection(colName).distinct('telegramUserId', {
          ...extra,
          telegramUserId: { $exists: true, $nin: [null, ''] },
        });
        ids.forEach((id) => userIds.add(String(id)));
      }

      for (const uid of userIds) {
        // sheetId'siz qatorlar (o'chirilganlar HAM taqsimlanadi — tiklansa jadvalida chiqsin).
        const rows = [];
        for (const [colName, extra] of sources) {
          const docs = await db
            .collection(colName)
            .find({ ...extra, telegramUserId: uid, $or: [{ sheetId: { $exists: false } }, { sheetId: null }] })
            .project({ _id: 1, createdAt: 1 })
            .toArray();
          docs.forEach((d) => rows.push({ col: colName, _id: d._id, createdAt: d.createdAt || new Date(0) }));
        }
        if (!rows.length) continue;
        rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        const existingCount = await sheets.countDocuments({ telegramUserId: uid, scope, isDeleted: { $ne: true } });
        const chunks = [];
        for (let i = 0; i < rows.length; i += SHEET_ROW_LIMIT) {
          chunks.push(rows.slice(i, i + SHEET_ROW_LIMIT));
        }

        const now = new Date();
        for (let c = 0; c < chunks.length; c += 1) {
          const isLast = c === chunks.length - 1;
          const full = chunks[c].length >= SHEET_ROW_LIMIT;
          const sheetDoc = {
            telegramUserId: uid,
            scope,
            name: `Jadval ${existingCount + c + 1}`,
            // Oxirgi va to'lmagan bo'lak — faol; qolganlari arxiv.
            status: isLast && !full ? 'active' : 'archived',
            isDeleted: false,
            createdAt: new Date(now.getTime() + c), // tartib saqlansin
            updatedAt: now,
            ...(isLast && !full ? {} : { archivedAt: now }),
          };
          const res = await sheets.insertOne(sheetDoc);
          createdSheets += 1;
          const sheetId = res.insertedId;
          const byCol = new Map();
          for (const row of chunks[c]) {
            if (!byCol.has(row.col)) byCol.set(row.col, []);
            byCol.get(row.col).push(row._id);
          }
          for (const [colName, ids] of byCol) {
            const upd = await db.collection(colName).updateMany({ _id: { $in: ids } }, { $set: { sheetId } });
            stampedRows += upd.modifiedCount || 0;
          }
        }

        // Hammasi to'liq bo'laklar bo'lsa — davom etish uchun bo'sh faol jadval.
        const hasActive = await sheets.findOne({ telegramUserId: uid, scope, status: 'active', isDeleted: { $ne: true } });
        if (!hasActive) {
          await sheets.insertOne({
            telegramUserId: uid,
            scope,
            name: `Jadval ${existingCount + chunks.length + 1}`,
            status: 'active',
            isDeleted: false,
            createdAt: new Date(now.getTime() + chunks.length),
            updatedAt: now,
          });
          createdSheets += 1;
        }
      }
    }

    await migrations.insertOne({ key: FLAG_KEY, at: new Date(), createdSheets, stampedRows });
    console.log(`[MIGRATION][SHEETS] ${createdSheets} ta jadval yaratildi, ${stampedRows} ta qator taqsimlandi (30 talik bo'laklar).`);
    return { createdSheets, stampedRows };
  });
}

export default migrateSheets;
