export const IMAGE_LIMIT = 10;
export const IMAGE_WINDOW_MS = 60_000;
export const IMAGE_BYPASS_MS = 10 * 60_000;

export const VOICE_MAX_DURATION_SECONDS = 90;
export const IMAGE_LIMIT_REPLY =
  "Buncha rasm uchun limit qo'yilgan, oka - 10 tadan kamroq qilib yuboring, xarajatlaringiz ko'payib ketmasligi uchun";
export const IMAGE_LIMIT_BYPASS_REPLY =
  "Bo'ldi oka, 10 daqiqaga limitni ochib qo'ydim. Hammasini yuboring, men ulguraman";
export const VOICE_TOO_LONG_REPLY =
  'Bu ovozli xabar juda uzun ekan oka, 1:30 dan qisqaroq qilib qayta yuboring';
export const VIDEO_UNSUPPORTED_REPLY =
  "Men buni ochmadim oka, chunki uni tushunmayman. Undan ko'ra ovozli xabar yoki rasm tashlasang, menga osonroq bo'ladi";
export const UNSUPPORTED_MEDIA_REPLY =
  "Men bunday narsani qabul qila olmayman oka. Ovozli xabar, matn yoki rasm yuborsang bo'ladi";

const BYPASS_PHRASE = "limitni ochib qo'y";
const imageEventsByUser = new Map();
const imageBypassUntilByUser = new Map();

function userKey(telegramId) {
  return String(telegramId || 'unknown');
}

function recentImageEvents(telegramId, now) {
  const key = userKey(telegramId);
  const cutoff = now - IMAGE_WINDOW_MS;
  const recent = (imageEventsByUser.get(key) || []).filter((timestamp) => timestamp > cutoff);
  imageEventsByUser.set(key, recent);
  return recent;
}

export function hasImageLimitBypassPhrase(text) {
  return String(text || '').toLocaleLowerCase('uz').includes(BYPASS_PHRASE);
}

export function enableImageLimitBypass(telegramId, now = Date.now()) {
  const until = now + IMAGE_BYPASS_MS;
  imageBypassUntilByUser.set(userKey(telegramId), until);
  return until;
}

export function isImageLimitBypassed(telegramId, now = Date.now()) {
  const key = userKey(telegramId);
  const until = imageBypassUntilByUser.get(key);
  if (!until) return false;
  if (until <= now) {
    imageBypassUntilByUser.delete(key);
    return false;
  }
  return true;
}

export function reserveImageSlots(telegramId, count = 1, now = Date.now()) {
  if (count <= 0) return { allowed: true, bypassed: false, remaining: IMAGE_LIMIT };
  if (isImageLimitBypassed(telegramId, now)) {
    return { allowed: true, bypassed: true, remaining: Infinity };
  }
  if (count > IMAGE_LIMIT) {
    return { allowed: false, reason: 'too_many_images' };
  }

  const recent = recentImageEvents(telegramId, now);
  if (recent.length + count > IMAGE_LIMIT) {
    const oldest = recent[0] || now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + IMAGE_WINDOW_MS - now) / 1000));
    return { allowed: false, reason: 'rate_limit', retryAfterSeconds };
  }

  recent.push(...Array.from({ length: count }, () => now));
  imageEventsByUser.set(userKey(telegramId), recent);
  return {
    allowed: true,
    bypassed: false,
    remaining: IMAGE_LIMIT - recent.length,
  };
}

export function imageLimitReply(retryAfterSeconds) {
  if (!retryAfterSeconds) return IMAGE_LIMIT_REPLY;
  return `${IMAGE_LIMIT_REPLY}\n${retryAfterSeconds} soniyadan keyin yana urinib ko'rishingiz mumkin`;
}

export function resetMediaLimitState() {
  imageEventsByUser.clear();
  imageBypassUntilByUser.clear();
}
