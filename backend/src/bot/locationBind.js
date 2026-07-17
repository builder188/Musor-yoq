// LOKATSIYANI MAVJUD QATORGA BOG'LASH — umumiy mantiq (matn/ovoz javobi message.js'da,
// tugmalar callbacks.js'da; ikkalasi ham shu funksiyalarni chaqiradi).
//
// Oqim: pin faol kirish jarayonining qismi bo'lmasa, bot "Bu manzil qaysi xizmatga
// tegishli?" deb so'raydi. Javob — ism/telefon/qator raqami/istalgan identifikator.
// Bir nechta moslik — tugmali tanlov. Bog'langanda: qatordagi mavjud manzil NOMI
// saqlanadi (bo'lmasa pin'dan olingan nom), Yandex Maps havolasi TUGMA sifatida biriktiriladi.
import { attachLocationToService } from '../services/serviceService.js';
import { findServicesByIdentifier } from '../services/searchService.js';
import { findServiceByRowNumber } from '../services/sheetService.js';
import { yandexMapsUrl } from './location.js';
import { matchClarifyOption } from './answers.js';
import { nextMissing, QUESTIONS } from './flow.js';
import {
  LOCATION_BIND_QUESTION,
  locationBindKeyboard,
  locationBindPickKeyboard,
  locationBindCandidateLabel,
  locationBoundText,
  locationBoundKeyboard,
  paymentMethodKeyboard,
} from './ui.js';

// Bog'lash holatini boshlaydi: savol + [🆕 Yangi xizmat][Bekor] tugmalari.
export async function startLocationBind(ctx, conv, location) {
  conv.pendingIntent = 'LOCATION_BIND';
  conv.collected = { location };
  conv.awaitingField = 'bindTarget';
  conv.markModified('collected');
  await conv.save();
  await ctx.reply(LOCATION_BIND_QUESTION, { reply_markup: locationBindKeyboard() });
}

// Tanlangan xizmatga biriktiradi va yakuniy javobni (manzil-nomli Yandex tugmasi bilan) yuboradi.
export async function bindLocationToService(ctx, conv, serviceId) {
  const location = conv.collected?.location;
  const coords = location?.coordinates;
  const mapUrl = coords ? yandexMapsUrl(coords.lat, coords.lng) : null;
  const service = await attachLocationToService(serviceId, {
    address: location?.address || '',
    mapUrl,
    coordinates: coords || null,
  });
  await conv.reset();
  const keyboard = locationBoundKeyboard(service);
  await ctx.reply(locationBoundText(service), keyboard ? { reply_markup: keyboard } : undefined);
  return service;
}

// "🆕 Yangi xizmat" — eski oqim: lokatsiya bilan yangi SERVICE_ENTRY boshlanadi.
export async function startServiceFromBindLocation(ctx, conv) {
  const location = conv.collected?.location;
  if (!location) {
    await conv.reset();
    await ctx.reply("Lokatsiyani topolmadim oka, qayta yuboring.");
    return;
  }
  const missing = nextMissing('SERVICE_ENTRY', { location });
  conv.pendingIntent = 'SERVICE_ENTRY';
  conv.collected = { location };
  conv.awaitingField = missing;
  conv.markModified('collected');
  await conv.save();
  if (ctx.session) {
    ctx.session.intent = 'SERVICE_ENTRY';
    ctx.session.collectedData = { location };
    ctx.session.pendingField = missing;
    ctx.session.awaitingConfirmation = false;
  }
  await ctx.reply("Manzilni yangi xizmatga oldim oka.");
  await ctx.reply(
    QUESTIONS[missing],
    missing === 'paymentMethod' ? { reply_markup: paymentMethodKeyboard() } : undefined
  );
}

// Matn/ovoz javobini hal qiladi: "yangi" / qator raqami / ism / telefon / manzil bo'lagi.
// true — holat hal bo'ldi (yoki savol qayta berildi); false — lokatsiya yo'q (holat tashlandi).
export async function routeLocationBindAnswer(ctx, conv, text) {
  const location = conv.collected?.location;
  if (!location) {
    await conv.reset();
    await ctx.reply("Lokatsiyani topolmadim oka, pin'ni qayta yuboring.");
    return true;
  }
  const clean = String(text || '').trim();

  // "Yangi (xizmat)" — mavjud qatorga emas, yangi yozuvga.
  if (/^(yangi|🆕)/i.test(clean)) {
    await startServiceFromBindLocation(ctx, conv);
    return true;
  }

  // Avvalgi savoldan qolgan nomzodlar orasidan tanlash (raqam yoki nom bilan).
  const stored = Array.isArray(conv.collected?.bindCandidates) ? conv.collected.bindCandidates : [];
  if (stored.length) {
    const match = matchClarifyOption(clean, stored.map((c, i) => ({ label: c.label, idx: i })));
    if (match) {
      await bindLocationToService(ctx, conv, stored[match.idx].id);
      return true;
    }
  }

  // Qator raqami ("3", "3-qator") — FAOL Xizmatlar jadvalidagi tartib (createdAt bo'yicha).
  const ordinal = clean.match(/^(\d{1,3})(\s*[-–]?\s*(qator|qatorga|qatordagi|raqam).*)?$/i);
  if (ordinal) {
    const row = await findServiceByRowNumber(Number(ordinal[1]));
    if (!row) {
      await ctx.reply(
        `Faol jadvalda ${ordinal[1]}-qator topilmadi oka. Ism yoki telefon bilan ayting, yoki "yangi" deng.`,
        { reply_markup: locationBindKeyboard() }
      );
      return true;
    }
    await bindLocationToService(ctx, conv, String(row._id));
    return true;
  }

  // Erkin identifikator: ism / telefon / manzil bo'lagi (mavjud moslashuvchan qidiruv).
  const candidates = await findServicesByIdentifier(clean);
  if (!candidates.length) {
    await ctx.reply(
      "Bunaqa xizmatni topolmadim oka. Ism, telefon yoki qator raqamini aniqroq ayting — yoki \"yangi\" deng.",
      { reply_markup: locationBindKeyboard() }
    );
    return true;
  }
  if (candidates.length === 1) {
    await bindLocationToService(ctx, conv, String(candidates[0]._id));
    return true;
  }

  // Bir nechta moslik — tugmali aniqlashtirish (nomzodlar conversation'da saqlanadi).
  const bindCandidates = candidates.map((s) => ({ id: String(s._id), label: locationBindCandidateLabel(s) }));
  conv.collected = { ...conv.collected, bindCandidates };
  conv.markModified('collected');
  await conv.save();
  await ctx.reply('Oka, bir nechta mos xizmat bor ekan. Qaysi biri?', {
    reply_markup: locationBindPickKeyboard(bindCandidates),
  });
  return true;
}

export default { startLocationBind, bindLocationToService, startServiceFromBindLocation, routeLocationBindAnswer };
