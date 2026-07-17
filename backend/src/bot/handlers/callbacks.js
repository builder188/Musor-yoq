import { InputFile } from 'grammy';
import Service from '../../models/Service.js';
import Conversation from '../../models/Conversation.js';
import { generateReportPdf, resolveReportRange } from '../../routes/reports.js';
import { completeService, cancelService, markServiceNotDone, createService } from '../../services/serviceService.js';
import { runAgent, applyConfirmedEdit, cancelSavedEntry, resumeReturningEntry } from '../../ai/agent.js';
import { markReminderDone, snoozeReminder } from '../../services/reminderEntryService.js';
import { getFineById, payFine } from '../../services/fineService.js';
import { formatMoney } from '../../utils/money.js';
import { formatDateTime } from '../../utils/dates.js';
import {
  serviceConfirmationText,
  reminderInfoLine,
  paymentMethodKeyboard,
  ocrRecordKeyboard,
  ocrRecordText,
} from '../ui.js';
import { mergeFields, nextMissing, QUESTIONS } from '../flow.js';
import { decodeCoords, normalizeLocationData, reverseGeocode, sameCoords } from '../location.js';
import { startLocationBind, bindLocationToService, startServiceFromBindLocation } from '../locationBind.js';

export function registerCallbacks(bot) {
  bot.callbackQuery([/^complete_(.+)$/, /^svc:done:(.+)$/], async (ctx) => {
    const id = ctx.match[1];
    try {
      const service = await completeService(id, { markPaid: true });
      await ctx.answerCallbackQuery({ text: 'Bajarildi ✅' });
      await ctx.editMessageText(`Zo'r oka, ${service.clientName} xizmatini bajarildi deb belgiladim ✅\nDaromad: ${formatMoney(service.price)}`);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  // Tasdiqlash "⚠️ Bajarilmadi" — amalga oshmadi (bekor emas): balansga yozilmaydi,
  // sanasi keyin tahrirlanib qayta rejalashtirilishi mumkin.
  bot.callbackQuery(/^notdone_(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    try {
      const service = await markServiceNotDone(id);
      await ctx.answerCallbackQuery({ text: 'Bajarilmadi ⚠️' });
      await ctx.editMessageText(
        `Mayli oka, ${service.clientName} xizmati bajarilmadi deb belgilandi. Balansga hech narsa yozilmadi — keyin vaqtini o'zgartirib qayta rejalashtirsangiz bo'ladi.`
      );
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  // Tasdiqlash "❌ Bekor qilindi" — to'g'ridan bekor (sabab so'ralmaydi). Balansga ta'sir yo'q.
  bot.callbackQuery([/^cancel_direct_(.+)$/, /^cancel_(.+)$/, /^svc:cancel:(.+)$/], async (ctx) => {
    const id = ctx.match[1];
    try {
      const service = await cancelService(id);
      await ctx.answerCallbackQuery({ text: 'Bekor qilindi ❌' });
      await ctx.editMessageText(`Mayli oka, ${service.clientName} xizmatini bekor qildim. Balansga hech narsa yozilmadi.`);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  // Tasdiqlash "📅 Vaqt surildi" — yangi sana/vaqtni so'raydi (matn yoki ovoz).
  bot.callbackQuery([/^reschedule_(.+)$/, /^snooze_(.+)$/], async (ctx) => {
    const id = ctx.match[1];
    await askForReschedule(ctx, id);
  });

  // Post-save "✏️ Tahrirlash": keyingi matn/ovoz SAQLANGAN yozuvni joyida yangilaydi.
  bot.callbackQuery('saved_edit', async (ctx) => {
    try {
      const conv = await Conversation.findOne({ telegramId: ctx.from.id });
      if (conv?.pendingIntent !== 'ENTRY_SAVED') {
        await ctx.answerCallbackQuery({ text: 'Bu so\'rov eskirgan' });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        return;
      }
      conv.awaitingField = 'editSaved';
      await conv.save();
      if (ctx.session) ctx.session.pendingField = 'editSaved';
      await ctx.answerCallbackQuery();
      await ctx.reply("Nimani o'zgartiramiz oka? Masalan: 'narxi 300 ming' yoki 'telefoni 90 123 45 67'. Aytilmagan maydonlarni ham shu yerda to'ldirsangiz bo'ladi.");
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  // Post-save "❌ Bekor qilish": ALLAQACHON saqlangan yozuv o'chiriladi (kod so'ralmaydi —
  // bu hozirgina kiritilgan, hali hech kim ko'rmagan yozuv).
  bot.callbackQuery('saved_cancel', async (ctx) => {
    try {
      const conv = await Conversation.findOne({ telegramId: ctx.from.id });
      if (conv?.pendingIntent !== 'ENTRY_SAVED') {
        await ctx.answerCallbackQuery({ text: 'Bu so\'rov eskirgan' });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        return;
      }
      const res = await cancelSavedEntry({ conversation: conv });
      clearSession(ctx);
      await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.reply(res.text);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  // Eski (deploy'dan oldingi) tasdiqlash tugmalari — endi ishlatilmaydi.
  bot.callbackQuery(['entry_save', 'entry_edit', 'entry_cancel'], async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Bu tugma eskirgan — endi yozuvlar darhol saqlanadi" });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
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

      // Majburiy maydon yetishsa — to'g'ridan saqlamasdan standart so'rash oqimiga ulaymiz.
      const fields = mergeFields({}, pending);
      const missing = nextMissing('SERVICE_ENTRY', fields);
      if (missing) {
        const conversation = conv || (await getOrCreateConversation(ctx.from.id));
        conversation.pendingIntent = 'SERVICE_ENTRY';
        conversation.collected = fields;
        conversation.awaitingField = missing;
        conversation.markModified('collected');
        await conversation.save();
        if (ctx.session) {
          ctx.session.intent = 'SERVICE_ENTRY';
          ctx.session.collectedData = fields;
          ctx.session.pendingField = missing;
          ctx.session.awaitingConfirmation = false;
        }
        await ctx.answerCallbackQuery({ text: "Ma'lumot to'liq emas" });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        await ctx.reply(
          `Rasmdagi ba'zi ma'lumot to'liq emas.\n${QUESTIONS[missing] || missing}`,
          missing === 'paymentMethod' ? { reply_markup: paymentMethodKeyboard() } : undefined
        );
        return;
      }

      const service = await createService(fields);
      if (conv) await conv.reset();
      clearSession(ctx);
      if (ctx.session) ctx.session.lastServiceId = service._id.toString();

      await ctx.answerCallbackQuery({ text: 'Saqlandi ✅' });
      await ctx.editMessageText(serviceConfirmationText(service));
      const info = reminderInfoLine(service);
      if (info) await ctx.reply(info);
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
    const missing = nextMissing('SERVICE_ENTRY', { location });
    if (conv) {
      conv.pendingIntent = 'SERVICE_ENTRY';
      conv.collected = { location };
      conv.awaitingField = missing;
      conv.markModified('collected');
      await conv.save();
    }
    if (ctx.session) {
      ctx.session.intent = 'SERVICE_ENTRY';
      ctx.session.collectedData = { location };
      ctx.session.pendingField = missing;
      ctx.session.awaitingConfirmation = false;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Manzilni yangi xizmatga oldim oka.");
    await ctx.reply(
      QUESTIONS[missing],
      missing === 'paymentMethod' ? { reply_markup: paymentMethodKeyboard() } : undefined
    );
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
        const originalCoords = pending?.coordinates || coords;
        ctx.session.pendingLocationRename = true;
        ctx.session.pendingLocationCoords = originalCoords;
        ctx.session.pendingLocation = pending || normalizeLocationData('Lokatsiya (xaritada)', originalCoords);
      }
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.reply("Manzil nomini yozib bering oka. Masalan: Shayxontohur, Navro‘z bozori yaqini.");
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  bot.callbackQuery('location_service_no', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    clearSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
    await ctx.editMessageText('Mayli oka, joylashuvni qo\'ydim ✅');
  });

  // LOKATSIYANI QATORGA BOG'LASH tugmalari.
  // "🆕 Yangi xizmat uchun" — eski oqim: lokatsiya bilan yangi yozuv boshlanadi.
  bot.callbackQuery('locbind_new', async (ctx) => {
    try {
      const conv = await Conversation.findOne({ telegramId: ctx.from.id });
      if (conv?.pendingIntent !== 'LOCATION_BIND') {
        await ctx.answerCallbackQuery({ text: "Bu so'rov eskirgan" });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        return;
      }
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await startServiceFromBindLocation(ctx, conv);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true }).catch(() => {});
    }
  });

  bot.callbackQuery('locbind_cancel', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    clearSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
    await ctx.editMessageText("Mayli oka, manzilni hech narsaga bog'lamadim.");
  });

  // Bir nechta mos xizmatdan birini tanlash (nomzodlar conversation'da, callback — indeks).
  bot.callbackQuery(/^locbind_pick_(\d+)$/, async (ctx) => {
    try {
      const conv = await Conversation.findOne({ telegramId: ctx.from.id });
      const candidates = Array.isArray(conv?.collected?.bindCandidates) ? conv.collected.bindCandidates : [];
      const candidate = candidates[Number(ctx.match[1])];
      if (conv?.pendingIntent !== 'LOCATION_BIND' || !candidate) {
        await ctx.answerCallbackQuery({ text: "Bu so'rov eskirgan" });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        return;
      }
      await ctx.answerCallbackQuery({ text: 'Bog\'lanmoqda...' });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await bindLocationToService(ctx, conv, candidate.id);
      clearSession(ctx);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true }).catch(() => {});
    }
  });

  // Eski (Client kolleksiyasi davridagi) to'lov tasdig'i tugmalari — endi ishlatilmaydi.
  bot.callbackQuery(['payment_confirm_yes', /^payment_client_(.+)$/], async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Bu tugma eskirgan' });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  });

  bot.callbackQuery('payment_confirm_no', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    clearSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
    await ctx.editMessageText("Mayli oka, to’lovni yozmadim.");
  });

  // Bir xil ismli mijozlardan birini tanlash — saqlangan amalni (status/to'lov/tahrir)
  // davom ettiradi. Nomzodlar ({name, phone}) conversation'da, callback faqat indeks.
  bot.callbackQuery(/^pick_client_(\d+)$/, async (ctx) => {
    try {
      const conv = await Conversation.findOne({ telegramId: ctx.from.id });
      const pending = conv?.collected;
      const candidates = Array.isArray(pending?.candidates) ? pending.candidates : [];
      const client = candidates[Number(ctx.match[1])];
      if (!pending?.disambIntent || !client) {
        await ctx.answerCallbackQuery({ text: "Ma'lumot topilmadi", show_alert: true });
        return;
      }
      const intent = pending.disambIntent;
      // Tanlangan mijoz identifikatsiyasi (telefon/ism) bilan amal aniq davom etadi.
      const fields = {
        ...(pending.disambFields || {}),
        targetPhone: client.phone || undefined,
        clientPhone: client.phone || undefined,
        targetClientName: client.name || undefined,
        targetIdentifier: client.phone || client.name,
      };
      await conv.reset();
      await ctx.answerCallbackQuery({ text: `${client.name} tanlandi` });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      const res = await runAgent({
        understanding: { intent, fields, reply: '', confidence: 1 },
        rawText: '',
        conversation: conv,
      });
      await ctx.reply(res.text, res.keyboard ? { reply_markup: res.keyboard } : undefined);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true }).catch(() => {});
    }
  });

  bot.callbackQuery('pick_cancel', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    clearSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
    await ctx.editMessageText('Bekor qilindi.');
  });

  // QAYTGAN MIJOZ taklifi: "Ha, shu ma'lumotlar" / "Yo'q, o'zim aytaman".
  bot.callbackQuery(['ret_use', 'ret_skip'], async (ctx) => {
    try {
      const conv = await Conversation.findOne({ telegramId: ctx.from.id });
      if (conv?.pendingIntent !== 'RETURNING_CONFIRM') {
        await ctx.answerCallbackQuery({ text: "Bu so'rov eskirgan" });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        return;
      }
      const accept = ctx.callbackQuery.data === 'ret_use';
      await ctx.answerCallbackQuery({ text: accept ? "Ma'lumotlar olindi" : 'Mayli, o\'zingiz ayting' });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      const res = await resumeReturningEntry({ conversation: conv, accept });
      syncSessionFromConversation(ctx, conv);
      await sendAgentResult(ctx, res);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true }).catch(() => {});
    }
  });

  // Qarz eslatmasi — "✅ Hal bo'ldi": qarz qaytdi/to'landi, balans tranzaksiyasi bekor qilinadi.
  bot.callbackQuery(/^debt_done_(.+)$/, async (ctx) => {
    try {
      const { reminder, balanceAfter } = await markReminderDone(ctx.match[1]);
      const who = reminder?.person || 'qarz';
      await ctx.answerCallbackQuery({ text: 'Hal bo\'ldi ✅' });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      const line = reminder?.affectsBalance
        ? `\n💰 Balansni tikladim — joriy balans: ${formatMoney(balanceAfter)}`
        : '';
      await ctx.editMessageText(`Zo'r oka, ${who} bilan qarz hal bo'ldi deb belgiladim ✅${line}`).catch(() => {});
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  // Jarima eslatmasi — "✅ To'ladim": summa ma'lum bo'lsa chiqim darhol yoziladi
  // (balansdan ayiriladi); summa noma'lum bo'lsa FINE_AMOUNT holatiga o'tib so'raladi.
  bot.callbackQuery(/^fine_paid_(.+)$/, async (ctx) => {
    try {
      const fine = await getFineById(ctx.match[1]);
      if (!fine) {
        await ctx.answerCallbackQuery({ text: 'Jarima yozuvi topilmadi', show_alert: true });
        return;
      }
      if (fine.transactionId) {
        await ctx.answerCallbackQuery({ text: "Allaqachon to'langan ✅" });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        return;
      }
      if (fine.amount > 0) {
        const paid = await payFine(fine._id, {});
        await ctx.answerCallbackQuery({ text: "To'landi ✅" });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        await ctx.editMessageText(
          `✅ Boldi oka, moshina jarimasi to'landi — ${formatMoney(paid.paidAmount)} chiqimga yozildi.\n💸 Joriy balans: ${formatMoney(paid.balanceAfter)}`
        ).catch(() => {});
        return;
      }
      // Summa oldindan aytilmagan — so'raymiz; javob message.js FINE_AMOUNT orqali keladi.
      await Conversation.updateOne(
        { telegramId: ctx.from.id },
        {
          $set: {
            pendingIntent: 'FINE_AMOUNT',
            collected: { fineId: String(fine._id) },
            awaitingField: 'amount',
          },
        },
        { upsert: true }
      );
      await ctx.answerCallbackQuery({ text: 'Summani ayting' });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.reply("💰 Jarima summasi qancha edi oka? (masalan: 150 ming)");
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true }).catch(() => {});
    }
  });

  // Qarz eslatmasi — "📅 Keyinroq": ertaga shu vaqtda yana eslatadi.
  bot.callbackQuery(/^debt_snooze_(.+)$/, async (ctx) => {
    try {
      const { reminder } = await snoozeReminder(ctx.match[1], 1);
      await ctx.answerCallbackQuery({ text: 'Keyinroq eslataman' });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.editMessageText(`Mayli oka, ${formatDateTime(reminder.remindAt)} da yana eslatib qo'yaman 🔔`).catch(() => {});
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
      await ctx.editMessageText(`Boldi oka, ${name} ma'lumotini yangiladim ✅`);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  bot.callbackQuery('edit_cancel', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    clearSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
    await ctx.editMessageText("Mayli oka, o‘zgartirmadim.");
  });

  // CLARIFY — foydalanuvchi tezkor tugmadan niyatni tanladi. Saqlangan matn/maydonlar
  // bilan tanlangan amalni davom ettiramiz (taxminsiz).
  bot.callbackQuery(/^clarify_(\d+)$/, async (ctx) => {
    try {
      const conv = await Conversation.findOne({ telegramId: ctx.from.id });
      const options = conv?.collected?.options || [];
      const choice = options[Number(ctx.match[1])];
      if (!conv || conv.pendingIntent !== 'CLARIFY' || !choice) {
        await ctx.answerCallbackQuery({ text: 'Tanlov eskirgan', show_alert: true });
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
        return;
      }
      const rawText = conv.collected.rawText || '';
      const fields = conv.collected.fields || {};
      await conv.reset();
      await ctx.answerCallbackQuery({ text: choice.label });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      const res = await runAgent({
        understanding: { intent: choice.subIntent, fields, confidence: 1, reply: '' },
        rawText,
        conversation: conv,
      });
      syncSessionFromConversation(ctx, conv);
      await sendAgentResult(ctx, res);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true }).catch(() => {});
    }
  });

  bot.callbackQuery('clarify_cancel', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    clearSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
    await ctx.editMessageText('Bekor qilindi ✅');
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
      syncSessionFromConversation(ctx, conv);
      await sendAgentResult(ctx, res);
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
    const missing = nextMissing('SERVICE_ENTRY', { location });
    if (conv) {
      conv.pendingIntent = 'SERVICE_ENTRY';
      conv.collected = { location };
      conv.awaitingField = missing;
      conv.markModified('collected');
      await conv.save();
    }
    if (ctx.session) {
      ctx.session.intent = 'SERVICE_ENTRY';
      ctx.session.collectedData = { location };
      ctx.session.pendingField = missing;
      ctx.session.awaitingConfirmation = false;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Manzilni yangi xizmatga oldim oka.");
    await ctx.reply(
      QUESTIONS[missing],
      missing === 'paymentMethod' ? { reply_markup: paymentMethodKeyboard() } : undefined
    );
  });

  bot.callbackQuery('ignore_location', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    clearSession(ctx);
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
    await ctx.editMessageText('Mayli oka, joylashuvni qo\'ydim ✅');
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
}

// Atomar upsert — findOne+create poygasida unique index xatosi chiqmasin.
async function getOrCreateConversation(telegramId) {
  return Conversation.findOneAndUpdate(
    { telegramId },
    { $setOnInsert: { telegramId } },
    { upsert: true, new: true }
  );
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
  if (pending?.address) return normalizeLocationData(pending.address, pending.coordinates || coords);
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
    await ctx.reply(`Manzilni oldim oka: ${location.address}`);
    await sendAgentResult(ctx, res);
    return;
  }

  // Faol kirish oqimi yo'q — endi manzil MAVJUD qatorga bog'lanadi ("qaysi xizmatga?").
  if (ctx.session) {
    ctx.session.intent = 'LOCATION_BIND';
    ctx.session.collectedData = { location };
    ctx.session.pendingLocation = null;
    ctx.session.pendingLocationRename = false;
    ctx.session.pendingLocationCoords = null;
    ctx.session.pendingField = 'bindTarget';
    ctx.session.awaitingConfirmation = false;
  }

  await ctx.reply(`Manzilni oldim oka: ${location.address}`);
  await startLocationBind(ctx, conv, location);
}

async function sendAgentResult(ctx, res) {
  // Post-save xulosa (tugmalari bilan) ustuvor — darhol-saqlash oqimining javobi.
  if (res?.keyboard) {
    if (ctx.session && res.tool === 'create_service' && res.result) {
      ctx.session.lastServiceId = res.result.id || res.result._id || null;
    }
    await ctx.reply(res.text, { reply_markup: res.keyboard });
    return;
  }
  if (res?.tool === 'create_service' && res.result) {
    await ctx.reply(serviceConfirmationText(res.result));
    const info = reminderInfoLine(res.result);
    if (info) await ctx.reply(info);
    if (ctx.session) ctx.session.lastServiceId = res.result.id || res.result._id || null;
    return;
  }
  await ctx.reply(res.text);
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
      // Tugma bosildi — endi "bajarildimi?" matn javobi bu xizmatga qayta tegmaydi.
      lastConfirmServiceId: null,
      lastConfirmAt: null,
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
  await ctx.editMessageText("Qachonga ko'chiramiz oka? Matn yoki ovoz orqali ayting.");
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
