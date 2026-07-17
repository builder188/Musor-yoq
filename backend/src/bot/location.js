const COORD_PRECISION = 5;

export function encodeCoords(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return `${latitude.toFixed(COORD_PRECISION)},${longitude.toFixed(COORD_PRECISION)}`;
}

export function decodeCoords(value) {
  const [latRaw, lngRaw] = String(value || '').split(',');
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function sameCoords(a, b) {
  if (!a || !b) return false;
  const aLat = Number(a.lat);
  const aLng = Number(a.lng);
  const bLat = Number(b.lat);
  const bLng = Number(b.lng);
  if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return false;
  return Math.abs(aLat - bLat) < 0.00002 && Math.abs(aLng - bLng) < 0.00002;
}

// Yandex Maps havolasi — pin biriktirilgan qatorlarda manzil TUGMA bo'lib shu havolani ochadi.
export function yandexMapsUrl(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return `https://yandex.com/maps/?pt=${longitude.toFixed(6)},${latitude.toFixed(6)}&z=17&l=map`;
}

export function normalizeLocationData(address, coords) {
  const cleanAddress = String(address || '').trim() || 'Lokatsiya (xaritada)';
  const lat = Number(coords?.lat);
  const lng = Number(coords?.lng);
  return {
    address: cleanAddress,
    mapUrl: null,
    // Koordinata yaroqsiz bo'lsa NaN obyekt saqlamaymiz — null (manzil matni qoladi).
    coordinates: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
  };
}

export async function reverseGeocode(lat, lng) {
  const fallback = `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('accept-language', 'uz');
    url.searchParams.set('zoom', '18');
    const res = await fetch(url, {
      // Nominatim siyosati aniq User-Agent talab qiladi.
      headers: { 'User-Agent': 'MusirYoq-Bot/1.0 (musir-yoq telegram bot)' },
      // Botni osib qo'ymaslik uchun cheklangan kutish vaqti.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const data = await res.json();
    return formatUzbekAddress(data, fallback);
  } catch (err) {
    // Nominatim ishlamasa — koordinatalarni matn sifatida qaytaramiz (xizmat saqlanaversin).
    console.warn('Reverse geocode xatosi:', err.message);
    return fallback;
  }
}

// Nominatim javobidan o'zbek manzili uchun qulay, qisqa matn yig'adi.
function formatUzbekAddress(data, fallback) {
  const a = data?.address || {};
  const parts = [];
  if (a.road) parts.push(a.road);
  if (a.neighbourhood && a.neighbourhood !== a.road) parts.push(a.neighbourhood);
  if (a.suburb) parts.push(a.suburb);
  const district = a.district || a.city_district || a.county;
  if (district) parts.push(district);
  const city = a.city || a.town || a.village || a.state;
  if (city && city !== district) parts.push(city);

  if (parts.length > 0) return parts.join(', ');
  if (data?.display_name) return data.display_name.split(',').slice(0, 3).join(',').trim();
  return fallback;
}
