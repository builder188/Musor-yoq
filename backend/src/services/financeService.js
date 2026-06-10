// Moliyaviy mantiq: daromad/xarajat summalari, qarz to'lovlari.
// Daromad/xarajat — transactions kolleksiyasida; qarz to'lovlari — debt_payments da.
import Transaction, { TX_TYPES, EXPENSE_CATEGORIES } from '../models/Transaction.js';
import DebtPayment from '../models/DebtPayment.js';
import Client from '../models/Client.js';
import { periodRange } from '../utils/dates.js';

const notDeleted = { isDeleted: { $ne: true } };

// Davr bo'yicha umumiy hisobot: daromad, xarajat, sof balans.
// Eslatma: qarz to'lovi daromadga QO'SHILMAYDI — daromad xizmat bajarilganda
// to'liq narx bilan yozilgan (ikki marta sanamaslik uchun).
export async function getSummary(period = 'all') {
  const { from, to } = periodRange(period);
  const rows = await Transaction.aggregate([
    { $match: { ...notDeleted, date: { $gte: from, $lte: to } } },
    { $group: { _id: '$type', total: { $sum: '$amount' } } },
  ]);

  let income = 0;
  let expense = 0;
  for (const r of rows) {
    if (r._id === TX_TYPES.INCOME) income += r.total;
    else if (r._id === TX_TYPES.EXPENSE) expense += r.total;
  }
  return { period, income, expense, balance: income - expense, from, to };
}

// Oylik daromad/xarajat ustun diagrammasi uchun ma'lumot (joriy yil).
export async function getMonthlyChart(year = new Date().getFullYear()) {
  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31, 23, 59, 59, 999);

  const rows = await Transaction.aggregate([
    { $match: { ...notDeleted, date: { $gte: from, $lte: to } } },
    { $group: { _id: { month: { $month: '$date' }, type: '$type' }, total: { $sum: '$amount' } } },
  ]);

  const income = Array(12).fill(0);
  const expense = Array(12).fill(0);
  for (const r of rows) {
    const m = r._id.month - 1;
    if (r._id.type === TX_TYPES.INCOME) income[m] += r.total;
    else if (r._id.type === TX_TYPES.EXPENSE) expense[m] += r.total;
  }
  return { year, income, expense };
}

// Tranzaksiyalar ro'yxati: daromad + xarajat + qarz to'lovlari (aralash, sana bo'yicha).
// Qarz to'lovlariga type='debt_payment' belgisi qo'yiladi — frontend shu orqali ajratadi.
export async function listTransactions({ period = 'all', type = null, limit = 200 } = {}) {
  const { from, to } = periodRange(period);
  const dateFilter = { date: { $gte: from, $lte: to } };

  const txFilter = { ...notDeleted, ...dateFilter };
  if (type && type !== 'debt_payment') txFilter.type = type;

  const txs =
    type === 'debt_payment'
      ? []
      : await Transaction.find(txFilter).sort({ date: -1 }).limit(limit).lean();

  const payments =
    type && type !== 'debt_payment'
      ? []
      : await DebtPayment.find({ ...notDeleted, ...dateFilter }).sort({ date: -1 }).limit(limit).lean();

  const merged = [
    ...txs,
    ...payments.map((p) => ({ ...p, type: 'debt_payment' })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return merged.slice(0, limit);
}

export async function createTransaction(data) {
  const tx = {
    type: data.type,
    amount: Math.round(Number(data.amount) || 0),
    note: data.note || '',
    date: data.date ? new Date(data.date) : new Date(),
    paymentMethod: data.paymentMethod || null,
  };
  if (data.type === TX_TYPES.EXPENSE) {
    tx.category = EXPENSE_CATEGORIES.includes(data.category) ? data.category : 'boshqa';
  }
  if (data.clientId) tx.clientId = data.clientId;
  if (data.serviceId) tx.serviceId = data.serviceId;
  return Transaction.create(tx);
}

// Tranzaksiya yoki qarz to'lovini tahrirlash (ikkala kolleksiyada qidiradi).
export async function updateTransaction(id, data) {
  const allowed = {};
  if (data.amount !== undefined) allowed.amount = Math.round(Number(data.amount));
  if (data.note !== undefined) allowed.note = data.note;
  if (data.category !== undefined) allowed.category = data.category;
  if (data.date !== undefined) allowed.date = new Date(data.date);
  if (data.paymentMethod !== undefined) allowed.paymentMethod = data.paymentMethod;

  const tx = await Transaction.findOneAndUpdate({ _id: id, ...notDeleted }, allowed, { new: true });
  if (tx) return tx;

  // Qarz to'lovi bo'lishi mumkin (kategoriya/to'lov turi unga tegishli emas).
  delete allowed.category;
  delete allowed.paymentMethod;
  return DebtPayment.findOneAndUpdate({ _id: id, ...notDeleted }, allowed, { new: true });
}

// Qarzi bor mijozlar.
export async function listDebts() {
  const clients = await Client.find({ totalDebt: { $gt: 0 }, ...notDeleted })
    .sort({ totalDebt: -1 })
    .lean();
  const total = clients.reduce((s, c) => s + (c.totalDebt || 0), 0);
  return { clients, total };
}

// Mijozdan qarz to'lovi qabul qilish (to'liq yoki qisman).
export async function recordPayment({ clientId, amount, note = '', serviceId = null }) {
  const client = await Client.findOne({ _id: clientId, ...notDeleted });
  if (!client) throw new Error('Mijoz topilmadi');

  const pay = Math.round(Number(amount) || 0);
  if (pay <= 0) throw new Error('To\'lov summasi noto\'g\'ri');

  // Qarzni kamaytiramiz (manfiyga tushmasin).
  client.totalDebt = Math.max(0, (client.totalDebt || 0) - pay);
  await client.save();

  const payment = await DebtPayment.create({
    clientId,
    clientName: client.name,
    serviceId,
    amount: pay,
    note: note || `Qarz to'lovi: ${client.name}`,
    date: new Date(),
  });

  return { client, payment };
}
