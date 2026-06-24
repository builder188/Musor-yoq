// Pastdan chiqadigan modal oyna. Har bir modal navigation stackga kiradi.
import { useApp } from '../store/AppContext.jsx';
import { useNavigationView } from './useNavigationView.js';

export default function Modal({ title, onClose, children }) {
  const { t } = useApp();
  const goBack = useNavigationView(title, onClose);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <button className="modal-back" type="button" onClick={goBack} aria-label={t('common.back')}>
            <span aria-hidden="true">&larr;</span>
            <span className="modal-back-label">{t('common.back')}</span>
          </button>
          <div className="modal-title">{title}</div>
          <button className="modal-close" type="button" onClick={onClose} aria-label={t('common.close')}>
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
