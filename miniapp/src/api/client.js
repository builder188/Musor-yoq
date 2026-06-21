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
  streamPost: streamPost,
  baseUrl: BASE,
};

async function streamPost(path, body, onEvent) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': getInitData(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Xatolik (${res.status})`);
  if (!res.body) throw new Error('Stream qo\'llab-quvvatlanmaydi');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    chunks.forEach((chunk) => {
      const event = chunk.match(/^event:\s*(.+)$/m)?.[1];
      const data = chunk.match(/^data:\s*(.+)$/m)?.[1];
      if (event && data) onEvent(event, JSON.parse(data));
    });
  }
}

// To'g'ridan-to'g'ri PDF yuklab olish uchun URL (initData query bilan).
export function reportUrl() {
  return `${BASE}/api/reports/pdf`;
}

export default api;
