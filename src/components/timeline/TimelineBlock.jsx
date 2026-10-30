import { useTranslation } from '../../i18n';
import React, { useCallback, useMemo, useRef } from 'react';
import { useTimeline, getAdjacentCues } from '../../contexts/TimelineContext';
import { timeToPx, pxToTime, snapToGrid } from '../../utils/timelineTime';
import { clipBlockStyle } from '../../utils/timelineClipColor';

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
 * `trimMode` (t('ui.trim') edit, vs "Stretch"): resize edges are clamped to the
 * neighbouring cue's boundary so dragging a clip can never make it overlap the
 * next/previous clip; a looping clip that gets its tail clamped is un-looped
 * (an endless loop can't honor a finite cut). `overlapping` paints the block
 * red — its frame play is silently shadowed by another clip on the channel.
 */
const TimelineBlock = ({
    cue, selected, pxPerSecond, snapMode, bpm, fps, trimMode, overlapping }) => {
    const { t } = useTranslation();
    const { state, actions } = useTimeline();
    const dragRef = useRef(null);

    // Decide the drag group on pointer-down and capture each member's frozen
    // start/duration. Returns null when there is nothing to drag (e.g. the
    // pointer toggled the anchor block off). When the dragged block is part of
    // the current selection, the group carries BOTH the selected cues AND the
    // selected automation clips (mixed marquee) so the two kinds edit together.
    const buildDrag = useCallback((e, mode) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return null;
        e.preventDefault();
        e.stopPropagation();
        const selIds = state.settings.selectedCueIds || [];
        const selClips = state.settings.selectedAutoClipIds || [];
        const mod = e.shiftKey || e.ctrlKey || e.metaKey;
        const wasSelected = selIds.includes(cue.id);
        let ids;
        let includeSelectedClips = false;
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
            includeSelectedClips = true;
        } else {
            // Plain click on an unselected block: select it alone.
            actions.select(cue.id, cue.channelId);
            ids = [cue.id];
        }
        const cues = state.cues;
        const notes = ids
            .map((id) => cues[id])
            .filter(Boolean)
            .map((c) => ({ kind: 'cue', id: c.id, channelId: c.channelId, startTime: c.startTime, duration: c.duration, isLooping: !!c.isLooping, totalFrames: c.totalFrames || 0, frameStart: c.frameStart || 0, frameCount: c.frameCount ?? null }));
        if (includeSelectedClips) {
            for (const sc of Array.isArray(selClips) ? selClips : []) {
                if (!sc || !sc.clipId) continue;
                const cl = state.lanes?.[sc.laneId];
                const clip = cl && (cl.clips || []).find((x) => x.id === sc.clipId);
                if (clip) {
                    notes.push({ kind: 'clip', laneId: sc.laneId, clipId: clip.id, startTime: clip.startTime, duration: clip.duration });
                }
            }
        }
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
                    if (n.kind === 'clip') {
                        actions.updateAutoClip(n.laneId, n.clipId, { startTime: Math.max(0, n.startTime + delta) });
                    } else {
                        actions.moveCue(n.id, n.channelId, Math.max(0, n.startTime + delta));
                    }
                }
            } else if (d.mode === 'resize-end') {
                const snappedEnd = snapToGrid(d.anchor.startTime + d.anchor.duration + tx, snapMode, ctx);
                const delta = snappedEnd - (d.anchor.startTime + d.anchor.duration);
                // Each member keeps its own left edge; all right edges shift by
                // the same snapped delta. In Trim mode cue edges are clamped so
                // they never pass the start of the next clip on that channel.
                for (const n of d.notes) {
                    if (n.kind === 'clip') {
                        const nextDur = Math.max(0.05, n.duration + delta);
                        actions.updateAutoClip(n.laneId, n.clipId, trimMode ? { duration: nextDur, trim: true } : { duration: nextDur });
                        continue;
                    }
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
                    actions.resizeCue(n.id, n.startTime, end, trimMode ? { trim: n } : undefined);
                }
            } else if (d.mode === 'resize-start') {
                const delta = snapToGrid(d.anchor.startTime + tx, snapMode, ctx) - d.anchor.startTime;
                // Each member keeps its own right edge; all left edges shift by
                // the same snapped delta. In Trim mode cue edges are clamped so
                // they never cross the previous clip's end on that channel.
                for (const n of d.notes) {
                    if (n.kind === 'clip') {
                        const nextStart = Math.min(Math.max(0, n.startTime + delta), n.startTime + n.duration - 0.05);
                        const nextDur = Math.max(0.05, n.startTime + n.duration - nextStart);
                        actions.updateAutoClip(n.laneId, n.clipId, trimMode
                            ? { startTime: nextStart, duration: nextDur, trim: true }
                            : { startTime: nextStart, duration: nextDur });
                        continue;
                    }
                    let newStart = Math.max(0, n.startTime + delta);
                    if (trimMode) {
                        const { prevEnd } = getAdjacentCues(state, n.id);
                        if (prevEnd != null && newStart < prevEnd - 1e-6) newStart = Math.max(0, prevEnd);
                    }
                    const newDur = Math.max(0.1, n.startTime + n.duration - newStart);
                    actions.resizeCue(n.id, newStart, newDur, trimMode ? { trim: n } : undefined);
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

    // Null unless the user picked a colour, so an uncoloured clip keeps the CSS
    // default for its type. The overlap stripes live on ::before precisely so
    // they layer over this instead of replacing it.
    const colorStyle = useMemo(() => clipBlockStyle(cue), [cue.color]);

    return (
        <div
            className={`timeline-block ${isIlda ? 'ilda' : 'generator'} ${selected ? 'selected' : ''} ${cue.isLooping ? 'looping' : ''} ${overlapping ? 'overlap' : ''} ${cue.color ? 'custom-color' : ''} ${cue.muted ? 'muted' : ''}`}
            style={colorStyle ? { left, width, ...colorStyle } : { left, width }}
            data-cue-id={cue.id}
            data-channel-id={cue.channelId}
            onPointerDown={(e) => startDrag(e, 'move')}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={(e) => { e.stopPropagation(); actions.select(cue.id, cue.channelId); }}
            title={`${cue.name} · ${cue.startTime.toFixed(2)}s → ${(cue.startTime + cue.duration).toFixed(2)}s${cue.muted ? '\nMuted' : ''}${overlapping ? '\n⚠ overlaps another clip — use Trim to prevent' : ''}${trimMode ? '\nTrim mode: resize clamps at neighbouring clips' : ''}`}
        >
            <div className="timeline-block-icon">{isIlda ? '◈' : '✦'}</div>
            <div className="timeline-block-name">{cue.name}</div>
            <button
                className={`timeline-clip-mute${cue.muted ? ' active' : ''}`}
                title={cue.muted ? 'Show clip (H)' : 'Hide clip (H)'}
                onPointerDown={(e) => { e.stopPropagation(); }}
                onClick={(e) => { e.stopPropagation(); actions.updateCue(cue.id, { muted: !cue.muted }); }}
            >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    {cue.muted
                        ? <><path d="M10.477 11.04a5 5 0 0 1-6.517-6.517L2.08 2.64a.75.75 0 1 1 1.06-1.06l10.22 10.22a.75.75 0 1 1-1.06 1.06l-1.823-1.82ZM4.27 5.33l1.2 1.2A3 3 0 0 0 8 11c.34 0 .666-.056.97-.16l1.16 1.16A4.5 4.5 0 0 1 4.27 5.33Zm7.33 4.67-1.24-1.24A3 3 0 0 0 7 6.37l-1.24-1.24A4.5 4.5 0 0 1 11.6 10Zm-4.5-6.5a5 5 0 0 1 3.48 1.4l-1.06 1.06a3.5 3.5 0 0 0-4.42.42l-1.06-1.06A5 5 0 0 1 7.1 3.5Z"/></>
                        : <><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Zm6.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-1.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/></>
                    }
                </svg>
            </button>
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