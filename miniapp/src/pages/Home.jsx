import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatDate, formatPhone, formatDateTime } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import ServiceDetailModal from '../components/ServiceDetailModal.jsx';
import { useNavigationView } from '../components/useNavigationView.js';

export default function Home({ onOpenClient, goToTab, onAddClient }) {
  const { t, lang } = useApp();
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [search, setSearch] = useState('');
  const [clients, setClients] = useState([]);
  const [searching, setSearching] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [selectedService, setSelectedService] = useState(null);
  const [completingServiceId, setCompletingServiceId] = useState(null);

  const loadStats = () => {
    return api
      .get('/stats/home')
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoadingStats(false));
  };

  useEffect(() => {
    loadStats();
  }, []);

  const completeTodayService = async (service) => {
    if (!service?._id || completingServiceId) return;
    setCompletingServiceId(service._id);
    try {
      await api.patch(`/services/${service._id}/complete`, { markPaid: true });
      await loadStats();
    } catch (e) {
      alert(e.message);
    } finally {
      setCompletingServiceId(null);
    }
  };

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
      <div className="greeting">
        <div>
          <div className="greet-date">{greetingDate(lang)}</div>
          <div className="greet-hello">{t('home.greeting')}</div>
          <RateChip />
        </div>
        <button className="icon-btn" aria-label={t('settings.title')} onClick={() => goToTab?.('settings')}>
          ⚙️
        </button>
      </div>

      <SummaryCard stats={stats} loading={loadingStats} />


      <div className="search">
        <span className="search-icon">🔍</span>
        <input
          placeholder={t('home.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <button className="btn btn-primary btn-block add-client-cta" onClick={() => onAddClient?.() || goToTab?.('clients')}>
        <span className="cta-plus">+</span>
        {t('home.addClientBig')}
      </button>

      <SearchResults clients={clients} searching={searching} onOpenClient={onOpenClient} />
      {!search.trim() && (
        <TodayServices
          items={stats?.todayServices || []}
          loading={loadingStats}
          busyId={completingServiceId}
          onOpenService={setSelectedService}
          onComplete={completeTodayService}
        />
      )}

      <FloatingAiButton onClick={() => setAiOpen(true)} />

      {aiOpen && <AiChatPanel onClose={() => setAiOpen(false)} onSelectService={setSelectedService} />}
      {selectedService && <ServiceDetailModal service={selectedService} onClose={() => setSelectedService(null)} />}
    </div>
  );
}

// Xulosa kartasi: 2 ustun — bugungi xizmatlar soni | joriy balans (yashil).
function SummaryCard({ stats, loading }) {
  const { t } = useApp();
  const count = loading ? '…' : stats?.todayCount ?? 0;
  const balance = stats?.monthSummary?.balance ?? 0;
  return (
    <div className="summary-card">
      <div className="summary-col">
        <div className="summary-label">{t('home.todayJobs')}</div>
        <div className="summary-value">
          {count} <span className="unit">{t('home.countSuffix')}</span>
        </div>
      </div>
      <div className="summary-divider" />
      <div className="summary-col wide">
        <div className="summary-label">{t('home.balanceNow')}</div>
        <div className="summary-value accent">{formatNumber(balance)}</div>
      </div>
    </div>
  );
}

// "Seshanba · 23-iyun" ko'rinishidagi sana.
const UZ_WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
function greetingDate(lang) {
  const d = new Date();
  if (lang === 'ru') {
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  }
  return `${UZ_WEEKDAYS[d.getDay()]} · ${d.getDate()}-${UZ_MONTHS[d.getMonth()]}`;
}

// Birlik ("so'm")siz raqam: 2 340 000.
function formatNumber(n) {
  return Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Bosh sahifada kichik real-time dollar kursi (CBU). 12 soatlik kesh — serverda.
function RateChip() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/exchange-rate').then((d) => { if (alive) setInfo(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!info?.usdToUzsRate) return null;
  const title = info.rateUpdatedAt ? `Yangilangan: ${formatDateTime(info.rateUpdatedAt)} (CBU)` : 'Markaziy bank kursi (CBU)';
  return (
    <div
      title={title}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 12, opacity: 0.7, fontWeight: 600 }}
    >
      💵 1$ = {formatNumber(info.usdToUzsRate)} so'm
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

function TodayServices({ items, loading, busyId, onOpenService, onComplete }) {
  const { t } = useApp();
  if (loading) return <Spinner />;

  return (
    <div className="today-list">
      <div className="section-head">
        <div className="sec-title">{t('home.todayJobs')}</div>
      </div>
      {items.length === 0 ? (
        <div className="empty">{t('services.noServices')}</div>
      ) : (
        items.map((service) => (
          <TodayServiceCard
            key={service._id}
            service={service}
            busy={busyId === service._id}
            onOpen={() => onOpenService?.(service)}
            onComplete={() => onComplete?.(service)}
          />
        ))
      )}
    </div>
  );
}

function TodayServiceCard({ service, busy, onOpen, onComplete }) {
  const { t } = useApp();
  const isDone = service.status === 'bajarildi';
  const isCancelled = service.status === 'bekor_qilindi';
  const initial = (service.clientName || '?').trim().charAt(0).toUpperCase() || '?';

  const stopAndComplete = (e) => {
    e.stopPropagation();
    onComplete?.();
  };

  return (
    <div className={`list-item ${isDone ? 'is-done' : ''}`} onClick={onOpen}>
      <div className={`job-card ${isDone ? 'is-done' : ''}`}>
        <div className="avatar">{initial}</div>
        <div className="job-main">
          <div className="job-name">{service.clientName || '-'}</div>
          <div className="job-sub">
            {formatTime(service.serviceDateTime)}
            {service.location?.address ? ` · ${service.location.address}` : ''}
          </div>
          <div className="job-price">{formatMoney(service.price)}</div>
        </div>
        {isDone ? (
          <div className="check-circle done" aria-label={t('status.bajarildi')}>
            ✓
          </div>
        ) : isCancelled ? (
          <span className="badge badge-cancelled">{t('status.bekor_qilindi')}</span>
        ) : (
          <button
            className="check-circle"
            aria-label={t('services.markDone')}
            disabled={busy}
            onClick={stopAndComplete}
          />
        )}
      </div>
    </div>
  );
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('uz-UZ', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
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
  const goBack = useNavigationView(t('home.aiChat'), onClose);
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
          <button className="modal-back" type="button" onClick={goBack} aria-label={t('common.back')}>
            <span aria-hidden="true">&larr;</span>
            <span className="modal-back-label">{t('common.back')}</span>
          </button>
          <div className="modal-title">✨ AI yordamchi</div>
          <button className="modal-close" type="button" onClick={onClose} aria-label={t('common.close')}>&times;</button>
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
