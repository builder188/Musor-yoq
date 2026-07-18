// Bot oqimlari sinovi (npm run test:bot-flows, in-memory MongoDB — production bazaga TEGMAYDI):
// qaytgan mijoz taklifi (start + slot-filling o'rtasida) va
// lokatsiyani mavjud qatorga bog'lash (nom saqlash, Yandex tugma, nomzod tanlash).
process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'x';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { runWithUser } from '../src/db/tenantScope.js';
import { createService } from '../src/services/serviceService.js';
import Conversation from '../src/models/Conversation.js';
import Service from '../src/models/Service.js';
import { runAgent, resumeReturningEntry } from '../src/ai/agent.js';
import { routeLocationBindAnswer, startLocationBind } from '../src/bot/locationBind.js';

const USER = '111111111';
let passed = 0, failed = 0;
const check = (name, cond, extra='') => { if (cond) { passed++; console.log('  OK', name); } else { failed++; console.error('  FAIL', name, extra); } };

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri('musir-flows-test'));

function fakeCtx() {
  const replies = [];
  return {
    replies,
    from: { id: Number(USER) },
    session: {},
    reply: async (text, opts) => { replies.push({ text, opts }); },
  };
}

await runWithUser(USER, async () => {
  // Oldingi mijoz qatori (arxiv/faol farqi yo'q — istalgan jadval).
  const prior = await createService({
    clientName: 'Sardor aka',
    clientPhone: '+998901234567',
    location: 'Chilonzor 9-kvartal',
    price: 250000,
    isHistorical: true,
    serviceDateTime: new Date(Date.now() - 86400000).toISOString(),
  });
  check('oldingi qator tayyor', prior.status === 'bajarildi');

  // 1) QAYTGAN MIJOZ — birinchi xabarda telefon aytilgan.
  const conv = await Conversation.create({ telegramId: Number(USER) });
  const res1 = await runAgent({
    understanding: { intent: 'MIJOZ', subIntent: 'SERVICE_ENTRY', confidence: 0.95, fields: { clientPhone: '+998901234567' } },
    rawText: "+998901234567 ga ertaga boraman",
    conversation: conv,
    mode: 'bot',
  });
  check('taklif ko\'rsatildi (start)', String(res1.text || '').includes('♻️'), res1.text);
  check('RETURNING_CONFIRM holati', conv.pendingIntent === 'RETURNING_CONFIRM');
  check('taklifda ism bor', String(res1.text).includes('Sardor aka'));
  check('taklifda manzil bor', String(res1.text).includes('Chilonzor 9-kvartal'));

  // "Ha" — yetishmagan maydonlar taklifdan to'ldiriladi, oqim davom etadi.
  const res2 = await resumeReturningEntry({ conversation: conv, accept: true });
  check('tasdiqdan keyin oqim davom etdi', !!res2.text);
  check('ism taklifdan to\'ldirildi', conv.collected?.clientName === 'Sardor aka', JSON.stringify(conv.collected?.clientName));
  check('narx taklifdan to\'ldirildi', conv.collected?.price === 250000 || res2.result?.price === 250000);
  await conv.reset();

  // 2) QAYTGAN MIJOZ — telefon slot-filling O'RTASIDA aytilganda ham ishlaydi.
  const startRes = await runAgent({
    understanding: { intent: 'MIJOZ', subIntent: 'SERVICE_ENTRY', confidence: 0.95, fields: { clientName: 'Yangi odam' } },
    rawText: 'Yangi odamga boraman',
    conversation: conv,
    mode: 'bot',
  });
  check('telefon so\'raldi', conv.pendingIntent === 'SERVICE_ENTRY' && conv.awaitingField === 'clientPhone', `${conv.pendingIntent}/${conv.awaitingField}`);
  const midRes = await runAgent({
    understanding: { intent: 'MIJOZ', subIntent: 'SERVICE_ENTRY', confidence: 0.95, fields: { clientPhone: '+998901234567' } },
    rawText: '+998901234567',
    conversation: conv,
    mode: 'bot',
  });
  check('slot-filling o\'rtasida taklif chiqdi', conv.pendingIntent === 'RETURNING_CONFIRM', conv.pendingIntent + ' / ' + String(midRes.text).slice(0, 60));
  // "Yo'q" — taklifsiz davom (ism foydalanuvchiniki qoladi).
  await resumeReturningEntry({ conversation: conv, accept: false });
  check('rad etilganda ism o\'zgarmadi', conv.collected?.clientName === 'Yangi odam', JSON.stringify(conv.collected?.clientName));
  await conv.reset();

  // 3) LOKATSIYA BOG'LASH: nomzod bitta bo'lsa darhol; manzil NOMI saqlanadi; Yandex tugma.
  const ctx = fakeCtx();
  await startLocationBind(ctx, conv, {
    address: 'Pin avtomatik nom',
    mapUrl: null,
    coordinates: { lat: 41.311, lng: 69.24 },
  });
  check('bog\'lash savoli berildi', ctx.replies.length === 1 && conv.pendingIntent === 'LOCATION_BIND');
  await routeLocationBindAnswer(ctx, conv, 'Sardor aka');
  const boundReply = ctx.replies[ctx.replies.length - 1];
  check('bog\'landi javobi keldi', String(boundReply.text).includes("bog'ladim"), boundReply.text);
  check('javobda URL tugma bor', !!boundReply.opts?.reply_markup, JSON.stringify(boundReply.opts || {}));
  const updated = await Service.findById(prior._id).lean();
  check('mavjud manzil NOMI saqlandi', updated.location.address === 'Chilonzor 9-kvartal', updated.location.address);
  check('Yandex havolasi biriktirildi', String(updated.location.mapUrl || '').includes('yandex.com/maps'), updated.location.mapUrl);
  check('koordinatalar yozildi', updated.location.coordinates?.lat === 41.311);
  check('holat tozalandi', conv.pendingIntent === null);

  // 4) LOKATSIYA BOG'LASH: manzili BO'SH qatorga pin nomi yoziladi + qator raqami bilan.
  const empty = await createService({ clientName: 'Manzilsiz mijoz' });
  const ctx2 = fakeCtx();
  await startLocationBind(ctx2, conv, { address: 'Sergeli 5', mapUrl: null, coordinates: { lat: 41.22, lng: 69.22 } });
  // Bir nechta moslik: "M" harfi ko'p qatorga mos kelmasin — aniq ism bilan.
  await routeLocationBindAnswer(ctx2, conv, 'Manzilsiz mijoz');
  const emptyUpdated = await Service.findById(empty._id).lean();
  check('bo\'sh manzilga pin nomi yozildi', emptyUpdated.location.address === 'Sergeli 5', emptyUpdated.location.address);

  // 5) Ko'p moslik → nomzod tugmalari; matn bilan tanlash ham ishlaydi.
  await createService({ clientName: 'Bek aka', clientPhone: '+998905555555' });
  await createService({ clientName: 'Bek uka', clientPhone: '+998906666666' });
  const ctx3 = fakeCtx();
  await startLocationBind(ctx3, conv, { address: 'Yunusobod 4', mapUrl: null, coordinates: { lat: 41.35, lng: 69.28 } });
  await routeLocationBindAnswer(ctx3, conv, 'Bek');
  check('ko\'p moslikda tanlov so\'raldi', Array.isArray(conv.collected?.bindCandidates) && conv.collected.bindCandidates.length >= 2, JSON.stringify(conv.collected?.bindCandidates || []));
  await routeLocationBindAnswer(ctx3, conv, 'Bek uka');
  const bekUka = await Service.findOne({ clientPhone: '+998906666666' }).lean();
  check('nomzodlardan matn bilan tanlandi', bekUka.location.address === 'Yunusobod 4', bekUka.location.address);
});

await mongoose.disconnect();
await mongod.stop();
console.log(`\nNATIJA: ${passed} OK, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
