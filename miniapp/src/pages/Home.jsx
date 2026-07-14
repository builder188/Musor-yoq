// Bosh sahifa — DASHBOARD (jadval EMAS): kun/vaqt, CBU kursi, umumiy balans,
// "hozir kimga borish kerak" kartasi, bugungi xizmatlar (holat yorliqlari bilan),
// shu oy kirim/chiqim, to'lanmagan jarima ogohlantirishi va mijoz qidiruvi.
// Hamma bo'lim mavjud backend funksiyalaridan (/stats/home bitta so'rovda yig'adi).
import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatPhone, formatDateTime, formatTime, formatWeekdayDate } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import ServiceDetailModal from '../components/ServiceDetailModal.jsx';
import LocationDisplay from '../components/LocationDisplay.jsx';
import LoadError from '../components/LoadError.jsx';

// Eslatma: AI chat paneli OLIB TASHLANDI — u backend'da yozuv amallarini tasdiqsiz
// bajara olardi. Tabiiy-til muloqot faqat botda; bu yerda deterministik qidiruv qoladi.
export default function Home({ onOpenClient, goToTab, onAddClient }) {
  const { t, lang } = useApp();
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [search, setSearch] = useState('');
  const [clients, setClients] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedService, setSelectedService] = useState(null);
  const [completingServiceId, setCompletingServiceId] = useState(null);
  const now = useNow();

  const loadStats = () => {
    return api
      .get('/stats/home')
      .then((s) => {
        setStats(s);
        setStatsError(false);
      })
      // Xato jim yutilmasin — banner ko'rsatamiz (ma'lumot bazada turibdi).
      .catch(() => setStatsError(true))
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
      {statsError && <LoadError onRetry={loadStats} />}

      {/* 1) Sana va vaqt (jonli) + 2) dollar kursi */}
      <div className="greeting">
        <div>
          <div className="greet-date">
            {formatWeekdayDate(now, lang)} · {formatTime(now)}
          </div>
          <div className="greet-hello">{t('home.greeting')}</div>
          <RateChip />
        </div>
        <button className="icon-btn" aria-label={t('settings.title')} onClick={() => goToTab?.('settings')}>
          ⚙️
        </button>
      </div>

      {/* 3) Joriy balans — katta raqam (BARCHA VAQT bo'yicha) */}
      <div className="balance-hero">
        <div className="bh-label">{t('finance.balanceNow')}</div>
        <div className={`bh-amount ${Number(stats?.balance ?? 0) < 0 ? 'negative' : ''}`}>
          {loadingStats ? '…' : formatNumber(stats?.balance ?? 0)} <span className="unit">{t('common.soum')}</span>
        </div>
      </div>

      {/* 4) Hozir kimga borish kerak? — so'rovsiz, darhol */}
      <NextClientCard nextClient={stats?.nextClient} loading={loadingStats} onOpen={setSelectedService} />

      {/* 7) To'lanmagan jarima — faqat bor bo'lsa ko'rinadi */}
      {stats?.unpaidFines?.count > 0 && (
        <div className="fine-alert" onClick={() => goToTab?.('reminders')}>
          ⚠️ {t('reminders.fineUnpaid')}: {stats.unpaidFines.count} {t('home.countSuffix')}
          {stats.unpaidFines.total > 0 ? ` · ${formatMoney(stats.unpaidFines.total)}` : ''}
        </div>
      )}

      {/* 8) Mijozlar qidiruvi — ism/telefon/manzil/summa (universal qidiruv mantig'i) */}
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
        <>
          {/* 5) Bugungi BARCHA xizmatlar — holat yorliqlari bilan */}
          <TodayServices
            items={stats?.todayServices || []}
            loading={loadingStats}
            busyId={completingServiceId}
            onOpenService={setSelectedService}
            onComplete={completeTodayService}
          />

          {/* 6) Bu oyning moliyaviy xulosasi: kirim va chiqim ALOHIDA */}
          <MonthSummary summary={stats?.monthSummary} t={t} />
        </>
      )}

      {selectedService && <ServiceDetailModal service={selectedService} onClose={() => setSelectedService(null)} />}
    </div>
  );
}

// Jonli soat: har 30 soniyada yangilanadi (sana yarim tunda, vaqt doim to'g'ri turadi).
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// "Hozir kimga borish kerak?" — backend getNextClient (bugungi kutilayotgan xizmatlardan
// vaqtga eng yaqini). Bo'lmasa — bugungi ishlar tugagan.
function NextClientCard({ nextClient, loading, onOpen }) {
  const { t, lang } = useApp();
  if (loading) return null;
  if (!nextClient) {
    return (
      <div className="card next-client done">
        <div className="next-title">{t('home.nextClientTitle')}</div>
        <div className="next-done">{t('home.allDoneToday')}</div>
      </div>
    );
  }
  return (
    <div className="card next-client" onClick={() => onOpen?.(nextClient)}>
      <div className="next-title">{t('home.nextClientTitle')}</div>
      <div className="job-card" style={{ paddingTop: 8 }}>
        <div className="avatar">{(nextClient.clientName || '?').trim().charAt(0).toUpperCase() || '?'}</div>
        <div className="job-main">
          <div className="job-name">{nextClient.clientName || '-'}</div>
          <div className="job-sub">
            {formatTime(nextClient.serviceDateTime)}
            {nextClient.location?.address ? (
              <>
                {' · '}
                <LocationDisplay location={nextClient.location} inline />
              </>
            ) : null}
          </div>
          {nextClient.price > 0 && <div className="job-price">{formatMoney(nextClient.price)}</div>}
        </div>
        <span className="chevron">›</span>
      </div>
    </div>
  );
}

// Bu oy: kirim (yashil, barcha manbalar jami) va chiqim (qizil) alohida.
function MonthSummary({ summary, t }) {
  const income = Number(summary?.income ?? summary?.totalIncome ?? 0);
  const expense = Number(summary?.expense ?? summary?.totalExpense ?? 0);
  return (
    <div style={{ marginTop: 14 }}>
      <div className="section-head">
        <div className="sec-title">{t('home.monthSummary')}</div>
      </div>
      <div className="io-row">
        <div className="io-card">
          <div className="io-head">
            <div className="io-badge in">↑</div>
            <span className="io-label">{t('finance.income')}</span>
          </div>
          <div className="io-value in">+{formatNumber(income)}</div>
        </div>
        <div className="io-card">
          <div className="io-head">
            <div className="io-badge out">↓</div>
            <span className="io-label">{t('finance.expense')}</span>
          </div>
          <div className="io-value out">−{formatNumber(expense)}</div>
        </div>
      </div>
    </div>
  );
}

// Birlik ("so'm")siz raqam: 2 340 000.
function formatNumber(n) {
  return Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Bosh sahifada kichik real-time dollar kursi (CBU). 12 soatlik kesh — serverda.
function RateChip() {
  const { lang } = useApp();
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/exchange-rate').then((d) => { if (alive) setInfo(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!info?.usdToUzsRate) return null;
  const title = info.rateUpdatedAt ? `Yangilangan: ${formatDateTime(info.rateUpdatedAt, lang)} (CBU)` : 'Markaziy bank kursi (CBU)';
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

// Bugungi xizmat kartasi: HAR BIRIDA aniq rangli holat yorlig'i; kutilayotganida
// tezkor "bajarildi" tugmasi ham qoladi.
function TodayServiceCard({ service, busy, onOpen, onComplete }) {
  const { t } = useApp();
  const isDone = service.status === 'bajarildi';
  const isCancelled = service.status === 'bekor_qilindi';
  const initial = (service.clientName || '?').trim().charAt(0).toUpperCase() || '?';
  const badge = isDone ? 'done' : isCancelled ? 'cancelled' : 'pending';

  const stopAndComplete = (e) => {
    e.stopPropagation();
    onComplete?.();
  };

  return (
    <div className={`list-item ${isDone ? 'is-done' : ''}`} onClick={onOpen}>
      <div className={`job-card ${isDone ? 'is-done' : ''}`}>
        <div className="avatar">{initial}</div>
        <div className="job-main">
          <div className="job-name">
            {service.clientName || '-'}{' '}
            <span className={`badge badge-${badge}`}>{t(`status.${service.status || 'kutilmoqda'}`)}</span>
          </div>
          <div className="job-sub">
            {formatTime(service.serviceDateTime)}
            {service.location?.address ? (
              <>
                {' · '}
                <LocationDisplay location={service.location} inline />
              </>
            ) : null}
          </div>
          <div className="job-price">{formatMoney(service.price)}</div>
        </div>
        {isDone ? (
          <div className="check-circle done" aria-label={t('status.bajarildi')}>
            ✓
          </div>
        ) : isCancelled ? null : (
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

function ClientCard({ client, onOpen }) {
  const { t, lang } = useApp();
  const lastServiceAt = client.lastServiceAt || client.services?.[0]?.serviceDateTime;
  const debt = client.currentDebt || client.unpaidTotal || client.totalDebt || client.unpaidAmount;

  return (
    <div className={`list-item ${client.isDeleted ? 'deleted-item' : ''}`} onClick={onOpen}>
      <div className="row-between">
        <div className="title">{client.name}</div>
        {client.isDeleted && <span className="badge badge-muted">{t('ui.deleted')}</span>}
      </div>
      <div className="sub">{formatPhone(client.phone)}</div>
      {lastServiceAt && <div className="sub">{t('ui.lastService')}: {formatDateTime(lastServiceAt, lang)}</div>}
      {debt > 0 && <div className="sub debt-text">{formatMoney(debt)}</div>}
    </div>
  );
}

function normalizeClients(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}
