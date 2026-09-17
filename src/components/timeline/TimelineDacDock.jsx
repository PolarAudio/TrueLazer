import React, { useEffect, useState, useCallback } from 'react';
import { useTimeline } from '../../contexts/TimelineContext';

/**
 * Bottom dock listing discovered DAC channels. Drag a chip onto a track header
 * to route that track to the DAC channel.
 */
const TimelineDacDock = () => {
    const { discoverChannels } = useTimeline();
    const [dacs, setDacs] = useState([]);
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState('');

    const scan = useCallback(async () => {
        setScanning(true);
        setError('');
        try {
            const found = await discoverChannels();
            setDacs(found || []);
            if (!found || found.length === 0) setError('No DACs found. Is the DAC connected on this network?');
        } catch (e) {
            setError(`Discovery failed: ${e.message}`);
        } finally {
            setScanning(false);
        }
    }, [discoverChannels]);

    useEffect(() => { scan(); }, [scan]);

    return (
        <div className="timeline-dac-dock">
            <div className="timeline-dac-dock-toolbar">
                <span className="timeline-dac-dock-title">DAC Outputs</span>
                <button className="timeline-btn-sm" onClick={scan} disabled={scanning}>
                    {scanning ? 'Scanning…' : `Rescan (${dacs.length})`}
                </button>
                <span className="timeline-dac-dock-hint">Drag a chip onto a track header to route it.</span>
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
                        <span className="timeline-dac-chip-label">{d.label || d.ip}[{d.channel}]</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TimelineDacDock;