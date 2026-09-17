import React from 'react';
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
};
const FRAME_SOURCES = ['mtc', 'ltc', 'artnet'];

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
    const statusTitle = sync
        ? (sync.signal
            ? `${SYNC_LABELS[src] || src} ${sync.running ? 'running' : 'locked'} · ${statusText}${src === 'midiClock' ? ` @ ${sync.rate} BPM` : ` @ ${sync.rate} fps`} · ${midiBound ? `on ${(midiInputs.find((i) => i.id === midiBound) || {}).name || midiBound}` : ''}`
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
                    <input
                        type="number" min={20} max={300} step={1} value={s.bpm}
                        onChange={(e) => actions.setSettings({ bpm: Math.max(20, Math.min(300, parseFloat(e.target.value) || 120)) })}
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
                    <input
                        type="number" min={ZOOM_MIN} max={ZOOM_MAX} step={1} value={Math.round(s.zoom)}
                        onChange={(e) => setZoom(parseFloat(e.target.value) || s.zoom)}
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
                        <input
                            type="number" min={24} max={60} step={1} value={s.sync?.fps ?? 30}
                            onChange={(e) => setSync({ fps: Math.max(24, Math.min(60, parseFloat(e.target.value) || 30)) })}
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
                {s.loopEnabled && (
                    <span className="timeline-loop-pos">
                        <input type="number" min={0} step={0.1} value={s.loop?.start ?? 0}
                            onChange={(e) => actions.setSettings({ loop: { start: parseFloat(e.target.value) || 0, end: s.loop?.end ?? 60 } })}
                            title="Loop start (s)" />
                        –
                        <input type="number" min={0} step={0.1} value={s.loop?.end ?? 60}
                            onChange={(e) => actions.setSettings({ loop: { start: s.loop?.start ?? 0, end: parseFloat(e.target.value) || 60 } })}
                            title="Loop end (s)" />
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