// Moliya sahifasi: balans + davr filtri + diagramma + tranzaksiyalar + qarzlar.
import { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { formatMoney, formatDate } from '../utils/format.js';
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
  const [debts, setDebts] = useState({ clients: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [s, c, tx, d] = await Promise.all([
        api.get(`/finance/summary?period=${period}`),
        api.get('/finance/chart'),
        api.get(`/finance/transactions?period=${period}`),
        api.get('/finance/debts'),
      ]);
      setSummary(s);
      setChart(c);
      setTransactions(tx);
      setDebts(d);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const chartData = chart && {
    labels: MONTHS,
    datasets: [
      { label: t('finance.income'), data: chart.income, backgroundColor: '#2f8f4e' },
      { label: t('finance.expense'), data: chart.expense, backgroundColor: '#e0484d' },
    ],
  };

  return (
    <div>
      <div className="row-between">
        <h1 className="page-title">{t('finance.title')}</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
          + {t('finance.addTransaction')}
        </button>
      </div>

      {/* Balans kartasi */}
      <div className="card">
        <div className="card-row">
          <span className="muted">{t('finance.income')}</span>
          <span className="text-income">{formatMoney(summary?.income ?? 0)}</span>
        </div>
        <div className="card-row">
          <span className="muted">{t('finance.expense')}</span>
          <span className="text-expense">{formatMoney(summary?.expense ?? 0)}</span>
        </div>
        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0' }} />
        <div className="card-row">
          <strong>{t('finance.balance')}</strong>
          <strong style={{ fontSize: 18 }}>{formatMoney(summary?.balance ?? 0)}</strong>
        </div>
      </div>

      {/* Davr filtri */}
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
          {/* Diagramma */}
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
                  scales: { y: { ticks: { callback: (v) => `${v / 1000}k` } } },
                }}
              />
            </div>
          )}

          {/* Qarzlar */}
          <div className="section-title">
            {t('finance.debts')} ({formatMoney(debts.total)})
          </div>
          {debts.clients.length === 0 ? (
            <div className="muted center mb-8">—</div>
          ) : (
            debts.clients.map((c) => (
              <div key={c._id} className="list-item" style={{ cursor: 'default' }}>
                <div className="row-between">
                  <div>
                    <div className="title">{c.name}</div>
                    <div className="sub text-expense">{formatMoney(c.totalDebt)}</div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => setPaying(c)}>
                    {t('finance.addPayment')}
                  </button>
                </div>
              </div>
            ))
          )}

          {/* Tranzaksiyalar */}
          <div className="section-title">{t('finance.transactions')}</div>
          {transactions.length === 0 ? (
            <div className="empty">{t('common.noData')}</div>
          ) : (
            transactions.map((tx) => (
              <div key={tx._id} className="list-item" onClick={() => setDeleting(tx)}>
                <div className="row-between">
                  <div>
                    <div className="title">
                      {tx.type === 'expense'
                        ? `${t('finance.expense')} · ${t(`category.${tx.category || 'boshqa'}`)}`
                        : tx.type === 'debt_payment'
                        ? t('finance.addPayment')
                        : t('finance.income')}
                    </div>
                    <div className="sub">
                      {formatDate(tx.date)}
                      {tx.note ? ` · ${tx.note}` : ''}
                    </div>
                  </div>
                  <span className={tx.type === 'expense' ? 'text-expense' : 'text-income'}>
                    {tx.type === 'expense' ? '-' : '+'}
                    {formatMoney(tx.amount)}
                  </span>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {paying && (
        <PaymentModal
          client={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            load();
          }}
        />
      )}

      {adding && (
        <AddTransactionModal
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          message={`${formatMoney(deleting.amount)}`}
          onClose={() => setDeleting(null)}
          onConfirm={async (code) => {
            await api.del(`/finance/transactions/${deleting._id}`, { confirmationCode: code });
            setDeleting(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function PaymentModal({ client, onClose, onDone }) {
  const { t } = useApp();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/finance/debts/${client._id}/payment`, { amount: Number(amount) });
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${t('finance.addPayment')} — ${client.name}`} onClose={onClose}>
      <p className="muted mb-8">
        {t('finance.remaining')}: {formatMoney(client.totalDebt)}
      </p>
      <label className="label">{t('finance.payment')}</label>
      <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy || !amount}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}

function AddTransactionModal({ onClose, onDone }) {
  const { t } = useApp();
  const [type, setType] = useState('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('yoqilg\'i');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/finance/transactions', {
        type,
        amount: Number(amount),
        category: type === 'expense' ? category : undefined,
        note,
      });
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('finance.addTransaction')} onClose={onClose}>
      <div className="segment">
        <button className={type === 'expense' ? 'active' : ''} onClick={() => setType('expense')}>
          {t('finance.expense')}
        </button>
        <button className={type === 'income' ? 'active' : ''} onClick={() => setType('income')}>
          {t('finance.income')}
        </button>
      </div>
      <label className="label">{t('common.amount')}</label>
      <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      {type === 'expense' && (
        <>
          <label className="label">{t('finance.category')}</label>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="yoqilg'i">{t("category.yoqilg'i")}</option>
            <option value="ta'mirlash">{t("category.ta'mirlash")}</option>
            <option value="oziq-ovqat">{t('category.oziq-ovqat')}</option>
            <option value="boshqa">{t('category.boshqa')}</option>
          </select>
        </>
      )}
      <label className="label">{t('common.notes')}</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-primary btn-block" onClick={submit} disabled={busy || !amount}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}
