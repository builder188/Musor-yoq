// Xizmatlar sahifasi: Kanban / Ro'yxat + bajarish/tahrir/o'chirish.
import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatDate, toInputDateTime } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ServiceDetailModal from '../components/ServiceDetailModal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';

const STATUSES = ['kutilmoqda', 'bajarildi', 'bekor_qilindi'];

export default function Services() {
  const { t } = useApp();
  const [view, setView] = useState('kanban');
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [completing, setCompleting] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchText, setSearchText] = useState('');

  // override bilan chaqirilsa o'sha qiymatlar, aks holda joriy holat ishlatiladi.
  const load = async (override) => {
    const f = {
      status: override?.status ?? filterStatus,
      from: override?.dateFrom ?? dateFrom,
      to: override?.dateTo ?? dateTo,
      search: override?.searchText ?? searchText,
    };
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f.status) params.set('status', f.status);
      if (f.from) params.set('dateFrom', new Date(f.from).toISOString());
      if (f.to) params.set('dateTo', new Date(`${f.to}T23:59:59`).toISOString());
      if (f.search.trim()) params.set('search', f.search.trim());
      const qs = params.toString();
      setServices(await api.get(`/services${qs ? `?${qs}` : ''}`));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  const refresh = () => {
    setDetail(null);
    load();
  };

  return (
    <div>
      <div className="row-between">
        <h1 className="page-title">{t('services.title')}</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          + {t('common.add')}
        </button>
      </div>

      <div className="segment">
        <button className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')}>
          {t('services.kanban')}
        </button>
        <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
          {t('services.list')}
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : view === 'kanban' ? (
        <div className="kanban">
          {STATUSES.map((st) => (
            <div key={st} className="kanban-col">
              <h3>
                {t(`status.${st}`)} ({services.filter((s) => s.status === st).length})
              </h3>
              {services
                .filter((s) => s.status === st)
                .map((s) => (
                  <ServiceCard key={s._id} s={s} t={t} onClick={() => setDetail(s)} />
                ))}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="segment">
            <button className={filterStatus === '' ? 'active' : ''} onClick={() => setFilterStatus('')}>
              {t('services.all')}
            </button>
            {STATUSES.map((st) => (
              <button key={st} className={filterStatus === st ? 'active' : ''} onClick={() => setFilterStatus(st)}>
                {t(`status.${st}`)}
              </button>
            ))}
          </div>

          {/* Sana oralig'i + mijoz bo'yicha filtr */}
          <div className="card" style={{ padding: 12 }}>
            <div className="btn-row mb-8">
              <div style={{ flex: 1 }}>
                <label className="label">{t('common.date')} (dan)</label>
                <input className="input" type="date" style={{ marginBottom: 0 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="label">{t('common.date')} (gacha)</label>
                <input className="input" type="date" style={{ marginBottom: 0 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
            <input
              className="input"
              placeholder={`${t('clients.title')} / ${t('common.phone')} / ${t('common.location')}`}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
            />
            <div className="btn-row">
              <button
                className="btn btn-block"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                  setSearchText('');
                  load({ dateFrom: '', dateTo: '', searchText: '' });
                }}
              >
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary btn-block" onClick={() => load()}>
                🔍 {t('common.search').replace('...', '')}
              </button>
            </div>
          </div>

          {services.length === 0 ? (
            <div className="empty">{t('services.noServices')}</div>
          ) : (
            services.map((s) => <ServiceCard key={s._id} s={s} t={t} onClick={() => setDetail(s)} />)
          )}
        </>
      )}

      {detail && (
        <ServiceDetailModal
          service={detail}
          onClose={() => setDetail(null)}
          onComplete={(s) => {
            setDetail(null);
            setCompleting(s);
          }}
          onEdit={(s) => {
            setDetail(null);
            setEditing(s);
          }}
          onCancel={async (s) => {
            await api.patch(`/services/${s._id}/cancel`);
            refresh();
          }}
          onDelete={(s) => {
            setDetail(null);
            setDeleting(s);
          }}
        />
      )}

      {completing && (
        <CompleteModal
          service={completing}
          onClose={() => setCompleting(null)}
          onDone={() => {
            setCompleting(null);
            load();
          }}
        />
      )}

      {(editing || creating) && (
        <ServiceFormModal
          service={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          message={deleting.clientName}
          onClose={() => setDeleting(null)}
          onConfirm={async (code) => {
            await api.del(`/services/${deleting._id}`, { confirmationCode: code });
            setDeleting(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ServiceCard({ s, t, onClick }) {
  return (
    <div className="list-item" onClick={onClick}>
      <div className="row-between">
        <div className="title">{s.clientName}</div>
        <span className={`badge badge-${badgeOf(s.status)}`}>{t(`status.${s.status}`)}</span>
      </div>
      <div className="sub">
        {formatDate(s.serviceDateTime)} · {s.location?.text || '—'}
      </div>
      <div className="sub">{formatMoney(s.price)}</div>
    </div>
  );
}

function badgeOf(status) {
  if (status === 'bajarildi') return 'done';
  if (status === 'bekor_qilindi') return 'cancelled';
  return 'pending';
}

// Bajarish modali — narx o'zgardimi degan savol bilan.
function CompleteModal({ service, onClose, onDone }) {
  const { t } = useApp();
  const [changed, setChanged] = useState(false);
  const [newPrice, setNewPrice] = useState(service.price);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await api.patch(`/services/${service._id}/complete`, {
        newPrice: changed ? Number(newPrice) : null,
        markPaid: true,
      });
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('services.markDone')} onClose={onClose}>
      <p className="mb-8">{service.clientName} — {formatMoney(service.price)}</p>
      <label className="card-row" style={{ padding: '8px 0' }}>
        <span>{t('services.priceChangedQ')}</span>
        <input type="checkbox" checked={changed} onChange={(e) => setChanged(e.target.checked)} />
      </label>
      {changed && (
        <>
          <label className="label">{t('services.newPrice')}</label>
          <input
            className="input"
            type="number"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
          />
        </>
      )}
      <button className="btn btn-primary btn-block" onClick={confirm} disabled={busy}>
        {busy ? '...' : `✅ ${t('services.markDone')}`}
      </button>
    </Modal>
  );
}

// Xizmat yaratish / tahrirlash formasi.
function ServiceFormModal({ service, onClose, onSaved }) {
  const { t } = useApp();
  const isEdit = !!service;
  const [form, setForm] = useState({
    clientName: service?.clientName || '',
    clientPhone: service?.clientPhone || '',
    location: service?.location?.text || '',
    serviceDateTime: toInputDateTime(service?.serviceDateTime),
    price: service?.price || '',
    paymentMethod: service?.paymentMethod || 'naqd',
    notes: service?.notes || '',
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        ...form,
        price: Number(form.price),
        location: form.location,
        serviceDateTime: new Date(form.serviceDateTime).toISOString(),
      };
      if (isEdit) await api.put(`/services/${service._id}`, payload);
      else await api.post('/services', payload);
      onSaved();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isEdit ? t('common.edit') : t('common.add')} onClose={onClose}>
      <label className="label">{t('common.name')}</label>
      <input className="input" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
      <label className="label">{t('common.phone')}</label>
      <input className="input" placeholder="+998..." value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} />
      <label className="label">{t('common.location')}</label>
      <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
      <label className="label">{t('common.date')}</label>
      <input className="input" type="datetime-local" value={form.serviceDateTime} onChange={(e) => setForm({ ...form, serviceDateTime: e.target.value })} />
      <label className="label">{t('common.price')}</label>
      <input className="input" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
      <label className="label">{t('common.paymentMethod')}</label>
      <select className="select" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
        <option value="naqd">{t('payment.naqd')}</option>
        <option value="karta">{t('payment.karta')}</option>
        <option value="o'tkazma">{t("payment.o'tkazma")}</option>
      </select>
      <label className="label">{t('common.notes')}</label>
      <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}
