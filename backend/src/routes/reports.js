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

const router = express.Router();
const notDeleted = { isDeleted: { $ne: true } };
const REPORT_TYPES = new Set(['clients', 'services', 'finance', 'full']);
const REPORT_FORMATS = new Set(['pdf', 'excel']);
const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
let reportBot = null;

// Excel hisobot tarjimalari (sheet nomlari va sarlavhalar). Raw enum/kategoriya
// qiymatlari (status, paymentMethod) data-eksport sifatida o'zgarmaydi.
const EXCEL_LABELS = {
  uz: {
    yes: 'ha',
    no: "yo'q",
    sheets: { clients: 'Mijozlar', services: 'Xizmatlar', transactions: 'Tranzaksiyalar', summary: 'Xulosa' },
    clientHeaders: ['ID', 'Ism', 'Telefon', 'Manzillar', 'Yaratilgan sana', 'Yangilangan sana'],
    serviceHeaders: ['ID', 'Client ID', 'Mijoz', 'Telefon', 'Manzil', 'Sana', 'Tarixiy', 'Narx', "To'langan", "To'lov usuli", "To'lov holati", 'Status', 'Bekor sababi', 'Bajarilgan sana', 'Izoh', 'Rasm fileIdlari', 'Income transaction ID', "O'chirilgan", "O'chirilgan sana", 'Yaratilgan sana', 'Yangilangan sana'],
    txHeaders: ['ID', 'Sana', 'Turi', 'Kategoriya', 'Summa', 'Izoh', 'Service ID', "O'chirilgan", "O'chirilgan sana", 'Yaratilgan sana'],
    summaryHeaders: ['Oy', 'Jami kirim', 'Jami chiqim', 'Balans', 'Xizmatlar soni', "To'langan", "To'lanmagan"],
  },
  ru: {
    yes: 'да',
    no: 'нет',
    sheets: { clients: 'Клиенты', services: 'Услуги', transactions: 'Транзакции', summary: 'Сводка' },
    clientHeaders: ['ID', 'Имя', 'Телефон', 'Адреса', 'Дата создания', 'Дата обновления'],
    serviceHeaders: ['ID', 'Client ID', 'Клиент', 'Телефон', 'Адрес', 'Дата', 'Исторический', 'Цена', 'Оплачено', 'Способ оплаты', 'Статус оплаты', 'Статус', 'Причина отмены', 'Дата выполнения', 'Заметка', 'ID файлов фото', 'Income transaction ID', 'Удалён', 'Дата удаления', 'Дата создания', 'Дата обновления'],
    txHeaders: ['ID', 'Дата', 'Тип', 'Категория', 'Сумма', 'Заметка', 'Service ID', 'Удалён', 'Дата удаления', 'Дата создания'],
    summaryHeaders: ['Месяц', 'Всего доход', 'Всего расход', 'Баланс', 'Кол-во услуг', 'Оплачено', 'Не оплачено'],
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

  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    filename: 'musir_yoq_eksport.xlsx',
  };
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

  return {
    periodLabel: range.label,
    language,
    summary,
    clients: includesClients ? await mapClientRows(clients) : [],
    services: services.map(mapServiceRow),
    transactions: mergeFinanceRows(transactions).slice(0, limit),
    monthlyChart,
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
        tx.category === 'material' ? (tx.materialName || 'Material') : (tx.category || ''),
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
