// Mijozlar sahifasi — umumiy jadval (spreadsheet) ko'rinishi.
// Katak tahrirlari PUT /clients/:id orqali (telefon validatsiyasi, hamkor qoidalari
// backendda), yangi qator POST /clients, o'chirish 1990-kod bilan. Tafsilot (xizmatlar
// tarixi) ℹ️ orqali ochiladi.
import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatPhone, formatDateTime, formatMonthName } from '../utils/format.js';
import { shouldWarnMapUrl } from '../utils/mapUrl.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import ServiceDetailModal from '../components/ServiceDetailModal.jsx';
import LocationDisplay from '../components/LocationDisplay.jsx';
import MapQuickLinks from '../components/MapQuickLinks.jsx';
import SheetTable from '../components/SheetTable.jsx';
import LoadError from '../components/LoadError.jsx';

export default function Clients({ focusClientId, openAddClient, onAddClientHandled, onFocusHandled }) {
  const { t, lang } = useApp();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [draftSignal, setDraftSignal] = useState(0);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setClients(normalizeClients(await api.get('/clients')));
      setLoadError(false);
    } catch {
      // Xato = bo'sh ro'yxat EMAS — banner ko'rsatamiz (yozuvlar bazada turibdi).
      setLoadError(true);
      setClients([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bosh sahifadan kelgan mijozni avtomatik ochamiz.
  useEffect(() => {
    if (!focusClientId) return;
    openDetail(focusClientId);
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusClientId]);

  // Bosh sahifadagi "Yangi mijoz" — jadval oxirida bo'sh qator ochadi (forma yo'q).
  useEffect(() => {
    if (!openAddClient) return;
    setDraftSignal((n) => n + 1);
    onAddClientHandled?.();
  }, [openAddClient, onAddClientHandled]);

  const putClient = (row, body) => api.put(`/clients/${row._id}`, body);
  const loc0 = (row) => row.locations?.[0] || null;

  const columns = [
    {
      key: 'name',
      title: t('common.name'),
      width: 140,
      type: 'text',
      get: (r) => r.name || '',
      text: (r) => r.name || '',
      apply: (r, v) => {
        if (!v.trim()) return null; // ism bo'sh bo'lolmaydi — jim o'tkazamiz
        return putClient(r, { name: v });
      },
    },
    {
      key: 'phone',
      title: t('common.phone'),
      width: 140,
      type: 'text',
      get: (r) => r.phone || '',
      text: (r) => (r.phone ? formatPhone(r.phone) : ''),
      // Bo'sh telefon hamkorda ruxsat, oddiy mijozda backend aniq xato beradi.
      apply: (r, v) => putClient(r, { phone: v }),
    },
    {
      key: 'location',
      title: t('common.location'),
      width: 170,
      type: 'text',
      get: (r) => loc0(r)?.address || '',
      text: (r) => loc0(r)?.address || '',
      apply: (r, v) =>
        putClient(r, {
          location: { address: v, mapUrl: loc0(r)?.mapUrl || '', coordinates: loc0(r)?.coordinates || null },
        }),
    },
    {
      key: 'mapUrl',
      title: t('common.mapUrl'),
      width: 130,
      type: 'text',
      get: (r) => loc0(r)?.mapUrl || '',
      text: (r) => loc0(r)?.mapUrl || '',
      apply: (r, v) =>
        putClient(r, {
          location: { address: loc0(r)?.address || '', mapUrl: v, coordinates: loc0(r)?.coordinates || null },
        }),
    },
    {
      key: 'isPartner',
      title: t('clients.partner'),
      width: 110,
      type: 'select',
      options: [
        { value: 'false', label: t('common.no') },
        { value: 'true', label: t('common.yes') },
      ],
      get: (r) => (r.isPartner ? 'true' : 'false'),
      text: (r) => (r.isPartner ? `🤝 ${t('common.yes')}` : t('common.no')),
      apply: (r, v) => putClient(r, { isPartner: v === 'true' }),
    },
    {
      key: 'partnerPrice',
      title: t('clients.standardPrice'),
      width: 130,
      type: 'number',
      editable: (r) => !!r.isPartner,
      get: (r) => (r.partnerPrice > 0 ? r.partnerPrice : ''),
      text: (r) => (r.isPartner && r.partnerPrice > 0 ? formatMoney(r.partnerPrice) : ''),
      apply: (r, v) => {
        if (v === '' || v === null) return null;
        return putClient(r, { partnerPrice: Number(v) || 0 });
      },
    },
    {
      key: 'createdAt',
      title: t('common.createdAt'),
      width: 150,
      type: 'text',
      draft: false,
      get: (r) => r.createdAt || '',
      text: (r) => (r.createdAt ? formatDateTime(r.createdAt, lang) : ''),
      // read-only: apply yo'q
    },
  ];

  // Yangi qator: hamkorda ism yetarli, oddiy mijozda ism + telefon (backend qoidasi).
  const draft = {
    defaults: { isPartner: 'false' },
    canSave: (v) => {
      const name = String(v.name || '').trim();
      if (v.isPartner === 'true') return !!name;
      return !!name && !!String(v.phone || '').trim();
    },
    save: async (v) => {
      const isPartner = v.isPartner === 'true';
      const payload = { name: v.name, phone: v.phone || '', isPartner };
      const location = v.location ? { address: v.location, mapUrl: v.mapUrl || '' } : null;
      if (isPartner) {
        payload.partnerPrice = Number(v.partnerPrice) || 0;
        if (location) payload.partnerLocation = location;
      } else if (location) {
        payload.location = location;
      }
      await api.post('/clients', payload);
    },
  };

  return (
    <div>
      {loadError && <LoadError onRetry={() => load()} />}
      <h1 className="page-title">{t('clients.title')}</h1>

      {loading ? (
        <Spinner />
      ) : (
        <SheetTable
          id="clients"
          columns={columns}
          rows={clients}
          rowKey={(r) => r._id}
          onChanged={() => load(true)}
          draft={draft}
          draftSignal={draftSignal}
          onDelete={setDeleting}
          actions={(row) => (
            <button type="button" aria-label={t('services.detail')} onClick={() => openDetail(row._id)}>
              ℹ️
            </button>
          )}
          emptyText={t('clients.noClients')}
          t={t}
        />
      )}

      {detail && (
        <ClientDetailModal
          client={detail}
          onClose={() => setDetail(null)}
          onEdit={() => setEditing(detail)}
          onDelete={() => setDeleting(detail)}
          onOpenService={setSelectedService}
        />
      )}

      {editing && (
        <EditClientModal
          client={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setEditing(null);
            setDetail((d) => (d ? { ...d, ...updated } : d));
            load(true);
          }}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          title={t('common.delete')}
          message={deleting.name}
          onClose={() => setDeleting(null)}
          onConfirm={async (code) => {
            await api.del(`/clients/${deleting._id}`, { confirmationCode: code });
            setDeleting(null);
            setDetail(null);
            load(true);
          }}
        />
      )}

      {selectedService && <ServiceDetailModal service={selectedService} onClose={() => setSelectedService(null)} />}
    </div>
  );

  async function openDetail(id) {
    try {
      setDetail(await api.get(`/clients/${id}`));
    } catch {
      /* ignore */
    }
  }
}

function ClientDetailModal({ client, onClose, onEdit, onDelete, onOpenService }) {
  const { t, lang } = useApp();
  const monthName = formatMonthName(new Date(), lang);
  return (
    <Modal title={client.isPartner ? `🤝 ${client.name}` : client.name} onClose={onClose}>
      {client.isPartner && (
        <div className="card partner-card">
          <div className="card-row" style={{ padding: '4px 0' }}>
            <span className="muted">{t('clients.partnerStatus')}</span>
            <span>🤝 {t('clients.partner')}</span>
          </div>
          <div className="card-row" style={{ padding: '4px 0' }}>
            <span className="muted">{t('clients.standardPrice')}</span>
            <span>{client.partnerPrice > 0 ? formatMoney(client.partnerPrice) : t('common.notFilled')}</span>
          </div>
          <div className="card-row" style={{ padding: '4px 0', alignItems: 'flex-start' }}>
            <span className="muted">{t('clients.standardLocation')}</span>
            {client.partnerLocation?.address ? (
              <LocationDisplay location={client.partnerLocation} />
            ) : (
              <span>{t('common.notFilled')}</span>
            )}
          </div>
          <div className="card-row" style={{ padding: '4px 0' }}>
            <span className="muted">{t('clients.monthVisits').replace('{month}', monthName)}</span>
            <span>{(client.currentMonthVisits || 0)} {t('clients.visitTimes')}</span>
          </div>
        </div>
      )}
      <div className="card">
        <div className="card-row" style={{ padding: '4px 0' }}>
          <span className="muted">{t('common.phone')}</span>
          <span>{client.phone ? formatPhone(client.phone) : t('common.notFilled')}</span>
        </div>
        {client.locations && client.locations.length > 0 && (
          <div className="card-row" style={{ padding: '4px 0', alignItems: 'flex-start' }}>
            <span className="muted">{t('common.location')}</span>
            <div className="client-location-list">
              {client.locations.map((l, i) => (
                <LocationDisplay key={i} location={l} />
              ))}
            </div>
          </div>
        )}
        <div className="card-row" style={{ padding: '4px 0' }}>
          <span className="muted">{t('clients.totalSpent')}</span>
          <span className="text-income">{formatMoney(client.totalSpent)}</span>
        </div>
      </div>

      <div className="section-title">{t('clients.history')}</div>
      {(client.services || []).length === 0 ? (
        <div className="empty">{t('services.noServices')}</div>
      ) : (
        client.services.map((service) => (
          <div
            key={service._id}
            className={`list-item ${service.isDeletedByClientDeletion ? 'deleted-item' : ''}`}
            onClick={() => onOpenService(service)}
          >
            <div className="row-between">
              <div className="title">{formatDateTime(service.serviceDateTime, lang)}</div>
              <span className={`badge badge-${badgeOf(service.status)}`}>{t(`status.${service.status}`)}</span>
            </div>
            <div className="sub">
              <LocationDisplay location={service.location} inline /> · {formatMoney(service.price)}
            </div>
            {service.isDeletedByClientDeletion && <div className="sub deleted-text">{t('ui.notVisited')}</div>}
            {service.clientDeletionNote && <div className="sub">{service.clientDeletionNote}</div>}
          </div>
        ))
      )}

      <div className="btn-row mt-12">
        <button className="btn btn-block" onClick={onEdit}>
          ✏️ {t('common.edit')}
        </button>
        <button className="btn btn-danger btn-block" onClick={onDelete}>
          🗑️ {t('common.delete')}
        </button>
      </div>
    </Modal>
  );
}

// To'liq tahrir formasi (xarita havolasi, hamkor standart manzili kabi murakkab
// maydonlar uchun) — tafsilot oynasidan ochiladi. Oddiy tahrirlar jadvalda.
function EditClientModal({ client, onClose, onSaved }) {
  const { t } = useApp();
  const [form, setForm] = useState({
    name: client.name || '',
    phone: client.phone || '',
    locationName: client.locations?.[0]?.address || '',
    locationMapUrl: client.locations?.[0]?.mapUrl || '',
    locationCoordinates: client.locations?.[0]?.coordinates || null,
    isPartner: !!client.isPartner,
    partnerPrice: client.partnerPrice > 0 ? String(client.partnerPrice) : '',
    partnerAddress: client.partnerLocation?.address || '',
    partnerMapUrl: client.partnerLocation?.mapUrl || '',
    partnerCoordinates: client.partnerLocation?.coordinates || null,
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (shouldWarnMapUrl(form.locationMapUrl) && !window.confirm(t('common.mapUrlWarning'))) return;
    if (form.isPartner && shouldWarnMapUrl(form.partnerMapUrl) && !window.confirm(t('common.mapUrlWarning'))) return;
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        phone: form.phone,
        location: { address: form.locationName, mapUrl: form.locationMapUrl, coordinates: form.locationCoordinates },
        isPartner: form.isPartner,
      };
      if (form.isPartner) {
        payload.partnerPrice = Number(form.partnerPrice) || 0;
        payload.partnerLocation = form.partnerAddress
          ? { address: form.partnerAddress, mapUrl: form.partnerMapUrl, coordinates: form.partnerCoordinates }
          : null;
      }
      const updated = await api.put(`/clients/${client._id}`, payload);
      onSaved(updated);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Hamkorda telefon ixtiyoriy; oddiy mijozda majburiy.
  const canSave = !busy && form.name && (form.isPartner || form.phone) && (form.isPartner || form.locationName);

  return (
    <Modal title={t('common.edit')} onClose={onClose}>
      <label className="label">{t('common.name')}</label>
      <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label className="label">{t('common.phone')}{form.isPartner ? ` (${t('clients.optional')})` : ''}</label>
      <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <label className="label">{t('common.locationName')}</label>
      <input className="input" value={form.locationName} onChange={(e) => setForm({ ...form, locationName: e.target.value })} />
      <label className="label">{t('common.mapUrl')}</label>
      <input className="input" type="text" inputMode="url" placeholder={t('common.mapUrlPlaceholder')} value={form.locationMapUrl} onChange={(e) => setForm({ ...form, locationMapUrl: e.target.value })} />
      <MapQuickLinks />

      <label className="label partner-toggle">
        <input
          type="checkbox"
          checked={form.isPartner}
          onChange={(e) => setForm({ ...form, isPartner: e.target.checked })}
        />{' '}
        🤝 {t('clients.partnerToggle')}
      </label>
      {form.isPartner && (
        <>
          <label className="label">{t('clients.standardPrice')}</label>
          <div className="input-with-action">
            <input
              type="number"
              inputMode="numeric"
              value={form.partnerPrice}
              onChange={(e) => setForm({ ...form, partnerPrice: e.target.value })}
            />
            <span>so'm</span>
          </div>
          <label className="label">{t('clients.standardLocation')}</label>
          <input
            className="input"
            value={form.partnerAddress}
            onChange={(e) => setForm({ ...form, partnerAddress: e.target.value })}
          />
          <label className="label">{t('common.mapUrl')}</label>
          <input
            className="input"
            type="text"
            inputMode="url"
            placeholder={t('common.mapUrlPlaceholder')}
            value={form.partnerMapUrl}
            onChange={(e) => setForm({ ...form, partnerMapUrl: e.target.value })}
          />
        </>
      )}

      <button className="btn btn-primary btn-block" onClick={save} disabled={!canSave}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}

function normalizeClients(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function badgeOf(status) {
  if (status === 'bajarildi') return 'done';
  if (status === 'bekor_qilindi') return 'cancelled';
  return 'pending';
}
