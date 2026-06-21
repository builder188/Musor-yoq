import { useEffect, useRef, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatDate, toInputDateTime } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const PERIODS = ['today', 'month', 'last_month', 'year', 'all'];
const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];

export default function Finance() {
  const { t } = useApp();
  const [period, setPeriod] = useState('month');
  const [summary, setSummary] = useState(null);
  const [chart, setChart] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(null);
  const [editingTx, setEditingTx] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [s, c, tx] = await Promise.all([
        api.get(`/finance/summary?period=${period}`),
        api.get('/finance/chart'),
        api.get(`/finance/transactions?period=${period}`),
      ]);
      setSummary(s);
      setChart(c);
      setTransactions(normalizeTransactions(tx));
    } catch {
      setSummary(null);
      setChart(null);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const chartData = makeChartData(chart);

  return (
    <div>
      <h1 className="page-title">{t('finance.title')}</h1>

      <BalanceCard summary={summary} />

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
          {chartData && (
            <div className="card">
              <div className="mb-8">
                <strong>{t('finance.chart')}</strong>
              </div>
              <Bar
                data={chartData}
                options={{
                  responsive: true,
                  plugins: { legend: { position: 'bottom' } },
                  scales: { y: { ticks: { callback: (v) => `${Math.round(v / 1000)}k` } } },
                }}
              />
            </div>
          )}

          <div className="btn-row mb-8">
            <button className="btn btn-primary btn-block" onClick={() => setAdding('income')}>
              ➕ {t('finance.income')}
            </button>
            <button className="btn btn-block" onClick={() => setAdding('expense')}>
              ➖ {t('finance.expense')}
            </button>
          </div>

          <div className="section-title">{t('finance.transactions')}</div>
          {transactions.length === 0 ? (
            <div className="empty">{t('common.noData')}</div>
          ) : (
            <TransactionGroups groups={groupTransactions(transactions)} t={t} onEdit={setEditingTx} onDelete={setDeleting} />
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
    </div>
  );
}

function BalanceCard({ summary }) {
  const { t } = useApp();
  const balance = Number(summary?.balance ?? 0);
  const income = Number(summary?.income ?? summary?.totalIncome ?? 0);
  const expense = Number(summary?.expense ?? summary?.totalExpense ?? 0);
  const positive = balance >= 0;

  return (
    <div className={`balance-card ${positive ? 'positive' : 'negative'}`}>
      <div className="muted">{t('finance.balance')}</div>
      <div className="balance-amount">{formatMoney(balance)}</div>
      <div className="balance-row">
        <span className="text-income">↑ {t('finance.income')}: {formatMoney(income)}</span>
        <span className="text-expense">↓ {t('finance.expense')}: {formatMoney(expense)}</span>
      </div>
    </div>
  );
}

function TransactionGroups({ groups, t, onEdit, onDelete }) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.dateLabel}>
          <div className="section-title">{group.dateLabel}</div>
          {group.items.map((tx) => (
            <SwipeTransaction key={tx._id} tx={tx} t={t} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      ))}
    </>
  );
}

function SwipeTransaction({ tx, t, onEdit, onDelete }) {
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
        <div className={`tx-line ${tx.type === 'income' ? 'income' : 'expense'}`} />
        <div className="tx-main">
          <div className="row-between">
            <div className="title">
              <span className={tx.type === 'income' ? 'text-income' : 'text-expense'}>{tx.type === 'income' ? '↑' : '↓'}</span>{' '}
              {transactionTitle(tx, t)}
            </div>
            <span className={tx.type === 'income' ? 'text-income' : 'text-expense'}>
              {tx.type === 'income' ? '+' : '-'}{formatMoney(tx.amount)}
            </span>
          </div>
          <div className="sub">{formatDate(tx.date)} · {tx.description || tx.note || t('category.boshqa')}</div>
        </div>
      </div>
    </div>
  );
}

function AddTransactionModal({ initialType = 'expense', onClose, onDone }) {
  const { t } = useApp();
  const [type, setType] = useState(initialType);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('yoqilgi');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(toInputDateTime(new Date()));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/transactions', {
        type,
        amount: Number(amount),
        category: type === 'expense' ? category : undefined,
        description: note,
        date: new Date(date).toISOString(),
      });
      onDone();
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
    </Modal>
  );
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

function groupTransactions(items) {
  const groups = new Map();
  items.forEach((tx) => {
    const label = groupDateLabel(tx.date);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(tx);
  });
  return Array.from(groups, ([dateLabel, items]) => ({ dateLabel, items }));
}

function groupDateLabel(date) {
  const d = new Date(date);
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  if (sameDay) return 'Bugun';

  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const wasYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
  if (wasYesterday) return 'Kecha';

  return new Intl.DateTimeFormat('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

function makeChartData(chart) {
  if (!chart) return null;
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ index: d.getMonth(), label: MONTHS[d.getMonth()] });
  }
  return {
    labels: months.map((m) => m.label),
    datasets: [
      { label: 'Kirim', data: months.map((m) => chart.income[m.index] || 0), backgroundColor: '#2f8f4e' },
      { label: 'Chiqim', data: months.map((m) => chart.expense[m.index] || 0), backgroundColor: '#e0484d' },
    ],
  };
}

function normalizeTransactions(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}
