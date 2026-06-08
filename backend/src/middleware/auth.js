// Telegram Mini App initData ni tekshirish (HMAC-SHA256).
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
import crypto from 'crypto';
import env, { ownerId } from '../config/env.js';

function validateInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // data_check_string — kalitlar alfavit tartibida.
  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  // Foydalanuvchini ajratib olamiz.
  try {
    const user = JSON.parse(params.get('user') || '{}');
    return user;
  } catch {
    return null;
  }
}

// Express middleware.
export function authMiddleware(req, res, next) {
  // Dev rejimida tekshiruvni o'tkazib yuborish (faqat development uchun).
  if (env.AUTH_DEV_BYPASS) {
    req.telegramUser = { id: ownerId() };
    return next();
  }

  const initData = req.get('X-Telegram-Init-Data') || req.query.initData;
  const user = validateInitData(initData);

  if (!user || !user.id) {
    return res.status(401).json({ error: 'Avtorizatsiya xatosi' });
  }
  if (Number(user.id) !== ownerId()) {
    return res.status(403).json({ error: 'Ruxsat yo\'q' });
  }

  req.telegramUser = user;
  next();
}

export default authMiddleware;
