import { useApp } from '../store/AppContext.jsx';

function safeMapUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

export default function LocationDisplay({ location }) {
  const { t } = useApp();
  const address = location?.address || '-';
  const mapUrl = safeMapUrl(location?.mapUrl);

  return (
    <div className="location-block">
      <span>{address}</span>
      {mapUrl && (
        <div className="map-links">
          <a href={mapUrl} target="_blank" rel="noreferrer">
            {t('common.openMap')}
          </a>
        </div>
      )}
    </div>
  );
}
