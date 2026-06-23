import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { LANGUAGES } from '../i18n/index.js';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import { formatDate } from '../utils/format.js';
import { getTgUser } from '../telegram.js';

export default function Settings() {
  const { t, lang, setLang, theme, setTheme, settings, setSettings } = useApp();
  const [bulkTarget, setBulkTarget] = useState(null);
  const [showRestore, setShowRestore] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [oldDeleteCode, setOldDeleteCode] = useState('');
  const [newDeleteCode, setNewDeleteCode] = useState('');
  const [status, setStatus] = useState('');
  const offsets = (settings?.defaultReminders || []).map((r) => r.minutesBefore);

  const updateOffsets = async (next) => {
    const cleaned = Array.from(new Set(next.filter((n) => n >= 0))).sort((a, b) => b - a);
    const s = await api.put('/settings', {
      defaultReminders: cleaned.map((m) => ({ minutesBefore: m })),
    });
    setSettings(s);
  };

  const toggleReminderPreset = async (minutes) => {
    setBusyAction(`reminder:${minutes}`);
    setStatus('');
    try {
      const next = offsets.includes(minutes) ? offsets.filter((m) => m !== minutes) : [...offsets, minutes];
      await updateOffsets(next);
      setStatus(t('common.saved'));
    } catch (err) {
      setStatus(err.message);
    } finally {
      setBusyAction('');
    }
  };

  const changeDeleteCode = async () => {
    setBusyAction('code');
    setStatus('');
    try {
      const s = await api.put('/settings/change-code', { currentCode: oldDeleteCode, newCode: newDeleteCode });
      setSettings(s);
      setOldDeleteCode('');
      setNewDeleteCode('');
      setStatus(t('common.saved'));
      setShowCodeModal(false);
    } catch (err) {
      setStatus(err.message);
    } finally {
      setBusyAction('');
    }
  };

  const downloadReport = async (format = 'pdf') => {
    setBusyAction(format);
    setStatus('');
    try {
      const res = await api.post(`/reports/${format === 'excel' ? 'excel' : 'pdf'}`, { reportType: 'full', language: lang });
      const blob = await res.blob();
      saveBlob(blob, `hisobot-full.${format === 'excel' ? 'xlsx' : 'pdf'}`);
    } catch (err) {
      setStatus(err.message);
    } finally {
      setBusyAction('');
    }
  };

  const sendReportToBot = async () => {
    setBusyAction('bot');
    setStatus('');
    try {
      await api.post('/reports/send', { reportType: 'full', language: lang, format: 'excel' });
      setStatus(t('reports.sentToBot'));
    } catch (err) {
      setStatus(err.message);
    } finally {
      setBusyAction('');
    }
  };

  const user = getTgUser();
  const ownerName = user?.first_name || settings?.ownerName || t('settings.ownerDefault');
  const ownerInitial = (ownerName || '•').trim().charAt(0).toUpperCase() || '•';

  return (
    <div>
      <h1 className="page-title">{t('settings.title')}</h1>

      {/* Profil */}
      <div className="profile-card">
        <div className="profile-avatar">{ownerInitial}</div>
        <div>
          <div className="profile-name">{ownerName}</div>
          <div className="profile-role">{t('settings.role')}</div>
        </div>
      </div>

      {/* Ko'rinish: Mavzu + Til */}
      <div className="group-label">{t('settings.appearance')}</div>
      <div className="rows-card">
        <div className="setting-row" style={{ cursor: 'default' }}>
          <div className="sr-left">
            <span className="sr-emoji">🌗</span>
            {t('settings.theme')}
          </div>
          <div className="segment mini">
            <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>
              {t('settings.light')}
            </button>
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
              {t('settings.dark')}
            </button>
          </div>
        </div>
        <div className="setting-row" style={{ cursor: 'default' }}>
          <div className="sr-left">
            <span className="sr-emoji">🌐</span>
            {t('settings.language')}
          </div>
          <div className="segment mini">
            {LANGUAGES.map((l) => (
              <button key={l.code} className={lang === l.code ? 'active' : ''} onClick={() => setLang(l.code)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="group-label">{t('settings.reminders')}</div>
      <div className="rows-card reminder-presets-card">
        <div className="reminder-presets">
          {reminderPresets(t).map((preset) => (
            <button
              key={preset.minutes}
              className={`reminder-select ${offsets.includes(preset.minutes) ? 'active' : ''}`}
              disabled={busyAction === `reminder:${preset.minutes}`}
              onClick={() => toggleReminderPreset(preset.minutes)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="group-label">{t('settings.security')}</div>
      <div className="rows-card">
        <button className="setting-row" onClick={() => setShowCodeModal(true)}>
          <div className="sr-left">
            <span className="sr-emoji">#</span>
            {t('settings.deleteCode')}
          </div>
          <div className="sr-right">›</div>
        </button>
        <button className="setting-row danger" onClick={() => setShowRestore(true)}>
          <div className="sr-left">
            <span className="sr-emoji">!</span>
            {t('settings.deletedItems')}
          </div>
          <div className="sr-right">›</div>
        </button>
      </div>

      <div className="card">
        <div className="section-title compact">{t('settings.dataExport')}</div>
        <div className="action-grid">
          <button className="btn" disabled={Boolean(busyAction)} onClick={() => downloadReport('excel')}>
            {busyAction === 'excel' ? '...' : t('settings.exportExcel')}
          </button>
          <button className="btn btn-primary" disabled={Boolean(busyAction)} onClick={() => downloadReport('pdf')}>
            {busyAction === 'pdf' ? '...' : t('settings.exportPdf')}
          </button>
          <button className="btn btn-block" disabled={Boolean(busyAction)} onClick={sendReportToBot}>
            {busyAction === 'bot' ? '...' : t('reports.sendToBot')}
          </button>
        </div>
      </div>

      {status && <div className={status === t('common.saved') || status === t('reports.sentToBot') ? 'success-banner' : 'error-banner'}>{status}</div>}

      {showCodeModal && (
        <CodeChangeModal
          t={t}
          oldDeleteCode={oldDeleteCode}
          newDeleteCode={newDeleteCode}
          setOldDeleteCode={setOldDeleteCode}
          setNewDeleteCode={setNewDeleteCode}
          busy={busyAction === 'code'}
          onSave={changeDeleteCode}
          onClose={() => setShowCodeModal(false)}
        />
      )}

      <div className="card danger-card">
        <div className="section-title compact danger-text">{t('settings.dangerZone')}</div>
        <div className="danger-targets">
          <button className="btn" onClick={() => setBulkTarget('clients')}>{t('settings.deleteClients')}</button>
          <button className="btn" onClick={() => setBulkTarget('services')}>{t('settings.deleteServices')}</button>
          <button className="btn" onClick={() => setBulkTarget('finance')}>{t('settings.deleteFinance')}</button>
          <button className="btn btn-danger" onClick={() => setBulkTarget('all')}>{t('settings.deleteAll')}</button>
        </div>
      </div>

      {bulkTarget && (
        <ConfirmDeleteModal
          title={t('settings.dangerZone')}
          message={`${t('settings.deleteData')}: ${targetLabel(bulkTarget, t)}`}
          onExport={() => downloadReport('pdf')}
          onClose={() => setBulkTarget(null)}
          onConfirm={async (code) => {
            await api.post('/data/delete', { target: bulkTarget, code });
            setBulkTarget(null);
          }}
        />
      )}

      {showRestore && <RestoreModal t={t} onClose={() => setShowRestore(false)} />}
    </div>
  );
}

function CodeChangeModal({ t, oldDeleteCode, newDeleteCode, setOldDeleteCode, setNewDeleteCode, busy, onSave, onClose }) {
  return (
    <Modal title={t('settings.changeCode')} onClose={onClose}>
      <label className="label">{t('settings.currentCode')}</label>
      <input
        className="input"
        type="password"
        inputMode="numeric"
        value={oldDeleteCode}
        onChange={(e) => setOldDeleteCode(e.target.value)}
      />
      <label className="label">{t('settings.newCode')}</label>
      <input
        className="input"
        type="password"
        inputMode="numeric"
        maxLength="4"
        value={newDeleteCode}
        onChange={(e) => setNewDeleteCode(e.target.value)}
      />
      <button className="btn btn-primary btn-block" onClick={onSave} disabled={busy || !oldDeleteCode || !newDeleteCode}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}

function reminderPresets(t) {
  return [
    { minutes: 1440, label: t('settings.oneDayBefore') },
    { minutes: 60, label: t('settings.oneHourBefore') },
    { minutes: 0, label: t('settings.onTime') },
  ];
}

function AddReminder({ t, onAdd }) {
  const [value, setValue] = useState(1);
  const [unit, setUnit] = useState('hours');

  const add = () => {
    const v = parseInt(value, 10) || 0;
    const minutes = unit === 'days' ? v * 1440 : unit === 'hours' ? v * 60 : v;
    onAdd(minutes);
  };

  return (
    <div className="search-box">
      <input className="input" type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} style={{ flex: '0 0 76px' }} />
      <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
        <option value="minutes">{t('settings.minutesBefore')}</option>
        <option value="hours">{t('settings.hoursBefore')}</option>
        <option value="days">{t('settings.daysBefore')}</option>
      </select>
      <button className="btn btn-primary" onClick={add}>
        +
      </button>
    </div>
  );
}

function RestoreModal({ t, onClose }) {
  const [data, setData] = useState(null);
  const [clientForRestore, setClientForRestore] = useState(null);

  const load = async () => {
    try {
      setData(await api.get('/system/deleted'));
    } catch {
      setData({ clients: [], services: [], transactions: [], clientRestoreServices: [] });
    }
  };

  useEffect(() => {
    load();
  }, []);

  const restore = async (type, id) => {
    await api.post('/system/restore', { type, id });
    load();
  };

  return (
    <Modal title={t('settings.deletedItems')} onClose={onClose}>
      {!data ? (
        <div className="muted center">{t('common.loading')}</div>
      ) : (
        <>
          {data.clients?.length > 0 && (
            <>
              <div className="section-title">{t('clients.title')}</div>
              {data.clients.map((client) => (
                <DeletedRow
                  key={client._id}
                  title={client.name}
                  subtitle={`${t('settings.deletedAt')}: ${formatDate(client.deletedAt)}`}
                  onRestore={() => setClientForRestore(client)}
                  t={t}
                />
              ))}
            </>
          )}
          <DeletedSection title={t('services.title')} items={data.services} t={t} onRestore={(item) => restore('service', item._id)} render={(s) => s.clientName || s.location?.address || '-'} />
          <DeletedSection title={t('finance.transactions')} items={data.transactions} t={t} onRestore={(item) => restore('transaction', item._id)} render={(tx) => `${tx.type} - ${tx.amount}`} />
          {isEmptyDeleted(data) && <div className="empty">{t('common.noData')}</div>}
        </>
      )}

      {clientForRestore && (
        <ClientRestoreModal
          client={clientForRestore}
          services={(data?.clientRestoreServices || []).filter((service) => service.clientId === clientForRestore._id)}
          t={t}
          onClose={() => setClientForRestore(null)}
          onDone={() => {
            setClientForRestore(null);
            load();
          }}
        />
      )}
    </Modal>
  );
}

function ClientRestoreModal({ client, services, t, onClose, onDone }) {
  const [selected, setSelected] = useState(services.map((service) => service._id));
  // Tiklashdan oldin tahrirlash: { [id]: { serviceDateTime(local), price } }
  const [edits, setEdits] = useState(() =>
    Object.fromEntries(
      services.map((s) => [s._id, { serviceDateTime: toLocalInput(s.serviceDateTime), price: s.price ?? '' }])
    )
  );
  const [busy, setBusy] = useState(false);

  const toggle = (id) => {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  };

  const setEdit = (id, field, value) => {
    setEdits((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  };

  const restore = async () => {
    setBusy(true);
    try {
      const serviceEdits = {};
      for (const id of selected) {
        const e = edits[id] || {};
        const entry = {};
        if (e.serviceDateTime) {
          const d = new Date(e.serviceDateTime);
          if (!Number.isNaN(d.getTime())) entry.serviceDateTime = d.toISOString();
        }
        if (e.price !== '' && e.price !== null && e.price !== undefined) entry.price = Number(e.price);
        if (Object.keys(entry).length) serviceEdits[id] = entry;
      }
      await api.post('/system/restore', { clientId: client._id, serviceIds: selected, serviceEdits });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={client.name} onClose={onClose}>
      {services.length === 0 ? (
        <div className="muted mb-8">{t('services.noServices')}</div>
      ) : (
        services.map((service) => {
          const isSelected = selected.includes(service._id);
          return (
            <div key={service._id} className="restore-item">
              <label className="restore-check">
                <span>{service.clientName || client.name} - {formatDate(service.serviceDateTime)}</span>
                <input type="checkbox" checked={isSelected} onChange={() => toggle(service._id)} />
              </label>
              {isSelected && (
                <div className="restore-edit">
                  <label className="label">{t('common.date')}</label>
                  <input
                    className="input"
                    type="datetime-local"
                    value={edits[service._id]?.serviceDateTime || ''}
                    onChange={(e) => setEdit(service._id, 'serviceDateTime', e.target.value)}
                  />
                  <label className="label">{t('common.price')}</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={edits[service._id]?.price ?? ''}
                    onChange={(e) => setEdit(service._id, 'price', e.target.value)}
                  />
                </div>
              )}
            </div>
          );
        })
      )}
      <button className="btn btn-primary btn-block mt-12" onClick={restore} disabled={busy}>
        {busy ? '...' : t('settings.restore')}
      </button>
    </Modal>
  );
}

// ISO -> datetime-local input qiymati (YYYY-MM-DDTHH:mm).
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function DeletedSection({ title, items = [], t, onRestore, render }) {
  if (!items.length) return null;
  return (
    <>
      <div className="section-title">{title}</div>
      {items.map((item) => (
        <DeletedRow
          key={item._id}
          title={render(item)}
          subtitle={`${t('settings.deletedAt')}: ${formatDate(item.deletedAt)}`}
          onRestore={() => onRestore(item)}
          t={t}
        />
      ))}
    </>
  );
}

function DeletedRow({ title, subtitle, onRestore, t }) {
  return (
    <div className="list-item restore-row">
      <div>
        <div className="title">{title}</div>
        <div className="sub">{subtitle}</div>
      </div>
      <button className="btn btn-sm btn-primary" onClick={onRestore}>
        {t('settings.restore')}
      </button>
    </div>
  );
}

function offsetLabel(minutes, t) {
  if (minutes === 0) return t('settings.onTime');
  if (minutes % 1440 === 0) return `${minutes / 1440} ${t('settings.daysBefore')}`;
  if (minutes % 60 === 0) return `${minutes / 60} ${t('settings.hoursBefore')}`;
  return `${minutes} ${t('settings.minutesBefore')}`;
}

function targetLabel(target, t) {
  if (target === 'clients') return t('clients.title');
  if (target === 'services') return t('services.title');
  if (target === 'finance') return t('finance.title');
  return t('settings.deleteAll');
}

function isEmptyDeleted(data) {
  return !data.clients?.length && !data.services?.length && !data.transactions?.length;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
