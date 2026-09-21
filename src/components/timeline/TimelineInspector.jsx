import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTimeline, getChannelDisplayName, getChannelOutputs, getOverlappingCueIds } from '../../contexts/TimelineContext';
import getRelativePath from '../../utils/pathUtils';
import { formatTimecode } from '../../utils/timelineTime';
import { generatorDefinitions } from '../../utils/generatorDefinitions';
import { effectDefinitions } from '../../utils/effectDefinitions';
import {
    getLaneParam,
    getLaneGenParam,
    getLaneEffectDef,
    getLaneGenDef,
    getLaneTarget,
    laneDefaultValue,
    evaluateClipAt,
} from '../../utils/timelineAutomation';
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

/** True when `showIf` constraints (paramId → value | [values]) all hold. */
function showIfHolds(showIf, resolved) {
    for (const key of Object.keys(showIf || {})) {
        const expect = showIf[key];
        const actual = resolved[key];
        if (Array.isArray(expect) ? !expect.includes(actual) : actual !== expect) return false;
    }
    return true;
}

/** Select options come as strings or {value,label} objects. */
function optionDecode(o) {
    return typeof o === 'object' && o !== null ? { value: o.value, label: o.label } : { value: o, label: o };
}

/**
 * Per-clip toggle overrides for the channel's effect lanes. Keyframe curves can
 * only drive continuous 'range' params — every other control on a linked effect
 * (selects, checkboxes, color, text) is static per channel, so this lets each
 * clip do it differently (e.g. Delay direction per clip).
 */
const CueEffectToggles = ({ cue }) => {
    const { state, actions } = useTimeline();
    const channel = state.channels[cue.channelId];
    if (!channel) return null;

    const lanes = (channel.automationLanes || [])
        .map((lid) => state.lanes[lid])
        .filter(Boolean);
    const effectIds = [...new Set(lanes.map((l) => l.effectId).filter(Boolean))];
    if (effectIds.length === 0) return null;

    const overrides = cue.effectOverrides || {};
    const setParam = (effectId, paramId, value) => {
        const next = { ...overrides, [effectId]: { ...(overrides[effectId] || {}), [paramId]: value } };
        actions.updateCue(cue.id, { effectOverrides: next });
    };

    const rows = [];
    for (const effectId of effectIds) {
        const def = effectDefinitions.find((d) => d.id === effectId);
        if (!def) continue;
        const resolved = { ...(def.defaultParams || {}), ...(overrides[effectId] || {}) };
        const controls = (def.paramControls || []).filter((c) => c.type !== 'range');
        for (const ctrl of controls) {
            if (ctrl.showIf && !showIfHolds(ctrl.showIf, resolved)) continue;
            const val = resolved[ctrl.id] ?? def.defaultParams?.[ctrl.id];
            rows.push(
                <div key={`${effectId}.${ctrl.id}`} className="timeline-cue-effect-row">
                    <div className="timeline-inspector-hint timeline-cue-effect-row-head">
                        <b>{def.name}</b> · {ctrl.label}
                    </div>
                    {ctrl.type === 'select' ? (
                        <select
                            value={val ?? ''}
                            onChange={(e) => setParam(effectId, ctrl.id, e.target.value)}
                        >
                            {(ctrl.options || []).map((o, i) => {
                                const opt = optionDecode(o);
                                return <option key={i} value={opt.value}>{opt.label}</option>;
                            })}
                        </select>
                    ) : ctrl.type === 'checkbox' ? (
                        <label className="timeline-field-checkbox">
                            <input
                                type="checkbox"
                                checked={!!val}
                                onChange={(e) => setParam(effectId, ctrl.id, e.target.checked)}
                            />
                            <span>{ctrl.label}</span>
                        </label>
                    ) : ctrl.type === 'color' ? (
                        <label className="timeline-field">
                            <input
                                type="color"
                                value={typeof val === 'string' ? val : '#ffffff'}
                                onChange={(e) => setParam(effectId, ctrl.id, e.target.value)}
                            />
                        </label>
                    ) : (
                        <label className="timeline-field">
                            <input
                                type="text"
                                value={val ?? ''}
                                onChange={(e) => setParam(effectId, ctrl.id, e.target.value)}
                            />
                        </label>
                    )}
                </div>
            );
        }
    }
    if (rows.length === 0) return null;

    return (
        <div className="timeline-inspector-section timeline-cue-effect-toggles">
            <div className="timeline-inspector-subhead">Clip effect toggles</div>
            <div className="timeline-inspector-hint">
                Per-clip settings for this track's effects. Curves drive the range sliders only;
                these toggle values are copied with the clip.
            </div>
            {rows}
        </div>
    );
};

/**
 * Inspector panel shown when an automation CLIP is selected. The clip owns its
 * own effect/generator link: one continuous 'range' param is chosen as the
 * "curve drives" target, and every other setting of the effect is stored
 * statically on the clip (`values`) — nothing needs to come from the cue.
 */
const AutoClipPanel = ({ lane, clip, playheadSec }) => {
    const { actions } = useTimeline();
    const def = getLaneEffectDef(clip);
    const genDef = clip?.genId ? getLaneGenDef(clip) : null;
    const ctrl = getLaneParam(clip);
    const genCtrl = getLaneGenParam(clip);
    const isGen = !!genCtrl;
    const isLegacy = !!clip?.targetProperty && !def && !genDef;
    const defObj = def || genDef;
    const automated = ctrl || genCtrl;
    const values = (clip && clip.values) || {};
    const resolved = { ...((defObj && defObj.defaultParams) || {}), ...values };
    const update = (patch) => actions.updateAutoClip(lane.id, clip.id, patch);
    const setValue = (pid, v) => update({ values: { ...values, [pid]: v } });
    const setCurveParam = (pid) => update(isGen ? { genParamId: pid } : { paramId: pid });

    const rangeControls = ((defObj && defObj.paramControls) || []).filter((c) => c.type === 'range');
    const controls = ((defObj && defObj.paramControls) || []).filter((c) => !c.showIf || showIfHolds(c.showIf, resolved));
    const curveValue = automated ? evaluateClipAt(clip, playheadSec ?? 0, laneDefaultValue(clip)) : 0;

    const valueOf = (c) => {
        const v = resolved[c.id];
        if (v != null && v !== '') return v;
        if (typeof c.def === 'number' && isFinite(c.def)) return c.def;
        if (c.type === 'range') return ((c.min ?? 0) + (c.max ?? 1)) / 2;
        return '';
    };

    const renderControl = (c) => {
        const val = valueOf(c);
        if (c.type === 'range') {
            return (
                <label key={c.id} className="timeline-field-range">
                    <span>{c.label} <b>{typeof val === 'number' ? val.toFixed(2) : val}</b></span>
                    <input
                        type="range" min={c.min} max={c.max} step={c.step ?? 'any'}
                        value={typeof val === 'number' ? val : (c.min ?? 0)}
                        onChange={(e) => setValue(c.id, parseFloat(e.target.value))}
                    />
                </label>
            );
        }
        if (c.type === 'select') {
            return (
                <label key={c.id} className="timeline-field">
                    <span>{c.label}</span>
                    <select value={val ?? ''} onChange={(e) => setValue(c.id, e.target.value)}>
                        {(c.options || []).map((o, i) => {
                            const opt = optionDecode(o);
                            return <option key={i} value={opt.value}>{opt.label}</option>;
                        })}
                    </select>
                </label>
            );
        }
        if (c.type === 'checkbox') {
            return (
                <label key={c.id} className="timeline-field-checkbox">
                    <input type="checkbox" checked={!!val} onChange={(e) => setValue(c.id, e.target.checked)} />
                    <span>{c.label}</span>
                </label>
            );
        }
        if (c.type === 'color') {
            return (
                <label key={c.id} className="timeline-field">
                    <span>{c.label}</span>
                    <input
                        type="color"
                        value={typeof val === 'string' ? val : '#ffffff'}
                        onChange={(e) => setValue(c.id, e.target.value)}
                    />
                </label>
            );
        }
        return (
            <label key={c.id} className="timeline-field">
                <span>{c.label}</span>
                <input type="text" value={val ?? ''} onChange={(e) => setValue(c.id, e.target.value)} />
            </label>
        );
    };

    return (
        <div className="timeline-inspector-section timeline-auto-clip-panel">
            <div className="timeline-inspector-subhead">
                {isGen ? 'Generator Automation Clip' : 'Automation Clip'}
            </div>

            {isLegacy ? (
                <>
                    <div className="timeline-lane-info-name">{getLaneTarget(clip.targetProperty).label}</div>
                    <div className="timeline-inspector-hint">Legacy lane — everything on it is curve-driven.</div>
                </>
            ) : defObj ? (
                <>
                    <div className="timeline-lane-info-name">{defObj.name}</div>

                    {rangeControls.length > 0 && (
                        <label className="timeline-field">
                            <span>Curve drives</span>
                            <select
                                value={automated ? automated.id : ''}
                                onChange={(e) => setCurveParam(e.target.value || null)}
                            >
                                <option value="">— none —</option>
                                {rangeControls.map((r) => (
                                    <option key={r.id} value={r.id}>{r.label}</option>
                                ))}
                            </select>
                        </label>
                    )}

                    <div className="timeline-inspector-hint">
                        Every setting below is stored on this clip — pick what the curve drives; the rest are static per clip.
                    </div>

                    {controls.map((c) => {
                        if (automated && automated.id === c.id) {
                            const clamped = typeof curveValue === 'number'
                                ? Math.max(c.min ?? 0, Math.min(c.max ?? 1, curveValue))
                                : (c.min ?? 0);
                            return (
                                <label key={c.id} className="timeline-field-range timeline-auto-clip-autoparam">
                                    <span>{c.label} <b>curve</b></span>
                                    <input
                                        type="range"
                                        min={c.min} max={c.max} step={c.step ?? 'any'}
                                        value={clamped}
                                        disabled
                                    />
                                    <small className="timeline-inspector-hint">
                                        Driven by the automation curve — {typeof curveValue === 'number' ? curveValue.toFixed(3) : '—'} at the playhead
                                    </small>
                                </label>
                            );
                        }
                        return renderControl(c);
                    })}
                </>
            ) : (
                <div className="timeline-inspector-hint">
                    This clip has no target assigned yet. Drag an effect from the library below onto the track to make a new clip.
                </div>
            )}
        </div>
    );
};

/**
 * Inspector panel shown when an automation TRACK (lane) is selected but no
 * single clip is. Since each automation clip owns its own effect, this is a
 * lane-level summary — pick a clip to edit its full settings.
 */
const AutomationLaneInfo = ({ lane }) => {
    const clips = Array.isArray(lane.clips) && lane.clips.length > 0 ? lane.clips : [];
    const effectNames = [...new Set(clips.map((c) => {
        if (!c?.effectId) return null;
        const d = getLaneEffectDef(c);
        return d ? d.name : c.effectId;
    }).filter(Boolean))];
    const genClips = clips.some((c) => c?.genId);
    const isLegacy = !!lane.targetProperty && clips.length === 0
        && (Array.isArray(lane.keyframes) && lane.keyframes.length > 0);

    return (
        <div className="timeline-inspector-section timeline-lane-info">
            <div className="timeline-inspector-subhead">Automation Track</div>

            {isLegacy ? (
                <div className="timeline-inspector-hint">
                    Legacy lane · <b>{getLaneTarget(lane.targetProperty).label}</b> — everything on it is curve-driven.
                </div>
            ) : (
                <>
                    {clips.length === 0 ? (
                        <div className="timeline-inspector-hint">
                            No automation clips yet — drag an effect from the library below onto the track to add one.
                        </div>
                    ) : (
                        <div className="timeline-lane-info-name">
                            {effectNames.length > 0
                                ? effectNames.join(' + ')
                                : (genClips ? 'Generator automation' : `${clips.length} clip${clips.length > 1 ? 's' : ''}`)}
                        </div>
                    )}
                    <div className="timeline-inspector-hint">
                        Select an automation clip to edit its effect settings and choose which parameter its curve drives.
                    </div>
                </>
            )}
        </div>
    );
};

const TimelineInspector = ({ onSeek, previewFrame, playheadSec }) => {
    const { state, actions, dacOutputSettings, updateDacOutputSetting } = useTimeline();
    const selectedIds = state.settings.selectedCueIds || [];
    const cue = state.cues[state.settings.selectedCueId];
    const overlapIds = useMemo(() => getOverlappingCueIds(state), [state]);
    const cueOverlaps = cue ? overlapIds.has(cue.id) : false;
    const multi = selectedIds.length > 1;
    // Automation track selection: a selected keyframe implies its lane, but a
    // lane can also be picked directly via its header (even with no keyframes).
    const selLaneId = state.settings.selectedKeyframe?.laneId ?? state.settings.selectedLaneId;
    const selectedLane = selLaneId ? state.lanes[selLaneId] || null : null;
    // Selected automation CLIP (highest-priority Inspector focus).
    const selAutoClip = state.settings.selectedAutoClip;
    const selClipLane = selAutoClip ? state.lanes[selAutoClip.laneId] || null : null;
    const selectedClip = selClipLane && selAutoClip.clipId
        ? (selClipLane.clips || []).find((c) => c.id === selAutoClip.clipId) || null
        : null;

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

    // Multi-selected automation clips (marquee over several lanes).
    const selAutoClipIds = Array.isArray(state.settings.selectedAutoClipIds) ? state.settings.selectedAutoClipIds : [];
    const multiAutoClips = selAutoClipIds.length > 1;
    const selectedAutoClipsList = multiAutoClips
        ? selAutoClipIds
              .map((sc) => ({ lane: state.lanes[sc.laneId], clip: sc.clipId ? (state.lanes[sc.laneId]?.clips || []).find((c) => c.id === sc.clipId) : null }))
              .filter((x) => x.lane && x.clip)
        : [];
    const removeSelectedClips = () => {
        for (const sc of selAutoClipIds) {
            if (state.lanes?.[sc.laneId]) actions.removeAutoClip(sc.laneId, sc.clipId);
        }
    };

    const channel = cue ? state.channels[cue.channelId] : null;

    // Per-channel DAC "Output" panel: shown when a bare channel is selected
    // (no cue/clip/lane focused) and it is routed to exactly one output. It
    // edits the same per-output settings (dimmer / zoom / zones) the main app's
    // Output Settings window owns, and the timeline fan-out + preview honor them.
    const selChannel = !cue && !multi && !selectedClip && !selClipLane && !selectedLane && !multiAutoClips && !selLaneId
        ? (state.settings.selectedChannelId ? state.channels[state.settings.selectedChannelId] || null : null)
        : null;
    const selOutputs = selChannel ? getChannelOutputs(selChannel) : [];
    const outKey = selOutputs.length === 1 ? `${selOutputs[0].ip}:${selOutputs[0].channel}` : null;
    const outSettings = outKey ? (dacOutputSettings[outKey] || {}) : null;
    const outZoomPct = Math.round(((outSettings && outSettings.outputArea && outSettings.transformationEnabled ? outSettings.outputArea.w : 1) || 1) * 100);

    let summary = null;
    if (multi) {
        const cues = selectedIds.map((id) => state.cues[id]).filter(Boolean);
        const channels = [...new Set(cues.map((c) => getChannelDisplayName(state.channels[c.channelId], dacOutputSettings)).filter(Boolean))];
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
                    className="timeline-btn"
                    onClick={() => actions.trimOverlaps(selectedIds)}
                    title="Cut every selected clip to end where the next clip starts (loop off where looping), so none can shadow another"
                >
                    ✂ Cut Overlaps
                </button>
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

            {multiAutoClips ? (
                <div className="timeline-inspector-section timeline-multi-summary">
                    <div className="timeline-cue-type generator">✧ {selectedAutoClipsList.length} Automation Clips Selected</div>
                    <div className="timeline-inspector-hint">
                        Drag-select boxes can sweep multiple automation lanes at once. Press Delete (not Backspace-in-a-text-field)
                        to remove them all, or click a single clip to edit its settings.
                    </div>
                    <button
                        className="timeline-btn danger"
                        onClick={removeSelectedClips}
                    >
                        Delete {selectedAutoClipsList.length} Clips
                    </button>
                </div>
            ) : (selectedClip && selClipLane
                ? <AutoClipPanel lane={selClipLane} clip={selectedClip} playheadSec={playheadSec} />
                : (selectedLane && <AutomationLaneInfo lane={selectedLane} />))}

            {multi ? summary : !cue ? (
                <p className="timeline-inspector-hint">Select a cue block to edit its properties.</p>
            ) : (
                <>
                    <CueEffectToggles cue={cue} />
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

            {cueOverlaps && (
                <div className="timeline-inspector-hint timeline-overlap-hint">
                    ⚠ This clip overlaps another on its channel — only one plays at a time. Trim its end to the next clip or toggle the Trim editor to stop it.
                </div>
            )}
            <button
                className="timeline-btn"
                onClick={() => actions.trimOverlaps([cue.id])}
                title="Cut this clip to end exactly where the next clip starts (loop off if looping)"
            >
                ✂ Trim to prevent overlap
            </button>

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
                    <div className="timeline-filepath" title={cue.filePath}>{getRelativePath(cue.filePath) || ''}</div>
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
                {channel && <span>Channel: {getChannelDisplayName(channel, dacOutputSettings)}</span>}
                {onSeek && (
                    <button className="timeline-btn" onClick={() => onSeek(cue.startTime)}>▶ Jump to cue</button>
                )}
            </div>

            <button className="timeline-btn danger" onClick={() => { actions.removeCue(cue.id); }}>Delete Cue</button>
                </>
            )}

            {selChannel && outKey && outSettings && (
                <div className="timeline-inspector-section timeline-channel-output">
                    <div className="timeline-inspector-subhead">Output</div>
                    <div className="timeline-inspector-hint">
                        Shared per-output settings — also edited in the main app's Output Settings. Dimmer/zoom/zones below are applied live by this timeline's DAC fan-out and preview.
                    </div>
                    <div className="timeline-field">
                        <span>Dimmer</span>
                        <input
                            type="range" min={0} max={1} step={0.01}
                            value={outSettings.dimmer !== undefined ? outSettings.dimmer : 1}
                            onChange={(e) => updateDacOutputSetting(outKey, { dimmer: parseFloat(e.target.value) })}
                        />
                    </div>
                    <div className="timeline-field">
                        <span>Zoom {outZoomPct}%</span>
                        <input
                            type="range" min={50} max={150} step={1}
                            value={outZoomPct}
                            onChange={(e) => {
                                const p = Math.round(parseInt(e.target.value, 10)) / 100;
                                updateDacOutputSetting(outKey, {
                                    transformationEnabled: true,
                                    outputArea: { x: (1 - p) / 2, y: (1 - p) / 2, w: p, h: p },
                                });
                            }}
                        />
                    </div>
                    <div className="timeline-inspector-hint">
                        Zones: {outSettings.safetyZones && outSettings.safetyZones.length
                            ? `${outSettings.safetyZones.length} safety zone${outSettings.safetyZones.length > 1 ? 's' : ''} active`
                            : 'no safety zones'} — draw/edit them in Output Settings (Scale/Crop + zones); they are honored live here.
                    </div>
                </div>
            )}

            <div className="timeline-inspector-section timeline-effect-library">
                <div className="timeline-inspector-subhead">Automation Effects</div>
                <div className="timeline-inspector-hint">
                    Drag an effect onto an automation track to add an automation clip; select the clip to edit its settings.
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