import { InputFile } from 'grammy';
import express from 'express';
import ExcelJS from 'exceljs';
import Client from '../models/Client.js';
import Service from '../models/Service.js';
import Transaction, { TX_TYPES } from '../models/Transaction.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createReportDoc } from '../utils/pdf.js';
import { formatDate, formatDateTime } from '../utils/dates.js';
import { formatMoney } from '../utils/money.js';
import { getMonthlyIncomeBreakdown } from '../services/incomeSourceService.js';
import { getReportInsights } from '../services/reportInsightsService.js';

const router = express.Router();
const notDeleted = { isDeleted: { $ne: true } };
const REPORT_TYPES = new Set(['clients', 'services', 'finance', 'full']);
const REPORT_FORMATS = new Set(['pdf', 'excel']);
const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

// Oy nomlari — manba tahlili qatorlari uchun (bosh harf katta).
const MONTH_NAMES = {
  uz: ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'],
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
};
// "1-maydan ... gacha" / "с 1 мая ..." uchun qaratqich (genitive) shakli.
const MONTH_GENITIVE = {
  uz: UZ_MONTHS,
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
};

function monthLabel(year, month, language) {
  const names = MONTH_NAMES[language === 'ru' ? 'ru' : 'uz'];
  return `${names[month - 1] || ''} ${year}`;
}

// Hisobot sarlavhasi uchun tanlangan davrning aniq, tildagi ifodasi.
// uz: "1-maydan 30-maygacha bo'lgan hisobot (2026)" · ru: "Отчёт с 1 мая по 30 мая 2026".
function buildPeriodTitle(range, language) {
  const ru = language === 'ru';
  if (!range.from || !range.to) {
    return ru ? 'Полный отчёт (за всё время)' : 'Umumiy hisobot (butun davr)';
  }
  const from = new Date(range.from);
  const to = new Date(range.to);
  const g = MONTH_GENITIVE[ru ? 'ru' : 'uz'];
  const fd = from.getDate();
  const td = to.getDate();
  const fm = g[from.getMonth()];
  const tm = g[to.getMonth()];
  const fy = from.getFullYear();
  const ty = to.getFullYear();

  if (ru) {
    if (fy === ty) return `Отчёт с ${fd} ${fm} по ${td} ${tm} ${ty}`;
    return `Отчёт с ${fd} ${fm} ${fy} по ${td} ${tm} ${ty}`;
  }
  if (fy === ty) return `${fd}-${fm}dan ${td}-${tm}gacha bo'lgan hisobot (${fy})`;
  return `${fd}-${fm} ${fy}dan ${td}-${tm} ${ty}gacha bo'lgan hisobot`;
}

// Oylik manba qatorlarini tilga moslab (oy nomi) tayyorlaydi.
async function buildMonthlyIncomeRows(range, language) {
  const rows = await getMonthlyIncomeBreakdown({ from: range.from, to: range.to });
  return rows.map((row) => ({ ...row, label: monthLabel(row.year, row.month, language) }));
}

// Insights (qiziqarli ko'rsatkichlar) tarjimalari.
const INSIGHT_LABELS = {
  uz: {
    title: 'Qiziqarli ko\'rsatkichlar',
    topMaterial: 'Eng ko\'p daromadli material',
    topItem: 'Eng ko\'p daromadli buyum',
    topClient: 'Eng ko\'p to\'lagan mijoz',
    busiestMonth: 'Eng ko\'p buyurtmali oy',
    bestMonth: 'Eng daromadli oy',
    avgService: 'O\'rtacha xizmat narxi',
    activeDay: 'Eng faol kun',
    orders: 'ta buyurtma',
    metric: 'Ko\'rsatkich',
    value: 'Qiymat',
  },
  ru: {
    title: 'Полезные показатели',
    topMaterial: 'Самый доходный материал',
    topItem: 'Самый доходный предмет',
    topClient: 'Клиент с наибольшей оплатой',
    busiestMonth: 'Месяц с наибольшим числом заказов',
    bestMonth: 'Самый доходный месяц',
    avgService: 'Средняя цена услуги',
    activeDay: 'Самый активный день',
    orders: 'заказов',
    metric: 'Показатель',
    value: 'Значение',
  },
};

// Hafta kunlari ($dayOfWeek: 1=yakshanba .. 7=shanba -> index dow-1).
const WEEKDAYS = {
  uz: ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'],
  ru: ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'],
};

// Xom insightlarni tildagi ko'rsatish qatorlariga aylantiradi: { emoji, label, value }.
// PDF emoji'siz (label+value) ishlatadi, Excel emoji bilan — bir manba, ikkala format.
function formatInsights(insights, language) {
  if (!insights) return [];
  const lang = language === 'ru' ? 'ru' : 'uz';
  const L = INSIGHT_LABELS[lang];
  const wd = WEEKDAYS[lang];
  const lines = [];
  const add = (emoji, label, value) => lines.push({ emoji, label, value });

  if (insights.topMaterial) add('💎', L.topMaterial, `${insights.topMaterial.name} — ${formatMoney(insights.topMaterial.total)}`);
  if (insights.topItem) add('📦', L.topItem, `${insights.topItem.name} — ${formatMoney(insights.topItem.total)}`);
  if (insights.topClient) add('👤', L.topClient, `${insights.topClient.name} — ${formatMoney(insights.topClient.total)}`);
  if (insights.busiestMonth) {
    add('📅', L.busiestMonth, `${monthLabel(insights.busiestMonth.year, insights.busiestMonth.month, language)} (${insights.busiestMonth.count} ${L.orders})`);
  }
  if (insights.bestIncomeMonth) {
    add('📈', L.bestMonth, `${monthLabel(insights.bestIncomeMonth.year, insights.bestIncomeMonth.month, language)} — ${formatMoney(insights.bestIncomeMonth.total)}`);
  }
  if (insights.avgServicePrice > 0) add('💰', L.avgService, formatMoney(insights.avgServicePrice));
  if (insights.mostActiveWeekday) {
    add('📆', L.activeDay, `${wd[insights.mostActiveWeekday.dow - 1] || ''} (${insights.mostActiveWeekday.count} ${L.orders})`);
  }
  return lines;
}

// Insights Excel varag'i qatorlari: [Ko'rsatkich | Qiymat], emoji bilan.
function makeInsightsRows(lines, language) {
  const L = INSIGHT_LABELS[language === 'ru' ? 'ru' : 'uz'];
  return [[L.metric, L.value], ...lines.map((line) => [`${line.emoji} ${line.label}`, line.value])];
}

// Hisobot uchun insightlarni hisoblab, tilga moslab qaytaradi.
async function buildInsightLines(range, language) {
  const insights = await getReportInsights({ from: range.from, to: range.to });
  return formatInsights(insights, language);
}

let reportBot = null;

// Excel hisobot tarjimalari (sheet nomlari va sarlavhalar). Raw enum/kategoriya
// qiymatlari (status, paymentMethod) data-eksport sifatida o'zgarmaydi.
const EXCEL_LABELS = {
  uz: {
    yes: 'ha',
    no: "yo'q",
    sheets: { clients: 'Mijozlar', services: 'Xizmatlar', transactions: 'Tranzaksiyalar', summary: 'Xulosa', sourceAnalysis: 'Manba tahlili', insights: 'Tahlil' },
    clientHeaders: ['ID', 'Ism', 'Telefon', 'Manzillar', 'Yaratilgan sana', 'Yangilangan sana'],
    serviceHeaders: ['ID', 'Client ID', 'Mijoz', 'Telefon', 'Manzil', 'Sana', 'Tarixiy', 'Narx', "To'langan", "To'lov usuli", "To'lov holati", 'Status', 'Bekor sababi', 'Bajarilgan sana', 'Izoh', 'Rasm fileIdlari', 'Income transaction ID', "O'chirilgan", "O'chirilgan sana", 'Yaratilgan sana', 'Yangilangan sana'],
    txHeaders: ['ID', 'Sana', 'Turi', 'Kategoriya', 'Summa', 'Izoh', 'Service ID', "O'chirilgan", "O'chirilgan sana", 'Yaratilgan sana'],
    summaryHeaders: ['Oy', 'Jami kirim', 'Jami chiqim', 'Balans', 'Xizmatlar soni', "To'langan", "To'lanmagan"],
    sourceHeaders: ['Oy', 'Bajarilgan xizmat', 'Jami kirim', 'Xizmat', 'Xizmat %', 'Material', 'Material %', 'Buyum', 'Buyum %', 'Boshqa', 'Boshqa %', 'Xizmat ulushi'],
  },
  ru: {
    yes: 'да',
    no: 'нет',
    sheets: { clients: 'Клиенты', services: 'Услуги', transactions: 'Транзакции', summary: 'Сводка', sourceAnalysis: 'Источники', insights: 'Анализ' },
    clientHeaders: ['ID', 'Имя', 'Телефон', 'Адреса', 'Дата создания', 'Дата обновления'],
    serviceHeaders: ['ID', 'Client ID', 'Клиент', 'Телефон', 'Адрес', 'Дата', 'Исторический', 'Цена', 'Оплачено', 'Способ оплаты', 'Статус оплаты', 'Статус', 'Причина отмены', 'Дата выполнения', 'Заметка', 'ID файлов фото', 'Income transaction ID', 'Удалён', 'Дата удаления', 'Дата создания', 'Дата обновления'],
    txHeaders: ['ID', 'Дата', 'Тип', 'Категория', 'Сумма', 'Заметка', 'Service ID', 'Удалён', 'Дата удаления', 'Дата создания'],
    summaryHeaders: ['Месяц', 'Всего доход', 'Всего расход', 'Баланс', 'Кол-во услуг', 'Оплачено', 'Не оплачено'],
    sourceHeaders: ['Месяц', 'Выполнено услуг', 'Всего доход', 'Услуга', 'Услуга %', 'Материал', 'Материал %', 'Предмет', 'Предмет %', 'Прочее', 'Прочее %', 'Доля услуг'],
  },
};

function excelLabels(language) {
  return EXCEL_LABELS[language === 'ru' ? 'ru' : 'uz'];
}

export function attachReportBot(botInstance) {
  reportBot = botInstance;
}

router.post(
  '/pdf',
  asyncHandler(async (req, res) => {
    const { doc, filename } = await buildPdfPayload(req.body);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);
    doc.end();
  })
);

router.post(
  '/excel',
  asyncHandler(async (req, res) => {
    const { buffer, filename } = await buildExcelPayload(req.body);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

router.post(
  '/send',
  asyncHandler(async (req, res) => {
    if (!reportBot) return res.status(503).json({ error: 'Bot hali ulanmagan' });

    const format = REPORT_FORMATS.has(req.body?.format) ? req.body.format : 'pdf';
    const reportType = normalizeReportType(req.body?.reportType);
    const range = resolveReportRange(req.body);
    const formatLabel = format === 'excel' ? 'Excel' : 'PDF';

    let buffer;
    let filename;
    if (format === 'excel') {
      ({ buffer, filename } = await buildExcelPayload(req.body));
    } else {
      buffer = await generateReportPdf({
        reportType,
        limit: normalizeLimit(req.body?.limit),
        range,
        language: req.body?.language || 'uz',
      });
      filename = reportFilename({ reportType, range, ext: 'pdf' });
    }

    await reportBot.api.sendDocument(
      req.telegramUser.id,
      new InputFile(buffer, filename),
      { caption: `${formatLabel} hisobot: ${reportLabel(reportType)} (${range.label})` }
    );
    // Bot shaxsiyati: fayldan keyin samimiy "oka" ohangidagi xabar.
    await reportBot.api
      .sendMessage(
        req.telegramUser.id,
        `Mana oka, ${range.label} uchun ${formatLabel} tayyor bo'ldi. Pastga qarab qo'ying 👇`
      )
      .catch(() => {});

    return res.json({ ok: true, format, filename, period: range.label });
  })
);

// PDF ni buffer ko'rinishida yaratadi (bot orqali yuborish uchun).
export async function generateReportPdf({ reportType = 'full', limit = 200, range, language = 'uz' }) {
  const data = await buildReportData({ reportType, limit, range, language });
  const doc = createReportDoc(data);
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export { resolveReportRange };
// Hisobot manba-tahlili yordamchilari — kelajakdagi hisobot funksiyalari ham ishlatishi uchun.
export { buildPeriodTitle, monthLabel, buildMonthlyIncomeRows, makeSourceAnalysisRows, unicodeBar };
export { formatInsights, makeInsightsRows, buildInsightLines };

async function buildPdfPayload(body = {}) {
  const reportType = normalizeReportType(body.reportType);
  const limit = normalizeLimit(body.limit);
  const range = resolveReportRange(body);
  const data = await buildReportData({ reportType, limit, range, language: body.language || 'uz' });
  return {
    doc: createReportDoc(data),
    filename: reportFilename({ reportType, range, ext: 'pdf' }),
  };
}

async function buildExcelPayload(body = {}) {
  const L = excelLabels(body.language);
  const range = resolveReportRange(body);
  const dateFilter = range.from || range.to ? { $gte: range.from, $lte: range.to } : null;
  const serviceFilter = { ...notDeleted };
  const txFilter = { ...notDeleted };
  if (dateFilter) {
    serviceFilter.serviceDateTime = dateFilter;
    txFilter.date = dateFilter;
  }

  const [clients, services, transactions] = await Promise.all([
    Client.find(notDeleted).sort({ createdAt: -1 }).lean(),
    Service.find(serviceFilter).sort({ serviceDateTime: -1 }).lean(),
    Transaction.find(txFilter).sort({ date: -1 }).lean(),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Musir Yo'q";
  workbook.created = new Date();
  workbook.modified = new Date();

  addSheet(workbook, L.sheets.clients, [
    L.clientHeaders,
    ...clients.map((client) => [
      String(client._id),
      client.name || '',
      client.phone || '',
      (client.locations || []).map((loc) => loc.address).filter(Boolean).join('; '),
      formatDateTime(client.createdAt),
      formatDateTime(client.updatedAt),
    ]),
  ]);

  addSheet(workbook, L.sheets.services, [
    L.serviceHeaders,
    ...services.map((service) => [
      String(service._id),
      String(service.clientId || ''),
      service.clientName || '',
      service.clientPhone || '',
      service.location?.address || '',
      formatDateTime(service.serviceDateTime),
      service.isHistorical ? L.yes : L.no,
      service.price || 0,
      service.paidAmount || 0,
      service.paymentMethod || '',
      service.paymentStatus || '',
      service.status || '',
      service.cancellationReason || '',
      formatDateTime(service.completedAt),
      service.notes || '',
      (service.images || []).map((image) => image.telegramFileId).filter(Boolean).join('; '),
      String(service.incomeTransactionId || ''),
      service.isDeleted ? L.yes : L.no,
      formatDateTime(service.deletedAt),
      formatDateTime(service.createdAt),
      formatDateTime(service.updatedAt),
    ]),
  ]);

  addSheet(workbook, L.sheets.transactions, [
    L.txHeaders,
    ...transactions.map((tx) => [
      String(tx._id),
      formatDateTime(tx.date),
      tx.type || '',
      tx.category || '',
      tx.amount || 0,
      tx.description || tx.note || '',
      String(tx.serviceId || ''),
      tx.isDeleted ? L.yes : L.no,
      formatDateTime(tx.deletedAt),
      formatDateTime(tx.createdAt),
    ]),
  ]);

  addSheet(workbook, L.sheets.summary, makeMonthlyBreakdownRows(transactions, services, L.summaryHeaders));

  // Daromad manbasi tahlili (oylik): son + foiz + ixcham ulush diagrammasi (unicode bar).
  const sourceRows = await buildMonthlyIncomeRows(range, body.language);
  addSheet(workbook, L.sheets.sourceAnalysis, makeSourceAnalysisRows(sourceRows, L.sourceHeaders));

  // Qiziqarli ko'rsatkichlar (insights) varag'i.
  const insightLines = await buildInsightLines(range, body.language);
  if (insightLines.length) addSheet(workbook, L.sheets.insights, makeInsightsRows(insightLines, body.language));

  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    filename: 'musir_yoq_eksport.xlsx',
  };
}

// Manba tahlili varag'i qatorlari: oy bo'yicha son + summa + foiz + "Xizmat ulushi" bari.
function makeSourceAnalysisRows(rows, headers) {
  const sourceTotal = (row, key) => row.sources.find((source) => source.key === key)?.total || 0;
  const sourcePct = (row, key) => `${Math.round(row.sources.find((source) => source.key === key)?.pct || 0)}%`;
  return [
    headers,
    ...rows.map((row) => [
      row.label,
      row.servicesCount,
      row.totalIncome,
      sourceTotal(row, 'service'),
      sourcePct(row, 'service'),
      sourceTotal(row, 'material'),
      sourcePct(row, 'material'),
      sourceTotal(row, 'item'),
      sourcePct(row, 'item'),
      row.otherTotal,
      `${Math.round(row.otherPct || 0)}%`,
      unicodeBar(row.servicePct),
    ]),
  ];
}

// Foizdan ixcham matn-diagramma: "██████░░░░ 60%" (Excel'da chart yo'q — bu engil muqobil).
function unicodeBar(pct, length = 10) {
  const filled = Math.max(0, Math.min(length, Math.round((Number(pct) || 0) / 100 * length)));
  return `${'█'.repeat(filled)}${'░'.repeat(length - filled)} ${Math.round(Number(pct) || 0)}%`;
}

function normalizeReportType(reportType) {
  return REPORT_TYPES.has(reportType) ? reportType : 'full';
}

function normalizeLimit(limit) {
  return Math.min(Math.max(Number(limit) || 200, 1), 1000);
}

function reportFilename({ reportType, range, ext }) {
  const suffix = range.fileLabel || reportType;
  return `hisobot-${reportType}-${suffix}.${ext}`;
}

function reportLabel(type) {
  if (type === 'clients') return 'Mijozlar';
  if (type === 'services') return 'Xizmatlar';
  if (type === 'finance') return 'Moliya';
  return "To'liq";
}

function addSheet(workbook, name, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRows(rows);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F8F4E' } };
  header.alignment = { vertical: 'middle' };

  sheet.columns.forEach((column) => {
    let width = 12;
    column.eachCell({ includeEmpty: true }, (cell) => {
      width = Math.max(width, String(cell.value ?? '').length + 2);
    });
    column.width = Math.min(width, 42);
  });

  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
      };
      if (rowNumber > 1 && rowNumber % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      }
    });
  });
}

function makeMonthlyBreakdownRows(transactions, services, headers = ['Oy', 'Jami kirim', 'Jami chiqim', 'Balans', 'Xizmatlar soni', "To'langan", "To'lanmagan"]) {
  const byMonth = new Map();
  const ensure = (key) => {
    if (!byMonth.has(key)) {
      byMonth.set(key, { income: 0, expense: 0, services: 0, paid: 0, unpaid: 0 });
    }
    return byMonth.get(key);
  };

  for (const tx of transactions) {
    const key = monthKeyFromDate(tx.date);
    const row = ensure(key);
    if (tx.type === TX_TYPES.EXPENSE) row.expense += Number(tx.amount || 0);
    else row.income += Number(tx.amount || 0);
  }

  for (const service of services) {
    const key = monthKeyFromDate(service.serviceDateTime);
    const row = ensure(key);
    row.services += 1;
    row.paid += Number(service.paidAmount || 0);
    row.unpaid += Math.max(0, Number(service.price || 0) - Number(service.paidAmount || 0));
  }

  return [
    headers,
    ...Array.from(byMonth.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, row]) => [
        month,
        row.income,
        row.expense,
        row.income - row.expense,
        row.services,
        row.paid,
        row.unpaid,
      ]),
  ];
}

function monthKeyFromDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function buildReportData({ reportType, limit, range, language }) {
  const includesClients = reportType === 'clients' || reportType === 'full';
  const includesServices = reportType === 'services' || reportType === 'full';
  const includesFinance = reportType === 'finance' || reportType === 'full';
  const dateFilter = range.from || range.to ? { $gte: range.from, $lte: range.to } : null;

  const serviceFilter = { ...notDeleted };
  const txFilter = { ...notDeleted };
  if (dateFilter) {
    serviceFilter.serviceDateTime = dateFilter;
    txFilter.date = dateFilter;
  }

  const [
    servicesForSummary,
    financeRows,
    clients,
    services,
    transactions,
    monthlyChart,
  ] = await Promise.all([
    Service.find(serviceFilter).select('price paidAmount').lean(),
    Transaction.aggregate([
      { $match: txFilter },
      { $group: { _id: '$type', total: { $sum: '$amount' } } },
    ]),
    includesClients
      ? Client.find(notDeleted).sort({ updatedAt: -1 }).limit(limit).lean()
      : [],
    includesServices
      ? Service.find(serviceFilter).sort({ serviceDateTime: -1 }).limit(limit).lean()
      : [],
    includesFinance
      ? Transaction.find(txFilter).sort({ date: -1 }).limit(limit).lean()
      : [],
    buildLastSixMonthsChart(),
  ]);

  const unpaidTotal = servicesForSummary.reduce(
    (sum, service) => sum + Math.max(0, (service.price || 0) - (service.paidAmount || 0)),
    0
  );
  const totalIncome = financeRows.find((row) => row._id === TX_TYPES.INCOME)?.total || 0;
  const totalExpense = financeRows.find((row) => row._id === TX_TYPES.EXPENSE)?.total || 0;
  const summary = makeSummary(servicesForSummary, totalIncome, totalExpense, unpaidTotal);

  // Daromad manbasi tahlili + insights faqat moliya bo'lgan hisobotlarda (finance/full).
  const monthlyIncomeBySource = includesFinance ? await buildMonthlyIncomeRows(range, language) : [];
  const insights = includesFinance ? await buildInsightLines(range, language) : [];

  return {
    periodLabel: buildPeriodTitle(range, language),
    language,
    summary,
    clients: includesClients ? await mapClientRows(clients) : [],
    services: services.map(mapServiceRow),
    transactions: mergeFinanceRows(transactions).slice(0, limit),
    monthlyChart,
    monthlyIncomeBySource,
    insights,
  };
}

function makeSummary(services, totalIncome, totalExpense, unpaidTotal) {
  const totalServices = services.length;
  const totalPrice = services.reduce((sum, service) => sum + (service.price || 0), 0);
  return {
    totalServices,
    totalIncome,
    totalExpense,
    balance: totalIncome - totalExpense,
    averagePrice: totalServices ? Math.round(totalPrice / totalServices) : 0,
    unpaidTotal,
  };
}

async function mapClientRows(clients) {
  const rows = [];
  for (const client of clients) {
    const [lastService, paidRows] = await Promise.all([
      Service.findOne({ clientId: client._id, ...notDeleted })
        .sort({ serviceDateTime: -1 })
        .select('serviceDateTime')
        .lean(),
      Service.aggregate([
        { $match: { clientId: client._id, status: 'bajarildi', ...notDeleted } },
        { $group: { _id: '$clientId', total: { $sum: '$price' } } },
      ]),
    ]);

    rows.push([
      client.name || '',
      client.phone || '',
      lastService ? formatDate(lastService.serviceDateTime) : '',
      formatMoney(paidRows[0]?.total || 0),
      formatMoney((await clientUnpaidTotal(client._id)) || 0),
    ]);
  }
  return rows;
}

async function clientUnpaidTotal(clientId) {
  const rows = await Service.aggregate([
    { $match: { clientId, ...notDeleted } },
    {
      $group: {
        _id: '$clientId',
        total: {
          $sum: {
            $max: [{ $subtract: ['$price', { $ifNull: ['$paidAmount', 0] }] }, 0],
          },
        },
      },
    },
  ]);
  return rows[0]?.total || 0;
}

function mapServiceRow(service) {
  return [
    formatDateTime(service.serviceDateTime),
    service.clientName || '',
    service.location?.address || '',
    formatMoney(service.price || 0),
    service.status || '',
    service.paymentStatus || '',
  ];
}

function mergeFinanceRows(transactions) {
  const rows = [
    ...transactions.map((tx) => ({
      date: tx.date,
      row: [
        formatDateTime(tx.date),
        tx.type === TX_TYPES.EXPENSE ? 'Chiqim' : 'Kirim',
        tx.category === 'material' ? (tx.materialName || 'Material') : tx.category === 'buyum' ? (tx.itemName || 'Buyum') : (tx.category || ''),
        `${tx.type === TX_TYPES.EXPENSE ? '-' : '+'}${formatMoney(tx.amount || 0)}`,
        tx.description || tx.note || '',
      ],
    })),
  ];

  return rows
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((item) => item.row);
}

async function buildLastSixMonthsChart() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    months.push({ from, to, label: `${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` });
  }

  const rows = await Transaction.aggregate([
    {
      $match: {
        ...notDeleted,
        date: { $gte: months[0].from, $lte: months[months.length - 1].to },
      },
    },
    {
      $group: {
        _id: { year: { $year: '$date' }, month: { $month: '$date' }, type: '$type' },
        total: { $sum: '$amount' },
      },
    },
  ]);

  return months.map((month) => {
    const income = rows.find(
      (r) => r._id.year === month.from.getFullYear()
        && r._id.month === month.from.getMonth() + 1
        && r._id.type === TX_TYPES.INCOME
    )?.total || 0;
    const expense = rows.find(
      (r) => r._id.year === month.from.getFullYear()
        && r._id.month === month.from.getMonth() + 1
        && r._id.type === TX_TYPES.EXPENSE
    )?.total || 0;
    return { label: month.label, income, expense };
  });
}

function resolveReportRange(body = {}) {
  if (body.month && /^\d{4}-\d{2}$/.test(body.month)) {
    const [year, month] = body.month.split('-').map(Number);
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59, 999);
    return {
      from,
      to,
      label: `${UZ_MONTHS[month - 1] || body.month} ${year}`,
      fileLabel: body.month,
    };
  }

  if (body.dateRange?.start || body.dateRange?.end) {
    const from = body.dateRange.start ? new Date(body.dateRange.start) : new Date(0);
    const to = body.dateRange.end ? new Date(body.dateRange.end) : new Date();
    to.setHours(23, 59, 59, 999);
    return {
      from,
      to,
      label: `${formatDate(from)} - ${formatDate(to)}`,
      fileLabel: `${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}`,
    };
  }

  return {
    from: null,
    to: null,
    label: 'Hammasi',
    fileLabel: 'full',
  };
}

function makeExcelXml(sheets) {
  const worksheets = sheets
    .map((sheet) => `
      <Worksheet ss:Name="${xml(sheet.name).slice(0, 31)}">
        <Table>
          ${sheet.rows
            .map((row) => `
              <Row>
                ${row.map((cell) => `<Cell><Data ss:Type="${typeof cell === 'number' ? 'Number' : 'String'}">${xml(cell)}</Data></Cell>`).join('')}
              </Row>
            `)
            .join('')}
        </Table>
      </Worksheet>
    `)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 ${worksheets}
</Workbook>`;
}

function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default router;
