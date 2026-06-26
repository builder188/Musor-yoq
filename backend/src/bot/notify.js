// Egaga (owner) bot orqali xabar yuborish — Mini App/API amallaridan kelib chiqqan
// hodisalarni Telegram'da ham bildirish uchun. Bot instansi index.js'da ulanadi
// (attachNotifierBot), shu sabab bu modul bot.js'ni statik import qilmaydi (sikl yo'q).
import { currentUserId } from '../db/tenantScope.js';

let notifierBot = null;

export function attachNotifierBot(botInstance) {
  notifierBot = botInstance;
}

// MUHIM (multi-tenant): xabar FAQAT amalni bajargan joriy foydalanuvchiga yuboriladi
// (AsyncLocalStorage'dan), HAMMA egaga (ownerIds) EMAS — aks holda boshqa foydalanuvchilar
// mijoz nomi/summasini ko'rib qolardi. Aniq oluvchi kerak bo'lsa explicitTelegramId beriladi.
// Xatosi chaqiruvchini to'xtatmaydi — bildirishnoma asosiy amalga bog'liq emas (fire-and-forget).
export async function notifyOwner(text, { explicitTelegramId = null, ...extra } = {}) {
  if (!notifierBot || !text) return;
  const target = String(explicitTelegramId || currentUserId() || '').trim();
  if (!target) {
    console.warn('notifyOwner: joriy foydalanuvchi konteksti yo\'q, xabar yuborilmadi');
    return;
  }
  await notifierBot.api.sendMessage(target, text, extra).catch((err) => {
    console.error('notifyOwner xato:', err.message);
  });
}

export default { attachNotifierBot, notifyOwner };
