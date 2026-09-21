import React, { useCallback, useRef } from 'react';
import { useTimeline, getAdjacentCues } from '../../contexts/TimelineContext';
import { timeToPx, pxToTime, snapToGrid } from '../../utils/timelineTime';

/**
 * A single cue block on the timeline. Pointer-based drag (move) and resize via
 * edge handles, with full multi-clip editing:
 *
 *   click             select this block alone
 *   click (selected)  drag the WHOLE selection together
 *   Shift/Ctrl+click  toggle membership (a selected block toggles OFF, no drag)
 *
 * A drag applies the snapped delta of the dragged edge to every selected cue,
 * so the group keeps its relative timing. All math is delta-based and captured
 * at pointer-down, so live re-renders (e.g. the move commands themselves) can
 * never make it "jump".
 *
 * `trimMode` ("Trim" edit, vs "Stretch"): resize edges are clamped to the
 * neighbouring cue's boundary so dragging a clip can never make it overlap the
 * next/previous clip; a looping clip that gets its tail clamped is un-looped
 * (an endless loop can't honor a finite cut). `overlapping` paints the block
 * red — its frame play is silently shadowed by another clip on the channel.
 */
const TimelineBlock = ({ cue, selected, pxPerSecond, snapMode, bpm, fps, trimMode, overlapping }) => {
    const { state, actions } = useTimeline();
    const dragRef = useRef(null);

    // Decide the drag group on pointer-down and capture each member's frozen
    // start/duration. Returns null when there is nothing to drag (e.g. the
    // pointer toggled the anchor block off).
    const buildDrag = useCallback((e, mode) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return null;
        e.preventDefault();
        e.stopPropagation();
        const selIds = state.settings.selectedCueIds || [];
        const mod = e.shiftKey || e.ctrlKey || e.metaKey;
        const wasSelected = selIds.includes(cue.id);
        let ids;
        if (mod && !wasSelected) {
            // Shift/Ctrl+click on an unselected block: add it (and drag it).
            actions.select(cue.id, cue.channelId, { additive: true });
            ids = [...selIds, cue.id];
        } else if (mod) {
            // Shift/Ctrl+click on a selected block: just deselect it.
            actions.select(cue.id, cue.channelId, { additive: true });
            return null;
        } else if (wasSelected) {
            // Plain click on a selected block drags the whole selection.
            ids = selIds;
        } else {
            // Plain click on an unselected block: select it alone.
            actions.select(cue.id, cue.channelId);
            ids = [cue.id];
        }
        const cues = state.cues;
        const notes = ids
            .map((id) => cues[id])
            .filter(Boolean)
            .map((c) => ({ id: c.id, channelId: c.channelId, startTime: c.startTime, duration: c.duration, isLooping: !!c.isLooping }));
        if (notes.length === 0) return null;
        return {
            mode,
            startX: e.clientX,
            notes,
            anchor: { startTime: cue.startTime, duration: cue.duration },
        };
    }, [state, cue, actions]);

    const startDrag = useCallback(
        (e, mode) => {
            const drag = buildDrag(e, mode);
            if (!drag) return;
            dragRef.current = drag;
            try {
                e.currentTarget.setPointerCapture(e.pointerId);
            } catch (_) { /* already released */ }
        },
        [buildDrag]
    );

    const onPointerMove = useCallback(
        (e) => {
            const d = dragRef.current;
            if (!d) return;
            const dx = e.clientX - d.startX;
            const tx = pxToTime(dx, pxPerSecond);
            const ctx = { bpm, fps };
            if (d.mode === 'move') {
                // Snap the dragged block's target, apply that same delta to the
                // whole group so their relative spacing is preserved.
                const delta = snapToGrid(d.anchor.startTime + tx, snapMode, ctx) - d.anchor.startTime;
                for (const n of d.notes) {
                    actions.moveCue(n.id, n.channelId, Math.max(0, n.startTime + delta));
                }
            } else if (d.mode === 'resize-end') {
                const snappedEnd = snapToGrid(d.anchor.startTime + d.anchor.duration + tx, snapMode, ctx);
                const delta = snappedEnd - (d.anchor.startTime + d.anchor.duration);
                // Each clip keeps its own left edge; all right edges shift by
                // the same snapped delta. In Trim mode the edge is clamped so
                // it never passes the start of the next clip on that channel.
                for (const n of d.notes) {
                    let end = Math.max(0.1, n.duration + delta);
                    let clamped = false;
                    if (trimMode) {
                        const { nextStart } = getAdjacentCues(state, n.id);
                        if (nextStart != null && n.startTime + end > nextStart + 1e-6) {
                            end = Math.max(0.1, nextStart - n.startTime);
                            clamped = true;
                        }
                    }
                    if (clamped && n.isLooping) actions.updateCue(n.id, { isLooping: false });
                    actions.resizeCue(n.id, n.startTime, end);
                }
            } else if (d.mode === 'resize-start') {
                const delta = snapToGrid(d.anchor.startTime + tx, snapMode, ctx) - d.anchor.startTime;
                // Each clip keeps its own right edge; all left edges shift by
                // the same snapped delta. In Trim mode the left edge is clamped
                // so it never crosses the previous clip's end on that channel.
                for (const n of d.notes) {
                    let newStart = Math.max(0, n.startTime + delta);
                    if (trimMode) {
                        const { prevEnd } = getAdjacentCues(state, n.id);
                        if (prevEnd != null && newStart < prevEnd - 1e-6) newStart = Math.max(0, prevEnd);
                    }
                    const newDur = Math.max(0.1, n.startTime + n.duration - newStart);
                    actions.resizeCue(n.id, newStart, newDur);
                }
            }
        },
        [pxPerSecond, snapMode, bpm, fps, actions, trimMode, state]
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
            className={`timeline-block ${isIlda ? 'ilda' : 'generator'} ${selected ? 'selected' : ''} ${cue.isLooping ? 'looping' : ''} ${overlapping ? 'overlap' : ''}`}
            style={{ left, width }}
            data-cue-id={cue.id}
            data-channel-id={cue.channelId}
            onPointerDown={(e) => startDrag(e, 'move')}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={(e) => { e.stopPropagation(); actions.select(cue.id, cue.channelId); }}
            title={`${cue.name} · ${cue.startTime.toFixed(2)}s → ${(cue.startTime + cue.duration).toFixed(2)}s${overlapping ? '\n⚠ overlaps another clip — use Trim to prevent' : ''}${trimMode ? '\nTrim mode: resize clamps at neighbouring clips' : ''}`}
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