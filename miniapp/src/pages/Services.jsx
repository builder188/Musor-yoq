import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatDate, formatDateTime, toInputDateTime } from '../utils/format.js';
import { shouldWarnMapUrl } from '../utils/mapUrl.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import LocationDisplay from '../components/LocationDisplay.jsx';
import FinalConfirmModal from '../components/FinalConfirmModal.jsx';
import MapQuickLinks from '../components/MapQuickLinks.jsx';

const STATUSES = ['kutilmoqda', 'bajarildi', 'bekor_qilindi'];
const SERVICE_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

export default function Services() {
  const { t, lang } = useApp();
  const [view, setView] = useState('today');
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchText, setSearchText] = useState('');
  const [detail, setDetail] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [completing, setCompleting] = useState(null);
  const [rescheduling, setRescheduling] = useState(null);
  const [canceling, setCanceling] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = serviceParamsForView(view);
      const data = await api.get(`/services${params.toString() ? `?${params.toString()}` : ''}`);
      setServices(sortServicesForView(normalizeServices(data), view));
    } catch {
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 4 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{t('services.title')}</h1>
        <button
          className="icon-btn"
          style={{ background: 'var(--text)', color: 'var(--card)', border: 'none', fontSize: 21, boxShadow: 'var(--shadow-btn)' }}
          aria-label={t('common.add')}
          onClick={() => setCreating(true)}
        >
          ＋
        </button>
      </div>

      <div className="segment">
        <button className={view === 'today' ? 'active' : ''} onClick={() => setView('today')}>
          {t('services.today')}
        </button>
        <button className={view === 'pending' ? 'active' : ''} onClick={() => setView('pending')}>
          {t('status.kutilmoqda')}
        </button>
        <button className={view === 'done' ? 'active' : ''} onClick={() => setView('done')}>
          {t('status.bajarildi')}
        </button>
      </div>

      <div className="section-title compact">{serviceSectionLabel(view, t, lang)}</div>

      {loading ? (
        <Spinner />
      ) : services.length === 0 ? (
        <div className="empty">{t('services.noServices')}</div>
      ) : (
        services.map((service) => {
          const expanded = expandedId === service._id;
          return (
            <ServiceCard
              key={service._id}
              service={service}
              expanded={expanded}
              onToggle={() => setExpandedId(expanded ? null : service._id)}
              onDetail={() => setDetail(service)}
              onComplete={() => setCompleting(service)}
              onReschedule={() => setRescheduling(service)}
              onCancel={() => setCanceling(service)}
            />
          );
        })
      )}

      {detail && (
        <ServiceDetailBottomSheet
          service={detail}
          onClose={() => setDetail(null)}
          onComplete={setCompleting}
          onReschedule={setRescheduling}
          onCancel={setCanceling}
          onEdit={(service) => {
            setDetail(null);
            setEditing(service);
          }}
          onDelete={(service) => {
            setDetail(null);
            setDeleting(service);
          }}
        />
      )}

      {completing && (
        <CompleteModal
          service={completing}
          onClose={() => setCompleting(null)}
          onDone={() => {
            setCompleting(null);
            setDetail(null);
            load();
          }}
        />
      )}

      {rescheduling && (
        <RescheduleModal
          service={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => {
            setRescheduling(null);
            setDetail(null);
            load();
          }}
        />
      )}

      {canceling && (
        <CancelModal
          service={canceling}
          onClose={() => setCanceling(null)}
          onDone={() => {
            setCanceling(null);
            setDetail(null);
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
            setDetail(null);
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
            setDetail(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function serviceParamsForView(view) {
  const params = new URLSearchParams();
  if (view === 'today') {
    const { from, to } = todayRange();
    params.set('dateFrom', from.toISOString());
    params.set('dateTo', to.toISOString());
  }
  if (view === 'pending') params.set('status', 'kutilmoqda');
  if (view === 'done') params.set('status', 'bajarildi');
  return params;
}

function todayRange() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function serviceSectionLabel(view, t, lang) {
  if (view === 'pending') return t('status.kutilmoqda');
  if (view === 'done') return t('status.bajarildi');
  const d = new Date();
  if (lang === 'ru') {
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  }
  return `${t('services.today')} · ${d.getDate()}-${SERVICE_MONTHS[d.getMonth()]}`;
}

function normalizeServices(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function sortServicesForView(items, view) {
  const direction = view === 'today' ? 1 : -1;
  return [...items].sort((a, b) => {
    const left = new Date(a.serviceDateTime).getTime() || 0;
    const right = new Date(b.serviceDateTime).getTime() || 0;
    return (left - right) * direction;
  });
}

function FilterBar({
  t,
  filterStatus,
  dateFrom,
  dateTo,
  searchText,
  onStatus,
  onDateFrom,
  onDateTo,
  onSearchText,
  onSearch,
  onReset,
}) {
  return (
    <div className="card filter-card">
      <label className="label">{t('common.status')}</label>
      <select className="select" value={filterStatus} onChange={(e) => onStatus(e.target.value)}>
        <option value="">{t('services.all')}</option>
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {t(`status.${status}`)}
          </option>
        ))}
      </select>

      <div className="btn-row mb-8">
        <div style={{ flex: 1 }}>
          <label className="label">{t('common.date')} (dan)</label>
          <input className="input" type="date" style={{ marginBottom: 0 }} value={dateFrom} onChange={(e) => onDateFrom(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">{t('common.date')} (gacha)</label>
          <input className="input" type="date" style={{ marginBottom: 0 }} value={dateTo} onChange={(e) => onDateTo(e.target.value)} />
        </div>
      </div>

      <label className="label">{t('clients.title')} / {t('common.phone')} / {t('common.location')}</label>
      <input className="input" value={searchText} onChange={(e) => onSearchText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSearch()} />

      <div className="btn-row">
        <button className="btn btn-block" onClick={onReset}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary btn-block" onClick={onSearch}>
          {t('common.search').replace('...', '')}
        </button>
      </div>
    </div>
  );
}

function ServiceCard({ service, expanded, onToggle, draggable = false, onDetail, onComplete, onReschedule, onCancel, onQuickComplete }) {
  const { t } = useApp();
  const isPending = service.status === 'kutilmoqda';
  const isDone = service.status === 'bajarildi';
  const isCancelled = service.status === 'bekor_qilindi';
  const initial = (service.clientName || '?').trim().charAt(0).toUpperCase() || '?';
  // Checkbox bosilganda "bajarildi" oqimi: kanban'da onQuickComplete, ro'yxatda onComplete.
  const completeAction = onComplete || onQuickComplete;
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn?.();
  };
  return (
    <div
      className={`list-item ${isDone ? 'is-done' : ''} ${service.isDeletedByClientDeletion ? 'deleted-item' : ''}`}
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData('text/service-id', service._id)}
      onClick={onToggle}
    >
      <div className={`job-card ${isDone ? 'is-done' : ''}`}>
        <div className="avatar">{initial}</div>
        <div className="job-main">
          <div className="job-name">{service.clientName}</div>
          <div className="job-sub">
            {formatDateTime(service.serviceDateTime)}
            {service.location?.address ? ` · ${service.location.address}` : ''}
          </div>
          <div className="job-price">{formatMoney(service.price)}</div>
        </div>
        {isDone ? (
          <div className="check-circle done" aria-label={t('status.bajarildi')}>✓</div>
        ) : isCancelled ? (
          <span className="badge badge-cancelled">{t('status.bekor_qilindi')}</span>
        ) : completeAction ? (
          <button className="check-circle" aria-label={t('services.markDone')} onClick={stop(completeAction)} />
        ) : (
          <div className="check-circle" />
        )}
      </div>
      {expanded && (
        <div className="service-expanded">
          <div className="sub">{t('common.phone')}: {service.clientPhone}</div>
          <div className="sub">{t('common.paymentMethod')}: {t(`payment.${service.paymentMethod}`)}</div>
          {service.paymentStatus && (
            <div className="sub">{t('services.paymentStatus')}: {t(`paymentStatus.${service.paymentStatus}`)}</div>
          )}
          {service.notes && <div className="sub">{service.notes}</div>}
          {/* Tezkor amallar — har bir kartochkadan to'g'ridan-to'g'ri. */}
          <div className="btn-row mt-8">
            {isPending && onComplete && (
              <button className="btn btn-primary btn-sm btn-block" onClick={stop(onComplete)}>
                ✅ {t('services.markDone')}
              </button>
            )}
            {isPending && onReschedule && (
              <button className="btn btn-sm btn-block" onClick={stop(onReschedule)}>
                📅 {t('services.reschedule')}
              </button>
            )}
          </div>
          <div className="btn-row mt-8">
            {onDetail && (
              <button className="btn btn-sm btn-block" onClick={stop(onDetail)}>
                ℹ️ {t('services.detail')}
              </button>
            )}
            {isPending && onCancel && (
              <button className="btn btn-sm btn-block" onClick={stop(onCancel)}>
                ❌ {t('services.cancelled')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceDetailBottomSheet({ service, onClose, onComplete, onReschedule, onCancel, onEdit, onDelete }) {
  const { t } = useApp();
  return (
    <Modal title={service.clientName} onClose={onClose}>
      <div className="mb-8">
        <span className={`badge badge-${badgeOf(service.status)}`}>{t(`status.${service.status}`)}</span>
      </div>

      <div className="card">
        <Row label={t('common.phone')} value={service.clientPhone} />
        <Row label={t('common.location')} value={<LocationDisplay location={service.location} />} />
        <Row label={t('common.date')} value={formatDateTime(service.serviceDateTime)} />
        <Row label={t('common.price')} value={formatMoney(service.price)} />
        <Row label={t('common.paymentMethod')} value={t(`payment.${service.paymentMethod}`)} />
        <Row label={t('services.paymentStatus')} value={t(`paymentStatus.${service.paymentStatus}`)} />
        {service.notes ? <Row label={t('common.notes')} value={service.notes} /> : null}
        {service.clientDeletionNote ? <Row label={t('common.notes')} value={service.clientDeletionNote} /> : null}
      </div>

      <div className="btn-row mb-8">
        {service.status === 'kutilmoqda' && (
          <button className="btn btn-primary btn-block" onClick={() => onComplete(service)}>
            ✅ {t('services.markDone')}
          </button>
        )}
      </div>
      <div className="btn-row mb-8">
        <button className="btn btn-block" onClick={() => onReschedule(service)}>
          📅 {t('services.reschedule')}
        </button>
        {service.status === 'kutilmoqda' && (
          <button className="btn btn-block" onClick={() => onCancel(service)}>
            ❌ {t('services.cancelled')}
          </button>
        )}
      </div>
      <div className="btn-row mb-8">
        <button className="btn btn-block" onClick={() => onEdit(service)}>
          ✏️ {t('common.edit')}
        </button>
        <button className="btn btn-danger btn-block" onClick={() => onDelete(service)}>
          🗑️ {t('common.delete')}
        </button>
      </div>
    </Modal>
  );
}

function CompleteModal({ service, onClose, onDone }) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await api.patch(`/services/${service._id}/complete`, { markPaid: true });
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('services.markDone')} onClose={onClose}>
      <p>
        Bu xizmatni bajarildi deb belgilab,
        <br />
        {formatMoney(service.price)} so'mni balansga qo'shamiz. Tasdiqlaysizmi?
      </p>
      <div className="btn-row">
        <button className="btn btn-primary btn-block" onClick={confirm} disabled={busy}>
          ✅ Ha, bajardim
        </button>
        <button className="btn btn-block" onClick={onClose} disabled={busy}>
          ❌ Bekor
        </button>
      </div>
    </Modal>
  );
}

function RescheduleModal({ service, onClose, onDone }) {
  const { t } = useApp();
  const [date, setDate] = useState(toInputDateTime(service.serviceDateTime));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/services/${service._id}/reschedule`, { newDateTime: new Date(date).toISOString() });
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('services.reschedule')} onClose={onClose}>
      <label className="label">{t('common.date')}</label>
      <input className="input" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy || !date}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}

function CancelModal({ service, onClose, onDone }) {
  const { t } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const cancel = async () => {
    setBusy(true);
    try {
      await api.patch(`/services/${service._id}/cancel`, { reason });
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('services.cancelled')} onClose={onClose}>
      <p>{t('services.cancelConfirm')}</p>
      <label className="label">{t('common.notes')}</label>
      <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="btn-row">
        <button className="btn btn-danger btn-block" onClick={cancel} disabled={busy}>
          ❌ {t('services.cancelled')}
        </button>
        <button className="btn btn-block" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  );
}

function ServiceFormModal({ service, onClose, onSaved }) {
  const { t } = useApp();
  const isEdit = !!service;
  const [form, setForm] = useState({
    clientName: service?.clientName || '',
    clientPhone: service?.clientPhone || '',
    locationName: service?.location?.address || '',
    locationMapUrl: service?.location?.mapUrl || '',
    serviceDateTime: toInputDateTime(service?.serviceDateTime),
    price: service?.price ?? '',
    paymentMethod: service?.paymentMethod || 'naqd',
    notes: service?.notes || '',
    isHistorical: service?.isHistorical || false,
  });
  const [busy, setBusy] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState(null);

  const buildPayload = () => {
    const { locationName, locationMapUrl, ...fields } = form;
    return {
      ...fields,
      price: Number(form.price),
      location: { address: locationName, mapUrl: locationMapUrl },
      serviceDateTime: new Date(form.serviceDateTime).toISOString(),
    };
  };

  const save = async () => {
    if (!form.locationName.trim()) return alert(t('common.locationRequired'));
    if (shouldWarnMapUrl(form.locationMapUrl) && !window.confirm(t('common.mapUrlWarning'))) return;
    const payload = buildPayload();
    if (!isEdit) {
      setConfirmPayload(payload);
      return;
    }

    setBusy(true);
    try {
      await api.put(`/services/${service._id}`, payload);
      onSaved();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
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
    <Modal title={isEdit ? t('common.edit') : t('common.add')} onClose={onClose}>
      <label className="label">{t('common.name')}</label>
      <input className="input" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
      <label className="label">{t('common.phone')}</label>
      <input className="input" placeholder="+998..." value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} />
      <label className="label">{t('common.locationName')}</label>
      <input className="input" value={form.locationName} onChange={(e) => setForm({ ...form, locationName: e.target.value })} />
      <label className="label">{t('common.mapUrl')}</label>
      <input className="input" type="text" inputMode="url" placeholder={t('common.mapUrlPlaceholder')} value={form.locationMapUrl} onChange={(e) => setForm({ ...form, locationMapUrl: e.target.value })} />
      <MapQuickLinks />
      <label className="label">{t('common.date')}</label>
      <input className="input" type="datetime-local" value={form.serviceDateTime} onChange={(e) => setForm({ ...form, serviceDateTime: e.target.value })} />
      <label className="label">{t('common.price')}</label>
      <input className="input" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
      <label className="label">{t('common.paymentMethod')}</label>
      <select className="select" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
        <option value="naqd">{t('payment.naqd')}</option>
        <option value="karta">{t('payment.karta')}</option>
        <option value="otkazma">{t('payment.otkazma')}</option>
      </select>
      <label className="card-row">
        <span>{t('services.isHistorical')}</span>
        <input type="checkbox" checked={form.isHistorical} onChange={(e) => setForm({ ...form, isHistorical: e.target.checked })} />
      </label>
      <label className="label">{t('common.notes')}</label>
      <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy || !form.clientName || !form.clientPhone || !form.locationName || !form.serviceDateTime || !form.price}>
        {busy ? '...' : t('common.save')}
      </button>
      {confirmPayload && (
        <FinalConfirmModal
          rows={serviceFormConfirmRows(confirmPayload, t)}
          busy={busy}
          onClose={() => setConfirmPayload(null)}
          onConfirm={confirmSave}
        />
      )}
    </Modal>
  );
}

function serviceFormConfirmRows(payload, t) {
  return [
    { label: t('common.name'), value: payload.clientName },
    { label: t('common.phone'), value: payload.clientPhone },
    { label: t('common.location'), value: payload.location?.address },
    { label: t('common.date'), value: formatDateTime(payload.serviceDateTime) },
    { label: t('common.price'), value: formatMoney(payload.price) },
    { label: t('common.paymentMethod'), value: t(`payment.${payload.paymentMethod}`) },
    { label: t('common.notes'), value: payload.notes },
  ];
}

function Row({ label, value }) {
  return (
    <div className="card-row" style={{ padding: '4px 0' }}>
      <span className="muted">{label}</span>
      <span style={{ textAlign: 'right', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function badgeOf(status) {
  if (status === 'bajarildi') return 'done';
  if (status === 'bekor_qilindi') return 'cancelled';
  return 'pending';
}
