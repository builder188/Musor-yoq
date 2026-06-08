// Sozlamalar sahifasi: til/mavzu, eslatmalar, hisobotlar, xavfli zona.
import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { LANGUAGES } from '../i18n/index.js';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';

export default function Settings() {
  const { t, lang, setLang, theme, setTheme, settings, setSettings } = useApp();
  const [bulkTarget, setBulkTarget] = useState(null);
  const [showRestore, setShowRestore] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);

  const offsets = settings?.reminderOffsetsMinutes || [];

  const updateOffsets = async (next) => {
    const cleaned = Array.from(new Set(next.filter((n) => n >= 0))).sort((a, b) => b - a);
    const s = await api.put('/settings', { reminderOffsetsMinutes: cleaned });
    setSettings(s);
  };

  const downloadReport = async (period) => {
    setReportBusy(true);
    try {
      const res = await api.post('/reports/pdf', { period });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hisobot-${period}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message);
    } finally {
      setReportBusy(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">{t('settings.title')}</h1>

      {/* Til */}
      <div className="card">
        <div className="mb-8">
          <strong>{t('settings.language')}</strong>
        </div>
        <div className="segment" style={{ margin: 0 }}>
          {LANGUAGES.map((l) => (
            <button key={l.code} className={lang === l.code ? 'active' : ''} onClick={() => setLang(l.code)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mavzu */}
      <div className="card">
        <div className="mb-8">
          <strong>{t('settings.theme')}</strong>
        </div>
        <div className="segment" style={{ margin: 0 }}>
          <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>
            ☀️ {t('settings.light')}
          </button>
          <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
            🌙 {t('settings.dark')}
          </button>
        </div>
      </div>

      {/* Eslatmalar */}
      <div className="card">
        <div className="mb-8">
          <strong>{t('settings.reminderTimes')}</strong>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {offsets.length === 0 && <span className="muted">—</span>}
          {offsets.map((m) => (
            <span key={m} className="badge badge-done" style={{ display: 'inline-flex', gap: 6 }}>
              {offsetLabel(m, t)}
              <span style={{ cursor: 'pointer' }} onClick={() => updateOffsets(offsets.filter((x) => x !== m))}>
                ×
              </span>
            </span>
          ))}
        </div>
        <AddReminder t={t} onAdd={(m) => updateOffsets([...offsets, m])} />
      </div>

      {/* Hisobotlar */}
      <div className="card">
        <div className="mb-8">
          <strong>{t('settings.reports')}</strong>
        </div>
        <div className="btn-row" style={{ flexWrap: 'wrap' }}>
          {['month', 'last_month', 'year', 'all'].map((p) => (
            <button key={p} className="btn btn-sm" disabled={reportBusy} onClick={() => downloadReport(p)}>
              📄 {t(`finance.${p === 'last_month' ? 'lastMonth' : p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Xavfli zona */}
      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <div className="mb-8">
          <strong style={{ color: 'var(--danger)' }}>⚠️ {t('settings.dangerZone')}</strong>
        </div>
        <button className="btn btn-block mb-8" onClick={() => setShowRestore(true)}>
          ♻️ {t('settings.deletedItems')}
        </button>
        <button className="btn btn-block mb-8" onClick={() => setBulkTarget('clients')}>
          {t('settings.deleteClients')}
        </button>
        <button className="btn btn-block mb-8" onClick={() => setBulkTarget('services')}>
          {t('settings.deleteServices')}
        </button>
        <button className="btn btn-block mb-8" onClick={() => setBulkTarget('finance')}>
          {t('settings.deleteFinance')}
        </button>
        <button className="btn btn-danger btn-block" onClick={() => setBulkTarget('all')}>
          {t('settings.deleteAll')}
        </button>
      </div>

      {bulkTarget && (
        <ConfirmDeleteModal
          title={t('settings.dangerZone')}
          message={`${t(`settings.delete${cap(bulkTarget)}`)} — ${t('common.confirm')}?`}
          onClose={() => setBulkTarget(null)}
          onConfirm={async (code) => {
            await api.post('/system/bulk-delete', { target: bulkTarget, confirmationCode: code });
            setBulkTarget(null);
          }}
        />
      )}

      {showRestore && <RestoreModal t={t} onClose={() => setShowRestore(false)} />}
    </div>
  );
}

function offsetLabel(minutes, t) {
  if (minutes === 0) return t('common.date');
  if (minutes % 1440 === 0) return `${minutes / 1440} ${t('settings.daysBefore')}`;
  if (minutes % 60 === 0) return `${minutes / 60} ${t('settings.hoursBefore')}`;
  return `${minutes} ${t('settings.minutesBefore')}`;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
    <div className="search-box" style={{ marginBottom: 0 }}>
      <input className="input" type="number" value={value} onChange={(e) => setValue(e.target.value)} style={{ flex: '0 0 70px' }} />
      <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ marginBottom: 0 }}>
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

  const load = async () => {
    try {
      setData(await api.get('/system/deleted'));
    } catch {
      setData({ clients: [], services: [], transactions: [] });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restore = async (type, id) => {
    await api.post('/system/restore', { type, id });
    load();
  };

  const Section = ({ title, items, type, render }) =>
    items && items.length > 0 ? (
      <>
        <div className="section-title">{title}</div>
        {items.map((it) => (
          <div key={it._id} className="list-item" style={{ cursor: 'default' }}>
            <div className="row-between">
              <div className="title">{render(it)}</div>
              <button className="btn btn-sm btn-primary" onClick={() => restore(type, it._id)}>
                ♻️ {t('settings.restore')}
              </button>
            </div>
          </div>
        ))}
      </>
    ) : null;

  return (
    <Modal title={t('settings.deletedItems')} onClose={onClose}>
      {!data ? (
        <div className="muted center">{t('common.loading')}</div>
      ) : (
        <>
          <Section title={t('clients.title')} items={data.clients} type="client" render={(c) => c.name} />
          <Section title={t('services.title')} items={data.services} type="service" render={(s) => s.clientName} />
          <Section
            title={t('finance.transactions')}
            items={data.transactions}
            type="transaction"
            render={(tx) => `${tx.type} · ${tx.amount}`}
          />
          {data.clients.length === 0 && data.services.length === 0 && data.transactions.length === 0 && (
            <div className="empty">{t('common.noData')}</div>
          )}
        </>
      )}
    </Modal>
  );
}
