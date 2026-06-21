// Lokatsiyani ko'rsatish: manzil matni + koordinatalar bo'lsa xarita havolalari.
function hasCoords(coordinates) {
  if (!coordinates) return false;
  const { lat, lng } = coordinates;
  return Number.isFinite(lat) && Number.isFinite(lng);
}

export default function LocationDisplay({ location }) {
  const address = location?.address || '-';
  const coordinates = location?.coordinates;

  // Koordinatalar yo'q → faqat matn.
  if (!hasCoords(coordinates)) {
    return <span>📍 {address}</span>;
  }

  // Koordinatalar bor → matn + xarita havolalari.
  const { lat, lng } = coordinates;
  const googleUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const yandexUrl = `https://yandex.uz/maps/?ll=${lng},${lat}&z=17&pt=${lng},${lat}`;

  return (
    <div className="location-block">
      <span>📍 {address}</span>
      <div className="map-links">
        <a href={googleUrl} target="_blank" rel="noreferrer">
          🗺️ Google Maps
        </a>
        <a href={yandexUrl} target="_blank" rel="noreferrer">
          🗺️ Yandex Xarita
        </a>
      </div>
    </div>
  );
}
