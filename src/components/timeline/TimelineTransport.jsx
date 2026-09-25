import React, { useState } from 'react';
import { useTimeline } from '../../contexts/TimelineContext';
import { useMidi } from '../../contexts/MidiContext';
import { formatClock, SNAP_MODES, snapInterval } from '../../utils/timelineTime';
import { formatTimecode } from '../../utils/timecodeSync';
import { ZOOM_MIN, ZOOM_MAX } from './layout';

const SNAP_LABELS = { off: 'Snap: Off', frame: 'Snap: Frame', beat: 'Snap: Beat', eighth: 'Snap: 1/8', sixteenth: 'Snap: 1/16' };

const SYNC_LABELS = {
    internal: 'Internal',
    mtc: 'MIDI Timecode',
    midiClock: 'MIDI Clock',
    ltc: 'LTC Audio',
    artnet: 'Art-Net TC',
    tcnet: 'TCNet Sync',
    prolink: 'PRO DJ LINK',
    stagelinq: 'STAGELINQ',
};
const FRAME_SOURCES = ['mtc', 'ltc', 'artnet', 'tcnet'];

/**
 * Number input that edits a local draft while focused and only commits the
 * clamped value on blur / Enter. Letting onChange clamp immediately (as a
 * <input type="number"> bound straight to state does) blocks typing: e.g. a
 * BPM clamped to [20, 300] would lock the field the moment "1" is pressed.
 */
const DraftNumber = ({ value, min, max, step = 1, onCommit, title }) => {
    const [draft, setDraft] = useState(null);
    const commit = () => {
        const raw = draft != null && String(draft).trim() !== '' ? draft : value;
        const n = parseFloat(raw);
        const hadDraft = draft != null;
        setDraft(null);
        if (!hadDraft || !Number.isFinite(n) || n === Number(value)) return;
        let v = n;
        if (Number.isFinite(min)) v = Math.max(min, v);
        if (Number.isFinite(max)) v = Math.min(max, v);
        onCommit(v);
    };
    return (
        <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft != null ? draft : value}
            title={title}
            onFocus={(e) => setDraft(e.target.value)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
    );
};

const TimelineTransport = ({
    onBack,
    isPlaying,
    onPlay,
    onStop,
    playheadSec,
    onSeek,
    onToggleFileDrawer,
    fileDrawerOpen,
    onAddGenerator,
    onFit,
    laserOn,
    onToggleLaser,
    sync,
}) => {
    const { state, actions } = useTimeline();
    const { midiInputs: ctxMidiInputs } = useMidi();
    const s = state.settings;

    const setZoom = (z) => actions.setSettings({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z))) });
    const setSync = (patch) => actions.setSettings({ sync: { ...s.sync, ...patch } });

    const src = sync ? sync.source : 'internal';
    // MIDI devices: prefer the sync hook's own discovery (it self-enables
    // WebMidi even when the app MIDI-shortcut toggle is off), else the
    // MidiContext list.
    const midiInputs = (sync && sync.devices && sync.devices.length ? sync.devices : ctxMidiInputs) || [];
    const midiChosen = s.sync?.inputDeviceId || '';
    const midiBound = (src === 'mtc' || src === 'midiClock') && sync ? sync.deviceId : null;
    // External sources show the wall clock the timeline is obeying. When the
    // source is present we prefer the ff:tc encode (hours:minutes:seconds:frames);
    const statusText = sync && sync.signal && sync.timecode
        ? formatTimecode(sync.timecode, sync.rate)
        : (sync && sync.signal ? formatClock(sync.seconds) : '――:――:――');
    const diag = src === 'mtc' || src === 'midiClock' ? (sync && sync.midi) : null;
    const bpmInfo = (src === 'prolink' || src === 'stagelinq') && sync && sync.bpm
        ? ` @ ${sync.bpm} BPM`
        : src === 'midiClock'
            ? ` @ ${sync.rate} BPM`
            : ` @ ${sync.rate} fps`;
    const statusTitle = sync
        ? (sync.signal
            ? `${SYNC_LABELS[src] || src} ${sync.running ? 'running' : 'locked'} · ${statusText}${bpmInfo}${src === 'midiClock' ? ` · ${diag?.count ?? 0} bytes · last: ${diag?.lastHex || '—'}` : ''}${midiBound ? ` · on ${(midiInputs.find((i) => i.id === midiBound) || {}).name || midiBound}` : ''}`
            : `${SYNC_LABELS[src] || src} — no signal${diag ? ` · ${diag.count} bytes · last: ${diag.lastHex || '—'}` : ''}${midiBound ? ` · on ${(midiInputs.find((i) => i.id === midiBound) || {}).name || midiBound}` : ''}`)
        : '';

    return (
        <div className="timeline-transport">
            <div className="timeline-transport-left">
                <button className="timeline-btn" onClick={onBack}>← Show Control</button>
                <h2 className="timeline-title">Timeline</h2>
                <button className={`timeline-btn ${isPlaying ? 'play' : ''}`} onClick={onPlay} title="Play / Pause">
                    {isPlaying ? '❚❚ Pause' : '▶ Play'}
                </button>
                <button className="timeline-btn" onClick={onStop} title="Stop (return to cursor)"
                    disabled={!isPlaying && playheadSec <= 0}>■ Stop</button>
                <button
                    className={`timeline-btn laser ${laserOn ? 'on' : ''}`}
                    onClick={() => onToggleLaser(!laserOn)}
                    title="Toggle laser DAC output"
                >
                    {laserOn ? '● LASER ON' : '○ LASER OFF'}
                </button>
                <span className="timeline-timecode" title="Playhead timecode">{formatClock(playheadSec)}</span>
                <span className="timeline-total">/ {formatClock(getTotal(state))}</span>
                <input
                    type="text"
                    className="timeline-seek"
                    value={formatClock(playheadSec)}
                    onChange={(e) => {
                        const parts = e.target.value.split(':').map(Number);
                        if (parts.length === 2 && parts.every(isFinite)) onSeek(parts[0] * 60 + parts[1]);
                        else if (parts.length === 3 && parts.every(isFinite)) onSeek(parts[0] * 3600 + parts[1] * 60 + parts[2]);
                    }}
                    title="Type mm:ss or hh:mm:ss to seek"
                />
            </div>

            <div className="timeline-transport-center">
                <label className="timeline-tool">
                    <span>BPM</span>
                    <DraftNumber
                        value={s.bpm}
                        min={20}
                        max={300}
                        step={1}
                        onCommit={(v) => actions.setSettings({ bpm: v })}
                    />
                </label>
                <select
                    className="timeline-tool"
                    value={s.snapMode}
                    onChange={(e) => actions.setSettings({ snapMode: e.target.value })}
                    title={`Grid snap: ${Math.round(snapInterval(s.snapMode, s) * 1000)} ms`}
                >
                    {SNAP_MODES.map((m) => (
                        <option key={m} value={m}>{SNAP_LABELS[m]}</option>
                    ))}
                </select>
                <label className="timeline-tool">
                    <span>Zoom</span>
                    <DraftNumber
                        value={Math.round(s.zoom)}
                        min={ZOOM_MIN}
                        max={ZOOM_MAX}
                        step={1}
                        onCommit={setZoom}
                    />
                </label>
                <button className="timeline-btn-sm" title="Zoom out" onClick={() => setZoom(s.zoom / 1.2)}>−</button>
                <button className="timeline-btn-sm" title="Zoom in" onClick={() => setZoom(s.zoom * 1.2)}>+</button>
                <button className="timeline-btn-sm" title="Fit the whole timeline to the window" onClick={onFit}>Fit</button>
            </div>

            <div className="timeline-transport-right">
                <label className="timeline-tool timeline-sync">
                    <span>Sync</span>
                    <select value={src} onChange={(e) => setSync({ source: e.target.value })} title="External timecode source">
                        {Object.entries(SYNC_LABELS).map(([v, label]) => (
                            <option key={v} value={v}>{label}</option>
                        ))}
                    </select>
                </label>
                {(src === 'mtc' || src === 'midiClock') && (
                    <label className="timeline-tool" title="MIDI input device for timecode / clock. Default prefers the GS Wavetable synthesizer, else the app's selected MIDI input.">
                        <span>In</span>
                        <select
                            value={midiChosen || midiBound || ''}
                            onChange={(e) => setSync({ inputDeviceId: e.target.value })}
                        >
                            <option value="">Default (auto)</option>
                            {midiInputs.map((i) => (
                                <option key={i.id} value={i.id}>{i.name}</option>
                            ))}
                        </select>
                    </label>
                )}
                {FRAME_SOURCES.includes(src) && (
                    <label className="timeline-tool" title="Frame rate used when decoding & generating for the source">
                        <span>fps</span>
                        <DraftNumber
                            value={s.sync?.fps ?? 30}
                            min={24}
                            max={60}
                            step={1}
                            onCommit={(v) => setSync({ fps: v })}
                        />
                    </label>
                )}
                {src !== 'internal' && (
                    <span className={`timeline-sync-status ${sync && sync.signal ? (sync.running ? 'run' : 'lock') : 'idle'}`} title={statusTitle}>
                        {statusText}
                    </span>
                )}
                <label className="timeline-checkbox">
                    <input
                        type="checkbox"
                        checked={s.loopEnabled}
                        onChange={(e) => actions.setSettings({ loopEnabled: e.target.checked })}
                    />
                    <span>Loop</span>
                </label>
                <label className="timeline-checkbox" title="Clip editing: Stretch lets you drag clips over each other; Trim clamps resize edges at the neighbouring clip so clips can never overlap">
                    <input
                        type="checkbox"
                        checked={s.clipEditTrim}
                        onChange={(e) => actions.setSettings({ clipEditTrim: e.target.checked })}
                    />
                    <span>Trim</span>
                </label>
                <button
                    className="timeline-btn"
                    onClick={() => actions.trimOverlaps((s.selectedCueIds || []).length ? s.selectedCueIds : undefined)}
                    title="Cut clips so none overlaps its neighbour. Trims the selected clips — or ALL clips when nothing is selected. Overlapping clips shadow each other: only one plays at any moment."
                >
                    ✂ Cut Overlaps
                </button>
                {s.loopEnabled && (
                    <span className="timeline-loop-pos">
                        <DraftNumber
                            value={s.loop?.start ?? 0}
                            min={0}
                            step={0.1}
                            title="Loop start (s)"
                            onCommit={(v) => actions.setSettings({ loop: { start: v, end: s.loop?.end ?? 60 } })}
                        />
                        –
                        <DraftNumber
                            value={s.loop?.end ?? 60}
                            min={0}
                            step={0.1}
                            title="Loop end (s)"
                            onCommit={(v) => actions.setSettings({ loop: { start: s.loop?.start ?? 0, end: v } })}
                        />
                    </span>
                )}
                <button className="timeline-btn" onClick={() => actions.addChannel({ name: `Channel ${state.channelOrder.length + 1}` })}>
                    + Channel
                </button>
                <button className="timeline-btn" onClick={onAddGenerator}>+ Generator Cue</button>
                <button className={`timeline-btn ${fileDrawerOpen ? 'active' : ''}`} onClick={onToggleFileDrawer}>
                    {fileDrawerOpen ? 'Close Files ▸' : 'Files ◂'}
                </button>
            </div>
        </div>
    );
};

function getTotal(state) {
    let end = 60; // default duration floor matches the context selector
    for (const id of Object.keys(state.cues)) {
        const cue = state.cues[id];
        end = Math.max(end, (cue.startTime || 0) + (cue.duration || 0));
    }
    return Math.max(end, state.settings.audio?.duration || 0);
}

export default TimelineTransport;