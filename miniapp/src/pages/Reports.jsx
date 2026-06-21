import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';

const REPORT_TYPES = ['clients', 'finance', 'full'];
const LIMITS = [10, 25, 50, 'all'];

export default function Reports() {
  const { t, lang } = useApp();
  const [reportType, setReportType] = useState('full');
  const [periodMode, setPeriodMode] = useState('month');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [limit, setLimit] = useState(25);
  const [busyAction, setBusyAction] = useState('');
  const [message, setMessage] = useState('');

  const payload = useMemo(
    () => ({
      reportType,
      language: lang,
      limit: limit === 'all' ? 1000 : limit,
      month: periodMode === 'month' ? month : null,
      dateRange: periodMode === 'range' ? { start, end } : null,
    }),
    [end, lang, limit, month, periodMode, reportType, start]
  );

  const download = async (format) => {
    const ext = format === 'excel' ? 'xlsx' : 'pdf';
    setBusyAction(format);
    setMessage('');
    try {
      const res = await api.post(`/reports/${format === 'excel' ? 'excel' : 'pdf'}`, payload);
      const blob = await res.blob();
      saveBlob(blob, `hisobot-${reportType}-${periodMode === 'month' ? month : periodMode}.${ext}`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusyAction('');
    }
  };

  const sendToBot = async (format = 'pdf') => {
    setBusyAction(`bot-${format}`);
    setMessage('');
    try {
      await api.post('/reports/send', { ...payload, format });
      setMessage(t('reports.sentToBot'));
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div>
      <h1 className="page-title">{t('reports.title')}</h1>

      <div className="card report-panel">
        <div className="section-title compact">{t('reports.type')}</div>
        <div className="segment">
          {REPORT_TYPES.map((type) => (
            <button key={type} className={reportType === type ? 'active' : ''} onClick={() => setReportType(type)}>
              {t(`reports.${type}`)}
            </button>
          ))}
        </div>

        <div className="section-title compact">{t('reports.period')}</div>
        <div className="segment">
          <button className={periodMode === 'range' ? 'active' : ''} onClick={() => setPeriodMode('range')}>
            {t('reports.range')}
          </button>
          <button className={periodMode === 'limit' ? 'active' : ''} onClick={() => setPeriodMode('limit')}>
            {t('reports.latest')}
          </button>
          <button className={periodMode === 'month' ? 'active' : ''} onClick={() => setPeriodMode('month')}>
            {t('reports.month')}
          </button>
        </div>

        {periodMode === 'range' && (
          <div className="date-range">
            <div>
              <label className="label">{t('reports.start')}</label>
              <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label className="label">{t('reports.end')}</label>
              <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        )}

        {periodMode === 'limit' && (
          <>
            <label className="label">{t('reports.limit')}</label>
            <div className="segment">
              {LIMITS.map((item) => (
                <button key={item} className={limit === item ? 'active' : ''} onClick={() => setLimit(item)}>
                  {item === 'all' ? t('finance.all') : item}
                </button>
              ))}
            </div>
          </>
        )}

        {periodMode === 'month' && (
          <>
            <label className="label">{t('reports.month')}</label>
            <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </>
        )}

        {message && <div className={message === t('reports.sentToBot') ? 'success-banner' : 'error-banner'}>{message}</div>}

        <div className="action-grid">
          <button className="btn btn-primary" onClick={() => download('pdf')} disabled={Boolean(busyAction)}>
            {busyAction === 'pdf' ? '...' : t('reports.downloadPdf')}
          </button>
          <button className="btn" onClick={() => download('excel')} disabled={Boolean(busyAction)}>
            {busyAction === 'excel' ? '...' : t('reports.downloadExcel')}
          </button>
          <button className="btn btn-block" onClick={() => sendToBot('pdf')} disabled={Boolean(busyAction)}>
            {busyAction === 'bot-pdf' ? '...' : t('reports.sendToBot')}
          </button>
        </div>
      </div>
    </div>
  );
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
