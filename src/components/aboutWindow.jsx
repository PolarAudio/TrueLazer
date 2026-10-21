import React, { useState, useEffect } from 'react';

// The DAC protocols the app can drive. Kept here as plain data so the About
// window stays a description of the app rather than a second source of truth
// about what the comms layer actually supports.
const DAC_BACKENDS = [
    { name: 'Showbridge', detail: 'UDP, native frame protocol + ILDA over TCP' },
    { name: 'EtherDream', detail: 'TCP, EtherDream protocol' },
    { name: 'IDN', detail: 'UDP, IDN show network protocol' },
];

// Each window keeps its own project document and file format. Output Settings
// are additionally exportable as a standalone `.tlo` so one rig configuration
// can be reused across projects.
const PROJECT_FORMATS = [
    { label: 'Show Project', ext: '.tlp', where: 'Show Control' },
    { label: 'Timeline Project', ext: '.json', where: 'Timeline Editor' },
    { label: 'Shape Project', ext: '.tls', where: 'Shape Builder' },
    { label: 'Output Settings', ext: '.tlo', where: 'Output Settings ▸ Export' },
];

const Row = ({ label, value, mono }) => (
    <div style={{ display: 'flex', gap: '12px', padding: '3px 0', alignItems: 'baseline' }}>
        <div style={{ color: '#9aa0a6', minWidth: '132px', flexShrink: 0 }}>{label}</div>
        <div style={{ color: '#e8eaed', wordBreak: 'break-all', fontFamily: mono ? 'monospace' : undefined }}>
            {value}
        </div>
    </div>
);

const Section = ({ title, children }) => (
    <div style={{ marginBottom: '18px' }}>
        <div style={{
            fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em',
            color: '#80868b', marginBottom: '6px', borderBottom: '1px solid #3a3a3a', paddingBottom: '4px',
        }}>
            {title}
        </div>
        {children}
    </div>
);

const AboutWindow = ({ show, onClose }) => {
    const [info, setInfo] = useState(null);

    useEffect(() => {
        if (!show) return;
        let cancelled = false;
        // Fetched on open rather than at mount so the About dialog is accurate
        // even if the app was updated underneath a long-lived window.
        window.electronAPI?.getAppInfo?.()
            .then((data) => { if (!cancelled) setInfo(data); })
            .catch(() => { if (!cancelled) setInfo(null); });
        return () => { cancelled = true; };
    }, [show]);

    if (!show) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content audio-settings-window" style={{ minWidth: '460px', maxWidth: '620px' }}>
                <div className="modal-header">
                    <h3 style={{ margin: 0, fontSize: '15px' }}>
                        About {info?.name || 'TrueLazer'}
                        {info?.version ? <span style={{ color: '#9aa0a6', fontWeight: 'normal' }}> {info.version}</span> : null}
                    </h3>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>
                <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>

                    <Section title="Application">
                        <Row label="Name" value={info?.name || 'TrueLazer'} />
                        <Row label="Version" value={info?.version || '—'} />
                        {info?.author ? <Row label="Author" value={info.author} /> : null}
                        {info?.license ? <Row label="License" value={info.license} /> : null}
                    </Section>

                    <Section title="Runtime">
                        <Row label="Electron" value={info?.electron || '—'} mono />
                        <Row label="Chromium" value={info?.chrome || '—'} mono />
                        <Row label="Node.js" value={info?.node || '—'} mono />
                        <Row label="V8" value={info?.v8 || '—'} mono />
                        <Row label="Platform" value={[info?.platform, info?.arch].filter(Boolean).join(' · ') || '—'} mono />
                    </Section>

                    <Section title="Project Formats">
                        {PROJECT_FORMATS.map((f) => (
                            <Row
                                key={f.ext}
                                label={f.label}
                                value={<><code style={{ color: '#8ab4f8' }}>{f.ext}</code>{'  — '}{f.where}</>}
                            />
                        ))}
                    </Section>

                    <Section title="DAC Backends">
                        {DAC_BACKENDS.map((d) => (
                            <Row key={d.name} label={d.name} value={d.detail} />
                        ))}
                    </Section>

                    <Section title="Locations">
                        <Row label="Documents" value={info?.documentsPath || '—'} mono />
                        <Row label="App data" value={info?.userDataPath || '—'} mono />
                    </Section>

                    <Section title="Project">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
                            <div style={{ color: '#e8eaed', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                https://github.com/PolarAudio/TrueLazer
                            </div>
                            <button
                                className="about-link"
                                onClick={() => window.electronAPI?.openExternalUrl?.('https://github.com/PolarAudio/TrueLazer')}
                            >
                                Open
                            </button>
                        </div>
                        <div style={{ fontSize: '11px', color: '#80868b', marginTop: '6px', lineHeight: '1.5' }}>
                            Bug reports and feature requests can be filed from Help ▸ Report a Bug...
                            and Help ▸ Request a Feature...
                        </div>
                    </Section>

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
                .about-link {
                    background: none;
                    border: none;
                    color: #8ab4f8;
                    font-size: 12px;
                    cursor: pointer;
                    padding: 0;
                    flex-shrink: 0;
                    text-decoration: underline;
                }
            `}</style>
        </div>
    );
};

export default AboutWindow;