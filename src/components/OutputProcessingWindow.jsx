import React from 'react';

const OutputProcessingWindow = ({ show, onClose, renderSettings = {}, onSetRenderSetting }) => {
  if (!show) return null;

  return (
    <>
      <div className="modal-overlay">
        <div className="modal-content output-processing-window" style={{ minWidth: '460px', maxHeight: '90vh', overflowY: 'auto' }}>
          <div className="modal-header">
            <h3>Output Processing</h3>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <div className="output-processing-section">
              <h4 style={{ marginBottom: '10px', fontSize: '13px' }}>Processing</h4>
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
                  style={{ width: '170px', fontSize: '11px' }}
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
            </div>
          </div>
        </div>
      </div>
      <style>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 10001;
        }
        .modal-content {
          background: #222;
          color: white;
          border-radius: 8px;
          border: 1px solid #444;
          padding: 0;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .modal-header {
          background: #333;
          padding: 10px 15px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .modal-body {
          padding: 20px;
        }
        .close-btn {
          background: none;
          border: none;
          color: white;
          font-size: 20px;
          cursor: pointer;
        }
        .close-btn:hover {
          color: #ff6b6b;
        }
      `}</style>
    </>
  );
};

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

export default OutputProcessingWindow;