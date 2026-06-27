// USD -> UZS valyuta kursi xizmati.
// Asosiy manba: O'zbekiston Markaziy Banki (CBU) rasmiy, bepul API (kalit kerak emas).
//   https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/  -> [{ Ccy:'USD', Rate:'12345.67', Nominal:'1', Date:'...' }]
//
// Fallback zanjiri (barqarorlik uchun):
//   1) 12 soatdan yangi kesh bo'lsa — o'shani qaytaramiz (tarmoqqa chiqmaymiz).
//   2) Kesh eski/yo'q bo'lsa — CBU dan so'raymiz (asosiy URL, bo'lmasa CBU "barcha valyuta"
//      zaxira URL'i — bir xil rasmiy manba, ikkinchi endpoint), keshga yozamiz.
//   3) CBU umuman ishlamasa (timeout/xato) — ESKI keshni qaytaramiz (eski bo'lsa ham).
//   4) Kesh ham yo'q + CBU ham ishlamasa — null (chaqiruvchi foydalanuvchidan so'rashga o'tadi).
import ExchangeRate from '../models/ExchangeRate.js';

const CBU_PRIMARY_URL = 'https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/';
const CBU_FALLBACK_URL = 'https://cbu.uz/uz/arkhiv-kursov-valyut/json/'; // barcha valyuta — USD ni filtrlaymiz
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 soat
const FETCH_TIMEOUT_MS = 5000; // 5 soniya
const SINGLETON = 'USD';

async function readCache() {
  return ExchangeRate.findOne({ base: SINGLETON }).lean();
}

async function writeCache(rate, source) {
  await ExchangeRate.findOneAndUpdate(
    { base: SINGLETON },
    { $set: { usdToUzsRate: rate, rateUpdatedAt: new Date(), source } },
    { upsert: true, new: true }
  );
}

// CBU javobidan (massiv yoki bitta obyekt) USD kursini ajratadi. Nominalga bo'lib 1 USD narxini beradi.
// Eksport — sinov uchun (toza yordamchi).
export function parseUsdRate(json) {
  const row = Array.isArray(json)
    ? json.find((r) => r?.Ccy === 'USD') || null
    : (json && json.Ccy === 'USD' ? json : null);
  if (!row || row.Rate == null) return null;
  const rate = Number(String(row.Rate).replace(',', '.'));
  const nominal = Number(String(row.Nominal ?? '1').replace(',', '.')) || 1;
  const perUnit = rate / nominal;
  if (!Number.isFinite(perUnit) || perUnit <= 0) return null;
  return Math.round(perUnit * 100) / 100;
}

async function fetchFromUrl(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`CBU HTTP ${res.status}`);
  const json = await res.json();
  const rate = parseUsdRate(json);
  if (!rate) throw new Error('CBU javobida USD kursi topilmadi');
  return rate;
}

// CBU'dan yangi kurs: asosiy URL, bo'lmasa zaxira URL (ikkalasi ham CBU rasmiy).
async function fetchFreshRate() {
  try {
    return await fetchFromUrl(CBU_PRIMARY_URL);
  } catch (primaryErr) {
    console.warn(`CBU asosiy manba xato (${primaryErr.message}) - zaxira endpoint sinaladi`);
    return fetchFromUrl(CBU_FALLBACK_URL);
  }
}

// Asosiy funksiya: 1 USD necha so'm. Yuqoridagi fallback zanjiri bo'yicha ishlaydi.
// Hech qachon throw QILMAYDI — barqaror raqam yoki null qaytaradi.
export async function getUsdToUzsRate() {
  const cache = await readCache().catch(() => null);
  const cacheFresh = cache?.usdToUzsRate
    && cache?.rateUpdatedAt
    && Date.now() - new Date(cache.rateUpdatedAt).getTime() < CACHE_TTL_MS;
  if (cacheFresh) return cache.usdToUzsRate;

  try {
    const rate = await fetchFreshRate();
    await writeCache(rate, 'cbu.uz').catch((e) => console.error('Kursni keshlash xatosi:', e.message));
    return rate;
  } catch (err) {
    console.warn('Kursni yangilab bo\'lmadi:', err.message);
    // CBU ishlamadi — eski keshni qaytaramiz (hatto 12 soatdan eski bo'lsa ham).
    if (cache?.usdToUzsRate) return cache.usdToUzsRate;
    // Kesh ham yo'q — chaqiruvchi foydalanuvchidan so'rashga o'tadi.
    return null;
  }
}

// Debug/endpoint uchun: kurs + meta (qachon yangilangani, eskimi, manba).
export async function getRateInfo() {
  const rate = await getUsdToUzsRate(); // kerak bo'lsa yangilaydi/keshlaydi
  const cache = await readCache().catch(() => null);
  const updatedAt = cache?.rateUpdatedAt || null;
  return {
    usdToUzsRate: rate,
    rateUpdatedAt: updatedAt,
    stale: !updatedAt || Date.now() - new Date(updatedAt).getTime() >= CACHE_TTL_MS,
    source: cache?.source || 'cbu.uz',
  };
}

export default { getUsdToUzsRate, getRateInfo };
