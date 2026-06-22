import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatDate, formatPhone } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import ServiceDetailModal from '../components/ServiceDetailModal.jsx';

export default function Home({ onOpenClient }) {
  const { t } = useApp();
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [search, setSearch] = useState('');
  const [clients, setClients] = useState([]);
  const [searching, setSearching] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [selectedService, setSelectedService] = useState(null);

  const loadStats = () => {
    api
      .get('/stats/home')
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoadingStats(false));
  };

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setClients([]);
      return;
    }

    const timer = setTimeout(() => {
      setSearching(true);
      api
        .get(`/clients?search=${encodeURIComponent(q)}`)
        .then(normalizeClients)
        .then(setClients)
        .catch(() => setClients([]))
        .finally(() => setSearching(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div>
      <h1 className="page-title">{t('home.title')}</h1>

      <QuickStatsRow stats={stats} loading={loadingStats} />

      <FailedReminders items={stats?.failedReminders} onChange={loadStats} />

      <div className="search-box">
        <input
          className="input"
          placeholder={t('home.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <SearchResults clients={clients} searching={searching} onOpenClient={onOpenClient} />

      <FloatingAiButton onClick={() => setAiOpen(true)} />

      {aiOpen && <AiChatPanel onClose={() => setAiOpen(false)} onSelectService={setSelectedService} />}
      {selectedService && <ServiceDetailModal service={selectedService} onClose={() => setSelectedService(null)} />}
    </div>
  );
}

function QuickStatsRow({ stats, loading }) {
  const { t } = useApp();
  return (
    <div className="quick-stats">
      <div className="quick-stat">
        <span>📦</span>
        <div>
          <strong>{loading ? '...' : stats?.todayCount ?? 0}</strong>
          <small>{t('home.todayJobs')}</small>
        </div>
      </div>
      <div className="quick-stat">
        <span>💰</span>
        <div>
          <strong>{formatMoney(stats?.monthSummary?.balance ?? 0)}</strong>
          <small>{t('home.balance')}</small>
        </div>
      </div>
    </div>
  );
}

// 3 urinishdan keyin ham yuborilmagan eslatmalar — qo'lda hal qilish (qayta urinish / o'chirish).
function FailedReminders({ items, onChange }) {
  const { t } = useApp();
  const [busy, setBusy] = useState(null);
  if (!items?.length) return null;

  const act = async (item, action) => {
    const key = `${item.serviceId}:${item.reminderIndex}`;
    setBusy(key);
    try {
      if (action === 'retry') {
        await api.post(`/services/${item.serviceId}/reminders/${item.reminderIndex}/retry`);
      } else {
        await api.del(`/services/${item.serviceId}/reminders/${item.reminderIndex}`);
      }
      await onChange?.();
    } catch {
      /* xatolik — keyingi yuklashda yangilanadi */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card failed-reminders">
      <div className="row-between mb-8">
        <strong>⚠️ {t('home.failedTitle')} ({items.length})</strong>
      </div>
      <div className="muted mb-8">{t('home.failedDesc')}</div>
      {items.map((item) => {
        const key = `${item.serviceId}:${item.reminderIndex}`;
        return (
          <div key={key} className="list-item">
            <div className="title">{item.clientName || '-'}</div>
            <div className="sub">
              {formatPhone(item.clientPhone)} · {formatDate(item.serviceDateTime)}
              {item.location?.address ? ` · ${item.location.address}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={busy === key}
                onClick={() => act(item, 'retry')}
              >
                {t('home.retry')}
              </button>
              <button
                className="btn btn-sm"
                disabled={busy === key}
                onClick={() => act(item, 'dismiss')}
              >
                {t('home.dismiss')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SearchResults({ clients, searching, onOpenClient }) {
  const { t } = useApp();
  if (searching) return <Spinner />;
  if (!clients.length) return null;

  return (
    <div className="card">
      <div className="row-between mb-8">
        <strong>{clients.length} {t('ui.clientsCount')}</strong>
      </div>
      {clients.map((client) => (
        <ClientCard key={client._id} client={client} onOpen={() => onOpenClient?.(client._id)} />
      ))}
    </div>
  );
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
      {debt > 0 && <div className="sub debt-text">{formatMoney(debt)}</div>}
    </div>
  );
}

function FloatingAiButton({ onClick }) {
  return (
    <button className="floating-ai" onClick={onClick} aria-label="AI yordamchi">
      ✨
    </button>
  );
}

function AiChatPanel({ onClose, onSelectService }) {
  const { t } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const send = async () => {
    const text = input.trim();
    if (!text || thinking) return;

    setInput('');
    const botIndex = messages.length + 1;
    setMessages((m) => [...m, { role: 'user', text }, { role: 'bot', text: t('home.aiThinking'), results: [] }]);
    setThinking(true);

    try {
      await api.streamPost('/ai/search', { message: text }, (event, data) => {
        if (event === 'progress') {
          setMessages((m) => m.map((item, index) => (index === botIndex ? { ...item, text: data.text } : item)));
        }
        if (event === 'result') {
          setMessages((m) =>
            m.map((item, index) =>
              index === botIndex ? { role: 'bot', text: data.reply, results: data.results || [] } : item
            )
          );
        }
      });
    } catch (e) {
      setMessages((m) => [...m, { role: 'bot', text: `⚠️ ${e.message}` }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="modal-overlay ai-overlay" onClick={onClose}>
      <div className="modal ai-chat" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">✨ AI yordamchi</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="ai-messages">
          {messages.length === 0 && <div className="muted center">{t('home.aiPlaceholder')}</div>}
          {messages.map((m, i) => (
            <div key={i}>
              <div className={`ai-bubble ${m.role}`}>{m.text}</div>
              {(m.results || []).length > 0 && (
                <div className="mt-8">
                  {m.results.map((service) => (
                    <button key={service._id} className="ai-result" onClick={() => onSelectService(service)}>
                      <div className="title">{service.clientName}</div>
                      <div className="sub">
                        {formatDate(service.serviceDateTime)} · {service.location?.address || '-'} · {formatMoney(service.price)}
                      </div>
                    </button>
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
          <div ref={endRef} />
        </div>

        <div className="search-box" style={{ margin: 0 }}>
          <input
            className="input"
            placeholder={t('home.aiPlaceholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button className="btn btn-primary" onClick={send} disabled={thinking}>
            {t('home.ask')}
          </button>
        </div>
      </div>
    </div>
  );
}

function normalizeClients(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}
