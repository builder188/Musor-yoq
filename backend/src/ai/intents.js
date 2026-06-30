// Intent taksonomiyasi — yagona manba (bot, API va AI shu yerdan foydalanadi).
//
// Ikki qatlam:
//  - HIGH-LEVEL (foydalanuvchiga ko'rinadigan 3 asosiy niyat + CLARIFY):
//      MOLIYA  — kirim, chiqim, mijoz to'lovi/qarzi
//      MIJOZ   — yangi xizmat, mavjud mijoz/xizmat tahriri, status o'zgarishi
//      SUXBAT  — qidiruv, savol-javob, analitika, oddiy gaplashish
//      CLARIFY — ishonch past yoki 2 niyatga teng mos: taxmin qilmay, so'raymiz
//  - SUB-ACTION (ichki yo'naltirish uchun aniq amal): MongoDB operatsiyalari
//      shu darajada ishlaydi, shuning uchun mavjud agent ijro qatlami buzilmaydi.

export const HIGH_LEVEL_INTENTS = ['MOLIYA', 'MIJOZ', 'SUXBAT', 'CLARIFY'];

export const SUB_INTENTS = [
  // MIJOZ
  'SERVICE_ENTRY',
  'SERVICE_EDIT',
  'CLIENT_EDIT',
  'STATUS_UPDATE',
  // MOLIYA
  'EXPENSE_ENTRY',
  'INCOME_ENTRY',
  'MATERIAL_SALE',
  'ITEM_ENTRY',
  'ITEM_SALE',
  'ITEM_GIVEAWAY',
  'PAYMENT_UPDATE',
  'DEBT_REMINDER',
  // SUXBAT
  'SEARCH_QUERY',
  'ANALYTICS_QUERY',
];

// Sub-action -> high-level niyat.
export const SUB_TO_HIGH = {
  SERVICE_ENTRY: 'MIJOZ',
  SERVICE_EDIT: 'MIJOZ',
  CLIENT_EDIT: 'MIJOZ',
  STATUS_UPDATE: 'MIJOZ',
  EXPENSE_ENTRY: 'MOLIYA',
  INCOME_ENTRY: 'MOLIYA',
  MATERIAL_SALE: 'MOLIYA',
  ITEM_ENTRY: 'MOLIYA',
  ITEM_SALE: 'MOLIYA',
  ITEM_GIVEAWAY: 'MOLIYA',
  PAYMENT_UPDATE: 'MOLIYA',
  DEBT_REMINDER: 'MOLIYA',
  SEARCH_QUERY: 'SUXBAT',
  ANALYTICS_QUERY: 'SUXBAT',
};

// High-level -> mumkin bo'lgan sub-actionlar.
export const HIGH_TO_SUBS = {
  MIJOZ: ['SERVICE_ENTRY', 'SERVICE_EDIT', 'CLIENT_EDIT', 'STATUS_UPDATE'],
  MOLIYA: ['EXPENSE_ENTRY', 'INCOME_ENTRY', 'MATERIAL_SALE', 'ITEM_ENTRY', 'ITEM_SALE', 'ITEM_GIVEAWAY', 'PAYMENT_UPDATE', 'DEBT_REMINDER'],
  SUXBAT: ['SEARCH_QUERY', 'ANALYTICS_QUERY'],
};

// High-level niyat aniq, lekin sub-action berilmagan paytdagi xavfsiz standart amal.
export const HIGH_DEFAULT_SUB = {
  MIJOZ: 'SERVICE_ENTRY',
  MOLIYA: 'EXPENSE_ENTRY',
  SUXBAT: 'SEARCH_QUERY',
};

// Spec: confidence < 0.7 bo'lsa, taxmin qilmay aniqlashtiruvchi savol beramiz.
export const CONFIDENCE_THRESHOLD = 0.7;

// Faqat o'qiydigan (xavfsiz) high-level niyat — past ishonchda ham bemalol bajariladi.
export const READ_ONLY_INTENTS = new Set(['SUXBAT']);

export function isSubIntent(value) {
  return SUB_INTENTS.includes(value);
}

export function isHighLevelIntent(value) {
  return HIGH_LEVEL_INTENTS.includes(value);
}

export function highLevelOf(subIntent) {
  return SUB_TO_HIGH[subIntent] || null;
}

export default {
  HIGH_LEVEL_INTENTS,
  SUB_INTENTS,
  SUB_TO_HIGH,
  HIGH_TO_SUBS,
  HIGH_DEFAULT_SUB,
  CONFIDENCE_THRESHOLD,
  READ_ONLY_INTENTS,
  isSubIntent,
  isHighLevelIntent,
  highLevelOf,
};
