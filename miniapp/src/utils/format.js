// Frontend formatlash yordamchilari.

export function formatMoney(amount) {
  const n = Math.round(Number(amount) || 0);
  const sign = n < 0 ? '-' : '';
  const s = Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${s} so'm`;
}

export function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return new Intl.DateTimeFormat('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(d) {
  if (!d) return '';
  const date = new Date(d);
  return new Intl.DateTimeFormat('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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
