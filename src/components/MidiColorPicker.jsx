import React from 'react';
import { APC40_COLORS } from '../utils/midiColors';

/**
 * Component for selecting MIDI colors based on the APC40 color palette.
 * @param {Object} props - Component props.
 * @param {number} props.value - The current MIDI velocity value representing a color.
 * @param {function(number)} props.onChange - Callback triggered when a new color is selected.
 * @param {string} [props.label] - Optional label for the color picker.
 * @return {React.ReactElement} The MidiColorPicker component.
 */
const MidiColorPicker = ({ value, onChange, label }) => {
    return (
        <div className="midi-color-picker" style={{ marginBottom: '8px' }}>
            {label && <label style={{ display: 'block', fontSize: '10px', color: '#888', marginBottom: '2px' }}>{label}</label>}
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <div 
                    style={{ 
                        width: '20px', 
                        height: '20px', 
                        borderRadius: '3px', 
                        background: APC40_COLORS.find(c => c.velocity === value)?.hex || '#000',
                        border: '1px solid #555'
                    }} 
                />
                <select 
                    value={value} 
                    onChange={(e) => onChange(parseInt(e.target.value))}
                    style={{ 
                        flex: 1, 
                        background: '#111', 
                        color: '#fff', 
                        border: '1px solid #444', 
                        fontSize: '11px', 
                        padding: '2px' 
                    }}
                >
                    {APC40_COLORS.map(c => (
                        <option key={c.velocity} value={c.velocity}>
                            {c.name} ({c.velocity})
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
};

export { MidiColorPicker };
