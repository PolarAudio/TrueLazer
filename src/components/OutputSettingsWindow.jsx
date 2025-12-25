import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// Canvas component for the safety zones and output area interaction
const OutputCanvas = ({ 
  safetyZones, 
  outputArea, 
  testLineY, 
  testLineEnabled, 
  transformationEnabled,
  transformationMode,
  onUpdateSafetyZones, 
  onUpdateOutputArea, 
  selectedZoneIndex, 
  onSelectZone,
  gridSize = 20,
  snapToGrid = false
}) => {
  const canvasRef = useRef(null);
  const [dragging, setDragging] = useState(null); // { type, index, handle, startX, startY, originalRect }

  const drawGrid = (ctx, width, height) => {
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= gridSize; i++) {
      const pos = i / gridSize;
      const x = pos * width;
      const y = pos * height;
      
      ctx.moveTo(x, 0); ctx.lineTo(x, height);
      ctx.moveTo(0, y); ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Highlight center
    ctx.strokeStyle = '#666'; 
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height);
    ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Coordinates
    ctx.fillStyle = '#aaa';
    ctx.font = '10px monospace';
    ctx.fillText('0,0', 5, 12);
    ctx.fillText('1,0', width - 25, 12);
    ctx.fillText('0,1', 5, height - 5);
    ctx.fillText('1,1', width - 25, height - 5);
  };

  const drawRect = (ctx, rect, color, isSelected = false, isOutputArea = false) => {
    const { x, y, w, h } = rect;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = isSelected ? '#fff' : (isOutputArea ? '#0089ff' : '#ff0000');
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(x, y, w, h);

    if (isSelected || isOutputArea) {
      // Draw handles
      const handleSize = 6;
      ctx.fillStyle = '#fff';
      const drawHandle = (hx, hy) => ctx.fillRect(hx - handleSize/2, hy - handleSize/2, handleSize, handleSize);
      // Corners
      drawHandle(x, y);
      drawHandle(x + w, y);
      drawHandle(x, y + h);
      drawHandle(x + w, y + h);
      
      // Edges (Visual cue optional, but good for discovery)
      const edgeSize = 4;
      ctx.fillStyle = '#ccc';
      const drawEdgeHandle = (hx, hy) => ctx.fillRect(hx - edgeSize/2, hy - edgeSize/2, edgeSize, edgeSize);
      drawEdgeHandle(x + w/2, y); // Top
      drawEdgeHandle(x + w/2, y + h); // Bottom
      drawEdgeHandle(x, y + h/2); // Left
      drawEdgeHandle(x + w, y + h/2); // Right
    }
  };

  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);

    // Draw Output Area FIRST so it is behind Safety Zones
    if (transformationEnabled && outputArea) {
       drawRect(ctx, {
         x: outputArea.x * width,
         y: outputArea.y * height,
         w: outputArea.w * width,
         h: outputArea.h * height
       }, 'rgba(0, 137, 255, 0.2)', false, true);
    }

    // Draw Safety Zones ON TOP
    safetyZones.forEach((zone, index) => {
      drawRect(ctx, {
        x: zone.x * width,
        y: zone.y * height,
        w: zone.w * width,
        h: zone.h * height
      }, 'rgba(255, 0, 0, 0.3)', index === selectedZoneIndex);
    });

    // Draw Test Line
    if (testLineEnabled) {
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const lineY = testLineY * height;
      ctx.moveTo(0, lineY);
      ctx.lineTo(width, lineY);
      ctx.stroke();
    }
  };

  useEffect(() => {
    render();
  }, [safetyZones, outputArea, testLineY, testLineEnabled, transformationEnabled, selectedZoneIndex, gridSize]);

  // Interaction Helpers
  const getMousePos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  };

  const isOverHandle = (x, y, rect) => {
      if (!rect) return null;
      const handleRadius = 0.03; 
      // Corners
      if (Math.abs(x - rect.x) < handleRadius && Math.abs(y - rect.y) < handleRadius) return 'nw';
      if (Math.abs(x - (rect.x + rect.w)) < handleRadius && Math.abs(y - rect.y) < handleRadius) return 'ne';
      if (Math.abs(x - rect.x) < handleRadius && Math.abs(y - (rect.y + rect.h)) < handleRadius) return 'sw';
      if (Math.abs(x - (rect.x + rect.w)) < handleRadius && Math.abs(y - (rect.y + rect.h)) < handleRadius) return 'se';
      
      // Edges
      if (Math.abs(y - rect.y) < handleRadius && x >= rect.x && x <= rect.x + rect.w) return 'n';
      if (Math.abs(y - (rect.y + rect.h)) < handleRadius && x >= rect.x && x <= rect.x + rect.w) return 's';
      if (Math.abs(x - rect.x) < handleRadius && y >= rect.y && y <= rect.y + rect.h) return 'w';
      if (Math.abs(x - (rect.x + rect.w)) < handleRadius && y >= rect.y && y <= rect.y + rect.h) return 'e';

      return null;
  };

  const isInside = (x, y, rect) => {
    if (!rect) return false;
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  };

  const handleMouseDown = (e) => {
    const { x, y } = getMousePos(e);
    
    // 1. PRIORITY: Check Safety Zones Handles (Selected first)
    if (selectedZoneIndex !== null && safetyZones[selectedZoneIndex]) {
        const zone = safetyZones[selectedZoneIndex];
        const handle = isOverHandle(x, y, zone);
        if (handle) {
            setDragging({ type: 'zone', index: selectedZoneIndex, handle, startX: x, startY: y, originalRect: { ...zone } });
            return;
        }
    }

    // 2. PRIORITY: Check Safety Zones Body (Select/Move)
    for (let i = safetyZones.length - 1; i >= 0; i--) {
        const zone = safetyZones[i];
        if (zone && isInside(x, y, zone)) {
            onSelectZone(i);
            const handle = isOverHandle(x, y, zone); 
            setDragging({ type: 'zone', index: i, handle: handle || 'move', startX: x, startY: y, originalRect: { ...zone } });
            return;
        }
    }
    
    // 3. PRIORITY: Check Output Area (Handles then Body)
    if (transformationEnabled && outputArea) {
       const handle = isOverHandle(x, y, outputArea);
       if (handle) {
           setDragging({ type: 'output', handle, startX: x, startY: y, originalRect: { ...outputArea } });
           onSelectZone(null); 
           return;
       }
       if (isInside(x, y, outputArea)) {
           setDragging({ type: 'output', handle: 'move', startX: x, startY: y, originalRect: { ...outputArea } });
           onSelectZone(null); 
           return;
       }
    }
    
    onSelectZone(null);
  };

  const snap = (val) => {
      if (!snapToGrid) return val;
      const step = 1 / gridSize;
      return Math.round(val / step) * step;
  };

  const handleMouseMove = (e) => {
    if (!dragging) return;
    const { x, y } = getMousePos(e);
    
    // Calculate raw delta
    const dx = x - dragging.startX;
    const dy = y - dragging.startY;
    
    const updateRect = (original, handle, dx, dy) => {
        let r = { ...original };
        
        if (handle === 'move') {
            r.x = snap(original.x + dx);
            r.y = snap(original.y + dy);
        } else {
            // Resizing
            if (handle.includes('w')) {
                const newX = snap(original.x + dx);
                r.w = (original.x + original.w) - newX;
                r.x = newX;
            }
            if (handle.includes('e')) {
                const newR = snap(original.x + original.w + dx);
                r.w = newR - r.x;
            }
            if (handle.includes('n')) {
                const newY = snap(original.y + dy);
                r.h = (original.y + original.h) - newY;
                r.y = newY;
            }
            if (handle.includes('s')) {
                const newB = snap(original.y + original.h + dy);
                r.h = newB - r.y;
            }
        }
        
        // Sanity checks
        if (r.w < 0.01) r.w = 0.01;
        if (r.h < 0.01) r.h = 0.01;
        
        return r;
    };

    if (dragging.type === 'zone') {
        const newRect = updateRect(dragging.originalRect, dragging.handle, dx, dy);
        onUpdateSafetyZones(dragging.index, newRect);
    } else if (dragging.type === 'output') {
        const newRect = updateRect(dragging.originalRect, dragging.handle, dx, dy);
        onUpdateOutputArea(newRect);
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  return (
    <div className="output-canvas-container" style={{ width: '100%', height: '100%' }}>
      <canvas 
        ref={canvasRef}
        width={600}
        height={600}
        style={{ width: '100%', height: '100%', display: 'block' }}
        className="output-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
};

const OutputSettingsWindow = ({ show, onClose, dacs = [], dacSettings = {}, onUpdateDacSettings }) => {
  const [selectedOutputId, setSelectedOutputId] = useState(null);
  const [selectedZoneIndex, setSelectedZoneIndex] = useState(null);
  const [gridSize, setGridSize] = useState(20);
  const [snapToGrid, setSnapToGrid] = useState(false);

  // Flatten DACs to Outputs (Channels)
  const outputs = useMemo(() => {
    const list = [];
    dacs.forEach(dac => {
      // If the DAC has a 'channels' property (from getDacServices), use it.
      // Otherwise, treat it as a single-channel device (Channel 0).
      if (dac.channels && dac.channels.length > 0) {
        dac.channels.forEach(ch => {
           list.push({
             id: `${dac.ip}:${ch.serviceID}`,
             displayName: `${dac.hostName || dac.unitID || 'DAC'} : ${ch.name || `CH ${ch.serviceID}`}`,
             ip: dac.ip,
             channel: ch.serviceID,
             dacName: dac.hostName || dac.unitID
           });
        });
      } else {
         list.push({
             id: `${dac.ip}:0`,
             displayName: dac.hostName || dac.unitID || `DAC ${dac.ip}`,
             ip: dac.ip,
             channel: 0,
             dacName: dac.hostName || dac.unitID
         });
      }
    });
    return list;
  }, [dacs]);

  useEffect(() => {
    if (outputs.length > 0 && !selectedOutputId) {
        setSelectedOutputId(outputs[0].id);
    }
  }, [outputs, selectedOutputId]);

  if (!show) return null;

  // Get current settings or default
  const currentSettings = dacSettings[selectedOutputId] || {
      safetyZones: [],
      outputArea: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      transformationEnabled: false,
      transformationMode: 'crop',
      testLineEnabled: false,
      testLineY: 0.5
  };

  const updateCurrentSettings = (updates) => {
      if (!selectedOutputId) return;
      onUpdateDacSettings(selectedOutputId, { ...currentSettings, ...updates });
  };

  const handleAddZone = () => {
      const newZone = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
      updateCurrentSettings({ safetyZones: [...currentSettings.safetyZones, newZone] });
      setSelectedZoneIndex(currentSettings.safetyZones.length);
  };

  const handleRemoveZone = () => {
      if (selectedZoneIndex === null) return;
      const newZones = currentSettings.safetyZones.filter((_, i) => i !== selectedZoneIndex);
      updateCurrentSettings({ safetyZones: newZones });
      setSelectedZoneIndex(null);
  };

  const handleClearZones = () => {
      updateCurrentSettings({ safetyZones: [] });
      setSelectedZoneIndex(null);
  };

  const handleUpdateZone = (index, rect) => {
      const newZones = [...currentSettings.safetyZones];
      newZones[index] = rect;
      updateCurrentSettings({ safetyZones: newZones });
  };

  return (
    <div className="output-settings-modal-overlay">
      <div className="output-settings-modal-content">
        <div className="output-settings-header">
          <h2>Output Settings</h2>
          <button className="close-btn" onClick={onClose}>Close</button>
        </div>
        
        <div className="output-settings-body">
          {/* Left Column: Output List */}
          <div className="output-settings-col">
            <div className="settings-group">
                <h4>Available Outputs</h4>
                <ul className="dac-list">
                    {outputs.length === 0 ? <li style={{color:'#666', fontStyle:'italic'}}>No Outputs detected</li> : null}
                    {outputs.map((out, i) => (
                        <li 
                            key={out.id} 
                            className={`dac-list-item ${selectedOutputId === out.id ? 'selected' : ''}`}
                            onClick={() => setSelectedOutputId(out.id)}
                        >
                            <span style={{fontWeight:'bold', fontSize:'0.9em'}}>{out.displayName}</span>
                            <span style={{fontSize:'0.7em', color:'#888'}}>{out.ip}</span>
                        </li>
                    ))}
                </ul>
            </div>
          </div>

          {/* Middle Column: Canvas */}
          <div className="output-settings-col canvas-col">
            <div className="canvas-toolbar">
                <button className="tool-btn" onClick={handleAddZone} title="Add Safety Zone">+ Zone</button>
                <button className={`tool-btn ${currentSettings.transformationEnabled ? 'active' : ''}`} onClick={() => updateCurrentSettings({ transformationEnabled: !currentSettings.transformationEnabled })} title="Toggle Output Transformation">⛶</button>
                <button className={`tool-btn ${currentSettings.testLineEnabled ? 'active' : ''}`} onClick={() => updateCurrentSettings({ testLineEnabled: !currentSettings.testLineEnabled })} title="Toggle Test Line">_</button>
                
                <span style={{width: 1, background: '#555', margin: '0 5px'}}></span>
                
                <button className={`tool-btn ${snapToGrid ? 'active' : ''}`} onClick={() => setSnapToGrid(!snapToGrid)} title="Snap to Grid">🧲</button>
                
                <div style={{display:'flex', alignItems:'center', gap:5, marginLeft:5}}>
                    <span style={{fontSize:10, color:'#aaa'}}>Grid:</span>
                    <input type="number" min="5" max="100" value={gridSize} onChange={(e) => setGridSize(parseInt(e.target.value))} className="param-number-input" style={{width:40}} />
                </div>
            </div>
            <OutputCanvas 
                safetyZones={currentSettings.safetyZones}
                outputArea={currentSettings.outputArea}
                testLineY={currentSettings.testLineY}
                testLineEnabled={currentSettings.testLineEnabled}
                transformationEnabled={currentSettings.transformationEnabled}
                transformationMode={currentSettings.transformationMode}
                onUpdateSafetyZones={handleUpdateZone}
                onUpdateOutputArea={(rect) => updateCurrentSettings({ outputArea: rect })}
                selectedZoneIndex={selectedZoneIndex}
                onSelectZone={setSelectedZoneIndex}
                gridSize={gridSize}
                snapToGrid={snapToGrid}
            />
          </div>

          {/* Right Column: Properties */}
          <div className="output-settings-col">
             {selectedOutputId ? (
                 <>
                    <div className="settings-group">
                        <h4>Output Transformation</h4>
                        <div className="control-row" style={{marginBottom:10}}>
                             <label style={{flex:1}}>Enable Editing</label>
                             <input type="checkbox" checked={currentSettings.transformationEnabled} onChange={(e) => updateCurrentSettings({ transformationEnabled: e.target.checked })} />
                        </div>
                        {currentSettings.transformationEnabled && (
                            <div className="control-row">
                                <label style={{flex:1}}>Mode</label>
                                <select 
                                    className="param-select"
                                    value={currentSettings.transformationMode} 
                                    onChange={(e) => updateCurrentSettings({ transformationMode: e.target.value })}
                                >
                                    <option value="crop">Crop</option>
                                    <option value="scale">Scale</option>
                                </select>
                            </div>
                        )}
                    </div>

                    <div className="settings-group">
                        <h4>Safety Zones</h4>
                        <div className="control-row" style={{justifyContent: 'space-between', marginBottom: 5}}>
                            <button className="small-btn" onClick={handleAddZone}>Add New</button>
                            <button className="small-btn clear" onClick={handleClearZones}>Clear All</button>
                        </div>
                        <div className="zone-list">
                            {currentSettings.safetyZones.map((z, i) => (
                                <div key={i} className={`zone-item ${selectedZoneIndex === i ? 'selected' : ''}`} onClick={() => setSelectedZoneIndex(i)}>
                                    <span>Zone {i + 1}</span>
                                    <button className="delete-zone-btn" onClick={(e) => { e.stopPropagation(); if(selectedZoneIndex === i) setSelectedZoneIndex(null); const nz = currentSettings.safetyZones.filter((_, idx) => idx !== i); updateCurrentSettings({ safetyZones: nz }); }}>×</button>
                                </div>
                            ))}
                        </div>
                        {selectedZoneIndex !== null && (
                            <div style={{marginTop: 10, borderTop:'1px solid #333', paddingTop:5}}>
                                <label>Selected Zone Properties</label>
                                <div style={{fontSize:'0.8em', color:'#aaa'}}>
                                    Select and drag zone on canvas to resize.
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="settings-group">
                        <h4>Test Output</h4>
                        <div className="control-row" style={{marginBottom:10}}>
                            <label style={{flex:1}}>Enable Test Line</label>
                             <input type="checkbox" checked={currentSettings.testLineEnabled} onChange={(e) => updateCurrentSettings({ testLineEnabled: e.target.checked })} />
                        </div>
                        {currentSettings.testLineEnabled && (
                            <div className="control-row">
                                <label>Y Position</label>
                                <input 
                                    type="range" 
                                    min="0" max="1" step="0.01" 
                                    value={currentSettings.testLineY} 
                                    onChange={(e) => updateCurrentSettings({ testLineY: parseFloat(e.target.value) })} 
                                    className="param-slider"
                                />
                            </div>
                        )}
                    </div>
                 </>
             ) : (
                 <div style={{padding:20, textAlign:'center', color:'#666'}}>Select an Output to configure settings</div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OutputSettingsWindow;