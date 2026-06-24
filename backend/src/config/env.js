// Central environment loader and validator.
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    return null;
  }
  return value.trim();
}

function optional(...names) {
  for (const name of names) {
    const value = required(name);
    if (value) return value;
  }
  return null;
}

function mongoUriFromParts() {
  const host = optional('MONGOHOST', 'MONGO_HOST', 'MONGODB_HOST');
  if (!host) return null;

  const port = optional('MONGOPORT', 'MONGO_PORT', 'MONGODB_PORT') || '27017';
  const database = optional('MONGODATABASE', 'MONGO_DATABASE', 'MONGODB_DATABASE', 'MONGO_DB') || 'musiryoq';
  const user = optional('MONGOUSER', 'MONGO_USER', 'MONGODB_USER', 'MONGODB_USERNAME');
  const password = optional('MONGOPASSWORD', 'MONGO_PASSWORD', 'MONGODB_PASSWORD');
  const auth = user && password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@` : '';

  return `mongodb://${auth}${host}:${port}/${database}`;
}

function firstMongoUri() {
  const aliases = [
    'MONGODB_URI',
    'MONGO_URL',
    'MONGO_PRIVATE_URL',
    'MONGO_PUBLIC_URL',
    'MONGODB_URL',
    'MONGODB_PRIVATE_URL',
    'MONGODB_PUBLIC_URL',
    'DATABASE_URL',
  ];
  for (const name of aliases) {
    const value = required(name);
    if (value && /^mongodb(\+srv)?:\/\//i.test(value)) {
      return value;
    }
  }
  return mongoUriFromParts();
}

function publicDomain() {
  const value = optional('RAILWAY_STATIC_URL', 'RAILWAY_PUBLIC_DOMAIN', 'RAILWAY_PUBLIC_URL', 'PUBLIC_URL', 'APP_URL');
  if (!value) return '';
  return value.replace(/^https?:\/\//i, '').replace(/\/+$/g, '');
}

function isRailwayRuntime() {
  return Boolean(optional('RAILWAY_ENVIRONMENT', 'RAILWAY_SERVICE_NAME', 'RAILWAY_PROJECT_ID', 'RAILWAY_DEPLOYMENT_ID'));
}

function requestedBotMode() {
  return process.env.BOT_MODE?.trim().toLowerCase() || '';
}

function parseTelegramIds(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// Google to'xtatgan (retired) modellar generateContent'da 404 beradi. Eski qiymat
// (masalan Railway Variables'da qolib ketgan) avtomatik amaldagi modelga moslanadi,
// shunda deploy kalit to'g'ri bo'lsa ham eski model nomi tufayli sinmaydi.
// Standart model: gemini-2.5-flash — flash-lite'ga qaraganda aqilliroq va tabiiy javob
// beradi. Tezlik AI quvuridagi ortiqcha chaqiruvlarni qisqartirish bilan ta'minlanadi
// (agent.js: har amalda 1-2 keraksiz Gemini chaqiruvi olib tashlandi), shu sabab
// kuchliroq modelga o'tsak ham umumiy javob tezroq bo'ladi.
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const RETIRED_MODEL_MAP = {
  'gemini-2.0-flash': DEFAULT_GEMINI_MODEL,
  'gemini-2.0-flash-001': DEFAULT_GEMINI_MODEL,
  'gemini-1.5-flash': DEFAULT_GEMINI_MODEL,
  'gemini-1.5-flash-latest': DEFAULT_GEMINI_MODEL,
  'gemini-1.5-flash-8b': DEFAULT_GEMINI_MODEL,
  'gemini-1.5-pro': 'gemini-2.5-pro',
  'gemini-1.5-pro-latest': 'gemini-2.5-pro',
};
let geminiModelNote = '';
function resolveGeminiModel() {
  const requested = process.env.GEMINI_MODEL?.trim();
  if (!requested) return DEFAULT_GEMINI_MODEL;
  const mapped = RETIRED_MODEL_MAP[requested];
  if (mapped) {
    geminiModelNote = `GEMINI_MODEL="${requested}" endi ishlamaydi (Google uni to'xtatgan), "${mapped}" ishlatilmoqda. Railway Variables'da GEMINI_MODEL ni "${mapped}" ga yangilang.`;
    return mapped;
  }
  return requested;
}

function botMode() {
  const explicit = requestedBotMode();
  if (explicit === 'polling' && isRailwayRuntime() && publicDomain()) {
    return 'webhook';
  }
  if (explicit) return explicit;
  if (((process.env.NODE_ENV?.trim() || 'development') === 'production' || isRailwayRuntime()) && publicDomain()) {
    return 'webhook';
  }
  return 'polling';
}

const env = {
  BOT_TOKEN: required('BOT_TOKEN'),
  OWNER_TELEGRAM_ID: required('OWNER_TELEGRAM_ID'),
  MONGODB_URI: firstMongoUri(),
  GEMINI_API_KEY: required('GEMINI_API_KEY'),
  GEMINI_MODEL: resolveGeminiModel(),

  NODE_ENV: process.env.NODE_ENV?.trim() || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  TZ: process.env.TZ?.trim() || 'Asia/Tashkent',

  BOT_MODE: botMode(),
  RAILWAY_STATIC_URL: publicDomain(),
  MINIAPP_URL: process.env.MINIAPP_URL?.trim() || '',

  CONFIRM_DELETE_CODE: process.env.CONFIRM_DELETE_CODE?.trim() || '1990',
  AUTH_DEV_BYPASS: process.env.AUTH_DEV_BYPASS?.trim() === '1',
};

// Keep node-cron and Date calculations in the configured timezone.
process.env.TZ = env.TZ;

export function getEnvIssues() {
  const missing = [];
  for (const key of ['BOT_TOKEN', 'OWNER_TELEGRAM_ID', 'MONGODB_URI', 'GEMINI_API_KEY']) {
    if (!env[key]) missing.push(key);
  }

  const errors = [];
  const warnings = [];

  if (missing.length > 0) {
    errors.push(`Majburiy muhit o'zgaruvchilari topilmadi: ${missing.join(', ')}`);
    if (missing.includes('MONGODB_URI')) {
      errors.push('MongoDB uchun MONGODB_URI, MONGO_URL, MONGO_PRIVATE_URL, MONGO_PUBLIC_URL yoki mongodb:// bilan boshlanadigan DATABASE_URL qabul qilinadi.');
      errors.push('Agar Railway Mongo faqat bo\'lak qiymatlar bersa, MONGOUSER, MONGOPASSWORD, MONGOHOST, MONGOPORT, MONGODATABASE ham qabul qilinadi.');
    }
  }

  if (!['polling', 'webhook'].includes(env.BOT_MODE)) {
    errors.push(`BOT_MODE faqat polling yoki webhook bo'lishi mumkin. Hozir: ${env.BOT_MODE}`);
  }
  if (env.BOT_TOKEN && !/^\d+:[A-Za-z0-9_-]{30,}$/.test(env.BOT_TOKEN)) {
    errors.push('BOT_TOKEN formati noto\'g\'ri. @BotFather bergan haqiqiy tokenni kiriting.');
  }
  const telegramIds = parseTelegramIds(env.OWNER_TELEGRAM_ID);
  if (env.OWNER_TELEGRAM_ID && (telegramIds.length === 0 || telegramIds.some((id) => !/^\d+$/.test(id)))) {
    errors.push('OWNER_TELEGRAM_ID faqat raqamli Telegram IDlardan iborat bo\'lishi kerak. Bir nechta ID bo\'lsa vergul bilan yozing: 6028715926,606578823');
  }
  if (env.MONGODB_URI && !/^mongodb(\+srv)?:\/\//i.test(env.MONGODB_URI)) {
    errors.push('MONGODB_URI mongodb:// yoki mongodb+srv:// bilan boshlanishi kerak.');
  }
  if (env.GEMINI_API_KEY && /Example|ReplaceMe/i.test(env.GEMINI_API_KEY)) {
    errors.push('GEMINI_API_KEY namunaviy qiymatga o\'xshaydi. Google AI Studio bergan haqiqiy keyni kiriting.');
  }
  // Google AI Studio (Gemini) kaliti ikki formatda bo'ladi: eski "AIza..." va yangi "AQ....".
  // Bularga mos kelmasa (masalan "PAQ." kabi) — API "API key not valid" qaytaradi.
  if (env.GEMINI_API_KEY && !/^(AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_.-]{20,})$/.test(env.GEMINI_API_KEY)) {
    warnings.push("GEMINI_API_KEY Google AI Studio formatiga o'xshamaydi (odatda 'AIza' yoki 'AQ.' bilan boshlanadi). Noto'g'ri kalit bo'lsa AI 'API key not valid' xatosi beradi. To'g'ri kalitni https://aistudio.google.com/apikey dan oling.");
  }
  if (geminiModelNote) {
    warnings.push(geminiModelNote);
  }
  if (env.BOT_MODE === 'webhook' && !env.RAILWAY_STATIC_URL) {
    errors.push('BOT_MODE=webhook bo\'lsa, RAILWAY_STATIC_URL yoki RAILWAY_PUBLIC_DOMAIN kerak.');
  }
  if (requestedBotMode() === 'polling' && isRailwayRuntime() && env.RAILWAY_STATIC_URL) {
    warnings.push('Railway muhitida BOT_MODE=polling webhookga almashtirildi, chunki polling bir nechta instance bilan 409 conflict beradi.');
  }
  if (env.NODE_ENV === 'production' && env.BOT_MODE === 'polling') {
    warnings.push('Production uchun BOT_MODE=webhook tavsiya qilinadi.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateEnv() {
  const issues = getEnvIssues();
  if (issues.ok) return true;

  console.error('\nXATO: Konfiguratsiya tayyor emas:');
  for (const error of issues.errors) console.error(`   - ${error}`);
  for (const warning of issues.warnings) console.warn(`   - ${warning}`);
  console.error('\nbackend/.env.example faylidan nusxa olib, .env ni to\'ldiring yoki Railway Variables bo\'limida qiymatlarni kiriting.\n');
  process.exit(1);
}

export const isProd = () => env.NODE_ENV === 'production';
export const ownerIds = () => parseTelegramIds(env.OWNER_TELEGRAM_ID);
export const ownerId = () => Number(ownerIds()[0] || 0);
export const isOwnerTelegramId = (telegramId) => ownerIds().includes(String(telegramId || '').trim());

// Mini App manzili: aniq MINIAPP_URL bo'lsa o'shani, bo'lmasa Railway public
// domenini ishlatadi (backend Mini App'ni shu domen ildizida static beradi).
// Telegram web_app tugmasi faqat HTTPS qabul qiladi.
export function miniAppUrl() {
  if (env.MINIAPP_URL) return env.MINIAPP_URL.replace(/\/+$/g, '');
  if (env.RAILWAY_STATIC_URL) return `https://${env.RAILWAY_STATIC_URL}`;
  return '';
}

export default env;
