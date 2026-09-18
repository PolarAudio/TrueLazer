import React, { useEffect, useState, useCallback } from 'react';
import { useTimeline } from '../../contexts/TimelineContext';
import { formatTimecode } from '../../utils/timelineTime';
import { generatorDefinitions } from '../../utils/generatorDefinitions';
import { effectDefinitions } from '../../utils/effectDefinitions';
import TimelinePreview from './TimelinePreview';

const NumberField = ({ label, value, onCommit, step = 0.01, min = 0 }) => {
    const [draft, setDraft] = useState(String(value));

    useEffect(() => setDraft(String(value)), [value]);

    const commit = () => {
        const n = parseFloat(draft);
        if (isFinite(n)) onCommit(n);
        else setDraft(String(value));
    };

    return (
        <label className="timeline-field">
            <span>{label}</span>
            <input
                type="text"
                value={draft}
                step={step}
                min={min}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
        </label>
    );
};

const GeneratorParams = ({ cue }) => {
    const { actions } = useTimeline();
    const def = generatorDefinitions.find((d) => d.id === cue.generatorId);
    const params = cue.generatorParams || {};

    if (!def) {
        return (
            <div className="timeline-inspector-hint">
                Unknown generator "{cue.generatorId}". Select one below.
            </div>
        );
    }

    const setParam = (id, value) =>
        actions.updateCue(cue.id, { generatorParams: { ...params, [id]: value } });

    const dragGenParam = (e, ctrl) => {
        e.dataTransfer.setData(
            'application/x-tl-genparam',
            JSON.stringify({ genId: cue.generatorId, paramId: ctrl.id }),
        );
        e.dataTransfer.effectAllowed = 'link';
    };

    return (
        <div className="timeline-generator-params">
            <div className="timeline-inspector-hint">
                Drag <span className="timeline-gen-drag">✥</span> onto an automation lane to animate that param.
            </div>
            {def.paramControls.map((ctrl) => {
                const visible = ctrl.condition ? ctrl.condition(params) : true;
                if (!visible) return null;
                const val = params[ctrl.id] ?? def.defaultParams[ctrl.id];
                if (ctrl.type === 'range') {
                    return (
                        <label key={ctrl.id} className="timeline-field-range timeline-field-range-draggable">
                            <span>{ctrl.label} <b>{typeof val === 'number' ? val.toFixed(2) : val}</b></span>
                            <input
                                type="range"
                                min={ctrl.min} max={ctrl.max} step={ctrl.step}
                                value={val}
                                onChange={(e) => setParam(ctrl.id, parseFloat(e.target.value))}
                            />
                            <span
                                className="timeline-gen-drag"
                                draggable
                                title="Drag onto a channel automation lane to animate this param over time"
                                onDragStart={(e) => dragGenParam(e, ctrl)}
                            >✥</span>
                        </label>
                    );
                }
                if (ctrl.type === 'select') {
                    return (
                        <label key={ctrl.id} className="timeline-field">
                            <span>{ctrl.label}</span>
                            <select value={val} onChange={(e) => setParam(ctrl.id, e.target.value)}>
                                {(ctrl.options || []).map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </label>
                    );
                }
                if (ctrl.type === 'checkbox') {
                    return (
                        <label key={ctrl.id} className="timeline-field-checkbox">
                            <input type="checkbox" checked={!!val} onChange={(e) => setParam(ctrl.id, e.target.checked)} />
                            <span>{ctrl.label}</span>
                        </label>
                    );
                }
                return (
                    <label key={ctrl.id} className="timeline-field">
                        <span>{ctrl.label}</span>
                        <input
                            type="text"
                            value={val ?? ''}
                            onChange={(e) => setParam(ctrl.id, e.target.value)}
                        />
                    </label>
                );
            })}
        </div>
    );
};

const TimelineInspector = ({ onSeek, previewFrame, playheadSec }) => {
    const { state, actions } = useTimeline();
    const selectedIds = state.settings.selectedCueIds || [];
    const cue = state.cues[state.settings.selectedCueId];
    const multi = selectedIds.length > 1;

    const handleReloadIlda = useCallback(async () => {
        if (!cue || !window.electronAPI?.showOpenDialog) return;
        const filePath = await window.electronAPI.showOpenDialog({
            filters: [{ name: 'ILDA', extensions: ['ild', 'ilda'] }],
            properties: ['openFile'],
        });
        if (filePath) {
            const fileName = filePath.split(/[\\/]/).pop();
            actions.updateCue(cue.id, { filePath, fileName, name: fileName });
        }
    }, [cue, actions]);

    const channel = cue ? state.channels[cue.channelId] : null;

    let summary = null;
    if (multi) {
        const cues = selectedIds.map((id) => state.cues[id]).filter(Boolean);
        const channels = [...new Set(cues.map((c) => state.channels[c.channelId]?.name).filter(Boolean))];
        const start = Math.min(...cues.map((c) => c.startTime));
        const end = Math.max(...cues.map((c) => c.startTime + c.duration));
        summary = (
            <div className="timeline-multi-summary">
                <div className="timeline-cue-type generator">✦ {cues.length} Clips Selected</div>
                {channels.length > 0 && <div className="timeline-inspector-hint">Channels: {channels.join(', ')}</div>}
                <div className="timeline-inspector-hint">
                    {formatTimecode(start, state.settings.fps)} → {formatTimecode(end, state.settings.fps)}
                </div>
                <div className="timeline-inspector-hint">
                    Drag any selected clip to move the group; drag its edges to trim the group.
                </div>
                <button
                    className="timeline-btn danger"
                    onClick={() => { for (const id of selectedIds) actions.removeCue(id); }}
                >
                    Delete {cues.length} Clips
                </button>
            </div>
        );
    }

    return (
        <div className="timeline-inspector">
            <h3>Inspector</h3>
            {previewFrame && <TimelinePreview previewFrame={previewFrame} playheadSec={playheadSec} />}

            {multi ? summary : !cue ? (
                <p className="timeline-inspector-hint">Select a cue block to edit its properties.</p>
            ) : (
                <>
                    <div className={`timeline-cue-type ${cue.type === 'ILDA' ? 'ilda' : 'generator'}`}>
                        {cue.type === 'ILDA' ? '◈ ILDA File' : '✦ Generator'}
                        {cue.isLooping && <span className="timeline-loop-badge">LOOP</span>}
                    </div>

            <label className="timeline-field">
                <span>Name</span>
                <input
                    type="text"
                    value={cue.name}
                    onChange={(e) => actions.updateCue(cue.id, { name: e.target.value })}
                />
            </label>

            <NumberField label="Start (s)" value={cue.startTime} min={0}
                onCommit={(v) => actions.updateCue(cue.id, { startTime: Math.max(0, v) })} />
            <NumberField label="Duration (s)" value={cue.duration} min={0.1}
                onCommit={(v) => actions.updateCue(cue.id, { duration: Math.max(0.1, v) })} />

            <label className="timeline-field-checkbox">
                <input
                    type="checkbox"
                    checked={!!cue.isLooping}
                    onChange={(e) => actions.updateCue(cue.id, { isLooping: e.target.checked })}
                />
                <span>Loop while playing</span>
            </label>

            {cue.type === 'ILDA' && (
                <div className="timeline-inspector-section">
                    <div className="timeline-inspector-subhead">Source file</div>
                    <div className="timeline-filepath" title={cue.filePath}>{cue.fileName || cue.filePath}</div>
                    <button className="timeline-btn" onClick={handleReloadIlda}>Replace File…</button>
                    {cue.totalFrames > 0 && (
                        <div className="timeline-inspector-hint">
                            {cue.totalFrames} frames · {formatTimecode(cue.startTime, state.settings.fps)}
                        </div>
                    )}
                </div>
            )}

            {cue.type === 'GENERATOR' && (
                <div className="timeline-inspector-section">
                    <div className="timeline-inspector-subhead">Generator</div>
                    <select
                        value={cue.generatorId || 'circle'}
                        onChange={(e) => actions.updateCue(cue.id, { generatorId: e.target.value })}
                    >
                        {generatorDefinitions.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                    </select>
                    <GeneratorParams cue={cue} />
                </div>
            )}

            <div className="timeline-inspector-meta">
                {channel && <span>Channel: {channel.name}</span>}
                {onSeek && (
                    <button className="timeline-btn" onClick={() => onSeek(cue.startTime)}>▶ Jump to cue</button>
                )}
            </div>

            <button className="timeline-btn danger" onClick={() => { actions.removeCue(cue.id); }}>Delete Cue</button>
                </>
            )}

            <div className="timeline-inspector-section timeline-effect-library">
                <div className="timeline-inspector-subhead">Automation Effects</div>
                <div className="timeline-inspector-hint">
                    Drag an effect onto an automation lane, then pick the parameter to link.
                </div>
                <div className="timeline-effect-list">
                    {effectDefinitions.map((def) => (
                        <div
                            key={def.id}
                            className="timeline-effect-item"
                            draggable
                            title={def.description || def.name}
                            onDragStart={(e) => {
                                e.dataTransfer.setData('application/x-tl-effect', def.id);
                                e.dataTransfer.effectAllowed = 'link';
                            }}
                        >
                            {def.name}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default TimelineInspector;