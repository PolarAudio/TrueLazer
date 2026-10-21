import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BUG_SEVERITIES,
    REPORT_AREAS,
    composeBugReport,
    composeFeatureReport,
    fitIssueUrl,
    formatDacSummary,
    formatEnvironment,
} from '../utils/reportDraft';
import { getGpuInfo } from '../utils/gpuInfo';

// The pages the user can be on when they open the window. The page is worth
// reporting: a bug that only happens in the Shape Builder is a very different
// bug from one that only happens in the Timeline.
const PAGE_LABELS = {
    main: 'Show Editor',
    timeline: 'Timeline Editor',
    shapeBuilder: 'Shape Builder',
};

const emptyBug = () => ({
    title: '',
    severity: 'broken',
    area: 'Show Editor',
    whatHappened: '',
    expected: '',
    steps: '',
});

const emptyFeature = () => ({
    title: '',
    area: 'Show Editor',
    problem: '',
    proposal: '',
    why: '',
    alternatives: '',
});

const Field = ({ label, hint, children }) => (
    <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', color: '#9aa0a6', marginBottom: '4px' }}>{label}</div>
        {children}
        {hint ? <div style={{ fontSize: '11px', color: '#6b7075', marginTop: '3px' }}>{hint}</div> : null}
    </div>
);

const ReportWindow = ({ show, mode = 'bug', onClose, page = 'main', dacs = [] }) => {
    const [tab, setTab] = useState(mode === 'feature' ? 'feature' : 'bug');
    const [bug, setBug] = useState(emptyBug);
    const [feature, setFeature] = useState(emptyFeature);
    const [includeEnvironment, setIncludeEnvironment] = useState(true);
    const [includeLogs, setIncludeLogs] = useState(true);
    const [redact, setRedact] = useState(true);
    const [diagnostics, setDiagnostics] = useState(null);
    const [gpu, setGpu] = useState('');
    const [showPreview, setShowPreview] = useState(false);
    const [status, setStatus] = useState(null);

    // The GPU string only exists inside the renderer's WebGL context, so it
    // is read once when the window opens.
    useEffect(() => {
        if (!show) return;
        setGpu(getGpuInfo());
    }, [show]);

    // Diagnostics are re-read whenever the window opens or one of the
    // inclusion switches changes: redaction happens in the main process, so
    // switching redaction off means the log has to be read again.
    useEffect(() => {
        if (!show) return;
        let cancelled = false;
        window.electronAPI?.getDiagnostics?.({ includeLogs, redact })
            .then((data) => { if (!cancelled) setDiagnostics(data); })
            .catch(() => { if (!cancelled) setDiagnostics(null); });
        return () => { cancelled = true; };
    }, [show, includeLogs, redact]);

    // Starting a new report should start from a clean sheet, but the
    // inclusion switches are a preference rather than part of the report.
    useEffect(() => {
        if (!show) return;
        setTab(mode === 'feature' ? 'feature' : 'bug');
        setBug(emptyBug());
        setFeature(emptyFeature());
        setStatus(null);
        setShowPreview(false);
    }, [show, mode]);

    const draft = tab === 'bug' ? bug : feature;

    const environment = useMemo(() => {
        if (!includeEnvironment || !diagnostics) return '';
        return formatEnvironment(diagnostics, {
            gpu,
            page: PAGE_LABELS[page] || page,
            dac: formatDacSummary(dacs),
        });
    }, [includeEnvironment, diagnostics, gpu, page, dacs]);

    const logTail = includeLogs && diagnostics ? (diagnostics.logTail || '') : '';

    const body = useMemo(() => {
        if (tab === 'bug') {
            return composeBugReport(bug, { environment, logTail });
        }
        return composeFeatureReport(feature, { environment });
    }, [tab, bug, feature, environment, logTail]);

    const title = (draft.title || '').trim();
    const description = tab === 'bug'
        ? (bug.whatHappened || '').trim()
        : (feature.problem || '').trim();
    const canSubmit = title.length > 0 && description.length > 0;

    const issueTitle = `${tab === 'bug' ? '[Bug]' : '[Feature]'} ${title}`.trim();
    const label = tab === 'bug' ? 'bug' : 'enhancement';

    const setBugField = useCallback((field, value) => {
        setBug(prev => ({ ...prev, [field]: value }));
    }, []);
    const setFeatureField = useCallback((field, value) => {
        setFeature(prev => ({ ...prev, [field]: value }));
    }, []);

    const handleCopy = useCallback(async () => {
        const text = body.trimEnd() + '\n';
        const result = await window.electronAPI?.copyToClipboard?.(text);
        if (result?.success) {
            setStatus({ kind: 'ok', text: 'Report copied to the clipboard.' });
        } else {
            setStatus({ kind: 'error', text: result?.error || 'Could not reach the clipboard.' });
        }
    }, [body]);

    const handleCopyLogs = useCallback(async () => {
        const result = await window.electronAPI?.copyToClipboard?.(logTail);
        if (result?.success) {
            setStatus({ kind: 'ok', text: 'Log tail copied to the clipboard.' });
        } else {
            setStatus({ kind: 'error', text: result?.error || 'Could not reach the clipboard.' });
        }
    }, [logTail]);

    const handleOpenIssue = useCallback(async () => {
        if (!canSubmit) return;
        const fitted = fitIssueUrl({ title: issueTitle, body, label });
        const result = await window.electronAPI?.openExternalUrl?.(fitted.url);
        if (result?.success) {
            setStatus({
                kind: 'ok',
                text: fitted.droppedLogTail
                    ? 'Opened a pre-filled GitHub issue. The log was too long for the link - paste it into the issue with "Copy Log Tail".'
                    : 'Opened a pre-filled GitHub issue in your browser.',
            });
        } else {
            setStatus({ kind: 'error', text: result?.error || 'Could not open the browser.' });
        }
    }, [canSubmit, issueTitle, body, label]);

    const handleOpenLogs = useCallback(async () => {
        const result = await window.electronAPI?.openLogFolder?.();
        if (result?.success) {
            setStatus({ kind: 'ok', text: 'Opened the logs folder.' });
        } else {
            setStatus({ kind: 'error', text: result?.error || 'Could not open the logs folder.' });
        }
    }, []);

    if (!show) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content report-window" style={{ minWidth: '520px', maxWidth: '760px' }}>
                <div className="modal-header">
                    <h3 style={{ margin: 0, fontSize: '15px' }}>Report to the TrueLazer project</h3>
                    <button className="close-btn" onClick={onClose} title="Close">×</button>
                </div>

                <div className="report-tabs">
                    <button
                        className={tab === 'bug' ? 'report-tab active' : 'report-tab'}
                        onClick={() => setTab('bug')}
                    >
                        Report a bug
                    </button>
                    <button
                        className={tab === 'feature' ? 'report-tab active' : 'report-tab'}
                        onClick={() => setTab('feature')}
                    >
                        Request a feature
                    </button>
                </div>

                <div className="modal-body report-body">
                    {tab === 'bug' ? (
                        <>
                            <Field label="Summary">
                                <input
                                    className="report-input"
                                    value={bug.title}
                                    placeholder="What went wrong?"
                                    onChange={e => setBugField('title', e.target.value)}
                                />
                            </Field>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{ flex: 1 }}>
                                    <Field label="Severity">
                                        <select
                                            className="report-input"
                                            value={bug.severity}
                                            onChange={e => setBugField('severity', e.target.value)}
                                        >
                                            {BUG_SEVERITIES.map(s => (
                                                <option key={s.value} value={s.value}>{s.label}</option>
                                            ))}
                                        </select>
                                    </Field>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <Field label="Area">
                                        <select
                                            className="report-input"
                                            value={bug.area}
                                            onChange={e => setBugField('area', e.target.value)}
                                        >
                                            {REPORT_AREAS.map(area => (
                                                <option key={area} value={area}>{area}</option>
                                            ))}
                                        </select>
                                    </Field>
                                </div>
                            </div>
                            <Field label="What happened">
                                <textarea
                                    className="report-input report-textarea"
                                    rows={4}
                                    value={bug.whatHappened}
                                    placeholder="What did you see? Include any error message."
                                    onChange={e => setBugField('whatHappened', e.target.value)}
                                />
                            </Field>
                            <Field label="What did you expect instead?">
                                <textarea
                                    className="report-input report-textarea"
                                    rows={2}
                                    value={bug.expected}
                                    onChange={e => setBugField('expected', e.target.value)}
                                />
                            </Field>
                            <Field label="Steps to reproduce" hint="One step per line.">
                                <textarea
                                    className="report-input report-textarea"
                                    rows={4}
                                    value={bug.steps}
                                    placeholder={'Open the Timeline Editor\nImport a .json project\nPress play'}
                                    onChange={e => setBugField('steps', e.target.value)}
                                />
                            </Field>
                        </>
                    ) : (
                        <>
                            <Field label="Summary">
                                <input
                                    className="report-input"
                                    value={feature.title}
                                    placeholder="What would you like TrueLazer to do?"
                                    onChange={e => setFeatureField('title', e.target.value)}
                                />
                            </Field>
                            <Field label="Area">
                                <select
                                    className="report-input"
                                    value={feature.area}
                                    onChange={e => setFeatureField('area', e.target.value)}
                                >
                                    {REPORT_AREAS.map(area => (
                                        <option key={area} value={area}>{area}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="The problem you are trying to solve">
                                <textarea
                                    className="report-input report-textarea"
                                    rows={4}
                                    value={feature.problem}
                                    placeholder="What are you trying to do that is awkward or impossible today?"
                                    onChange={e => setFeatureField('problem', e.target.value)}
                                />
                            </Field>
                            <Field label="Proposed solution">
                                <textarea
                                    className="report-input report-textarea"
                                    rows={3}
                                    value={feature.proposal}
                                    placeholder="What would a good solution look like?"
                                    onChange={e => setFeatureField('proposal', e.target.value)}
                                />
                            </Field>
                            <Field label="Why it matters">
                                <textarea
                                    className="report-input report-textarea"
                                    rows={2}
                                    value={feature.why}
                                    placeholder="How would this change your show workflow?"
                                    onChange={e => setFeatureField('why', e.target.value)}
                                />
                            </Field>
                            <Field label="Alternatives you considered" hint="Optional.">
                                <textarea
                                    className="report-input report-textarea"
                                    rows={2}
                                    value={feature.alternatives}
                                    placeholder="Workarounds you have used, or other tools that do this."
                                    onChange={e => setFeatureField('alternatives', e.target.value)}
                                />
                            </Field>
                        </>
                    )}

                    <div className="report-section">
                        <div className="report-section-title">Details to include</div>
                        <label className="report-check">
                            <input
                                type="checkbox"
                                checked={includeEnvironment}
                                onChange={e => setIncludeEnvironment(e.target.checked)}
                            />
                            <span>Environment details (version, OS, CPU, GPU, page, DAC)</span>
                        </label>
                        <label className="report-check">
                            <input
                                type="checkbox"
                                checked={includeLogs}
                                onChange={e => setIncludeLogs(e.target.checked)}
                            />
                            <span>Recent log tail</span>
                        </label>
                        <label className="report-check">
                            <input
                                type="checkbox"
                                checked={redact}
                                onChange={e => setRedact(e.target.checked)}
                            />
                            <span>Redact personal paths, e-mail addresses and MAC addresses</span>
                        </label>
                        <div className="report-note">
                            Reports are posted to the public GitHub issue tracker. Nothing is sent
                            automatically - the report is handed to your browser for you to review
                            and submit.
                        </div>
                        {logTail ? (
                            <button className="report-link" onClick={handleCopyLogs}>
                                Copy log tail
                            </button>
                        ) : null}
                    </div>

                    <div className="report-section">
                        <button className="report-link" onClick={() => setShowPreview(v => !v)}>
                            {showPreview ? 'Hide preview' : 'Preview report'}
                        </button>
                        {showPreview ? (
                            <pre className="report-preview">{body.trimEnd()}</pre>
                        ) : null}
                    </div>

                    {status ? (
                        <div className={status.kind === 'error' ? 'report-status error' : 'report-status'}>
                            {status.text}
                        </div>
                    ) : null}
                    {!canSubmit ? (
                        <div className="report-note">
                            A summary and a description are needed before the report can be opened.
                        </div>
                    ) : null}
                </div>

                <div className="report-footer">
                    <button className="report-button" onClick={handleOpenLogs}>Open logs folder</button>
                    <button className="report-button" onClick={handleCopy}>Copy report</button>
                    <button
                        className="report-button primary"
                        disabled={!canSubmit}
                        onClick={handleOpenIssue}
                    >
                        Open GitHub issue
                    </button>
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
                .modal-body {
                    padding: 16px 20px;
                }
                .close-btn {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 24px;
                    cursor: pointer;
                    line-height: 1;
                }
                .close-btn:hover { color: white; }
                .report-window { max-height: 88vh; }
                .report-tabs {
                    display: flex;
                    gap: 4px;
                    padding: 8px 20px 0;
                    background: #222;
                    border-bottom: 1px solid #3a3a3a;
                }
                .report-tab {
                    background: none;
                    border: none;
                    border-bottom: 2px solid transparent;
                    color: #9aa0a6;
                    padding: 8px 10px;
                    font-size: 13px;
                    cursor: pointer;
                }
                .report-tab:hover { color: #e8eaed; }
                .report-tab.active {
                    color: #ffffff;
                    border-bottom-color: #ff8c00;
                }
                .report-body {
                    overflow-y: auto;
                    min-height: 0;
                }
                .report-input {
                    width: 100%;
                    box-sizing: border-box;
                    background: #111;
                    border: 1px solid #444;
                    color: white;
                    border-radius: 4px;
                    padding: 6px 8px;
                    font-size: 13px;
                    font-family: inherit;
                }
                .report-input:focus {
                    outline: none;
                    border-color: #ff8c00;
                }
                .report-textarea {
                    resize: vertical;
                    line-height: 1.4;
                }
                .report-section {
                    margin-top: 16px;
                    padding-top: 12px;
                    border-top: 1px solid #3a3a3a;
                }
                .report-section-title {
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                    color: #80868b;
                    margin-bottom: 8px;
                }
                .report-check {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 12px;
                    color: #e8eaed;
                    margin-bottom: 6px;
                    cursor: pointer;
                }
                .report-note {
                    font-size: 11px;
                    color: #80868b;
                    line-height: 1.5;
                    margin-top: 8px;
                }
                .report-link {
                    background: none;
                    border: none;
                    color: #8ab4f8;
                    font-size: 12px;
                    cursor: pointer;
                    padding: 0;
                    margin-top: 8px;
                    text-decoration: underline;
                }
                .report-preview {
                    background: #111;
                    border: 1px solid #444;
                    border-radius: 4px;
                    padding: 10px;
                    font-size: 11px;
                    line-height: 1.45;
                    color: #d5d8dc;
                    max-height: 240px;
                    overflow: auto;
                    white-space: pre-wrap;
                    word-break: break-word;
                    margin: 8px 0 0;
                }
                .report-status {
                    margin-top: 12px;
                    font-size: 12px;
                    color: #7ee787;
                    line-height: 1.5;
                }
                .report-status.error { color: #ff7b72; }
                .report-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    padding: 12px 20px;
                    background: #2a2a2a;
                    border-top: 1px solid #3a3a3a;
                }
                .report-button {
                    background: #3a3a3a;
                    border: 1px solid #555;
                    color: #e8eaed;
                    border-radius: 4px;
                    padding: 7px 14px;
                    font-size: 12px;
                    cursor: pointer;
                    font-family: inherit;
                }
                .report-button:hover:not(:disabled) { background: #454545; }
                .report-button:disabled { opacity: 0.45; cursor: default; }
                .report-button.primary {
                    background: #ff8c00;
                    border-color: #ff8c00;
                    color: #1a1a1a;
                    font-weight: 600;
                }
                .report-button.primary:hover:not(:disabled) { background: #ff9d26; }
            `}</style>
        </div>
    );
};

export default ReportWindow;
