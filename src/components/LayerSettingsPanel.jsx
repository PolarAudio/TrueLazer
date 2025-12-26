import React from 'react';

const LayerSettingsPanel = ({ selectedLayerIndex, autopilotMode, onAutopilotChange }) => {
    if (selectedLayerIndex === null) return (
        <div className="settings-panel-base">
            <div className="settings-card-header"><h4>Layer Settings</h4></div>
            <div className="settings-card-content"><p className="info-text">Select a layer to edit settings</p></div>
        </div>
    );

    return (
        <div className="settings-panel-base">
            <div className="settings-card-header">
                <h4>Layer {selectedLayerIndex + 1} Settings</h4>
            </div>
            <div className="settings-card-content">
                <div className="param-editor">
                    <label>Autopilot</label>
                    <div className="clip-playback-settings">
                        <div className="playback-mode-selector">
                            <button 
                                className={autopilotMode === 'off' ? 'active' : ''} 
                                onClick={() => onAutopilotChange('off')}
                            >OFF</button>
                            <button 
                                className={autopilotMode === 'forward' ? 'active' : ''} 
                                onClick={() => onAutopilotChange('forward')}
                            >ON</button>
                            <button 
                                className={autopilotMode === 'random' ? 'active' : ''} 
                                onClick={() => onAutopilotChange('random')}
                            >RND</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LayerSettingsPanel;
