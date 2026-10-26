import React from 'react';
import { useTranslation } from '../i18n';

/**
 * The auto-update window.
 *
 * The updater lives in the main process; it reports what it is doing through
 * the 'update-status' channel and this window shows it. An update is only
 * ever DOWNLOADED in the background - installing it is the user's choice, and
 * the two install options are deliberately different: restart now, or let it
 * be applied the next time the app starts (which is the one for a show that
 * is about to begin).
 */
const PHASE_KEYS = {
    checking: { title: 'update.checking', body: 'update.checkingBody' },
    available: { title: 'update.available', body: 'update.availableBody' },
    downloading: { title: 'update.downloading', body: 'update.downloadingBody' },
    downloaded: { title: 'update.downloaded', body: 'update.downloadedBody' },
    'up-to-date': { title: 'update.upToDate', body: 'update.upToDateBody' },
    deferred: { title: 'update.deferred', body: 'update.deferredBody' },
};

const UpdateWindow = ({ state, onClose, onInstallNow, onInstallNextLaunch, onSkip, autoCheck, onToggleAutoCheck }) => {
    const { t } = useTranslation();
    if (!state) return null;

    const phase = state.phase;
    if (phase === 'idle') return null;

    let title = t('update.title');
    let body = '';
    let showProgress = false;
    let showInstall = false;

    if (phase === 'error') {
        title = t('update.error');
        body = state.error || t('update.errorBody');
    } else {
        const keys = PHASE_KEYS[phase] || PHASE_KEYS.checking;
        const textTitle = t(keys.title);
        title = state.version && phase !== 'upToDate'
            ? `${textTitle} - ${state.version}`
            : textTitle;
        if (phase === 'upToDate' && state.version) title = `${textTitle} (${state.version})`;
        body = t(keys.body);
        showProgress = phase === 'downloading';
        showInstall = phase === 'downloaded';
    }

    const canSkip = phase === 'downloaded' && !!state.version;

    return (
        <div className="modal-overlay">
            <div className="modal-content update-window" style={{ minWidth: '420px', maxWidth: '520px' }}>
                <div className="modal-header">
                    <h3 style={{ margin: 0, fontSize: '15px' }}>{title}</h3>
                    <button className="close-btn" onClick={onClose} title={t('update.close')}>×</button>
                </div>

                <div className="modal-body update-body">
                    <p style={{ margin: '0 0 12px 0', color: '#ccc', fontSize: '13px', lineHeight: 1.5 }}>
                        {body}
                    </p>

                    {showProgress ? (
                        <div className="update-progress">
                            <div className="update-progress-track">
                                <div className="update-progress-fill" style={{ width: `${Math.max(0, Math.min(100, state.percent || 0))}%` }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                <span>{state.percent || 0}%</span>
                                <span>{formatBytes(state.transferred)} {t('update.of')} {formatBytes(state.total)}</span>
                            </div>
                        </div>
                    ) : null}

                    <label className="update-check">
                        <input
                            type="checkbox"
                            checked={!!autoCheck}
                            onChange={(e) => onToggleAutoCheck && onToggleAutoCheck(e.target.checked)}
                        />
                        <span>{t('update.checkAutomatically')}</span>
                    </label>
                </div>

                <div className="update-footer">
                    {canSkip ? (
                            <button className="update-button" onClick={() => onSkip(state.version)}>
                                {t('update.skipVersion')}
                            </button>
                        ) : null}
                        <button className="update-button" onClick={onClose}>{t('update.close')}</button>
                        {showInstall ? (
                            <>
                                <button className="update-button" onClick={onInstallNextLaunch}>
                                    {t('update.installNextLaunch')}
                                </button>
                                <button className="update-button primary" onClick={onInstallNow}>
                                    {t('update.restartAndInstall')}
                                </button>
                        </>
                    ) : null}
                </div>
            </div>

            <style>{`
                .modal-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
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
                    display: flex;
                    flex-direction: column;
                }
                .modal-header {
                    background: #333;
                    padding: 10px 15px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .modal-body { padding: 18px 20px; }
                .close-btn {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 24px;
                    cursor: pointer;
                    line-height: 1;
                }
                .close-btn:hover { color: white; }
                .update-progress-track {
                    height: 6px;
                    border-radius: 3px;
                    background: #111;
                    overflow: hidden;
                }
                .update-progress-fill {
                    height: 100%;
                    background: var(--theme-color, #ff8c00);
                    transition: width 0.2s ease-out;
                }
                .update-check {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 12px;
                    color: #9aa0a6;
                    margin-top: 14px;
                    cursor: pointer;
                }
                .update-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    padding: 12px 20px;
                    background: #2a2a2a;
                    border-top: 1px solid #3a3a3a;
                    flex-wrap: wrap;
                }
                .update-button {
                    background: #3a3a3a;
                    border: 1px solid #555;
                    color: #e8eaed;
                    border-radius: 4px;
                    padding: 7px 14px;
                    font-size: 12px;
                    cursor: pointer;
                    font-family: inherit;
                }
                .update-button:hover { background: #454545; }
                .update-button.primary {
                    background: var(--theme-color, #ff8c00);
                    border-color: var(--theme-color, #ff8c00);
                    color: #1a1a1a;
                    font-weight: 600;
                }
            `}</style>
        </div>
    );
};

function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default UpdateWindow;
