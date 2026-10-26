import React from 'react';
import { useTranslation } from '../i18n';

const ClipExportWarningModal = ({ show, mismatchCount, clipSyncMode, onCancel, onExportAnyway, onAutoCorrect }) => {
  const { t } = useTranslation();
  if (!show) return null;

  return (
    <div className="shortcuts-modal-overlay" style={{ pointerEvents: 'auto' }}>
      <div className="shortcuts-modal-content" style={{ maxWidth: '440px' }}>
        <h3>{t('dialog.timingSyncMismatch')}</h3>
        <div className="settings-section" style={{ border: 'none' }}>
          <p style={{ margin: '0 0 12px 0', color: '#ccc', fontSize: '13px', lineHeight: 1.5 }}>
            {t('dialog.timingSyncMismatchBody', { count: mismatchCount, mode: clipSyncMode })}
          </p>
          <p style={{ margin: '0 0 15px 0', color: '#aaa', fontSize: '13px', lineHeight: 1.5 }}>
            {t('dialog.timingSyncMismatchHelp')}
          </p>
          <div className="button-row" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button onClick={onCancel}>{t('common.cancel')}</button>
            <button onClick={onExportAnyway}>{t('dialog.exportAnyway')}</button>
            <button
              onClick={onAutoCorrect}
              style={{ backgroundColor: 'var(--theme-color)', color: 'black' }}
            >
              {t('dialog.autoCorrectTiming')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClipExportWarningModal;