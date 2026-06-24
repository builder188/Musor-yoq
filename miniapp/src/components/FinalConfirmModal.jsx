import Modal from './Modal.jsx';
import { useApp } from '../store/AppContext.jsx';

export default function FinalConfirmModal({ title, message, rows = [], busy = false, onConfirm, onClose }) {
  const { t } = useApp();

  return (
    <Modal title={title || t('common.finalConfirm')} onClose={onClose}>
      <div className="final-confirm-intro">{message || t('common.checkBeforeSave')}</div>
      <div className="final-confirm-list">
        {rows.map((row) => (
          <div className="final-confirm-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value || t('common.notFilled')}</strong>
          </div>
        ))}
      </div>
      <div className="btn-row final-confirm-actions mt-12">
        <button className="btn btn-block" onClick={onClose} disabled={busy}>
          {t('common.backToEdit')}
        </button>
        <button className="btn btn-primary btn-block" onClick={onConfirm} disabled={busy}>
          {busy ? '...' : t('common.saveConfirm')}
        </button>
      </div>
    </Modal>
  );
}
