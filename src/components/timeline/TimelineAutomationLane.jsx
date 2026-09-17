import React, { useCallback, useMemo, useRef } from 'react';
import { useTimeline } from '../../contexts/TimelineContext';
import { getLaneTarget, LANE_TARGETS, evaluateKeyframes } from '../../utils/timelineAutomation';
import { timeToPx, snapToGrid } from '../../utils/timelineTime';
import { HEADER_W, AUTO_ROW_H } from './layout';

// Editing ranges the header graph normalizes to (y-up in 0..1 mapped to vSpan).
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

const AutomationHeader = ({ lane, rowH = AUTO_ROW_H }) => {
    const { actions } = useTimeline();
    const target = getLaneTarget(lane.targetProperty);
    return (
        <div className="timeline-automation-header" style={{ width: HEADER_W, height: rowH }}>
            <select
                className="timeline-lane-target"
                value={lane.targetProperty}
                onChange={(e) => actions.updateLane(lane.id, { targetProperty: e.target.value })}
                title={target.label}
            >
{getLaneTargets().map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                ))}
            </select>
            <span className="timeline-lane-unit">{target.label} · {target.unit}</span>
            <button className="timeline-icon-btn danger" title="Remove automation lane"
                onClick={() => actions.removeLane(lane.id)}>✕</button>
        </div>
    );
}

function getLaneTargets() {
    return LANE_TARGETS;
}

const TimelineAutomationLane = ({ lane, gridW, pxPerSecond, snapMode, bpm, fps, rowH = AUTO_ROW_H }) => {
    const { actions } = useTimeline();
    const dragRef = useRef(null);
    const target = getLaneTarget(lane.targetProperty);
    const range = RANGES[lane.targetProperty] || { min: 0, max: 2 };
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
        for (let x = 0; x <= gridW + stepPx; x += stepPx) {
            const t = x / pxPerSecond;
            const v = evaluateKeyframes(kfs, t, target.defaultValue);
            parts.push(`${x === 0 ? 'M' : 'L'}${x.toFixed(1)},${yForValue(v).toFixed(1)}`);
        }
        return parts.join(' ');
    }, [lane.keyframes, gridW, pxPerSecond, target.defaultValue, yForValue]);

    const addKeyframe = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const t = snapToGrid(x / pxPerSecond, snapMode, { bpm, fps });
        const v = evaluateKeyframes(lane.keyframes, x / pxPerSecond, target.defaultValue);
        actions.addKeyframe(lane.id, { time: Math.max(0, t), value: v, easing: 'linear' });
    };

    const startDrag = (e, kf) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.closest('.timeline-automation-body').getBoundingClientRect();
        dragRef.current = { id: kf.id, rect };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    const onMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        const x = e.clientX - d.rect.left;
        const y = e.clientY - d.rect.top;
        const t = Math.max(0, snapToGrid(x / pxPerSecond, snapMode, { bpm, fps }));
        const v = valueForY(y);
        actions.updateKeyframe(lane.id, d.id, { time: t, value: v });
    };

    const endDrag = (e) => {
        dragRef.current = null;
        try { e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };

    const remove = (e, kf) => {
        e.preventDefault();
        e.stopPropagation();
        actions.removeKeyframe(lane.id, kf.id);
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
                title="Click to add a keyframe · drag to move · double-click a key to delete"
            >
                <div className="timeline-auto-mid" style={{ top: H / 2 }} />
                {lane.keyframes && lane.keyframes.length > 0 && path && (
                    <svg className="timeline-auto-svg" width={gridW} height={H}>
                        <path d={path} fill="none" className="timeline-auto-path" />
                    </svg>
                )}
                {kfs.map((kf) => (
                    <div
                        key={kf.id}
                        className="timeline-auto-keyframe"
                        style={{ left: timeToPx(kf.time, pxPerSecond) - 6, top: yForValue(kf.value) - 6 }}
                        title={`t=${kf.time.toFixed(2)}s v=${kf.value.toFixed(3)}`}
                        onPointerDown={(e) => startDrag(e, kf)}
                        onPointerMove={onMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onDoubleClick={(e) => remove(e, kf)}
                    />
                ))}
            </div>
        </div>
    );
};

export default TimelineAutomationLane;