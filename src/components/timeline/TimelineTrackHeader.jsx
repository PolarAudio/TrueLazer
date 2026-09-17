import React, { useState, useRef, useEffect } from 'react';
import { useTimeline, isChannelAudible, getChannelOutputs } from '../../contexts/TimelineContext';

const TrackHeader = ({ channel, height }) => {
    const { state, actions } = useTimeline();
    const [editing, setEditing] = useState(false);
    const [nameDraft, setNameDraft] = useState(channel.name);
    const inputRef = useRef(null);

    useEffect(() => {
        if (editing) {
            setNameDraft(channel.name);
            inputRef.current && inputRef.current.focus();
            inputRef.current && inputRef.current.select();
        }
    }, [editing, channel.name]);

    const audible = isChannelAudible(state, channel);
    const outputs = getChannelOutputs(channel);

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        let data = null;
        try {
            data = JSON.parse(e.dataTransfer.getData('application/json'));
        } catch (_) {
            return;
        }
        if (!data) return;
        if (data.filePath) {
            actions.addCue(channel.id, {
                type: 'ILDA',
                name: data.fileName || 'ILDA Cue',
                filePath: data.filePath,
                fileName: data.fileName || data.filePath.split(/[\\/]/).pop(),
                startTime: 0,
                duration: 10,
            });
        } else if (data.ip != null && data.channel != null) {
            const output = {
                ip: data.ip,
                channel: data.channel,
                type: data.type || 'etherdream',
                label: data.label || null,
            };
            if (e.shiftKey) {
                // Shift-drop builds a Zone: add this output to the list.
                const has = outputs.some((o) => o.ip === output.ip && o.channel === output.channel);
                if (!has) actions.setChannelDacs(channel.id, [...outputs, output]);
            } else {
                // Plain drop replaces the routing (single-channel mode).
                actions.setChannelDac(channel.id, output);
            }
        }
    };

    return (
        <div
            className={`timeline-track-header ${channel.selected ? 'selected' : ''} ${!audible ? 'dimmed' : ''}`}
            style={{ height }}
            data-channel-id={channel.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={(e) => {
                e.stopPropagation();
                actions.select(null, channel.id);
            }}
        >
            <div className="timeline-track-header-top">
                {editing ? (
                    <input
                        ref={inputRef}
                        className="timeline-track-name-input"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={() => {
                            setEditing(false);
                            if (nameDraft.trim()) actions.renameChannel(channel.id, nameDraft.trim());
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') {
                                setNameDraft(channel.name);
                                setEditing(false);
                            }
                        }}
                    />
                ) : (
                    <span className="timeline-track-name" onDoubleClick={() => setEditing(true)}>
                        {channel.name}
                    </span>
                )}
                <button className="timeline-icon-btn" title={channel.expanded ? 'Collapse automation' : 'Expand automation'}
                    onClick={(e) => { e.stopPropagation(); actions.setChannelExpanded(channel.id, !channel.expanded); }}>
                    {channel.expanded ? '▾' : '▸'}
                </button>
                <button className="timeline-icon-btn danger" title="Remove channel"
                    onClick={(e) => { e.stopPropagation(); actions.removeChannel(channel.id); }}>
                    ✕
                </button>
            </div>

            <div className="timeline-track-header-controls">
                <button className={`timeline-btn-sm ${channel.muted ? 'active muted' : ''}`}
                    onClick={(e) => { e.stopPropagation(); actions.toggleMute(channel.id); }} title="Mute">M</button>
                <button className={`timeline-btn-sm ${channel.soloed ? 'active solo' : ''}`}
                    onClick={(e) => { e.stopPropagation(); actions.toggleSolo(channel.id); }} title="Solo">S</button>
                <input
                    type="range" min={0} max={1} step={0.01} value={channel.intensity}
                    className="timeline-intensity"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => actions.setChannelIntensity(channel.id, parseFloat(e.target.value))}
                    title={`Intensity ${Math.round(channel.intensity * 100)}%`}
                />
            </div>

            <div
                className={`timeline-track-dac ${outputs.length > 1 ? 'zone' : ''}`}
                title={outputs.length
                    ? `${outputs.length} output${outputs.length > 1 ? 's (zone)' : ''}: ${outputs.map((o) => `${o.label || o.ip}[${o.channel}]${o.flipX ? ' ⮀' : ''}${o.flipY ? ' ⮁' : ''}`).join(', ')}`
                    : 'none (drag a DAC here; shift-drag adds to a zone; x/y buttons invert that DAC)'}
            >
                {outputs.length > 0 ? (
                    outputs.map((o) => (
                        <span key={`${o.ip}:${o.channel}`} className="timeline-dac-chip">
                            <span className="timeline-dac-chip-label">{o.label || o.ip}[{o.channel}]</span>
                            <button
                                className={`timeline-dac-axis ${o.flipX ? 'active' : ''}`}
                                title={o.flipX ? 'Invert X is ON (click to reset)' : 'Invert X axis for this DAC'}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    actions.setOutputFlip(channel.id, o.ip, o.channel, 'x');
                                }}
                            >x</button>
                            <button
                                className={`timeline-dac-axis ${o.flipY ? 'active' : ''}`}
                                title={o.flipY ? 'Invert Y is ON (click to reset)' : 'Invert Y axis for this DAC'}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    actions.setOutputFlip(channel.id, o.ip, o.channel, 'y');
                                }}
                            >y</button>
                            <button
                                className="timeline-icon-btn timeline-dac-remove"
                                title="Remove this DAC from the zone"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    actions.setChannelDacs(
                                        channel.id,
                                        outputs.filter((x) => !(x.ip === o.ip && x.channel === o.channel))
                                    );
                                }}
                            >
                                ✕
                            </button>
                        </span>
                    ))
                ) : (
                    <span className="timeline-dac-placeholder">drop DAC here</span>
                )}
                {outputs.length > 0 && (
                    <span className="timeline-dac-hint">{outputs.length > 1 ? 'zone · shift-drag adds' : 'shift-drag adds'}</span>
                )}
            </div>
        </div>
    );
};

export default TrackHeader;