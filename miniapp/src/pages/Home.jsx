// Bosh sahifa: tezkor statistika + qidiruv + AI chat paneli.
import { useEffect, useState, useRef } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatDate } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import ServiceDetailModal from '../components/ServiceDetailModal.jsx';

export default function Home() {
  const { t } = useApp();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // AI chat holati.
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [selected, setSelected] = useState(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    api
      .get('/stats/home')
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const sendQuery = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setThinking(true);
    try {
      const res = await api.post('/ai/chat', { message: text });
      setMessages((m) => [...m, { role: 'bot', text: res.reply, results: res.results || [] }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'bot', text: `⚠️ ${e.message}` }]);
    } finally {
      setThinking(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <h1 className="page-title">{t('home.title')}</h1>

      {/* Tezkor statistika */}
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">{t('home.todayJobs')}</div>
          <div className="stat-value">{stats?.todayCount ?? 0}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('home.pendingJobs')}</div>
          <div className="stat-value">{stats?.pendingCount ?? 0}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('home.expectedIncome')}</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            {formatMoney(stats?.expectedIncome ?? 0)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('home.monthBalance')}</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            {formatMoney(stats?.monthSummary?.balance ?? 0)}
          </div>
        </div>
      </div>

      {/* AI chat paneli */}
      <div className="card ai-panel">
        <div className="row-between mb-8">
          <strong>🤖 {t('home.aiChat')}</strong>
        </div>

        <div className="ai-messages">
          {messages.length === 0 && <div className="muted center">{t('home.aiPlaceholder')}</div>}
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
              <div className={`ai-bubble ${m.role}`}>{m.text}</div>
              {m.results && m.results.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {m.results.slice(0, 10).map((s) => (
                    <div key={s._id} className="list-item" onClick={() => setSelected(s)}>
                      <div className="title">{s.clientName}</div>
                      <div className="sub">
                        {formatDate(s.serviceDateTime)} · {s.location?.text || '—'} ·{' '}
                        {formatMoney(s.price)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {thinking && (
            <div className="ai-bubble bot">
              <span className="thinking">
                <span></span>
                <span></span>
                <span></span>
              </span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="search-box">
          <input
            className="input"
            placeholder={t('home.aiPlaceholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendQuery()}
          />
          <button className="btn btn-primary" onClick={sendQuery} disabled={thinking}>
            {t('home.ask')}
          </button>
        </div>
      </div>

      {selected && <ServiceDetailModal service={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
