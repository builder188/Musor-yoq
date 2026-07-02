import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { getInitData } from '../telegram.js';
import { formatDate, formatMoney } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';

export default function Items({ onBack = null }) {
  const { t, lang } = useApp();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('available');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);
  const [selling, setSelling] = useState(null);
  const [giving, setGiving] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status });
      if (search.trim()) params.set('search', search.trim());
      setItems(await api.get(`/items?${params.toString()}`));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const activeCount = useMemo(() => items.filter((item) => item.status === 'available').length, [items]);

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onBack && (
            <button className="btn btn-sm" onClick={onBack} aria-label={t('common.back')}>← {t('common.back')}</button>
          )}
          <h1 className="page-title" style={{ marginBottom: 0 }}>{t('items.title')}</h1>
        </div>
        <button
          className="icon-btn"
          style={{ background: 'var(--text)', color: 'var(--card)', border: 'none', fontSize: 21, boxShadow: 'var(--shadow-btn)' }}
          aria-label={t('common.add')}
          onClick={() => setCreating(true)}
        >
          +
        </button>
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
          {t('items.available')}
        </button>
        <button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>
          {t('finance.all')}
        </button>
        <button className={status === 'sold' ? 'active' : ''} onClick={() => setStatus('sold')}>
          {t('items.sold')}
        </button>
      </div>

      <div className="search">
        <span className="search-icon">⌕</span>
        <input
          value={search}
          placeholder={t('items.searchPlaceholder')}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <button className="btn btn-sm" onClick={load}>{t('common.search').replace('...', '')}</button>
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <div className="empty">{t('items.empty')}</div>
      ) : (
        items.map((item) => (
          <ItemCard
            key={item._id}
            item={item}
            onClick={() => setDetail(item)}
            t={t}
            lang={lang}
          />
        ))
      )}

      {creating && (
        <ItemFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {detail && (
        <ItemDetailModal
          item={detail}
          onClose={() => setDetail(null)}
          onSell={(item) => {
            setDetail(null);
            setSelling(item);
          }}
          onGive={(item) => {
            setDetail(null);
            setGiving(item);
          }}
          onDelete={(item) => {
            setDetail(null);
            setDeleting(item);
          }}
        />
      )}

      {selling && (
        <SellModal
          item={selling}
          onClose={() => setSelling(null)}
          onDone={() => {
            setSelling(null);
            load();
          }}
        />
      )}

      {giving && (
        <GiveModal
          item={giving}
          onClose={() => setGiving(null)}
          onDone={() => {
            setGiving(null);
            load();
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
            load();
          }}
        />
      )}
    </div>
  );
}

function ItemCard({ item, onClick, t, lang }) {
  const initial = (item.name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <button className={`list-item ${item.status !== 'available' ? 'is-done' : ''}`} type="button" onClick={onClick} style={{ width: '100%', textAlign: 'left' }}>
      <div className="job-card">
        <div className="avatar">{initial}</div>
        <div className="job-main">
          <div className="job-name">{item.name}</div>
          <div className="job-sub">{formatDate(item.acquiredAt || item.createdAt, lang)}</div>
          {item.estimatedPrice > 0 && <div className="job-price">{formatMoney(item.estimatedPrice)}</div>}
        </div>
        <span className={`badge ${item.status === 'available' ? 'badge-pending' : item.status === 'sold' ? 'badge-done' : 'badge-muted'}`}>
          {t(`items.status.${item.status}`)}
        </span>
      </div>
    </button>
  );
}

function ItemFormModal({ onClose, onSaved }) {
  const { t } = useApp();
  const [form, setForm] = useState({ itemName: '', estimatedPrice: '', notes: '' });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.post('/items', {
        itemName: form.itemName,
        estimatedPrice: form.estimatedPrice || null,
        notes: form.notes,
      });
      onSaved();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('items.add')} onClose={onClose}>
      <label className="label">{t('items.itemName')}</label>
      <input className="input" value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} />
      <label className="label">{t('items.estimatedPrice')}</label>
      <input className="input" type="number" value={form.estimatedPrice} onChange={(e) => setForm({ ...form, estimatedPrice: e.target.value })} />
      <label className="label">{t('common.notes')}</label>
      <textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy || !form.itemName.trim()}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}

function ItemDetailModal({ item, onClose, onSell, onGive, onDelete }) {
  const { t, lang } = useApp();
  const audioUrl = item.voice?.telegramFileId
    ? `${api.baseUrl}/api/items/audio/${encodeURIComponent(item.voice.telegramFileId)}?initData=${encodeURIComponent(getInitData())}`
    : null;
  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="mb-8">
        <span className={`badge ${item.status === 'available' ? 'badge-pending' : item.status === 'sold' ? 'badge-done' : 'badge-muted'}`}>
          {t(`items.status.${item.status}`)}
        </span>
      </div>
      <div className="card">
        <Row label={t('common.date')} value={formatDate(item.acquiredAt || item.createdAt, lang)} />
        {item.estimatedPrice > 0 && <Row label={t('items.estimatedPrice')} value={formatMoney(item.estimatedPrice)} />}
        {item.soldAmount > 0 && <Row label={t('items.soldAmount')} value={formatMoney(item.soldAmount)} />}
        {item.recipient && <Row label={t('items.recipient')} value={item.recipient} />}
        {item.notes && <Row label={t('common.notes')} value={item.notes} />}
      </div>

      {(item.sourceText || audioUrl) && (
        <div className="card">
          <div className="section-title compact">{t('items.source')}</div>
          {audioUrl && <audio controls src={audioUrl} style={{ width: '100%', marginBottom: 10 }} />}
          {item.sourceText && <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{item.sourceText}</div>}
        </div>
      )}

      {item.status === 'available' && (
        <>
          <div className="btn-row mb-8">
            <button className="btn btn-primary btn-block" onClick={() => onSell(item)}>
              {t('items.markSold')}
            </button>
            <button className="btn btn-block" onClick={() => onGive(item)}>
              {t('items.giveAway')}
            </button>
          </div>
          <button className="btn btn-danger btn-block" onClick={() => onDelete(item)}>
            {t('common.delete')}
          </button>
        </>
      )}
    </Modal>
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
    <Modal title={t('items.markSold')} onClose={onClose}>
      <label className="label">{t('common.amount')}</label>
      <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
    <Modal title={t('items.giveAway')} onClose={onClose}>
      <label className="label">{t('items.recipient')}</label>
      <input className="input" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}

function Row({ label, value }) {
  return (
    <div className="card-row" style={{ padding: '4px 0' }}>
      <span className="muted">{label}</span>
      <span style={{ textAlign: 'right', fontWeight: 500, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}
