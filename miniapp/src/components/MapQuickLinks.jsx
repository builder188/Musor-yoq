// "Xarita havolasi" input yonidagi tezkor kirish tugmalari.
// Bosilganda mos xarita saytini YANGI tab'da ochadi (Google / Yandex).
//
// MUHIM: bu tugmalar FAQAT qulaylik uchun — saytni ochib beradi. Joyni tanlab, havolani
// QO'LDA nusxalab, qaytib formaga PASTE qilish foydalanuvchining o'zida qoladi (tashqi
// platformalarda avtomatik "havolani qaytarib olish" mexanizmi yo'q). Buni o'zgartirmang.
const MAP_SITES = [
  { key: 'google', label: 'Google', url: 'https://www.google.com/maps' },
  { key: 'yandex', label: 'Yandex', url: 'https://yandex.uz/maps' },
];

export default function MapQuickLinks() {
  return (
    <div className="map-quick-links">
      {MAP_SITES.map((m) => (
        <button
          key={m.key}
          type="button"
          className="map-quick-btn"
          title={`${m.label} Maps — yangi oynada ochish`}
          aria-label={`${m.label} Maps`}
          onClick={() => window.open(m.url, '_blank', 'noopener,noreferrer')}
        >
          🗺️ {m.label}
        </button>
      ))}
    </div>
  );
}
