import PDFDocument from 'pdfkit';
import { formatMoney } from './money.js';
import { formatDateTime } from './dates.js';

const COLORS = {
  income: '#2E7D32',
  expense: '#C62828',
  text: '#212121',
  muted: '#616161',
  border: '#E0E0E0',
  rowAlt: '#F5F5F5',
};

// Daromad manbasi ranglari (oylik tahlil diagrammasi va legendasi).
const SOURCE_COLORS = {
  service: '#2E7D32', // xizmat — yashil
  material: '#1565C0', // material — ko'k
  item: '#EF6C00', // buyum — to'q sariq
  other: '#9E9E9E', // boshqa — kulrang
};

const LABELS = {
  uz: {
    title: "Musir Yo'q - Hisobot",
    created: 'Yaratildi',
    period: 'Davr',
    all: 'Hammasi',
    page: 'Sahifa',
    summary: 'Umumiy',
    totalServices: 'Jami xizmatlar',
    totalIncome: 'Jami kirim',
    totalExpense: 'Jami chiqim',
    balance: 'Balans',
    clients: 'Mijozlar',
    partners: 'Hamkor mijozlar (shartnoma)',
    services: 'Xizmatlar',
    finance: 'Moliya',
    lastSixMonths: 'Oxirgi 6 oy',
    clientHeaders: ['Ism', 'Tel', "So'nggi xizmat", "Jami to'lagan", "To'lanmagan"],
    partnerHeaders: ['Nomi', 'Tashriflar', 'Jami daromad', 'Standart narx', 'Standart manzil'],
    serviceHeaders: ['Sana', 'Mijoz', 'Manzil', 'Narx', 'Status', "To'lov"],
    financeHeaders: ['Sana', 'Turi', 'Toifa', 'Summa', 'Izoh'],
    income: 'Kirim',
    expense: 'Chiqim',
    sourceAnalysis: 'Daromad manbasi tahlili (oylik)',
    srcService: 'Xizmat',
    srcMaterial: 'Material',
    srcItem: 'Buyum',
    srcOther: 'Boshqa',
    srcSales: 'Material/Buyum sotuvi',
    monthServices: 'xizmat',
    monthTotal: 'Jami',
    noIncome: 'Bu davrda kirim yo\'q',
    insights: 'Qiziqarli ko\'rsatkichlar',
    fines: 'Moshina jarimalari (oylik)',
    fineHeaders: ['Oy', 'Jarimaga tushish', "To'lovlar soni", "To'langan jami"],
  },
  ru: {
    title: "Musir Yo'q - Otchet",
    created: 'Sozdano',
    period: 'Period',
    all: 'Vse',
    page: 'Stranitsa',
    summary: 'Itogo',
    totalServices: 'Uslugi',
    totalIncome: 'Dohod',
    totalExpense: 'Rashod',
    balance: 'Balans',
    clients: 'Klienty',
    partners: 'Klienty-partnyory (dogovor)',
    services: 'Uslugi',
    finance: 'Finansy',
    lastSixMonths: 'Poslednie 6 mesyatsev',
    clientHeaders: ['Imya', 'Tel', 'Posl. usluga', 'Oplacheno', 'Ne oplacheno'],
    partnerHeaders: ['Nazvanie', 'Vizity', 'Dohod', 'Stand. cena', 'Stand. adres'],
    serviceHeaders: ['Data', 'Klient', 'Adres', 'Cena', 'Status', 'Oplata'],
    financeHeaders: ['Data', 'Tip', 'Kategoriya', 'Summa', 'Zametka'],
    income: 'Dohod',
    expense: 'Rashod',
    sourceAnalysis: 'Analiz istochnikov dohoda (po mesyatsam)',
    srcService: 'Usluga',
    srcMaterial: 'Material',
    srcItem: 'Predmet',
    srcOther: 'Prochee',
    srcSales: 'Prodazha materiala/predmeta',
    monthServices: 'uslug',
    monthTotal: 'Vsego',
    noIncome: 'Net dohoda za etot period',
    insights: 'Poleznye pokazateli',
    fines: 'Shtrafy za mashinu (po mesyatsam)',
    fineHeaders: ['Mesyats', 'Shtrafov polucheno', 'Oplat', 'Oplacheno vsego'],
  },
};

export function createReportDoc(data) {
  const labels = LABELS[data.language] || LABELS.uz;
  const doc = new PDFDocument({
    margins: { top: 96, right: 40, bottom: 66, left: 40 },
    size: 'A4',
    bufferPages: true,
    info: { Title: labels.title },
  });

  doc.font('Helvetica');
  drawSummary(doc, data.summary, labels);

  // Daromad manbasi tahlili — yangi bo'lim (grafik + son + foiz). Summarydan keyin,
  // jadvallardan oldin (eng muhim tahlil yuqorida bo'lsin).
  if (data.monthlyIncomeBySource?.length) {
    drawSourceAnalysis(doc, data.monthlyIncomeBySource, labels);
  }

  // Qiziqarli ko'rsatkichlar (insights) — biznesni tushunishga yordam beruvchi tahlil.
  if (data.insights?.length) {
    drawInsights(doc, data.insights, labels);
  }

  // Moshina jarimalari (oylik): necha marta tushilgan + jami qancha to'langan.
  if (data.monthlyFines?.length) {
    drawSectionTitle(doc, labels.fines);
    drawTable(doc, labels.fineHeaders, data.monthlyFines, [140, 110, 110, 130]);
  }

  if (data.clients?.length) {
    drawSectionTitle(doc, labels.clients);
    drawTable(doc, labels.clientHeaders, data.clients, [110, 90, 100, 95, 80]);
  }

  // Hamkor (shartnomaviy) mijozlar: davr ichidagi tashriflar soni va jami daromad —
  // alohida, aniq bo'lim (spec talabi).
  if (data.partners?.length) {
    drawSectionTitle(doc, labels.partners);
    drawTable(doc, labels.partnerHeaders, data.partners, [120, 65, 95, 95, 100]);
  }

  if (data.services?.length) {
    drawSectionTitle(doc, labels.services);
    drawTable(doc, labels.serviceHeaders, data.services, [80, 80, 125, 70, 70, 70]);
  }

  if (data.transactions?.length) {
    drawSectionTitle(doc, labels.finance);
    drawTable(doc, labels.financeHeaders, data.transactions, [85, 65, 85, 80, 180]);
  }

  if (data.monthlyChart?.length) {
    drawSectionTitle(doc, labels.lastSixMonths);
    drawMonthlyChart(doc, data.monthlyChart, labels);
  }

  drawHeadersAndFooters(doc, data.periodLabel, labels, data.language || 'uz');
  return doc;
}

function drawHeadersAndFooters(doc, periodLabel, labels, language = 'uz') {
  const range = doc.bufferedPageRange();
  const created = formatDateTime(new Date(), language);

  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.save();
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(14);
    doc.text(labels.title, 40, 28);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
    doc.text(`${labels.created}: ${created}`, 40, 48);
    doc.text(`${labels.period}: ${periodLabel || labels.all}`, 40, 63);
    doc.moveTo(40, 82).lineTo(555, 82).strokeColor(COLORS.border).stroke();
    doc.moveTo(40, 790).lineTo(555, 790).strokeColor(COLORS.border).stroke();
    doc.fontSize(8).fillColor(COLORS.muted);
    doc.text(`${labels.page} ${i + 1} / ${range.count} | ${created}`, 40, 800, {
      align: 'right',
      width: 515,
    });
    doc.restore();
  }
}

function drawSummary(doc, summary, labels) {
  drawSectionTitle(doc, labels.summary);
  drawTable(
    doc,
    [labels.totalServices, labels.totalIncome, labels.totalExpense, labels.balance],
    [[
      String(summary.totalServices || 0),
      formatMoney(summary.totalIncome || 0),
      formatMoney(summary.totalExpense || 0),
      formatMoney(summary.balance || 0),
    ]],
    [110, 130, 130, 125],
    { compact: true }
  );
}

function drawSectionTitle(doc, title) {
  ensureSpace(doc, 34);
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text).text(title);
  doc.moveDown(0.35);
}

function drawTable(doc, headers, rows, widths, options = {}) {
  const rowHeight = options.compact ? 26 : 30;
  const startX = doc.page.margins.left;

  ensureSpace(doc, rowHeight * 2);
  drawRow(doc, headers, widths, startX, doc.y, rowHeight, true);
  doc.y += rowHeight;

  rows.forEach((row, index) => {
    ensureSpace(doc, rowHeight);
    drawRow(doc, row, widths, startX, doc.y, rowHeight, false, index % 2 === 1);
    doc.y += rowHeight;
  });
  doc.moveDown(0.4);
}

function drawRow(doc, values, widths, x, y, height, header = false, alt = false) {
  if (header || alt) {
    doc.rect(x, y, widths.reduce((sum, w) => sum + w, 0), height)
      .fill(header ? COLORS.text : COLORS.rowAlt);
  }

  let left = x;
  values.forEach((value, i) => {
    doc.rect(left, y, widths[i], height).strokeColor(COLORS.border).stroke();
    const cellColor = header ? '#FFFFFF' : rowTextColor(values, i);
    doc.fillColor(header ? '#FFFFFF' : COLORS.text)
      .fillColor(cellColor)
      .font(header ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(header ? 8.5 : 8)
      .text(truncate(value, widths[i]), left + 5, y + 8, {
        width: widths[i] - 10,
        height: height - 10,
        ellipsis: true,
      });
    left += widths[i];
  });
}

function rowTextColor(values, columnIndex) {
  const text = String(values[columnIndex] ?? '').toLowerCase();
  const rowText = values.map((value) => String(value ?? '').toLowerCase()).join(' ');
  if (rowText.includes('bajarildi') || rowText.includes('tolangan')) return COLORS.income;
  if (rowText.includes('bekor') || rowText.includes('chiqim') || text.startsWith('-')) return COLORS.expense;
  if (rowText.includes('kutilmoqda')) return COLORS.muted;
  if (rowText.includes('kirim') || text.startsWith('+')) return COLORS.income;
  return COLORS.text;
}

function drawMonthlyChart(doc, chartRows, labels) {
  ensureSpace(doc, 190);
  const x = 58;
  const y = doc.y + 10;
  const width = 450;
  const height = 130;
  const max = Math.max(...chartRows.flatMap((row) => [row.income, row.expense]), 1);
  const groupWidth = width / chartRows.length;
  const barWidth = Math.min(22, groupWidth / 4);

  doc.path(svgRectPath(x, y, width, height)).strokeColor(COLORS.border).stroke();
  chartRows.forEach((row, index) => {
    const baseX = x + index * groupWidth + groupWidth / 2 - barWidth;
    const incomeH = (row.income / max) * (height - 26);
    const expenseH = (row.expense / max) * (height - 26);
    doc.path(svgRectPath(baseX, y + height - incomeH - 20, barWidth, incomeH)).fill(COLORS.income);
    doc.path(svgRectPath(baseX + barWidth + 3, y + height - expenseH - 20, barWidth, expenseH)).fill(COLORS.expense);
    doc.fillColor(COLORS.muted).fontSize(7).text(row.label, x + index * groupWidth, y + height - 16, {
      width: groupWidth,
      align: 'center',
    });
  });

  doc.fillColor(COLORS.income).fontSize(8).text(labels.income, x, y + height + 8);
  doc.fillColor(COLORS.expense).text(labels.expense, x + 55, y + height + 8);
  doc.y = y + height + 28;
}

// Daromad manbasi tahlili: har oy uchun stacked-bar diagramma (manba bo'yicha foiz) +
// matn (nechta xizmat, jami summa, xizmat/sotuv/boshqa son va foizi). Grafik va son birga.
function drawSourceAnalysis(doc, rows, labels) {
  drawSectionTitle(doc, labels.sourceAnalysis);
  drawSourceLegend(doc, labels);

  const startX = doc.page.margins.left;
  const barWidth = 515;
  const barHeight = 12;
  const segments = ['service', 'material', 'item', 'other'];

  for (const row of rows) {
    ensureSpace(doc, 56);
    const top = doc.y;

    // 1-qator: oy nomi + nechta xizmat + jami kirim.
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.text).text(row.label, startX, top);
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(
      `${row.servicesCount} ${labels.monthServices}   ${labels.monthTotal}: ${formatMoney(row.totalIncome)}`,
      startX + 150,
      top + 1,
      { width: barWidth - 150, align: 'right' }
    );

    // 2-qator: stacked bar (manba foizlari bo'yicha).
    const barY = top + 15;
    let left = startX;
    for (const key of segments) {
      const source = row.sources.find((item) => item.key === key);
      const segWidth = (Math.max(0, source?.pct || 0) / 100) * barWidth;
      if (segWidth > 0.4) {
        doc.path(svgRectPath(left, barY, segWidth, barHeight)).fill(SOURCE_COLORS[key]);
        left += segWidth;
      }
    }
    doc.path(svgRectPath(startX, barY, barWidth, barHeight)).strokeColor(COLORS.border).stroke();

    // 3-qator: aniq son va foiz (xizmat / material+buyum sotuvi / boshqa).
    const service = row.sources.find((item) => item.key === 'service');
    const parts = [
      `${labels.srcService}: ${formatMoney(service.total)} (${pctText(service.pct)})`,
      `${labels.srcSales}: ${formatMoney(row.salesTotal)} (${pctText(row.salesPct)})`,
    ];
    if (row.otherTotal > 0) parts.push(`${labels.srcOther}: ${formatMoney(row.otherTotal)} (${pctText(row.otherPct)})`);
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.text).text(parts.join('    '), startX, barY + barHeight + 4, {
      width: barWidth,
    });

    doc.y = barY + barHeight + 18;
  }
  doc.moveDown(0.3);
}

function drawSourceLegend(doc, labels) {
  ensureSpace(doc, 20);
  const y = doc.y;
  let x = doc.page.margins.left;
  const entries = [
    ['service', labels.srcService],
    ['material', labels.srcMaterial],
    ['item', labels.srcItem],
    ['other', labels.srcOther],
  ];
  doc.font('Helvetica').fontSize(8);
  for (const [key, label] of entries) {
    doc.path(svgRectPath(x, y + 1, 9, 9)).fill(SOURCE_COLORS[key]);
    doc.fillColor(COLORS.muted).text(label, x + 13, y);
    x += 13 + doc.widthOfString(label) + 18;
  }
  doc.y = y + 16;
}

function pctText(value) {
  return `${Math.round(value || 0)}%`;
}

// Qiziqarli ko'rsatkichlar: har bir ko'rsatkich rangli marker + qalin label + qiymat.
// Emoji ishlatilmaydi (PDF Helvetica emoji'ni chizolmaydi) — o'rniga toza tipografik ko'rinish.
function drawInsights(doc, lines, labels) {
  if (!lines?.length) return;
  drawSectionTitle(doc, labels.insights);
  const startX = doc.page.margins.left;
  for (const line of lines) {
    ensureSpace(doc, 18);
    const y = doc.y;
    doc.path(svgRectPath(startX, y + 2.5, 6, 6)).fill(COLORS.income);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
      .text(`${line.label}:  `, startX + 13, y, { continued: true, width: 515 - 13 });
    doc.font('Helvetica-Bold').fillColor(COLORS.text).text(line.value);
    doc.moveDown(0.45);
  }
  doc.moveDown(0.3);
}

function ensureSpace(doc, requiredHeight) {
  if (doc.y + requiredHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function truncate(value, width) {
  const text = value === null || value === undefined ? '' : String(value);
  const maxChars = Math.max(8, Math.floor(width / 5));
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}...` : text;
}

function svgRectPath(x, y, width, height) {
  return `M${x} ${y}h${width}v${height}h${-width}Z`;
}

export default { createReportDoc };
