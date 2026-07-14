// Kichik summa/matn so'rash modali (window.prompt Telegram WebView'da ishonchsiz).
// Jadvaldagi "Qisman to'landi" kabi bitta qiymat talab qiladigan amallar uchun.
import { useState } from 'react';
import Modal from './Modal.jsx';
import { useApp } from '../store/AppContext.jsx';

export default function AmountPromptModal({ title, label, type = 'number', initial = '', onSubmit, onClose }) {
  const { t } = useApp();
  const [value, setValue] = useState(String(initial ?? ''));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(value);
      onClose();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <label className="label">{label}</label>
      <input
        className="input"
        type={type}
        inputMode={type === 'number' ? 'numeric' : undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        autoFocus
      />
      <div className="btn-row">
        <button className="btn btn-block" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary btn-block" onClick={submit} disabled={busy || !value}>
          {busy ? '...' : t('common.save')}
        </button>
      </div>
    </Modal>
  );
}
