// Xizmatlar sahifasi — umumiy jadval (spreadsheet) ko'rinishi.
// Har bir katak tahriri mavjud biznes mantiqdan o'tadi:
//  - narx tahriri -> PUT /services/:id (bajarilgan xizmatda daromad qayta hisoblanadi)
//  - holat dropdown -> complete/cancel endpointlari (daromad yoziladi/qaytariladi)
//  - to'lov holati dropdown -> paidAmount orqali (paymentStatus backend'da hisoblanadi)
// Server tomonda notifyMiniAppUpdated bot xabarini yuboradi.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatDateTime, formatMonthYear, toInputDateTime } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import LocationDisplay from '../components/LocationDisplay.jsx';
import AmountPromptModal from '../components/AmountPromptModal.jsx';
import SheetTable from '../components/SheetTable.jsx';
import SheetTabs, { rowMatchesSheet, activeSheetIdOf } from '../components/SheetTabs.jsx';
import LoadError from '../components/LoadError.jsx';

export default function Services() {
  const { t, lang } = useApp();
  // Funnel filtri: barchasi (standart) / bugungi / kelajakdagi / tarixdagi / oy bo'yicha.
  const [filter, setFilter] = useState('all');
  const [month, setMonth] = useState(() => currentMonthValue());
  const [services, setServices] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detail, setDetail] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [partialFor, setPartialFor] = useState(null);

  const loadSheets = async () => {
    try {
      const res = await api.get('/sheets?scope=services');
      const list = Array.isArray(res?.sheets) ? res.sheets : [];
      setSheets(list);
      setSelectedSheet((prev) => (prev && list.some((s) => s._id === prev) ? prev : activeSheetIdOf(list)));
    } catch {
      setSheets([]);
    }
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Hamma xizmat bir marta yuklanadi — filtr mijoz tomonda (jami summa ham shundan).
      const data = await api.get('/services');
      setServices(normalizeServices(data));
      setLoadError(false);
    } catch {
      // Xato = bo'sh ro'yxat EMAS — banner ko'rsatamiz (yozuvlar bazada turibdi).
      setLoadError(true);
      setServices([]);
    } finally {
      if (!silent) setLoading(false);
    }
    loadSheets();
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const months = useMemo(() => buildLast12Months(lang), [lang]);
  // Avval tanlangan jadval (tab), keyin sana funnel filtri. Tab faqat KO'RINISH —
  // qidiruv/hisobotlar barcha jadvallarni qamraydi.
  const activeSheetId = activeSheetIdOf(sheets);
  const sheetRows = useMemo(
    () => (selectedSheet ? services.filter((s) => rowMatchesSheet(s.sheetId, selectedSheet, activeSheetId)) : services),
    [services, selectedSheet, activeSheetId]
  );
  const filtered = useMemo(
    () => sortForFilter(sheetRows.filter((s) => matchesFilter(s, filter, month)), filter),
    [sheetRows, filter, month]
  );
  // FAQAT joriy filtr bo'yicha ko'rinayotgan XIZMATLAR summasi (boshqa kirimlar aralashmaydi).
  const totalPrice = useMemo(() => filtered.reduce((sum, s) => sum + (s.price > 0 ? s.price : 0), 0), [filtered]);

  const putService = (row, body) => api.put(`/services/${row._id}`, body);

  // Holat dropdown — 4 qiymat, istalgan yo'nalishda o'zgartirish mumkin (backend
  // daromadni o'zi yozadi/qaytaradi). "Bajarilmadi" — amalga oshmagan (balansga
  // yozilmaydi), keyin sanasi tahrirlanib qayta rejalashtirilishi mumkin.
  const statusOptions = [
    { value: 'kutilmoqda', label: t('status.kutilmoqda') },
    { value: 'bajarildi', label: t('status.bajarildi') },
    { value: 'bajarilmadi', label: t('status.bajarilmadi') },
    { value: 'bekor_qilindi', label: t('status.bekor_qilindi') },
  ];

  // Ustun tartibi (spec bo'yicha AYNAN): Ism | Tel | Sana | Manzil | Narx | To'lov turi | Izoh | Holat.
  // Har bir maydon IXTIYORIY — bo'sh katak xato emas, istalgan vaqt tahrirlanadi.
  const columns = [
    {
      key: 'clientName',
      title: t('common.name'),
      width: 140,
      type: 'text',
      get: (r) => r.clientName || '',
      text: (r) => r.clientName || '',
      apply: (r, v) => putService(r, { clientName: v }),
    },
    {
      key: 'clientPhone',
      title: t('common.phone'),
      width: 130,
      type: 'text',
      get: (r) => r.clientPhone || '',
      text: (r) => r.clientPhone || '',
      apply: (r, v) => {
        if (!v.trim()) return null; // bo'sh telefon xato emas — shunchaki o'zgartirmaymiz
        return putService(r, { clientPhone: v, clientName: r.clientName });
      },
    },
    {
      key: 'serviceDateTime',
      title: t('common.date'),
      width: 170,
      type: 'datetime',
      get: (r) => (r.serviceDateTime ? toInputDateTime(r.serviceDateTime) : ''),
      text: (r) => (r.serviceDateTime ? formatDateTime(r.serviceDateTime, lang) : ''),
      apply: (r, v) => {
        if (!v) return null;
        return putService(r, { serviceDateTime: new Date(v).toISOString() });
      },
    },
    {
      key: 'location',
      title: t('common.location'),
      width: 160,
      type: 'text',
      get: (r) => r.location?.address || '',
      text: (r) => r.location?.address || '',
      apply: (r, v) =>
        putService(r, {
          location: { address: v, mapUrl: r.location?.mapUrl || '', coordinates: r.location?.coordinates || null },
        }),
    },
    {
      key: 'price',
      title: t('common.price'),
      width: 110,
      type: 'number',
      get: (r) => (r.price > 0 ? r.price : ''),
      text: (r) => (r.price > 0 ? formatMoney(r.price) : ''),
      apply: (r, v) => {
        if (v === '' || v === null) return null;
        return putService(r, { price: Number(v) });
      },
    },
    {
      key: 'paymentMethod',
      title: t('common.paymentMethod'),
      width: 110,
      type: 'select',
      options: [
        { value: 'naqd', label: t('payment.naqd') },
        { value: 'karta', label: t('payment.karta') },
        { value: 'otkazma', label: t('payment.otkazma') },
      ],
      get: (r) => r.paymentMethod || 'naqd',
      text: (r) => (r.paymentMethod ? t(`payment.${r.paymentMethod}`) : ''),
      apply: (r, v) => putService(r, { paymentMethod: v }),
    },
    {
      key: 'notes',
      title: t('common.notes'),
      width: 160,
      type: 'text',
      get: (r) => r.notes || '',
      text: (r) => r.notes || '',
      apply: (r, v) => putService(r, { notes: v }),
    },
    {
      key: 'status',
      title: t('common.status'),
      width: 130,
      type: 'select',
      options: statusOptions,
      draft: false,
      draftText: t('status.kutilmoqda'),
      get: (r) => r.status || 'kutilmoqda',
      text: (r) => (r.status ? t(`status.${r.status}`) : ''),
      apply: async (r, v) => {
        if (v === r.status) return;
        // Bajarildi — daromad yoziladi; bajarilmadi/bekor — daromad yozilmaydi/qaytariladi.
        await api.patch(`/services/${r._id}/status`, { status: v });
      },
    },
  ];

  // Yangi qator: minimal identifikatsiya (ism YOKI telefon) to'planganda avtomatik saqlanadi.
  const draft = {
    defaults: { paymentMethod: 'naqd' },
    canSave: (v) => !!(String(v.clientName || '').trim() || String(v.clientPhone || '').trim()),
    save: async (v) => {
      const payload = { paymentMethod: v.paymentMethod || 'naqd' };
      if (v.clientName) payload.clientName = v.clientName;
      if (v.clientPhone) payload.clientPhone = v.clientPhone;
      if (v.location || v.mapUrl) payload.location = { address: v.location || '', mapUrl: v.mapUrl || '' };
      if (v.serviceDateTime) payload.serviceDateTime = new Date(v.serviceDateTime).toISOString();
      if (v.price) payload.price = Number(v.price);
      if (v.notes) payload.notes = v.notes;
      await api.post('/services', payload);
    },
  };

  return (
    <div>
      {loadError && <LoadError onRetry={() => load()} />}
      <h1 className="page-title">{t('services.title')}</h1>

      {/* Jadval tab'lari (faol + arxiv) — arxiv ham to'liq tahrirlanadi. */}
      <SheetTabs
        scope="services"
        sheets={sheets}
        selected={selectedSheet}
        onSelect={setSelectedSheet}
        onChanged={() => load(true)}
        t={t}
      />

      {/* Funnel filtri + joriy filtr bo'yicha jami summa. */}
      <div className="sheet-filterbar">
        <span className="sheet-funnel" aria-hidden="true">▼</span>
        <select
          className="sheet-filter-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t('sheet.filter')}
        >
          <option value="all">{t('services.all')}</option>
          <option value="today">{t('sheet.fToday')}</option>
          <option value="future">{t('sheet.fFuture')}</option>
          <option value="past">{t('sheet.fPast')}</option>
          <option value="month">{t('sheet.fMonth')}</option>
        </select>
        {filter === 'month' && (
          <select
            className="sheet-filter-select"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label={t('sheet.fMonth')}
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        )}
        <div className="sheet-total">
          {t('common.total')}: <b>{formatMoney(totalPrice)}</b> · {filtered.length} {t('home.countSuffix')}
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <SheetTable
          id="services"
          columns={columns}
          rows={filtered}
          rowKey={(r) => r._id}
          onChanged={() => load(true)}
          // Yangi qator faqat FAOL jadvalda qo'shiladi (server yangi yozuvni faol jadvalga yozadi);
          // arxiv tab'da mavjud kataklar baribir to'liq tahrirlanadi.
          draft={selectedSheet === activeSheetId ? draft : null}
          onDelete={setDeleting}
          actions={(row) => (
            <button type="button" aria-label={t('services.detail')} onClick={() => setDetail(row)}>
              ℹ️
            </button>
          )}
          emptyText={t('services.noServices')}
          t={t}
        />
      )}

      {detail && (
        <ServiceDetailSheet
          service={detail}
          onClose={() => setDetail(null)}
          onDelete={(s) => { setDetail(null); setDeleting(s); }}
          onPartial={(s) => { setDetail(null); setPartialFor(s); }}
          onChanged={() => load(true)}
        />
      )}

      {partialFor && (
        <AmountPromptModal
          title={t('paymentStatus.qisman')}
          label={t('sheet.partialPaid')}
          onClose={() => setPartialFor(null)}
          onSubmit={async (value) => {
            await api.put(`/services/${partialFor._id}`, { paidAmount: Number(value) || 0 });
            load(true);
          }}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          message={deleting.clientName}
          onClose={() => setDeleting(null)}
          onConfirm={async (code) => {
            await api.del(`/services/${deleting._id}`, { confirmationCode: code });
            setDeleting(null);
            load(true);
          }}
        />
      )}
    </div>
  );
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Oxirgi 12 oy: { value: 'YYYY-MM', label: 'Oy YYYY' } (eng yangisi birinchi).
function buildLast12Months(lang) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: formatMonthYear(d, lang),
    });
  }
  return out;
}

// Sana bo'yicha filtr: bugungi = shu kun ichi; kelajakdagi = bugundan keyin;
// tarixdagi = bugundan oldin; oy = tanlangan YYYY-MM ichida. Sanasi yo'q xizmat
// faqat "Barchasi"da ko'rinadi.
function matchesFilter(service, filter, month) {
  if (filter === 'all') return true;
  const date = service.serviceDateTime ? new Date(service.serviceDateTime) : null;
  if (!date || Number.isNaN(date.getTime())) return false;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  if (filter === 'today') return date >= dayStart && date <= dayEnd;
  if (filter === 'future') return date > dayEnd;
  if (filter === 'past') return date < dayStart;
  if (filter === 'month') {
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return value === month;
  }
  return true;
}

// Bugungi/kelajakdagi — eng yaqini birinchi; qolganlari — eng yangisi birinchi.
function sortForFilter(items, filter) {
  const direction = filter === 'today' || filter === 'future' ? 1 : -1;
  return [...items].sort((a, b) => {
    const left = new Date(a.serviceDateTime).getTime() || 0;
    const right = new Date(b.serviceDateTime).getTime() || 0;
    return (left - right) * direction;
  });
}

function normalizeServices(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

// Tafsilot: xarita havolasi va to'lov holati SHU YERDA tahrirlanadi (jadval ustunlari
// spec bo'yicha qat'iy 8 ta bo'lgani uchun); qolgan maydonlar jadvalning o'zida.
// O'chirish 1990-kod bilan.
function ServiceDetailSheet({ service, onClose, onDelete, onPartial, onChanged }) {
  const { t, lang } = useApp();
  const [mapUrl, setMapUrl] = useState(service.location?.mapUrl || '');
  const [busy, setBusy] = useState(false);

  const saveMapUrl = async () => {
    setBusy(true);
    try {
      await api.put(`/services/${service._id}`, {
        location: {
          address: service.location?.address || '',
          mapUrl,
          coordinates: service.location?.coordinates || null,
        },
      });
      onChanged?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const setPaymentStatus = async (value) => {
    if (value === service.paymentStatus) return;
    if (value === 'qisman') {
      onPartial?.(service);
      return;
    }
    setBusy(true);
    try {
      // paymentStatus backendda paidAmount dan hisoblanadi — shunga mos yozamiz.
      await api.put(`/services/${service._id}`, { paidAmount: value === 'tolangan' ? service.price || 0 : 0 });
      onChanged?.();
      onClose?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={service.clientName || t('services.detail')} onClose={onClose}>
      <div className="mb-8">
        <span className={`badge badge-${badgeOf(service.status)}`}>{t(`status.${service.status}`)}</span>
      </div>
      <div className="card">
        <Row label={t('common.phone')} value={service.clientPhone} />
        <Row label={t('common.location')} value={<LocationDisplay location={service.location} />} />
        <Row label={t('common.date')} value={formatDateTime(service.serviceDateTime, lang)} />
        {service.createdAt ? <Row label={t('common.createdAt')} value={formatDateTime(service.createdAt, lang)} /> : null}
        <Row label={t('common.price')} value={formatMoney(service.price)} />
        <Row label={t('common.paymentMethod')} value={service.paymentMethod ? t(`payment.${service.paymentMethod}`) : ''} />
        {service.notes ? <Row label={t('common.notes')} value={service.notes} /> : null}
        {service.clientDeletionNote ? <Row label={t('common.notes')} value={service.clientDeletionNote} /> : null}
      </div>

      <label className="label">{t('services.paymentStatus')}</label>
      <div className="segment mb-8">
        {['tolangan', 'qisman', 'tolanmagan'].map((value) => (
          <button
            key={value}
            className={service.paymentStatus === value ? 'active' : ''}
            disabled={busy}
            onClick={() => setPaymentStatus(value)}
          >
            {t(`paymentStatus.${value}`)}
          </button>
        ))}
      </div>

      <label className="label">{t('common.mapUrl')}</label>
      <div className="btn-row mb-8">
        <input
          className="input"
          value={mapUrl}
          placeholder={t('common.mapUrlPlaceholder')}
          onChange={(e) => setMapUrl(e.target.value)}
        />
        <button className="btn" disabled={busy || mapUrl === (service.location?.mapUrl || '')} onClick={saveMapUrl}>
          {t('common.save')}
        </button>
      </div>

      <button className="btn btn-danger btn-block" onClick={() => onDelete(service)}>
        🗑️ {t('common.delete')}
      </button>
    </Modal>
  );
}

function Row({ label, value }) {
  return (
    <div className="card-row" style={{ padding: '4px 0' }}>
      <span className="muted">{label}</span>
      <span style={{ textAlign: 'right', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function badgeOf(status) {
  if (status === 'bajarildi') return 'done';
  if (status === 'bajarilmadi') return 'notdone';
  if (status === 'bekor_qilindi') return 'cancelled';
  return 'pending';
}
