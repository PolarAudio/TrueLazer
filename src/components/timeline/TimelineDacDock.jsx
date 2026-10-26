import React, { useEffect, useState, useCallback } from 'react';
import { useTimeline } from '../../contexts/TimelineContext';

/**
 * Bottom dock listing discovered DAC channels. Drag a chip onto a track header
 * to route that track to the DAC channel.
 */
const TimelineDacDock = () => {
    const { discoverChannels, dacOutputSettings, openOutputSettings, state, actions } = useTimeline();

    // Prefer the name the user assigned in Output Settings over the raw
    // discovery/service-map label ("Channel 3", "Main", ...), matching how
    // TimelineTrackHeader and DacPanel resolve the same output.
    const labelFor = useCallback((d) => {
        const custom = dacOutputSettings ? dacOutputSettings[`${d.ip}:${d.channel}`]?.name : null;
        return (custom && String(custom).trim()) || d.label || d.ip;
    }, [dacOutputSettings]);
    const [dacs, setDacs] = useState([]);
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState('');
    const [groups, setGroups] = useState(() => {
        try {
            if (window.electronAPI && window.electronAPI.getDacGroups) {
                const result = window.electronAPI.getDacGroups();
                if (result && typeof result.then !== 'function') return result || {};
            }
        } catch (_) { /* ignore */ }
        return {};
    });

    const scan = useCallback(async () => {
        setScanning(true);
        setError('');
        try {
            const found = await discoverChannels();
            // dedupe defensively (one chip per unique ip:channel)
            const unique = [];
            const seen = new Set();
            for (const d of found || []) {
                const key = `${d.ip}:${d.channel}`;
                if (!key || seen.has(key)) continue;
                seen.add(key);
                unique.push(d);
            }
            setDacs(unique);
            if (unique.length === 0) setError('No DACs found. Is the DAC connected on this network?');
        } catch (e) {
            setError(`Discovery failed: ${e.message}`);
        } finally {
            setScanning(false);
        }
    }, [discoverChannels]);

    const loadGroups = useCallback(async () => {
        if (window.electronAPI && window.electronAPI.getDacGroups) {
            try {
                const g = await window.electronAPI.getDacGroups();
                setGroups(g || {});
            } catch (_) {
                // ignore
            }
        }
    }, []);

    const groupChannelsToOutputs = useCallback((channels) => {
        return (channels || [])
            .map((gd) => ({
                ip: gd.ip,
                channel: gd.channel != null ? gd.channel : gd.serviceID,
                type: gd.type || 'etherdream',
                label: gd.label || gd.hostName || null,
            }))
            .filter((o) => o.ip != null && o.channel != null);
    }, []);

    const applyGroupToSelectedTrack = useCallback((channels) => {
        const selectedId = state && state.settings ? state.settings.selectedChannelId : null;
        if (!selectedId || !actions || !actions.setChannelDacs) return;
        const outputs = groupChannelsToOutputs(channels);
        if (outputs.length === 0) return;
        actions.setChannelDacs(selectedId, outputs);
    }, [state, actions, groupChannelsToOutputs]);

    useEffect(() => { scan(); }, [scan]);
    useEffect(() => { loadGroups(); }, [loadGroups]);

    return (
        <div className="timeline-dac-dock">
            <div className="timeline-dac-dock-toolbar">
                <span className="timeline-dac-dock-title">DAC Outputs</span>
                <button className="timeline-btn-sm" onClick={scan} disabled={scanning}>
                    {scanning ? 'Scanning…' : `Rescan (${dacs.length})`}
                </button>
                <button
                    className="timeline-btn-sm"
                    onClick={openOutputSettings}
                    title="Open the Output Settings for the discovered channels (dimmer, output area, safety zones)"
                >
                    Output Settings…
                </button>
                <button
                    className="timeline-btn-sm"
                    onClick={loadGroups}
                    title="Reload saved DAC groups"
                >
                    Reload Groups ({Object.keys(groups).length})
                </button>
                <span className="timeline-dac-dock-hint">
                    Drag a chip onto a track header to route it. Drag on empty timeline space to sweep-select;
                    Shift+click or Shift+drag adds to the selection, Ctrl+A takes everything.
                </span>
            </div>
            <div className="timeline-dac-dock-list">
                {dacs.length === 0 && !scanning && (
                    <div className="timeline-dac-dock-empty">{error || 'No DAC channels yet.'}</div>
                )}
                {dacs.map((d, i) => (
                    <div
                        key={`${d.ip}:${d.channel}`}
                        className="timeline-dac-chip"
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify({
                            ip: d.ip,
                            channel: d.channel,
                            type: d.type,
                            label: d.label,
                        }))}
                        title={`${d.type} · ${d.ip} ch ${d.channel}`}
                    >
                        <span className="timeline-dac-chip-type">{d.type === 'etherdream' ? 'ED' : 'SB'}</span>
                        <span className="timeline-dac-chip-label">{labelFor(d)}[{d.channel}]</span>
                    </div>
                ))}
            </div>

            {Object.keys(groups).length > 0 && (
                <div className="timeline-dac-dock-groups">
                    <div className="timeline-dac-dock-groups-title">DAC Groups</div>
                    <div className="timeline-dac-dock-list">
                        {Object.entries(groups).map(([name, groupDacs]) => (
                            <div
                                key={name}
                                className="timeline-dac-chip timeline-dac-group-chip"
                                draggable
                                onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify({
                                    isGroup: true,
                                    name,
                                    channels: groupDacs,
                                }))}
                                onClick={() => applyGroupToSelectedTrack(groupDacs)}
                                title={`Drag onto a track header to assign all ${groupDacs.length} channels. Click to assign to the selected track.`}
                            >
                                <span className="timeline-dac-chip-type">GRP</span>
                                <span className="timeline-dac-chip-label">{name} ({groupDacs.length})</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TimelineDacDock;