import Settings from '../models/Settings.js';

export async function computeReminders(serviceDateTime, customOffsets = null) {
  const settings = await Settings.getSingleton();
  const offsets = Array.isArray(customOffsets)
    ? customOffsets
    : (settings.defaultReminders || []).map((r) => r.minutesBefore);
  if (offsets.length === 0) offsets.push(1440, 60, 0);

  const target = new Date(serviceDateTime).getTime();
  const nowMs = Date.now();

  const reminders = [];
  for (const rawOffset of offsets) {
    const minutesBefore = Math.max(0, Math.round(Number(rawOffset) || 0));
    const scheduledAt = new Date(target - minutesBefore * 60 * 1000);
    if (scheduledAt.getTime() > nowMs) {
      reminders.push(makeReminder(minutesBefore, scheduledAt));
    }
  }
  reminders.sort((a, b) => a.scheduledAt - b.scheduledAt);
  return reminders;
}

export async function scheduleRemindersForService(service, customMinutes = null) {
  if (service.isHistorical) {
    service.reminders = [];
    return service.reminders;
  }

  const customOffsets = customMinutes === null || customMinutes === undefined
    ? null
    : (Array.isArray(customMinutes) ? customMinutes : [customMinutes]);
  service.reminders = await computeReminders(service.serviceDateTime, customOffsets);
  return service.reminders;
}

export function snoozeReminder(minutes = 30) {
  return makeReminder(minutes, new Date(Date.now() + minutes * 60 * 1000));
}

function makeReminder(minutesBefore, scheduledAt) {
  return {
    minutesBefore,
    scheduledAt,
    sent: false,
    sentAt: null,
    failed: false,
    retryCount: 0,
    nextRetryAt: null,
  };
}
