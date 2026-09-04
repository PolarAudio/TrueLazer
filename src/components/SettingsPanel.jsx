import React, { useState, useEffect } from 'react';
import { useMidi } from '../contexts/MidiContext';
import { useArtnet } from '../contexts/ArtnetContext';
import { useKeyboard } from '../contexts/KeyboardContext';
import GlobalQuickAssigns from './GlobalQuickAssigns';
import CollapsiblePanel from './CollapsiblePanel';

const SettingsPanel = ({
  enabledShortcuts = {},
  onOpenOutputSettings,
  quickAssigns,
  onUpdateKnob,
  onToggleButton,
  onAssign,
  renderSettings = {},
  onSetRenderSetting,
  onClearThumbnailCache
}) => {
  const { 
    midiInitialized, 
    midiInputs, 
    selectedMidiInputId, 
    setSelectedMidiInputId, 
    isMapping, 
    startMapping, 
    stopMapping,
    learningId,
    lastMidiEvent,
    setMappings,
    saveMappings,
    exportMappings: exportMidiMappings,
    importMappings: importMidiMappings
  } = useMidi();

  const collapsedStates = renderSettings.settingsPanelCollapsed || {};

  const handleToggle = (id, val) => {
    if (onSetRenderSetting) {
        onSetRenderSetting('settingsPanelCollapsed', {
            ...collapsedStates,
            [id]: val
        });
    }
  };

  const { 
    artnetInitialized,
    isMapping: isArtnetMapping,
    startMapping: startArtnetMapping,
    stopMapping: stopArtnetMapping,
    setMappings: setArtnetMappings,
    saveMappings: saveArtnetMappings,
    exportMappings: exportArtnetMappings,
    importMappings: importArtnetMappings,
    lastDmxEvent,
    autoPatchFixedFootprint
  } = useArtnet() || {};

  const {
    isMapping: isKeyboardMapping,
    startMapping: startKeyboardMapping,
    stopMapping: stopKeyboardMapping,
    setMappings: setKeyboardMappings,
    saveMappings: saveKeyboardMappings,
    exportMappings: exportKeyboardMappings,
    importMappings: importKeyboardMappings
  } = useKeyboard() || {};

  const [artnetUniverses, setArtnetUniverses] = useState([]);
  const [selectedArtnetUniverseId, setSelectedArtnetUniverseId] = useState('');

  const [oscInitialized, setOscInitialized] = useState(false);
  const [oscLocalPort, setOscLocalPort] = useState(57121);
  const [oscRemoteAddress, setOscRemoteAddress] = useState("127.0.0.1");
  const [oscRemotePort, setOscRemotePort] = useState(57120);
  const [lastOscMessage, setLastOscMessage] = useState(null);

  useEffect(() => {
    const fetchArtnetUniverses = async () => {
      if (!enabledShortcuts.artnet) return;
      try {
        const universes = await window.electronAPI.getArtnetUniverses();
        setArtnetUniverses(universes);
        if (universes.length > 0) {
          setSelectedArtnetUniverseId(universes[0].id);
        }
      } catch (err) {
        console.error("Failed to fetch Art-Net universes:", err);
      }
    };

    const initOsc = async () => {
      if (!enabledShortcuts.osc) return;
      try {
        const result = await window.electronAPI.initializeOsc({
          localPort: oscLocalPort,
          remoteAddress: oscRemoteAddress,
          remotePort: oscRemotePort,
        });
        if (result.success) {
          setOscInitialized(true);
          const cleanupListener = window.electronAPI.onOscMessageReceived(({ oscMessage }) => {
            setLastOscMessage(oscMessage);
          });
          return cleanupListener;
        }
      } catch (err) {
        console.error("Failed to initialize OSC:", err);
      }
    };

    let cleanupOscListener = () => {};
    fetchArtnetUniverses();
    initOsc().then(cleanup => { 
        if (typeof cleanup === 'function') cleanupOscListener = cleanup; 
    });

    return () => {
      if (typeof cleanupOscListener === 'function') cleanupOscListener();
    };
  }, [enabledShortcuts]);

  const handleMidiInputChange = (e) => setSelectedMidiInputId(e.target.value);
  const toggleMidiLearnMode = () => isMapping ? stopMapping() : startMapping();
  const toggleArtnetLearnMode = () => isArtnetMapping ? stopArtnetMapping() : startArtnetMapping();
  const toggleKeyboardLearnMode = () => isKeyboardMapping ? stopKeyboardMapping() : startKeyboardMapping();

  return (
    <div className="settings-panel settings-panel-base">
      <div className="settings-card-header"><h4>Global Settings</h4></div>

      {quickAssigns && (
          <CollapsiblePanel 
            title="Quick Assigns"
            isCollapsed={!!collapsedStates['quickAssigns']}
            onToggle={(val) => handleToggle('quickAssigns', val)}
          >
              <GlobalQuickAssigns 
                  assigns={quickAssigns}
                  onUpdateKnob={onUpdateKnob}
                  onToggleButton={onToggleButton}
                  onAssign={onAssign}
              />
          </CollapsiblePanel>
      )}

      {/* Channel/DAC Settings Placeholder */}
      <CollapsiblePanel 
        title="Channel/DAC Settings"
        isCollapsed={!!collapsedStates['dacSettings']}
        onToggle={(val) => handleToggle('dacSettings', val)}
      >
          <p className="info-text">Output routing and safety zones configuration.</p>
          <button className="small-btn" style={{width:'100%', marginTop:'5px'}} onClick={onOpenOutputSettings}>Open Output Settings</button>
      </CollapsiblePanel>

      <CollapsiblePanel 
        title="ILDA Parsing"
        isCollapsed={!!collapsedStates['ildaParsing']}
        onToggle={(val) => handleToggle('ildaParsing', val)}
      >
          <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <label className="param-label" style={{ fontSize: '11px' }}>Parse Mode</label>
              <select
                  className="param-select"
                  value="legacy"
                  onChange={(e) => onSetRenderSetting('ildaParseMode', 'legacy')}
                  style={{ width: '130px', fontSize: '11px' }}
                  disabled
              >
                  <option value="legacy">Legacy Backup (default)</option>
              </select>
          </div>
          <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
              Vector Convert is temporarily disabled while the shape remastering
              pipeline is reworked. Files are parsed with the default point-based
              processing (Legacy), which always preserves the original geometry.
          </p>
      </CollapsiblePanel>

      <CollapsiblePanel 
        title="Processing"
        isCollapsed={!!collapsedStates['processing']}
        onToggle={(val) => handleToggle('processing', val)}
      >
          <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label className="param-label" style={{ fontSize: '11px' }}>Point Optimization</label>
              <input 
                type="checkbox" 
                checked={renderSettings.optimizationEnabled} 
                onChange={(e) => onSetRenderSetting('optimizationEnabled', e.target.checked)}
              />
          </div>
          <OptimizerSettingsEditor
            settings={renderSettings.optimizationSettings || {}}
            onSetRenderSetting={onSetRenderSetting}
          />

          <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '14px' }}>
              <label className="param-label" style={{ fontSize: '11px' }}>Layer Merge</label>
              <select
                  className="param-select"
                  value={renderSettings.layerMergeMode || 'priority'}
                  onChange={(e) => onSetRenderSetting('layerMergeMode', e.target.value)}
                  style={{ width: '150px', fontSize: '11px' }}
              >
                  <option value="priority">Off (Layer Priority)</option>
                  <option value="combine">On (Sequential)</option>
                  <option value="overlay">On (Overlay - Cut)</option>
              </select>
          </div>
          <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
              Off: one clip per DAC channel (highest-layer priority). On/Sequential:
              all clips play in sequence per channel. On/Overlay: lower layers are
              cut where they fall behind higher layers. The shape-preserving point
              budget (PPS/FPS per channel) is enforced at this merge step.
          </p>
      </CollapsiblePanel>


      {/* Shortcuts Settings Section */}
      {(enabledShortcuts.midi || enabledShortcuts.artnet || enabledShortcuts.osc || enabledShortcuts.keyboard) && (
        <div className="shortcuts-settings-panel">
          {enabledShortcuts.keyboard && (
            <CollapsiblePanel 
                title="Keyboard Shortcuts"
                isCollapsed={!!collapsedStates['keyboard']}
                onToggle={(val) => handleToggle('keyboard', val)}
            >
                <div className="keyboard-config">
                    <div className="button-grid">
                      <button 
                          className={`mapping-btn ${isKeyboardMapping ? 'active' : ''}`} 
                          onClick={toggleKeyboardLearnMode}
                          style={{ backgroundColor: isKeyboardMapping ? 'var(--theme-color)' : '', gridColumn: 'span 2' }}
                      >
                          {isKeyboardMapping ? 'Stop Mapping' : 'Start Mapping'}
                      </button>
                      <button className="small-btn" onClick={saveKeyboardMappings}>Save Default</button>
                      <button className="small-btn" onClick={exportKeyboardMappings}>Export</button>
                      <button className="small-btn" onClick={importKeyboardMappings}>Import</button>
                      <button className="small-btn clear" onClick={() => setKeyboardMappings({})}>Clear</button>
                    </div>
                    <p className="info-text" style={{fontSize: '9px', color: '#666', marginTop: '5px'}}>
                        Assign keys to buttons/sliders by activating "Start Mapping" and clicking a control.
                    </p>
                </div>
            </CollapsiblePanel>
          )}
          {enabledShortcuts.midi && (
            <CollapsiblePanel 
                title="MIDI Shortcuts"
                isCollapsed={!!collapsedStates['midi']}
                onToggle={(val) => handleToggle('midi', val)}
            >
                {!midiInitialized ? (
                  <p className="loading-text">Initializing MIDI...</p>
                ) : (
                  <div className="midi-config">
                    <select className="param-select" value={selectedMidiInputId} onChange={handleMidiInputChange} style={{ marginBottom: '8px', width: '100%' }}>
                      {midiInputs.map(input => (
                        <option key={input.id} value={input.id}>{input.name}</option>
                      ))}
                    </select>
                    <div className="button-grid">
                      <button 
                          className={`mapping-btn ${isMapping ? 'active' : ''}`} 
                          onClick={toggleMidiLearnMode}
                          style={{ backgroundColor: isMapping ? 'var(--theme-color)' : '', gridColumn: 'span 2' }}
                      >
                          {isMapping ? 'Stop Mapping' : 'Start Mapping'}
                      </button>
                      <button className="small-btn" onClick={saveMappings}>Save Default</button>
                      <button className="small-btn" onClick={exportMidiMappings}>Export</button>
                      <button className="small-btn" onClick={importMidiMappings}>Import</button>
                      <button className="small-btn clear" onClick={() => setMappings({})}>Clear</button>
                    </div>
                    {lastMidiEvent && (
                        <div className="last-event-status">
                            {lastMidiEvent.type} {lastMidiEvent.note || lastMidiEvent.controller} (CH{lastMidiEvent.channel})
                        </div>
                    )}
                  </div>
                )}
            </CollapsiblePanel>
          )}

          {enabledShortcuts.artnet && (
            <CollapsiblePanel 
                title="ArtNet Shortcuts"
                isCollapsed={!!collapsedStates['artnet']}
                onToggle={(val) => handleToggle('artnet', val)}
            >
                {!artnetInitialized ? (
                  <p className="loading-text">Initializing Art-Net...</p>
                ) : (
                  <div className="artnet-config">
                    <select 
                      className="param-select"
                      value={selectedArtnetUniverseId} 
                      onChange={(e) => {
                          setSelectedArtnetUniverseId(e.target.value);
                          const universeNumber = parseInt(e.target.value.replace('universe-', ''));
                          if (window.electronAPI && window.electronAPI.listenArtnetUniverse) {
                              window.electronAPI.listenArtnetUniverse(universeNumber);
                          }
                      }}
                      style={{ marginBottom: '8px', width: '100%' }}
                    >
                      {artnetUniverses.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <div className="button-grid">
                      <button 
                          className={`mapping-btn ${isArtnetMapping ? 'active' : ''}`} 
                          onClick={toggleArtnetLearnMode}
                          style={{ backgroundColor: isArtnetMapping ? 'var(--theme-color)' : '', gridColumn: 'span 2' }}
                      >
                          {isArtnetMapping ? 'Stop Mapping' : 'Start Mapping'}
                      </button>
                      <button className="small-btn" onClick={autoPatchFixedFootprint} title="Auto-patch standard 110-channel layout">Auto-Patch</button>
                      <button className="small-btn" onClick={saveArtnetMappings}>Save Default</button>
                      <button className="small-btn" onClick={exportArtnetMappings}>Export</button>
                      <button className="small-btn" onClick={importArtnetMappings}>Import</button>
                      <button className="small-btn clear" onClick={() => setArtnetMappings({})}>Clear</button>
                    </div>
                    {lastDmxEvent && (
                        <div className="last-event-status">
                            UNIV {lastDmxEvent.universe} CH {lastDmxEvent.channel + 1} (Val: {lastDmxEvent.value})
                        </div>
                    )}
                  </div>
                )}
            </CollapsiblePanel>
          )}

{enabledShortcuts.osc && (
            <CollapsiblePanel 
                title="OSC Shortcuts"
                isCollapsed={!!collapsedStates['osc']}
                onToggle={(val) => handleToggle('osc', val)}
            >
                <div className="osc-config">
                  <p className="info-text">Listening on port: {oscLocalPort}</p>
                </div>
            </CollapsiblePanel>
          )}
        </div>
      )}

      <CollapsiblePanel 
        title="Cache"
        isCollapsed={!!collapsedStates['cache']}
        onToggle={(val) => handleToggle('cache', val)}
      >
        <div className="param-editor" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button 
            className="small-btn clear" 
            onClick={onClearThumbnailCache}
            style={{ width: '100%' }}
          >
            Clear Thumbnail Cache
          </button>
          <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '5px' }}>
            Removes all cached file thumbnails. They will be regenerated on next view.
          </p>
        </div>
      </CollapsiblePanel>
    </div>
  );
};

// Compact numeric field used by the optimizer settings editor.
const OptField = ({ label, value, min, max, step = 1, unit = '', onSet }) => (
  <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
    <label className="param-label" style={{ fontSize: '10px' }}>{label}</label>
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <input
        type="number"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onSet(parseFloat(e.target.value))}
        className="param-number-input"
        style={{ width: '52px', fontSize: '11px' }}
      />
      {unit && <span style={{ fontSize: '9px', color: '#888' }}>{unit}</span>}
    </div>
  </div>
);

// Editor for the full optimizer parameter set (Area 3).
const OptimizerSettingsEditor = ({ settings = {}, onSetRenderSetting }) => {
  const S = (k, v) => onSetRenderSetting(`opt.${k}`, v);
  const num = (k) => settings[k] !== undefined ? settings[k] : 0;

  return (
    <div style={{ marginTop: '8px', borderTop: '1px solid #333', paddingTop: '8px' }}>
      <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>Blanking</div>
      <OptField label="Blanking Start" value={num('blankingStart')} min={0} max={30} step={1} onSet={(v) => S('blankingStart', v)} />
      <OptField label="Blanking End" value={num('blankingEnd')} min={0} max={30} step={1} onSet={(v) => S('blankingEnd', v)} />
      <OptField label="Color Shift" value={num('shift')} min={-20} max={20} step={1} onSet={(v) => S('shift', v)} />
      <OptField label="Shift R" value={num('shiftR')} min={-20} max={20} step={1} onSet={(v) => S('shiftR', v)} />
      <OptField label="Shift G" value={num('shiftG')} min={-20} max={20} step={1} onSet={(v) => S('shiftG', v)} />
      <OptField label="Shift B" value={num('shiftB')} min={-20} max={20} step={1} onSet={(v) => S('shiftB', v)} />
      <div style={{ fontSize: '9px', color: '#888', margin: '8px 0 4px' }}>Anchors</div>
      <OptField label="Start Anchor" value={num('anchorStart')} min={0} max={20} step={1} onSet={(v) => S('anchorStart', v)} />
      <OptField label="End Anchor" value={num('anchorEnd')} min={0} max={20} step={1} onSet={(v) => S('anchorEnd', v)} />
      <div style={{ fontSize: '9px', color: '#888', margin: '8px 0 4px' }}>Lit Dwell</div>
      <OptField label="Start Lit Dwell" value={num('litDwellStart')} min={0} max={10} step={1} onSet={(v) => S('litDwellStart', v)} />
      <OptField label="End Lit Dwell" value={num('litDwellEnd')} min={0} max={10} step={1} onSet={(v) => S('litDwellEnd', v)} />
      <div style={{ fontSize: '9px', color: '#888', margin: '8px 0 4px' }}>Interpolation / Corners</div>
      <OptField label="Lit Interp Dist" value={num('interpDistance')} min={0} max={1000} step={5} onSet={(v) => S('interpDistance', v)} />
      <OptField label="Corner Dwell" value={num('cornerDwell')} min={0} max={30} step={1} onSet={(v) => S('cornerDwell', v)} />
      <OptField label="Corner Threshold" value={num('cornerThreshold')} min={0} max={120} step={1} unit="°" onSet={(v) => S('cornerThreshold', v)} />
      <div style={{ fontSize: '9px', color: '#888', margin: '8px 0 4px' }}>Frame</div>
      <OptField label="Min Points/Frame" value={num('minPadding')} min={0} max={1000} step={10} onSet={(v) => S('minPadding', v)} />
      <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '10px' }}>
        Optimizes geometry for the target PPS/FPS before applying effects. Hardware presets
        pre-load these values per scanner class.
      </p>
    </div>
  );
};

export default SettingsPanel;
