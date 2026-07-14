// Hisobot uchun "aqlli" biznes ko'rsatkichlari (insights) — foydalanuvchi so'ramagan,
// lekin biznesni tushunishga yordam beradigan qiymatli ma'lumotlar (tanlangan davr ichida).
//
// Bu yerda FAQAT xom ma'lumot (raqam/nom/yil-oy/hafta-kuni) hisoblanadi — til/format
// render qatlamida (routes/reports.js) qo'llanadi, shunda bir mantiq PDF va Excel'ga xizmat qiladi.
import Transaction, { TX_TYPES } from '../models/Transaction.js';
import Service from '../models/Service.js';
import { MATERIAL_CATEGORY, USEFUL_ITEM_CATEGORY } from '../models/Transaction.js';

const notDeleted = { isDeleted: { $ne: true } };

function dateRange(from, to) {
  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return range;
}

// Bitta kategoriya bo'yicha eng ko'p pul keltirgan tur (materialName/itemName) — nom + summa.
async function topByField(incomeMatch, category, field) {
  const rows = await Transaction.aggregate([
    { $match: { ...incomeMatch, category } },
    { $group: { _id: `$${field}`, total: { $sum: '$amount' } } },
    { $sort: { total: -1 } },
    { $limit: 1 },
  ]);
  const row = rows[0];
  return row && row._id ? { name: row._id, total: row.total } : null;
}

// Eng ko'p pul to'lagan mijoz: xizmat daromadini mijoz bo'yicha yig'amiz (serviceId -> service).
async function topClient(incomeMatch) {
  const rows = await Transaction.aggregate([
    { $match: { ...incomeMatch, category: 'xizmat', serviceId: { $ne: null } } },
    { $lookup: { from: 'services', localField: 'serviceId', foreignField: '_id', as: 'svc' } },
    { $unwind: '$svc' },
    { $group: { _id: '$svc.clientId', total: { $sum: '$amount' }, name: { $first: '$svc.clientName' }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
    { $limit: 1 },
  ]);
  const row = rows[0];
  return row ? { name: row.name || 'Mijoz', total: row.total, count: row.count } : null;
}

// Eng ko'p daromadli oy (barcha kirim bo'yicha).
async function bestIncomeMonth(incomeMatch) {
  const rows = await Transaction.aggregate([
    { $match: incomeMatch },
    { $group: { _id: { y: { $year: '$date' }, m: { $month: '$date' } }, total: { $sum: '$amount' } } },
    { $sort: { total: -1 } },
    { $limit: 1 },
  ]);
  const row = rows[0];
  return row ? { year: row._id.y, month: row._id.m, total: row.total } : null;
}

// Xizmat (xizmat kirimi) statistikasi: jami + soni -> o'rtacha xizmat narxi.
async function serviceIncomeStats(incomeMatch) {
  const rows = await Transaction.aggregate([
    { $match: { ...incomeMatch, category: 'xizmat' } },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  const row = rows[0];
  const count = row?.count || 0;
  const total = row?.total || 0;
  return { total, count, avg: count > 0 ? Math.round(total / count) : 0 };
}

// Sana null/yo'q bo'lgan xizmatlarda $year/$dayOfWeek XATO beradi ("can't convert null
// to Date") — sanasi kiritilmagan xizmat mavjud bo'lsa "hammasi" davri hisoboti butunlay
// yiqilardi. Shu ifoda sana bor-yo'qligini tekshiradi; yo'q bo'lsa yozuv alohida
// "Sana kiritilmagan" guruhiga tushadi (statistikadan yashirilmaydi).
const HAS_SERVICE_DATE = { $eq: [{ $type: '$serviceDateTime' }, 'date'] };

// Eng ko'p buyurtma (xizmat) tushgan oy — Service.serviceDateTime bo'yicha.
// Sanasiz yozuvlar { year:null, month:null } guruhida sanaladi.
async function busiestOrdersMonth(serviceMatch) {
  const rows = await Service.aggregate([
    { $match: serviceMatch },
    {
      $group: {
        _id: {
          y: { $cond: [HAS_SERVICE_DATE, { $year: '$serviceDateTime' }, null] },
          m: { $cond: [HAS_SERVICE_DATE, { $month: '$serviceDateTime' }, null] },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 1 },
  ]);
  const row = rows[0];
  return row ? { year: row._id.y, month: row._id.m, count: row.count } : null;
}

// Eng faol hafta kuni — Service.serviceDateTime bo'yicha ($dayOfWeek: 1=yakshanba .. 7=shanba).
// Sanasiz yozuvlar dow=null guruhida sanaladi ("Sana kiritilmagan" bo'lib ko'rinadi).
async function mostActiveWeekday(serviceMatch) {
  const rows = await Service.aggregate([
    { $match: serviceMatch },
    { $group: { _id: { $cond: [HAS_SERVICE_DATE, { $dayOfWeek: '$serviceDateTime' }, null] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 },
  ]);
  const row = rows[0];
  return row ? { dow: row._id, count: row.count } : null;
}

// Davr ichidagi barcha insightlarni parallel hisoblaydi. Ma'lumot bo'lmasa — null maydonlar.
export async function getReportInsights({ from = null, to = null } = {}) {
  const incomeMatch = { ...notDeleted, type: TX_TYPES.INCOME };
  const serviceMatch = { ...notDeleted };
  if (from || to) {
    incomeMatch.date = dateRange(from, to);
    serviceMatch.serviceDateTime = dateRange(from, to);
  }

  const [topMaterial, topItem, client, bestMonth, svcStats, busiestMonth, weekday] = await Promise.all([
    topByField(incomeMatch, MATERIAL_CATEGORY, 'materialName'),
    topByField(incomeMatch, USEFUL_ITEM_CATEGORY, 'itemName'),
    topClient(incomeMatch),
    bestIncomeMonth(incomeMatch),
    serviceIncomeStats(incomeMatch),
    busiestOrdersMonth(serviceMatch),
    mostActiveWeekday(serviceMatch),
  ]);

  return {
    topMaterial,
    topItem,
    topClient: client,
    busiestMonth,
    bestIncomeMonth: bestMonth,
    avgServicePrice: svcStats.avg,
    serviceCount: svcStats.count,
    mostActiveWeekday: weekday,
  };
}

export default { getReportInsights };
