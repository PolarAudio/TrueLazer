import React, { useState, useEffect } from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import EffectEditor from './EffectEditor';

const LayerSettingsPanel = ({ 
    selectedLayerIndex, 
    autopilotMode, 
    onAutopilotChange,
    layerEffects,
    assignedDacs = [],
    onToggleDacMirror,
    onRemoveDac,
    onAddEffect,
    onRemoveEffect,
    onParamChange,
    uiState,
    onUpdateUiState
}) => {
    const [dacStatuses, setDacStatuses] = useState({});

    const collapsedPanels = uiState?.collapsedPanels || {};

    const togglePanel = (panelId, val) => {
        if (onUpdateUiState) {
            onUpdateUiState({
                collapsedPanels: {
                    ...collapsedPanels,
                    [panelId]: val
                }
            });
        }
    };

    useEffect(() => {
        if (window.electronAPI && window.electronAPI.onDacStatus) {
            const unsubscribe = window.electronAPI.onDacStatus((data) => {
                setDacStatuses(prev => ({
                    ...prev,
                    [data.ip]: data.status
                }));
            });
            return unsubscribe;
        }
    }, []);

    if (selectedLayerIndex === null) return (
        <div className="settings-panel-base">
            <p className="info-text">Select a layer to edit settings</p>
        </div>
    );

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            const effectData = JSON.parse(e.dataTransfer.getData('application/json'));
            if (effectData && effectData.id) { 
                 onAddEffect(effectData);
            }
        } catch (err) {
            console.error("Failed to drop effect:", err);
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };

    return (
        <div className="settings-panel-base" onDrop={handleDrop} onDragOver={handleDragOver}>
             {/* Assigned DACs Section */}
             {assignedDacs && assignedDacs.length > 0 && (
                <CollapsiblePanel 
                    title="Assigned DACs"
                    isCollapsed={!!collapsedPanels['dacs']}
                    onToggle={(val) => togglePanel('dacs', val)}
                >
                    <ul className="assigned-dacs-list">
                    {assignedDacs.map((dac, index) => {
                        const status = dacStatuses[dac.ip];
                        return (
                        <li key={`${dac.unitID || dac.ip}-${dac.channel}-${index}`} className="assigned-dac-item">
                        <div className="dac-info-block">
                            <span className="dac-name-tiny">{dac.hostName || dac.ip} - Ch {dac.channel}</span>
                            {status && (
                                <div className="dac-status-tiny" style={{fontSize: '9px', color: '#888'}}>
                                    State: {status.playback_state === 2 ? 'PLAYING' : status.playback_state === 1 ? 'PREPARED' : 'IDLE'} | 
                                    Buf: {status.buffer_fullness}{status.buffer_capacity ? `/${status.buffer_capacity}` : ''} | 
                                    PPS: {status.point_rate}
                                </div>
                            )}
                        </div>
                        <div className="dac-mirror-controls">
                            <button 
                                className={`mirror-btn ${dac.mirrorX ? 'active' : ''}`}
                                onClick={() => onToggleDacMirror(selectedLayerIndex, index, 'x')}
                                title="Mirror X Axis"
                            >X</button>
                            <button 
                                className={`mirror-btn ${dac.mirrorY ? 'active' : ''}`}
                                onClick={() => onToggleDacMirror(selectedLayerIndex, index, 'y')}
                                title="Mirror Y Axis"
                            >Y</button>
                        </div>
                        <button className="remove-dac-btn" onClick={() => onRemoveDac(selectedLayerIndex, index)}>×</button>
                        </li>
                    )})}
                    </ul>
                </CollapsiblePanel>
             )}

             {/* Autopilot Section */}
             <CollapsiblePanel 
                title={`Layer ${selectedLayerIndex + 1} Autopilot`}
                isCollapsed={!!collapsedPanels['autopilot']}
                onToggle={(val) => togglePanel('autopilot', val)}
             >
                 <div className="param-editor">
                    <label>Mode</label>
                    <div className="clip-playback-settings">
                        <div className="playback-mode-selector">
                            <button className={autopilotMode === 'off' ? 'active' : ''} onClick={() => onAutopilotChange('off')}>
							OFF
							</button>
                            <button className={autopilotMode === 'forward' ? 'active' : ''} onClick={() => onAutopilotChange('forward')}>
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-forward-fill" viewBox="0 0 16 16">
									<path d="m9.77 12.11 4.012-2.953a.647.647 0 0 0 0-1.114L9.771 5.09a.644.644 0 0 0-.971.557V6.65H2v3.9h6.8v1.003c0 .505.545.808.97.557"/>
								</svg>
							</button>
                            <button className={autopilotMode === 'random' ? 'active' : ''} onClick={() => onAutopilotChange('random')}>
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-shuffle" viewBox="0 0 16 16">
									<path fillRule="evenodd" d="M0 3.5A.5.5 0 0 1 .5 3H1c2.202 0 3.827 1.24 4.874 2.418.49.552.865 1.102 1.126 1.532.26-.43.636-.98 1.126-1.532C9.173 4.24 10.798 3 13 3v1c-1.798 0-3.173 1.01-4.126 2.082A9.6 9.6 0 0 0 7.556 8a9.6 9.6 0 0 0 1.317 1.918C9.828 10.99 11.204 12 13 12v1c-2.202 0-3.827-1.24-4.874-2.418A10.6 10.6 0 0 1 7 9.05c-.26.43-.636.98-1.126 1.532C4.827 11.76 3.202 13 1 13H.5a.5.5 0 0 1 0-1H1c1.798 0 3.173-1.01 4.126-2.082A9.6 9.6 0 0 0 6.444 8a9.6 9.6 0 0 0-1.317-1.918C4.172 5.01 2.796 4 1 4H.5a.5.5 0 0 1-.5-.5"/>
									<path d="M13 5.466V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m0 9v-3.932a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192"/>
								</svg>
							</button>
                        </div>
                    </div>
                </div>
             </CollapsiblePanel>

             {/* Layer Effects Section */}
             <CollapsiblePanel 
                title="Layer Effects"
                isCollapsed={!!collapsedPanels['effects']}
                onToggle={(val) => togglePanel('effects', val)}
             >
                 <div className="layer-effects-list" style={{ minHeight: '50px' }}>
                 {layerEffects && layerEffects.length > 0 ? (
                     layerEffects.map((effect, index) => (
                         <EffectEditor
                             key={effect.instanceId || index}
                             effect={effect}
                             onRemove={() => onRemoveEffect(index)}
                             onParamChange={(paramId, val) => onParamChange(index, paramId, val)}
                             syncSettings={{}} 
                             onSetParamSync={() => {}} 
                             context={{ layerIndex: selectedLayerIndex, colIndex: null, effectIndex: index, targetType: 'layerEffect' }}
                             uiState={uiState}
                             onUpdateUiState={onUpdateUiState}
                         />
                     ))
                 ) : (
                     <div className="info-text" style={{padding: '20px', border: '1px dashed #444', borderRadius: '5px'}}>
                        Drag Effects Here
                     </div>
                 )}
                 </div>
             </CollapsiblePanel>
        </div>
    );
};

export default LayerSettingsPanel;