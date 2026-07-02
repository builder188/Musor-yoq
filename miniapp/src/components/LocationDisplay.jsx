function safeMapUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function coordinatesMapUrl(coordinates) {
  if (!coordinates) return '';
  const lat = Number(coordinates.lat ?? coordinates.latitude);
  const lng = Number(coordinates.lng ?? coordinates.longitude ?? coordinates.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return '';
  return `https://maps.google.com/?q=${lat},${lng}`;
}

function mapUrlForLocation(location) {
  return safeMapUrl(location?.mapUrl) || coordinatesMapUrl(location?.coordinates);
}

export default function LocationDisplay({ location, inline = false }) {
  const address = location?.address || '-';
  const mapUrl = mapUrlForLocation(location);
  const content = mapUrl ? (
    <a className="location-link" href={mapUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      {address}
    </a>
  ) : (
    <span>{address}</span>
  );

  if (inline) return <span className="location-inline">{content}</span>;
  return <div className="location-block">{content}</div>;
}
