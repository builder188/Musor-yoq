// Xizmat tafsiloti modali (Home va Services sahifalarida qayta ishlatiladi).
import Modal from './Modal.jsx';
import LocationDisplay from './LocationDisplay.jsx';
import { useApp } from '../store/AppContext.jsx';
import { formatMoney, formatDateTime, formatPhone } from '../utils/format.js';

export default function ServiceDetailModal({
  service,
  onClose,
  onComplete,
  onCancel,
  onEdit,
  onDelete,
  onDeleteReminder,
}) {
  const { t } = useApp();
  if (!service) return null;

  const statusClass =
    service.status === 'bajarildi'
      ? 'badge-done'
      : service.status === 'bekor_qilindi'
      ? 'badge-cancelled'
      : 'badge-pending';

  return (
    <Modal title={service.clientName} onClose={onClose}>
      <div className="mb-8">
        <span className={`badge ${statusClass}`}>{t(`status.${service.status}`)}</span>
      </div>
      <div className="card">
        <Row label={t('common.phone')} value={formatPhone(service.clientPhone)} />
        <Row label={t('common.location')} value={<LocationDisplay location={service.location} />} />
        <Row label={t('common.date')} value={formatDateTime(service.serviceDateTime)} />
        <Row label={t('common.price')} value={formatMoney(service.price)} />
        <Row label={t('common.paymentMethod')} value={t(`payment.${service.paymentMethod}`)} />
        {service.notes ? <Row label={t('common.notes')} value={service.notes} /> : null}
        {service.clientDeletionNote ? <Row label={t('common.notes')} value={service.clientDeletionNote} /> : null}
        {service.reminders?.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="label">{t('settings.reminders')}</div>
            {service.reminders.map((reminder, index) => (
              <div key={`${reminder.scheduledAt}-${index}`} className="card-row" style={{ padding: '4px 0' }}>
                <span className="muted">{formatDateTime(reminder.scheduledAt)}</span>
                {onDeleteReminder && !reminder.sent && (
                  <button className="btn btn-sm" onClick={() => onDeleteReminder(service, index)}>
                    {t('common.delete')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {(onComplete || onCancel || onEdit || onDelete) && (
        <div className="mt-12">
          {onComplete && service.status === 'kutilmoqda' && (
            <button className="btn btn-primary btn-block mb-8" onClick={() => onComplete(service)}>
              {t('services.markDone')}
            </button>
          )}
          <div className="btn-row mb-8">
            {onEdit && (
              <button className="btn btn-block" onClick={() => onEdit(service)}>
                {t('common.edit')}
              </button>
            )}
            {onCancel && service.status === 'kutilmoqda' && (
              <button className="btn btn-block" onClick={() => onCancel(service)}>
                {t('services.cancelled')}
              </button>
            )}
          </div>
          {onDelete && (
            <button className="btn btn-danger btn-block" onClick={() => onDelete(service)}>
              {t('common.delete')}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value }) {
  return (
    <div className="card-row" style={{ padding: '4px 0' }}>
      <span className="muted">{label}</span>
      <span style={{ textAlign: 'right', fontWeight: 500 }}>{value}</span>
    </div>
  );
}
