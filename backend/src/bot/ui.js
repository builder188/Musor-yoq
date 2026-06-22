import { InlineKeyboard } from 'grammy';
import { formatMoney } from '../utils/money.js';
import { formatPhone } from '../utils/phone.js';
import { encodeCoords } from './location.js';

function pad(value) {
  return String(value).padStart(2, '0');
}

export function formatBotDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatBotDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function formatBotTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const DIVIDER = '-----------------';

// Manzil matni; koordinatalar bo'lsa 📌 (xaritada ham bor) belgisini qo'shadi.
export function locationLabel(service) {
  const address = service.location?.address || service.location || '-';
  const coords = service.location?.coordinates;
  const hasCoords =
    coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng);
  return hasCoords ? `${address} 📌` : address;
}

const EMOJI_DIVIDER = '━━━━━━━━━━━━━━━━━';

export function serviceConfirmationText(service) {
  const location = locationLabel(service);
  const lines = [
    '✅ Xizmat saqlandi!',
    EMOJI_DIVIDER,
    `👤 ${service.clientName || '-'}`,
    `📱 ${formatPhone(service.clientPhone) || service.clientPhone || '-'}`,
    `📍 ${location}`,
    `📅 ${formatBotDateTime(service.serviceDateTime)}`,
    `💰 ${formatMoney(service.price)}`,
    `💳 ${service.paymentMethod || '-'}`,
  ];
  if (service.notes) lines.push(`📝 ${service.notes}`);
  lines.push(EMOJI_DIVIDER);
  return lines.join('\n');
}

export function futureServiceKeyboard(serviceId) {
  return new InlineKeyboard()
    .text('Standart eslatma', `reminder_default_${serviceId}`)
    .text('Eslatmani sozlash', `reminder_edit_${serviceId}`)
    .row()
    .text("Eslatmani o'chirish", `disable_reminder_${serviceId}`);
}

export function serviceActionKeyboard(serviceId) {
  return new InlineKeyboard()
    .text('Ha, bajardim', `complete_${serviceId}`)
    .row()
    .text("Yo'q, bajarmadim", `not_done_${serviceId}`);
}

export function notDoneKeyboard(serviceId) {
  return new InlineKeyboard()
    .text('Uzaytirish', `snooze_${serviceId}`)
    .text('Bekor qilish', `cancel_${serviceId}`);
}

export function cancelConfirmKeyboard(serviceId) {
  return new InlineKeyboard()
    .text('Ha', `cancel_confirm_${serviceId}`)
    .text("Yo'q", `cancel_no_${serviceId}`);
}

// Oddiy eslatma (minutesBefore > 0) ostidagi tugmalar: 30 daqiqa kechiktir yoki o'chir.
export function reminderSnoozeKeyboard(serviceId) {
  return new InlineKeyboard()
    .text('⏳ Eslatmani kechiktir', `quick_snooze_${serviceId}`)
    .text("🔕 O'chirib qo'y", `mute_${serviceId}`);
}

export function saveKeyboard() {
  return new InlineKeyboard().text('Saqlash', 'save_yes').text('Bekor qilish', 'save_no');
}

export function locationQuestionKeyboard() {
  return new InlineKeyboard().text('Ha', 'location_service_yes').text("Yo'q", 'location_service_no');
}

export function locationConfirmKeyboard() {
  return new InlineKeyboard().text('Ha', 'use_location').text("Yo'q", 'ignore_location');
}

export function locationReviewKeyboard(coords) {
  const encoded = encodeCoords(coords?.lat, coords?.lng);
  if (!encoded) return locationConfirmKeyboard();
  return new InlineKeyboard()
    .text("Ha, to'g'ri", `loc_confirm_${encoded}`)
    .row()
    .text("Nomi o'zgartirish", `loc_rename_${encoded}`)
    .row()
    .text("Yo'q", 'ignore_location');
}

export function ocrRecordKeyboard() {
  return new InlineKeyboard().text('Saqlash', 'ocr_save').text("O'tkazib yuborish", 'ocr_skip');
}

export function ocrRecordText(record, index, total) {
  const price = typeof record.price === 'number' ? formatMoney(record.price) : '?';
  const when = record.serviceDateTime ? formatBotDateTime(record.serviceDateTime) : record.date || '?';
  return [
    `Yozuv ${index}/${total}:`,
    `Mijoz: ${record.clientName || '?'}`,
    `Tel: ${formatPhone(record.clientPhone) || record.clientPhone || '?'}`,
    `Manzil: ${record.location?.address || record.location || '?'}`,
    `Narx: ${price}`,
    `Sana: ${when}`,
  ].join('\n');
}

export function paymentConfirmKeyboard() {
  return new InlineKeyboard().text('Ha, yozing', 'payment_confirm_yes').text("Yo'q", 'payment_confirm_no');
}

export function editConfirmKeyboard() {
  return new InlineKeyboard().text('Ha', 'edit_confirm').text("Yo'q", 'edit_cancel');
}

export function pdfFilterKeyboard() {
  return new InlineKeyboard()
    .text("To'liq - bu oy", 'pdf:full:month')
    .text("To'liq - hammasi", 'pdf:full:all')
    .row()
    .text('Moliya - bu oy', 'pdf:finance:month')
    .text('Moliya - hammasi', 'pdf:finance:all')
    .row()
    .text('Xizmatlar - bu oy', 'pdf:services:month')
    .text('Mijozlar - hammasi', 'pdf:clients:all');
}

export function paymentMethodKeyboard() {
  return new InlineKeyboard()
    .text('Naqd', 'pm_naqd')
    .text('Karta', 'pm_karta')
    .text("O'tkazma", 'pm_otkazma');
}

export function clientChoiceKeyboard(clients) {
  const keyboard = new InlineKeyboard();
  clients.slice(0, 8).forEach((client) => {
    keyboard.text(`${client.name} (${formatPhone(client.phone) || client.phone})`, `payment_client_${client._id}`).row();
  });
  keyboard.text('Bekor qilish', 'payment_confirm_no');
  return keyboard;
}

// Generik mijoz tanlash (bir xil ismlilar uchun) — har qanday amalni davom ettiradi.
export function clientPickKeyboard(clients) {
  const keyboard = new InlineKeyboard();
  clients.slice(0, 8).forEach((client) => {
    keyboard.text(`${client.name} (${formatPhone(client.phone) || client.phone})`, `pick_client_${client._id}`).row();
  });
  keyboard.text('Bekor qilish', 'pick_cancel');
  return keyboard;
}

export function timeLabel(minutesBefore) {
  if (minutesBefore === 0) return 'Xizmat vaqti keldi';
  if (minutesBefore === 60) return '1 soat qoldi';
  if (minutesBefore === 1440) return '1 kun qoldi';
  if (minutesBefore < 60) return `${minutesBefore} daqiqa qoldi`;
  if (minutesBefore % 1440 === 0) return `${minutesBefore / 1440} kun qoldi`;
  if (minutesBefore % 60 === 0) return `${minutesBefore / 60} soat qoldi`;
  return `${minutesBefore} daqiqa qoldi`;
}

// Faqat qolgan vaqt miqdori ("1 kun" / "2 soat" / "30 daqiqa").
export function remainingLabel(minutesBefore) {
  if (minutesBefore >= 1440) {
    const days = minutesBefore / 1440;
    return `${Number.isInteger(days) ? days : Math.round(days)} kun`;
  }
  if (minutesBefore >= 60) {
    const hours = minutesBefore / 60;
    return `${Number.isInteger(hours) ? hours : Math.round(hours)} soat`;
  }
  return `${minutesBefore} daqiqa`;
}

export function reminderText(service, reminder) {
  const location = locationLabel(service);
  const phone = formatPhone(service.clientPhone) || service.clientPhone || '-';
  const priceLine = `💰 ${formatMoney(service.price)} | ${service.paymentMethod || '-'}`;

  // Xizmat vaqti keldi — bajarildi/bajarilmadi so'rovi.
  if (reminder.minutesBefore === 0) {
    return [
      '⏰ XIZMAT VAQTI KELDI!',
      DIVIDER,
      `👤 ${service.clientName || '-'}`,
      `📱 ${phone}`,
      `📍 ${location}`,
      priceLine,
      DIVIDER,
      "Bajardingizmi? To'lovni oldingizmi?",
    ].join('\n');
  }

  // Oddiy oldindan eslatma.
  const lines = [
    `⏰ ${remainingLabel(reminder.minutesBefore)} qoldi!`,
    DIVIDER,
    `👤 ${service.clientName || '-'}`,
    `📱 ${phone}`,
    `📍 ${location}`,
    `📅 ${formatBotDateTime(service.serviceDateTime)}`,
    priceLine,
  ];
  if (service.notes) lines.push(`📝 ${service.notes}`);
  lines.push(DIVIDER);
  return lines.join('\n');
}
