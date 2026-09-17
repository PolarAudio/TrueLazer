import React, { useCallback, useRef } from 'react';
import { useTimeline } from '../../contexts/TimelineContext';
import { timeToPx, pxToTime, snapToGrid, snapDuration } from '../../utils/timelineTime';

/**
 * A single cue block on the timeline. Pointer-based drag (move) and resize via
 * edge handles. All math is delta-based so live re-renders never make the
 * dragged block "jump".
 */
const TimelineBlock = ({ cue, selected, pxPerSecond, snapMode, bpm, fps }) => {
    const { actions } = useTimeline();
    const dragRef = useRef(null);

    const startDrag = useCallback(
        (e, mode) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            e.preventDefault();
            e.stopPropagation();
            dragRef.current = {
                mode,
                startX: e.clientX,
                startTime: cue.startTime,
                startDur: cue.duration,
            };
            actions.select(cue.id, cue.channelId);
            try {
                e.currentTarget.setPointerCapture(e.pointerId);
            } catch (_) { /* already released */ }
        },
        [cue, actions]
    );

    const onPointerMove = useCallback(
        (e) => {
            const d = dragRef.current;
            if (!d) return;
            const dx = e.clientX - d.startX;
            const ctx = { bpm, fps };
            if (d.mode === 'move') {
                const t = snapToGrid(d.startTime + pxToTime(dx, pxPerSecond), snapMode, ctx);
                actions.moveCue(cue.id, cue.channelId, Math.max(0, t));
            } else if (d.mode === 'resize-end') {
                const endT = d.startTime + d.startDur + pxToTime(dx, pxPerSecond);
                const snapped = snapDuration(d.startTime, endT, snapMode, ctx);
                actions.resizeCue(cue.id, snapped.startTime, snapped.duration);
            } else if (d.mode === 'resize-start') {
                const newStart = snapToGrid(d.startTime + pxToTime(dx, pxPerSecond), snapMode, ctx);
                const newDur = Math.max(0.1, d.startTime + d.startDur - newStart);
                actions.resizeCue(cue.id, newStart, newDur);
            }
        },
        [cue, pxPerSecond, snapMode, bpm, fps, actions]
    );

    const endDrag = useCallback((e) => {
        dragRef.current = null;
        try {
            e.currentTarget.releasePointerCapture && e.currentTarget.releasePointerCapture(e.pointerId);
        } catch (_) { /* not captured */ }
    }, []);

    const left = timeToPx(cue.startTime, pxPerSecond);
    const width = Math.max(6, timeToPx(cue.duration, pxPerSecond));
    const isIlda = cue.type === 'ILDA';

    return (
        <div
            className={`timeline-block ${isIlda ? 'ilda' : 'generator'} ${selected ? 'selected' : ''} ${cue.isLooping ? 'looping' : ''}`}
            style={{ left, width }}
            data-cue-id={cue.id}
            data-channel-id={cue.channelId}
            onPointerDown={(e) => startDrag(e, 'move')}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={(e) => { e.stopPropagation(); actions.select(cue.id, cue.channelId); }}
            title={`${cue.name} · ${cue.startTime.toFixed(2)}s → ${(cue.startTime + cue.duration).toFixed(2)}s`}
        >
            <div className="timeline-block-icon">{isIlda ? '◈' : '✦'}</div>
            <div className="timeline-block-name">{cue.name}</div>
            <div
                className="timeline-block-handle left"
                onPointerDown={(e) => startDrag(e, 'resize-start')}
            />
            <div
                className="timeline-block-handle right"
                onPointerDown={(e) => startDrag(e, 'resize-end')}
            />
        </div>
    );
};

export default TimelineBlock;