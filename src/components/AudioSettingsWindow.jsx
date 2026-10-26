import React, { useState } from 'react';
import { useAudio } from '../contexts/AudioContext.jsx';
import { useTranslation } from '../i18n';
import { useAudioOutput } from '../hooks/useAudioOutput';
import RadialKnob from './RadialKnob';

const AudioSettingsWindow = ({ show, onClose, initialTab = 'output' }) => {
    const { t } = useTranslation();
    const audioContext = useAudio();
    const { 
        fftSettings, setFftSettings, 
        inputDevices, selectedInputDeviceId, setSelectedInputDeviceId 
    } = audioContext || {};
    const { devices, selectedDeviceId, setSelectedDeviceId, globalVolume, setVolume } = useAudioOutput();
    const [activeTab, setActiveTab] = useState(initialTab);

    // Update active tab when opening if initialTab changes
    React.useEffect(() => {
        if (show) {
            setActiveTab(initialTab);
        }
    }, [show, initialTab]);

    if (!show) return null;

    if (!fftSettings) {
        return (
            <div className="modal-overlay">
                <div className="modal-content" style={{ padding: '20px', color: 'red', border: '1px solid red', background: '#222' }}>
                    <h3>{t('common.error')}</h3>
                    <p>{t('audio.contextUnavailable')}</p>
                    <p>{t('audio.restartOrReport')}</p>
                    <button onClick={onClose} style={{ marginTop: '10px', padding: '5px 10px' }}>{t('common.close')}</button>
                </div>
                <style>{`
                    .modal-overlay {
                        position: fixed;
                        top: 0; left: 0; right: 0; bottom: 0;
                        background: rgba(0, 0, 0, 0.7);
                        display: flex; justify-content: center; align-items: center;
                        z-index: 10000;
                    }
                `}</style>
            </div>
        );
    }

    const handleFftRangeChange = (type, index, value) => {
        const newSettings = { ...fftSettings };
        const rangeKey = `${type}Range`;
        newSettings[rangeKey][index] = parseFloat(value);
        setFftSettings(newSettings);
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content audio-settings-window" style={{ minWidth: '400px' }}>
                <div className="modal-header">
                    <h3>{t('audio.title')}</h3>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>
                
                <div className="tab-header" style={{ display: 'flex', gap: '10px', marginBottom: '15px', borderBottom: '1px solid #444' }}>
                    <button 
                        className={`tab-btn ${activeTab === 'output' ? 'active' : ''}`}
                        onClick={() => setActiveTab('output')}
                        style={{ padding: '8px 15px', background: 'none', border: 'none', color: activeTab === 'output' ? 'var(--theme-color)' : '#888', borderBottom: activeTab === 'output' ? '2px solid var(--theme-color)' : 'none', cursor: 'pointer' }}
                    >
                        {t('audio.output')}
                    </button>
                    <button 
                        className={`tab-btn ${activeTab === 'fft' ? 'active' : ''}`}
                        onClick={() => setActiveTab('fft')}
                        style={{ padding: '8px 15px', background: 'none', border: 'none', color: activeTab === 'fft' ? 'var(--theme-color)' : '#888', borderBottom: activeTab === 'fft' ? '2px solid var(--theme-color)' : 'none', cursor: 'pointer' }}
                    >
                        {t('audio.fftSettings')}
                    </button>
                </div>

                <div className="modal-body">
                    {activeTab === 'output' && (
                        <div className="audio-output-settings">
                            <div className="settings-row" style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '5px' }}>{t('audio.device')}</label>
                                <select 
                                    className="param-select" 
                                    value={selectedDeviceId} 
                                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                                    style={{ width: '100%', padding: '5px' }}
                                >
                                    {devices.map(device => (
                                        <option key={device.deviceId} value={device.deviceId}>
                                            {device.label || `Device ${device.deviceId.slice(0, 5)}`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            
                            <div className="settings-row" style={{ textAlign: 'center' }}>
                                <label style={{ display: 'block', marginBottom: '10px' }}>{t('audio.volume')}</label>
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    <RadialKnob 
                                        value={globalVolume} 
                                        onChange={setVolume} 
                                        label={t('audio.master')} 
                                        isAssigned={true}
                                        size={60}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'fft' && (
                        <div className="fft-settings">
                            <div className="settings-row" style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '5px' }}>{t('audio.source')}</label>
                                <select 
                                    className="param-select" 
                                    value={fftSettings.source} 
                                    onChange={(e) => setFftSettings({ ...fftSettings, source: e.target.value })}
                                    style={{ width: '100%', padding: '5px' }}
                                >
                                    <option value="external">{t('audio.externalMic')}</option>
                                    <option value="system">{t('audio.systemAudio')}</option>
                                    <option value="clip">{t('audio.clipFft')}</option>
                                </select>
                            </div>

                            {fftSettings.source === 'external' && (
                                <div className="settings-row" style={{ marginBottom: '15px' }}>
                                    <label style={{ display: 'block', marginBottom: '5px' }}>{t('audio.inputDevice')}</label>
                                    <select 
                                        className="param-select" 
                                        value={selectedInputDeviceId} 
                                        onChange={(e) => setSelectedInputDeviceId(e.target.value)}
                                        style={{ width: '100%', padding: '5px' }}
                                    >
                                        <option value="default">{t('audio.defaultInput')}</option>
                                        {inputDevices.map(device => (
                                            <option key={device.deviceId} value={device.deviceId}>
                                                {device.label || `Input ${device.deviceId.slice(0, 5)}`}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="settings-row" style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '5px' }}>{t('audio.calculationMode')}</label>
                                <select 
                                    className="param-select" 
                                    value={fftSettings.calculationMode || 'average'} 
                                    onChange={(e) => setFftSettings({ ...fftSettings, calculationMode: e.target.value })}
                                    style={{ width: '100%', padding: '5px' }}
                                >
                                    <option value="average">{t('audio.averageSmooth')}</option>
                                    <option value="peak">{t('audio.peakPunchy')}</option>
                                </select>
                            </div>

                            <div className="settings-row" style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '10px' }}>{t('audio.rangesHz')}</label>
                                <div className="range-controls" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px', alignItems: 'center' }}>
                                    <span>{t('audio.low')}:</span>
                                    <div style={{ display: 'flex', gap: '5px' }}>
                                        <input type="number" value={fftSettings.lowRange[0]} onChange={(e) => handleFftRangeChange('low', 0, e.target.value)} style={{ width: '60px' }} />
                                        <span>-</span>
                                        <input type="number" value={fftSettings.lowRange[1]} onChange={(e) => handleFftRangeChange('low', 1, e.target.value)} style={{ width: '60px' }} />
                                    </div>
                                    <span>{t('audio.mid')}:</span>
                                    <div style={{ display: 'flex', gap: '5px' }}>
                                        <input type="number" value={fftSettings.midRange[0]} onChange={(e) => handleFftRangeChange('mid', 0, e.target.value)} style={{ width: '60px' }} />
                                        <span>-</span>
                                        <input type="number" value={fftSettings.midRange[1]} onChange={(e) => handleFftRangeChange('mid', 1, e.target.value)} style={{ width: '60px' }} />
                                    </div>
                                    <span>{t('audio.high')}:</span>
                                    <div style={{ display: 'flex', gap: '5px' }}>
                                        <input type="number" value={fftSettings.highRange[0]} onChange={(e) => handleFftRangeChange('high', 0, e.target.value)} style={{ width: '60px' }} />
                                        <span>-</span>
                                        <input type="number" value={fftSettings.highRange[1]} onChange={(e) => handleFftRangeChange('high', 1, e.target.value)} style={{ width: '60px' }} />
                                    </div>
                                </div>
                            </div>

                            <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '10px' }}>{t('audio.gain')}</label>
                                    <RadialKnob 
                                        value={(fftSettings.gain / 5)} // Scaling for display
                                        onChange={(val) => setFftSettings({ ...fftSettings, gain: val * 5 })} 
                                        isAssigned={true}
                                        size={40}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '10px' }}>{t('audio.smooth')}</label>
                                    <RadialKnob 
                                        value={fftSettings.smoothingTimeConstant || 0.8} 
                                        onChange={(val) => setFftSettings({ ...fftSettings, smoothingTimeConstant: val })} 
                                        isAssigned={true}
                                        size={40}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '10px' }}>{t('audio.hold')}</label>
                                    <RadialKnob 
                                        value={(fftSettings.holdTime / 1000)} 
                                        onChange={(val) => setFftSettings({ ...fftSettings, holdTime: val * 1000 })} 
                                        isAssigned={true}
                                        size={40}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '10px' }}>{t('audio.fall')}</label>
                                    <RadialKnob 
                                        value={(fftSettings.fallTime / 2000)} 
                                        onChange={(val) => setFftSettings({ ...fftSettings, fallTime: val * 2000 })} 
                                        isAssigned={true}
                                        size={40}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
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
                    color: #888;
                    font-size: 24px;
                    cursor: pointer;
                }
                .close-btn:hover {
                    color: white;
                }
                .param-select, input {
                    background: #111;
                    border: 1px solid #444;
                    color: white;
                    border-radius: 4px;
                }
            `}</style>
        </div>
    );
};

export default AudioSettingsWindow;
