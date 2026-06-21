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

// Telegram themeParams -> bizning CSS o'zgaruvchilarimizga moslash.
// Faqat strukturaviy ranglar; brend ranglari (primary/danger) o'zgarmaydi.
const THEME_VAR_MAP = {
  '--bg': ['bg_color'],
  '--card': ['secondary_bg_color', 'section_bg_color', 'bg_color'],
  '--text': ['text_color'],
  '--text-muted': ['hint_color', 'subtitle_text_color'],
  '--border': ['section_separator_color', 'hint_color'],
  '--blue': ['link_color', 'button_color'],
};

export function applyTelegramTheme() {
  const params = tg?.themeParams;
  const root = document.documentElement;
  if (!params || Object.keys(params).length === 0) {
    clearTelegramTheme();
    return false;
  }
  Object.entries(THEME_VAR_MAP).forEach(([cssVar, keys]) => {
    const key = keys.find((k) => params[k]);
    if (key) root.style.setProperty(cssVar, params[key]);
  });
  return true;
}

// Inline override'larni olib tashlaymiz — stylesheet palitrasiga qaytadi.
export function clearTelegramTheme() {
  const root = document.documentElement;
  Object.keys(THEME_VAR_MAP).forEach((cssVar) => root.style.removeProperty(cssVar));
}

// Telegram mavzusi o'zgarganda chaqiriladi; tozalash funksiyasini qaytaradi.
export function onThemeChanged(cb) {
  if (!tg?.onEvent) return () => {};
  tg.onEvent('themeChanged', cb);
  return () => tg.offEvent?.('themeChanged', cb);
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
