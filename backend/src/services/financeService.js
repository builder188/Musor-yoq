import Transaction, { TX_TYPES, EXPENSE_CATEGORIES } from '../models/Transaction.js';
import { periodRange } from '../utils/dates.js';

const notDeleted = { isDeleted: { $ne: true } };
const CATEGORY_KEYWORDS = {
  yoqilgi: ['benzin', 'dizel', 'gaz', 'yoqilgi', 'yakit'],
  tamirlash: ['tamir', 'shina', 'moy', 'ehtiyot', 'zapchast', 'remont'],
  'oziq-ovqat': ['ovqat', 'non', 'tushlik', 'choy', 'kafe'],
};

function detectExpenseCategory(text = '') {
  const value = String(text || '').toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => value.includes(keyword))) return category;
  }
  return 'boshqa_chiqim';
}

function normalizeCategory(type, category) {
  if (type === TX_TYPES.INCOME) return category === 'xizmat' ? 'xizmat' : 'boshqa_kirim';
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
  const range = dateFrom || dateTo ? { from: new Date(dateFrom || 0), to: new Date(dateTo || Date.now()) } : periodRange(period);
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

export async function createTransaction(data) {
  const type = data.type === TX_TYPES.INCOME ? TX_TYPES.INCOME : TX_TYPES.EXPENSE;
  const amount = Math.round(Number(data.amount) || 0);
  if (amount <= 0) throw new Error("Summa noto'g'ri");

  const tx = {
    type,
    amount,
    category: normalizeCategory(
      type,
      data.category || (type === TX_TYPES.EXPENSE ? detectExpenseCategory(data.description || data.note || '') : null)
    ),
    description: data.description || data.note || '',
    date: data.date ? new Date(data.date) : new Date(),
  };
  if (data.serviceId) tx.serviceId = data.serviceId;
  return Transaction.create(tx);
}

export async function updateTransaction(id, data) {
  const allowed = {};
  if (data.amount !== undefined) allowed.amount = Math.round(Number(data.amount));
  if (data.description !== undefined || data.note !== undefined) allowed.description = data.description ?? data.note;
  if (data.date !== undefined) allowed.date = new Date(data.date);
  if (data.category !== undefined) {
    const current = await Transaction.findOne({ _id: id, ...notDeleted }).select('type').lean();
    if (!current) return null;
    allowed.category = normalizeCategory(current.type, data.category);
  }
  return Transaction.findOneAndUpdate({ _id: id, ...notDeleted }, allowed, { new: true });
}
