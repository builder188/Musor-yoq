import { InputFile } from 'grammy';
import Service from '../../models/Service.js';
import Conversation from '../../models/Conversation.js';
import Client from '../../models/Client.js';
import { generateReportPdf, resolveReportRange } from '../../routes/reports.js';
import { completeService, cancelService, createService, recordServicePayment } from '../../services/serviceService.js';
import { snoozeReminder } from '../../services/reminderService.js';
import { runAgent, applyConfirmedEdit } from '../../ai/agent.js';
import { formatMoney } from '../../utils/money.js';
import {
  serviceConfirmationText,
  futureServiceKeyboard,
  notDoneKeyboard,
  cancelConfirmKeyboard,
  locationQuestionKeyboard,
  ocrRecordKeyboard,
  ocrRecordText,
} from '../ui.js';
import { mergeFields, nextMissing, QUESTIONS } from '../flow.js';
import { decodeCoords, normalizeLocationData, reverseGeocode, sameCoords } from '../location.js';

export function registerCallbacks(bot) {
  bot.callbackQuery([/^complete_(.+)$/, /^svc:done:(.+)$/], async (ctx) => {
    const id = ctx.match[1];
    try {
      const service = await completeService(id, { markPaid: true });
      await ctx.answerCallbackQuery({ text: 'Bajarildi ✅' });
      await ctx.editMessageText(`✅ "${service.clientName}" xizmati bajarildi.\nDaromad: ${formatMoney(service.price)}`);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  bot.callbackQuery([/^cancel_(?!confirm_|no_|direct_)(.+)$/, /^svc:cancel:(.+)$/], async (ctx) => {
    const id = ctx.match[1];
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Bekor qilasizmi?', { reply_markup: cancelConfirmKeyboard(id) });
  });

  bot.callbackQuery(/^cancel_no_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Bekor qilinmadi' });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  });

  bot.callbackQuery(/^cancel_confirm_(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    try {
      const service = await cancelService(id);
      await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
      await ctx.editMessageText(`"${service.clientName}" xizmati bekor qilindi.`);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  bot.callbackQuery([/^cancel_direct_(.+)$/, /^svc:cancel_direct:(.+)$/], async (ctx) => {
    const id = ctx.match[1];
    try {
      const service = await cancelService(id);
      await ctx.answerCallbackQuery({ text: 'Bekor qilindi ❌' });
      await ctx.editMessageText(`❌ "${service.clientName}" xizmati bekor qilindi.`);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  bot.callbackQuery(/^not_done_(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: notDoneKeyboard(id) });
  });

  bot.callbackQuery(/^reschedule_(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    await askForReschedule(ctx, id);
  });

  bot.callbackQuery([/^snooze_(.+)$/, /^svc:snooze:(.+)$/], async (ctx) => {
    const id = ctx.match[1];
    await askForReschedule(ctx, id);
  });

  bot.callbackQuery([/^quick_snooze_(.+)$/, /^svc:quick_snooze:(.+)$/], async (ctx) => {
    const id = ctx.match[1];
    try {
      const service = await Service.findById(id);
      if (!service) throw new Error('Xizmat topilmadi');
      service.reminders.push(snoozeReminder(30));
      await service.save();
      await ctx.answerCallbackQuery({ text: '30 daqiqaga kechiktirildi ⏳' });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      await ctx.reply(`⏳ "${service.clientName}" uchun eslatma 30 daqiqaga kechiktirildi.`);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  // "🔕 O'chirib qo'y" — shu xizmat uchun qolgan (yuborilmagan) eslatmalarni o'chiradi.
  bot.callbackQuery([/^mute_(.+)$/, /^disable_reminder_(.+)$/], async (ctx) => {
    const id = ctx.match[1];
    try {
      const service = await Service.findById(id);
      if (!service) throw new Error('Xizmat topilmadi');
      const reminders = service.reminders || [];
      const before = reminders.length;
      service.reminders = reminders.filter((r) => r.sent);
      const removed = before - service.reminders.length;
      await service.save();
      await ctx.answerCallbackQuery({ text: "Eslatmalar o'chirildi 🔕" });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.reply(`🔕 "${service.clientName}" uchun qolgan ${removed} ta eslatma o'chirildi.`);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  bot.callbackQuery('save_yes', async (ctx) => {
    try {
      const conv = await Conversation.findOne({ telegramId: ctx.from.id });
      const pending = conv?.collected?.pendingData || ctx.session?.collectedData?.pendingData || ctx.session?.collectedData;
      const records = conv?.collected?.records || ctx.session?.collectedData?.records || null;
      if ((!pending || Object.keys(pending).length === 0) && !records?.length) {
        await ctx.answerCallbackQuery({ text: 'Saqlanadigan maʼlumot topilmadi', show_alert: true });
        return;
      }

      if (records?.length) {
        const bulk = await saveRecords(records);
        if (conv) await conv.reset();
        clearSession(ctx);
        await ctx.answerCallbackQuery({ text: 'Tekshirildi ✅' });
        await ctx.editMessageText(bulk);
        return;
      }

      const service = await createService(pending);
      if (conv) await conv.reset();
      clearSession(ctx);
      if (ctx.session) ctx.session.lastServiceId = service._id.toString();

      await ctx.answerCallbackQuery({ text: 'Saqlandi ✅' });
      await ctx.editMessageText(serviceConfirmationText(service));
      if (new Date(service.serviceDateTime).getTime() > Date.now()) {
        await ctx.reply('Eslatma sozlamasi:', {
          reply_markup: futureServiceKeyboard(service._id.toString()),
        });
      }
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  bot.callbackQuery('save_no', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    clearSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
    await ctx.editMessageText('Bekor qilindi ✅');
  });

  bot.callbackQuery(['location_service_yes', 'start_service_with_location'], async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    const location = conv?.collected?.location || ctx.session?.collectedData?.location;
    if (!location) {
      await ctx.answerCallbackQuery({ text: 'Joylashuv topilmadi', show_alert: true });
      return;
    }
    if (conv) {
      conv.pendingIntent = 'SERVICE_ENTRY';
      conv.collected = { location };
      conv.awaitingField = 'clientPhone';
      conv.markModified('collected');
      await conv.save();
    }
    if (ctx.session) {
      ctx.session.intent = 'SERVICE_ENTRY';
      ctx.session.collectedData = { location };
      ctx.session.pendingField = 'clientPhone';
      ctx.session.awaitingConfirmation = false;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Joylashuv yangi xizmat uchun olindi.');
    await ctx.reply(QUESTIONS.clientPhone);
  });

  bot.callbackQuery(/^loc_confirm_(.+)$/, async (ctx) => {
    try {
      const coords = decodeCoords(ctx.match[1]);
      if (!coords) throw new Error('Koordinata noto‘g‘ri');
      await confirmLocation(ctx, coords);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  bot.callbackQuery(/^loc_rename_(.+)$/, async (ctx) => {
    try {
      const coords = decodeCoords(ctx.match[1]);
      if (!coords) throw new Error('Koordinata noto‘g‘ri');
      const conv = await getOrCreateConversation(ctx.from.id);
      const pending = findPendingLocation(ctx, conv, coords);
      if (pending) {
        conv.collected = { ...(conv.collected || {}), pendingLocation: pending };
        conv.markModified('collected');
        await conv.save();
      }
      if (ctx.session) {
        ctx.session.pendingLocationRename = true;
        ctx.session.pendingLocationCoords = coords;
        ctx.session.pendingLocation = pending || normalizeLocationData('Lokatsiya (xaritada)', coords);
      }
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.reply('Manzil nomini yozing. Masalan: Shayxontohur, Navro‘z bozori yaqini.');
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  bot.callbackQuery('location_service_no', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    clearSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
    await ctx.editMessageText('Joylashuv bekor qilindi ✅');
  });

  bot.callbackQuery('payment_confirm_yes', async (ctx) => {
    try {
      const conv = await Conversation.findOne({ telegramId: ctx.from.id });
      const clientId = conv?.collected?.clientId || ctx.session?.collectedData?.clientId;
      const amount = conv?.collected?.amount || ctx.session?.collectedData?.amount;
      if (!clientId || !amount) throw new Error("To'lov ma'lumoti topilmadi");
      const result = await recordServicePayment({
        clientId,
        amount,
        note: conv?.collected?.note || '',
      });
      if (conv) await conv.reset();
      clearSession(ctx);
      await ctx.answerCallbackQuery({ text: "To'lov yozildi" });
      await ctx.editMessageText(
        `${result.service.clientName}: ${formatMoney(result.amountApplied)} to'lov holatiga yozildi.`
      );
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  bot.callbackQuery('payment_confirm_no', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    clearSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
    await ctx.editMessageText("To'lov yozilmadi.");
  });

  bot.callbackQuery(/^payment_client_(.+)$/, async (ctx) => {
    try {
      const clientId = ctx.match[1];
      const conv = await Conversation.findOne({ telegramId: ctx.from.id });
      const amount = conv?.collected?.amount || ctx.session?.collectedData?.amount;
      if (!amount) throw new Error("To'lov summasi topilmadi");
      const client = await Client.findOne({ _id: clientId, isDeleted: { $ne: true } });
      if (!client) throw new Error('Mijoz topilmadi');
      const result = await recordServicePayment({
        clientId,
        amount,
        note: conv?.collected?.note || '',
      });
      if (conv) await conv.reset();
      clearSession(ctx);
      await ctx.answerCallbackQuery({ text: "To'lov yozildi" });
      await ctx.editMessageText(
        `${client.name}: ${formatMoney(result.amountApplied)} to'lov holatiga yozildi.`
      );
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  // PDF hisobot — filtr tanlangach yaratib, bot orqali yuboriladi.
  bot.callbackQuery(/^pdf:(full|finance|services|clients):(month|all)$/, async (ctx) => {
    const reportType = ctx.match[1];
    const period = ctx.match[2];
    try {
      await ctx.answerCallbackQuery({ text: 'Tayyorlanmoqda...' });
      await ctx.editMessageText('📄 Hisobot tayyorlanmoqda...').catch(() => {});
      await ctx.replyWithChatAction('upload_document').catch(() => {});

      const range = period === 'month'
        ? resolveReportRange({ month: monthKey() })
        : resolveReportRange({});
      const buffer = await generateReportPdf({ reportType, range, language: 'uz' });
      const filename = `hisobot-${reportType}-${range.fileLabel || period}.pdf`;
      await ctx.replyWithDocument(new InputFile(buffer, filename), {
        caption: `📄 ${reportLabel(reportType)} (${range.label})`,
      });
    } catch (err) {
      console.error('PDF xatosi:', err.message);
      await ctx.reply('PDF yaratishda xatolik: ' + err.message);
    }
  });

  // Tahrirni tasdiqlash — SERVICE_EDIT / CLIENT_EDIT.
  bot.callbackQuery('edit_confirm', async (ctx) => {
    try {
      const conv = await Conversation.findOne({ telegramId: ctx.from.id });
      const pending = conv?.collected;
      if (!pending?.editType || !pending?.targetId) {
        await ctx.answerCallbackQuery({ text: "O'zgartirish ma'lumoti topilmadi", show_alert: true });
        return;
      }
      const result = await applyConfirmedEdit(pending);
      if (conv) await conv.reset();
      clearSession(ctx);
      await ctx.answerCallbackQuery({ text: "O'zgartirildi ✅" });
      const name = result.service?.clientName || result.client?.name || '';
      await ctx.editMessageText(`✅ ${name} ma'lumoti o'zgartirildi.`);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  bot.callbackQuery('edit_cancel', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    clearSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
    await ctx.editMessageText("O'zgartirilmadi.");
  });

  // To'lov usulini tugma orqali tanlash (slot-filling davom etadi).
  bot.callbackQuery(['pm_naqd', 'pm_karta', 'pm_otkazma'], async (ctx) => {
    const method = ctx.callbackQuery.data.replace('pm_', '');
    try {
      const conv = await Conversation.findOne({ telegramId: ctx.from.id });
      if (!conv?.pendingIntent) {
        await ctx.answerCallbackQuery({ text: 'Faol so\'rov yo\'q' });
        return;
      }
      await ctx.answerCallbackQuery({ text: `${method} tanlandi` });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      const res = await runAgent({
        understanding: { intent: conv.pendingIntent, fields: { paymentMethod: method }, reply: '', confidence: 0.95 },
        rawText: method,
        conversation: conv,
      });
      if (res?.tool === 'create_service' && res.result) {
        await ctx.reply(serviceConfirmationText(res.result));
        if (new Date(res.result.serviceDateTime).getTime() > Date.now()) {
          await ctx.reply('Eslatma sozlamasi:', {
            reply_markup: futureServiceKeyboard(res.result.id || res.result._id),
          });
        }
        clearSession(ctx);
        return;
      }
      await ctx.reply(res.text, res.keyboard ? { reply_markup: res.keyboard } : undefined);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true }).catch(() => {});
    }
  });

  // Lokatsiya tasdiqlash — manzil sessiyada saqlangan (callback_data qisqa).
  bot.callbackQuery('use_location', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    const location = ctx.session?.collectedData?.location || conv?.collected?.location;
    if (!location) {
      await ctx.answerCallbackQuery({ text: 'Joylashuv topilmadi', show_alert: true });
      return;
    }
    if (conv) {
      conv.pendingIntent = 'SERVICE_ENTRY';
      conv.collected = { location };
      conv.awaitingField = 'clientPhone';
      conv.markModified('collected');
      await conv.save();
    }
    if (ctx.session) {
      ctx.session.intent = 'SERVICE_ENTRY';
      ctx.session.collectedData = { location };
      ctx.session.pendingField = 'clientPhone';
      ctx.session.awaitingConfirmation = false;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Joylashuv yangi xizmat uchun olindi.');
    await ctx.reply(QUESTIONS.clientPhone);
  });

  bot.callbackQuery('ignore_location', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    clearSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
    await ctx.editMessageText('Joylashuv bekor qilindi ✅');
  });

  // OCR navbati — yozuvlarni birin-ketin saqlash yoki o'tkazib yuborish.
  bot.callbackQuery(['ocr_save', 'ocr_skip'], async (ctx) => {
    const queue = ctx.session?.ocrQueue || [];
    const index = ctx.session?.currentOcrIndex || 0;
    const record = queue[index];
    if (!record) {
      await ctx.answerCallbackQuery({ text: 'Yozuv topilmadi' });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      clearOcr(ctx);
      return;
    }

    let line;
    if (ctx.callbackQuery.data === 'ocr_save') {
      const fields = mergeFields({}, record);
      const missing = nextMissing('SERVICE_ENTRY', fields);
      if (missing) {
        ctx.session.ocrSkipped = (ctx.session.ocrSkipped || 0) + 1;
        line = `⚠️ ${index + 1}-yozuv saqlanmadi — ${QUESTIONS[missing] || missing} yetishmaydi.`;
      } else {
        try {
          const service = await createService(fields);
          ctx.session.ocrSaved = (ctx.session.ocrSaved || 0) + 1;
          line = `✅ ${index + 1}-yozuv saqlandi: ${service.clientName} — ${formatMoney(service.price)}.`;
        } catch (err) {
          ctx.session.ocrSkipped = (ctx.session.ocrSkipped || 0) + 1;
          line = `⚠️ ${index + 1}-yozuv xato: ${err.message}`;
        }
      }
    } else {
      ctx.session.ocrSkipped = (ctx.session.ocrSkipped || 0) + 1;
      line = `⏭️ ${index + 1}-yozuv o'tkazib yuborildi.`;
    }

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

    const nextIndex = index + 1;
    ctx.session.currentOcrIndex = nextIndex;

    if (nextIndex >= queue.length) {
      const saved = ctx.session.ocrSaved || 0;
      const skipped = ctx.session.ocrSkipped || 0;
      clearOcr(ctx);
      await ctx.reply(`${line}\n\n📦 Yakun: ${saved} ta saqlandi, ${skipped} ta o'tkazib yuborildi.`);
      return;
    }

    await ctx.reply(line);
    const next = queue[nextIndex];
    await ctx.reply(ocrRecordText(next, nextIndex + 1, queue.length), { reply_markup: ocrRecordKeyboard() });
  });

  bot.callbackQuery(/^reminder_default_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Standart eslatmalar saqlandi ✅' });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  });

  bot.callbackQuery(/^reminder_edit_(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    if (ctx.session) ctx.session.awaitingReminderConfig = id;
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply("Qachon eslatishimni xohlaysiz? Masalan: '2 soat oldin' yoki '30 daqiqa oldin'");
  });
}

async function getOrCreateConversation(telegramId) {
  let conv = await Conversation.findOne({ telegramId });
  if (!conv) conv = await Conversation.create({ telegramId });
  return conv;
}

function findPendingLocation(ctx, conv, coords) {
  const candidates = [
    ctx.session?.pendingLocation,
    ctx.session?.collectedData?.pendingLocation,
    ctx.session?.collectedData?.location,
    conv?.collected?.pendingLocation,
    conv?.collected?.location,
  ].filter(Boolean);
  return candidates.find((location) => sameCoords(location.coordinates, coords)) || null;
}

async function resolveLocation(ctx, conv, coords) {
  const pending = findPendingLocation(ctx, conv, coords);
  if (pending?.address) return normalizeLocationData(pending.address, coords);
  const address = await reverseGeocode(coords.lat, coords.lng);
  return normalizeLocationData(address, coords);
}

async function confirmLocation(ctx, coords) {
  const conv = await getOrCreateConversation(ctx.from.id);
  const location = await resolveLocation(ctx, conv, coords);

  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  if (conv.pendingIntent && conv.awaitingField === 'location') {
    conv.collected = { ...(conv.collected || {}), location };
    delete conv.collected.pendingLocation;
    conv.markModified('collected');
    await conv.save();

    const res = await runAgent({
      understanding: { intent: conv.pendingIntent, fields: {}, reply: '', confidence: 1 },
      rawText: location.address,
      conversation: conv,
    });
    syncSessionFromConversation(ctx, conv);
    await ctx.reply(`Manzil saqlandi: ${location.address}`);
    await sendAgentResult(ctx, res);
    return;
  }

  conv.pendingIntent = 'LOCATION_QUESTION';
  conv.collected = { location };
  conv.awaitingField = null;
  conv.markModified('collected');
  await conv.save();

  if (ctx.session) {
    ctx.session.intent = 'LOCATION_QUESTION';
    ctx.session.collectedData = { location };
    ctx.session.pendingLocation = null;
    ctx.session.pendingLocationRename = false;
    ctx.session.pendingLocationCoords = null;
    ctx.session.pendingField = null;
    ctx.session.awaitingConfirmation = true;
  }

  await ctx.reply(`Manzil saqlandi: ${location.address}\n\nBu manzil yangi xizmat uchunmi?`, {
    reply_markup: locationQuestionKeyboard(),
  });
}

async function sendAgentResult(ctx, res) {
  if (res?.tool === 'create_service' && res.result) {
    await ctx.reply(serviceConfirmationText(res.result));
    if (new Date(res.result.serviceDateTime).getTime() > Date.now()) {
      await ctx.reply('Eslatma sozlamasi:', {
        reply_markup: futureServiceKeyboard(res.result.id || res.result._id),
      });
    }
    if (ctx.session) ctx.session.lastServiceId = res.result.id || res.result._id || null;
    return;
  }
  await ctx.reply(res.text, res.keyboard ? { reply_markup: res.keyboard } : undefined);
}

function syncSessionFromConversation(ctx, conv) {
  if (!ctx.session || !conv) return;
  ctx.session.intent = conv.pendingIntent;
  ctx.session.collectedData = conv.collected || {};
  ctx.session.pendingField = conv.awaitingField;
  ctx.session.awaitingConfirmation = conv.pendingIntent === 'IMAGE_RECORD_CONFIRM';
  ctx.session.pendingLocation = null;
  ctx.session.pendingLocationRename = false;
  ctx.session.pendingLocationCoords = null;
}

async function askForReschedule(ctx, serviceId) {
  const conv = await Conversation.findOneAndUpdate(
    { telegramId: ctx.from.id },
    {
      telegramId: ctx.from.id,
      pendingIntent: 'SERVICE_RESCHEDULE',
      collected: { serviceId },
      awaitingField: 'serviceDateTime',
    },
    { upsert: true, new: true }
  );
  conv.markModified('collected');
  await conv.save();
  if (ctx.session) {
    ctx.session.intent = 'SERVICE_RESCHEDULE';
    ctx.session.collectedData = { serviceId };
    ctx.session.pendingField = 'serviceDateTime';
    ctx.session.awaitingReschedule = serviceId;
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('Yangi sana va vaqtni yozing yoki yuboring:');
}

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function reportLabel(type) {
  switch (type) {
    case 'finance':
      return 'Moliya hisoboti';
    case 'services':
      return 'Xizmatlar hisoboti';
    case 'clients':
      return 'Mijozlar hisoboti';
    default:
      return "To'liq hisobot";
  }
}

function clearSession(ctx) {
  if (!ctx.session) return;
  ctx.session.intent = null;
  ctx.session.collectedData = {};
  ctx.session.pendingField = null;
  ctx.session.awaitingConfirmation = false;
  ctx.session.lastServiceId = null;
  ctx.session.awaitingReschedule = null;
  ctx.session.awaitingReminderConfig = null;
  ctx.session.pendingLocation = null;
  ctx.session.pendingLocationRename = false;
  ctx.session.pendingLocationCoords = null;
  ctx.session.ocrQueue = [];
  ctx.session.currentOcrIndex = 0;
}

function clearOcr(ctx) {
  if (!ctx.session) return;
  ctx.session.ocrQueue = [];
  ctx.session.currentOcrIndex = 0;
  ctx.session.ocrSaved = 0;
  ctx.session.ocrSkipped = 0;
}

async function saveRecords(records) {
  const saved = [];
  const skipped = [];
  for (const [index, record] of records.entries()) {
    const fields = mergeFields({}, record);
    const missing = nextMissing('SERVICE_ENTRY', fields);
    if (missing) {
      skipped.push(`${index + 1}-yozuv: ${missing}`);
      continue;
    }
    try {
      const service = await createService(fields);
      saved.push(service);
    } catch (err) {
      skipped.push(`${index + 1}-yozuv: ${err.message}`);
    }
  }

  const lines = [];
  if (saved.length) lines.push(`${saved.length} ta yozuv saqlandi.`);
  if (skipped.length) {
    lines.push(`${skipped.length} ta yozuv saqlanmadi:`);
    lines.push(...skipped);
  }
  return lines.join('\n') || 'Saqlash uchun to‘liq yozuv topilmadi.';
}
