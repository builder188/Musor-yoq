// Egaga (owner) bot orqali xabar yuborish — Mini App/API amallaridan kelib chiqqan
// hodisalarni Telegram'da ham bildirish uchun. Bot instansi index.js'da ulanadi
// (attachNotifierBot), shu sabab bu modul bot.js'ni statik import qilmaydi (sikl yo'q).
import { ownerIds } from '../config/env.js';

let notifierBot = null;

export function attachNotifierBot(botInstance) {
  notifierBot = botInstance;
}

// Egaga matn yuboradi (bir nechta owner bo'lsa hammasiga). Xatosi chaqiruvchini
// to'xtatmaydi — bildirishnoma asosiy amalga (mas. balansga yozish) bog'liq emas.
export async function notifyOwner(text, extra) {
  if (!notifierBot || !text) return;
  const recipients = ownerIds();
  if (recipients.length === 0) return;
  await Promise.all(
    recipients.map((telegramId) =>
      notifierBot.api.sendMessage(telegramId, text, extra).catch((err) => {
        console.error('notifyOwner xato:', err.message);
      })
    )
  );
}

export default { attachNotifierBot, notifyOwner };
