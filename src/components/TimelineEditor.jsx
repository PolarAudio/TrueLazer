import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTimeline, getTimelineDuration, getSortedCues } from '../contexts/TimelineContext';
import { useTimelinePlayback } from '../hooks/useTimelinePlayback';
import { useTimelineShortcuts } from '../hooks/useTimelineShortcuts';
import { timeToPx, pxToTime, snapToGrid, beatGridLines, beatDuration } from '../utils/timelineTime';
import TimelineTransport from './timeline/TimelineTransport';
import TimelineRuler from './timeline/TimelineRuler';
import TimelineTrackHeader from './timeline/TimelineTrackHeader';
import TimelineBlock from './timeline/TimelineBlock';
import TimelineAutomationLane from './timeline/TimelineAutomationLane';
import TimelineInspector from './timeline/TimelineInspector';
import TimelineDacDock from './timeline/TimelineDacDock';
import TimelineWaveform from './timeline/TimelineWaveform';
import FileBrowser from './FileBrowser';
import { HEADER_W, RULER_H, BLOCK_ROW_H, AUTO_ROW_H, END_PAD, ZOOM_MIN, ZOOM_MAX } from './timeline/layout';

const TimelineEditor = ({ onBack }) => {
    const { state, actions, loadTimelineAudio } = useTimeline();
    const pb = useTimelinePlayback();

    const gridRef = useRef(null);
    const [viewportW, setViewportW] = useState(1000);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [fbViewMode, setFbViewMode] = useState('list');
    const [fbPath, setFbPath] = useState(null);

    // Wheel + keyboard shortcuts (vertical zoom, scroll, framing, clipboard,
    // save/new/undo/redo). Attached to the scroll element via gridRef.
    useTimelineShortcuts({ scrollRef: gridRef, state, actions, pb });

    const s = state.settings;
    const selectedCueIds = s.selectedCueIds || [];
    const pxPerSecond = s.zoom;
    // Floor the block row so the full header (name, M/S/X/Y, DAC chips) always
    // renders — even when old saved settings carry a too-small value.
    const blockRowH = Math.max(84, s.blockRowH || BLOCK_ROW_H);
    const autoRowH = Math.max(30, s.autoRowH || AUTO_ROW_H);
    const ADD_LANE_ROW_H = 20;
    const duration = useMemo(() => getTimelineDuration(state), [state]);

    // Keep the scroll area width in sync (resizes from window / inspector toggle).
    useEffect(() => {
        const el = gridRef.current;
        if (!el) return;
        const update = () => setViewportW(el.clientWidth);
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, [drawerOpen]);

    const gridW = Math.max(viewportW - HEADER_W - 4, timeToPx(duration, pxPerSecond) + END_PAD);
    const contentWidth = HEADER_W + gridW;

    const handleRulerSeek = useCallback((t) => pb.seek(t), [pb]);
    const handleZoom = useCallback((z) => actions.setSettings({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) }), [actions]);
    const handleFit = useCallback(() => {
        const avail = Math.max(300, viewportW - HEADER_W - 4 - END_PAD);
        const z = getTimelineDuration(state) > 0 ? avail / getTimelineDuration(state) : ZOOM_MIN;
        handleZoom(z);
    }, [viewportW, state, handleZoom]);

    const handleGridClick = useCallback(
        (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const gridX = e.clientX - rect.left; // rect starts at HEADER_W
            const t = Math.max(0, pxToTime(gridX, pxPerSecond));
            pb.seek(t);
        },
        [pxPerSecond, pb]
    );

    const defaultChannelId = (s.selectedChannelId && state.channels[s.selectedChannelId])
        ? s.selectedChannelId
        : (state.channelOrder[0] || null);

    const addGeneratorCueAt = useCallback(
        (channelId, time) => {
            const id = channelId || defaultChannelId;
            if (!id) {
                const chanId = `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
                actions.addChannel({ id: chanId, name: `Channel ${state.channelOrder.length + 1}` });
                actions.addCue(chanId, {
                    type: 'GENERATOR', generatorId: 'circle',
                    name: 'Circle', startTime: Math.max(0, time), duration: 8,
                });
                return;
            }
            actions.addCue(id, {
                type: 'GENERATOR', generatorId: 'circle',
                name: 'Circle', startTime: Math.max(0, time), duration: 8,
            });
        },
        [defaultChannelId, state.channelOrder.length, actions]
    );

    const addGeneratorAtPlayhead = useCallback(
        (t) => addGeneratorCueAt(defaultChannelId, t != null ? t : pb.playheadSec),
        [addGeneratorCueAt, defaultChannelId, pb.playheadSec]
    );

    const handleDropOnLane = useCallback(
        (e, channelId) => {
            e.preventDefault();
            e.stopPropagation();
            let data = null;
            try {
                data = JSON.parse(e.dataTransfer.getData('application/json'));
            } catch (_) { return; }
            if (!data || !data.filePath) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const t = Math.max(0, snapToGrid(pxToTime(x, pxPerSecond), s.snapMode, { bpm: s.bpm, fps: s.fps }));
            actions.addCue(channelId, {
                type: 'ILDA',
                name: data.fileName || 'ILDA Cue',
                filePath: data.filePath,
                fileName: data.fileName || data.filePath.split(/[\\/]/).pop(),
                startTime: t,
                // duration: 0 = auto. It is resolved to totalFrames / fps (30fps
                // timeline playback) once the ILDA file is parsed; the user can
                // then lengthen the clip freely.
                duration: 0,
            });
        },
        [pxPerSecond, s, actions]
    );

    const handleLaneDoubleClick = useCallback(
        (e, channelId) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const t = Math.max(0, snapToGrid(pxToTime(x, pxPerSecond), s.snapMode, { bpm: s.bpm, fps: s.fps }));
            addGeneratorCueAt(channelId, t);
        },
        [pxPerSecond, s, addGeneratorCueAt]
    );

    // Delete/Backspace removes the selected automation keyframe first (click a
// point, press Delete), then falls back to removing all selected cues.
    useEffect(() => {
        const onKey = (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const selKf = s.selectedKeyframe;
                if (selKf && selKf.laneId && selKf.keyframeId && state.lanes?.[selKf.laneId]) {
                    e.preventDefault();
                    actions.removeKeyframe(selKf.laneId, selKf.keyframeId);
                    return;
                }
                if (selectedCueIds.length > 0) {
                    e.preventDefault();
                    for (const id of selectedCueIds) actions.removeCue(id);
                }
            }
            if (e.key === 'Enter' && selectedCueIds.length === 0) {
                e.preventDefault();
                addGeneratorAtPlayhead();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selectedCueIds, s.selectedKeyframe, actions, addGeneratorAtPlayhead, state.lanes]);

    const beatOverlays = useMemo(() => {
        const span = gridW / pxPerSecond;
        const beatPx = timeToPx(beatDuration(s.bpm), pxPerSecond);
        const lines = beatGridLines(0, span, { bpm: s.bpm, timeSignature: s.timeSignature })
            .filter((l) => l.time >= 0 && !(l.beatInBar !== 0 && beatPx < 9));
        // Guard against pathological timeline lengths — never paint a DOM
        // explosion of grid lines.
        if (lines.length <= 1200) {
            return lines.map((l) => (
                <div
                    key={`bg${l.time}`}
                    className={`timeline-gline ${l.isBarStart ? 'bar' : 'beat'}`}
                    style={{ left: HEADER_W + timeToPx(l.time, pxPerSecond) }}
                />
            ));
        }
        return [];
    }, [pxPerSecond, gridW, s.bpm, s.timeSignature]);

    const audioPeaks = s.audio?.peaks || [];
    const audioDuration = s.audio?.duration || 0;

    return (
        <div className="timeline-page">
            <TimelineTransport
                onBack={onBack}
                isPlaying={pb.isPlaying}
                onPlay={pb.isPlaying ? pb.pause : pb.play}
                onStop={pb.stop}
                playheadSec={pb.playheadSec}
                onSeek={pb.seek}
                onToggleFileDrawer={() => setDrawerOpen((v) => !v)}
                fileDrawerOpen={drawerOpen}
                onAddGenerator={() => addGeneratorAtPlayhead()}
                onFit={handleFit}
                laserOn={pb.laserOn}
                onToggleLaser={pb.setLaserOn}
                sync={pb.sync}
            />

            <div className="timeline-body">
                <div className="timeline-scroll" ref={gridRef}>
                    <div className="timeline-content" style={{ width: contentWidth }}>
                        <div className="timeline-row">
                            <div className="timeline-header-cell corner">
                                <div className="timeline-corner-label" style={{ height: RULER_H }}>
                                    {s.audio ? (
                                        <>
                                            <span className="timeline-corner-audio">♪ Audio</span>
                                            <button
                                                className="timeline-btn-sm danger"
                                                title="Remove audio track"
                                                onClick={() => actions.clearAudio()}
                                            >✕</button>
                                        </>
                                    ) : (
                                        <button className="timeline-btn-sm" title="Load timeline audio"
                                            onClick={async () => {
                                                if (window.electronAPI?.showAudioFileDialog) {
                                                    const fp = await window.electronAPI.showAudioFileDialog();
                                                    if (fp) loadTimelineAudio(fp).catch(console.warn);
                                                }
                                            }}>+ Audio</button>
                                    )}
                                </div>
                            </div>
                            <TimelineRuler
                                width={gridW}
                                pxPerSecond={pxPerSecond}
                                bpm={s.bpm}
                                timeSignature={s.timeSignature}
                                fps={s.fps}
                                snapMode={s.snapMode}
                                onSeek={handleRulerSeek}
                                onZoom={handleZoom}
                            />
                        </div>

                        {state.channelOrder.map((chId) => {
                            const channel = state.channels[chId];
                            if (!channel) return null;
                            const cues = getSortedCues(state, chId);
                            const lanes = (channel.automationLanes || [])
                                .map((lid) => state.lanes[lid])
                                .filter(Boolean);
                            const rowH = blockRowH + (channel.expanded ? lanes.length * autoRowH + ADD_LANE_ROW_H : 0);
                            return (
                                <section key={chId} className="timeline-channel" style={{ height: rowH }}>
                                    <div className="timeline-row">
                                        <div className="timeline-header-cell">
                                            <TimelineTrackHeader channel={channel} height={blockRowH} />
                                        </div>
                                        <div
                                            className="timeline-block-lane"
                                            style={{ width: gridW, height: blockRowH }}
                                            onDrop={(e) => handleDropOnLane(e, chId)}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDoubleClick={(e) => handleLaneDoubleClick(e, chId)}
                                            onClick={(e) => {
                                                if (e.target === e.currentTarget) {
                                                    actions.select(null, chId);
                                                }
                                            }}
                                        >
                                            {cues.map((cue) => (
                                                <TimelineBlock
                                                    key={cue.id}
                                                    cue={cue}
                                                    selected={selectedCueIds.includes(cue.id)}
                                                    pxPerSecond={pxPerSecond}
                                                    snapMode={s.snapMode}
                                                    bpm={s.bpm}
                                                    fps={s.fps}
                                                />
                                            ))}
                                        </div>
                                    </div>

                                    {channel.expanded && lanes.map((lane) => (
                                        <TimelineAutomationLane
                                            key={lane.id}
                                            lane={lane}
                                            gridW={gridW}
                                            pxPerSecond={pxPerSecond}
                                            snapMode={s.snapMode}
                                            bpm={s.bpm}
                                            fps={s.fps}
                                            rowH={autoRowH}
                                        />
                                    ))}

                                    {channel.expanded && (
                                        <div className="timeline-row" style={{ height: ADD_LANE_ROW_H }}>
                                            <div className="timeline-header-cell timeline-add-lane-cell">
                                                <button className="timeline-lane-add"
                                                    title="Add another automation lane (multiple per channel/zone)"
                                                    onClick={() => actions.addLane(chId, {})}>
                                                    + Automation lane
                                                </button>
                                            </div>
                                            <div className="timeline-add-lane-body" style={{ width: gridW, height: ADD_LANE_ROW_H }} />
                                        </div>
                                    )}
                                </section>
                            );
                        })}

                        {/* Waveform backdrop + beat/aware grid lines */}
                        <div className="timeline-grid-bg" style={{ left: HEADER_W, width: gridW }} onClick={handleGridClick} />
                        {beatOverlays}
                        <div className="timeline-wave-layer" style={{ left: HEADER_W, width: gridW }}>
                            {(state.channelOrder.length > 0 || audioPeaks.length > 0) && (
                                <TimelineWaveform
                                    peaks={audioPeaks}
                                    duration={audioDuration || duration}
                                    pxPerSecond={pxPerSecond}
                                    height={RULER_H + state.channelOrder.reduce((acc, chId) => {
                                        const ch = state.channels[chId];
                                        const nLanes = ch && ch.expanded ? (ch.automationLanes || []).length : 0;
                                        const addRow = ch && ch.expanded ? ADD_LANE_ROW_H : 0;
                                        return acc + blockRowH + nLanes * autoRowH + addRow;
                                    }, 0) + 24}
                                    width={gridW}
                                    color="rgba(255,255,255,0.35)"
                                />
                            )}
                        </div>

                        {/* Playhead */}
                        <div className="timeline-playhead" style={{ left: HEADER_W + timeToPx(pb.playheadSec, pxPerSecond) }} />
                    </div>
                </div>

                <TimelineInspector
                    onSeek={pb.seek}
                    previewFrame={pb.previewFrame}
                    playheadSec={pb.playheadSec}
                />
            </div>

            <TimelineDacDock />

            {drawerOpen && (
                <div className="timeline-file-drawer">
                    <FileBrowser
                        viewMode={fbViewMode}
                        onViewModeChange={setFbViewMode}
                        path={fbPath}
                        onPathChange={setFbPath}
                    />
                </div>
            )}
        </div>
    );
};

export default TimelineEditor;