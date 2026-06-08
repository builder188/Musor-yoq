// Mijozlar sahifasi: ro'yxat + qarz belgilari + tafsilot/tahrir/o'chirish.
import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatPhone, formatDate } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';

export default function Clients() {
  const { t } = useApp();
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = async (q = '') => {
    setLoading(true);
    try {
      setClients(await api.get(`/clients${q ? `?search=${encodeURIComponent(q)}` : ''}`));
    } catch {
      /* xato banner App da */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openDetail = async (id) => {
    try {
      setDetail(await api.get(`/clients/${id}`));
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <h1 className="page-title">{t('clients.title')}</h1>

      <div className="search-box">
        <input
          className="input"
          placeholder={t('common.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(search)}
        />
        <button className="btn" onClick={() => load(search)}>
          🔍
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : clients.length === 0 ? (
        <div className="empty">{t('clients.noClients')}</div>
      ) : (
        clients.map((c) => (
          <div key={c._id} className="list-item" onClick={() => openDetail(c._id)}>
            <div className="row-between">
              <div className="title">{c.name}</div>
              {c.totalDebt > 0 && <span className="badge badge-debt">{formatMoney(c.totalDebt)}</span>}
            </div>
            <div className="sub">{formatPhone(c.phone)}</div>
          </div>
        ))
      )}

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <div className="card">
            <div className="card-row" style={{ padding: '4px 0' }}>
              <span className="muted">{t('common.phone')}</span>
              <span>{formatPhone(detail.phone)}</span>
            </div>
            {detail.location && (
              <div className="card-row" style={{ padding: '4px 0' }}>
                <span className="muted">{t('common.location')}</span>
                <span>{detail.location}</span>
              </div>
            )}
            <div className="card-row" style={{ padding: '4px 0' }}>
              <span className="muted">{t('clients.totalSpent')}</span>
              <span className="text-income">{formatMoney(detail.totalSpent)}</span>
            </div>
            <div className="card-row" style={{ padding: '4px 0' }}>
              <span className="muted">{t('clients.debt')}</span>
              <span className={detail.totalDebt > 0 ? 'text-expense' : ''}>
                {formatMoney(detail.totalDebt)}
              </span>
            </div>
          </div>

          <div className="section-title">{t('clients.history')}</div>
          {(detail.services || []).length === 0 ? (
            <div className="empty">{t('services.noServices')}</div>
          ) : (
            detail.services.map((s) => (
              <div key={s._id} className="list-item" style={{ cursor: 'default' }}>
                <div className="row-between">
                  <div className="title">{formatDate(s.serviceDateTime)}</div>
                  <span className={`badge badge-${badgeOf(s.status)}`}>{t(`status.${s.status}`)}</span>
                </div>
                <div className="sub">
                  {s.location?.text || '—'} · {formatMoney(s.price)}
                </div>
              </div>
            ))
          )}

          <div className="btn-row mt-12">
            <button className="btn btn-block" onClick={() => setEditing(detail)}>
              ✏️ {t('common.edit')}
            </button>
            <button className="btn btn-danger btn-block" onClick={() => setDeleting(detail)}>
              🗑 {t('common.delete')}
            </button>
          </div>
        </Modal>
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
    </div>
  );
}

function badgeOf(status) {
  if (status === 'bajarildi') return 'done';
  if (status === 'bekor_qilindi') return 'cancelled';
  return 'pending';
}

function EditClientModal({ client, onClose, onSaved }) {
  const { t } = useApp();
  const [form, setForm] = useState({
    name: client.name || '',
    phone: client.phone || '',
    location: client.location || '',
    notes: client.notes || '',
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
      <label className="label">{t('common.notes')}</label>
      <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}
