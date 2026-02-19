import React from 'react';
import { useArtnet } from '../contexts/ArtnetContext';

/**
 * DmxMonitor Component
 * Visualizes real-time DMX data for a specific universe in a 16x32 grid.
 * @return {React.ReactElement} The DmxMonitor component.
 */
const DmxMonitor = () => {
    const { dmxData, universeFilter, setUniverseFilter } = useArtnet();
    
    const universeData = dmxData[universeFilter] || new Uint8Array(512);
    const channels = Array.from({ length: 512 }, (_, i) => i);

    return (
        <div className="dmx-monitor-container" style={{ padding: '10px', background: '#111', borderRadius: '5px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="dmx-monitor-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 style={{ margin: 0, fontSize: '12px', color: '#888', textTransform: 'uppercase' }}>DMX Monitor</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <label style={{ fontSize: '10px', color: '#666' }}>Universe:</label>
                    <input 
                        type="number" 
                        min="0" 
                        max="255" 
                        value={universeFilter} 
                        onChange={(e) => setUniverseFilter(parseInt(e.target.value) || 0)}
                        style={{ width: '50px', background: '#000', color: 'var(--theme-color)', border: '1px solid #333', borderRadius: '3px', fontSize: '11px', textAlign: 'center' }}
                    />
                </div>
            </div>

            <div className="dmx-grid" style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(16, 1fr)', 
                gap: '1px', 
                background: '#333', 
                border: '1px solid #333',
                flex: 1,
                overflowY: 'auto'
            }}>
                {channels.map((ch) => {
                    const value = universeData[ch];
                    const intensity = value / 255;
                    return (
                        <div 
                            key={ch} 
                            title={`CH ${ch + 1}: ${value}`}
                            style={{ 
                                background: '#000', 
                                position: 'relative',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '20px',
                                fontSize: '8px',
                                color: value > 128 ? '#000' : '#666'
                            }}
                        >
                            {/* Visual Fill */}
                            <div style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                width: '100%',
                                height: `${intensity * 100}%`,
                                background: 'var(--theme-color)',
                                opacity: 0.8,
                                zIndex: 1
                            }} />
                            
                            {/* Channel Number (Optional, maybe too small) */}
                            {/* <span style={{ zIndex: 2, pointerEvents: 'none' }}>{ch + 1}</span> */}
                            
                            {/* Value */}
                            <span style={{ zIndex: 2, pointerEvents: 'none', fontWeight: 'bold' }}>{value}</span>
                        </div>
                    );
                })}
            </div>
            
            <div className="dmx-monitor-footer" style={{ marginTop: '5px', fontSize: '9px', color: '#444', textAlign: 'right' }}>
                16x32 Grid (Channels 1-512)
            </div>
        </div>
    );
};

export { DmxMonitor };
