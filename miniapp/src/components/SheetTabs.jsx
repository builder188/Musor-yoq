// Ko'p-jadval (sheets) tab paneli — Google Sheets'dagi pastki tab'lar kabi.
// Faol jadval birinchi; arxivlanganlar 🗄 bilan (ular ham TO'LIQ tahrirlanadi).
// "+" — istalgancha yangi jadval (foydalanuvchi nomlaydi); ✏️ — tanlangan jadval nomi.
// MUHIM: tab faqat KO'RINISHNI filtrlaydi — qidiruv va hisobotlar barcha jadvallarni qamraydi.
import { useState } from 'react';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

export default function SheetTabs({ scope, sheets, selected, onSelect, onChanged, t }) {
  const [naming, setNaming] = useState(null); // { mode: 'add' | 'rename', value }
  const [busy, setBusy] = useState(false);
  const selectedSheet = sheets.find((s) => s._id === selected);

  const submitName = async () => {
    const name = String(naming?.value || '').trim();
    setBusy(true);
    try {
      if (naming.mode === 'add') {
        const created = await api.post('/sheets', { scope, name });
        onChanged?.();
        onSelect?.(created._id);
      } else if (selectedSheet) {
        await api.patch(`/sheets/${selectedSheet._id}`, { name });
        onChanged?.();
      }
      setNaming(null);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-tabs" role="tablist">
      {sheets.map((sheet) => (
        <button
          key={sheet._id}
          type="button"
          role="tab"
          aria-selected={selected === sheet._id}
          className={`sheet-tab ${selected === sheet._id ? 'active' : ''} ${sheet.status === 'archived' ? 'archived' : ''}`}
          title={sheet.status === 'archived' ? t('sheets.archivedHint') : t('sheets.activeHint')}
          onClick={() => onSelect?.(sheet._id)}
        >
          {sheet.status === 'archived' ? '🗄 ' : ''}
          {sheet.name}
          <span className="sheet-tab-count">{sheet.rowCount}</span>
        </button>
      ))}
      <button
        type="button"
        className="sheet-tab sheet-tab-action"
        title={t('sheets.add')}
        onClick={() => setNaming({ mode: 'add', value: '' })}
      >
        ＋
      </button>
      {selectedSheet && (
        <button
          type="button"
          className="sheet-tab sheet-tab-action"
          title={t('sheets.rename')}
          onClick={() => setNaming({ mode: 'rename', value: selectedSheet.name })}
        >
          ✏️
        </button>
      )}

      {naming && (
        <Modal
          title={naming.mode === 'add' ? t('sheets.add') : t('sheets.rename')}
          onClose={() => setNaming(null)}
        >
          {naming.mode === 'add' && <div className="sub mb-8">{t('sheets.addHint')}</div>}
          <label className="label">{t('sheets.name')}</label>
          <input
            className="input"
            value={naming.value}
            placeholder={t('sheets.namePlaceholder')}
            onChange={(e) => setNaming((n) => ({ ...n, value: e.target.value }))}
            autoFocus
          />
          <button
            className="btn btn-primary btn-block mt-12"
            disabled={busy || (naming.mode === 'rename' && !String(naming.value).trim())}
            onClick={submitName}
          >
            {busy ? '...' : t('common.save')}
          </button>
        </Modal>
      )}
    </div>
  );
}

// Qator qaysi tab'da ko'rinadi: sheetId bo'lsa o'sha jadval; bo'lmasa (legacy/maxsus
// qatorlar) — FAOL jadval. Hech narsa yashirilmaydi: har qator aynan bitta tab'da chiqadi.
export function rowMatchesSheet(rowSheetId, selectedId, activeId) {
  const target = rowSheetId ? String(rowSheetId) : activeId;
  return target === selectedId;
}

export function activeSheetIdOf(sheets = []) {
  return sheets.find((s) => s.status === 'active')?._id || null;
}
