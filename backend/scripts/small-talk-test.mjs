// SMALL-TALK GUARD + MINI APP BILDIRISHNOMA SINOVI — tarmoqsiz/DB'siz, sof funksiyalar.
// (1) Sof suhbat (salom/rahmat/xayr, lotin va kirill) HAR DOIM suhbat deb aniqlanadi,
//     biznes ma'lumotli gap esa HECH QACHON suhbat deb yutilmaydi.
// (2) Mini App yozuv xabarlari faqat kiritilgan/o'zgargan maydonlarni ko'rsatadi.
//
// Ishga tushirish:  cd backend && node scripts/small-talk-test.mjs
import { isPureSmallTalk, pureSmallTalkCategory, smallTalkReply } from '../src/ai/smallTalk.js';
import {
  buildMiniAppCreatedMessage,
  buildMiniAppUpdatedMessage,
  buildMiniAppDeletedMessage,
  buildMiniAppBulkDeleteMessage,
} from '../src/services/miniAppNotifyService.js';

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

// ── 1. Sof suhbat — suhbat DEB ANIQLANISHI SHART ──────────────────────────────
console.log('1) Sof suhbat (lotin + kirill) => small talk:');
const PURE = [
  ['salom', 'greeting'],
  ['Salom!', 'greeting'],
  ['assalomu alaykum', 'greeting'],
  ['Assalomu alaykum, qalaysiz?', 'howareyou'],
  ['ishlar qalay', 'howareyou'],
  ['yaxshimisiz', 'howareyou'],
  ['rahmat oka', 'thanks'],
  ['ok rahmat', 'thanks'],
  ['katta rahmat', 'thanks'],
  ['xayr', 'bye'],
  ["ko'rishguncha", 'bye'],
  ["zo'r", 'ack'],
  ['mayli', 'ack'],
  ['салом', 'greeting'],
  ['Салом!', 'greeting'],
  ['ассалому алайкум', 'greeting'],
  ['салом, ишлар қалай?', 'howareyou'],
  ['яхшимисиз', 'howareyou'],
  ['рахмат ока', 'thanks'],
  ['раҳмат', 'thanks'],
  ['хайр', 'bye'],
  ['зўр', 'ack'],
];
for (const [text, cat] of PURE) {
  const got = pureSmallTalkCategory(text);
  check(`"${text}" => ${cat}`, got === cat, `olindi: ${got}`);
  const reply = smallTalkReply(text);
  check(`"${text}" iliq javob qaytaradi`, Boolean(reply?.text) && reply?.tool === 'small_talk');
}

// ── 2. Biznes ma'lumotli gap — suhbat EMAS (Gemini hal qiladi) ────────────────
console.log("\n2) Biznes/amal gaplari => suhbat EMAS:");
const NOT_PURE = [
  'salom, menda televizor bor', // buyum kiritish — yutilmasin (bor guard)
  'salom, Akmalga bordim', // tarixiy xizmat
  'salom mijozlar royxati', // qidiruv
  'bu oyda qancha topdim', // analitika
  'Sardor 300 ming berdi', // to'lov (raqam bor)
  'televizor sotaman', // sotuv (sot stem)
  'Akmal kim', // qidiruv (kim guard)
  'salom, ertaga boraman', // reja
  'benzinga pul ketdi', // xarajat
  'салом, Акмалга бордим', // kirill xizmat
  'қанча топдим', // kirill analitika
  'салом, менда телевизор бор', // kirill buyum (бор guard)
  'шартнома туздик', // kirill hamkorlik
  'salom qalaysiz bugun ishlar juda yaxshi ketyapti menimcha', // 6+ so'z
];
for (const text of NOT_PURE) {
  check(`"${text}"`, !isPureSmallTalk(text), `xato: ${pureSmallTalkCategory(text)} deb yutildi`);
}

// ── 3. Mini App bildirishnomalari — faqat kiritilgan/o'zgargan maydonlar ─────
console.log('\n3) Mini App bildirishnoma formatlash:');

// CREATE: faqat foydalanuvchi kiritgan maydonlar chiqadi.
const createdMsg = buildMiniAppCreatedMessage(
  'service',
  {
    clientName: 'Sardor aka',
    price: 400000,
    paidAmount: 0,
    status: 'kutilmoqda',
    paymentStatus: 'tolanmagan',
  },
  { input: { clientName: 'Sardor aka', price: 400000 } }
);
check("service create: sarlavha \"yangi xizmat qo'shildi\"", /yangi xizmat qo'shildi/.test(createdMsg));
check('service create: kiritilgan maydonlar bor (Mijoz, Narx)', /Mijoz: Sardor aka/.test(createdMsg) && /Narx/.test(createdMsg));
check('service create: kiritilmagan maydonlar YO\'Q (holat/to\'lov)', !/Holat/.test(createdMsg) && !/To'lov holati/.test(createdMsg));

// UPDATE: faqat o'zgargan maydon chiqadi.
const updatedMsg = buildMiniAppUpdatedMessage(
  'service',
  { clientName: 'Sardor aka', price: 400000, location: { address: 'Chilonzor' } },
  { clientName: 'Sardor aka', price: 500000, location: { address: 'Chilonzor' } }
);
check("service update: \"o'zgartirildi\" + faqat narx", /o'zgartirildi/.test(updatedMsg) && /Narx/.test(updatedMsg));
check('service update: o\'zgarmagan maydonlar YO\'Q (Manzil)', !/Manzil/.test(updatedMsg));

// UPDATE hech narsa o'zgarmasa — xabar YO'Q (spam bo'lmasin).
const noChange = buildMiniAppUpdatedMessage(
  'client',
  { name: 'Akmal', phone: '+998901112233' },
  { name: 'Akmal', phone: '+998901112233' }
);
check("update o'zgarishsiz: xabar yuborilmaydi", noChange === '');

// DELETE: nomi bilan qisqa xabar.
const deletedMsg = buildMiniAppDeletedMessage('item', { name: 'Televizor', status: 'available' });
check("item delete: \"o'chirildi\" + nomi", /o'chirildi/.test(deletedMsg) && /Televizor/.test(deletedMsg));

// Tranzaksiya turi labelga to'g'ri o'giriladi.
const txMsg = buildMiniAppCreatedMessage(
  'transaction',
  { type: 'expense', category: 'benzin', amount: 80000 },
  { input: { type: 'expense', category: 'benzin', amount: 80000 } }
);
check('transaction create: chiqim + kategoriya + summa', /chiqim/.test(txMsg) && /benzin/.test(txMsg) && /80/.test(txMsg));

// BULK DELETE: sonlar bilan.
const bulkMsg = buildMiniAppBulkDeleteMessage('finance', { transactions: 12 });
check("bulk delete: o'chirilgan soni ko'rinadi", /12 ta/.test(bulkMsg));

console.log(`\nNatija: ${passed} ✅ / ${failed} ❌`);
if (failed > 0) process.exit(1);
