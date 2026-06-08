// O'chirishni tasdiqlash modali — 1990 kodini talab qiladi.
import { useState } from 'react';
import Modal from './Modal.jsx';
import { useApp } from '../store/AppContext.jsx';

export default function ConfirmDeleteModal({ title, message, onConfirm, onClose }) {
  const { t } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const handleConfirm = async () => {
    setBusy(true);
    setErr('');
    try {
      await onConfirm(code);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title || t('common.delete')} onClose={onClose}>
      {message && <p className="muted mb-8">{message}</p>}
      <label className="label">{t('settings.confirmCode')}</label>
      <input
        className="input"
        type="number"
        inputMode="numeric"
        placeholder={t('settings.enterCode')}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus
      />
      {err && <div className="error-banner">{err}</div>}
      <div className="btn-row mt-12">
        <button className="btn btn-block" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-danger btn-block" onClick={handleConfirm} disabled={busy || !code}>
          {busy ? '...' : t('common.delete')}
        </button>
      </div>
    </Modal>
  );
}
