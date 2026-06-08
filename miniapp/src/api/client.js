// Backend API bilan ishlash uchun fetch o'rovi.
// Har bir so'rovga Telegram initData sarlavhasini qo'shadi.
import { getInitData } from '../telegram.js';

const BASE = import.meta.env.VITE_API_URL || '';

async function request(method, path, body = null) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': getInitData(),
  };
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE}/api${path}`, options);
  if (!res.ok) {
    let message = `Xatolik (${res.status})`;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      /* json emas */
    }
    throw new Error(message);
  }
  // PDF kabi json bo'lmagan javoblar uchun.
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return res;
  return res.json();
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path, body) => request('DELETE', path, body),
  baseUrl: BASE,
};

// To'g'ridan-to'g'ri PDF yuklab olish uchun URL (initData query bilan).
export function reportUrl() {
  return `${BASE}/api/reports/pdf`;
}

export default api;
