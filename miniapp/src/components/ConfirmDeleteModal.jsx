import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { useApp } from '../store/AppContext.jsx';
import { haptic } from '../telegram.js';

export default function ConfirmDeleteModal({ title, message, description, onConfirm, onClose, onCancel, onExport }) {
  const { t } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [backupStep, setBackupStep] = useState(Boolean(onExport));
  const inputRef = useRef(null);

  const close = onClose || onCancel;
  const desc = description || message;

  useEffect(() => {
    if (!backupStep) inputRef.current?.focus();
  }, [backupStep]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await onExport();
      setBackupStep(false);
    } finally {
      setExporting(false);
    }
  };

  const handleConfirm = async () => {
    if (code.length !== 4 || busy) return;
    setBusy(true);
    setWrong(false);
    try {
      await onConfirm(code);
      haptic('medium');
      close?.();
    } catch {
      haptic('heavy');
      setWrong(true);
      setShake(true);
      setCode('');
      setTimeout(() => setShake(false), 400);
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
    setCode(digits);
    if (wrong) setWrong(false);
  };

  return (
    <Modal title={title || t('confirm.title')} onClose={close}>
      <div className="confirm-warn">
        <div className="warn-icon">!</div>
        {desc && <div className="title">{desc}</div>}
        <div className="warn-text">{t('confirm.warning')}</div>
      </div>

      {backupStep ? (
        <>
          <div className="backup-question">{t('confirm.backupQuestion')}</div>
          <div className="btn-row mt-12">
            <button className="btn btn-primary btn-block" onClick={handleExport} disabled={exporting}>
              {exporting ? '...' : t('confirm.backupYes')}
            </button>
            <button className="btn btn-block" onClick={() => setBackupStep(false)} disabled={exporting}>
              {t('confirm.backupNo')}
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="label center">{t('confirm.enterPin')}</label>
          <input
            ref={inputRef}
            className={`pin-input ${shake ? 'error' : ''}`}
            type="number"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0000"
            value={code}
            onChange={onChange}
            onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
          />
          {wrong && <p className="pin-error">{t('confirm.wrongCode')}</p>}

          <div className="btn-row mt-12">
            <button className="btn btn-block" onClick={close} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-danger btn-block"
              onClick={handleConfirm}
              disabled={busy || code.length !== 4}
            >
              {busy ? '...' : t('common.delete')}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
