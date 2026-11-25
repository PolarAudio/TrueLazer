import React, { useState, useEffect } from 'react';
import { useTranslation } from '../i18n';

const OutputProcessingWindow = ({ show, onClose, renderSettings = {}, onSetRenderSetting }) => {
  const { t } = useTranslation();
  if (!show) return null;

  return (
    <>
      <div className="modal-overlay">
        <div className="modal-content output-processing-window" style={{ minWidth: '460px', maxHeight: '90vh', overflowY: 'auto' }}>
          <div className="modal-header">
              <h3>{t('outputProcessing.title')}</h3>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <div className="output-processing-section">
                <h4 style={{ marginBottom: '10px', fontSize: '13px' }}>{t('outputProcessing.processing')}</h4>
              <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label className="param-label" style={{ fontSize: '11px' }}>{t('outputProcessing.pointOptimization')}</label>
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
                <label className="param-label" style={{ fontSize: '11px' }}>{t('outputProcessing.layerMerge')}</label>
                <select
                  className="param-select"
                  value={renderSettings.layerMergeMode || 'priority'}
                  onChange={(e) => onSetRenderSetting('layerMergeMode', e.target.value)}
                  style={{ width: '170px', fontSize: '11px' }}
                >
                  <option value="priority">{t('outputProcessing.layerMergeOff')}</option>
                  <option value="combine">{t('outputProcessing.layerMergeSequential')}</option>
                  <option value="overlay">{t('outputProcessing.layerMergeOverlay')}</option>
                </select>
              </div>
              <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '4px' }}>
                Off: one clip per DAC channel (highest-layer priority). On/Sequential:
                all clips play in sequence per channel. On/Overlay: lower layers are
                cut where they fall behind higher layers. The shape-preserving point
                budget (PPS/FPS per channel) is enforced at this merge step.
              </p>
            </div>
            <div className="output-processing-section" style={{ marginTop: '16px' }}>
              <h4 style={{ marginBottom: '10px', fontSize: '13px' }}>DAC timing (Showbridge)</h4>
              <ShowbridgeTuningControls />
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
  const { t } = useTranslation();

  return (
    <div style={{ marginTop: '8px', borderTop: '1px solid #333', paddingTop: '8px' }}>
      <div style={{ fontSize: '9px', color: '#888', marginBottom: '4px' }}>{t('ui.blanking')}</div>
      <OptField label={t('ui.blanking_start')} value={num('blankingStart')} min={0} max={30} step={1} onSet={(v) => S('blankingStart', v)} />
      <OptField label={t('ui.blanking_end')} value={num('blankingEnd')} min={0} max={30} step={1} onSet={(v) => S('blankingEnd', v)} />
      <OptField label={t('ui.color_shift')} value={num('shift')} min={-20} max={20} step={1} onSet={(v) => S('shift', v)} />
      <OptField label={t('ui.shift_r')} value={num('shiftR')} min={-20} max={20} step={1} onSet={(v) => S('shiftR', v)} />
      <OptField label={t('ui.shift_g')} value={num('shiftG')} min={-20} max={20} step={1} onSet={(v) => S('shiftG', v)} />
      <OptField label={t('ui.shift_b')} value={num('shiftB')} min={-20} max={20} step={1} onSet={(v) => S('shiftB', v)} />
      <div style={{ fontSize: '9px', color: '#888', margin: '8px 0 4px' }}>{t('ui.anchors')}</div>
      <OptField label={t('ui.start_anchor')} value={num('anchorStart')} min={0} max={20} step={1} onSet={(v) => S('anchorStart', v)} />
      <OptField label={t('ui.end_anchor')} value={num('anchorEnd')} min={0} max={20} step={1} onSet={(v) => S('anchorEnd', v)} />
      <div style={{ fontSize: '9px', color: '#888', margin: '8px 0 4px' }}>{t('ui.lit_dwell')}</div>
      <OptField label={t('ui.start_lit_dwell')} value={num('litDwellStart')} min={0} max={10} step={1} onSet={(v) => S('litDwellStart', v)} />
      <OptField label={t('ui.end_lit_dwell')} value={num('litDwellEnd')} min={0} max={10} step={1} onSet={(v) => S('litDwellEnd', v)} />
      <div style={{ fontSize: '9px', color: '#888', margin: '8px 0 4px' }}>{t('ui.interpolation_corners')}</div>
      <OptField label={t('ui.lit_interp_dist')} value={num('interpDistance')} min={0} max={1000} step={5} onSet={(v) => S('interpDistance', v)} />
      <OptField label={t('ui.corner_dwell')} value={num('cornerDwell')} min={0} max={30} step={1} onSet={(v) => S('cornerDwell', v)} />
      <OptField label={t('ui.corner_threshold')} value={num('cornerThreshold')} min={0} max={120} step={1} unit="°" onSet={(v) => S('cornerThreshold', v)} />
      <div style={{ fontSize: '9px', color: '#888', margin: '8px 0 4px' }}>{t('ui.frame')}</div>
      <OptField label={t('ui.min_points_frame')} value={num('minPadding')} min={0} max={1000} step={10} onSet={(v) => S('minPadding', v)} />
      <p className="info-text" style={{ fontSize: '9px', color: '#666', marginTop: '10px' }}>
        Optimizes geometry for the target PPS/FPS before applying effects. Hardware presets
        pre-load these values per scanner class.
      </p>
    </div>
  );
};

const TuningField = ({ label, value, setValue, min, max, step, loaded, onSet, unit }) => (
  <div className="param-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
    <label className="param-label" style={{ fontSize: '11px' }}>{label}{unit ? ` (${unit})` : ''}</label>
    <input
      type="number"
      min={min} max={max} step={step}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!Number.isFinite(v)) return;
        setValue(v);
        try { onSet && onSet(v); } catch { /* ignore */ }
      }}
      className="param-number-input"
      style={{ width: '60px', fontSize: '11px' }}
      disabled={!loaded}
    />
  </div>
);

const ShowbridgeTuningControls = () => {
  const [loaded, setLoaded] = useState(false);
  const [stagger, setStagger] = useState(6);
  const [leadIn, setLeadIn] = useState(10);
  const [hold, setHold] = useState(20);
  const [closeThr, setCloseThr] = useState(0.05);
  const [interp, setInterp] = useState(0.05);
  const [pps, setPps] = useState(30);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = window.electronAPI;
      try {
        if (api?.getShowbridgeChunkStagger) { const v = await api.getShowbridgeChunkStagger(); if (!cancelled && Number.isFinite(v)) setStagger(v); }
        if (api?.getShowbridgeLeadIn) { const v = await api.getShowbridgeLeadIn(); if (!cancelled && Number.isFinite(v)) setLeadIn(v); }
        if (api?.getShowbridgeHoldCount) { const v = await api.getShowbridgeHoldCount(); if (!cancelled && Number.isFinite(v)) setHold(v); }
        if (api?.getShowbridgeCloseThreshold) { const v = await api.getShowbridgeCloseThreshold(); if (!cancelled && Number.isFinite(v)) setCloseThr(v); }
        if (api?.getShowbridgeInterpStep) { const v = await api.getShowbridgeInterpStep(); if (!cancelled && Number.isFinite(v)) setInterp(v); }
        if (api?.getShowbridgePps) { const v = await api.getShowbridgePps(); if (!cancelled && Number.isFinite(v)) setPps(v); }
      } catch { /* ignore */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  return (
    <div>
      <TuningField label="Chunk stagger" unit="ms" value={stagger} setValue={setStagger} min={0} max={50} step={1} loaded={loaded}
        onSet={(v) => api?.setShowbridgeChunkStagger?.(v)} />
      <TuningField label="Lead-in points" value={leadIn} setValue={setLeadIn} min={0} max={60} step={1} loaded={loaded}
        onSet={(v) => api?.setShowbridgeLeadIn?.(v)} />
      <TuningField label="Hold count" value={hold} setValue={setHold} min={0} max={60} step={1} loaded={loaded}
        onSet={(v) => api?.setShowbridgeHoldCount?.(v)} />
      <TuningField label="Close-shape threshold" value={closeThr} setValue={setCloseThr} min={0} max={1} step={0.01} loaded={loaded}
        onSet={(v) => api?.setShowbridgeCloseThreshold?.(v)} />
      <TuningField label="Interp step size" value={interp} setValue={setInterp} min={0.001} max={1} step={0.01} loaded={loaded}
        onSet={(v) => api?.setShowbridgeInterpStep?.(v)} />
      <TuningField label="PPS (kpps)" value={pps} setValue={setPps} min={1} max={255} step={1} loaded={loaded}
        onSet={(v) => api?.setShowbridgePps?.(v)} />
    </div>
  );
};

export default OutputProcessingWindow;