import React from 'react';

const SettingsPanel = ({ effects, onParameterChange, selectedLayerIndex, selectedColIndex }) => {
  if (!effects || effects.length === 0) {
    return (
      <div className="settings-panel">
        <h3>Settings</h3>
        <p>No effects applied to the selected clip/layer.</p>
      </div>
    );
  }

  return (
    <div className="settings-panel">
      <h3>Settings</h3>
      {effects.map((effect, effectIndex) => (
        <div key={effectIndex} className="effect-settings">
          <h4>{effect.id.charAt(0).toUpperCase() + effect.id.slice(1)} Effect</h4>
          {
            effect.id === 'rotate' && (
              <>
                <div>
                  <label>Mode:</label>
                  <select
                    value={effect.params.mode}
                    onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'mode', e.target.value)}
                  >
                    <option value="animated">Animated</option>
                    <option value="static">Static</option>
                  </select>
                </div>
                {effect.params.mode === 'animated' ? (
                  <>
                    <div>
                      <label>Speed:</label>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        step="0.1"
                        value={effect.params.speed}
                        onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'speed', parseFloat(e.target.value))}
                      />
                      <span>{effect.params.speed}</span>
                    </div>
                    <div>
                      <label>Direction:</label>
                      <select
                        value={effect.params.direction}
                        onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'direction', e.target.value)}
                      >
                        <option value="cw">CW</option>
                        <option value="ccw">CCW</option>
                      </select>
                    </div>
                  </>
                ) : (
                  <div>
                    <label>Angle (degrees):</label>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      step="1"
                      value={effect.params.angle}
                      onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'angle', parseFloat(e.target.value))}
                    />
                    <span>{effect.params.angle}</span>
                  </div>
                )}
                <div>
                  <label>Axis:</label>
                  <select
                    value={effect.params.axis}
                    onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'axis', e.target.value)}
                  >
                    <option value="x">X</option>
                    <option value="y">Y</option>
                    <option value="z">Z</option>
                  </select>
                </div>
              </>
            )
          }
          {
            effect.id === 'scale' && (
              <>
                <div>
                  <label>Mode:</label>
                  <select
                    value={effect.params.mode}
                    onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'mode', e.target.value)}
                  >
                    <option value="static">Static</option>
                    <option value="animated">Animated</option>
                  </select>
                </div>

                {effect.params.mode === 'animated' ? (
                  <>
                    <div>
                      <label>Animated Mode:</label>
                      <select
                        value={effect.params.animatedMode}
                        onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'animatedMode', e.target.value)}
                      >
                        <option value="oscillate">Oscillate</option>
                        <option value="grow">Grow</option>
                        <option value="shrink">Shrink</option>
                      </select>
                    </div>
                    <div>
                      <label>Speed:</label>
                      <input
                        type="range"
                        min="0.1"
                        max="10"
                        step="0.1"
                        value={effect.params.speed}
                        onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'speed', parseFloat(e.target.value))}
                      />
                      <span>{effect.params.speed}</span>
                    </div>
                    <div>
                      <label>Min Scale:</label>
                      <input
                        type="range"
                        min="0.01"
                        max="2"
                        step="0.01"
                        value={effect.params.minScale}
                        onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'minScale', parseFloat(e.target.value))}
                      />
                      <span>{effect.params.minScale}</span>
                    </div>
                    <div>
                      <label>Max Scale:</label>
                      <input
                        type="range"
                        min="0.1"
                        max="5"
                        step="0.1"
                        value={effect.params.maxScale}
                        onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'maxScale', parseFloat(e.target.value))}
                      />
                      <span>{effect.params.maxScale}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label>Scale X:</label>
                      <input
                        type="range"
                        min="0.1"
                        max="5"
                        step="0.1"
                        value={effect.params.scaleX}
                        onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'scaleX', parseFloat(e.target.value))}
                      />
                      <span>{effect.params.scaleX}</span>
                    </div>
                    <div>
                      <label>Scale Y:</label>
                      <input
                        type="range"
                        min="0.1"
                        max="5"
                        step="0.1"
                        value={effect.params.scaleY}
                        onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'scaleY', parseFloat(e.target.value))}
                      />
                      <span>{effect.params.scaleY}</span>
                    </div>
                    <div>
                      <label>Scale Z:</label>
                      <input
                        type="range"
                        min="0.1"
                        max="5"
                        step="0.1"
                        value={effect.params.scaleZ}
                        onChange={(e) => onParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, 'scaleZ', parseFloat(e.target.value))}
                      />
                      <span>{effect.params.scaleZ}</span>
                    </div>
                  </>
                )}
              </>
            )
          }
        </div>
      ))}
    </div>
  );
};

export default SettingsPanel;
