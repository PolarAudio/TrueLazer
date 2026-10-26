import React from 'react';
import { useTranslation } from '../i18n';

const GeneralSettingsWindow = ({ show, onClose, masterSpeed }) => {
  const { t, locale, setLocale, locales } = useTranslation();
  if (!show) return null;

  return (
    <>
      <div className="modal-overlay">
        <div className="modal-content general-settings-window" style={{ minWidth: '420px' }}>
          <div className="modal-header">
            <h3>{t('settings.general')}</h3>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <div className="general-settings-section">
              <h4 style={{ marginBottom: '10px', fontSize: '13px' }}>{t('settings.language')}</h4>
              <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label className="param-label" style={{ fontSize: '11px' }}>{t('settings.language')}</label>
                <select
                  className="param-select"
                  value={locale}
                  style={{ width: '180px', fontSize: '11px' }}
                  onChange={(event) => setLocale(event.target.value)}
                >
                  {locales.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.label}</option>
                  ))}
                </select>
              </div>
              <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
                {t('settings.languageHelp')}
              </p>
            </div>

            <div className="general-settings-section" style={{ marginTop: '16px' }}>
              <h4 style={{ marginBottom: '10px', fontSize: '13px' }}>{t('settings.ildaParsing')}</h4>
              <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label className="param-label" style={{ fontSize: '11px' }}>{t('settings.parseMode')}</label>
                <select
                  className="param-select"
                  value="legacy"
                  style={{ width: '180px', fontSize: '11px' }}
                  disabled
                >
                  <option value="legacy">{t('settings.parseModeLegacy')}</option>
                </select>
              </div>
              <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
                {t('settings.parseModeHelp')}
              </p>
            </div>

            {masterSpeed && (
            <div className="general-settings-section" style={{ marginTop: '16px' }}>
              <h4 style={{ marginBottom: '10px', fontSize: '13px' }}>{t('settings.masterSpeed')}</h4>
              <div
                className="param-editor"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}
              >
                <label className="param-label" style={{ fontSize: '11px' }}>{t('settings.targetFps')}</label>
                {masterSpeed}
              </div>
              <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
                {t('settings.targetFpsHelp')}
              </p>
            </div>
            )}
          </div>
        </div>
      </div>
      <style>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 10000;
        }
        .modal-content {
          background: #222;
          color: white;
          border-radius: 8px;
          border: 1px solid #444;
          padding: 0;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .modal-header {
          background: #333;
          padding: 10px 15px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .modal-body {
          padding: 20px;
        }
        .close-btn {
          background: none;
          border: none;
          color: white;
          font-size: 20px;
          cursor: pointer;
        }
        .close-btn:hover {
          color: #ff6b6b;
        }
      `}</style>
    </>
  );
};

export default GeneralSettingsWindow;