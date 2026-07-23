// Bosh sahifa — DASHBOARD (jadval EMAS): kun/vaqt, CBU kursi, umumiy balans,
// "hozir kimga borish kerak" kartasi (bosilsa Xizmatlar jadvalidagi qatorga o'tib
// yorug'lantiradi), xizmat qidiruvi (barcha ustunlar bo'yicha, natija bosilsa jadvalga
// o'tadi), "Yangi xizmat qo'shish" tugmasi, bugungi BARCHA xizmatlar (holat yorliqlari
// bilan) va uchta katak: Xizmat | Xarajat | Daromad (bu oy + foiz sur'ati).
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatPhone, formatDate, formatDateTime, formatTime, formatWeekdayDate } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import ServiceDetailModal from '../components/ServiceDetailModal.jsx';
import LocationDisplay from '../components/LocationDisplay.jsx';
import LoadError from '../components/LoadError.jsx';

// Eslatma: bu yerdagi AI chat OLIB TASHLANGAN edi (u tasdiqsiz TAHRIR/O'CHIRISH qila
// olardi). Endi Xizmatlar sahifasida CHEKLANGAN AI bor — u FAQAT yangi qator qo'shadi.
export default function Home({ goToTab }) {
  const { t, lang } = useApp();
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedService, setSelectedService] = useState(null);
  const [completingServiceId, setCompletingServiceId] = useState(null);
  // Qidiruv uchun BARCHA xizmatlar bir marta yuklanadi (kesh) — so'ng ism/tel/manzil/
  // summa/SANA/izoh bo'yicha mijoz tomonda filtrlaymiz (server regexi sanani qamramasdi).
  const allServicesRef = useRef(null);
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

  // Qidiruv uchun barcha xizmatlarni bir marta yuklab keshlaydi (Xizmatlar sahifasi ham
  // shunday to'liq yuklaydi). Keyingi barcha qidiruvlar shu keshdan mijoz tomonda ishlaydi.
  const ensureAllServices = async () => {
    if (allServicesRef.current) return allServicesRef.current;
    const list = normalizeServices(await api.get('/services'));
    allServicesRef.current = list;
    return list;
  };

  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setResults([]);
      return;
    }

    let cancelled = false;
    // Qidiruv Xizmatlar jadvalining BARCHA maydonlarida: ism / telefon / manzil / izoh /
    // summa / SANA (ko'rinadigan formatlangan matn bo'yicha).
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const list = await ensureAllServices();
        if (cancelled) return;
        setResults(list.filter((service) => matchesServiceQuery(service, q, lang)));
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, lang]);

  // Qatorni Xizmatlar jadvalida ochib, yorug'lantirib ko'rsatadi (qidirmasdan, to'g'ridan-to'g'ri).
  const openInServices = (service) => {
    if (!service?._id) return;
    goToTab?.('services', { focusServiceId: service._id, nonce: Date.now() });
  };

  return (
    <div>
      {statsError && <LoadError onRetry={loadStats} />}

      {/* 1) Sana va vaqt (jonli) + dollar kursi */}
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

      {/* 2) Joriy balans — katta raqam (BARCHA VAQT bo'yicha) */}
      <div className="balance-hero">
        <div className="bh-label">{t('finance.balanceNow')}</div>
        <div className={`bh-amount ${Number(stats?.balance ?? 0) < 0 ? 'negative' : ''}`}>
          {loadingStats ? '…' : formatNumber(stats?.balance ?? 0)} <span className="unit">{t('common.soum')}</span>
        </div>
      </div>

      {/* 3) Hozir kimga borish kerak? — bosilsa jadvaldagi qatorga o'tib yorug'lantiradi */}
      <NextClientCard nextClient={stats?.nextClient} loading={loadingStats} onOpen={openInServices} />

      {/* To'lanmagan jarima — faqat bor bo'lsa ko'rinadi */}
      {stats?.unpaidFines?.count > 0 && (
        <div className="fine-alert" onClick={() => goToTab?.('reminders')}>
          ⚠️ {t('reminders.fineUnpaid')}: {stats.unpaidFines.count} {t('home.countSuffix')}
          {stats.unpaidFines.total > 0 ? ` · ${formatMoney(stats.unpaidFines.total)}` : ''}
        </div>
      )}

      {/* 4) Xizmat qidiruvi — barcha ustunlar bo'yicha */}
      <div className="search">
        <span className="search-icon">🔍</span>
        <input
          placeholder={t('home.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* 5) Yangi xizmat qo'shish — Xizmatlar jadvaliga o'tib bo'sh qatorni ochadi */}
      <button
        className="btn btn-primary btn-block add-client-cta"
        onClick={() => goToTab?.('services', { openDraft: true, nonce: Date.now() })}
      >
        <span className="cta-plus">+</span>
        {t('home.addServiceBig')}
      </button>

      <SearchResults services={results} searching={searching} onOpenService={openInServices} />

      {!search.trim() && (
        <>
          {/* 6) Bugungi BARCHA xizmatlar — holat yorliqlari bilan */}
          <TodayServices
            items={stats?.todayServices || []}
            loading={loadingStats}
            busyId={completingServiceId}
            onOpenService={setSelectedService}
            onComplete={completeTodayService}
          />

          {/* 7) Uchta katak: Xizmat | Xarajat | Daromad (bu oy + foiz sur'ati) */}
          <PaceBoxes pace={stats?.pace} loading={loadingStats} goToTab={goToTab} t={t} />
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
  const { t } = useApp();
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
          {nextClient.clientPhone && <div className="job-sub">{formatPhone(nextClient.clientPhone)}</div>}
          {nextClient.price > 0 && <div className="job-price">{formatMoney(nextClient.price)}</div>}
        </div>
        <span className="chevron">›</span>
      </div>
    </div>
  );
}

// Bu oy: uchta katak — Xizmat (soni+summasi), Xarajat va Daromad (summa + o'tgan oyning
// shu kunigacha bo'lgan qismiga nisbatan FOIZ sur'ati). Har biri tegishli jadvalga o'tadi.
function PaceBoxes({ pace, loading, goToTab, t }) {
  const service = pace?.service || { count: 0, total: 0 };
  const expense = pace?.expense || { current: 0, pct: null };
  const income = pace?.income || { current: 0, pct: null };
  const dash = loading ? '…' : null;

  return (
    <div style={{ marginTop: 16 }}>
      <div className="section-head">
        <div className="sec-title">{t('home.monthOverview')}</div>
        <div className="sec-link" style={{ color: 'var(--text-faint)', fontWeight: 500 }}>{t('home.vsPrev')}</div>
      </div>
      <div className="pace-row">
        <button className="pace-box" onClick={() => goToTab?.('services', { nonce: Date.now() })}>
          <div className="pace-label">🧹 {t('home.paceService')}</div>
          <div className="pace-value">{dash ?? formatNumber(service.total)}</div>
          <div className="pace-sub">{service.count} {t('home.countSuffix')}</div>
        </button>

        <button className="pace-box" onClick={() => goToTab?.('finance', { view: 'expense', nonce: Date.now() })}>
          <div className="pace-label">💸 {t('home.paceExpense')}</div>
          <div className="pace-value out">{dash ?? formatNumber(expense.current)}</div>
          <PctBadge pct={expense.pct} goodWhenUp={false} loading={loading} t={t} />
        </button>

        <button className="pace-box" onClick={() => goToTab?.('finance', { view: 'income', nonce: Date.now() })}>
          <div className="pace-label">💰 {t('home.paceIncome')}</div>
          <div className="pace-value in">{dash ?? formatNumber(income.current)}</div>
          <PctBadge pct={income.pct} goodWhenUp loading={loading} t={t} />
        </button>
      </div>
    </div>
  );
}

// Foiz sur'ati belgisi: o'sish/kamayish yaxshimi (kirimda o'sish yaxshi, xarajatda aksincha)
// — shunga qarab yashil/qizil. O'tgan oyda hech narsa bo'lmasa foiz yo'q ("yangi").
function PctBadge({ pct, goodWhenUp, loading, t }) {
  if (loading) return <div className="pace-sub">…</div>;
  if (pct === null || pct === undefined) return <div className="pace-sub muted">{t('home.paceNew')}</div>;
  const flat = pct === 0;
  const up = pct > 0;
  const cls = flat ? 'flat' : up === goodWhenUp ? 'good' : 'bad';
  const arrow = flat ? '→' : up ? '↑' : '↓';
  return (
    <div className={`pace-pct ${cls}`}>
      {arrow} {Math.abs(pct)}%
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

// Qidiruv natijalari — Xizmatlar jadvalidan topilgan qatorlar. Har bir moslikning asosiy
// ma'lumotlari (ism, tel, sana, manzil, summa) TO'G'RIDAN-TO'G'RI ko'rinib turadi; bosilsa
// jadvaldagi o'sha qatorga o'tib yorug'lantiriladi.
function SearchResults({ services, searching, onOpenService }) {
  const { t, lang } = useApp();
  if (searching) return <Spinner />;
  if (!services.length) return null;

  return (
    <div className="card">
      <div className="row-between mb-8">
        <strong>{services.length} {t('ui.rowsCount')}</strong>
      </div>
      {services.slice(0, 20).map((service) => (
        <div key={service._id} className="list-item" onClick={() => onOpenService?.(service)}>
          <div className="row-between">
            <div className="title">{service.clientName || '-'}</div>
            <span className={`badge badge-${searchBadgeOf(service.status)}`}>
              {t(`status.${service.status || 'kutilmoqda'}`)}
            </span>
          </div>
          {service.clientPhone && <div className="sub">{formatPhone(service.clientPhone) || service.clientPhone}</div>}
          <div className="sub">
            {service.serviceDateTime ? formatDateTime(service.serviceDateTime, lang) : ''}
            {service.location?.address ? `${service.serviceDateTime ? ' · ' : ''}${service.location.address}` : ''}
          </div>
          {service.price > 0 && <div className="sub">{formatMoney(service.price)}</div>}
        </div>
      ))}
    </div>
  );
}

function searchBadgeOf(status) {
  if (status === 'bajarildi') return 'done';
  if (status === 'bajarilmadi') return 'notdone';
  if (status === 'bekor_qilindi') return 'cancelled';
  return 'pending';
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

// Bugungi xizmat kartasi: HAR BIRIDA aniq rangli holat yorlig'i; ism, tel, summa, manzil,
// vaqt ko'rsatiladi. Kutilayotganida tezkor "bajarildi" tugmasi ham qoladi.
function TodayServiceCard({ service, busy, onOpen, onComplete }) {
  const { t } = useApp();
  const isDone = service.status === 'bajarildi';
  const isCancelled = service.status === 'bekor_qilindi';
  const isNotDone = service.status === 'bajarilmadi';
  const initial = (service.clientName || '?').trim().charAt(0).toUpperCase() || '?';
  const badge = isDone ? 'done' : isCancelled ? 'cancelled' : isNotDone ? 'notdone' : 'pending';

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
          {service.clientPhone && <div className="job-sub">{formatPhone(service.clientPhone)}</div>}
          <div className="job-price">{formatMoney(service.price)}</div>
        </div>
        {isDone ? (
          <div className="check-circle done" aria-label={t('status.bajarildi')}>
            ✓
          </div>
        ) : isCancelled || isNotDone ? null : (
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

// Xizmatni qidiruv so'roviga solishtiradi — BARCHA maydonlar bo'yicha, ko'rinadigan
// formatlangan matn ustida: ism, telefon (xom + formatlangan), manzil, izoh, summa
// (xom + "200 000 so'm" + bo'shliqsiz raqam) va SANA (formatlangan). Shu sabab
// foydalanuvchi "23-iyul", "iyul", "200 000" yoki "+998 90" deb yozsa ham topiladi.
function matchesServiceQuery(service, q, lang) {
  const query = String(q || '').toLowerCase().trim();
  if (!query) return true;

  // Raqamli so'rov ("200 000" yoki "200000") — summa bilan bo'shliqsiz solishtiramiz.
  const digits = query.replace(/[\s']/g, '');
  if (/^\d+$/.test(digits) && service.price > 0 && String(service.price).includes(digits)) {
    return true;
  }

  const haystack = [
    service.clientName,
    service.clientPhone,
    formatPhone(service.clientPhone),
    service.location?.address,
    service.notes,
    service.price > 0 ? String(service.price) : '',
    service.price > 0 ? formatMoney(service.price) : '',
    service.serviceDateTime ? formatDateTime(service.serviceDateTime, lang) : '',
    service.serviceDateTime ? formatDate(service.serviceDateTime, lang) : '',
  ];
  return haystack.some((value) => String(value || '').toLowerCase().includes(query));
}

function normalizeServices(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}
