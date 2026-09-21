import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTimeline } from '../../contexts/TimelineContext';
import {
    getLaneTarget,
    laneDefaultValue,
    getLaneParam,
    getLaneGenParam,
    evaluateKeyframes,
} from '../../utils/timelineAutomation';
import { effectDefinitions } from '../../utils/effectDefinitions';
import { generatorDefinitions } from '../../utils/generatorDefinitions';
import { timeToPx, snapToGrid, beatDuration } from '../../utils/timelineTime';
import { HEADER_W, AUTO_ROW_H } from './layout';

// Editing ranges the header graph normalizes for LEGACY scalar lanes (y-up in
// 0..1 mapped to vSpan). Effect/gen clips derive their range from the linked
// parameter's min/max in the main app's definitions.
const RANGES = {
    GEOMETRY_SCALE: { min: 0, max: 3 },
    GEOMETRY_ROTATION: { min: -180, max: 180 },
    GEOMETRY_TRANSLATION_X: { min: -2, max: 2 },
    GEOMETRY_TRANSLATION_Y: { min: -2, max: 2 },
    COLOR_MAX_BRIGHTNESS: { min: 0, max: 2 },
    COLOR_RED: { min: 0, max: 2 },
    COLOR_GREEN: { min: 0, max: 2 },
    COLOR_BLUE: { min: 0, max: 2 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Right-click curve presets for a keyframe's OUTGOING segment. Each clears the
// FL-style tension handle so the preset is authoritative. 'hold' is a step.
const EASING_OPTIONS = [
    { id: 'linear', label: 'Linear' },
    { id: 'easeIn', label: 'Ease In' },
    { id: 'easeOut', label: 'Ease Out' },
    { id: 'easeInOut', label: 'Ease In-Out' },
    { id: 'hold', label: 'Hold (step)' },
];

/** The parameter controls an effect can actually drive: continuous 'range' sliders only. */
function automatableParams(effectId) {
    const def = effectDefinitions.find((d) => d.id === effectId);
    return (def?.paramControls || []).filter((c) => c.type === 'range');
}

/** The animatable (range) controls of a generator definition. */
function generatorRangeParams(genId) {
    const def = generatorDefinitions.find((d) => d.id === genId);
    return (def?.paramControls || []).filter((c) => c.type === 'range');
}

/** Short display name for the automation clip's target (effect / generator / legacy). */
function clipLaneLabel(c) {
    if (c?.effectId) {
        const d = effectDefinitions.find((x) => x.id === c.effectId);
        return d ? d.name : c.effectId;
    }
    if (c?.genId) {
        const d = generatorDefinitions.find((x) => x.id === c.genId);
        return `GEN ${d ? d.name : c.genId}`;
    }
    if (c?.targetProperty) return getLaneTarget(c.targetProperty).label;
    return 'Automation';
}

const AutomationHeader = ({ lane, rowH = AUTO_ROW_H }) => {
    const { state, actions } = useTimeline();
    const isSelected = state.settings.selectedLaneId === lane.id
        || (state.settings.selectedKeyframe?.laneId === lane.id)
        || (state.settings.selectedAutoClip?.laneId === lane.id);

    const summary = useMemo(() => {
        const clips = Array.isArray(lane.clips) ? lane.clips : [];
        const names = [...new Set(clips.map(clipLaneLabel).filter((n) => n && n !== 'Automation'))];
        if (names.length > 1) return `${names.slice(0, 2).join(' + ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`;
        if (names.length === 1) return names[0];
        if (clips.length > 0) return `${clips.length} clip${clips.length > 1 ? 's' : ''}`;
        if (!!lane.targetProperty && (Array.isArray(lane.keyframes) && lane.keyframes.length > 0)) {
            return getLaneTarget(lane.targetProperty).label;
        }
        return 'Automation';
    }, [lane]);

    const newClip = () => {
        const bar = beatDuration(state.settings.bpm || 120) * 4;
        actions.addAutoClip(lane.id, { startTime: 0, duration: Math.max(0.5, bar) });
    };

    return (
        <div
            className={`timeline-automation-header${isSelected ? ' selected' : ''}`}
            style={{ width: HEADER_W, height: rowH }}
            onClick={() => actions.selectLane(lane.id)}
            title={isSelected
                ? 'Automation track selected — select a clip to edit its effect settings and linked parameter'
                : 'Automation track — drop an effect or generator param from the Inspector to add a clip · click a clip to select it'}
        >
            <span
                className="timeline-lane-unit"
                title={summary === 'Automation'
                    ? 'This track holds automation clips. Drag an effect from the Inspector onto the grid to add a clip.'
                    : `Clips on this track: ${summary}`}
            >
                {summary}
            </span>
            <div className="timeline-auto-header-buttons">
                <button className="timeline-icon-btn" title="Add an empty automation clip at the track start"
                    onClick={newClip}>+ Clip</button>
                <button className="timeline-icon-btn danger" title="Remove automation lane"
                    onClick={() => actions.removeLane(lane.id)}>✕</button>
            </div>
        </div>
    );
};

function getLaneRange(laneOrClip) {
    const gen = getLaneGenParam(laneOrClip);
    if (gen) return { min: gen.min ?? 0, max: gen.max ?? 1 };
    const ctrl = getLaneParam(laneOrClip);
    if (ctrl) return { min: ctrl.min ?? 0, max: ctrl.max ?? 2 };
    return RANGES[laneOrClip?.targetProperty] || { min: 0, max: 2 };
}

const TimelineAutomationLane = ({ lane, gridW, pxPerSecond, snapMode, bpm, fps, rowH = AUTO_ROW_H }) => {
    const { state, actions } = useTimeline();
    const dragRef = useRef(null); // active keyframe drag
    const tensionRef = useRef(null); // active segment-curve (tension) drag
    const clipDragRef = useRef(null); // active clip move / resize drag
    const [menu, setMenu] = useState(null); // { x, y, keyframeId } | null
    const selKf = state.settings.selectedKeyframe;
    const selClipIds = Array.isArray(state.settings.selectedAutoClipIds) ? state.settings.selectedAutoClipIds : [];
    const isClipSelected = (clipId) => selClipIds.some((sc) => sc && sc.clipId === clipId);
    const selectedId = (selKf && selKf.laneId === lane.id) ? selKf.keyframeId : null;
    const H = rowH;
    const PAD = 10;
    const innerH = H - PAD * 2;

    // Vertical mapping is per-clip: every clip may drive a different parameter
    // with its own min/max, so the whole lane can't share one value scale.
    const mapsFor = useCallback((range) => {
        const vSpan = Math.max(1e-6, range.max - range.min);
        return {
            range,
            vSpan,
            yForValue: (v) => PAD + (1 - clamp((v - range.min) / vSpan, 0, 1)) * innerH,
            valueForY: (y) => range.min + (1 - clamp((y - PAD) / innerH, 0, 1)) * vSpan,
        };
    }, [PAD, innerH]);

    // FL-style model: lanes own short, movable "automation clips", each with its
    // own target (effect/gen/legacy) and clip-relative keyframes. Legacy lanes
    // (a single full-length curve under `keyframes`) are rendered as one
    // synthesized clip spanning the visible grid so every edit gesture works
    // identically on every lane.
    const activeClips = useMemo(() => {
        const clips = Array.isArray(lane.clips) && lane.clips.length > 0
            ? lane.clips.slice().sort((a, b) => a.startTime - b.startTime)
            : null;
        if (clips) return clips;
        const kfs = Array.isArray(lane.keyframes) ? lane.keyframes : [];
        if (kfs.length === 0) return [];
        return [{
            id: null,
            startTime: 0,
            duration: Math.max(0.1, gridW / pxPerSecond),
            keyframes: kfs,
            legacy: true,
            effectId: lane.effectId || null,
            paramId: lane.paramId || null,
            genId: lane.genId || null,
            genParamId: lane.genParamId || null,
            targetProperty: lane.targetProperty || null,
        }];
    }, [lane.clips, lane.keyframes, lane.effectId, lane.paramId, lane.genId, lane.genParamId, lane.targetProperty, gridW, pxPerSecond]);

    /** The owning (clipped) automation clip for a keyframe, or null on legacy lanes. */
    const clipForKf = useCallback((kfId) => {
        const clips = Array.isArray(lane.clips) && lane.clips.length > 0 ? lane.clips : null;
        if (!clips) return null;
        return clips.find((c) => (c.keyframes || []).some((k) => k.id === kfId)) || null;
    }, [lane.clips]);

    const findKf = useCallback((kfId) => {
        for (const c of (Array.isArray(lane.clips) ? lane.clips : [])) {
            const k = (c.keyframes || []).find((x) => x.id === kfId);
            if (k) return k;
        }
        return (lane.keyframes || []).find((x) => x.id === kfId) || null;
    }, [lane.clips, lane.keyframes]);

    // --- Keyframe drag (global times on legacy lanes, clip-relative inside clips)
    const startDrag = (e, kf) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        const clip = clipForKf(kf.id);
        const rect = e.currentTarget.closest('.timeline-automation-body').getBoundingClientRect();
        dragRef.current = {
            id: kf.id,
            clip,
            rect,
            maps: mapsFor(getLaneRange(clip || lane)),
            startX: e.clientX,
            startY: e.clientY,
            moved: false,
        };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    const onMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) d.moved = true;
        if (d.moved) {
            const x = e.clientX - d.rect.left;
            const y = e.clientY - d.rect.top;
            const g = Math.max(0, snapToGrid(x / pxPerSecond, snapMode, { bpm, fps }));
            const t = d.clip ? clamp(g - d.clip.startTime, 0, d.clip.duration) : g;
            const v = clamp(d.maps.valueForY(y), d.maps.range.min, d.maps.range.max);
            actions.updateKeyframe(lane.id, d.id, { time: t, value: v });
        }
    };

    const endDrag = (e) => {
        const d = dragRef.current;
        if (d && !d.moved) {
            actions.selectKeyframe(lane.id, d.id, e.shiftKey || e.ctrlKey || e.metaKey);
        }
        dragRef.current = null;
        try { e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    // --- Segment tension (curve) handle, FL-Studio style --------------------
    const startTensionDrag = (e, a, b) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        actions.selectKeyframe(null, null);
        const clip = clipForKf(a.id);
        tensionRef.current = {
            keyframeId: a.id,
            aVal: a.value,
            bVal: b.value,
            rect: e.currentTarget.closest('.timeline-automation-body').getBoundingClientRect(),
            maps: mapsFor(getLaneRange(clip || lane)),
        };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    const onTensionMove = (e) => {
        const d = tensionRef.current;
        if (!d) return;
        const y = e.clientY - d.rect.top;
        const linearMidY = d.maps.yForValue((d.aVal + d.bVal) / 2);
        const t = clamp((linearMidY - y) / (innerH / 2), -1, 1);
        actions.updateKeyframe(lane.id, d.keyframeId, { tension: Math.abs(t) < 0.02 ? null : t });
    };

    const endTensionDrag = (e) => {
        tensionRef.current = null;
        try { e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    // --- Automation CLIP interaction (FL-style: create / move / trim / delete)
    const addKfInClip = (e, c) => {
        // Left-click anywhere inside a clip adds a point on the clip's curve.
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        // A clip's own gestures must never start a content-level drag-select
        // marquee (the same rule blocks already use).
        e.stopPropagation();
        const rect = e.currentTarget.closest('.timeline-automation-body').getBoundingClientRect();
        const xAbs = e.clientX - rect.left;
        const maps = mapsFor(getLaneRange(c));
        if (c.id == null) {
            // Legacy (synthesized) clip: keyframes are global times.
            const g = Math.max(0, snapToGrid(xAbs / pxPerSecond, snapMode, { bpm, fps }));
            const v = evaluateKeyframes(lane.keyframes, xAbs / pxPerSecond, laneDefaultValue(c));
            actions.addKeyframe(lane.id, { time: g, value: clamp(v, maps.range.min, maps.range.max), easing: 'linear' });
            actions.selectKeyframe(null, null);
            return;
        }
        const relRaw = xAbs / pxPerSecond - c.startTime;
        const rel = clamp(snapToGrid(relRaw, snapMode, { bpm, fps }), 0, c.duration);
        const v = evaluateKeyframes(c.keyframes, Math.max(0, relRaw), laneDefaultValue(c));
        actions.addKeyframe(lane.id, { time: rel, value: clamp(v, maps.range.min, maps.range.max), easing: 'linear' }, c.id);
        actions.selectKeyframe(null, null); // clicking empty clip space clears selection
    };

    const startClipDrag = (e, c, mode) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.closest('.timeline-automation-body').getBoundingClientRect();
        clipDragRef.current = {
            clipId: c.id,
            mode,
            rect,
            startX: e.clientX,
            startTime: c.startTime,
            startDuration: c.duration,
            moved: false,
        };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    const onClipDragMove = (e) => {
        const d = clipDragRef.current;
        if (!d) return;
        if (!d.moved && Math.abs(e.clientX - d.startX) < 4) return;
        d.moved = true;
        if (d.clipId == null) return; // legacy clip can't be moved/trimmed
        const dxT = (e.clientX - d.startX) / pxPerSecond;
        if (d.mode === 'move') {
            const t = Math.max(0, snapToGrid(d.startTime + dxT, snapMode, { bpm, fps }));
            actions.updateAutoClip(lane.id, d.clipId, { startTime: t });
        } else if (d.mode === 'resize-end') {
            const dur = Math.max(0.05, snapToGrid(d.startDuration + dxT, snapMode, { bpm, fps }));
            actions.updateAutoClip(lane.id, d.clipId, { duration: dur });
        } else {
            // resize-start keeps the END fixed.
            const end = d.startTime + d.startDuration;
            let start = Math.max(0, snapToGrid(d.startTime + dxT, snapMode, { bpm, fps }));
            start = Math.min(start, end - 0.05);
            actions.updateAutoClip(lane.id, d.clipId, { startTime: start, duration: end - start });
        }
    };

    const endClipDrag = (e) => {
        const d = clipDragRef.current;
        clipDragRef.current = null;
        try { e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
        if (d && !d.moved && d.mode === 'move' && d.clipId != null) {
            actions.selectAutoClip(lane.id, d.clipId);
        }
    };

    // --- Editing ----------
    const remove = (e, kf) => {
        e.preventDefault();
        e.stopPropagation();
        actions.removeKeyframe(lane.id, kf.id);
    };

    const openContextMenu = (e, kf) => {
        e.preventDefault();
        e.stopPropagation();
        if (!(selectedId === kf.id && e.shiftKey)) actions.selectKeyframe(lane.id, kf.id, false);
        const w = 220;
        setMenu({
            x: Math.max(8, Math.min(e.clientX, window.innerWidth - w - 8)),
            y: Math.max(8, Math.min(e.clientY, window.innerHeight - 280)),
            keyframeId: kf.id,
        });
    };

    const closeMenu = () => setMenu(null);

    const setEasingFromMenu = (id) => {
        actions.updateKeyframe(lane.id, menu.keyframeId, { easing: id, tension: null });
        closeMenu();
    };

    const deleteFromMenu = () => {
        actions.removeKeyframe(lane.id, menu.keyframeId);
        closeMenu();
    };

    const deleteAllFromMenu = () => {
        for (const c of (Array.isArray(lane.clips) ? lane.clips : [])) {
            if ((c.keyframes || []).length) {
                actions.removeKeyframes(lane.id, c.keyframes.map((k) => k.id));
            }
        }
        actions.removeKeyframes(lane.id, (lane.keyframes || []).map((k) => k.id));
        closeMenu();
    };

    const deleteClip = (e, c) => {
        e.preventDefault();
        e.stopPropagation();
        if (c.id != null) actions.removeAutoClip(lane.id, c.id);
    };

    // Dropping an effect / generator param from the Inspector CREATES a new
    // automation clip for that target at the drop position.
    const onDrop = (e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const startTime = Math.max(0, snapToGrid(x / pxPerSecond, snapMode, { bpm, fps }));
        const bar = beatDuration(bpm || 120) * 4;
        const duration = Math.max(0.5, bar);
        const genData = e.dataTransfer.getData('application/x-tl-genparam');
        if (genData) {
            try {
                const { genId, paramId } = JSON.parse(genData);
                if (genId && paramId) {
                    actions.addAutoClip(lane.id, { startTime, duration, genId, genParamId: paramId });
                    return;
                }
            } catch (_) { /* malformed payload — ignore */ }
        }
        const effectId = e.dataTransfer.getData('application/x-tl-effect');
        if (!effectId) return;
        const first = automatableParams(effectId)[0];
        actions.addAutoClip(lane.id, { startTime, duration, effectId, paramId: first ? first.id : null });
    };
    const onDragOver = (e) => {
        if (e.dataTransfer &&
            (e.dataTransfer.types.includes('application/x-tl-effect') ||
                e.dataTransfer.types.includes('application/x-tl-genparam'))) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'link';
        }
    };

    const clipBodyPath = (c) => {
        const cw = Math.max(0, timeToPx(c.duration, pxPerSecond));
        if (cw < 10) return null;
        const kfs = (c.keyframes || []).slice().sort((a, b) => a.time - b.time);
        if (kfs.length === 0) return null;
        const dflt = laneDefaultValue(c);
        const maps = mapsFor(getLaneRange(c));
        const stepPx = 2;
        const parts = [];
        for (let x = 0; x <= cw + stepPx; x += stepPx) {
            const t = x / pxPerSecond;
            const v = evaluateKeyframes(kfs, t, dflt);
            parts.push(`${x === 0 ? 'M' : 'L'}${x.toFixed(1)},${maps.yForValue(v).toFixed(1)}`);
        }
        return parts.join(' ');
    };

    return (
        <div className="timeline-row">
            <div className="timeline-header-cell">
                <AutomationHeader lane={lane} rowH={rowH} />
            </div>
            <div
                className="timeline-automation-body"
                style={{ width: gridW, height: rowH }}
                data-channel-id={lane.channelId}
                data-lane-id={lane.id}
                onPointerDown={() => actions.selectAutoClip(null)}
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const g = Math.max(0, snapToGrid((e.clientX - rect.left) / pxPerSecond, snapMode, { bpm, fps }));
                    const bar = beatDuration(bpm || 120) * 4;
                    actions.addAutoClip(lane.id, { startTime: g, duration: Math.max(0.5, bar) });
                }}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onContextMenu={(e) => e.preventDefault()} // never let right-click add points
                title="Drop an effect or generator param from the Inspector to add an automation clip · double-click the grid for an empty clip · click inside a clip to add a keyframe · drag a clip's top bar to move it · drag the edges to trim · right-click a point for easing options · right-click a clip to delete it"
            >
                {activeClips.length === 0 ? (
                    <div className="timeline-auto-empty" style={{ lineHeight: `${H}px` }}>
                        No automation yet — drag an effect or generator param from the Inspector here, or double-click the grid
                    </div>
                ) : (activeClips.map((c) => {
                    const clipW = Math.max(0, timeToPx(c.duration, pxPerSecond));
                    const isSel = c.id != null && isClipSelected(c.id);
                    const kfs = (c.keyframes || []).slice().sort((a, b) => a.time - b.time);
                    const cMaps = mapsFor(getLaneRange(c));
                    const path = clipBodyPath(c);
                    return (
                        <div
                            key={c.id || lane.id}
                            className={`timeline-auto-clip${isSel ? ' selected' : ''}${c.legacy ? ' legacy' : ''}`}
                            style={{ left: timeToPx(c.startTime, pxPerSecond), width: clipW }}
                            data-auto-clip-id={c.id}
                            onPointerDown={(e) => addKfInClip(e, c)}
                            onDoubleClick={(e) => e.stopPropagation()}
                            onContextMenu={(e) => deleteClip(e, c)}
                        >
                            <div className="timeline-auto-mid" style={{ top: H / 2 }} />
                            {path && (
                                <svg className="timeline-auto-svg" width={clipW} height={H}>
                                    <path d={path} fill="none" className="timeline-auto-path" />
                                </svg>
                            )}
                            {c.id != null && (
                                <div
                                    className="timeline-auto-clip-grip"
                                    title={isSel ? 'Drag to move the clip · Delete key removes it' : 'Click to select the clip · drag to move it'}
                                    onPointerDown={(e) => startClipDrag(e, c, 'move')}
                                    onPointerMove={onClipDragMove}
                                    onPointerUp={endClipDrag}
                                    onPointerCancel={endClipDrag}
                                    onContextMenu={(e) => deleteClip(e, c)}
                                >
                                    <span className="timeline-auto-clip-label">{clipLaneLabel(c)}</span>
                                </div>
                            )}
                            {c.id != null && clipW >= 8 && (
                                <>
                                    <div
                                        className="timeline-auto-clip-resize left"
                                        title="Drag to trim the clip start"
                                        onPointerDown={(e) => startClipDrag(e, c, 'resize-start')}
                                        onPointerMove={onClipDragMove}
                                        onPointerUp={endClipDrag}
                                        onPointerCancel={endClipDrag}
                                    />
                                    <div
                                        className="timeline-auto-clip-resize right"
                                        title="Drag to extend/trim the clip end"
                                        onPointerDown={(e) => startClipDrag(e, c, 'resize-end')}
                                        onPointerMove={onClipDragMove}
                                        onPointerUp={endClipDrag}
                                        onPointerCancel={endClipDrag}
                                    />
                                </>
                            )}
                            {kfs.length > 1 && kfs.slice(0, -1).map((a, i) => {
                                const b = kfs[i + 1];
                                if (b.time - a.time < 1e-6) return null;
                                const xMid = (a.time + b.time) / 2;
                                const linearMidY = cMaps.yForValue((a.value + b.value) / 2);
                                const tension = typeof a.tension === 'number' && isFinite(a.tension)
                                    ? clamp(a.tension, -1, 1) : 0;
                                const y = linearMidY - tension * (innerH / 2);
                                return (
                                    <div
                                        key={`th${a.id}`}
                                        className={`timeline-auto-tension ${tension !== 0 ? 'active' : ''}`}
                                        style={{ left: timeToPx(xMid, pxPerSecond) - 5, top: y - 5 }}
                                        title={`Curve handle — drag up/down to bow this segment (now ${tension === 0 ? 'linear' : `tension ${tension.toFixed(2)}`})`}
                                        onPointerDown={(e) => startTensionDrag(e, a, b)}
                                        onPointerMove={onTensionMove}
                                        onPointerUp={endTensionDrag}
                                        onPointerCancel={endTensionDrag}
                                    />
                                );
                            })}
                            {kfs.map((kf) => (
                                <div
                                    key={kf.id}
                                    className={`timeline-auto-keyframe ${selectedId === kf.id ? 'selected' : ''}`}
                                    style={{ left: timeToPx(kf.time, pxPerSecond) - 6, top: cMaps.yForValue(kf.value) - 6 }}
                                    title={`t=${kf.time.toFixed(2)}s v=${kf.value.toFixed(3)}`}
                                    onPointerDown={(e) => startDrag(e, kf)}
                                    onPointerMove={onMove}
                                    onPointerUp={endDrag}
                                    onPointerCancel={endDrag}
                                    onDoubleClick={(e) => remove(e, kf)}
                                    onContextMenu={(e) => openContextMenu(e, kf)}
                                />
                            ))}
                        </div>
                    );
                }))}
                {menu && (
                    <>
                        <div
                            className="timeline-kf-menu-backdrop"
                            onPointerDown={(e) => { e.stopPropagation(); closeMenu(); }}
                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); }}
                        />
                        <div className="timeline-kf-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
                            {(() => {
                                const kf = findKf(menu.keyframeId) || {};
                                const curved = typeof kf.tension === 'number' && isFinite(kf.tension) ? 'tension' : null;
                                const cur = curved || kf.easing || 'linear';
                                return (
                                    <>
                                        <div className="timeline-kf-menu-label">Curve · outgoing segment</div>
                                        {EASING_OPTIONS.map((opt) => {
                                            const active = opt.id === 'linear' ? cur === 'linear' : cur === opt.id;
                                            return (
                                                <button
                                                    key={opt.id}
                                                    className={`timeline-kf-menu-item${active ? ' active' : ''}`}
                                                    onClick={() => setEasingFromMenu(opt.id)}
                                                >
                                                    {opt.label}
                                                </button>
                                            );
                                        })}
                                        {curved && (
                                            <div className="timeline-kf-menu-hint">
                                                Custom curve — drag the <span className="timeline-kf-menu-handle">◈</span> handle between points
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                            <div className="timeline-kf-menu-sep" />
                            <button className="timeline-kf-menu-item" onClick={deleteFromMenu}>Delete keyframe</button>
                            <button className="timeline-kf-menu-item" onClick={deleteAllFromMenu}>Delete all keyframes on lane</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default TimelineAutomationLane;