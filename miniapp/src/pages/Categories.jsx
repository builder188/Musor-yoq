import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { getInitData } from '../telegram.js';
import { formatMoney, formatDateTime } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import Items from './Items.jsx';

// "Kategoriyalar" bo'limi: material kategoriyalari (Paxta, Taxta, ...) + "Kerakli buyumlar".
// Har bir material kategoriyasiga kirilganda — sotuv yozuvlari (sana, kg, narx, balans
// bayrog'i va asl ovoz). "Kerakli buyumlar" → buyumlar inventari (Items).
export default function Categories() {
  const { t, lang } = useApp();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [showItems, setShowItems] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setOverview(await api.get('/categories'));
    } catch {
      setOverview(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (showItems) {
    return <Items onBack={() => setShowItems(false)} />;
  }
  if (selectedMaterial) {
    return <MaterialDetail name={selectedMaterial} lang={lang} onBack={() => { setSelectedMaterial(null); load(); }} />;
  }

  const materials = overview?.materials || [];
  const items = overview?.items || { available: 0, total: 0 };

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{t('categories.title')}</h1>
        <button
          className="icon-btn"
          style={{ background: 'var(--text)', color: 'var(--card)', border: 'none', fontSize: 21, boxShadow: 'var(--shadow-btn)' }}
          aria-label={t('categories.create')}
          onClick={() => setCreating(true)}
        >
          +
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <>
          {/* Kerakli buyumlar — alohida maxsus kategoriya */}
          <button className="list-item" type="button" onClick={() => setShowItems(true)} style={{ width: '100%', textAlign: 'left' }}>
            <div className="job-card">
              <div className="avatar">📦</div>
              <div className="job-main">
                <div className="job-name">{t('categories.usefulItems')}</div>
                <div className="job-sub">{items.available} {t('items.available').toLowerCase()} · {items.total} {t('home.countSuffix')}</div>
              </div>
              <span className="chevron">›</span>
            </div>
          </button>

          <div className="section-title">{t('categories.materials')}</div>
          {materials.length === 0 ? (
            <div className="empty">{t('common.noData')}</div>
          ) : (
            materials.map((m) => (
              <button key={m.name} className="list-item" type="button" onClick={() => setSelectedMaterial(m.name)} style={{ width: '100%', textAlign: 'left' }}>
                <div className="job-card">
                  <div className="avatar">{(m.name || '?').trim().charAt(0).toUpperCase()}</div>
                  <div className="job-main">
                    <div className="job-name">{m.name}</div>
                    <div className="job-sub">
                      {m.count > 0
                        ? `${m.count} ${t('categories.salesCount')}${m.totalKg > 0 ? ` · ${formatNumber(m.totalKg)} kg` : ''}`
                        : t('categories.noSales')}
                    </div>
                  </div>
                  {m.total > 0 && <span className="text-income">+{formatNumber(m.total)}</span>}
                </div>
              </button>
            ))
          )}
        </>
      )}

      {creating && (
        <CreateCategoryModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateCategoryModal({ onClose, onSaved }) {
  const { t } = useApp();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.post('/categories', { name: name.trim() });
      onSaved();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('categories.create')} onClose={onClose}>
      <label className="label">{t('categories.name')}</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t('categories.namePlaceholder')} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy || !name.trim()}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}

// Bitta material kategoriyasi: sotuv yozuvlari (sana, kg, kilo narxi, jami, balans, ovoz).
function MaterialDetail({ name, lang, onBack }) {
  const { t } = useApp();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/categories/material/${encodeURIComponent(name)}/records`);
      setRecords(Array.isArray(res?.records) ? res.records : []);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const total = records.reduce((sum, r) => sum + (r.amount || 0), 0);

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-sm" onClick={onBack}>← {t('common.back')}</button>
          <h1 className="page-title" style={{ marginBottom: 0 }}>{name}</h1>
        </div>
        <button
          className="icon-btn"
          style={{ background: 'var(--text)', color: 'var(--card)', border: 'none', fontSize: 21, boxShadow: 'var(--shadow-btn)' }}
          aria-label={t('categories.addSale')}
          onClick={() => setAdding(true)}
        >
          +
        </button>
      </div>

      <div className="summary-card" style={{ marginBottom: 12 }}>
        <div className="summary-col">
          <div className="summary-label">{t('categories.salesCount')}</div>
          <div className="summary-value">{records.length}</div>
        </div>
        <div className="summary-divider" />
        <div className="summary-col wide">
          <div className="summary-label">{t('finance.income')}</div>
          <div className="summary-value accent">{formatNumber(total)}<span className="unit"> {t('common.soum')}</span></div>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : records.length === 0 ? (
        <div className="empty">{t('categories.noSales')}</div>
      ) : (
        records.map((r) => <MaterialRecordCard key={r.id} record={r} t={t} lang={lang} />)
      )}

      {adding && (
        <AddMaterialSaleModal
          name={name}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function MaterialRecordCard({ record, t, lang }) {
  const audioUrl = record.voiceFileId
    ? `${api.baseUrl}/api/items/audio/${encodeURIComponent(record.voiceFileId)}?initData=${encodeURIComponent(getInitData())}`
    : null;
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row-between">
        <div style={{ fontWeight: 600 }}>{formatMoney(record.amount)}</div>
        <span className={`badge ${record.balanceAdded ? 'badge-done' : 'badge-muted'}`}>
          {record.balanceAdded ? t('categories.inBalance') : t('categories.notInBalance')}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        {formatDateTime(record.date, lang)}
        {record.quantityKg > 0 ? ` · ${formatNumber(record.quantityKg)} kg` : ''}
        {record.pricePerKg > 0 ? ` · ${formatMoney(record.pricePerKg)}/kg` : ''}
      </div>
      {audioUrl && <audio controls src={audioUrl} style={{ width: '100%', marginTop: 8 }} />}
      {record.sourceText && <div className="muted" style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap' }}>{record.sourceText}</div>}
    </div>
  );
}

function AddMaterialSaleModal({ name, onClose, onSaved }) {
  const { t } = useApp();
  const [amount, setAmount] = useState('');
  const [quantityKg, setQuantityKg] = useState('');
  const [pricePerKg, setPricePerKg] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.post('/finance/transactions', {
        type: 'income',
        category: 'material',
        materialName: name,
        amount: Number(amount),
        quantityKg: quantityKg ? Number(quantityKg) : null,
        pricePerKg: pricePerKg ? Number(pricePerKg) : null,
        // O'tgan sana ham kiritilishi mumkin — hisobot o'sha oyga tushadi.
        date: date ? new Date(date).toISOString() : undefined,
      });
      onSaved();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${name} — ${t('categories.addSale')}`} onClose={onClose}>
      <label className="label">{t('common.amount')} *</label>
      <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      <label className="label">{t('categories.kg')}</label>
      <input className="input" type="number" value={quantityKg} onChange={(e) => setQuantityKg(e.target.value)} />
      <label className="label">{t('categories.perKg')}</label>
      <input className="input" type="number" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)} />
      <label className="label">{t('common.date')}</label>
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy || !(Number(amount) > 0)}>
        {busy ? '...' : t('common.save')}
      </button>
    </Modal>
  );
}

function formatNumber(n) {
  return Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
