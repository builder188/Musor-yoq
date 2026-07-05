// YOZISH-O'QISH ISHONCHLILIK SINOVI — har bir kiritish turi uchun yozuv MongoDB'ga
// haqiqatan tushganini va qayta o'qilganini tekshiradi (Mini App ko'radigan list/summary
// funksiyalari orqali). Vaqtinchalik in-memory MongoDB ishlatadi — PRODUCTION bazaga TEGMAYDI.
//
// Ishga tushirish:  cd backend && node scripts/write-read-test.mjs
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { runWithUser } from '../src/db/tenantScope.js';
import { createService, completeService, listServices } from '../src/services/serviceService.js';
import { createTransaction, listTransactions, getSummary } from '../src/services/financeService.js';
import { createUsefulItem, sellUsefulItem, giveAwayUsefulItem, listUsefulItems } from '../src/services/usefulItemService.js';
import { createDebtReminder, listReminders, markReminderDone } from '../src/services/reminderEntryService.js';
import { createFine, getFineStats } from '../src/services/fineService.js';
import { getExpenseCategoryRecords, getIncomeCategoryRecords, getMaterialCategoryRecords } from '../src/services/categoryService.js';
import Transaction from '../src/models/Transaction.js';

const USER = '111111111';
const OTHER_USER = '222222222';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function expectThrow(name, fn) {
  try {
    await fn();
    check(name, false, 'xato KUTILGAN edi, lekin muvaffaqiyatli tugadi');
  } catch (err) {
    check(name, true, err.message);
  }
}

const asItems = (v) => (Array.isArray(v) ? v : v?.items || []);

async function main() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('musir-yoq-test'));
  console.log('In-memory MongoDB tayyor.\n');

  await runWithUser(USER, async () => {
    // ── 1. XIZMAT (kelajak) ──────────────────────────────────────────────
    console.log('1) XIZMAT (kelajak reja):');
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const svc = await createService({
      clientName: 'Testchi aka',
      clientPhone: '+998901234567',
      serviceDateTime: future,
      price: 200000,
      location: 'Chilonzor 5',
      paymentMethod: 'naqd',
    });
    check('createService yozdi (id bor)', !!svc?._id);
    const svcList = asItems(await listServices({}));
    check('listServices da ko\'rinadi', svcList.some((s) => String(s._id) === String(svc._id)));
    check('status = kutilmoqda', svcList.find((s) => String(s._id) === String(svc._id))?.status === 'kutilmoqda');
    let sum = await getSummary('all');
    check('kelajak xizmat balansga YOZILMAGAN (daromad hali yo\'q)', sum.income === 0, `income=${sum.income}`);

    // Bajarildi → daromad tushishi kerak.
    await completeService(svc._id, { markPaid: true });
    sum = await getSummary('all');
    check('bajarilgach daromad = 200000', sum.income === 200000, `income=${sum.income}`);

    // ── 2. XIZMAT (tarixiy — "bordim") ───────────────────────────────────
    console.log('2) XIZMAT (tarixiy/bajarilgan):');
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const hist = await createService({
      clientName: 'Sardor aka',
      isHistorical: true,
      price: 150000,
      serviceDateTime: yesterday,
    });
    check('tarixiy xizmat darhol bajarilgan', hist?.status === 'bajarildi', `status=${hist?.status}`);
    const histTx = await Transaction.findOne({ serviceId: hist._id, type: 'income', isDeleted: { $ne: true } });
    check('daromad tranzaksiyasi yozilgan', !!histTx && histTx.amount === 150000);
    check(
      'daromad sanasi = voqea sanasi (kiritilgan kun emas)',
      histTx && Math.abs(new Date(histTx.date) - new Date(yesterday)) < 60000,
      histTx ? `date=${histTx.date}` : ''
    );

    // ── 3. KIRIM (boshqa daromad) ────────────────────────────────────────
    console.log('3) KIRIM:');
    const inc = await createTransaction({ type: 'income', amount: 50000, description: 'test kirim' });
    check('kirim yozildi', !!inc?._id && inc.amount === 50000);
    check('kategoriya = boshqa_kirim', inc.category === 'boshqa_kirim', inc.category);
    let txs = asItems(await listTransactions({ period: 'all' }));
    check('listTransactions da ko\'rinadi', txs.some((t) => String(t._id) === String(inc._id)));

    const rent = await createTransaction({ type: 'income', amount: 1000000, category: 'ijara', description: 'ijaradan tushdi' });
    check('dinamik kirim kategoriyasi yozildi', rent.category === 'Ijara', rent.category);
    const rentRecords = await getIncomeCategoryRecords('Ijara');
    check('kirim kategoriyasi sahifasida o\'qiladi', rentRecords.records.some((r) => r.id === String(rent._id)));

    const rentFromDescription = await createTransaction({ type: 'income', amount: 750000, description: 'ijaradan tushdi' });
    check('izohdan kirim kategoriyasi avtomatik yaratildi', rentFromDescription.category === 'Ijara', rentFromDescription.category);

    // ── 4. CHIQIM (kalit so'zdan toifa) ──────────────────────────────────
    console.log('4) CHIQIM:');
    const exp = await createTransaction({ type: 'expense', amount: 30000, description: 'benzin quydim' });
    check('chiqim yozildi', !!exp?._id && exp.amount === 30000);
    check('toifa avtomatik = yoqilgi', exp.category === 'yoqilgi', exp.category);

    const dump = await createTransaction({ type: 'expense', amount: 50000, description: 'svalkaga ishlatdim' });
    check('svalka oldindan tanilgan toifa', dump.category === 'svalka', dump.category);

    const dumpCategory = await createTransaction({ type: 'expense', amount: 60000, category: 'svalkaga', description: 'svalkaga toladim' });
    check('svalka kelishik bilan ham taniladi', dumpCategory.category === 'svalka', dumpCategory.category);

    const dumpSynonym = await createTransaction({ type: 'expense', amount: 70000, description: 'poligonga toladim' });
    check('poligon xarajati svalka toifasiga tushadi', dumpSynonym.category === 'svalka', dumpSynonym.category);

    const shop = await createTransaction({ type: 'expense', amount: 400000, description: 'magazinga ishlatdim' });
    check('noaniq bo\'lmagan yangi xarajat toifasi yaratiladi', shop.category === 'Magazin', shop.category);

    // ── 5. SHTRAF / MOSHINA JARIMASI ─────────────────────────────────────
    console.log('5) SHTRAF / MOSHINA JARIMASI:');
    const fine = await createTransaction({ type: 'expense', amount: 100000, category: 'shtraf', description: 'YPX jarima' });
    check('shtraf yozildi', !!fine?._id);
    check('shtraf system kategoriya = jarima', fine.category === 'jarima', fine.category);
    const fineRecords = await getExpenseCategoryRecords('Moshina jarimasi');
    check('kategoriya sahifasida o\'qiladi', fineRecords.records.some((r) => r.id === String(fine._id)));

    const fineBefore = (await getSummary('all')).balance;
    const unpaidFine = await createFine({ eventDate: new Date().toISOString() });
    check('summasiz jarima yozuvi saqlandi', unpaidFine?.reminder?.type === 'fine' && unpaidFine.reminder.amount === 0);
    check('summasiz jarimada eslatma yo\'q', !unpaidFine.reminder.dueDate && !unpaidFine.reminder.remindAt);
    check('jarima olinganda balansga tegmadi', (await getSummary('all')).balance === fineBefore);

    const paidFine = await markReminderDone(unpaidFine.reminder._id, { amount: 150000 });
    check('summasiz jarima to\'langanda chiqim yozildi', paidFine?.paidAmount === 150000 && !!paidFine.reminder.transactionId);
    const fineTx = await Transaction.findOne({ _id: paidFine.reminder.transactionId, type: 'expense', isDeleted: { $ne: true } });
    check('jarima to\'lovi category=jarima', fineTx?.category === 'jarima' && fineTx.amount === 150000, fineTx?.category);

    const futureFineDue = new Date(Date.now() + 24 * 3600 * 1000);
    const futureFine = await createFine({ amount: 250000, dueDate: futureFineDue.toISOString() });
    check('kelajakdagi jarimada remindAt aynan dueDate', new Date(futureFine.reminder.remindAt).getTime() === futureFineDue.getTime());
    check('kelajakdagi jarima hali balansga tegmadi', !futureFine.reminder.transactionId);

    const paidNowFine = await createFine({ amount: 120000, paidNow: true });
    check('darhol to\'langan jarima status=done', paidNowFine.reminder.status === 'done' && !!paidNowFine.reminder.transactionId);

    const fineStats = await getFineStats({});
    check('jarima statistikasi sanaydi', fineStats.count >= 3 && fineStats.paidTotal >= 270000, JSON.stringify(fineStats));

    // ── 6. MATERIAL SOTUVI ───────────────────────────────────────────────
    console.log('6) MATERIAL:');
    const mat = await createTransaction({
      type: 'income',
      category: 'material',
      materialName: 'paxta',
      quantityKg: 30,
      pricePerKg: 5000,
      amount: 150000,
    });
    check('material sotuvi yozildi', !!mat?._id && mat.amount === 150000);
    check('nom kanonik (Paxta)', mat.materialName === 'Paxta', mat.materialName);
    const matRecords = await getMaterialCategoryRecords('Paxta');
    check('material kategoriyasida o\'qiladi', matRecords.records.some((r) => r.id === String(mat._id)));

    // ── 7. BUYUM (kiritish / sotish / berish) ────────────────────────────
    console.log('7) BUYUM:');
    const item = await createUsefulItem({ itemName: 'televizor' });
    check('buyum yozildi', !!item?._id);
    let avail = await listUsefulItems({ status: 'available' });
    check('mavjudlar ro\'yxatida', avail.some((i) => String(i._id) === String(item._id)));

    const sale = await sellUsefulItem({ itemName: 'televizor', amount: 400000 });
    check('sotuv tranzaksiyasi yozildi', !!sale?.transaction?._id);
    check('sotuv kategoriyasi = buyum', sale.transaction.category === 'buyum', sale.transaction.category);
    check('buyum holati = sotildi', sale.item?.status === 'sotildi' || sale.item?.status === 'sold', sale.item?.status);

    const item2 = await createUsefulItem({ itemName: 'divan' });
    const give = await giveAwayUsefulItem({ itemName: 'divan', recipient: 'qo\'shni' });
    check('berilgan buyum holati yangilandi', !!give?.item && give.item.status !== 'available' && String(give.item._id) === String(item2._id), give?.item?.status);

    // ── 8. QARZ (eslatma + balans) ───────────────────────────────────────
    console.log('8) QARZ:');
    const before = (await getSummary('all')).balance;
    const debt = await createDebtReminder({
      person: 'Ali',
      amount: 100000,
      direction: 'given',
      dueDate: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    });
    check('qarz eslatmasi yozildi', !!debt?.reminder?._id || !!debt?.reminder?.id || !!debt?._id);
    const after = (await getSummary('all')).balance;
    check('balansdan 100000 ayirildi', before - after === 100000, `before=${before} after=${after}`);
    const remList = await listReminders({ status: 'pending' });
    const remId = (debt.reminder?._id || debt.reminder?.id || debt._id);
    check('eslatmalar ro\'yxatida ko\'rinadi', asItems(remList).some((r) => String(r._id || r.id) === String(remId)));

    // Hal bo'ldi → balans tiklanadi.
    await markReminderDone(remId);
    const restored = (await getSummary('all')).balance;
    check('hal bo\'lgach balans tiklandi', restored === before, `restored=${restored} before=${before}`);

    // ── 9. XATO YO'LLARI (jim saqlanmasin — aniq xato otsin) ─────────────
    console.log('9) XATO YO\'LLARI:');
    await expectThrow('manfiy summa rad etiladi', () =>
      createTransaction({ type: 'expense', amount: -5 })
    );
    await expectThrow('identifikatsiyasiz xizmat rad etiladi', () => createService({}));
    await expectThrow('noto\'g\'ri sana rad etiladi', () =>
      createTransaction({ type: 'income', amount: 1000, date: 'bu-sana-emas' })
    );
  });

  // ── 10. TENANT IZOLYATSIYASI ───────────────────────────────────────────
  console.log('10) TENANT IZOLYATSIYASI:');
  await runWithUser(OTHER_USER, async () => {
    const txs = asItems(await listTransactions({ period: 'all' }));
    check('boshqa foydalanuvchi hech narsa ko\'rmaydi', txs.length === 0, `${txs.length} ta ko'rindi`);
  });
  await expectThrow('kontekstsiz so\'rov fail-closed (xato otadi)', () =>
    listTransactions({ period: 'all' })
  );

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\nNATIJA: ${passed} ta o'tdi, ${failed} ta yiqildi.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Sinov ishga tushmadi:', err);
  process.exit(1);
});
