import { useCallback, useEffect, useRef } from 'react';
import { BLOCK_ROW_H, AUTO_ROW_H, ZOOM_MIN, ZOOM_MAX } from '../components/timeline/layout';

/**
 * Keyboard + wheel shortcuts for the Timeline window. Attached to the grid
 * scroll element so gestures feel local:
 *
 *   Space            play / pause
 *   Ctrl+C/X/V       copy / cut / paste the selected cue (paste at playhead,
 *                    onto the currently selected track if any)
 *   Ctrl+S           save timeline project (save-as first time)
 *   Ctrl+N           new timeline project
 *   Ctrl+Z           undo   |   Ctrl+Shift+Z  redo
 *   Alt+wheel        vertical zoom (block / automation row heights)
 *   Ctrl+wheel       horizontal zoom (px per second)
 *   Shift+wheel      over a cue → move it by one frame
 *                    over a track header → reorder the channel
 *   wheel            drag the timeline horizontally
 */
const isEditingTarget = (t) =>
    t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Decide which channel a pasted clip lands on: the currently selected track,
 * then the clip's original track, then the first track.
 */
export function pickPasteChannel(channels, channelOrder, selectedChannelId, clip) {
    if (selectedChannelId && channels[selectedChannelId]) return selectedChannelId;
    if (clip?.channelId && channels[clip.channelId]) return clip.channelId;
    return (channelOrder && channelOrder[0]) || null;
}

export function useTimelineShortcuts({ scrollRef, state, actions, pb }) {
    const s = state.settings;

    // Keep the latest values for the stable listeners.
    const stateRef = useRef(state);
    stateRef.current = state;
    const actionsRef = useRef(actions);
    actionsRef.current = actions;
    const pbRef = useRef(pb);
    pbRef.current = pb;

    const clipboardRef = useRef(null);

    /* -------- keyboard -------------------------------------------------- */
    useEffect(() => {
        const onKey = (e) => {
            if (isEditingTarget(e.target)) return;
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();

            if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                if (pbRef.current.isPlaying) pbRef.current.pause();
                else pbRef.current.play();
                return;
            }

            if (!mod) return;

            if (key === 'z') {
                e.preventDefault();
                if (e.shiftKey) actionsRef.current.redo();
                else actionsRef.current.undo();
                return;
            }

            const cueId = stateRef.current.settings.selectedCueId;
            const cue = cueId ? stateRef.current.cues[cueId] : null;

            if (key === 'c' && cue) {
                e.preventDefault();
                clipboardRef.current = { ...cue };
                return;
            }
            if (key === 'x' && cue) {
                e.preventDefault();
                // Cut: remember the cue (with its original channel) first.
                clipboardRef.current = { ...cue };
                actionsRef.current.removeCue(cue.id);
                return;
            }
            if (key === 'v') {
                const clip = clipboardRef.current;
                if (!clip) return;
                e.preventDefault();
                const s = stateRef.current;
                const targetChannel = pickPasteChannel(
                    s.channels,
                    s.channelOrder,
                    s.settings.selectedChannelId,
                    clip
                );
                if (targetChannel) {
                    actionsRef.current.addCue(targetChannel, {
                        type: clip.type,
                        name: clip.name,
                        filePath: clip.filePath || null,
                        fileName: clip.fileName || null,
                        generatorId: clip.generatorId || null,
                        duration: clip.duration,
                        startTime: Math.max(0, pbRef.current.playheadSec),
                    });
                }
                return;
            }
            if (key === 's') {
                e.preventDefault();
                actionsRef.current.saveProject();
                return;
            }
            if (key === 'n') {
                e.preventDefault();
                if (window.confirm('Start a new timeline project?')) {
                    actionsRef.current.newProject();
                }
                return;
            }
            if (key === 'o') {
                e.preventDefault();
                actionsRef.current.openProject();
                return;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    /* -------- wheel ------------------------------------------------------ */
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const onWheel = (e) => {
            const settings = stateRef.current.settings;

            // Vertical zoom: resize block + automation row heights.
            if (e.altKey) {
                e.preventDefault();
                actionsRef.current.setSettings({
                    blockRowH: clamp((settings.blockRowH || BLOCK_ROW_H) + e.deltaY * 0.06, 84, 200),
                    autoRowH: clamp((settings.autoRowH || AUTO_ROW_H) + e.deltaY * 0.06, 30, 220),
                });
                return;
            }

            // Horizontal zoom around the pointer.
            if (e.ctrlKey) {
                e.preventDefault();
                const factor = Math.pow(1.0015, -e.deltaY);
                const z = clamp((settings.zoom || 50) * factor, ZOOM_MIN, ZOOM_MAX);
                actionsRef.current.setSettings({ zoom: z });
                return;
            }

            // Shift+wheel: cue nudge by a frame, or channel reorder on headers.
            if (e.shiftKey) {
                const target = e.target && e.target.closest ? e.target.closest('[data-cue-id], [data-channel-id]') : null;
                if (target) {
                    const cueId = target.getAttribute('data-cue-id');
                    if (cueId) {
                        e.preventDefault();
                        const cue = stateRef.current.cues[cueId];
                        if (cue) {
                            const fps = settings.fps || 30;
                            const dt = e.deltaY > 0 ? 1 / fps : -1 / fps;
                            actionsRef.current.moveCue(cue.id, cue.channelId, Math.max(0, cue.startTime + dt));
                        }
                        return;
                    }
                    const channelId = target.getAttribute('data-channel-id');
                    if (channelId) {
                        e.preventDefault();
                        actionsRef.current.moveChannel(channelId, e.deltaY > 0 ? 1 : -1);
                        return;
                    }
                }
            }

            // Plain wheel: horizontal drag-scroll (keep the vertical bar quiet).
            e.preventDefault();
            el.scrollLeft += e.deltaY + e.deltaX;
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [scrollRef]);

    return { clipboardRef };
}