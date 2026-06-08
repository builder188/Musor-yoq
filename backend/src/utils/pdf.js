// PDFKit yordamida hisobot yaratish.
// Eslatma: standart shrift (Helvetica) lotin alifbosini qo'llab-quvvatlaydi (o'zbekcha mos).
// Kirill (ruscha) uchun TTF shrift qo'shish kerak bo'ladi.
import PDFDocument from 'pdfkit';
import { formatMoney } from './money.js';
import { formatDateTime } from './dates.js';

// Hisobot hujjatini yaratadi va PDFDocument qaytaradi (chaqiruvchi uni stream'ga uzatadi).
// data: { title, periodLabel, summary:{income,expense,balance}, transactions:[], services:[] }
export function createReportDoc(data) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  // Sarlavha.
  doc.fontSize(20).text(data.title || 'Musir Yo\'q — Hisobot', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#666').text(`Davr: ${data.periodLabel || 'Hammasi'}`, { align: 'center' });
  doc.fillColor('#000');
  doc.moveDown(1);

  // Umumiy ko'rsatkichlar.
  if (data.summary) {
    doc.fontSize(13).text('Umumiy ko\'rsatkichlar', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Daromad:  ${formatMoney(data.summary.income)}`);
    doc.text(`Xarajat:  ${formatMoney(data.summary.expense)}`);
    doc.text(`Sof balans:  ${formatMoney(data.summary.balance)}`);
    doc.moveDown(1);
  }

  // Tranzaksiyalar jadvali.
  if (data.transactions && data.transactions.length > 0) {
    doc.fontSize(13).text('Tranzaksiyalar', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    for (const tx of data.transactions) {
      const sign = tx.type === 'expense' ? '-' : '+';
      const label = tx.type === 'expense' ? `Xarajat (${tx.category || 'boshqa'})` : tx.type === 'debt_payment' ? 'Qarz to\'lovi' : 'Daromad';
      doc.text(`${formatDateTime(tx.date)}   ${label}   ${sign}${formatMoney(tx.amount)}${tx.note ? '   — ' + tx.note : ''}`);
    }
    doc.moveDown(1);
  }

  // Xizmatlar jadvali.
  if (data.services && data.services.length > 0) {
    doc.fontSize(13).text('Xizmatlar', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    for (const s of data.services) {
      doc.text(`${formatDateTime(s.serviceDateTime)}   ${s.clientName}   ${s.location?.text || '—'}   ${formatMoney(s.price)}   [${s.status}]`);
    }
    doc.moveDown(1);
  }

  // Pastki qism.
  doc.fontSize(8).fillColor('#999').text(`Yaratilgan: ${formatDateTime(new Date())}`, { align: 'right' });

  return doc;
}

export default { createReportDoc };
