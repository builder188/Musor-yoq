// MULTI-TENANT IZOLYATSIYA — yagona manba (eng muhim xavfsizlik qatlami).
//
// Har bir ruxsat berilgan Telegram foydalanuvchi BUTUNLAY alohida ma'lumotlar
// to'plamiga ega. Buni qo'lda har bir so'rovga `telegramUserId` qo'shib emas (bitta
// joyni unutsa — boshqa odamning ma'lumoti ko'rinib qoladi), balki ikki qatlam bilan
// ta'minlaymiz:
//   1) AsyncLocalStorage — joriy so'rovning "tenant konteksti" (kim / global).
//   2) Mongoose plugin — scoped modellarning HAR BIR query/aggregate/save'iga
//      avtomatik telegramUserId filtrini qo'shadi.
//
// FAIL-CLOSED: kontekst umuman o'rnatilmagan bo'lsa plugin XATO tashlaydi. Ya'ni
// "filtrlanmagan global so'rov" tasodifan ishlab ketmaydi — uni ATAYLAB `runGlobal`
// bilan yozish kerak (cron, migratsiya, startup tiklash). Shu sabab birorta joyni
// "unutib" ma'lumot sizib chiqishi MUMKIN EMAS — eng yomoni xato bo'ladi, sizish emas.
import { AsyncLocalStorage } from 'async_hooks';

const storage = new AsyncLocalStorage();

// Bitta foydalanuvchiga scope qilingan blok (bot update / API so'rovi).
export function runWithUser(userId, fn) {
  const id = String(userId ?? '').trim();
  if (!id) throw new Error('runWithUser: telegramUserId bo\'sh');
  return storage.run({ userId: id }, fn);
}

// ATAYLAB butun bazaga tegadigan blok (cron, migratsiya, startup tiklash).
export function runGlobal(fn) {
  return storage.run({ global: true }, fn);
}

export function currentStore() {
  return storage.getStore() || null;
}

// Joriy foydalanuvchi IDsi (scoped blok ichida). Global yoki kontekstsiz — null.
export function currentUserId() {
  const store = storage.getStore();
  return store && store.userId ? store.userId : null;
}

// Filtr/yozuv qiladigan query va aggregate operatsiyalari (Mongoose middleware nomlari).
const QUERY_OPS = [
  'count',
  'countDocuments',
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'distinct',
];

function requireStore(kind) {
  const store = storage.getStore();
  if (!store) {
    // Bu — dasturchi xatosi: scoped modelga kontekstsiz murojaat. Loud fail.
    throw new Error(
      `Tenant konteksti yo'q (${kind}). So'rovni runWithUser(userId, ...) yoki runGlobal(...) ichida bajaring.`
    );
  }
  return store;
}

// Scoped modellarga (Client/Service/Transaction/DebtPayment) qo'llanadigan plugin.
// Conversation/Settings/bot_sessions — BU PLUGINSIZ (ular o'z kaliti bilan ishlaydi).
export function tenantScopePlugin(schema) {
  schema.add({ telegramUserId: { type: String, required: true, index: true } });

  // O'qish/yangilash/o'chirish: filtrlarga telegramUserId qo'shamiz.
  schema.pre(QUERY_OPS, function applyTenantScope() {
    const store = requireStore('query');
    if (store.global) return; // ataylab butun baza
    this.where({ telegramUserId: store.userId });
  });

  // Aggregatsiya: quvur boshiga $match qo'yamiz.
  schema.pre('aggregate', function applyTenantAggregateScope() {
    const store = requireStore('aggregate');
    if (store.global) return;
    this.pipeline().unshift({ $match: { telegramUserId: store.userId } });
  });

  // Yaratish/saqlash: telegramUserId yo'q bo'lsa kontekstdan yozamiz.
  // Aniq berilgan qiymat (mas. tiklash/repair) ustun — uni buzmaymiz.
  //
  // MUHIM: stamping `pre('validate')` da bo'lishi SHART. Mongoose 8 validatsiyani
  // (jumladan `required` tekshiruvini) pre('save') hooklardan OLDIN ishlatadi. Agar
  // faqat pre('save') da yozsak, telegramUserni aniq bermagan create'lar (mas.
  // Client.create / Transaction.create) "Path `telegramUserId` is required" xatosi
  // beradi — chunki required tekshiruvi stamping'dan oldin o'tadi. global + qiymat yo'q
  // bo'lsa — required validatsiya xatosi (global create egasini ataylab belgilashi shart,
  // mas. repair income tranzaksiyasi).
  function stampTenant(doc, kind) {
    if (doc.telegramUserId) return;
    const store = requireStore(kind);
    if (store.userId) doc.telegramUserId = store.userId;
  }

  schema.pre('validate', function stampTenantOnValidate() {
    stampTenant(this, 'validate');
  });

  // Backstop: `save({ validateBeforeSave: false })` bilan saqlansa pre('validate')
  // ishlamaydi — shu sabab save'da ham yozamiz (idempotent: yuqorida yozilgan bo'lsa skip).
  schema.pre('save', function stampTenantOnSave(next) {
    stampTenant(this, 'save');
    next();
  });

  schema.pre('insertMany', function stampTenantOnInsertMany(next, docs) {
    const store = requireStore('insertMany');
    if (store.userId && Array.isArray(docs)) {
      for (const doc of docs) {
        if (doc && !doc.telegramUserId) doc.telegramUserId = store.userId;
      }
    }
    next();
  });
}

export default tenantScopePlugin;
