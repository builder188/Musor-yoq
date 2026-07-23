// Umumiy "Google Sheets" uslubidagi jadval komponenti — barcha ro'yxat sahifalari uchun.
// Imkoniyatlar: qator raqamlari, katakni bosib joyida tahrirlash, enum ustunlar uchun
// dropdown, ustun kengligini sudrab o'zgartirish, barcha ustunlar bo'yicha qidiruv,
// "+" bilan jadval oxiriga bo'sh qator (alohida forma yo'q), birinchi ustun sticky.
// Biznes mantiq chetlab o'tilmaydi: har bir tahrir sahifa bergan `apply`/`draft.save`
// orqali mavjud API endpointlariga boradi (bot xabarnomalari server tomonda ishlaydi).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

const ROWNUM_WIDTH = 40;
const ACTIONS_WIDTH = 72;
const MIN_COL_WIDTH = 60;

function storageKey(id) {
  return `sheet.widths.${id}`;
}

function readStoredWidths(id) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(id))) || {};
  } catch {
    return {};
  }
}

function isEditable(col, row) {
  if (!col.apply) return false;
  if (typeof col.editable === 'function') return col.editable(row);
  return col.editable !== false;
}

function optionsOf(col, row) {
  return (typeof col.options === 'function' ? col.options(row) : col.options) || [];
}

// Bitta katak tahrirlagichi: matn/raqam/sana/datetime input yoki select (dropdown).
function CellEditor({ col, row, initial, onCommit, onCancel }) {
  const [val, setVal] = useState(initial ?? '');
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus();
    if (col.type !== 'select') ref.current?.select?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (col.type === 'select') {
    const opts = optionsOf(col, row);
    return (
      <select
        ref={ref}
        className="sheet-editor"
        value={val}
        onChange={(e) => onCommit(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        {/* Joriy qiymat ro'yxatda bo'lmasa ham ko'rinib tursin */}
        {val !== '' && !opts.some((o) => o.value === val) && <option value={val}>{val}</option>}
        {val === '' && <option value="">—</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  const inputType =
    col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : col.type === 'datetime' ? 'datetime-local' : 'text';
  return (
    <input
      ref={ref}
      className="sheet-editor"
      type={inputType}
      inputMode={col.type === 'number' ? 'decimal' : undefined}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onCommit(val)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
}

export default function SheetTable({
  id,
  columns,
  rows,
  rowKey = (row) => row._id || row.id,
  onChanged = null, // muvaffaqiyatli tahrirdan keyin (sahifa ro'yxatni qayta yuklaydi)
  draft = null, // { defaults?, canSave(values), save(values) } — "+" qator uchun
  draftSignal = 0, // tashqi tugma "+" qatorni ochishi uchun (masalan bosh sahifadan)
  onDelete = null, // (row) => void — mavjud 1990-kod modal oqimini ochadi
  onRowOpen = null, // (row) => void — o'qish-uchun katak/qator raqami bosilganda (tafsilot)
  actions = null, // (row) => JSX — qo'shimcha amal tugmalari
  rowDetail = null, // (row) => JSX|null — yoyiladigan tafsilot (ovoz va h.k.)
  highlightRowKey = null, // rowKey — bosh sahifadan kelib, o'sha qatorni yorug'lantirib ko'rsatadi
  emptyText = '',
  t = (k) => k,
}) {
  const [q, setQ] = useState('');
  const [widths, setWidths] = useState(() => readStoredWidths(id));
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const [editing, setEditing] = useState(null); // { rowId, colKey }
  const [busyKey, setBusyKey] = useState(null);
  const [draftValues, setDraftValues] = useState(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const highlightRef = useRef(null);

  // Tashqaridan (bosh sahifadan) yorug'lantirish so'ralgan qatorni ko'rinishga surib chiqaramiz.
  useEffect(() => {
    if (highlightRowKey && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightRowKey, rows]);

  // Tashqi signal (masalan, bosh sahifadagi "Yangi mijoz") — draft qatorni ochadi.
  useEffect(() => {
    if (draftSignal > 0 && draft && !draftValues) setDraftValues({ ...(draft.defaults || {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSignal]);

  const colWidth = (col) => Math.max(MIN_COL_WIDTH, widths[col.key] || col.width || 120);
  const totalWidth =
    ROWNUM_WIDTH + columns.reduce((sum, col) => sum + colWidth(col), 0) + (onDelete || actions || rowDetail ? ACTIONS_WIDTH : 0);
  const colSpan = columns.length + 1 + (onDelete || actions || rowDetail ? 1 : 0);

  // Qidiruv: BARCHA ustunlarning ko'rinadigan matni + xom qiymati bo'yicha.
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      columns.some((col) => {
        const shown = String(col.text?.(row) ?? '');
        const raw = String(col.get?.(row) ?? '');
        return shown.toLowerCase().includes(query) || raw.toLowerCase().includes(query);
      })
    );
  }, [rows, columns, q]);

  const startResize = (e, key, current) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    let next = current;
    const move = (ev) => {
      next = Math.max(MIN_COL_WIDTH, current + (ev.clientX - startX));
      setWidths((w) => ({ ...w, [key]: next }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        // widthsRef renderdan orqada qolishi mumkin — oxirgi qiymatni qo'lda qo'shamiz.
        localStorage.setItem(storageKey(id), JSON.stringify({ ...widthsRef.current, [key]: next }));
      } catch {
        /* localStorage bo'lmasligi mumkin */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const commitCell = async (row, col, value) => {
    const key = `${rowKey(row)}:${col.key}`;
    setEditing(null);
    const before = String(col.get?.(row) ?? '');
    if (String(value) === before) return; // o'zgarmadi
    setBusyKey(key);
    try {
      await col.apply(row, value);
      onChanged?.();
    } catch (err) {
      alert(err.message || t('common.error'));
    } finally {
      setBusyKey(null);
    }
  };

  // Draft (yangi qator) katagi: qiymat lokal yig'iladi; minimal identifikatsiya
  // to'planganda avtomatik saqlanadi (immediate-save falsafasi). Bo'sh maydonlar xato emas.
  const commitDraftCell = async (col, value) => {
    setEditing(null);
    const values = { ...(draftValues || {}), [col.key]: value };
    setDraftValues(values);
    if (!draft.canSave(values) || draftBusy) return;
    setDraftBusy(true);
    try {
      await draft.save(values);
      setDraftValues(null);
      onChanged?.();
    } catch (err) {
      alert(err.message || t('common.error'));
    } finally {
      setDraftBusy(false);
    }
  };

  const renderCellContent = (row, col) => {
    if (col.render) return col.render(row);
    return col.text?.(row) ?? '';
  };

  const hasActionsCol = !!(onDelete || actions || rowDetail);

  return (
    <div className="sheet">
      <div className="sheet-search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('sheet.search')}
          aria-label={t('sheet.search')}
        />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label={t('common.cancel')}>
            ✕
          </button>
        )}
      </div>
      <div className="sheet-wrap">
        <table className="sheet-table" style={{ width: totalWidth }}>
          <colgroup>
            <col style={{ width: ROWNUM_WIDTH }} />
            {columns.map((col) => (
              <col key={col.key} style={{ width: colWidth(col) }} />
            ))}
            {hasActionsCol && <col style={{ width: ACTIONS_WIDTH }} />}
          </colgroup>
          <thead>
            <tr>
              <th className="sheet-rownum" />
              {columns.map((col, i) => (
                <th key={col.key} className={i === 0 ? 'sheet-pin' : ''}>
                  <span className="sheet-th-text">{col.title}</span>
                  <span
                    className="sheet-resize"
                    onPointerDown={(e) => startResize(e, col.key, colWidth(col))}
                    aria-hidden="true"
                  />
                </th>
              ))}
              {hasActionsCol && <th className="sheet-actions" />}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !draftValues && (
              <tr>
                <td className="sheet-empty" colSpan={colSpan}>
                  {emptyText || t('common.noData')}
                </td>
              </tr>
            )}
            {filtered.map((row, index) => {
              const rid = rowKey(row);
              const detail = rowDetail ? rowDetail(row) : null;
              const expanded = expandedId === rid && detail;
              const highlighted = highlightRowKey != null && String(rid) === String(highlightRowKey);
              return (
                <Fragment key={rid}>
                  <tr
                    ref={highlighted ? highlightRef : null}
                    className={`${busyKey?.startsWith(`${rid}:`) ? 'sheet-busy' : ''}${highlighted ? ' sheet-row-highlight' : ''}`}
                  >
                    <td
                      className={`sheet-rownum${onRowOpen ? ' openable' : ''}`}
                      onClick={() => onRowOpen?.(row)}
                    >
                      {index + 1}
                    </td>
                    {columns.map((col, i) => {
                      const editable = isEditable(col, row);
                      const isEditing = editing && editing.rowId === rid && editing.colKey === col.key;
                      return (
                        <td
                          key={col.key}
                          className={`${i === 0 ? 'sheet-pin ' : ''}sheet-cell${editable ? ' editable' : ''}${!editable && onRowOpen ? ' openable' : ''}`}
                          onClick={() => {
                            if (editable && !isEditing) setEditing({ rowId: rid, colKey: col.key });
                            else if (!editable && onRowOpen) onRowOpen(row);
                          }}
                        >
                          {isEditing ? (
                            <CellEditor
                              col={col}
                              row={row}
                              initial={col.get?.(row) ?? ''}
                              onCommit={(v) => commitCell(row, col, v)}
                              onCancel={() => setEditing(null)}
                            />
                          ) : (
                            <div className="sheet-cellv">{renderCellContent(row, col)}</div>
                          )}
                        </td>
                      );
                    })}
                    {hasActionsCol && (
                      <td className="sheet-actions">
                        {detail && (
                          <button
                            type="button"
                            aria-label={t('services.detail')}
                            onClick={() => setExpandedId(expanded ? null : rid)}
                          >
                            {expanded ? '▴' : '▾'}
                          </button>
                        )}
                        {actions?.(row)}
                        {onDelete && (
                          <button type="button" aria-label={t('common.delete')} onClick={() => onDelete(row)}>
                            🗑
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {expanded && (
                    <tr>
                      <td className="sheet-detail" colSpan={colSpan}>
                        {detail}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {/* Yangi qator (draft): to'g'ridan-to'g'ri katakchalarga yoziladi, forma yo'q. */}
            {draft && draftValues && (
              <tr className={`sheet-draft ${draftBusy ? 'sheet-busy' : ''}`}>
                <td className="sheet-rownum">＋</td>
                {columns.map((col, i) => {
                  const editable = col.draft !== false;
                  const isEditing = editing && editing.rowId === '__draft' && editing.colKey === col.key;
                  return (
                    <td
                      key={col.key}
                      className={`${i === 0 ? 'sheet-pin ' : ''}sheet-cell${editable ? ' editable' : ''}`}
                      onClick={() => {
                        if (editable && !isEditing) setEditing({ rowId: '__draft', colKey: col.key });
                      }}
                    >
                      {isEditing ? (
                        <CellEditor
                          col={col}
                          row={draftValues}
                          initial={draftValues[col.key] ?? ''}
                          onCommit={(v) => commitDraftCell(col, v)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <div className="sheet-cellv">
                          {editable
                            ? draftDisplay(col, draftValues)
                            : col.draftText || ''}
                        </div>
                      )}
                    </td>
                  );
                })}
                {hasActionsCol && (
                  <td className="sheet-actions">
                    <button type="button" aria-label={t('common.cancel')} onClick={() => setDraftValues(null)}>
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            )}

            {draft && !draftValues && (
              <tr className="sheet-add">
                <td colSpan={colSpan}>
                  <button type="button" onClick={() => setDraftValues({ ...(draft.defaults || {}) })}>
                    ＋ {t('sheet.addRow')}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Draft katak ko'rinishi: select uchun tanlangan variant yorlig'i, boshqalar uchun xom qiymat.
function draftDisplay(col, values) {
  const raw = values[col.key];
  if (raw === undefined || raw === null || raw === '') return '';
  if (col.type === 'select') {
    const opts = optionsOf(col, values);
    return opts.find((o) => o.value === raw)?.label ?? String(raw);
  }
  return String(raw);
}
