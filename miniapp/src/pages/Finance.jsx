import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatDate, formatDateTime, formatMonthName, formatMonthYear, toInputDateTime } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import FinalConfirmModal from '../components/FinalConfirmModal.jsx';

const PERIODS = ['today', 'month', 'year'];

export default function Finance() {
  const { t, lang } = useApp();
  const [period, setPeriod] = useState('month');
  const [summary, setSummary] = useState(null);
  const [chart, setChart] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [incomeSources, setIncomeSources] = useState(null);
  const [stockItems, setStockItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(null);
  const [editingTx, setEditingTx] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, c, tx, mat, src, items] = await Promise.all([
        api.get(`/finance/summary?period=${period}`),
        api.get('/finance/chart'),
        api.get(`/finance/transactions?period=${period}`),
        api.get(`/finance/materials?period=${period}`),
        api.get(`/finance/income-sources?period=${period}`),
        api.get('/items?status=available'),
      ]);
      setSummary(s);
      setChart(c);
      setTransactions(normalizeTransactions(tx));
      setMaterials(Array.isArray(mat) ? mat : []);
      setIncomeSources(src && Array.isArray(src.sources) ? src : null);
      setStockItems(Array.isArray(items) ? items : []);
    } catch {
      setSummary(null);
      setChart(null);
      setTransactions([]);
      setMaterials([]);
      setIncomeSources(null);
      setStockItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const bars = makeBars(chart, lang);

  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: 6 }}>{t('finance.title')}</h1>

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

          <div className="btn-row" style={{ marginBottom: 16 }}>
            <button className="btn btn-block" onClick={() => setAdding('income')}>
              ➕ {t('finance.income')}
            </button>
            <button className="btn btn-block" onClick={() => setAdding('expense')}>
              ➖ {t('finance.expense')}
            </button>
          </div>

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

          <div className="section-title">{t('finance.recentActions')}</div>
          {transactions.length === 0 ? (
            <div className="empty">{t('common.noData')}</div>
          ) : (
            <TransactionGroups groups={groupTransactions(transactions, lang)} t={t} lang={lang} onEdit={setEditingTx} onDelete={setDeleting} />
          )}
        </>
      )}

      {adding && (
        <AddTransactionModal
          initialType={adding}
          onClose={() => setAdding(null)}
          onDone={() => {
            setAdding(null);
            load();
          }}
        />
      )}

      {editingTx && (
        <EditTransactionModal
          tx={editingTx}
          onClose={() => setEditingTx(null)}
          onDelete={(tx) => {
            setEditingTx(null);
            setDeleting(tx);
          }}
          onDone={() => {
            setEditingTx(null);
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          message={`${formatMoney(deleting.amount)}`}
          onClose={() => setDeleting(null)}
          onConfirm={async (code) => {
            await api.del(`/transactions/${deleting._id}`, { confirmationCode: code });
            setDeleting(null);
            load();
          }}
        />
      )}

      {downloading && <DownloadReportModal onClose={() => setDownloading(false)} />}
    </div>
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
// Har manba — emoji + nomi + yozuvlar soni + jami summa. Faqat summasi bor manbalar.
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

// Kerakli buyumlar inventari qisqacha ko'rinishi: nechta buyum saqlanmoqda + qaysilari.
// To'liq boshqaruv "Buyumlar" tabida; bu yerda faqat moliyaviy umumiy ko'rinish.
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

// Material sotuvi bo'yicha kategoriya statistikasi (davr summasi). Faqat material
// sotilgan bo'lsa ko'rsatiladi. Har qator: material nomi, kg (bo'lsa), jami summa.
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

function TransactionGroups({ groups, t, lang, onEdit, onDelete }) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.dateLabel}>
          <div className="section-title">{group.dateLabel}</div>
          {group.items.map((tx) => (
            <SwipeTransaction key={tx._id} tx={tx} t={t} lang={lang} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      ))}
    </>
  );
}

function SwipeTransaction({ tx, t, lang, onEdit, onDelete }) {
  const [offset, setOffset] = useState(0);
  const startRef = useRef(null);
  const swipedRef = useRef(false);

  const down = (e) => {
    startRef.current = e.clientX;
    swipedRef.current = false;
  };

  const move = (e) => {
    if (startRef.current === null) return;
    const delta = e.clientX - startRef.current;
    setOffset(Math.max(-82, Math.min(0, delta)));
    if (delta < -36) swipedRef.current = true;
  };

  const up = () => {
    if (offset < -44) setOffset(-82);
    else setOffset(0);
    startRef.current = null;
  };

  return (
    <div className="tx-wrap">
      <button className="tx-delete" onClick={() => onDelete(tx)}>
        {t('common.delete')}
      </button>
      <div
        className="tx-card"
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={() => {
          if (!swipedRef.current) onEdit(tx);
          swipedRef.current = false;
        }}
      >
        <div className={`tx-icon ${tx.type === 'income' ? 'in' : 'out'}`}>{tx.type === 'income' ? '↑' : '↓'}</div>
        <div className="tx-main">
          <div className="row-between">
            <div className="title" style={{ fontSize: '14.5px' }}>{transactionTitle(tx, t)}</div>
            <span className={tx.type === 'income' ? 'text-income' : 'text-expense'}>
              {tx.type === 'income' ? '+' : '−'}{formatNumber(tx.amount)}
            </span>
          </div>
          <div className="sub">{formatDateTime(tx.date, lang)} · {tx.description || tx.note || t('category.boshqa')}</div>
        </div>
      </div>
    </div>
  );
}

function AddTransactionModal({ initialType = 'expense', onClose, onDone }) {
  const { t, lang } = useApp();
  const [type, setType] = useState(initialType);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('yoqilgi');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(toInputDateTime(new Date()));
  const [busy, setBusy] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState(null);

  const submit = async () => {
    setConfirmPayload({
      type,
      amount: Number(amount),
      category: type === 'expense' ? category : undefined,
      description: note,
      date: new Date(date).toISOString(),
    });
  };

  const confirmSave = async () => {
    if (!confirmPayload) return;
    setBusy(true);
    try {
      await api.post('/transactions', confirmPayload);
      setConfirmPayload(null);
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={type === 'income' ? `+ ${t('finance.income')}` : `+ ${t('finance.expense')}`} onClose={onClose}>
      <div className="segment">
        <button className={type === 'income' ? 'active' : ''} onClick={() => setType('income')}>
          {t('finance.income')}
        </button>
        <button className={type === 'expense' ? 'active' : ''} onClick={() => setType('expense')}>
          {t('finance.expense')}
        </button>
      </div>
      <label className="label">{t('common.amount')} *</label>
      <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      {type === 'expense' && <CategorySelect t={t} value={category} onChange={setCategory} />}
      <label className="label">{t('common.notes')}</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="label">{t('common.date')}</label>
      <input className="input" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy || !amount}>
        {busy ? '...' : t('common.save')}
      </button>
      {confirmPayload && (
        <FinalConfirmModal
          rows={transactionConfirmRows(confirmPayload, t, lang)}
          busy={busy}
          onClose={() => setConfirmPayload(null)}
          onConfirm={confirmSave}
        />
      )}
    </Modal>
  );
}

function transactionConfirmRows(payload, t, lang) {
  return [
    { label: t('finance.type'), value: t(`finance.${payload.type === 'income' ? 'income' : 'expense'}`) },
    { label: t('common.amount'), value: formatMoney(payload.amount) },
    payload.type === 'expense' ? { label: t('finance.category'), value: t(`category.${payload.category}`) } : null,
    { label: t('common.notes'), value: payload.description },
    { label: t('common.date'), value: formatDateTime(payload.date, lang) },
  ].filter(Boolean);
}

function EditTransactionModal({ tx, onClose, onDelete, onDone }) {
  const { t } = useApp();
  const [amount, setAmount] = useState(tx.amount);
  const [note, setNote] = useState(tx.description || tx.note || '');
  const [category, setCategory] = useState(tx.category || 'boshqa_chiqim');
  const [date, setDate] = useState(toInputDateTime(tx.date));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/transactions/${tx._id}`, {
        amount: Number(amount),
        description: note,
        category: tx.type === 'expense' ? category : undefined,
        date: new Date(date).toISOString(),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('common.edit')} onClose={onClose}>
      <label className="label">{t('common.amount')}</label>
      <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      {tx.type === 'expense' && <CategorySelect t={t} value={category} onChange={setCategory} />}
      <label className="label">{t('common.date')}</label>
      <input className="input" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
      <label className="label">{t('common.notes')}</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-primary btn-block mb-8" onClick={save} disabled={busy || !amount}>
        {busy ? '...' : t('common.save')}
      </button>
      <button className="btn btn-danger btn-block" onClick={() => onDelete(tx)} disabled={busy}>
        {t('common.delete')}
      </button>
    </Modal>
  );
}

function CategorySelect({ t, value, onChange }) {
  return (
    <>
      <label className="label">{t('finance.category')}</label>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="yoqilgi">{t('category.yoqilgi')}</option>
        <option value="tamirlash">{t('category.tamirlash')}</option>
        <option value="oziq-ovqat">{t('category.oziq-ovqat')}</option>
        <option value="boshqa_chiqim">{t('category.boshqa_chiqim')}</option>
      </select>
    </>
  );
}

function transactionTitle(tx, t) {
  if (tx.type === 'income') {
    if (tx.description) return tx.description;
    if (tx.serviceId) return `Xizmat: ${tx.serviceId}`;
    return t('finance.income');
  }
  return `${tx.category ? t(`category.${tx.category}`) : t('category.boshqa')} ${tx.description ? `- ${tx.description}` : ''}`;
}

function groupTransactions(items, lang) {
  const groups = new Map();
  items.forEach((tx) => {
    const label = groupDateLabel(tx.date, lang);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(tx);
  });
  return Array.from(groups, ([dateLabel, items]) => ({ dateLabel, items }));
}

function groupDateLabel(date, lang) {
  const d = new Date(date);
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  if (sameDay) return lang === 'ru' ? '\u0421\u0435\u0433\u043e\u0434\u043d\u044f' : 'Bugun';

  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const wasYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
  if (wasYesterday) return lang === 'ru' ? '\u0412\u0447\u0435\u0440\u0430' : 'Kecha';

  return formatDate(d, lang);
}
// Oxirgi 6 oy uchun yengil CSS bar grafigi (Chart.js o'rniga). Joriy oy — siyoh, qolgani yumshoq yashil.
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
