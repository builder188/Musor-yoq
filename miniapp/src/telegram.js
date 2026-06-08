// Telegram WebApp SDK bilan ishlash.
// Telegram ichida bo'lsa — haqiqiy initData; brauzerda (dev) — bo'sh.
const tg = window.Telegram?.WebApp;

export function initTelegram() {
  if (tg) {
    tg.ready();
    tg.expand();
    // Asosiy va orqa fon ranglarini moslashtirish.
    try {
      tg.setHeaderColor('secondary_bg_color');
    } catch {
      /* eski versiyalarda yo'q */
    }
  }
  return tg;
}

// API so'rovlari uchun initData.
export function getInitData() {
  return tg?.initData || '';
}

// Telegram mavzu parametrlari (light/dark aniqlash uchun).
export function getColorScheme() {
  return tg?.colorScheme || 'light';
}

// Haptik javob (tugma bosilganda).
export function haptic(type = 'light') {
  try {
    tg?.HapticFeedback?.impactOccurred(type);
  } catch {
    /* qo'llab-quvvatlanmasligi mumkin */
  }
}

// Telegram orqali fayl ochish (PDF).
export function openLink(url) {
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank');
}

export default tg;
