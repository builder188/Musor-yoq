// YOZISH-O'QISH ISHONCHLILIK SINOVI — har bir kiritish turi uchun yozuv MongoDB'ga
// haqiqatan tushganini va qayta o'qilganini tekshiradi (Mini App ko'radigan list/summary
// funksiyalari orqali). Vaqtinchalik in-memory MongoDB ishlatadi — PRODUCTION bazaga TEGMAYDI.
//
// Ishga tushirish:  cd backend && node scripts/write-read-test.mjs
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { runWithUser } from '../src/db/tenantScope.js';
import {
  createService,
  completeService,
  listServices,
  setServiceStatus,
  markServiceNotDone,
  updateClientInfo,
  recordServicePayment,
  attachLocationToService,
} from '../src/services/serviceService.js';
import { upsertPartnerContract, findPartnerByName } from '../src/services/partnerService.js';
import { searchServices, findClientsByName, findServicesByIdentifier } from '../src/services/searchService.js';
import {
  listSheets,
  createSheet,
  renameSheet,
  maybeArchiveFullSheet,
  findServiceByRowNumber,
  SHEET_ROW_LIMIT,
} from '../src/services/sheetService.js';
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

    // ── 8.5 BAJARILMADI HOLATI (yangi) ───────────────────────────────────
    console.log('8.5) BAJARILMADI HOLATI:');
    const nd = await createService({
      clientName: 'Notdone aka',
      clientPhone: '+998907777777',
      serviceDateTime: new Date(Date.now() + 3600 * 1000).toISOString(),
      price: 90000,
    });
    const balBeforeNd = (await getSummary('all')).balance;
    const ndMarked = await markServiceNotDone(nd._id, 'mashina buzildi');
    check('bajarilmadi deb belgilandi', ndMarked.status === 'bajarilmadi', ndMarked.status);
    check('bajarilmadi balansga tegmadi', (await getSummary('all')).balance === balBeforeNd);
    // Bajarilgan xizmat bajarilmadiga o'tsa — daromad QAYTARILADI.
    const ndDone = await setServiceStatus(nd._id, 'bajarildi');
    check('bajarilmadi -> bajarildi (daromad yozildi)', ndDone.status === 'bajarildi');
    const balAfterDone = (await getSummary('all')).balance;
    check('daromad 90000 tushdi', balAfterDone === balBeforeNd + 90000, `bal=${balAfterDone}`);
    await setServiceStatus(nd._id, 'bajarilmadi');
    check('bajarildi -> bajarilmadi (daromad qaytdi)', (await getSummary('all')).balance === balBeforeNd);
    // Qayta rejalash: kutilmoqdaga qaytarish ham ishlaydi.
    const ndReopen = await setServiceStatus(nd._id, 'kutilmoqda');
    check('bajarilmadi -> kutilmoqda (qayta reja)', ndReopen.status === 'kutilmoqda');

    // ── 8.6 HAMKOR STANDARTLARI — ENG OXIRGI QATORDAN ────────────────────
    console.log('8.6) HAMKOR (eng oxirgi qatordan):');
    const contract = await upsertPartnerContract({
      clientName: 'Salat sex',
      price: 300000,
      location: 'Chilonzor 5-kvartal',
    });
    check('shartnoma qatori yaratildi (isPartner)', contract.service?.isPartner === true);
    const partnerProfile = await findPartnerByName('Salat sexga');
    check('hamkor ism qo\'shimchasi bilan topiladi', partnerProfile?.name === 'Salat sex');
    check('standart narx eng oxirgi qatordan', partnerProfile?.partnerPrice === 300000, String(partnerProfile?.partnerPrice));
    // Tashrif: narx/manzil aytilmagan — standartdan meros oladi.
    const visit = await createService({ clientName: 'Salat sex', isHistorical: true, serviceDateTime: new Date().toISOString() });
    check('tashrif narxni meros oldi', visit.price === 300000, String(visit.price));
    check('tashrif manzilni meros oldi', visit.location?.address === 'Chilonzor 5-kvartal', visit.location?.address);
    check('tashrif qatori ham hamkor', visit.isPartner === true);
    // Yangi narxli tashrif — endi u ENG OXIRGI qator, standart o'z-o'zidan yangilanadi.
    await createService({ clientName: 'Salat sex', isHistorical: true, price: 350000, serviceDateTime: new Date().toISOString() });
    const updatedProfile = await findPartnerByName('Salat sex');
    check('standart narx yangi tashrifdan yangilandi', updatedProfile?.partnerPrice === 350000, String(updatedProfile?.partnerPrice));

    // ── 8.7 MIJOZ FUNKSIYALARI — JADVAL ICHIDA ───────────────────────────
    console.log('8.7) MIJOZ FUNKSIYALARI (jadval ichida):');
    const dupA = await createService({ clientName: 'Bahrom', clientPhone: '+998901111111' });
    await createService({ clientName: 'Bahrom', clientPhone: '+998902222222' });
    const sameName = await findClientsByName('Bahrom');
    check('bir xil ismli 2 mijoz farqlanadi (telefon bo\'yicha)', sameName.length === 2, String(sameName.length));
    const renamed = await updateClientInfo({ phone: '+998901111111' }, { name: 'Bahrom aka' });
    check('mijoz ismi barcha qatorlarida yangilandi', renamed.updatedRows >= 1 && renamed.name === 'Bahrom aka');
    // Qidiruv faqat xizmatlar ichida: summa bo'yicha ham.
    const byAmount = await searchServices({ text: '350000' });
    check('summa bo\'yicha qidiruv ishlaydi', byAmount.some((s) => s.price === 350000));
    const byName = await searchServices({ text: 'Bahrom aka' });
    check('ism bo\'yicha qidiruv ishlaydi', byName.some((s) => String(s._id) === String(dupA._id)));
    // To'lov identifikatsiya (telefon) bo'yicha yoziladi.
    await completeService(dupA._id, { newPrice: 120000, markPaid: false });
    const pay = await recordServicePayment({ phone: '+998901111111', amount: 120000 });
    check('to\'lov telefon bo\'yicha yozildi', pay.amountApplied === 120000 && pay.service.paymentStatus === 'tolangan');

    // ── 8.8 KO'P-JADVAL (SHEETS) + LOKATSIYA BOG'LASH ────────────────────
    console.log("8.8) KO'P-JADVAL (SHEETS):");
    const svcSheets = await listSheets('services');
    check('services faol jadvali bor', svcSheets.some((s) => s.status === 'active'));
    const allSvc = asItems(await listServices({}));
    check('barcha xizmat qatorlari sheetId olgan', allSvc.every((s) => !!s.sheetId));

    // 30 qator to'lganda avto-arxiv (chiqim scope'ida sinaymiz).
    for (let i = 0; i < SHEET_ROW_LIMIT + 2; i += 1) {
      await createTransaction({ type: 'expense', amount: 1000 + i, description: `sheet-test-${i}` });
    }
    await maybeArchiveFullSheet('expense');
    const expSheets = await listSheets('expense');
    check(
      "chiqim jadvali to'lganda arxivlandi (30 qator)",
      expSheets.some((s) => s.status === 'archived' && s.rowCount >= SHEET_ROW_LIMIT),
      JSON.stringify(expSheets.map((s) => [s.status, s.rowCount]))
    );
    const activeExp = expSheets.find((s) => s.status === 'active');
    check("yangi bo'sh(roq) faol jadval ochildi", activeExp && activeExp.rowCount < SHEET_ROW_LIMIT, String(activeExp?.rowCount));

    // QIDIRUV/HISOBOT CHEGARASIZ: sheet filtrisiz — barcha jadvallar birga.
    const crossSheet = await searchServices({ text: 'Salat sex' });
    check('qidiruv barcha jadvallarni qamraydi', crossSheet.length >= 1);
    const txAll = asItems(await listTransactions({ period: 'all', limit: 200 }));
    check('tranzaksiyalar ro\'yxati barcha jadvallardan', txAll.filter((t) => String(t.description || '').startsWith('sheet-test-')).length === SHEET_ROW_LIMIT + 2);

    // Yangi jadval qo'shish (nom bilan) va nomlash.
    const createdSheet = await createSheet('services', 'Mening jadvalim');
    check('yangi jadval yaratildi va faol', createdSheet.status === 'active' && createdSheet.name === 'Mening jadvalim');
    const renamedSheet = await renameSheet(createdSheet._id, 'Jadval X');
    check("jadval nomi o'zgardi", renamedSheet.name === 'Jadval X');
    const svcSheets2 = await listSheets('services');
    check("faol jadval bitta (eskisi arxivda)", svcSheets2.filter((s) => s.status === 'active').length === 1);

    // Qator raqami bo'yicha topish (faol jadvalda 1-qator) + lokatsiyani qatorga bog'lash.
    const rowSvc = await createService({ clientName: 'Row Test', clientPhone: '+998903333333' });
    const byRow = await findServiceByRowNumber(1);
    check('faol jadvalda 1-qator topildi', byRow && String(byRow._id) === String(rowSvc._id));
    const idCandidates = await findServicesByIdentifier('Row Test');
    check('identifikator bo\'yicha nomzod topiladi', idCandidates.some((s) => String(s._id) === String(rowSvc._id)));

    const boundEmpty = await attachLocationToService(rowSvc._id, {
      address: 'Pin nomi',
      mapUrl: 'https://yandex.com/maps/?pt=69.2,41.3&z=17&l=map',
      coordinates: { lat: 41.3, lng: 69.2 },
    });
    check("manzili bo'sh qatorga pin nomi yozildi", boundEmpty.location.address === 'Pin nomi' && !!boundEmpty.location.mapUrl);
    const boundKept = await attachLocationToService(visit._id, {
      address: 'Pin boshqa nom',
      mapUrl: 'https://yandex.com/maps/?pt=69.1,41.2&z=17&l=map',
      coordinates: { lat: 41.2, lng: 69.1 },
    });
    check(
      'mavjud manzil NOMI saqlanib qoldi (tugma havolasi yangilandi)',
      boundKept.location.address === 'Chilonzor 5-kvartal' && boundKept.location.mapUrl?.includes('yandex'),
      boundKept.location.address
    );

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
