import { useCallback, useEffect, useRef } from 'react';
import { BLOCK_ROW_H, AUTO_ROW_H, ZOOM_MIN, ZOOM_MAX } from '../components/timeline/layout';
import {
    beatDuration,
    clipBoundaries,
    nextBoundary,
    prevBoundary,
    nextGridTime,
    prevGridTime,
} from '../utils/timelineTime';

/**
 * Keyboard + wheel shortcuts for the Timeline window. Attached to the scroll
 * element so wheel gestures feel local (keyboard on window):
 *
 *   Space            play / pause (play replays from the anchor position;
 *                    pause returns the playhead to the anchor)
 *   Arrow            move the playhead (frame head) — Left/Right ±1 frame
 *   Shift+Arrow      jump to the previous/next beat-grid line
 *   Ctrl/Cmd+Arrow   jump to the previous/next clip start/end boundary
 *   Ctrl+C/X/V       copy / cut / paste the selected cue or automation clip
 *                    (paste at playhead, onto the currently selected track if any)
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
 * Arrow-key seek target. Returns the new playhead time given the key state.
 *
 *   plain arrow      nudge the playhead by one frame (1 / fps)
 *
 * All four arrows do the same so the playhead (a point in time) never changes
 * row. Shift (beat grid) and Ctrl/Cmd (clip boundaries) are handled by the
 * caller, which needs the timeline state.
 */
export function computeArrowSeek(key, { fps = 30, playhead }) {
    const frame = 1 / Math.max(1, fps || 30);
    const fwd = key === 'arrowright' || key === 'arrowdown';
    return fwd ? playhead + frame : Math.max(0, playhead - frame);
}

/**
 * Spacebar play/pause. Pressing play restarts from the replay anchor — the
 * last place the playhead was parked on the ruler (defaults to the timeline
 * start) — instead of resuming from wherever the head was left. The transport
 * also returns the head to that same anchor when pausing, so play/pause always
 * replays the same section. A live external show clock (MTC / LTC / MIDI Clock
 * / ArtNet) keeps its own position, so `replayFromAnchor` is only honored when
 * the transport isn't following an external signal.
 */
export function pressSpacePlayPause(pb, { replayFromAnchor = true } = {}) {
    if (pb.isPlaying) {
        pb.pause();
        return;
    }
    if (replayFromAnchor) pb.seek(pb.anchor ?? 0);
    pb.play();
}

/**
 * Whether Spacebar play should snap back to the replay anchor first: true for
 * the internal transport, and for an external source while no live signal is
 * arriving (the wall-clock fallback owns the position then). A live external
 * show clock is the only case that never snaps back.
 */
export function spaceReplayFromAnchor(source, signal) {
    const external = source !== 'internal';
    return !(external && !!signal);
}

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
                // A live external show clock owns its own position, so don't
                // snap the head back. Internal transport (or an external source
                // with no signal arriving yet) replays from the anchor.
                const replayFromAnchor = spaceReplayFromAnchor(
                    stateRef.current?.settings?.sync?.source,
                    pbRef.current?.sync?.signal
                );
                pressSpacePlayPause(pbRef.current, { replayFromAnchor });
                return;
            }

            // Arrows move the frame head (playhead) instead of scrolling the
            // timeline: ±1 frame by default, beat-grid nudge with Shift, and
            // clip start/end jump with Ctrl/Cmd.
            if (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown') {
                e.preventDefault();
                const settings = stateRef.current.settings;
                const playhead = pbRef.current.playheadSec;

                if (mod) {
                    // Ctrl/Cmd+Arrow → previous/next clip boundary (start or end).
                    const bounds = clipBoundaries(stateRef.current);
                    const target = key === 'arrowleft' || key === 'arrowup'
                        ? prevBoundary(bounds, playhead)
                        : nextBoundary(bounds, playhead);
                    if (target != null) pbRef.current.seek(target);
                    return;
                }

                if (e.shiftKey) {
                    // Shift+Arrow → jump on the beat grid.
                    const interval = beatDuration(settings.bpm || 120);
                    const target = key === 'arrowleft' || key === 'arrowup'
                        ? prevGridTime(playhead, interval)
                        : nextGridTime(playhead, interval);
                    pbRef.current.seek(target);
                    return;
                }

                // Plain arrow → one frame nudge (Up/Down too, they mirror
                // left/right so the playhead never changes row).
                const target = computeArrowSeek(key, {
                    fps: settings.fps || 30,
                    playhead,
                });
                pbRef.current.seek(Math.max(0, target));
                return;
            }

            if (!mod) return;

            if (key === 'z') {
                e.preventDefault();
                if (e.shiftKey) actionsRef.current.redo();
                else actionsRef.current.undo();
                return;
            }

            const selectedCues = () => {
                const settings = stateRef.current.settings;
                const ids = settings.selectedCueIds || (settings.selectedCueId ? [settings.selectedCueId] : []);
                return ids.map((id) => stateRef.current.cues[id]).filter(Boolean);
            };

            const copySelection = (clipboard = true) => {
                const cues = selectedCues();
                if (cues.length === 0) return;
                e.preventDefault();
                // The anchor (earliest start) so pasting at the playhead keeps
                // the group's internal spacing.
                const anchor = Math.min(...cues.map((c) => c.startTime));
                if (clipboard) clipboardRef.current = { cues: cues.map((c) => ({ ...c })), anchor };
                return cues;
            };

            // Snapshot the selected automation clips into clipboard payloads.
            const collectAutoClips = (ids) => {
                const out = [];
                for (const sc of ids) {
                    const lane = stateRef.current.lanes[sc.laneId];
                    if (!lane) continue;
                    const clip = (lane.clips || []).find((c) => c.id === sc.clipId);
                    if (!clip) continue;
                    out.push({
                        laneId: sc.laneId,
                        clip: {
                            startTime: clip.startTime,
                            duration: clip.duration,
                            keyframes: (clip.keyframes || []).map((k) => ({ ...k })),
                            effectId: clip.effectId || null,
                            paramId: clip.paramId || null,
                            genId: clip.genId || null,
                            genParamId: clip.genParamId || null,
                            targetProperty: clip.targetProperty || null,
                            values: clip.values ? { ...clip.values } : {},
                        },
                    });
                }
                return out;
            };
            // Cues + effect clips selected together land on ONE clipboard entry
            // so Ctrl+V restores the whole group (offset by the same delta).
            const putMixedOnClipboard = (autoClips, cueList) => {
                const cues = cueList.map((c) => ({ ...c }));
                const anchor = Math.min(
                    ...cues.map((c) => c.startTime ?? 0),
                    ...autoClips.map((a) => a.clip.startTime ?? 0)
                );
                clipboardRef.current = { type: 'mixed', cues, autoClips, anchor };
            };
            const putAutoOnClipboard = (autoClips) => {
                if (autoClips.length === 1) {
                    clipboardRef.current = { type: 'autoClip', laneId: autoClips[0].laneId, clip: autoClips[0].clip };
                } else if (autoClips.length > 1) {
                    const anchor = Math.min(...autoClips.map((c) => c.clip.startTime));
                    clipboardRef.current = { type: 'autoClipGroup', clips: autoClips, anchor };
                }
            };
            // The selected automation clips (multi list, or the single-focused one)
            // plus their { laneId, clipId } ids (needed to remove them on cut).
            const selectedAutoClipEntries = () => {
                let ids = Array.isArray(stateRef.current.settings.selectedAutoClipIds)
                    ? stateRef.current.settings.selectedAutoClipIds
                    : [];
                const focused = stateRef.current.settings.selectedAutoClip;
                const inIds = focused && ids.some((sc) => sc.laneId === focused.laneId && sc.clipId === focused.clipId);
                if (focused && !inIds) ids = [...ids, focused];
                return { ids, clips: collectAutoClips(ids) };
            };

            if (key === 'c') {
                // Copy the selected automation clips AND/OR cue clips. A mixed
                // selection (Shift/Ctrl across both kinds, or a marquee hitting
                // both) is preserved as one clipboard item.
                const { clips: autoClips } = selectedAutoClipEntries();
                const cueList = selectedCues();
                if (autoClips.length === 0) {
                    copySelection();
                    return;
                }
                e.preventDefault();
                if (cueList.length > 0) putMixedOnClipboard(autoClips, cueList);
                else putAutoOnClipboard(autoClips);
                return;
            }
            if (key === 'x') {
                const { ids: autoClipIds, clips: autoClips } = selectedAutoClipEntries();
                const cueList = selectedCues();
                if (autoClips.length === 0) {
                    const cues = copySelection();
                    if (!cues) return;
                    for (const cue of cues) actionsRef.current.removeCue(cue.id);
                    return;
                }
                e.preventDefault();
                if (cueList.length > 0) putMixedOnClipboard(autoClips, cueList);
                else putAutoOnClipboard(autoClips);
                for (const sc of autoClipIds) actionsRef.current.removeAutoClip(sc.laneId, sc.clipId);
                for (const cue of cueList) actionsRef.current.removeCue(cue.id);
                return;
            }
            if (key === 'v') {
                const clip = clipboardRef.current;
                if (!clip) return;
                e.preventDefault();
                const s = stateRef.current;
                const playhead = Math.max(0, pbRef.current.playheadSec);
                if (clip.type === 'mixed') {
                    // Paste cue clips AND effect clips together, offset as one
                    // group from the playhead (the shared anchor).
                    const delta = playhead - (clip.anchor || 0);
                    const targetLaneId = s.settings.selectedLaneId;
                    const pastedClips = [];
                    for (const gc of clip.autoClips) {
                        const tgtLaneId = targetLaneId || gc.laneId;
                        const tgtLane = s.lanes[tgtLaneId];
                        if (!tgtLane) continue;
                        const id = `acp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
                        actionsRef.current.addAutoClip(tgtLaneId, {
                            id,
                            startTime: Math.max(0, (gc.clip.startTime || 0) + delta),
                            duration: gc.clip.duration,
                            keyframes: (gc.clip.keyframes || []).map((k) => ({ ...k })),
                            effectId: gc.clip.effectId || null,
                            paramId: gc.clip.paramId || null,
                            genId: gc.clip.genId || null,
                            genParamId: gc.clip.genParamId || null,
                            targetProperty: gc.clip.targetProperty || null,
                            values: gc.clip.values ? { ...gc.clip.values } : {},
                        });
                        pastedClips.push({ laneId: tgtLaneId, clipId: id });
                    }
                    const singleChannel = new Set(clip.cues.map((c) => c.channelId)).size === 1;
                    const targetChannel = pickPasteChannel(
                        s.channels,
                        s.channelOrder,
                        s.settings.selectedChannelId,
                        clip.cues[0]
                    );
                    const pasted = [];
                    for (const clipCue of clip.cues) {
                        const toChannel = (singleChannel && targetChannel)
                            ? targetChannel
                            : (s.channels[clipCue.channelId] ? clipCue.channelId : targetChannel);
                        if (!toChannel || !s.channels[toChannel]) continue;
                        const id = `cue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
                        actionsRef.current.addCue(toChannel, {
                            id,
                            type: clipCue.type,
                            name: clipCue.name,
                            filePath: clipCue.filePath || null,
                            fileName: clipCue.fileName || null,
                            generatorId: clipCue.generatorId || null,
                            generatorParams: clipCue.generatorParams || {},
                            effectOverrides: clipCue.effectOverrides || {},
                            isLooping: clipCue.isLooping,
                            duration: clipCue.duration,
                            totalFrames: clipCue.totalFrames,
                            frameStart: clipCue.frameStart || 0,
                            frameCount: clipCue.frameCount ?? null,
                            startTime: Math.max(0, clipCue.startTime + delta),
                        });
                        pasted.push(id);
                    }
                    if (pasted.length > 0 || pastedClips.length > 0) {
                        actionsRef.current.selectMixed(pasted, pastedClips, targetChannel);
                    }
                    return;
                }
                if (clip.type === 'autoClipGroup') {
                    // Paste multiple auto clips across tracks. Each clip
                    // returns to its own original lane — a group copied from
                    // 4 tracks must paste onto 4 tracks, not collapse onto
                    // whatever lane happens to be selected.
                    const pastedClips = [];
                    const delta = playhead - (clip.anchor || 0);
                    for (const gc of clip.clips) {
                        const tgtLaneId = gc.laneId;
                        const tgtLane = s.lanes[tgtLaneId];
                        if (!tgtLane) continue;
                        const id = `acp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
                        actionsRef.current.addAutoClip(tgtLaneId, {
                            id,
                            startTime: Math.max(0, (gc.clip.startTime || 0) + delta),
                            duration: gc.clip.duration,
                            keyframes: (gc.clip.keyframes || []).map((k) => ({ ...k })),
                            effectId: gc.clip.effectId || null,
                            paramId: gc.clip.paramId || null,
                            genId: gc.clip.genId || null,
                            genParamId: gc.clip.genParamId || null,
                            targetProperty: gc.clip.targetProperty || null,
                            values: gc.clip.values ? { ...gc.clip.values } : {},
                        });
                        pastedClips.push({ laneId: tgtLaneId, clipId: id });
                    }
                    // Keep the freshly pasted clips selected (like cue paste) so a
                    // quick move/trim acts on the whole group.
                    if (pastedClips.length > 0) {
                        actionsRef.current.selectAutoClips(pastedClips);
                    }
                    return;
                }
                if (clip.type === 'autoClip') {
                    const lane = s.lanes[clip.laneId];
                    if (!lane) return;
                    const delta = playhead - (clip.clip.startTime || 0);
                    // Cross-track paste: use the currently selected lane if one is
                    // selected, otherwise keep the original lane
                    const tgtLaneId = s.settings.selectedLaneId || clip.laneId;
                    actionsRef.current.addAutoClip(tgtLaneId, {
                        startTime: Math.max(0, (clip.clip.startTime || 0) + delta),
                        duration: clip.clip.duration,
                        keyframes: (clip.clip.keyframes || []).map((k) => ({ ...k })),
                        effectId: clip.clip.effectId || null,
                        paramId: clip.clip.paramId || null,
                        genId: clip.clip.genId || null,
                        genParamId: clip.clip.genParamId || null,
                        targetProperty: clip.clip.targetProperty || null,
                        values: clip.clip.values ? { ...clip.clip.values } : {},
                    });
                    return;
                }
                if (!Array.isArray(clip.cues) || clip.cues.length === 0) return;
                const delta = playhead - (clip.anchor || 0);
                const singleChannel = new Set(clip.cues.map((c) => c.channelId)).size === 1;
                const targetChannel = pickPasteChannel(
                    s.channels,
                    s.channelOrder,
                    s.settings.selectedChannelId,
                    clip.cues[0]
                );
                const pasted = [];
                for (const clipCue of clip.cues) {
                    const toChannel = (singleChannel && targetChannel)
                        ? targetChannel
                        : (s.channels[clipCue.channelId] ? clipCue.channelId : targetChannel);
                    if (!toChannel || !s.channels[toChannel]) continue;
                    const id = `cue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
                    actionsRef.current.addCue(toChannel, {
                        id,
                        type: clipCue.type,
                        name: clipCue.name,
                        filePath: clipCue.filePath || null,
                        fileName: clipCue.fileName || null,
                        generatorId: clipCue.generatorId || null,
                        generatorParams: clipCue.generatorParams || {},
                        effectOverrides: clipCue.effectOverrides || {},
                        isLooping: clipCue.isLooping,
                        duration: clipCue.duration,
                        totalFrames: clipCue.totalFrames,
                        frameStart: clipCue.frameStart || 0,
                        frameCount: clipCue.frameCount ?? null,
                        startTime: Math.max(0, clipCue.startTime + delta),
                    });
                    pasted.push(id);
                }
                // Keep the freshly pasted clips selected so a quick move/trim
                // (or another paste) acts on what was just created.
                if (pasted.length > 0) {
                    actionsRef.current.selectCues(pasted, targetChannel);
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

            // Vertical zoom: resize block + automation row heights. Inverted so scroll
            // up (negative deltaY) zooms IN — the natural expectation.
            if (e.altKey) {
                e.preventDefault();
                actionsRef.current.setSettings({
                    blockRowH: clamp((settings.blockRowH || BLOCK_ROW_H) - e.deltaY * 0.06, 84, 200),
                    autoRowH: clamp((settings.autoRowH || AUTO_ROW_H) - e.deltaY * 0.06, 30, 220),
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