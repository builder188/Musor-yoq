// MongoDB connection (Mongoose).
import mongoose from 'mongoose';
import env from '../config/env.js';
import Client from '../models/Client.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);

  // Hodisalarni connect'dan OLDIN ulaymiz — erta uzilish/xato ham loglanadi.
  // Mongoose 8 (MongoDB drayveri) uzilganda avtomatik qayta ulanadi; bizga faqat
  // uni KO'RINADIGAN qilish kerak edi — avval 'reconnected' tinglovchi yo'q edi,
  // shuning uchun "MongoDB uzildi" dan keyin jimlik bo'lib qolardi.
  const conn = mongoose.connection;
  conn.on('connected', () => console.log('MongoDB ulandi'));
  conn.on('reconnected', () => console.log('MongoDB qayta ulandi ✅'));
  conn.on('error', (err) => console.error('MongoDB xatosi:', err.message));
  conn.on('disconnected', () =>
    console.warn('MongoDB uzildi - drayver avtomatik qayta ulanishga urinmoqda...')
  );

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  await ensureIndexes();
}

// Eski oddiy `phone_1` unique indexni partial unique index bilan almashtiradi.
// syncIndexes schema'dagi indekslarni DB bilan moslaydi (mos kelmaganini qayta quradi).
async function ensureIndexes() {
  try {
    await Client.syncIndexes();
  } catch (err) {
    console.error('Index sinxronizatsiyasi xatosi:', err.message);
  }
}

export default connectDB;
