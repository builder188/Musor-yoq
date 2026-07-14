// "Kategoriyalar" bo'limi — umumiy jadval (spreadsheet) ko'rinishi.
// Asosiy jadval: Kerakli buyumlar + material/kirim/chiqim kategoriyalari + "Boshqa".
// Har kategoriya ichidagi yozuvlar ham jadval: sana/summa/izoh joyida tahrirlanadi
// (PUT /transactions/:id — biznes mantiq backendda), ovoz yozuvi qatordan yoyiladi.
import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { api } from '../api/client.js';
import { getInitData } from '../telegram.js';
import { formatMoney, formatDateTime, toInputDateTime } from '../utils/format.js';
import Spinner from '../components/Spinner.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx';
import SheetTable from '../components/SheetTable.jsx';
import Items from './Items.jsx';
import LoadError from '../components/LoadError.jsx';

export default function Categories() {
  const { t, lang } = useApp();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState(null); // { kind, name, value }
  const [showItems, setShowItems] = useState(false);
  const [merging, setMerging] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setOverview(await api.get('/categories'));
      setLoadError(false);
    } catch {
      // Xato = bo'sh sahifa EMAS — banner ko'rsatamiz (yozuvlar bazada turibdi).
      setLoadError(true);
      setOverview(null);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (showItems) {
    return <Items onBack={() => { setShowItems(false); load(true); }} />;
  }
  if (selected) {
    return (
      <CategoryRecords
        kind={selected.kind}
        name={selected.name}
        value={selected.value}
        lang={lang}
        onBack={() => {
          setSelected(null);
          load(true);
        }}
      />
    );
  }

  const materials = overview?.materials || [];
  const items = overview?.items || { available: 0, total: 0 };
  const incomes = overview?.incomes || [];
  const expenses = overview?.expenses || [];
  const other = overview?.other || { count: 0, totalIncome: 0, totalExpense: 0 };

  // Barcha kategoriya turlari bitta jadvalda; ochish (›) tegishli yozuvlar jadvaliga olib kiradi.
  const rows = [
    {
      kind: 'items',
      key: '__items',
      name: t('categories.usefulItems'),
      typeLabel: t('sheet.special'),
      count: items.total,
      totalText: `${items.available} ${t('items.available').toLowerCase()}`,
    },
    ...materials.map((m) => ({
      kind: 'material',
      key: `m:${m.name}`,
      name: m.name,
      typeLabel: t('categories.materials'),
      count: m.count || 0,
      totalKg: m.totalKg || 0,
      totalText: m.total > 0 ? `+${formatNumber(m.total)}` : '',
      totalClass: 'text-income',
    })),
    ...incomes.map((c) => ({
      kind: 'income',
      key: `i:${c.value || c.name}`,
      name: c.name,
      value: c.value || c.name,
      typeLabel: t('finance.income'),
      count: c.count || 0,
      totalText: c.total > 0 ? `+${formatNumber(c.total)}` : '',
      totalClass: 'text-income',
    })),
    ...expenses.map((c) => ({
      kind: 'expense',
      key: `e:${c.value || c.name}`,
      name: c.name,
      value: c.value || c.name,
      typeLabel: t('finance.expense'),
      count: c.count || 0,
      totalText: c.total > 0 ? `−${formatNumber(c.total)}` : '',
      totalClass: 'text-expense',
    })),
    {
      kind: 'other',
      key: '__other',
      name: t('categories.other'),
      typeLabel: t('sheet.special'),
      count: other.count || 0,
      totalText: [
        other.totalIncome > 0 ? `+${formatNumber(other.totalIncome)}` : '',
        other.totalExpense > 0 ? `−${formatNumber(other.totalExpense)}` : '',
      ]
        .filter(Boolean)
        .join(' / '),
    },
  ];

  // Kategoriya nomini o'zgartirish API'si yo'q — ustunlar faqat o'qish uchun;
  // yangi qator esa POST /categories (material kategoriyasi) orqali saqlanadi.
  const columns = [
    {
      key: 'name',
      title: t('categories.name'),
      width: 170,
      type: 'text',
      get: (r) => r.name || '',
      text: (r) => r.name || '',
    },
    {
      key: 'typeLabel',
      title: t('finance.type'),
      width: 120,
      type: 'text',
      draft: false,
      draftText: t('categories.materials'),
      get: (r) => r.typeLabel || '',
      text: (r) => r.typeLabel || '',
    },
    {
      key: 'count',
      title: t('categories.recordsCount'),
      width: 100,
      type: 'number',
      draft: false,
      get: (r) => r.count ?? '',
      text: (r) => String(r.count ?? 0),
    },
    {
      // Materiallar uchun jami sotilgan miqdor (kg); boshqa turlarda bo'sh.
      key: 'totalKg',
      title: t('categories.kg'),
      width: 110,
      type: 'number',
      draft: false,
      get: (r) => (r.totalKg > 0 ? r.totalKg : ''),
      text: (r) => (r.totalKg > 0 ? `${formatNumber(r.totalKg)} kg` : ''),
    },
    {
      key: 'totalText',
      title: t('common.total'),
      width: 140,
      type: 'text',
      draft: false,
      get: (r) => r.totalText || '',
      text: (r) => r.totalText || '',
      render: (r) => <span className={r.totalClass || ''}>{r.totalText || ''}</span>,
    },
  ];

  const draft = {
    defaults: {},
    canSave: (v) => !!String(v.name || '').trim(),
    save: async (v) => {
      await api.post('/categories', { name: String(v.name).trim() });
    },
  };

  const openRow = (row) => {
    if (row.kind === 'items') setShowItems(true);
    else setSelected({ kind: row.kind, name: row.name, value: row.value });
  };

  return (
    <div>
      {loadError && <LoadError onRetry={() => load()} />}
      <div className="row-between" style={{ marginBottom: 8 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{t('categories.title')}</h1>
        {/* Bir martalik (va kerak bo'lsa qayta) dublikat tozalash vositasi. */}
        <button className="btn btn-sm" onClick={() => setMerging(true)}>
          🔀 {t('categories.mergeTool')}
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <SheetTable
          id="categories"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.key}
          onChanged={() => load(true)}
          draft={draft}
          onRowOpen={openRow}
          actions={(row) => (
            <button type="button" aria-label={t('sheet.open')} onClick={() => openRow(row)}>
              ›
            </button>
          )}
          emptyText={t('common.noData')}
          t={t}
        />
      )}

      {merging && (
        <MergeDuplicatesModal
          onClose={() => setMerging(false)}
          onDone={() => {
            setMerging(false);
            load(true);
          }}
        />
      )}
    </div>
  );
}

// "Dublikat kategoriyalarni birlashtirish": backend deterministik + AI bilan taxminiy
// juftlarni topadi; foydalanuvchi HAR BIR juftlikni belgilab, qoladigan nomni tanlaydi
// (standart — ko'proq ishlatilgani), so'ng 1990-kod bilan tasdiqlaydi. Avtomatik
// birlashtirish YO'Q.
function MergeDuplicatesModal({ onClose, onDone }) {
  const { t } = useApp();
  const [pairs, setPairs] = useState(null); // null = yuklanmoqda
  const [scanError, setScanError] = useState(false);
  const [chosen, setChosen] = useState({}); // pairKey -> qoladigan value ('' = tanlanmagan)
  const [confirming, setConfirming] = useState(false);
  const [doneResults, setDoneResults] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/categories/duplicates');
        if (alive) setPairs(Array.isArray(res?.pairs) ? res.pairs : []);
      } catch {
        if (alive) {
          setScanError(true);
          setPairs([]);
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  const pairKey = (p) => `${p.kind}:${p.a.value}||${p.b.value}`;
  const kindLabel = (kind) =>
    kind === 'material' ? t('categories.materials') : kind === 'expense' ? t('finance.expense') : t('finance.income');

  const toggle = (p) => {
    const key = pairKey(p);
    setChosen((c) => {
      const next = { ...c };
      if (next[key]) delete next[key];
      else next[key] = p.suggested; // standart: ko'proq ishlatilgani / default tomon
      return next;
    });
  };

  const pickSurvivor = (p, value) => {
    const key = pairKey(p);
    setChosen((c) => ({ ...c, [key]: value }));
  };

  const merges = (pairs || [])
    .filter((p) => chosen[pairKey(p)])
    .map((p) => {
      const to = chosen[pairKey(p)];
      const from = to === p.a.value ? p.b.value : p.a.value;
      return { kind: p.kind, from, to };
    });

  if (doneResults) {
    return (
      <Modal title={t('categories.mergeTool')} onClose={onDone}>
        <div className="center" style={{ padding: '12px 0', fontSize: 15 }}>✅ {t('categories.mergeDone')}</div>
        {doneResults.map((r, i) => (
          <div key={i} className="sub" style={{ padding: '2px 0' }}>
            "{r.from}" → "{r.to}" · {r.moved} {t('categories.mergeMoved')}
          </div>
        ))}
        <button className="btn btn-primary btn-block mt-12" onClick={onDone}>OK</button>
      </Modal>
    );
  }

  return (
    <Modal title={`🔀 ${t('categories.mergeTool')}`} onClose={onClose}>
      {pairs === null ? (
        <div className="center" style={{ padding: '16px 0' }}>{t('categories.mergeScan')}</div>
      ) : pairs.length === 0 ? (
        <>
          {scanError && <div className="error-banner" style={{ marginBottom: 10 }}>{t('common.loadError')}</div>}
          {!scanError && <div className="center" style={{ padding: '16px 0' }}>{t('categories.mergeNone')}</div>}
          <button className="btn btn-block" onClick={onClose}>{t('common.close')}</button>
        </>
      ) : (
        <>
          <div className="sub" style={{ marginBottom: 10 }}>{t('categories.mergeHint')}</div>
          {pairs.map((p) => {
            const key = pairKey(p);
            const selected = chosen[key] || '';
            // Default (asosiy) kategoriya o'chirilmaydi — qoladigan tomon faqat o'sha.
            const lockValue = p.a.isDefault ? p.a.value : p.b.isDefault ? p.b.value : null;
            return (
              <div key={key} className="card" style={{ marginBottom: 10 }}>
                <label className="card-row" style={{ padding: 0, cursor: 'pointer' }}>
                  <span style={{ fontWeight: 600 }}>
                    {p.a.name} ↔ {p.b.name}
                  </span>
                  <input type="checkbox" checked={!!selected} onChange={() => toggle(p)} />
                </label>
                <div className="sub" style={{ marginTop: 2 }}>
                  {kindLabel(p.kind)} · {p.a.count + p.b.count} {t('categories.recordsCount')}
                </div>
                {selected && (
                  <div style={{ marginTop: 8 }}>
                    <div className="label" style={{ marginBottom: 4 }}>{t('categories.mergeKeep')}</div>
                    <div className="btn-row">
                      {[p.a, p.b].map((side) => (
                        <button
                          key={side.value}
                          className={`btn btn-sm btn-block ${selected === side.value ? 'btn-primary' : ''}`}
                          disabled={!!lockValue && lockValue !== side.value}
                          onClick={() => pickSurvivor(p, side.value)}
                        >
                          {side.name} · {side.count}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <button className="btn btn-primary btn-block" disabled={!merges.length} onClick={() => setConfirming(true)}>
            🔀 {t('categories.mergeDo')}{merges.length ? ` (${merges.length})` : ''}
          </button>
        </>
      )}

      {confirming && (
        <ConfirmDeleteModal
          title={t('categories.mergeTool')}
          message={merges.map((m) => `"${m.from}" → "${m.to}"`).join(', ')}
          onClose={() => setConfirming(false)}
          onConfirm={async (code) => {
            const res = await api.post('/categories/merge', { merges, confirmationCode: code });
            setConfirming(false);
            setDoneResults(Array.isArray(res?.results) ? res.results : []);
          }}
        />
      )}
    </Modal>
  );
}

// Bitta kategoriya yozuvlari jadvali (material/kirim/chiqim/boshqa).
// Yozuvlar — tranzaksiyalar: sana/summa/izoh (materialda kg va 1 kg narxi ham)
// joyida tahrirlanadi; ovozli yozuv qator ostida yoyilib eshitiladi; o'chirish 1990-kod.
function CategoryRecords({ kind, name, value, lang, onBack }) {
  const { t } = useApp();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);

  const recordsUrl = () => {
    if (kind === 'material') return `/categories/material/${encodeURIComponent(name)}/records`;
    if (kind === 'income') return `/categories/income/${encodeURIComponent(value || name)}/records`;
    if (kind === 'expense') return `/categories/expense/${encodeURIComponent(value || name)}/records`;
    return '/categories/other/records';
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get(recordsUrl());
      setRecords(Array.isArray(res?.records) ? res.records : []);
    } catch {
      setRecords([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, name, value]);

  const putTx = (row, body) => api.put(`/transactions/${row.id}`, body);

  const columns = [
    {
      key: 'date',
      title: t('common.date'),
      width: 170,
      type: 'datetime',
      get: (r) => (r.date ? toInputDateTime(r.date) : ''),
      text: (r) => (r.date ? formatDateTime(r.date, lang) : ''),
      apply: (r, v) => {
        if (!v) return null;
        return putTx(r, { date: new Date(v).toISOString() });
      },
    },
    {
      key: 'amount',
      title: t('common.amount'),
      width: 120,
      type: 'number',
      get: (r) => (r.amount > 0 ? r.amount : ''),
      text: (r) => {
        if (!(r.amount > 0)) return '';
        const sign = r.type === 'expense' || kind === 'expense' ? '−' : '+';
        return `${sign}${formatNumber(r.amount)}`;
      },
      apply: (r, v) => {
        if (v === '' || v === null) return null;
        return putTx(r, { amount: Number(v) });
      },
    },
    ...(kind === 'material'
      ? [
          {
            key: 'quantityKg',
            title: t('categories.kg'),
            width: 100,
            type: 'number',
            get: (r) => (r.quantityKg > 0 ? r.quantityKg : ''),
            text: (r) => (r.quantityKg > 0 ? `${formatNumber(r.quantityKg)} kg` : ''),
            apply: (r, v) => putTx(r, { quantityKg: v === '' ? null : Number(v) }),
          },
          {
            key: 'pricePerKg',
            title: t('categories.perKg'),
            width: 110,
            type: 'number',
            get: (r) => (r.pricePerKg > 0 ? r.pricePerKg : ''),
            text: (r) => (r.pricePerKg > 0 ? `${formatNumber(r.pricePerKg)}/kg` : ''),
            apply: (r, v) => putTx(r, { pricePerKg: v === '' ? null : Number(v) }),
          },
        ]
      : []),
    {
      key: 'description',
      title: t('common.notes'),
      width: 200,
      type: 'text',
      get: (r) => r.description || '',
      text: (r) => r.description || r.sourceText || '',
      apply: (r, v) => putTx(r, { description: v }),
    },
  ];

  // Yangi yozuv: material sotuvida material nomi bilan, kirim/chiqimda kategoriya bilan.
  // "Boshqa" bo'limida yangi yozuv Moliya jadvalidan qo'shiladi (toifasiz yozuvlar).
  const draft =
    kind === 'other'
      ? null
      : {
          defaults: {},
          canSave: (v) => !!(String(v.amount || '').trim() || String(v.quantityKg || '').trim() || String(v.description || '').trim()),
          save: async (v) => {
            if (kind === 'material') {
              await api.post('/finance/transactions', {
                type: 'income',
                category: 'material',
                materialName: name,
                amount: v.amount ? Number(v.amount) : 0,
                quantityKg: v.quantityKg ? Number(v.quantityKg) : null,
                pricePerKg: v.pricePerKg ? Number(v.pricePerKg) : null,
                // O'tgan sana ham kiritilishi mumkin — hisobot o'sha oyga tushadi.
                date: v.date ? new Date(v.date).toISOString() : undefined,
              });
              return;
            }
            await api.post('/transactions', {
              type: kind === 'income' ? 'income' : 'expense',
              category: value || name,
              amount: v.amount ? Number(v.amount) : 0,
              description: v.description || '',
              date: v.date ? new Date(v.date).toISOString() : undefined,
            });
          },
        };

  const total = records.reduce((sum, r) => sum + (r.amount || 0), 0);

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-sm" onClick={onBack}>← {t('common.back')}</button>
          <h1 className="page-title" style={{ marginBottom: 0 }}>{name}</h1>
        </div>
      </div>

      <div className="summary-card" style={{ marginBottom: 12 }}>
        <div className="summary-col">
          <div className="summary-label">{t('categories.recordsCount')}</div>
          <div className="summary-value">{records.length}</div>
        </div>
        <div className="summary-divider" />
        <div className="summary-col wide">
          <div className="summary-label">{kind === 'expense' ? t('finance.expense') : t('finance.income')}</div>
          <div className={`summary-value ${kind === 'expense' ? '' : 'accent'}`}>
            {kind === 'expense' ? '−' : '+'}{formatNumber(total)}
            <span className="unit"> {t('common.soum')}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <SheetTable
          id={`category-records-${kind}`}
          columns={columns}
          rows={records}
          rowKey={(r) => r.id}
          onChanged={() => load(true)}
          draft={draft}
          onDelete={setDeleting}
          rowDetail={(r) => <RecordDetail record={r} />}
          emptyText={t('categories.noRecords')}
          t={t}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          message={formatMoney(deleting.amount)}
          onClose={() => setDeleting(null)}
          onConfirm={async (code) => {
            await api.del(`/transactions/${deleting.id}`, { confirmationCode: code });
            setDeleting(null);
            load(true);
          }}
        />
      )}
    </div>
  );
}

// Yoyiladigan tafsilot: asl ovoz (qayta eshitish) va asl matn. Ovoz ham matn ham
// bo'lmasa detail ko'rsatilmaydi (SheetTable null'ni tugmasiz qoldiradi).
function RecordDetail({ record }) {
  const audioUrl = record.voiceFileId
    ? `${api.baseUrl}/api/items/audio/${encodeURIComponent(record.voiceFileId)}?initData=${encodeURIComponent(getInitData())}`
    : null;
  if (!audioUrl && !record.sourceText) return null;
  return (
    <div>
      {audioUrl && <audio controls src={audioUrl} style={{ width: '100%', marginBottom: record.sourceText ? 8 : 0 }} />}
      {record.sourceText && (
        <div className="muted" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>🎙 {record.sourceText}</div>
      )}
    </div>
  );
}

function formatNumber(n) {
  return Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
