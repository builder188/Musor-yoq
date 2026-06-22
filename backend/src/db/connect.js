// MongoDB connection (Mongoose).
import mongoose from 'mongoose';
import env from '../config/env.js';
import Client from '../models/Client.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  console.log('MongoDB ulandi');

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB xatosi:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB uzildi');
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
