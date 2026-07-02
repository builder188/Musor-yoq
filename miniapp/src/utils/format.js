// Frontend formatlash yordamchilari.

const DATE_LOCALES = {
  uz: {
    months: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
    standaloneMonths: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
    weekdays: ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'],
    timePrefix: 'soat ',
  },
  ru: {
    months: [
      '\u044f\u043d\u0432\u0430\u0440\u044f',
      '\u0444\u0435\u0432\u0440\u0430\u043b\u044f',
      '\u043c\u0430\u0440\u0442\u0430',
      '\u0430\u043f\u0440\u0435\u043b\u044f',
      '\u043c\u0430\u044f',
      '\u0438\u044e\u043d\u044f',
      '\u0438\u044e\u043b\u044f',
      '\u0430\u0432\u0433\u0443\u0441\u0442\u0430',
      '\u0441\u0435\u043d\u0442\u044f\u0431\u0440\u044f',
      '\u043e\u043a\u0442\u044f\u0431\u0440\u044f',
      '\u043d\u043e\u044f\u0431\u0440\u044f',
      '\u0434\u0435\u043a\u0430\u0431\u0440\u044f',
    ],
    standaloneMonths: [
      '\u044f\u043d\u0432\u0430\u0440\u044c',
      '\u0444\u0435\u0432\u0440\u0430\u043b\u044c',
      '\u043c\u0430\u0440\u0442',
      '\u0430\u043f\u0440\u0435\u043b\u044c',
      '\u043c\u0430\u0439',
      '\u0438\u044e\u043d\u044c',
      '\u0438\u044e\u043b\u044c',
      '\u0430\u0432\u0433\u0443\u0441\u0442',
      '\u0441\u0435\u043d\u0442\u044f\u0431\u0440\u044c',
      '\u043e\u043a\u0442\u044f\u0431\u0440\u044c',
      '\u043d\u043e\u044f\u0431\u0440\u044c',
      '\u0434\u0435\u043a\u0430\u0431\u0440\u044c',
    ],
    weekdays: [
      '\u0412\u043e\u0441\u043a\u0440\u0435\u0441\u0435\u043d\u044c\u0435',
      '\u041f\u043e\u043d\u0435\u0434\u0435\u043b\u044c\u043d\u0438\u043a',
      '\u0412\u0442\u043e\u0440\u043d\u0438\u043a',
      '\u0421\u0440\u0435\u0434\u0430',
      '\u0427\u0435\u0442\u0432\u0435\u0440\u0433',
      '\u041f\u044f\u0442\u043d\u0438\u0446\u0430',
      '\u0421\u0443\u0431\u0431\u043e\u0442\u0430',
    ],
    timePrefix: '',
  },
};

function localeOf(lang) {
  return DATE_LOCALES[lang === 'ru' ? 'ru' : 'uz'];
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function formatMoney(amount) {
  const n = Math.round(Number(amount) || 0);
  const sign = n < 0 ? '-' : '';
  const s = Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${s} so'm`;
}

export function formatDate(d, lang = 'uz', options = {}) {
  const date = validDate(d);
  if (!date) return '';
  const { includeYear = true } = options;
  const locale = localeOf(lang);
  const month = locale.months[date.getMonth()];
  const base = lang === 'ru' ? `${date.getDate()} ${month}` : `${date.getDate()}-${month}`;
  return includeYear ? `${base} ${date.getFullYear()}` : base;
}

export function formatTime(d) {
  const date = validDate(d);
  if (!date) return '';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatDateTime(d, lang = 'uz', options = {}) {
  const date = validDate(d);
  if (!date) return '';
  const locale = localeOf(lang);
  return `${formatDate(date, lang, options)}, ${locale.timePrefix}${formatTime(date)}`;
}

export function formatWeekdayDate(d, lang = 'uz', options = {}) {
  const date = validDate(d);
  if (!date) return '';
  const locale = localeOf(lang);
  return `${locale.weekdays[date.getDay()]} · ${formatDate(date, lang, options)}`;
}

export function formatMonthYear(d, lang = 'uz') {
  const date = validDate(d);
  if (!date) return '';
  const locale = localeOf(lang);
  return `${(locale.standaloneMonths || locale.months)[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatMonthName(d, lang = 'uz') {
  const date = validDate(d);
  if (!date) return '';
  const locale = localeOf(lang);
  return (locale.standaloneMonths || locale.months)[date.getMonth()];
}

export function formatPhone(phone) {
  if (!phone) return '';
  const m = String(phone).match(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (!m) return phone;
  return `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
}

// datetime-local input uchun (YYYY-MM-DDTHH:mm).
export function toInputDateTime(d) {
  const date = d ? new Date(d) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}
