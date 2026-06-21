import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatPhone, formatDate } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import ServiceDetailModal from '../components/ServiceDetailModal.jsx';

export default function Clients({ focusClientId, onFocusHandled }) {
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
          onSaved={(created) => {
            setAdding(false);
            setClients((items) => [created, ...items]);
            setSearch('');
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
            <span style={{ textAlign: 'right' }}>
              {client.locations.map((l, i) => (
                <div key={i}>{l.address}</div>
              ))}
            </span>
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
  const { t } = useApp();
  const [form, setForm] = useState({ name: '', phone: '', location: '' });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const created = await api.post('/clients', form);
      onSaved(created);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('clients.addClient')} onClose={onClose}>
      <label className="label">{t('common.name')} *</label>
      <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label className="label">{t('common.phone')} *</label>
      <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <label className="label">{t('common.location')}</label>
      <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy || !form.name || !form.phone}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}

function EditClientModal({ client, onClose, onSaved }) {
  const { t } = useApp();
  const [form, setForm] = useState({
    name: client.name || '',
    phone: client.phone || '',
    location: client.locations?.[0]?.address || '',
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.put(`/clients/${client._id}`, form);
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
      <label className="label">{t('common.location')}</label>
      <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
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
