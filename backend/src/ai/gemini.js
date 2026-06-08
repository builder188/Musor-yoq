// Google Gemini API o'rovi (multimodal: matn, audio, rasm).
import { GoogleGenerativeAI } from '@google/generative-ai';
import env from '../config/env.js';
import { buildSystemPrompt, buildAnswerPrompt } from './prompts.js';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

function getModel() {
  return genAI.getGenerativeModel({
    model: env.GEMINI_MODEL,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  });
}

// JSON javobni xavfsiz tahlil qilish (model ba'zan ortiqcha matn qo'shishi mumkin).
function safeParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // JSON blokini ajratib olishga urinish.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeResult(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { intent: 'UNKNOWN', fields: {}, reply: '', confidence: 0 };
  }
  return {
    intent: parsed.intent || 'UNKNOWN',
    fields: parsed.fields || {},
    reply: parsed.reply || '',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
  };
}

// Matnli xabarni tushunish.
export async function understandText(text) {
  const model = getModel();
  const prompt = `${buildSystemPrompt()}\n\n--- FOYDALANUVCHI XABARI ---\n${text}`;
  const res = await model.generateContent(prompt);
  return normalizeResult(safeParseJson(res.response.text()));
}

// Ovozli xabarni tushunish (transkripsiya + ma'no). audioBuffer: Buffer, mime: masalan 'audio/ogg'.
export async function understandAudio(audioBuffer, mime = 'audio/ogg') {
  const model = getModel();
  const res = await model.generateContent([
    { text: `${buildSystemPrompt()}\n\n--- FOYDALANUVCHI OVOZLI XABARI (o'zbekcha) ---\nOvozni eshit, tushun va JSON qaytar.` },
    {
      inlineData: {
        mimeType: mime,
        data: audioBuffer.toString('base64'),
      },
    },
  ]);
  return normalizeResult(safeParseJson(res.response.text()));
}

// Rasmni tushunish (qo'lyozma daftar yozuvlari OCR + ma'no).
export async function understandImage(imageBuffer, mime = 'image/jpeg', caption = '') {
  const model = getModel();
  const parts = [
    { text: `${buildSystemPrompt()}\n\n--- FOYDALANUVCHI RASM YUBORDI (qo'lyozma yozuv bo'lishi mumkin) ---\nRasmdagi matnni o'qib (OCR), ma'lumotni ajratib JSON qaytar.${caption ? `\nIzoh: ${caption}` : ''}` },
    {
      inlineData: {
        mimeType: mime,
        data: imageBuffer.toString('base64'),
      },
    },
  ];
  const res = await model.generateContent(parts);
  return normalizeResult(safeParseJson(res.response.text()));
}

// Qidiruv/analitika natijalarini tabiiy o'zbekcha javobga aylantirish.
export async function answerFromData(question, data) {
  const model = genAI.getGenerativeModel({
    model: env.GEMINI_MODEL,
    generationConfig: { temperature: 0.3 },
  });
  const res = await model.generateContent(buildAnswerPrompt(question, data));
  return res.response.text().trim();
}

export default { understandText, understandAudio, understandImage, answerFromData };
