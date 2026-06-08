// i18n yordamchisi: tilni tanlash va kalit bo'yicha tarjima.
// Tarjima topilmasa — o'zbekchaga (asosiy til) qaytadi.
import uz from './uz.js';
import ru from './ru.js';

const DICTS = { uz, ru };

// "nav.home" kabi nuqtali kalitni obyektdan oladi.
function lookup(dict, key) {
  return key.split('.').reduce((obj, part) => (obj ? obj[part] : undefined), dict);
}

// Joriy til uchun t() funksiyasini qaytaradi.
export function makeT(lang = 'uz') {
  const dict = DICTS[lang] || uz;
  return (key) => {
    const value = lookup(dict, key);
    if (value !== undefined && value !== null) return value;
    // Asosiy tilga qaytish.
    const fallback = lookup(uz, key);
    return fallback !== undefined ? fallback : key;
  };
}

export const LANGUAGES = [
  { code: 'uz', label: "O'zbek" },
  { code: 'ru', label: 'Русский' },
];

export default makeT;
