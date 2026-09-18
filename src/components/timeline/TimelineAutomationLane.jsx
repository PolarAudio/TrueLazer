import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTimeline } from '../../contexts/TimelineContext';
import {
    getLaneTarget,
    laneDefaultValue,
    getLaneEffectDef,
    getLaneParam,
    getLaneGenParam,
    getLaneGenDef,
    evaluateKeyframes,
} from '../../utils/timelineAutomation';
import { effectDefinitions } from '../../utils/effectDefinitions';
import { generatorDefinitions } from '../../utils/generatorDefinitions';
import { timeToPx, snapToGrid } from '../../utils/timelineTime';
import { HEADER_W, AUTO_ROW_H } from './layout';

// Editing ranges the header graph normalizes for LEGACY scalar lanes (y-up in
// 0..1 mapped to vSpan). Effect-linked lanes derive their range from the linked
// parameter's min/max in the main app's effectDefinitions.
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

/** The parameter controls a lane can actually drive: continuous 'range' sliders only. */
function automatableParams(effectId) {
    const def = effectDefinitions.find((d) => d.id === effectId);
    return (def?.paramControls || []).filter((c) => c.type === 'range');
}

/** The animatable (range) controls of a generator definition. */
function generatorRangeParams(genId) {
    const def = generatorDefinitions.find((d) => d.id === genId);
    return (def?.paramControls || []).filter((c) => c.type === 'range');
}

const AutomationHeader = ({ lane, rowH = AUTO_ROW_H }) => {
    const { actions } = useTimeline();
    const isLegacy = !!lane.targetProperty && !lane.effectId && !lane.genId;
    const isGen = !lane.effectId && !lane.targetProperty && !!lane.genId && !!lane.genParamId;
    const target = getLaneTarget(lane.targetProperty);
    const ctrl = getLaneParam(lane);
    const genCtrl = isGen || lane.genId ? getLaneGenParam(lane) : null;
    const genDef = lane.genId ? getLaneGenDef(lane) : null;
    const params = automatableParams(lane.effectId);

    const assignEffect = (effectId) => {
        if (!effectId) {
            actions.updateLane(lane.id, { effectId: null, paramId: null, genId: null, genParamId: null });
            return;
        }
        const first = automatableParams(effectId)[0];
        actions.updateLane(lane.id, {
            effectId,
            paramId: first ? first.id : null,
            genId: null,
            genParamId: null,
        });
    };

    const assignGenParam = (paramId) => {
        if (!paramId) {
            actions.updateLane(lane.id, { genId: null, genParamId: null, effectId: null, paramId: null });
            return;
        }
        actions.updateLane(lane.id, { genParamId: paramId });
    };

    return (
        <div className="timeline-automation-header" style={{ width: HEADER_W, height: rowH }}>
            {isLegacy ? (
                <>
                    <span className="timeline-lane-unit" title={`Legacy lane · ${target.label} · ${target.unit}`}>
                        {target.label} · {target.unit}
                    </span>
                </>
            ) : isGen ? (
                <>
                    <select
                        className="timeline-lane-genparam"
                        value={lane.genParamId || ''}
                        onChange={(e) => assignGenParam(e.target.value)}
                        title={genCtrl
                            ? `Generator param · ${genCtrl.label} · ${genCtrl.min}..${genCtrl.max}`
                            : (lane.genId ? 'Pick a generator parameter to link' : 'No generator param assigned')}
                    >
                        <option value="">— Generator param —</option>
                        {lane.genId && generatorRangeParams(lane.genId).map((g) => (
                            <option key={g.id} value={g.id}>{g.label}</option>
                        ))}
                    </select>
                    <span className="timeline-lane-unit timeline-lane-gentag"
                        title={`Generator automation · ${genDef ? genDef.name : lane.genId}`}>
                        GEN · {genDef ? genDef.name : lane.genId}
                    </span>
                </>
            ) : (
                <>
                    <select
                        className="timeline-lane-effect"
                        value={lane.effectId || ''}
                        onChange={(e) => assignEffect(e.target.value)}
                        title={lane.effectId ? getLaneEffectDef(lane)?.name || lane.effectId : 'No effect assigned'}
                    >
                        <option value="">— No effect —</option>
                        {effectDefinitions.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                    </select>
                    <select
                        className="timeline-lane-param"
                        value={lane.paramId || ''}
                        disabled={!lane.effectId || params.length === 0}
                        onChange={(e) => actions.updateLane(lane.id, { paramId: e.target.value || null })}
                        title={ctrl ? `${ctrl.label} · ${ctrl.min}..${ctrl.max}` : 'Pick a parameter to link'}
                    >
                        <option value="">— Parameter —</option>
                        {params.map((p) => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                    </select>
                </>
            )}
            <button className="timeline-icon-btn danger" title="Remove automation lane"
                onClick={() => actions.removeLane(lane.id)}>✕</button>
        </div>
    );
};

function getLaneRange(lane) {
    const gen = getLaneGenParam(lane);
    if (gen) return { min: gen.min ?? 0, max: gen.max ?? 1 };
    const ctrl = getLaneParam(lane);
    if (ctrl) return { min: ctrl.min ?? 0, max: ctrl.max ?? 2 };
    return RANGES[lane.targetProperty] || { min: 0, max: 2 };
}

const TimelineAutomationLane = ({ lane, gridW, pxPerSecond, snapMode, bpm, fps, rowH = AUTO_ROW_H }) => {
    const { state, actions } = useTimeline();
    const dragRef = useRef(null);
    const tensionRef = useRef(null); // active segment-curve (tension) drag
    const [menu, setMenu] = useState(null); // { x, y, keyframeId } | null
    const selKf = state.settings.selectedKeyframe;
    const selected = !!(selKf && selKf.laneId === lane.id && selKf.keyframeId);
    const selectedId = selected ? selKf.keyframeId : null;
    const hasEffect = !!lane.effectId && !!lane.paramId;
    const isGen = !!lane.genId && !!lane.genParamId && !lane.effectId;
    const isLegacy = !!lane.targetProperty && !lane.effectId && !lane.genId;
    const editable = hasEffect || isLegacy || isGen;
    const range = getLaneRange(lane);
    const vSpan = Math.max(1e-6, range.max - range.min);
    const H = rowH;
    const PAD = 10;
    const innerH = H - PAD * 2;

    const yForValue = useCallback((v) => PAD + (1 - clamp((v - range.min) / vSpan, 0, 1)) * innerH, [PAD, innerH, range, vSpan]);
    const valueForY = useCallback((y) => range.min + (1 - clamp((y - PAD) / innerH, 0, 1)) * vSpan, [PAD, innerH, range, vSpan]);

    // Extend the curve through the empty lane so keyframe spans are visible.
    const laneDuration = (kfs, w, pps) => {
        if (kfs.length < 2) return w / pps;
        return Math.max(kfs[kfs.length - 1].time, w / pps);
    };

    const path = useMemo(() => {
        const kfs = (lane.keyframes || []).slice().sort((a, b) => a.time - b.time);
        const d = laneDuration(kfs, gridW, pxPerSecond);
        if (!kfs.length) return null;
        const parts = [];
        const stepPx = 2;
        const dflt = laneDefaultValue(lane);
        for (let x = 0; x <= gridW + stepPx; x += stepPx) {
            const t = x / pxPerSecond;
            const v = evaluateKeyframes(kfs, t, dflt);
            parts.push(`${x === 0 ? 'M' : 'L'}${x.toFixed(1)},${yForValue(v).toFixed(1)}`);
        }
        return parts.join(' ');
    }, [lane.keyframes, gridW, pxPerSecond, yForValue]);

    const addKeyframe = (e) => {
        // Left-click only — a right-click must never add points (the user asked
        // for right-click to open a context menu / delete instead).
        if (!editable || (e.button !== 0 && e.pointerType === 'mouse')) return;
        actions.selectKeyframe(null, null); // clicking empty lane clears selection
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const t = snapToGrid(x / pxPerSecond, snapMode, { bpm, fps });
        const v = evaluateKeyframes(lane.keyframes, x / pxPerSecond, laneDefaultValue(lane));
        actions.addKeyframe(lane.id, { time: Math.max(0, t), value: clamp(v, range.min, range.max), easing: 'linear' });
    };

    const startDrag = (e, kf) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.closest('.timeline-automation-body').getBoundingClientRect();
        dragRef.current = { id: kf.id, rect, startX: e.clientX, startY: e.clientY, moved: false };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    const onMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        // A real drag (past a few px) deselects the click-to-select path.
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) d.moved = true;
        if (d.moved) {
            const x = e.clientX - d.rect.left;
            const y = e.clientY - d.rect.top;
            const t = Math.max(0, snapToGrid(x / pxPerSecond, snapMode, { bpm, fps }));
            const v = clamp(valueForY(y), range.min, range.max);
            actions.updateKeyframe(lane.id, d.id, { time: t, value: v });
        }
    };

    const endDrag = (e) => {
        const d = dragRef.current;
        // No movement past the threshold → plain click: select the keyframe
        // (Shift/Ctrl toggles, mirroring clip selection).
        if (d && !d.moved) {
            actions.selectKeyframe(lane.id, d.id, e.shiftKey || e.ctrlKey || e.metaKey);
        }
        dragRef.current = null;
        try { e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    // --- Segment tension (curve) handle, FL-Studio style --------------------
    // The handle sits on the straight line between two keyframes. Dragging it
    // up bows the curve (slow start / fast end), dragging it down bows it the
    // other way. The mapping is 1:1 — the handle stays where you put it.
    const startTensionDrag = (e, a, b) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        actions.selectKeyframe(null, null);
        tensionRef.current = {
            keyframeId: a.id,
            aVal: a.value,
            bVal: b.value,
            rect: e.currentTarget.closest('.timeline-automation-body').getBoundingClientRect(),
        };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    const onTensionMove = (e) => {
        const d = tensionRef.current;
        if (!d) return;
        const y = e.clientY - d.rect.top;
        const linearMidY = yForValue((d.aVal + d.bVal) / 2);
        const t = clamp((linearMidY - y) / (innerH / 2), -1, 1);
        // Snap tiny offsets back to linear so the data stays clean.
        actions.updateKeyframe(lane.id, d.keyframeId, { tension: Math.abs(t) < 0.02 ? null : t });
    };

    const endTensionDrag = (e) => {
        tensionRef.current = null;
        try { e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    const remove = (e, kf) => {
        e.preventDefault();
        e.stopPropagation();
        actions.removeKeyframe(lane.id, kf.id);
    };

    const openContextMenu = (e, kf) => {
        e.preventDefault();
        e.stopPropagation();
        // Right-click also selects the point so Delete-key and menu agree.
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
        actions.removeKeyframes(lane.id, (lane.keyframes || []).map((k) => k.id));
        closeMenu();
    };

    const onDrop = (e) => {
        e.preventDefault();
        const genData = e.dataTransfer.getData('application/x-tl-genparam');
        if (genData) {
            try {
                const { genId, paramId } = JSON.parse(genData);
                if (genId && paramId) {
                    actions.updateLane(lane.id, {
                        effectId: null,
                        paramId: null,
                        targetProperty: null,
                        genId,
                        genParamId: paramId,
                    });
                    return;
                }
            } catch (_) { /* malformed payload — ignore */ }
        }
        const effectId = e.dataTransfer.getData('application/x-tl-effect');
        if (!effectId) return;
        const first = automatableParams(effectId)[0];
        actions.updateLane(lane.id, {
            effectId,
            paramId: first ? first.id : null,
            genId: null,
            genParamId: null,
        });
    };
    const onDragOver = (e) => {
        if (e.dataTransfer &&
            (e.dataTransfer.types.includes('application/x-tl-effect') ||
                e.dataTransfer.types.includes('application/x-tl-genparam'))) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'link';
        }
    };

    const kfs = (lane.keyframes || []).slice().sort((a, b) => a.time - b.time);

    return (
        <div className="timeline-row">
            <div className="timeline-header-cell">
                <AutomationHeader lane={lane} rowH={rowH} />
            </div>
            <div
                className="timeline-automation-body"
                style={{ width: gridW, height: rowH }}
                data-channel-id={lane.channelId}
                onPointerDown={addKeyframe}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onContextMenu={(e) => e.preventDefault()} // never let right-click add points
                title={editable
                    ? "Left-click adds a keyframe · drag to move · click a point to select · drag the ◈ between points to curve the segment · right-click a point for easing options · Delete key removes the selection"
                    : "Drop an effect or a generator param from the Inspector, or pick one in the lane header, to link a curve"}
            >
                {editable ? (<>
                    <div className="timeline-auto-mid" style={{ top: H / 2 }} />
                    {lane.keyframes && lane.keyframes.length > 0 && path && (
                        <svg className="timeline-auto-svg" width={gridW} height={H}>
                            <path d={path} fill="none" className="timeline-auto-path" />
                        </svg>
                    )}
                    {kfs.length > 1 && kfs.slice(0, -1).map((a, i) => {
                        const b = kfs[i + 1];
                        if (b.time - a.time < 1e-6) return null;
                        const xMid = (a.time + b.time) / 2;
                        const linearMidY = yForValue((a.value + b.value) / 2);
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
                            style={{ left: timeToPx(kf.time, pxPerSecond) - 6, top: yForValue(kf.value) - 6 }}
                            title={`t=${kf.time.toFixed(2)}s v=${kf.value.toFixed(3)}`}
                            onPointerDown={(e) => startDrag(e, kf)}
                            onPointerMove={onMove}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            onDoubleClick={(e) => remove(e, kf)}
                            onContextMenu={(e) => openContextMenu(e, kf)}
                        />
                    ))}
                </>) : (
                    <div className="timeline-auto-empty" style={{ lineHeight: `${H}px` }}>
                        No effect assigned — drop an effect or generator param from the Inspector
                    </div>
                )}
                {menu && (
                    <>
                        <div
                            className="timeline-kf-menu-backdrop"
                            onPointerDown={(e) => { e.stopPropagation(); closeMenu(); }}
                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); }}
                        />
                        <div className="timeline-kf-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
                            {(() => {
                                const kf = (lane.keyframes || []).find((k) => k.id === menu.keyframeId) || {};
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