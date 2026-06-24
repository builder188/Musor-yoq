import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatPhone, formatDate, formatDateTime, toInputDateTime } from '../utils/format.js';
import { shouldWarnMapUrl } from '../utils/mapUrl.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import ServiceDetailModal from '../components/ServiceDetailModal.jsx';
import LocationDisplay from '../components/LocationDisplay.jsx';
import FinalConfirmModal from '../components/FinalConfirmModal.jsx';

export default function Clients({ focusClientId, openAddClient, onAddClientHandled, onFocusHandled }) {
  const { t } = useApp();
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [selectedService, setSelectedService] = useState(null);

  const load = async (q = '') => {
    setLoading(true);
    try {
      setClients(normalizeClients(await api.get(`/clients${q ? `?search=${encodeURIComponent(q)}` : ''}`)));
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
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

  useEffect(() => {
    if (!openAddClient) return;
    setAdding(true);
    onAddClientHandled?.();
  }, [openAddClient, onAddClientHandled]);

  return (
    <div>
      <div className="row-between">
        <h1 className="page-title">{t('clients.title')}</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
          + {t('clients.addClient')}
        </button>
      </div>

      <div className="search-box">
        <input
          className="input"
          placeholder={t('home.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(search)}
        />
        <button className="btn btn-primary" onClick={() => load(search)}>
          {t('common.search').replace('...', '')}
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : clients.length === 0 ? (
        <div className="empty">{t('clients.noClients')}</div>
      ) : (
        clients.map((client) => <ClientCard key={client._id} client={client} onOpen={() => openDetail(client._id)} />)
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
            load(search);
          }}
        />
      )}

      {adding && (
        <AddClientModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setSearch('');
            load();
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
            load(search);
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

function ClientCard({ client, onOpen }) {
  const { t } = useApp();
  const lastServiceAt = client.lastServiceAt || client.services?.[0]?.serviceDateTime;
  const debt = client.unpaidTotal || client.totalDebt || client.unpaidAmount;

  return (
    <div className={`list-item ${client.isDeleted ? 'deleted-item' : ''}`} onClick={onOpen}>
      <div className="row-between">
        <div className="title">{client.name}</div>
        {client.isDeleted && <span className="badge badge-muted">{t('ui.deleted')}</span>}
      </div>
      <div className="sub">{formatPhone(client.phone)}</div>
      {lastServiceAt && <div className="sub">{t('ui.lastService')}: {formatDate(lastServiceAt)}</div>}
      {debt > 0 && <div className="sub debt-text">Qarz: {formatMoney(debt)}</div>}
      {!lastServiceAt && !debt && <div className="sub">{t('clients.noHistory')}</div>}
    </div>
  );
}

function ClientDetailModal({ client, onClose, onEdit, onDelete, onOpenService }) {
  const { t } = useApp();
  return (
    <Modal title={client.name} onClose={onClose}>
      <div className="card">
        <div className="card-row" style={{ padding: '4px 0' }}>
          <span className="muted">{t('common.phone')}</span>
          <span>{formatPhone(client.phone)}</span>
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
              <div className="title">{formatDate(service.serviceDateTime)}</div>
              <span className={`badge badge-${badgeOf(service.status)}`}>{t(`status.${service.status}`)}</span>
            </div>
            <div className="sub">
              {service.location?.address || '-'} · {formatMoney(service.price)}
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

function AddClientModal({ onClose, onSaved }) {
  const { t, lang } = useApp();
  const initialDateTime = toInputDateTime(new Date(Date.now() + 60 * 60 * 1000));
  const [datePart, timePart] = initialDateTime.split('T');
  const [form, setForm] = useState({
    name: '',
    phone: '',
    locationName: '',
    locationMapUrl: '',
    date: datePart,
    time: timePart,
    price: '',
  });
  const [busy, setBusy] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState(null);

  const save = async () => {
    if (!form.locationName.trim()) return alert(t('common.locationRequired'));
    if (shouldWarnMapUrl(form.locationMapUrl) && !window.confirm(t('common.mapUrlWarning'))) return;
    setConfirmPayload({
      clientName: form.name,
      clientPhone: form.phone,
      location: { address: form.locationName, mapUrl: form.locationMapUrl },
      serviceDateTime: new Date(`${form.date}T${form.time}`).toISOString(),
      price: Number(form.price),
      paymentMethod: 'naqd',
    });
  };

  const confirmSave = async () => {
    if (!confirmPayload) return;
    setBusy(true);
    try {
      await api.post('/services', confirmPayload);
      setConfirmPayload(null);
      onSaved();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('clients.addClient')} onClose={onClose}>
      <label className="label">{t('common.name')}</label>
      <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label className="label">{t('common.phone')}</label>
      <input
        className="input"
        type="tel"
        inputMode="tel"
        placeholder="+998..."
        value={form.phone}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
      />
      <label className="label">{t('common.locationName')}</label>
      <input className="input" value={form.locationName} onChange={(e) => setForm({ ...form, locationName: e.target.value })} />
      <label className="label">{t('common.mapUrl')}</label>
      <input
        className="input"
        type="text"
        inputMode="url"
        placeholder={t('common.mapUrlPlaceholder')}
        value={form.locationMapUrl}
        onChange={(e) => setForm({ ...form, locationMapUrl: e.target.value })}
      />
      <div className="date-range">
        <div>
          <label className="label">{t('common.date')}</label>
          <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <div>
          <label className="label">{t('common.time')}</label>
          <input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
        </div>
      </div>
      <label className="label">{t('common.serviceFee')}</label>
      <div className="input-with-action">
        <input
          type="number"
          inputMode="numeric"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
        />
        <span>so'm</span>
      </div>
      <div className="reminder-banner">
        <span>🔔</span>
        <span>{reminderText(form.date, form.time, t, lang)}</span>
      </div>
      <button
        className="btn btn-primary btn-block premium-save"
        onClick={save}
        disabled={busy || !form.name || !form.phone || !form.locationName || !form.date || !form.time || !form.price}
      >
        {busy ? '...' : t('common.save')}
      </button>
      {confirmPayload && (
        <FinalConfirmModal
          rows={serviceConfirmRows(confirmPayload, t)}
          busy={busy}
          onClose={() => setConfirmPayload(null)}
          onConfirm={confirmSave}
        />
      )}
    </Modal>
  );
}

function serviceConfirmRows(payload, t) {
  return [
    { label: t('common.name'), value: payload.clientName },
    { label: t('common.phone'), value: formatPhone(payload.clientPhone) },
    { label: t('common.location'), value: payload.location?.address },
    { label: t('common.date'), value: formatDateTime(payload.serviceDateTime) },
    { label: t('common.serviceFee'), value: formatMoney(payload.price) },
    { label: t('common.paymentMethod'), value: t(`payment.${payload.paymentMethod}`) },
  ];
}

const CLIENT_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

function reminderText(date, time, t, lang) {
  if (!date || !time) return t('clients.reminderDefault');
  const value = new Date(`${date}T${time}`);
  if (Number.isNaN(value.getTime())) return t('clients.reminderDefault');
  const formatted = formatReminderDate(value, lang);
  return t('clients.reminderAt').replace('{time}', formatted);
}

function formatReminderDate(value, lang) {
  if (lang === 'ru') {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(value);
  }
  const day = String(value.getDate()).padStart(2, '0');
  const month = CLIENT_MONTHS[value.getMonth()];
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  return `${day}-${month}, ${hour}:${minute}`;
}

function EditClientModal({ client, onClose, onSaved }) {
  const { t } = useApp();
  const [form, setForm] = useState({
    name: client.name || '',
    phone: client.phone || '',
    locationName: client.locations?.[0]?.address || '',
    locationMapUrl: client.locations?.[0]?.mapUrl || '',
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (shouldWarnMapUrl(form.locationMapUrl) && !window.confirm(t('common.mapUrlWarning'))) return;
    setBusy(true);
    try {
      const updated = await api.put(`/clients/${client._id}`, {
        name: form.name,
        phone: form.phone,
        location: { address: form.locationName, mapUrl: form.locationMapUrl },
      });
      onSaved(updated);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('common.edit')} onClose={onClose}>
      <label className="label">{t('common.name')}</label>
      <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label className="label">{t('common.phone')}</label>
      <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <label className="label">{t('common.locationName')}</label>
      <input className="input" value={form.locationName} onChange={(e) => setForm({ ...form, locationName: e.target.value })} />
      <label className="label">{t('common.mapUrl')}</label>
      <input className="input" type="text" inputMode="url" placeholder={t('common.mapUrlPlaceholder')} value={form.locationMapUrl} onChange={(e) => setForm({ ...form, locationMapUrl: e.target.value })} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy || !form.name || !form.phone || !form.locationName}>
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
