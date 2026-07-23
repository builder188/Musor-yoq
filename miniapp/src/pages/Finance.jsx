// Moliya sahifasi: balans/diagramma kartalari saqlanadi, Kirim va Chiqim ro'yxatlari
// umumiy jadval (spreadsheet) ko'rinishida. Tahrirlar PUT /transactions/:id orqali —
// biznes qoidalar backendda (xizmatga bog'langan daromad summasi o'zgartirilmaydi,
// kategoriya avtomatik yaratiladi/kanonlashadi, bot xabar oladi).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatDateTime, formatMonthName, formatMonthYear, toInputDateTime } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import SheetTable from '../components/SheetTable.jsx';
import SheetTabs, { rowMatchesSheet, activeSheetIdOf } from '../components/SheetTabs.jsx';
import LoadError from '../components/LoadError.jsx';

const PERIODS = ['today', 'month', 'year', 'all'];
const INCOME_TYPES = ['xizmat', 'material', 'buyum', 'qolda', 'hamkorlik'];

export default function Finance({ nav = null }) {
  const { t, lang } = useApp();
  const [period, setPeriod] = useState('month');
  // Bosh sahifadagi "Xarajat"/"Daromad" kataklaridan kelib, tegishli jadval bo'limiga suriladi.
  const incomeRef = useRef(null);
  const expenseRef = useRef(null);
  const [summary, setSummary] = useState(null);
  const [chart, setChart] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [incomeSources, setIncomeSources] = useState(null);
  const [stockItems, setStockItems] = useState([]);
  const [partnerServiceIds, setPartnerServiceIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [downloading, setDownloading] = useState(false);
  // Jadval filtrlari: kirim — turi bo'yicha, chiqim — kategoriya bo'yicha.
  const [incomeFilter, setIncomeFilter] = useState('all');
  const [expenseFilter, setExpenseFilter] = useState('all');
  // Ko'p-jadval (sheets): kirim va chiqim jadvallarining o'z tab'lari.
  const [incomeSheets, setIncomeSheets] = useState([]);
  const [expenseSheets, setExpenseSheets] = useState([]);
  const [selectedIncomeSheet, setSelectedIncomeSheet] = useState(null);
  const [selectedExpenseSheet, setSelectedExpenseSheet] = useState(null);

  const loadSheets = async () => {
    try {
      const [inc, exp] = await Promise.all([api.get('/sheets?scope=income'), api.get('/sheets?scope=expense')]);
      const incList = Array.isArray(inc?.sheets) ? inc.sheets : [];
      const expList = Array.isArray(exp?.sheets) ? exp.sheets : [];
      setIncomeSheets(incList);
      setExpenseSheets(expList);
      setSelectedIncomeSheet((prev) => (prev && incList.some((s) => s._id === prev) ? prev : activeSheetIdOf(incList)));
      setSelectedExpenseSheet((prev) => (prev && expList.some((s) => s._id === prev) ? prev : activeSheetIdOf(expList)));
    } catch {
      setIncomeSheets([]);
      setExpenseSheets([]);
    }
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [s, c, tx, mat, src, items, services] = await Promise.all([
        api.get(`/finance/summary?period=${period}`),
        api.get('/finance/chart'),
        api.get(`/finance/transactions?period=${period}`),
        api.get(`/finance/materials?period=${period}`),
        api.get(`/finance/income-sources?period=${period}`),
        api.get('/items?status=available'),
        // Hamkorlik tashrifini aniqlash uchun: tx.serviceId -> service.isPartner (qatorning o'zida).
        api.get('/services'),
      ]);
      setSummary(s);
      setChart(c);
      setTransactions(normalizeTransactions(tx));
      setMaterials(Array.isArray(mat) ? mat : []);
      setIncomeSources(src && Array.isArray(src.sources) ? src : null);
      setStockItems(Array.isArray(items) ? items : []);
      setPartnerServiceIds(buildPartnerServiceIds(asArray(services)));
      setLoadError(false);
    } catch {
      // Yuklash xatosi bo'sh ro'yxatga aylanmasin — aniq banner (yozuvlar bazada turibdi).
      setLoadError(true);
      setSummary(null);
      setChart(null);
      setTransactions([]);
      setMaterials([]);
      setIncomeSources(null);
      setStockItems([]);
      setPartnerServiceIds(new Set());
    } finally {
      if (!silent) setLoading(false);
    }
    loadSheets();
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // Kirim yoki Chiqim bo'limiga surish (bosh sahifadagi katak bosilganda).
  useEffect(() => {
    if (!nav?.view || loading) return;
    const target = nav.view === 'income' ? incomeRef.current : nav.view === 'expense' ? expenseRef.current : null;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [nav, loading]);

  const bars = makeBars(chart, lang);

  // BARCHA kirim turlari bitta jadvalda — "turi" (__srcType) ustuni bilan farqlanadi.
  // Sheet tab'i faqat KO'RINISHNI filtrlaydi (balans/hisobotlar barcha jadvallardan).
  const activeIncomeSheet = activeSheetIdOf(incomeSheets);
  const activeExpenseSheet = activeSheetIdOf(expenseSheets);
  const incomes = useMemo(
    () =>
      transactions
        .filter((tx) => tx.type === 'income')
        .filter((tx) => !selectedIncomeSheet || rowMatchesSheet(tx.sheetId, selectedIncomeSheet, activeIncomeSheet))
        .map((tx) => ({ ...tx, __srcType: incomeSrcType(tx, partnerServiceIds) })),
    [transactions, partnerServiceIds, selectedIncomeSheet, activeIncomeSheet]
  );
  const filteredIncomes = useMemo(
    () => (incomeFilter === 'all' ? incomes : incomes.filter((tx) => tx.__srcType === incomeFilter)),
    [incomes, incomeFilter]
  );
  const incomeTotal = useMemo(() => filteredIncomes.reduce((sum, tx) => sum + (tx.amount || 0), 0), [filteredIncomes]);

  const expenses = useMemo(
    () =>
      transactions
        .filter((tx) => tx.type === 'expense')
        .filter((tx) => !selectedExpenseSheet || rowMatchesSheet(tx.sheetId, selectedExpenseSheet, activeExpenseSheet)),
    [transactions, selectedExpenseSheet, activeExpenseSheet]
  );
  // Kategoriya filtri variantlari — yuklangan yozuvlardagi mavjud kategoriyalardan.
  const expenseCategories = useMemo(() => {
    const seen = new Map();
    expenses.forEach((tx) => {
      const value = tx.category || 'boshqa_chiqim';
      if (!seen.has(value)) seen.set(value, categoryLabel(t, value));
    });
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [expenses, t]);
  const filteredExpenses = useMemo(
    () => (expenseFilter === 'all' ? expenses : expenses.filter((tx) => (tx.category || 'boshqa_chiqim') === expenseFilter)),
    [expenses, expenseFilter]
  );
  const expenseTotal = useMemo(() => filteredExpenses.reduce((sum, tx) => sum + (tx.amount || 0), 0), [filteredExpenses]);

  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: 6 }}>{t('finance.title')}</h1>

      {loadError && <LoadError onRetry={() => load()} />}

      <BalanceCard summary={summary} />

      <button
        className="btn btn-block"
        style={{ marginTop: 10, marginBottom: 14 }}
        onClick={() => setDownloading(true)}
      >
        📥 {t('finance.download')}
      </button>

      <div className="segment">
        {PERIODS.map((p) => (
          <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>
            {t(`finance.${p === 'last_month' ? 'lastMonth' : p}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <>
          <IncomeExpenseRow summary={summary} />

          {bars && (
            <div className="card">
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t('finance.last6')}</div>
              <div className="bars">
                {bars.map((b) => (
                  <div key={b.label} className={`bar-col ${b.current ? 'current' : ''}`}>
                    <div className={`bar ${b.current ? 'current' : ''}`} style={{ height: `${b.h}px` }} />
                    <div className="bar-label">{b.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {incomeSources && <IncomeSourcesCard data={incomeSources} t={t} />}

          {materials.length > 0 && <MaterialsCard materials={materials} t={t} />}

          {stockItems.length > 0 && <StockItemsCard items={stockItems} t={t} />}

          <div className="section-title" ref={incomeRef}>↑ {t('finance.income')}</div>
          <SheetTabs
            scope="income"
            sheets={incomeSheets}
            selected={selectedIncomeSheet}
            onSelect={setSelectedIncomeSheet}
            onChanged={() => load(true)}
            t={t}
          />
          {/* Turi filtri + joriy filtr bo'yicha jami. Davr filtri — yuqoridagi segment. */}
          <div className="sheet-filterbar">
            <span className="sheet-funnel" aria-hidden="true">▼</span>
            <select
              className="sheet-filter-select"
              value={incomeFilter}
              onChange={(e) => setIncomeFilter(e.target.value)}
              aria-label={t('sheet.filter')}
            >
              <option value="all">{t('services.all')}</option>
              {INCOME_TYPES.map((type) => (
                <option key={type} value={type}>{t(`finance.incomeTypes.${type}`)}</option>
              ))}
            </select>
            <div className="sheet-total">
              {t('common.total')}: <b>+{formatNumber(incomeTotal)}</b> · {filteredIncomes.length} {t('home.countSuffix')}
            </div>
          </div>
          <TransactionsSheet
            id="finance-income"
            type="income"
            allowDraft={selectedIncomeSheet === activeIncomeSheet}
            rows={filteredIncomes}
            leadColumns={[
              {
                key: '__srcType',
                title: t('finance.type'),
                width: 110,
                type: 'text',
                draft: false,
                get: (r) => r.__srcType || '',
                text: (r) => (r.__srcType ? t(`finance.incomeTypes.${r.__srcType}`) : ''),
              },
            ]}
            t={t}
            lang={lang}
            onChanged={() => load(true)}
            onDelete={setDeleting}
          />

          <div className="section-title" ref={expenseRef}>↓ {t('finance.expense')}</div>
          <SheetTabs
            scope="expense"
            sheets={expenseSheets}
            selected={selectedExpenseSheet}
            onSelect={setSelectedExpenseSheet}
            onChanged={() => load(true)}
            t={t}
          />
          {/* Kategoriya filtri + joriy filtr bo'yicha jami. */}
          <div className="sheet-filterbar">
            <span className="sheet-funnel" aria-hidden="true">▼</span>
            <select
              className="sheet-filter-select"
              value={expenseFilter}
              onChange={(e) => setExpenseFilter(e.target.value)}
              aria-label={t('sheet.filter')}
            >
              <option value="all">{t('services.all')}</option>
              {expenseCategories.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <div className="sheet-total">
              {t('common.total')}: <b>−{formatNumber(expenseTotal)}</b> · {filteredExpenses.length} {t('home.countSuffix')}
            </div>
          </div>
          <TransactionsSheet
            id="finance-expense"
            type="expense"
            allowDraft={selectedExpenseSheet === activeExpenseSheet}
            rows={filteredExpenses}
            t={t}
            lang={lang}
            onChanged={() => load(true)}
            onDelete={setDeleting}
          />
        </>
      )}

      {deleting && (
        <ConfirmDeleteModal
          message={`${formatMoney(deleting.amount)}`}
          onClose={() => setDeleting(null)}
          onConfirm={async (code) => {
            await api.del(`/transactions/${deleting._id}`, { confirmationCode: code });
            setDeleting(null);
            load(true);
          }}
        />
      )}

      {downloading && <DownloadReportModal onClose={() => setDownloading(false)} />}
    </div>
  );
}

// Kirim yoki Chiqim jadvali. Yangi qator o'sha turdagi tranzaksiya sifatida saqlanadi
// (tur jadvalning o'zi bilan belgilangan — keyin o'zgartirish shart emas).
// leadColumns — jadval boshiga qo'shiladigan qo'shimcha ustunlar (masalan kirimda "Turi").
function TransactionsSheet({ id, type, rows, leadColumns = [], allowDraft = true, t, lang, onChanged, onDelete }) {
  const columns = useMemo(
    () => [
      ...leadColumns,
      {
        key: 'date',
        title: t('common.date'),
        width: 170,
        type: 'datetime',
        get: (r) => (r.date ? toInputDateTime(r.date) : ''),
        text: (r) => (r.date ? formatDateTime(r.date, lang) : ''),
        apply: (r, v) => {
          if (!v) return null;
          return api.put(`/transactions/${r._id}`, { date: new Date(v).toISOString() });
        },
      },
      {
        key: 'amount',
        title: t('common.amount'),
        width: 120,
        type: 'number',
        get: (r) => (r.amount > 0 ? r.amount : ''),
        text: (r) => (r.amount > 0 ? formatMoney(r.amount) : ''),
        // Xizmatga bog'langan daromadda backend aniq xabar bilan rad etadi.
        apply: (r, v) => {
          if (v === '' || v === null) return null;
          return api.put(`/transactions/${r._id}`, { amount: Number(v) });
        },
      },
      {
        key: 'category',
        title: t('finance.category'),
        width: 130,
        type: 'text',
        get: (r) => r.category || '',
        text: (r) => categoryLabel(t, r.category),
        // Erkin kategoriya: yangi nom backendda avtomatik yaratiladi (bot xabar beradi).
        apply: (r, v) => api.put(`/transactions/${r._id}`, { category: v }),
      },
      {
        key: 'description',
        title: t('common.notes'),
        width: 200,
        type: 'text',
        get: (r) => r.description || r.note || '',
        text: (r) => r.description || r.note || '',
        apply: (r, v) => api.put(`/transactions/${r._id}`, { description: v }),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, lang, leadColumns]
  );

  const draft = {
    defaults: {},
    // Har maydon ixtiyoriy: birinchi mazmunli qiymat kiritilganda saqlanadi (summa 0 =
    // "hali aytilmagan" — balansga ta'sir qilmaydi, keyin tahrirda kiritiladi).
    canSave: (v) =>
      !!(String(v.amount || '').trim() || String(v.category || '').trim() || String(v.description || '').trim()),
    save: async (v) => {
      const payload = { type };
      if (v.amount) payload.amount = Number(v.amount);
      if (v.category) payload.category = v.category;
      if (v.description) payload.description = v.description;
      if (v.date) payload.date = new Date(v.date).toISOString();
      await api.post('/transactions', payload);
    },
  };

  return (
    <SheetTable
      id={id}
      columns={columns}
      rows={rows}
      rowKey={(r) => r._id}
      onChanged={onChanged}
      // Yangi qator faqat FAOL jadval tab'ida (server yangi yozuvni faol jadvalga yozadi).
      draft={allowDraft ? draft : null}
      onDelete={onDelete}
      emptyText={t('common.noData')}
      t={t}
    />
  );
}

// Hisobotni yuklab olish oqimi: format (PDF/Excel) -> davr (oxirgi 12 oy yoki ixtiyoriy oraliq)
// -> backend generatsiya qilib Telegram chatga yuboradi (Mini App ichida yuklab olish linki yo'q).
function DownloadReportModal({ onClose }) {
  const { t, lang } = useApp();
  const [step, setStep] = useState('format'); // 'format' | 'period'
  const [format, setFormat] = useState(null); // 'pdf' | 'excel'
  const [customOpen, setCustomOpen] = useState(false);
  const [range, setRange] = useState({ start: '', end: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const [lastPayload, setLastPayload] = useState(null);

  const months = useMemo(() => buildLast12Months(lang), [lang]);

  const send = async (payload) => {
    setLastPayload(payload);
    setBusy(true);
    setError(false);
    try {
      await api.post('/reports/send', { reportType: 'finance', format, language: lang, ...payload });
      setDone(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Modal title={t('finance.downloadTitle')} onClose={onClose}>
        <div className="center" style={{ padding: '18px 0', fontSize: 15 }}>{t('finance.sentToChat')}</div>
        <button className="btn btn-primary btn-block" onClick={onClose}>OK</button>
      </Modal>
    );
  }

  return (
    <Modal title={t('finance.downloadTitle')} onClose={onClose}>
      {step === 'format' && (
        <>
          <div className="label">{t('finance.chooseFormat')}</div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn btn-block" onClick={() => { setFormat('pdf'); setStep('period'); }}>📄 PDF</button>
            <button className="btn btn-block" onClick={() => { setFormat('excel'); setStep('period'); }}>📊 Excel</button>
          </div>
        </>
      )}

      {step === 'period' && (
        <>
          <div className="label">{t('finance.choosePeriod')}</div>

          {error && (
            <div className="error-banner" style={{ marginBottom: 10 }}>{t('finance.genError')}</div>
          )}

          {error && lastPayload ? (
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => send(lastPayload)}>
              🔄 {busy ? t('finance.sending') : t('finance.retry')}
            </button>
          ) : !customOpen ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                {months.map((m) => (
                  <button key={m.value} className="btn btn-sm" disabled={busy} onClick={() => send({ month: m.value })}>
                    {m.label}
                  </button>
                ))}
              </div>
              <button className="btn btn-block" disabled={busy} onClick={() => setCustomOpen(true)}>
                {t('finance.otherPeriod')}
              </button>
              {busy && <div className="muted center" style={{ marginTop: 10 }}>{t('finance.sending')}</div>}
            </>
          ) : (
            <>
              <label className="label">{t('finance.rangeStart')}</label>
              <input className="input" type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
              <label className="label">{t('finance.rangeEnd')}</label>
              <input className="input" type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
              <button
                className="btn btn-primary btn-block"
                style={{ marginTop: 12 }}
                disabled={busy || !range.start || !range.end}
                onClick={() => send({ dateRange: { start: range.start, end: range.end } })}
              >
                {busy ? t('finance.sending') : t('finance.generateSend')}
              </button>
            </>
          )}
        </>
      )}
    </Modal>
  );
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

function BalanceCard({ summary }) {
  const { t } = useApp();
  const balance = Number(summary?.balance ?? 0);
  return (
    <div className="balance-hero">
      <div className="bh-label">{t('finance.balanceNow')}</div>
      <div className={`bh-amount ${balance < 0 ? 'negative' : ''}`}>
        {formatNumber(balance)} <span className="unit">{t('common.soum')}</span>
      </div>
    </div>
  );
}

// Kirim / Chiqim yonma-yon kartalari (davr summasi).
function IncomeExpenseRow({ summary }) {
  const { t } = useApp();
  const income = Number(summary?.income ?? summary?.totalIncome ?? 0);
  const expense = Number(summary?.expense ?? summary?.totalExpense ?? 0);
  return (
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
  );
}

// Daromad MANBALARI bo'yicha ajratish (davr summasi): xizmat / material / buyum / boshqa.
function IncomeSourcesCard({ data, t }) {
  const sources = (data.sources || []).filter((s) => s.total > 0);
  if (!sources.length) return null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>📊 {t('finance.incomeSources')}</div>
      {sources.map((s) => (
        <div key={s.key} className="row-between" style={{ padding: '6px 0' }}>
          <div style={{ fontSize: '14px' }}>
            {s.emoji} {t(`finance.sources.${s.key}`)}
            <span className="muted"> · {s.count} {t('home.countSuffix')}</span>
          </div>
          <span className="text-income">+{formatNumber(s.total)}</span>
        </div>
      ))}
    </div>
  );
}

// Kerakli buyumlar inventari qisqacha ko'rinishi (moliyaviy umumiy ko'rinish).
function StockItemsCard({ items, t }) {
  const names = items.map((it) => it.name).filter(Boolean);
  const shown = names.slice(0, 15);
  const extra = names.length - shown.length;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row-between" style={{ marginBottom: shown.length ? 8 : 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>📦 {t('finance.itemsInStock')}</div>
        <span className="text-income">{items.length} {t('home.countSuffix')}</span>
      </div>
      {shown.length > 0 && (
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          {shown.join(' · ')}{extra > 0 ? ` +${extra}` : ''}
        </div>
      )}
    </div>
  );
}

// Material sotuvi bo'yicha kategoriya statistikasi (davr summasi).
function MaterialsCard({ materials, t }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>♻️ {t('finance.materials')}</div>
      {materials.map((m) => (
        <div key={m.material} className="row-between" style={{ padding: '6px 0' }}>
          <div style={{ fontSize: '14px' }}>
            {m.material}
            {m.totalKg > 0 && <span className="muted"> · {formatNumber(m.totalKg)} kg</span>}
          </div>
          <span className="text-income">+{formatNumber(m.total)}</span>
        </div>
      ))}
    </div>
  );
}

// Birlik ("so'm")siz raqam: 2 340 000.
function formatNumber(n) {
  return Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Kategoriya yorlig'i: tanilgan slug tarjima qilinadi, DINAMIK nom o'z holicha ko'rsatiladi
// (t() kaliti topilmasa kalitni o'zini qaytaradi — uni ko'rsatmaymiz).
function categoryLabel(t, category) {
  if (!category) return t('category.boshqa');
  const translated = t(`category.${category}`);
  return translated === `category.${category}` ? category : translated;
}

// Oxirgi 6 oy uchun yengil CSS bar grafigi. Joriy oy — siyoh, qolgani yumshoq yashil.
function makeBars(chart, lang) {
  if (!chart || !chart.income) return null;
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ index: d.getMonth(), label: formatMonthName(d, lang), current: i === 0 });
  }
  const values = months.map((m) => Number(chart.income[m.index] || 0));
  const max = Math.max(...values, 1);
  return months.map((m, i) => ({
    label: m.label,
    current: m.current,
    h: Math.max(6, Math.round((values[i] / max) * 80)), // 6..80px
  }));
}

function normalizeTransactions(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

// Hamkor mijozlarning xizmat IDlari — kirim tranzaksiyasini "Hamkorlik" deb belgilash uchun.
// isPartner belgisi endi xizmat qatorining o'zida (alohida mijozlar ro'yxati yo'q).
function buildPartnerServiceIds(services) {
  return new Set(services.filter((s) => s.isPartner).map((s) => String(s._id)));
}

// Kirim turi: xizmat / material / buyum / qo'lda kirim / hamkorlik tashrifi.
// serviceId bo'lsa xizmat (hamkor mijozniki bo'lsa — hamkorlik); aks holda kategoriya
// bo'yicha; kategoriyasiz yoki erkin kategoriya — qo'lda kiritilgan kirim.
function incomeSrcType(tx, partnerServiceIds) {
  if (tx.serviceId) return partnerServiceIds.has(String(tx.serviceId)) ? 'hamkorlik' : 'xizmat';
  if (tx.category === 'material') return 'material';
  if (tx.category === 'buyum') return 'buyum';
  if (tx.category === 'xizmat') return 'xizmat';
  return 'qolda';
}
