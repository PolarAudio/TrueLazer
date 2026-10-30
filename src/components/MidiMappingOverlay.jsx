import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from '../i18n';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';
import { useKeyboard } from '../contexts/KeyboardContext';
import { MidiColorPicker } from './MidiColorPicker';
import { THEME_COLORS } from '../utils/midiColors';

const MidiMappingOverlay = () => {
  const { t } = useTranslation();
  const { 
    isMapping: isMidiMapping, 
    mappings: midiMappings, 
    learningId: midiLearningId, 
    setLearningId: setMidiLearningId,
    removeAssignment,
    setMappings,
    midiInputs,
    selectedMidiInputId,
    theme
  } = useMidi();
  const { 
      isMapping: isArtnetMapping, 
      mappings: artnetMappings, 
      learningId: artnetLearningId,
      universeFilter,
      setUniverseFilter
  } = useArtnet() || {};
  const { isMapping: isKeyboardMapping, mappings: keyboardMappings, learningId: keyboardLearningId } = useKeyboard() || {};

  const isMapping = isMidiMapping || isArtnetMapping || isKeyboardMapping;
  const [overlays, setOverlays] = useState([]);

  // Find assignments for the active learningId
  const currentAssignments = useMemo(() => {
      if (!midiLearningId) return [];
      const results = [];
      Object.entries(midiMappings).forEach(([key, assignments]) => {
          assignments.forEach(a => {
              if (a.controlId === midiLearningId) {
                  results.push({ key, ...a });
              }
          });
      });
      return results;
  }, [midiLearningId, midiMappings]);

  const updateAssignment = (key, controlId, field, value) => {
      setMappings(prev => {
          const next = { ...prev };
          if (!next[key]) return prev;
          next[key] = next[key].map(a => {
              if (a.controlId === controlId) return { ...a, [field]: value };
              return a;
          });
          return next;
      });
  };

  const updateOverlayPositions = useCallback(() => {
    if (!isMapping) return;

    const elements = document.querySelectorAll('[data-mappable-id]');
    const newOverlays = Array.from(elements).map(el => {
      const rect = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-mappable-id'),
        rect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        }
      };
    });
    setOverlays(newOverlays);
  }, [isMapping]);

  useEffect(() => {
    if (isMapping) {
      updateOverlayPositions();
      window.addEventListener('resize', updateOverlayPositions);
      // Small delay to ensure layout has settled
      const timer = setTimeout(updateOverlayPositions, 100);
      return () => {
        window.removeEventListener('resize', updateOverlayPositions);
        clearTimeout(timer);
      };
    } else {
      setOverlays([]);
    }
  }, [isMapping, updateOverlayPositions]);

  const currentColors = THEME_COLORS[theme] || THEME_COLORS['orange'];

  if (!isMapping) return null;

  return ReactDOM.createPortal(
    <div className="midi-mapping-global-overlay-container">
      {/* Universe Filter Bar (Art-Net Only) */}
      {isArtnetMapping && (
          <div style={{
              position: 'fixed',
              top: '10px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#1a1a1a',
              border: '1px solid var(--theme-color)',
              borderRadius: '5px',
              padding: '5px 15px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              zIndex: 10002,
              boxShadow: '0 0 20px rgba(0,0,0,0.8)'
          }}>
              <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--theme-color)' }}>{t('midiMapping.dmxFilter')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <label style={{ fontSize: '10px', color: '#888' }}>{t('midiMapping.universe')}:</label>
                  <input 
                    type="number" 
                    min="0" max="255" 
                    value={universeFilter} 
                    onChange={(e) => setUniverseFilter(parseInt(e.target.value) || 0)}
                    style={{ width: '50px', background: '#000', color: '#fff', border: '1px solid #444', textAlign: 'center', fontSize: '11px' }}
                  />
              </div>
              <span style={{ fontSize: '9px', color: '#666' }}>{t('midiMapping.showingUniverse', { universe: universeFilter })}</span>
          </div>
      )}

      {overlays.map(overlay => {
        let mappingLabel = null;
        const isMidi = isMidiMapping;
        const isArtnet = isArtnetMapping;
        const isKeyboard = isKeyboardMapping;

        if (isMidi) {
            // Find ALL hardware keys that have an assignment for this overlay.id
            const linkedHardware = Object.entries(midiMappings).filter(([key, assignments]) => 
                assignments.some(a => a.controlId === overlay.id)
            );
            if (linkedHardware.length > 0) {
                const first = linkedHardware[0][1].find(a => a.controlId === overlay.id);
                mappingLabel = first.label;
                if (linkedHardware.length > 1) mappingLabel += t('midiMapping.plusMore', { count: linkedHardware.length - 1 });
            }
        } else if (isArtnet) {
            const artnetMapping = artnetMappings ? artnetMappings[overlay.id] : null;
            // Only show label if it matches the current universe filter
            if (artnetMapping && artnetMapping.universe === universeFilter) {
                mappingLabel = artnetMapping.label;
            }
        } else if (isKeyboard) {
            const keyboardMapping = keyboardMappings ? keyboardMappings[overlay.id] : null;
            mappingLabel = keyboardMapping ? keyboardMapping.label : null;
        }
        
        const isLearning = (isMidi && midiLearningId === overlay.id) || 
                           (isArtnet && artnetLearningId === overlay.id) ||
                           (isKeyboard && keyboardLearningId === overlay.id);

        return (
          <React.Fragment key={overlay.id}>
            <div
                className={`midi-mapping-label-box ${isLearning ? 'learning' : ''} ${mappingLabel ? 'mapped' : ''} ${isArtnet ? 'artnet-mapping' : ''} ${isKeyboard ? 'keyboard-mapping' : ''}`}
                style={{
                position: 'fixed',
                top: overlay.rect.top,
                left: overlay.rect.left,
                width: overlay.rect.width,
                height: overlay.rect.height,
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999
                }}
            >
                <div className="mapping-label">
                {mappingLabel ? mappingLabel : '+'}
                </div>
            </div>

            {isLearning && isMidi && (
                <div 
                    className="assignment-editor-popup"
                    style={{
                        position: 'fixed',
                        top: overlay.rect.top + overlay.rect.height + 10,
                        left: overlay.rect.left,
                        background: '#1a1a1a',
                        border: '1px solid #444',
                        borderRadius: '5px',
                        padding: '10px',
                        zIndex: 10001,
                        minWidth: '250px',
                        boxShadow: '0 5px 15px rgba(0,0,0,0.5)',
                        pointerEvents: 'auto'
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <h4 style={{ margin: 0, fontSize: '0.9rem' }}>{t('midiMapping.assignments')}</h4>
                        <button onClick={() => setMidiLearningId(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>×</button>
                    </div>

                    {currentAssignments.length > 0 ? (
                        currentAssignments.map((a, i) => (
                            <div key={`${a.key}_${i}`} className="assignment-item" style={{ background: '#222', padding: '8px', borderRadius: '4px', marginBottom: '8px', borderLeft: '3px solid var(--theme-color)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                    <span style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>{a.label}</span>
                                    <button 
                                        onClick={() => removeAssignment(a.key, a.controlId)}
                                        style={{ background: 'none', border: 'none', color: '#ff4444', cursor: 'pointer', fontSize: '12px' }}
                                    >{t('common.remove')}</button>
                                </div>

                                <div className="setting-group" style={{ marginBottom: '5px' }}>
                                    <label style={{ fontSize: '10px', color: '#888', display: 'block' }}>{t('midiMapping.target')}</label>
                                    <select 
                                        value={a.targetType || 'position'} 
                                        onChange={(e) => updateAssignment(a.key, a.controlId, 'targetType', e.target.value)}
                                        style={{ width: '100%', background: '#111', color: '#fff', border: '1px solid #333', fontSize: '10px' }}
                                    >
                                        <option value="position">{t('midiMapping.targetPosition')}</option>
                                        <option value="thisClip">{t('midiMapping.targetThisClip')}</option>
                                        <option value="selectedLayer">{t('midiMapping.targetSelectedLayer')}</option>
                                    </select>
                                </div>

                                <div className="setting-group">
                                    <label style={{ fontSize: '10px', color: '#888', display: 'block' }}>{t('midiMapping.inputDevice')}</label>
                                    <select 
                                        value={a.inputDeviceId || 'any'} 
                                        onChange={(e) => updateAssignment(a.key, a.controlId, 'inputDeviceId', e.target.value)}
                                        style={{ width: '100%', background: '#111', color: '#fff', border: '1px solid #333', fontSize: '10px' }}
                                    >
                                        <option value="any">{t('midiMapping.anyDevice')}</option>
                                        {midiInputs.map(input => <option key={input.id} value={input.id}>{input.name}</option>)}
                                    </select>
                                </div>

                                <div className="feedback-settings" style={{ marginTop: '10px', padding: '5px', background: '#111', borderRadius: '3px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                                        <span style={{ fontSize: '9px', color: 'var(--theme-color)', fontWeight: 'bold' }}>{t('midiMapping.controlMode')}</span>
                                        <select 
                                            value={a.controlMode || 'absolute'}
                                            onChange={(e) => updateAssignment(a.key, a.controlId, 'controlMode', e.target.value)}
                                            style={{ background: '#000', color: '#fff', border: '1px solid #444', fontSize: '9px' }}
                                        >
                                            <option value="absolute">{t('midiMapping.modeAbsolute')}</option>
                                            <option value="relative">{t('midiMapping.modeRelative')}</option>
                                            <option value="fake_relative">{t('midiMapping.modeFakeRelative')}</option>
                                        </select>
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                                        <span style={{ fontSize: '9px', color: 'var(--theme-color)', fontWeight: 'bold' }}>{t('midiMapping.feedback')}</span>
                                        <select 
                                            value={a.feedbackMode || 'toggle'}
                                            onChange={(e) => updateAssignment(a.key, a.controlId, 'feedbackMode', e.target.value)}
                                            style={{ background: '#000', color: '#fff', border: '1px solid #444', fontSize: '9px' }}
                                        >
                                            <option value="toggle">{t('midiMapping.feedbackToggle')}</option>
                                            <option value="clip">{t('midiMapping.feedbackClip')}</option>
                                            <option value="slider">{t('midiMapping.feedbackSlider')}</option>
                                            <option value="dropdown">{t('midiMapping.feedbackDropdown')}</option>
                                        </select>
                                    </div>

                                    {/* Blink Mode Selector */}
                                    <div className="setting-group" style={{ marginBottom: '8px' }}>
                                        <label style={{ fontSize: '9px', color: '#888', display: 'block' }}>{t('midiMapping.blinkMode')}</label>
                                        <select 
                                            value={a.blinkMode || 0}
                                            onChange={(e) => updateAssignment(a.key, a.controlId, 'blinkMode', parseInt(e.target.value))}
                                            style={{ width: '100%', background: '#000', color: '#fff', border: '1px solid #333', fontSize: '9px' }}
                                        >
                                            <option value={0}>{t('midiMapping.blinkStatic')}</option>
                                            <option value={1}>{t('midiMapping.blinkOneshot124')}</option>
                                            <option value={2}>{t('midiMapping.blinkOneshot116')}</option>
                                            <option value={3}>{t('midiMapping.blinkOneshot18')}</option>
                                            <option value={4}>{t('midiMapping.blinkOneshot14')}</option>
                                            <option value={5}>{t('midiMapping.blinkOneshot12')}</option>
                                            <option value={6}>{t('midiMapping.blinkPulsing124')}</option>
                                            <option value={7}>{t('midiMapping.blinkPulsing116')}</option>
                                            <option value={8}>{t('midiMapping.blinkPulsing18')}</option>
                                            <option value={9}>{t('midiMapping.blinkPulsing14')}</option>
                                            <option value={10}>{t('midiMapping.blinkPulsing12')}</option>
                                            <option value={11}>{t('midiMapping.blinkBlinking124')}</option>
                                            <option value={12}>{t('midiMapping.blinkBlinking116')}</option>
                                            <option value={13}>{t('midiMapping.blinkBlinking18')}</option>
                                            <option value={14}>{t('midiMapping.blinkBlinking14')}</option>
                                            <option value={15}>{t('midiMapping.blinkBlinking12')}</option>
                                        </select>
                                    </div>

                                    <div className="color-selectors" style={{ marginTop: '5px' }}>
                                        {(!a.feedbackMode || a.feedbackMode === 'toggle' || a.feedbackMode === 'dropdown') && (
                                            <>
                                                <MidiColorPicker 
                                                    label={t('midiMapping.onColor')}
                                                    value={a.feedbackConfig?.onVelocity ?? currentColors.full}
                                                    onChange={(v) => updateAssignment(a.key, a.controlId, 'feedbackConfig', { ...a.feedbackConfig, onVelocity: v })}
                                                />
                                                <MidiColorPicker 
                                                    label={t('midiMapping.offColor')}
                                                    value={a.feedbackConfig?.offVelocity ?? currentColors.dim}
                                                    onChange={(v) => updateAssignment(a.key, a.controlId, 'feedbackConfig', { ...a.feedbackConfig, offVelocity: v })}
                                                />
                                            </>
                                        )}
                                        {a.feedbackMode === 'clip' && (
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                                                <MidiColorPicker 
                                                    label={t('midiMapping.colorActive')}
                                                    value={a.feedbackConfig?.activeVelocity ?? currentColors.full}
                                                    onChange={(v) => updateAssignment(a.key, a.controlId, 'feedbackConfig', { ...a.feedbackConfig, activeVelocity: v })}
                                                />
                                                <MidiColorPicker 
                                                    label={t('midiMapping.colorPreview')}
                                                    value={a.feedbackConfig?.previewVelocity ?? 64}
                                                    onChange={(v) => updateAssignment(a.key, a.controlId, 'feedbackConfig', { ...a.feedbackConfig, previewVelocity: v })}
                                                />
                                                <MidiColorPicker 
                                                    label={t('midiMapping.colorInactive')}
                                                    value={a.feedbackConfig?.inactiveVelocity ?? currentColors.dim}
                                                    onChange={(v) => updateAssignment(a.key, a.controlId, 'feedbackConfig', { ...a.feedbackConfig, inactiveVelocity: v })}
                                                />
                                                <MidiColorPicker 
                                                    label={t('midiMapping.colorEmpty')}
                                                    value={a.feedbackConfig?.emptyVelocity ?? 0}
                                                    onChange={(v) => updateAssignment(a.key, a.controlId, 'feedbackConfig', { ...a.feedbackConfig, emptyVelocity: v })}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div style={{ textAlign: 'center', padding: '10px', color: '#666', fontSize: '0.8rem' }}>
                            {t('midiMapping.pressHint')}
                        </div>
                    )}
                    
                    {currentAssignments.length > 0 && (
                        <div style={{ fontSize: '9px', color: '#555', marginTop: '5px', textAlign: 'center' }}>
                            {t('midiMapping.pressMore')}
                        </div>
                    )}
                </div>
            )}
          </React.Fragment>
        );
      })}
    </div>,
    document.body
  );
};

export default MidiMappingOverlay;
