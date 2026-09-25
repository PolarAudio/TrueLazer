import React from 'react';

const LinkSyncSettingsWindow = ({ show, onClose, onUpdateSettings, bpmSource = 'prolink', onBpmSourceChange }) => {
  if (!show) return null;

  // Default settings if none stored yet
  const defaultSettings = {
    syncProtocol: 'none',
    isSyncing: false,
  };
  const [settings, setSettings] = React.useState(() => {
    try {
      const stored = window.electronAPI && window.electronAPI.getLinkSyncSettings
        ? window.electronAPI.getLinkSyncSettings()
        : null;
      return stored || defaultSettings;
    } catch {
      return defaultSettings;
    }
  });
  const [prolinkSettings, setProlinkSettings] = React.useState({ enabled: false, deviceId: '', selectedDevice: '', bpmSource: 'prolink' });
  const [prolinkStatus, setProlinkStatus] = React.useState({ started: false, activeDeviceId: '', deviceCount: 0, networkConnected: false });
  const [stagelinqSettings, setStagelinqSettings] = React.useState({ enabled: false, deviceId: '', selectedDevice: '', bpmSource: 'stagelinq' });
  const [stagelinqStatus, setStagelinqStatus] = React.useState({ started: false, activeDeckId: '', deckCount: 0, networkConnected: false });

  React.useEffect(() => {
    if (window.electronAPI && window.electronAPI.getProlinkSettings) {
      window.electronAPI.getProlinkSettings().then(setProlinkSettings).catch(() => {});
    }
    if (window.electronAPI && window.electronAPI.getProlinkStatus) {
      window.electronAPI.getProlinkStatus().then(setProlinkStatus).catch(() => {});
    }
    if (window.electronAPI && window.electronAPI.getStagelinqSettings) {
      window.electronAPI.getStagelinqSettings().then(setStagelinqSettings).catch(() => {});
    }
    if (window.electronAPI && window.electronAPI.getStagelinqStatus) {
      window.electronAPI.getStagelinqStatus().then(setStagelinqStatus).catch(() => {});
    }
    let offProlink = null;
    if (window.electronAPI && window.electronAPI.onProlinkManagerStatus) {
      offProlink = window.electronAPI.onProlinkManagerStatus((st) => {
        if (st) setProlinkStatus(st);
      });
    }
    let offStagelinq = null;
    if (window.electronAPI && window.electronAPI.onStagelinqManagerStatus) {
      offStagelinq = window.electronAPI.onStagelinqManagerStatus((st) => {
        if (st) setStagelinqStatus(st);
      });
    }
    return () => { if (offProlink) offProlink(); if (offStagelinq) offStagelinq(); };
  }, []);

  const handleUpdate = (newSettings) => {
    setSettings(newSettings);
    onUpdateSettings?.(newSettings);
  };

  const handleProlinkToggle = async () => {
    const willStart = !prolinkStatus.started;
    const next = { ...prolinkSettings, enabled: willStart };
    setProlinkSettings(next);
    if (window.electronAPI && window.electronAPI.setProlinkSettings) {
      try { await window.electronAPI.setProlinkSettings(next); } catch {}
    }
    if (willStart) {
      if (window.electronAPI && window.electronAPI.startProlinkStateListener) {
        window.electronAPI.startProlinkStateListener();
      }
    } else {
      if (window.electronAPI && window.electronAPI.stopProlinkStateListener) {
        window.electronAPI.stopProlinkStateListener();
      }
    }
  };

  const handleProlinkSettingChange = async (patch) => {
    const next = { ...prolinkSettings, ...patch };
    setProlinkSettings(next);
    if (window.electronAPI && window.electronAPI.setProlinkSettings) {
      try { await window.electronAPI.setProlinkSettings(next); } catch {}
    }
  };

  const handleStagelinqToggle = async () => {
    const willStart = !stagelinqStatus.started;
    const next = { ...stagelinqSettings, enabled: willStart };
    setStagelinqSettings(next);
    if (window.electronAPI && window.electronAPI.setStagelinqSettings) {
      try { await window.electronAPI.setStagelinqSettings(next); } catch {}
    }
    if (willStart) {
      if (window.electronAPI && window.electronAPI.startStagelinqListener) {
        window.electronAPI.startStagelinqListener();
      }
    } else {
      if (window.electronAPI && window.electronAPI.stopStagelinqListener) {
        window.electronAPI.stopStagelinqListener();
      }
    }
  };

  const handleStagelinqSettingChange = async (patch) => {
    const next = { ...stagelinqSettings, ...patch };
    setStagelinqSettings(next);
    if (window.electronAPI && window.electronAPI.setStagelinqSettings) {
      try { await window.electronAPI.setStagelinqSettings(next); } catch {}
    }
  };

  const protocols = [
    { value: 'none', label: 'None' },
    { value: 'prolink', label: 'ProDJ Link' },
    { value: 'stagelinq', label: 'StageLinq (Denon)' },
    { value: 'artnet', label: 'Art-Net' },
    { value: 'midi', label: 'MIDI Clock' },
    { value: 'osc', label: 'OSC' },
  ];

  return (
    <>
      <div className="modal-overlay">
        <div className="modal-content general-settings-window" style={{ minWidth: '420px' }}>
          <div className="modal-header">
            <h3>Link/Sync Settings</h3>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <div className="general-settings-section">
              <h4 style={{ marginBottom: '10px', fontSize: '13px' }}>Sync Protocol</h4>
              <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label className="param-label" style={{ fontSize: '11px' }}>Protocol</label>
                <select
                  className="param-select"
                  value={settings.syncProtocol}
                  style={{ width: '180px', fontSize: '11px' }}
                  onChange={(e) => handleUpdate({ ...settings, syncProtocol: e.target.value })}
                >
                  {protocols.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
                Select the synchronization protocol for timeline playback position and transport speed.
              </p>
            </div>

            {settings.syncProtocol !== 'none' && (
              <div className="general-settings-section" style={{ marginTop: '12px' }}>
                <h4 style={{ marginBottom: '10px', fontSize: '13px' }}>Sync Mode</h4>
                <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label className="param-label" style={{ fontSize: '11px' }}>Mode</label>
                  <select
                    className="param-select"
                    style={{ width: '180px', fontSize: '11px' }}
                  >
                    <option value='master'>Master (this system drives)</option>
                    <option value='slave'>Slave (this system follows)</option>
                  </select>
                </div>
                <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
                  Master: this system generates sync signals; Slave: this system follows an external source.
                </p>
              </div>
            )}

            {settings.syncProtocol !== 'none' && (
              <div className="general-settings-section" style={{ marginTop: '12px' }}>
                <h4 style={{ marginBottom: '10px', fontSize: '13px' }}>Sync Status</h4>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                  <span className="param-label" style={{ fontSize: '11px', marginRight: '8px' }}>
                    {' '}{settings.isSyncing ? 'Syncing...' : 'Not syncing'}
                  </span>
                  <button
                    className="small-btn"
                    style={{ padding: '4px 8px', fontSize: '11px' }}
                    onClick={() => handleUpdate({ ...settings, isSyncing: !settings.isSyncing })}
                  >
                    {settings.isSyncing ? 'Stop' : 'Start'}
                  </button>
                </div>
                <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
                  Toggle synchronization state for the selected protocol.
                </p>
              </div>
            )}

            {settings.syncProtocol === 'prolink' && (
              <div className="general-settings-section" style={{ marginTop: '12px' }}>
                <h4 style={{ marginBottom: '10px', fontSize: '13px' }}>PRO DJ LINK Settings</h4>
                <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label className="param-label" style={{ fontSize: '11px' }}>Connection</label>
                  <span style={{ fontSize: '11px', color: prolinkStatus.started ? '#6f6' : '#f66' }}>
                    {prolinkStatus.started ? '● Connected' : '○ Disconnected'}
                    {prolinkStatus.deviceCount > 0 ? ` (${prolinkStatus.deviceCount} device${prolinkStatus.deviceCount !== 1 ? 's' : ''})` : ''}
                  </span>
                </div>
                <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label className="param-label" style={{ fontSize: '11px' }}>Enabled</label>
                  <button
                    className="small-btn"
                    style={{ padding: '4px 8px', fontSize: '11px', background: prolinkStatus.started ? '#2a7a2a' : '#555' }}
                    onClick={() => handleProlinkToggle()}
                  >
                    {prolinkStatus.started ? 'Stop Listener' : 'Start Listener'}
                  </button>
                </div>
                <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label className="param-label" style={{ fontSize: '11px' }}>Selected Device</label>
                  <input
                    className="param-input"
                    type="text"
                    value={prolinkSettings.selectedDevice}
                    placeholder="Auto (master/playing)"
                    style={{ width: '180px', fontSize: '11px' }}
                    onChange={(e) => handleProlinkSettingChange({ selectedDevice: e.target.value })}
                  />
                </div>
                <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label className="param-label" style={{ fontSize: '11px' }}>Deck BPM Source</label>
                  <select
                    className="param-select"
                    value={bpmSource}
                    style={{ width: '180px', fontSize: '11px' }}
                    onChange={(e) => {
                      onBpmSourceChange?.(e.target.value);
                      handleProlinkSettingChange({ bpmSource: e.target.value });
                    }}
                  >
                    <option value="prolink">ProDJ Link (CDJ beat grid)</option>
                    <option value="tcnet">TCNet L1 beat grid</option>
                    <option value="tap">Tap tempo / manual</option>
                  </select>
                </div>
                <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
                  Connect to Pioneer CDJs via prolink-connect. BPM and timecode are derived from the CDJ beat grid.
                </p>
              </div>
            )}

            {settings.syncProtocol === 'stagelinq' && (
              <div className="general-settings-section" style={{ marginTop: '12px' }}>
                <h4 style={{ marginBottom: '10px', fontSize: '13px' }}>STAGELINQ (Denon DJ) Settings</h4>
                <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label className="param-label" style={{ fontSize: '11px' }}>Connection</label>
                  <span style={{ fontSize: '11px', color: stagelinqStatus.started ? '#6f6' : '#f66' }}>
                    {stagelinqStatus.started ? '● Listener' : '○ Idle'}
                    {stagelinqStatus.deckCount > 0 ? ` (${stagelinqStatus.deckCount} deck${stagelinqStatus.deckCount !== 1 ? 's' : ''})` : ''}
                  </span>
                </div>
                <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label className="param-label" style={{ fontSize: '11px' }}>Enabled</label>
                  <button
                    className="small-btn"
                    style={{ padding: '4px 8px', fontSize: '11px', background: stagelinqStatus.started ? '#2a7a2a' : '#555' }}
                    onClick={() => handleStagelinqToggle()}
                  >
                    {stagelinqStatus.started ? 'Stop Listener' : 'Start Listener'}
                  </button>
                </div>
                <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label className="param-label" style={{ fontSize: '11px' }}>Selected Device</label>
                  <input
                    className="param-input"
                    type="text"
                    value={stagelinqSettings.selectedDevice}
                    placeholder="Auto (master/playing)"
                    style={{ width: '180px', fontSize: '11px' }}
                    onChange={(e) => handleStagelinqSettingChange({ selectedDevice: e.target.value })}
                  />
                </div>
                <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label className="param-label" style={{ fontSize: '11px' }}>Deck BPM Source</label>
                  <select
                    className="param-select"
                    value={bpmSource}
                    style={{ width: '180px', fontSize: '11px' }}
                    onChange={(e) => {
                      onBpmSourceChange?.(e.target.value);
                      handleStagelinqSettingChange({ bpmSource: e.target.value });
                    }}
                  >
                    <option value="stagelinq">StageLinq (Denon deck BPM)</option>
                    <option value="tcnet">TCNet L1 beat grid</option>
                    <option value="tap">Tap tempo / manual</option>
                  </select>
                </div>
                <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
                  Connect to Denon players (SC5000/SC6000, Prime 4/2/Go, LC6000) over StageLinq. Timecode is derived from the deck's absolute sample position; BPM from the deck's current tempo.
                </p>
              </div>
            )}

            <div className="general-settings-section" style={{ marginTop: '16px' }}>
              <button
                className="small-btn"
                onClick={() => {
                  const updated = { ...settings, syncProtocol: 'none', isSyncing: false };
                  handleUpdate(updated);
                }}
              >
                Reset to Default
              </button>
              <button
                className="small-btn"
                style={{ marginLeft: '8px' }}
                onClick={onClose}
              >
                Close
              </button>
            </div>
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
        .param-editor {
          align-items: center;
        }
        .param-label {
          marginRight: 8px;
        }
        .small-btn {
          padding: 6px 12px;
          background: #444;
          border: none;
          color: white;
          border-radius: 4px;
          cursor: pointer;
          fontSize: 12px;
        }
        .small-btn:hover {
          background: #555;
        }
        small-btn:focus {
          outline: 2px solid #666;
        }
        .param-input {
          background: #333;
          border: 1px solid #555;
          color: white;
          border-radius: 4px;
          padding: 3px 6px;
        }
      `}</style>
    </>
  );
};

export default LinkSyncSettingsWindow;