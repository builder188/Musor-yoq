// Kerakli buyumlar — umumiy jadval (spreadsheet) ko'rinishi.
// Holat ustuni dropdown: Mavjud -> Sotilgan (summa so'raladi, kirim yoziladi) yoki
// Berib yuborilgan. Orqaga o'tish backendda yo'q — variantlar holatga qarab cheklanadi.
// Buyum ma'lumotini tahrirlash API'si yo'q — mavjud qatorlar faqat o'qiladi,
// yangi qator POST /items bilan saqlanadi. O'chirish — 1990-kod.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { getInitData } from '../telegram.js';
import { formatDateTime, formatMoney } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import SheetTable from '../components/SheetTable.jsx';
import LoadError from '../components/LoadError.jsx';

export default function Items({ onBack = null }) {
  const { t, lang } = useApp();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('available');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selling, setSelling] = useState(null);
  const [giving, setGiving] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setItems(await api.get(`/items?${new URLSearchParams({ status }).toString()}`));
      setLoadError(false);
    } catch {
      // Xato = bo'sh ro'yxat EMAS — banner ko'rsatamiz (yozuvlar bazada turibdi).
      setLoadError(true);
      setItems([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const activeCount = useMemo(() => items.filter((item) => item.status === 'available').length, [items]);

  const statusOptions = (row) => {
    if (row.status === 'available') {
      return [
        { value: 'available', label: t('items.status.available') },
        { value: 'sold', label: t('items.status.sold') },
        { value: 'given_away', label: t('items.status.given_away') },
      ];
    }
    return [{ value: row.status, label: t(`items.status.${row.status}`) }];
  };

  const columns = [
    {
      key: 'name',
      title: t('items.itemName'),
      width: 150,
      type: 'text',
      get: (r) => r.name || '',
      text: (r) => r.name || '',
      // Buyumni tahrirlash API'si yo'q — faqat draft (yangi qator) uchun yoziladi.
    },
    {
      key: 'status',
      title: t('common.status'),
      width: 130,
      type: 'select',
      options: statusOptions,
      draft: false,
      draftText: t('items.status.available'),
      get: (r) => r.status || '',
      text: (r) => (r.status ? t(`items.status.${r.status}`) : ''),
      apply: async (r, v) => {
        if (v === r.status) return;
        // Sotildi — summa modal orqali so'raladi (kirim backendda yoziladi);
        // berib yuborildi — oluvchi modal orqali. Ikkalasi mavjud oqimlar.
        if (v === 'sold') setSelling(r);
        else if (v === 'given_away') setGiving(r);
      },
    },
    {
      key: 'estimatedPrice',
      title: t('items.estimatedPrice'),
      width: 130,
      type: 'number',
      get: (r) => (r.estimatedPrice > 0 ? r.estimatedPrice : ''),
      text: (r) => (r.estimatedPrice > 0 ? formatMoney(r.estimatedPrice) : ''),
    },
    {
      key: 'soldAmount',
      title: t('items.soldAmount'),
      width: 130,
      type: 'number',
      draft: false,
      get: (r) => (r.soldAmount > 0 ? r.soldAmount : ''),
      text: (r) => (r.soldAmount > 0 ? formatMoney(r.soldAmount) : ''),
    },
    {
      key: 'recipient',
      title: t('items.recipient'),
      width: 120,
      type: 'text',
      draft: false,
      get: (r) => r.recipient || '',
      text: (r) => r.recipient || '',
    },
    {
      key: 'date',
      title: t('common.date'),
      width: 160,
      type: 'text',
      draft: false,
      get: (r) => r.acquiredAt || r.createdAt || '',
      text: (r) => formatDateTime(r.acquiredAt || r.createdAt, lang),
    },
    {
      key: 'notes',
      title: t('common.notes'),
      width: 170,
      type: 'text',
      get: (r) => r.notes || '',
      text: (r) => r.notes || '',
    },
  ];

  const draft = {
    defaults: {},
    canSave: (v) => !!String(v.name || '').trim(),
    save: async (v) => {
      await api.post('/items', {
        itemName: String(v.name).trim(),
        estimatedPrice: v.estimatedPrice || null,
        notes: v.notes || '',
      });
    },
  };

  return (
    <div>
      {loadError && <LoadError onRetry={() => load()} />}
      <div className="row-between" style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onBack && (
            <button className="btn btn-sm" onClick={onBack} aria-label={t('common.back')}>← {t('common.back')}</button>
          )}
          <h1 className="page-title" style={{ marginBottom: 0 }}>{t('items.title')}</h1>
        </div>
      </div>

      <div className="summary-card" style={{ marginTop: 12 }}>
        <div className="summary-col">
          <div className="summary-label">{t('items.available')}</div>
          <div className="summary-value">{activeCount}<span className="unit"> {t('home.countSuffix')}</span></div>
        </div>
        <div className="summary-divider" />
        <div className="summary-col wide">
          <div className="summary-label">{t('items.total')}</div>
          <div className="summary-value accent">{items.length}<span className="unit"> {t('home.countSuffix')}</span></div>
        </div>
      </div>

      <div className="segment">
        <button className={status === 'available' ? 'active' : ''} onClick={() => setStatus('available')}>
          {t('items.status.available')}
        </button>
        <button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>
          {t('finance.all')}
        </button>
        <button className={status === 'sold' ? 'active' : ''} onClick={() => setStatus('sold')}>
          {t('items.status.sold')}
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <SheetTable
          id="items"
          columns={columns}
          rows={items}
          rowKey={(r) => r._id}
          onChanged={() => load(true)}
          draft={draft}
          onDelete={setDeleting}
          rowDetail={(r) => <ItemDetail item={r} />}
          emptyText={t('items.empty')}
          t={t}
        />
      )}

      {selling && (
        <SellModal
          item={selling}
          onClose={() => setSelling(null)}
          onDone={() => {
            setSelling(null);
            load(true);
          }}
        />
      )}

      {giving && (
        <GiveModal
          item={giving}
          onClose={() => setGiving(null)}
          onDone={() => {
            setGiving(null);
            load(true);
          }}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          message={deleting.name}
          onClose={() => setDeleting(null)}
          onConfirm={async (code) => {
            await api.del(`/items/${deleting._id}`, { confirmationCode: code });
            setDeleting(null);
            load(true);
          }}
        />
      )}
    </div>
  );
}

// Yoyiladigan tafsilot: asl ovoz (qayta eshitish) va asl matn.
function ItemDetail({ item }) {
  const audioUrl = item.voice?.telegramFileId
    ? `${api.baseUrl}/api/items/audio/${encodeURIComponent(item.voice.telegramFileId)}?initData=${encodeURIComponent(getInitData())}`
    : null;
  if (!audioUrl && !item.sourceText) return null;
  return (
    <div>
      {audioUrl && <audio controls src={audioUrl} style={{ width: '100%', marginBottom: item.sourceText ? 8 : 0 }} />}
      {item.sourceText && (
        <div className="muted" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>🎙 {item.sourceText}</div>
      )}
    </div>
  );
}

function SellModal({ item, onClose, onDone }) {
  const { t } = useApp();
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/items/${item._id}/sold`, {
        amount,
        recipient,
        // O'tgan sanada sotilgan bo'lsa — kirim o'sha sanaga (oylik hisobot to'g'ri bo'lsin).
        date: date ? new Date(date).toISOString() : undefined,
      });
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${item.name} — ${t('items.markSold')}`} onClose={onClose}>
      <label className="label">{t('common.amount')}</label>
      <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      <label className="label">{t('items.recipient')}</label>
      <input className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      <label className="label">{t('common.date')}</label>
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy || !(Number(amount) > 0)}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}

function GiveModal({ item, onClose, onDone }) {
  const { t } = useApp();
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/items/${item._id}/give-away`, { recipient });
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${item.name} — ${t('items.giveAway')}`} onClose={onClose}>
      <label className="label">{t('items.recipient')}</label>
      <input className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}
