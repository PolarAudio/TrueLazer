import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';

const RenameModal = ({ show, title, initialValue, onSave, onClose }) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue || '');

  useEffect(() => {
    if (show) {
      setValue(initialValue || '');
    }
  }, [show, initialValue]);

  if (!show) return null;

  const handleSave = () => {
    onSave(value);
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="shortcuts-modal-overlay" style={{ pointerEvents: 'auto' }}>
      <div className="shortcuts-modal-content" style={{ maxWidth: '400px' }}>
        <h3>{title || t('common.rename')}</h3>
        <div className="settings-section" style={{ border: 'none' }}>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            style={{
              width: '100%',
              padding: '8px',
              backgroundColor: '#1a1a1a',
              color: 'white',
              border: '1px solid var(--theme-color)',
              borderRadius: '4px',
              marginBottom: '15px'
            }}
          />
          <div className="button-row" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={onClose}>{t('common.cancel')}</button>
            <button
              onClick={handleSave}
              style={{ backgroundColor: 'var(--theme-color)', color: 'black' }}
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RenameModal;
