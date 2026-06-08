// Tozalash cron: har kuni soat 03:00 da 30 kundan oshgan o'chirilgan yozuvlarni butunlay o'chiradi.
import cron from 'node-cron';
import { purgeOld } from '../services/deleteService.js';
import env from '../config/env.js';

export function startCleanupCron() {
  cron.schedule(
    '0 3 * * *',
    async () => {
      try {
        const result = await purgeOld(30);
        const total = result.clients + result.services + result.transactions;
        if (total > 0) {
          console.log('🧹 Tozalash:', result);
        }
      } catch (err) {
        console.error('Cleanup cron xatosi:', err.message);
      }
    },
    { timezone: env.TZ }
  );
  console.log('🧹 Tozalash cron ishga tushdi (har kuni 03:00)');
}
