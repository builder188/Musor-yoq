import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatDateTime, formatMoney } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import LoadError from '../components/LoadError.jsx';

const todayInput = () => new Date().toISOString().slice(0, 10);

export default function Reminders() {
  const { t, lang } = useApp();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await api.get(`/reminders?status=${status}`));
      setLoadError(false);
    } catch {
      // Xato = bo'sh ro'yxat EMAS — banner ko'rsatamiz (yozuvlar bazada turibdi).
      setLoadError(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const activeCount = useMemo(() => items.filter((r) => r.status === 'pending').length, [items]);
  const activeTotal = useMemo(
    () => items.filter((r) => r.status === 'pending').reduce((sum, r) => sum + (r.amount || 0), 0),
    [items]
  );

  const markDone = async (reminder) => {
    setBusyId(reminder._id);
    try {
      await api.patch(`/reminders/${reminder._id}/done`);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {loadError && <LoadError onRetry={load} />}
      <div className="row-between" style={{ marginBottom: 4 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{t('reminders.title')}</h1>
        <button
          className="icon-btn"
          style={{ background: 'var(--text)', color: 'var(--card)', border: 'none', fontSize: 21, boxShadow: 'var(--shadow-btn)' }}
          aria-label={t('common.add')}
          onClick={() => setCreating(true)}
        >
          +
        </button>
      </div>

      <div className="summary-card" style={{ marginTop: 12 }}>
        <div className="summary-col">
          <div className="summary-label">{t('reminders.activeCount')}</div>
          <div className="summary-value">{activeCount}<span className="unit"> {t('home.countSuffix')}</span></div>
        </div>
        <div className="summary-divider" />
        <div className="summary-col wide">
          <div className="summary-label">{t('reminders.totalAmount')}</div>
          <div className="summary-value accent">{formatMoney(activeTotal)}</div>
        </div>
      </div>

      <div className="segment">
        <button className={status === 'pending' ? 'active' : ''} onClick={() => setStatus('pending')}>
          {t('reminders.pending')}
        </button>
        <button className={status === 'done' ? 'active' : ''} onClick={() => setStatus('done')}>
          {t('reminders.done')}
        </button>
        <button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>
          {t('finance.all')}
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <div className="empty">{t('reminders.empty')}</div>
      ) : (
        items.map((reminder) => (
          <ReminderCard
            key={reminder._id}
            reminder={reminder}
            t={t}
            lang={lang}
            busy={busyId === reminder._id}
            onDone={() => markDone(reminder)}
            onDelete={() => setDeleting(reminder)}
          />
        ))
      )}

      {creating && (
        <ReminderFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          message={deleting.person || deleting.text || t('reminders.title')}
          onClose={() => setDeleting(null)}
          onConfirm={async (code) => {
            await api.del(`/reminders/${deleting._id}`, { confirmationCode: code });
            setDeleting(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ReminderCard({ reminder, t, lang, busy, onDone, onDelete }) {
  const taken = reminder.direction === 'taken';
  const who = reminder.person || reminder.text || '-';
  const initial = (who || '?').trim().charAt(0).toUpperCase() || '?';
  const overdue = reminder.status === 'pending' && new Date(reminder.dueDate) < new Date();
  return (
    <div className={`list-item ${reminder.status !== 'pending' ? 'is-done' : ''}`} style={{ width: '100%' }}>
      <div className="job-card">
        <div className="avatar">{initial}</div>
        <div className="job-main">
          <div className="job-name">
            {who} <span className="muted" style={{ fontWeight: 400 }}>· {taken ? t('reminders.taken') : t('reminders.given')}</span>
          </div>
          <div className="job-sub">
            🔔 {t('reminders.remindOn')}: {formatDateTime(reminder.dueDate, lang)}
            {overdue && <span className="badge badge-pending" style={{ marginLeft: 6 }}>!</span>}
          </div>
          {reminder.amount > 0 && <div className="job-price">{formatMoney(reminder.amount)}</div>}
          <div className="muted" style={{ fontSize: 12 }}>
            {reminder.affectsBalance ? t('reminders.inBalance') : t('reminders.notInBalance')}
          </div>
          {reminder.note && <div className="muted" style={{ fontSize: 12 }}>{reminder.note}</div>}
        </div>
        <span className={`badge ${reminder.status === 'pending' ? 'badge-pending' : reminder.status === 'done' ? 'badge-done' : 'badge-muted'}`}>
          {t(`reminders.status.${reminder.status}`)}
        </span>
      </div>
      {reminder.status === 'pending' && (
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={onDone} disabled={busy}>
            {busy ? '...' : t('reminders.markDone')}
          </button>
          <button className="btn btn-danger btn-sm" onClick={onDelete} disabled={busy}>
            {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  );
}

function ReminderFormModal({ onClose, onSaved }) {
  const { t } = useApp();
  const [form, setForm] = useState({
    direction: 'given',
    person: '',
    amount: '',
    dueDate: todayInput(),
    affectsBalance: true,
    note: '',
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.post('/reminders', {
        type: 'debt',
        direction: form.direction,
        person: form.person,
        amount: form.amount,
        // Sanani mahalliy vaqtda ertalab 09:00 ga belgilaymiz (yarim tunda eslatmaslik uchun).
        dueDate: form.dueDate ? new Date(`${form.dueDate}T09:00:00`).toISOString() : null,
        affectsBalance: form.affectsBalance,
        note: form.note,
      });
      onSaved();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const canSave = form.person.trim() && Number(form.amount) > 0 && form.dueDate;

  return (
    <Modal title={t('reminders.add')} onClose={onClose}>
      <label className="label">{t('reminders.direction')}</label>
      <div className="segment" style={{ marginBottom: 12 }}>
        <button className={form.direction === 'given' ? 'active' : ''} onClick={() => setForm({ ...form, direction: 'given' })}>
          {t('reminders.given')}
        </button>
        <button className={form.direction === 'taken' ? 'active' : ''} onClick={() => setForm({ ...form, direction: 'taken' })}>
          {t('reminders.taken')}
        </button>
      </div>

      <label className="label">{t('reminders.person')}</label>
      <input className="input" value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} />

      <label className="label">{t('reminders.amount')}</label>
      <input className="input" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />

      <label className="label">{t('reminders.dueDate')}</label>
      <input className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />

      <label className="check-row" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0' }}>
        <input
          type="checkbox"
          checked={form.affectsBalance}
          onChange={(e) => setForm({ ...form, affectsBalance: e.target.checked })}
        />
        <span>{t('reminders.affectsBalance')}</span>
      </label>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>{t('reminders.affectsBalanceHint')}</div>

      <label className="label">{t('common.notes')}</label>
      <textarea className="input" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />

      <button className="btn btn-primary btn-block" onClick={save} disabled={busy || !canSave}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}
