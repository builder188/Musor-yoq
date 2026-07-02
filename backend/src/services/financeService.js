import Transaction, { TX_TYPES, EXPENSE_CATEGORIES, MATERIAL_CATEGORY, USEFUL_ITEM_CATEGORY } from '../models/Transaction.js';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import { periodRange } from '../utils/dates.js';
import { resolveMaterialName, buildMaterialDescription } from './materialService.js';
import { ensureMaterialCategory } from './categoryService.js';

const notDeleted = { isDeleted: { $ne: true } };
const CATEGORY_KEYWORDS = {
  yoqilgi: ['benzin', 'dizel', 'gaz', 'yoqilgi', 'yakit'],
  tamirlash: ['tamir', 'shina', 'moy', 'ehtiyot', 'zapchast', 'remont'],
  'oziq-ovqat': ['ovqat', 'non', 'tushlik', 'choy', 'kafe'],
};

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function parsePositiveAmount(value) {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest("Summa noto'g'ri");
  return amount;
}

function parseOptionalDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest("Sana noto'g'ri");
  return date;
}

function detectExpenseCategory(text = '') {
  const value = String(text || '').toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => value.includes(keyword))) return category;
  }
  return 'boshqa_chiqim';
}

function normalizeCategory(type, category) {
  if (type === TX_TYPES.INCOME) {
    const value = String(category || '').trim().toLowerCase();
    if (value === MATERIAL_CATEGORY) return MATERIAL_CATEGORY;
    if (value === USEFUL_ITEM_CATEGORY) return USEFUL_ITEM_CATEGORY;
    return category === 'xizmat' ? 'xizmat' : 'boshqa_kirim';
  }
  const value = String(category || '').trim().toLowerCase();
  if (EXPENSE_CATEGORIES.includes(value)) return value;
  if (["yoqilg'i", 'yoqilg’i', 'fuel'].includes(value)) return 'yoqilgi';
  if (["ta'mirlash", 'ta’mirlash', 'tamir', 'remont'].includes(value)) return 'tamirlash';
  if (['boshqa', 'other'].includes(value)) return 'boshqa_chiqim';
  return 'boshqa_chiqim';
}

export async function getSummary(period = 'all') {
  const { from, to } = periodRange(period);
  const rows = await Transaction.aggregate([
    { $match: { ...notDeleted, date: { $gte: from, $lte: to } } },
    { $group: { _id: '$type', total: { $sum: '$amount' } } },
  ]);

  let income = 0;
  let expense = 0;
  for (const row of rows) {
    if (row._id === TX_TYPES.INCOME) income += row.total;
    if (row._id === TX_TYPES.EXPENSE) expense += row.total;
  }
  return { period, income, expense, totalIncome: income, totalExpense: expense, balance: income - expense, from, to };
}

// Boyitilgan balans hisoboti (standartlashtirilgan shablon uchun): kirim/chiqim/balans
// ustiga eng katta/kichik xarajat, eng qimmat xizmat va bajarilgan/kutilayotgan xizmat soni.
// Barcha qiymatlar real aggregatsiyadan (davr filtri bilan); tenant plugin avtomatik scope qiladi.
export async function getBalanceReport(period = 'all') {
  const { from, to } = periodRange(period);
  const summary = await getSummary(period);

  const expenseMatch = { ...notDeleted, type: TX_TYPES.EXPENSE, date: { $gte: from, $lte: to } };
  const serviceMatch = { ...notDeleted, serviceDateTime: { $gte: from, $lte: to } };

  // Eng katta / eng kichik xarajat va eng qimmat xizmat — bitta-bittadan top yozuv.
  const [maxExpense] = await Transaction.aggregate([{ $match: expenseMatch }, { $sort: { amount: -1 } }, { $limit: 1 }]);
  const [minExpense] = await Transaction.aggregate([{ $match: expenseMatch }, { $sort: { amount: 1 } }, { $limit: 1 }]);
  const [topService] = await Service.aggregate([
    { $match: serviceMatch },
    { $sort: { price: -1 } },
    { $limit: 1 },
    { $project: { clientName: 1, price: 1, serviceDateTime: 1 } },
  ]);

  // Kutilayotgan xizmatlar: aniq davr berilsa o'sha oraliq; umumiy (joriy) holatda
  // kelajakdagilar ham sanaladi (yuqori chegara qo'yilmaydi).
  const pendingFilter = { ...notDeleted, status: SERVICE_STATUS.PENDING };
  pendingFilter.serviceDateTime = period === 'all' ? { $gte: from } : { $gte: from, $lte: to };

  const [doneCount, pendingCount] = await Promise.all([
    Service.countDocuments({ ...notDeleted, status: SERVICE_STATUS.DONE, serviceDateTime: { $gte: from, $lte: to } }),
    Service.countDocuments(pendingFilter),
  ]);

  return {
    ...summary,
    biggestExpense: maxExpense ? { amount: maxExpense.amount, category: maxExpense.category, date: maxExpense.date } : null,
    smallestExpense: minExpense ? { amount: minExpense.amount, category: minExpense.category, date: minExpense.date } : null,
    topService: topService ? { clientName: topService.clientName, price: topService.price, date: topService.serviceDateTime } : null,
    doneCount,
    pendingCount,
  };
}

export async function getMonthlyChart(year = new Date().getFullYear()) {
  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31, 23, 59, 59, 999);
  const rows = await Transaction.aggregate([
    { $match: { ...notDeleted, date: { $gte: from, $lte: to } } },
    { $group: { _id: { month: { $month: '$date' }, type: '$type' }, total: { $sum: '$amount' } } },
  ]);

  const income = Array(12).fill(0);
  const expense = Array(12).fill(0);
  for (const row of rows) {
    const index = row._id.month - 1;
    if (row._id.type === TX_TYPES.INCOME) income[index] += row.total;
    if (row._id.type === TX_TYPES.EXPENSE) expense[index] += row.total;
  }
  return { year, income, expense };
}

export async function listTransactions({
  period = 'all',
  type = null,
  category = null,
  dateFrom = null,
  dateTo = null,
  page = null,
  limit = 200,
} = {}) {
  const range = dateFrom || dateTo
    ? { from: parseOptionalDate(dateFrom) || new Date(0), to: parseOptionalDate(dateTo) || new Date() }
    : periodRange(period);
  if (dateTo) range.to.setHours(23, 59, 59, 999);
  const filter = { ...notDeleted, date: { $gte: range.from, $lte: range.to } };
  if (type && [TX_TYPES.INCOME, TX_TYPES.EXPENSE].includes(type)) filter.type = type;
  if (category) filter.category = normalizeCategory(type || TX_TYPES.EXPENSE, category);

  const pageNumber = Math.max(1, parseInt(page, 10) || 0);
  const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 0, 1), 500);
  if (!pageNumber) return Transaction.find(filter).sort({ date: -1 }).limit(limitNumber).lean();

  const [items, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ date: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .lean(),
    Transaction.countDocuments(filter),
  ]);
  return { items, page: pageNumber, limit: limitNumber, total };
}

function optionalPositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export async function createTransaction(data) {
  const type = data.type === TX_TYPES.INCOME ? TX_TYPES.INCOME : TX_TYPES.EXPENSE;
  // Summa ixtiyoriy: aytilmagan bo'lsa 0 (balansga ta'sir qilmaydi — getSummary $sum 0 qo'shadi).
  // Keyin tahrir/Mini App orqali kiritilganda balans avtomatik yangilanadi. Berilgan-u
  // noto'g'ri bo'lsa — avvalgidek xato.
  const amount = data.amount === undefined || data.amount === null || data.amount === ''
    ? 0
    : parsePositiveAmount(data.amount);
  const date = parseOptionalDate(data.date) || new Date();
  const category = normalizeCategory(
    type,
    data.category || (type === TX_TYPES.EXPENSE ? detectExpenseCategory(data.description || data.note || '') : null)
  );

  const tx = {
    type,
    amount, // DOIM so'mda (agent dollarni oldindan aylantiradi)
    category,
    description: data.description || data.note || '',
    date,
    originalAmount: data.originalAmount ?? null,
    originalCurrency: data.originalCurrency ?? null,
    exchangeRateUsed: data.exchangeRateUsed ?? null,
  };

  // Material sotuvi: nomni kanonik shaklga keltiramiz (dublikat kategoriyaning oldini olish),
  // kategoriyani kafolatlaymiz (yangi bo'lsa bot xabar beradi), miqdor/kilo narxi/ovozni
  // saqlaymiz va izohni toza quramiz ("Paxta · 30 kg").
  if (category === MATERIAL_CATEGORY) {
    const resolved = (await resolveMaterialName(data.materialName)) || 'Boshqa';
    const ensured = await ensureMaterialCategory(resolved, { source: 'bot', notify: true });
    const finalName = ensured.name || resolved;
    tx.materialName = finalName;
    tx.quantityKg = optionalPositiveNumber(data.quantityKg);
    tx.pricePerKg = optionalPositiveNumber(data.pricePerKg);
    tx.description = buildMaterialDescription(finalName, tx.quantityKg);
    if (data.voiceTelegramFileId) {
      tx.voice = {
        telegramFileId: data.voiceTelegramFileId,
        mimeType: data.voiceMimeType || null,
        duration: data.voiceDuration || null,
        messageId: data.voiceMessageId || null,
      };
    }
    if (data.sourceText) tx.sourceText = String(data.sourceText).slice(0, 1000);
  }
  if (category === USEFUL_ITEM_CATEGORY) {
    tx.itemName = data.itemName || data.description || 'Buyum';
    tx.usefulItemId = data.usefulItemId || null;
  }
  // Faqat O'Z xizmatiga bog'lashga ruxsat: boshqa egaga tegishli (yoki noto'g'ri) serviceId
  // e'tiborsiz qoldiriladi. Aks holda analitika $lookup'i orqali boshqa foydalanuvchi
  // mijozi ko'rinib qolishi mumkin edi. findOne plugin orqali scoped — faqat o'zinikini topadi.
  if (data.serviceId) {
    try {
      const owned = await Service.findOne({ _id: data.serviceId }).select('_id').lean();
      if (owned) tx.serviceId = data.serviceId;
    } catch { /* noto'g'ri serviceId — bog'lamaymiz */ }
  }
  return Transaction.create(tx);
}

// Tranzaksiyani soft-delete qiladi (bot post-save "Bekor qilish" — kod so'ralmaydi,
// chunki bu hozirgina kiritilgan, hali hech kim ko'rmagan yozuvni bekor qilish).
export async function softDeleteTransaction(id) {
  const transaction = await Transaction.findOneAndUpdate(
    { _id: id, ...notDeleted },
    { isDeleted: true, deletedAt: new Date() },
    { new: true }
  );
  if (!transaction) {
    const error = new Error('Tranzaksiya topilmadi');
    error.status = 404;
    throw error;
  }
  return transaction;
}

export async function updateTransaction(id, data) {
  const current = await Transaction.findOne({ _id: id, ...notDeleted });
  if (!current) {
    const error = new Error('Tranzaksiya topilmadi');
    error.status = 404;
    throw error;
  }

  const allowed = {};
  if (data.amount !== undefined) {
    const amount = parsePositiveAmount(data.amount);
    // Xizmatga bog'langan daromad summasi — yagona manba Service.price.
    // To'g'ridan-to'g'ri o'zgartirilsa desync bo'ladi, shuning uchun xizmatga yo'naltiramiz.
    if (current.serviceId && current.type === TX_TYPES.INCOME && amount !== current.amount) {
      throw badRequest("Bu daromad xizmatga bog'langan. Summani o'zgartirish uchun xizmat narxini tahrirlang.");
    }
    allowed.amount = amount;
  }
  if (data.description !== undefined || data.note !== undefined) allowed.description = data.description ?? data.note;
  if (data.date !== undefined) {
    const date = parseOptionalDate(data.date);
    if (!date) throw badRequest("Sana noto'g'ri");
    allowed.date = date;
  }
  if (data.category !== undefined) {
    allowed.category = normalizeCategory(current.type, data.category);
  }

  // Material sotuvi maydonlari (bot post-save tahriri uchun): nom kanonik shaklga
  // keltiriladi, izoh qayta quriladi (aniq description berilmagan bo'lsa).
  if (current.category === MATERIAL_CATEGORY) {
    let materialDirty = false;
    if (data.materialName !== undefined && data.materialName) {
      const resolved = (await resolveMaterialName(data.materialName)) || 'Boshqa';
      const ensured = await ensureMaterialCategory(resolved, { source: 'bot', notify: true });
      allowed.materialName = ensured.name || resolved;
      materialDirty = true;
    }
    if (data.quantityKg !== undefined) {
      allowed.quantityKg = optionalPositiveNumber(data.quantityKg);
      materialDirty = true;
    }
    if (data.pricePerKg !== undefined) {
      allowed.pricePerKg = optionalPositiveNumber(data.pricePerKg);
    }
    if (materialDirty && data.description === undefined && data.note === undefined) {
      allowed.description = buildMaterialDescription(
        allowed.materialName ?? current.materialName,
        allowed.quantityKg ?? current.quantityKg
      );
    }
  }

  const transaction = await Transaction.findOneAndUpdate({ _id: id, ...notDeleted }, allowed, { new: true });
  if (!transaction) {
    const error = new Error('Tranzaksiya topilmadi');
    error.status = 404;
    throw error;
  }
  return transaction;
}
