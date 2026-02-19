import React, { useState, useEffect } from 'react';

/**
 * Component for selecting, saving, and deleting presets for effects and generators.
 * @param {Object} props - Component props.
 * @param {string} props.type - The type of preset ('effect' or 'generator').
 * @param {string} props.subType - The specific effect or generator ID (e.g., 'color', 'circle').
 * @param {Object} props.currentParams - The current parameter values to be saved as a preset.
 * @param {function(Object)} props.onApplyPreset - Callback triggered when a preset is selected.
 * @param {function(string, string, Object)} props.onRegisterPreset - Callback to register the preset in the project state.
 * @return {React.ReactElement} The PresetSelector component.
 */
const PresetSelector = ({ type, subType, currentParams, onApplyPreset, onRegisterPreset }) => {
    const [presets, setPresets] = useState([]);
    const [selectedPresetName, setSelectedPresetName] = useState('');

    const loadPresets = async () => {
        if (window.electronAPI && window.electronAPI.getPresets) {
            const loaded = await window.electronAPI.getPresets(type, subType);
            setPresets(loaded || []);
        }
    };

    useEffect(() => {
        loadPresets();
    }, [type, subType]);

    const handleSave = async () => {
        const name = prompt('Enter preset name:');
        if (!name) return;

        const preset = {
            name,
            params: currentParams,
        };

        if (window.electronAPI && window.electronAPI.savePreset) {
            const result = await window.electronAPI.savePreset(type, subType, preset);
            if (result.success) {
                loadPresets();
                setSelectedPresetName(name);
                if (onRegisterPreset) onRegisterPreset(type, subType, preset);
            }
        }
    };

    const handleDelete = async () => {
        if (!selectedPresetName) return;
        if (!confirm(`Are you sure you want to delete preset "${selectedPresetName}"?`)) return;

        if (window.electronAPI && window.electronAPI.deletePreset) {
            const result = await window.electronAPI.deletePreset(type, subType, selectedPresetName);
            if (result.success) {
                loadPresets();
                setSelectedPresetName('');
            }
        }
    };

    const handleSelect = (e) => {
        const name = e.target.value;
        setSelectedPresetName(name);
        if (name) {
            const preset = presets.find(p => p.name === name);
            if (preset && onApplyPreset) {
                onApplyPreset(preset.params);
                if (onRegisterPreset) onRegisterPreset(type, subType, preset);
            }
        }
    };

    return (
        <div className="preset-selector" style={{ display: 'flex', gap: '5px', alignItems: 'center', marginBottom: '10px' }}>
            <select 
                value={selectedPresetName} 
                onChange={handleSelect}
                style={{ flex: 1, background: '#111', color: '#fff', border: '1px solid #444', fontSize: '11px', padding: '2px' }}
            >
                <option value="">-- Select Preset --</option>
                {presets.map(p => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                ))}
            </select>
            
            <button 
                onClick={handleSave}
                style={{ background: '#333', border: '1px solid #555', color: '#ccc', cursor: 'pointer', padding: '2px 5px', borderRadius: '3px', display: 'flex', alignItems: 'center' }}
                title="Save Preset"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M11 2H9v3h2V2Z"/>
                    <path d="M1.5 0h11.586a1.5 1.5 0 0 1 1.06.44l1.415 1.414A1.5 1.5 0 0 1 16 2.914V14.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 14.5v-13A1.5 1.5 0 0 1 1.5 0ZM1 1.5v13a.5.5 0 0 0 .5.5H2v-4.5A1.5 1.5 0 0 1 3.5 9h9a1.5 1.5 0 0 1 1.5 1.5V15h.5a.5.5 0 0 0 .5-.5V2.914a.5.5 0 0 0-.146-.353l-1.415-1.415A.5.5 0 0 0 13.086 1H13v4.5A1.5 1.5 0 0 1 11.5 7h-7A1.5 1.5 0 0 1 3 5.5V1H1.5a.5.5 0 0 0-.5.5Zm3-.5v4a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V1H4Zm0 10v4h8v-4a.5.5 0 0 0-.5-.5h-7a.5.5 0 0 0-.5.5Z"/>
                </svg>
            </button>

            <button 
                onClick={handleDelete}
                disabled={!selectedPresetName}
                style={{ background: '#333', border: '1px solid #555', color: selectedPresetName ? '#f44' : '#666', cursor: selectedPresetName ? 'pointer' : 'default', padding: '2px 5px', borderRadius: '3px', display: 'flex', alignItems: 'center' }}
                title="Delete Preset"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5Zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5Zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6Z"/>
                    <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1ZM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118ZM2.5 3h11V2h-11v1Z"/>
                </svg>
            </button>
        </div>
    );
};

export { PresetSelector };
