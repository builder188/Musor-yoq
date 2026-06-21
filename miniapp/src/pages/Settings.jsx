import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { LANGUAGES } from '../i18n/index.js';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import { formatDate } from '../utils/format.js';

export default function Settings() {
  const { t, lang, setLang, theme, setTheme, settings, setSettings } = useApp();
  const [bulkTarget, setBulkTarget] = useState(null);
  const [showRestore, setShowRestore] = useState(false);
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

  const changeDeleteCode = async () => {
    setBusyAction('code');
    setStatus('');
    try {
      const s = await api.put('/settings/change-code', { currentCode: oldDeleteCode, newCode: newDeleteCode });
      setSettings(s);
      setOldDeleteCode('');
      setNewDeleteCode('');
      setStatus(t('common.saved'));
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

  return (
    <div>
      <h1 className="page-title">{t('settings.title')}</h1>

      <div className="card">
        <div className="section-title compact">{t('settings.appearance')}</div>
        <label className="label">{t('settings.language')}</label>
        <div className="segment">
          {LANGUAGES.map((l) => (
            <button key={l.code} className={lang === l.code ? 'active' : ''} onClick={() => setLang(l.code)}>
              {l.label}
            </button>
          ))}
        </div>
        <label className="label">{t('settings.theme')}</label>
        <div className="segment">
          <button className={theme === 'auto' ? 'active' : ''} onClick={() => setTheme('auto')}>
            🔄 {t('settings.auto')}
          </button>
          <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>
            ☀️ {t('settings.light')}
          </button>
          <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
            🌙 {t('settings.dark')}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="section-title compact">{t('settings.reminders')}</div>
        <div className="chip-list">
          {offsets.length === 0 && <span className="muted">-</span>}
          {offsets.map((m) => (
            <span key={m} className="badge badge-done badge-action">
              {offsetLabel(m, t)}
              <button onClick={() => updateOffsets(offsets.filter((x) => x !== m))} aria-label={t('common.delete')}>
                x
              </button>
            </span>
          ))}
        </div>
        <AddReminder t={t} onAdd={(m) => updateOffsets([...offsets, m])} />
      </div>

      <div className="card">
        <div className="section-title compact">{t('settings.security')}</div>
        <label className="label">{t('settings.currentCode')}</label>
        <input className="input" type="password" inputMode="numeric" value={oldDeleteCode} onChange={(e) => setOldDeleteCode(e.target.value)} />
        <label className="label">{t('settings.newCode')}</label>
        <input className="input" type="password" inputMode="numeric" maxLength="4" value={newDeleteCode} onChange={(e) => setNewDeleteCode(e.target.value)} />
        <button className="btn btn-block" onClick={changeDeleteCode} disabled={busyAction === 'code' || !oldDeleteCode || !newDeleteCode}>
          {busyAction === 'code' ? '...' : t('settings.changeCode')}
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

      <div className="card danger-card">
        <div className="section-title compact danger-text">{t('settings.dangerZone')}</div>
        <div className="danger-targets">
          <button className="btn" onClick={() => setBulkTarget('clients')}>{t('settings.deleteClients')}</button>
          <button className="btn" onClick={() => setBulkTarget('services')}>{t('settings.deleteServices')}</button>
          <button className="btn" onClick={() => setBulkTarget('finance')}>{t('settings.deleteFinance')}</button>
          <button className="btn btn-danger" onClick={() => setBulkTarget('all')}>{t('settings.deleteAll')}</button>
        </div>
        <button className="btn btn-block mt-12" onClick={() => setShowRestore(true)}>
          {t('settings.deletedItems')}
        </button>
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
  const [busy, setBusy] = useState(false);

  const toggle = (id) => {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  };

  const restore = async () => {
    setBusy(true);
    try {
      await api.post('/system/restore', { clientId: client._id, serviceIds: selected });
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
        services.map((service) => (
          <label key={service._id} className="restore-check">
            <span>{service.clientName || client.name} - {formatDate(service.serviceDateTime)}</span>
            <input type="checkbox" checked={selected.includes(service._id)} onChange={() => toggle(service._id)} />
          </label>
        ))
      )}
      <button className="btn btn-primary btn-block mt-12" onClick={restore} disabled={busy}>
        {busy ? '...' : t('settings.restore')}
      </button>
    </Modal>
  );
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
