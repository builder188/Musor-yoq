export function isLikelyMapUrl(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();

    const isGoogleMaps =
      host === 'maps.google.com' ||
      ((host === 'google.com' || host.endsWith('.google.com')) && path.startsWith('/maps'));
    const isGoogleShort = host === 'maps.app.goo.gl';
    const isYandexHost = host === 'yandex.com' || /^(.+\.)?yandex\.[a-z.]+$/.test(host);
    const isYandexMaps = isYandexHost && (path.startsWith('/maps') || host.startsWith('maps.'));

    return isGoogleMaps || isGoogleShort || isYandexMaps;
  } catch {
    return false;
  }
}

export function shouldWarnMapUrl(value) {
  return String(value || '').trim().length > 0 && !isLikelyMapUrl(value);
}
