import React, { useReducer, useEffect, useCallback, useRef, useMemo } from 'react';
import CompositionControls from './components/CompositionControls';
import ColumnHeader from './components/ColumnHeader';
import LayerControls from './components/LayerControls';
import Clip from './components/Clip';
import FileBrowser from './components/FileBrowser';
import GeneratorPanel from './components/GeneratorPanel';
import EffectPanel from './components/EffectPanel';
import DacPanel from './components/DacPanel';
import NotificationPopup from './components/NotificationPopup';
import IldaPlayer from './components/IldaPlayer';
import WorldPreview from './components/WorldPreview';
import BPMControls from './components/BPMControls';
import SettingsPanel from './components/SettingsPanel';
import ErrorBoundary from './components/ErrorBoundary';
import { useIldaParserWorker } from './contexts/IldaParserWorkerContext';
import { GeneratorWorkerProvider, useGeneratorWorker } from './contexts/GeneratorWorkerContext';
import { applyEffects } from './utils/effects';

const MasterSpeedSlider = ({ drawSpeed, onSpeedChange }) => (
  <div className="master-speed-slider">
    <label htmlFor="masterSpeedRange">Clip Playback Speed</label>
    <input type="range" min="50" max="250" value={drawSpeed} className="slider" id="masterSpeedRange" onChange={(e) => onSpeedChange(parseInt(e.target.value))} />
  </div>
);

const MasterIntensitySlider = () => (
  <div className="master-intensity-slider">
    <input type="range" min="0" max="100" defaultValue="50" className="slider" id="masterIntensityRange" />
  </div>
);

const LaserOnOffButton = () => (
  <div className="container"><input type="checkbox" /></div>
);

const initialState = {
  columns: Array.from({ length: 8 }, (_, i) => `Col ${i + 1}`),
  layers: Array.from({ length: 5 }, (_, i) => `Layer ${i + 1}`),
  clipContents: Array(5).fill(null).map(() => Array(8).fill(null)),
  clipNames: Array(5).fill(null).map((_, layerIndex) =>
    Array(8).fill(null).map((_, colIndex) => `Clip ${layerIndex + 1}-${colIndex + 1}`)
  ),
  thumbnailFrameIndexes: Array(5).fill(null).map(() => Array(8).fill(0)),
  layerEffects: Array(5).fill([]),
  selectedLayerIndex: null,
  selectedColIndex: null,
  notification: { message: '', visible: false },
  dacs: [],
  selectedDac: null,
  ildaFrames: [],
  selectedIldaWorkerId: null,
  selectedIldaTotalFrames: 0,
  showBeamEffect: true,
  beamAlpha: 0.1,
  fadeAlpha: 0.13,
  drawSpeed: 100,
  previewScanRate: 1,
  activeClipIndexes: Array(5).fill(null),
  isPlaying: false,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_COLUMNS':
      return { ...state, columns: action.payload };
    case 'SET_LAYERS':
      return { ...state, layers: action.payload };
    case 'SET_CLIP_CONTENT':
      const newClipContents = [...state.clipContents];
      newClipContents[action.payload.layerIndex][action.payload.colIndex] = action.payload.content;
      return { ...state, clipContents: newClipContents };
    case 'SET_CLIP_NAME':
        const newClipNames = [...state.clipNames];
        newClipNames[action.payload.layerIndex][action.payload.colIndex] = action.payload.name;
        return { ...state, clipNames: newClipNames };
    case 'SET_THUMBNAIL_FRAME_INDEX':
        const newThumbnailFrameIndexes = [...state.thumbnailFrameIndexes];
        newThumbnailFrameIndexes[action.payload.layerIndex][action.payload.colIndex] = action.payload.index;
        return { ...state, thumbnailFrameIndexes: newThumbnailFrameIndexes };
    case 'ADD_LAYER_EFFECT':
        const newLayerEffects = [...state.layerEffects];
        newLayerEffects[action.payload.layerIndex].push(action.payload.effect);
        return { ...state, layerEffects: newLayerEffects };
    case 'ADD_CLIP_EFFECT':
        const newClipContentsWithEffect = [...state.clipContents];
        const clip = newClipContentsWithEffect[action.payload.layerIndex][action.payload.colIndex] || {};
        clip.effects = [...(clip.effects || []), action.payload.effect];
        newClipContentsWithEffect[action.payload.layerIndex][action.payload.colIndex] = clip;
        return { ...state, clipContents: newClipContentsWithEffect };
    case 'SET_SELECTED_CLIP':
        return { ...state, selectedLayerIndex: action.payload.layerIndex, selectedColIndex: action.payload.colIndex };
    case 'SET_NOTIFICATION':
        return { ...state, notification: action.payload };
    case 'SET_ILDA_FRAMES':
        return { ...state, ildaFrames: action.payload };
    case 'SET_SELECTED_ILDA_DATA':
        return { ...state, selectedIldaWorkerId: action.payload.workerId, selectedIldaTotalFrames: action.payload.totalFrames };
    case 'SET_ACTIVE_CLIP':
        const newActiveClipIndexes = [...state.activeClipIndexes];
        newActiveClipIndexes[action.payload.layerIndex] = action.payload.colIndex;
        return { ...state, activeClipIndexes: newActiveClipIndexes };
    case 'CLEAR_CLIP':
        const clearedClipContents = [...state.clipContents];
        clearedClipContents[action.payload.layerIndex][action.payload.colIndex] = null;
        const clearedClipNames = [...state.clipNames];
        clearedClipNames[action.payload.layerIndex][action.payload.colIndex] = `Clip ${action.payload.layerIndex + 1}-${action.payload.colIndex + 1}`;
        const clearedThumbnailFrameIndexes = [...state.thumbnailFrameIndexes];
        clearedThumbnailFrameIndexes[action.payload.layerIndex][action.payload.colIndex] = 0;
        const clearedActiveClipIndexes = [...state.activeClipIndexes];
        if (clearedActiveClipIndexes[action.payload.layerIndex] === action.payload.colIndex) {
            clearedActiveClipIndexes[action.payload.layerIndex] = null;
        }
        return { ...state, clipContents: clearedClipContents, clipNames: clearedClipNames, thumbnailFrameIndexes: clearedThumbnailFrameIndexes, activeClipIndexes: clearedActiveClipIndexes };
    case 'DEACTIVATE_LAYER_CLIPS':
        const deactivatedActiveClipIndexes = [...state.activeClipIndexes];
        deactivatedActiveClipIndexes[action.payload.layerIndex] = null;
        return { ...state, activeClipIndexes: deactivatedActiveClipIndexes };
    case 'SET_RENDER_SETTING':
        return { ...state, [action.payload.setting]: action.payload.value };
    case 'UPDATE_EFFECT_PARAMETER':
        const updatedClipContents = [...state.clipContents];
        const clipToUpdate = { ...updatedClipContents[action.payload.layerIndex][action.payload.colIndex] };
        if (clipToUpdate && clipToUpdate.effects) {
            const newEffects = [...clipToUpdate.effects];
            const effectToUpdate = { ...newEffects[action.payload.effectIndex] };
            effectToUpdate.params = { ...effectToUpdate.params, [action.payload.paramName]: action.payload.newValue };
            newEffects[action.payload.effectIndex] = effectToUpdate;
            clipToUpdate.effects = newEffects;
            updatedClipContents[action.payload.layerIndex][action.payload.colIndex] = clipToUpdate;
        }
        return { ...state, clipContents: updatedClipContents };
    case 'SET_DACS':
      return { ...state, dacs: action.payload };
    case 'SET_SELECTED_DAC':
      return { ...state, selectedDac: action.payload };
    case 'SET_IS_PLAYING':
      return { ...state, isPlaying: action.payload };
    default:
      return state;
  }
}

function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const {
    columns,
    layers,
    clipContents,
    clipNames,
    thumbnailFrameIndexes,
    layerEffects,
    selectedLayerIndex,
    selectedColIndex,
    notification,
    dacs,
    selectedDac,
    ildaFrames,
    selectedIldaWorkerId,
    selectedIldaTotalFrames,
    showBeamEffect,
    beamAlpha,
    fadeAlpha,
    drawSpeed,
    previewScanRate,
    activeClipIndexes,
    isPlaying,
  } = state;

  const ildaParserWorker = useIldaParserWorker();
  const generatorWorker = useGeneratorWorker();
  const ildaPlayerCurrentFrameIndex = useRef(0);

  const handleFrameChange = useCallback((frameIndex) => {
    ildaPlayerCurrentFrameIndex.current = frameIndex;
  }, []);

  const showNotification = useCallback((message) => {
    dispatch({ type: 'SET_NOTIFICATION', payload: { message, visible: true } });
    setTimeout(() => {
        dispatch({ type: 'SET_NOTIFICATION', payload: { message: '', visible: false } });
    }, 3000);
  }, []);

  const setTheme = (theme) => {
    document.documentElement.style.setProperty('--theme-color', `var(--theme-color-${theme})`);
    document.documentElement.style.setProperty('--theme-color-transparent', `var(--theme-color-${theme}-transparent)`);
  };

  const handleDropEffectOnLayer = useCallback((layerIndex, effectData) => {
    dispatch({ type: 'ADD_LAYER_EFFECT', payload: { layerIndex, effect: effectData } });
  }, []);
  
  const handleDropEffectOnClip = useCallback((layerIndex, colIndex, effectData) => {
    dispatch({ type: 'ADD_CLIP_EFFECT', payload: { layerIndex, colIndex, effect: effectData } });
    showNotification(`Effect "${effectData.name}" added to clip`);
  }, [showNotification]);

  const handleClipPreview = useCallback((layerIndex, colIndex) => {
    dispatch({ type: 'SET_SELECTED_CLIP', payload: { layerIndex, colIndex } });
    const clipData = clipContents[layerIndex][colIndex];
    if (clipData && clipData.workerId && clipData.totalFrames) {
        dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: clipData.workerId, totalFrames: clipData.totalFrames } });
    } else {
        dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: null, totalFrames: 0 } });
    }
  }, [clipContents]);

  const handleActivateClick = useCallback((layerIndex, colIndex) => {
    dispatch({ type: 'SET_ACTIVE_CLIP', payload: { layerIndex, colIndex } });
  }, []);

  const handleDropIld = useCallback((layerIndex, colIndex, file) => {
    if (!ildaParserWorker) {
      showNotification("ILDA parser not available.");
      return;
    }
    if (file.name.toLowerCase().endsWith('.ild')) {
      try {
        const arrayBuffer = file.arrayBuffer();
        ildaParserWorker.postMessage({ type: 'parse-ilda', arrayBuffer, fileName: file.name, layerIndex, colIndex }, [arrayBuffer]);
      } catch (error) {
        console.error('Error reading file:', error);
        showNotification(`Error reading file: ${error.message}`);
      }
    } else {
      showNotification("Please drop a valid .ild file");
    }
  }, [ildaParserWorker, showNotification]);

  const handleDropGenerator = useCallback((layerIndex, colIndex, generator) => {
    if (!generatorWorker) {
      showNotification("Generator worker not available.");
      return;
    }
    generatorWorker.postMessage({ type: 'generate-frame', generator, layerIndex, colIndex });
  }, [generatorWorker, showNotification]);

  useEffect(() => {
    if (!ildaParserWorker) return;

    ildaParserWorker.onmessage = (e) => {
      // Only process 'parse-ilda' success messages here
      if (e.data.type === 'parse-ilda' && e.data.success) {
        const { workerId, totalFrames, fileName, layerIndex, colIndex } = e.data;
        const newClipContent = { workerId, totalFrames };
        dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: newClipContent } });
        dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: fileName } });
      } else if (!e.data.success) { // Handle general errors from worker
        console.error("Worker parsing error:", e.data.error);
        showNotification(`Error parsing ${e.data.fileName}: ${e.data.error}`);
      }
      // Ignore 'get-frame' messages here, they are handled by IldaPlayer/WorldPreview
    };

    return () => {
      ildaParserWorker.onmessage = null;
    };
  }, [ildaParserWorker, showNotification]);

  useEffect(() => {
    if (!generatorWorker) return;

    generatorWorker.onmessage = (e) => {
      if (e.data.success) {
        const { frame, layerIndex, colIndex, generator } = e.data;
        const newClipContent = { frames: [frame] };
        dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: newClipContent } });
        dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: generator.name } });
      } else {
        console.error("Generator worker error:", e.data.error);
        showNotification(`Error generating frame: ${e.data.error}`);
      }
    };

    return () => {
      generatorWorker.onmessage = null;
    };
  }, [generatorWorker, showNotification]);

  const handleClearClip = useCallback((layerIndex, colIndex) => {
    dispatch({ type: 'CLEAR_CLIP', payload: { layerIndex, colIndex } });
    if (selectedLayerIndex === layerIndex && selectedColIndex === colIndex) {
        dispatch({ type: 'SET_ILDA_FRAMES', payload: [] });
      ildaPlayerCurrentFrameIndex.current = 0;
    }
  }, [selectedLayerIndex, selectedColIndex]);

  const handleClearLayerClips = useCallback((layerIndex) => {
    for (let colIndex = 0; colIndex < columns.length; colIndex++) {
      handleClearClip(layerIndex, colIndex);
    }
  }, [columns.length, handleClearClip]);

  const handleDeactivateLayerClips = useCallback((layerIndex) => {
    dispatch({ type: 'DEACTIVATE_LAYER_CLIPS', payload: { layerIndex } });
  }, []);

  const handleShowLayerFullContextMenu = useCallback((layerIndex) => {
    if (window.electronAPI) {
      window.electronAPI.showLayerContextMenu(layerIndex);
    }
  }, []);

  const handleShowColumnHeaderContextMenu = useCallback((colIndex) => {
    if (window.electronAPI) {
      window.electronAPI.showColumnHeaderClipContextMenu(colIndex);
    }
  }, []);

  const handleUpdateThumbnail = useCallback((layerIndex, colIndex) => {
    dispatch({ type: 'SET_THUMBNAIL_FRAME_INDEX', payload: { layerIndex, colIndex, index: ildaPlayerCurrentFrameIndex.current } });
  }, []);

  const handleMenuAction = useCallback((action) => {
    if (action.startsWith('set-theme-')) {
      const theme = action.substring('set-theme-'.length);
      setTheme(theme);
      return;
    }
    // Render modes are now controlled by sliders
    switch (action) {
      case 'toggle-beam-effect':
        dispatch({ type: 'SET_RENDER_SETTING', payload: { setting: 'showBeamEffect', value: !showBeamEffect } });
        break;
      case 'clip-clear':
        if (selectedLayerIndex !== null && selectedColIndex !== null) {
          handleClearClip(selectedLayerIndex, selectedColIndex);
        }
        break;
      default:
    }
  }, [selectedLayerIndex, selectedColIndex, handleClearClip, showBeamEffect]);

  const handleClipContextMenuCommand = useCallback(({ command, layerIndex, colIndex }) => {
    switch (command) {
      case 'update-thumbnail':
        handleUpdateThumbnail(layerIndex, colIndex);
        break;
      case 'cut-clip':
        showNotification('Cut clip not implemented yet');
        break;
      case 'copy-clip':
        showNotification('Copy clip not implemented yet');
        break;
      case 'paste-clip':
        showNotification('Paste clip not implemented yet');
        break;
      case 'rename-clip':
        showNotification('Rename clip not implemented yet');
        break;
      case 'clear-clip':
        handleClearClip(layerIndex, colIndex);
        break;
      default:
    }
  }, [handleUpdateThumbnail, handleClearClip, showNotification]);

  const handleRenderSettingsCommand = useCallback(({ setting, value }) => {
    dispatch({ type: 'SET_RENDER_SETTING', payload: { setting, value } });
  }, []);

  const handleClearColumnClips = useCallback((colIndex) => {
    layers.forEach((_, layerIndex) => {
      handleClearClip(layerIndex, colIndex);
    });
  }, [layers, handleClearClip]);

  const handleColumnHeaderClipContextMenuCommand = useCallback(({ command, colIndex }) => {
    if (command === 'clear-column-clips') {
      handleClearColumnClips(colIndex);
      return;
    }
    if (selectedLayerIndex !== null) {
        handleClipContextMenuCommand({ command, layerIndex: selectedLayerIndex, colIndex });
    }
  }, [selectedLayerIndex, handleClearColumnClips, handleClipContextMenuCommand]);

  const handleLayerFullContextMenuCommand = useCallback((command, layerIndex) => {
    switch (command) {
      case 'layer-insert-above':
        showNotification('Insert layer above not implemented yet');
        break;
      case 'layer-insert-below':
        showNotification('Insert layer below not implemented yet');
        break;
      case 'layer-rename':
        showNotification('Rename layer not implemented yet');
        break;
      case 'layer-clear-clips':
        handleClearLayerClips(layerIndex);
        break;
      default:
    }
  }, [handleClearLayerClips, showNotification]);

  const handleDacSelected = useCallback((dac) => {
    dispatch({ type: 'SET_SELECTED_DAC', payload: dac });
  }, []);

  const handlePlay = useCallback(() => {
    dispatch({ type: 'SET_IS_PLAYING', payload: true });
  }, []);

  const handlePause = useCallback(() => {
    dispatch({ type: 'SET_IS_PLAYING', payload: false });
  }, []);

  const handleStop = useCallback(() => {
    dispatch({ type: 'SET_IS_PLAYING', payload: false });
    ildaPlayerCurrentFrameIndex.current = 0;
  }, []);

  useEffect(() => {
    if (window.electronAPI) {
      const cleanupMenu = window.electronAPI.onMenuAction(handleMenuAction);
      const cleanupClipContext = window.electronAPI.onClipContextMenuCommand(handleClipContextMenuCommand);
      const cleanupRenderSettings = window.electronAPI.onRenderSettingsCommand(handleRenderSettingsCommand);
      const cleanupColumnHeaderClipContext = window.electronAPI.onColumnHeaderClipContextMenuCommand(handleColumnHeaderClipContextMenuCommand);
      const cleanupLayerFullContext = window.electronAPI.onLayerFullContextMenuCommand(handleLayerFullContextMenuCommand);

      return () => {
        cleanupMenu();
        cleanupClipContext();
        cleanupRenderSettings();
        cleanupColumnHeaderClipContext();
        cleanupLayerFullContext();
      };
    }
  }, [handleMenuAction, handleClipContextMenuCommand, handleRenderSettingsCommand, handleColumnHeaderClipContextMenuCommand, handleLayerFullContextMenuCommand]);

  const activeClipsData = layers.map((_, layerIndex) => {
    const activeColIndex = activeClipIndexes[layerIndex];
    if (activeColIndex !== null) {
        const clip = clipContents[layerIndex][activeColIndex];
        if (clip && clip.workerId && clip.totalFrames) {
            return {
                workerId: clip.workerId,
                totalFrames: clip.totalFrames,
                effects: clip.effects || [], // Keep effects
            };
        }
    }
    return null;
  }).filter(Boolean);

  useEffect(() => {
    let animationFrameId;
    let lastFrameTime = 0;
    const DAC_REFRESH_INTERVAL = 30; // Approximately 33 frames per second for DAC output

    const animate = (currentTime) => {
      if (!isPlaying) {
        cancelAnimationFrame(animationFrameId);
        return;
      }

      if (currentTime - lastFrameTime > DAC_REFRESH_INTERVAL) {
        if (window.electronAPI && activeClipsData.length > 0 && selectedDac) {
          const ip = selectedDac.ip;
          activeClipsData.forEach(clip => {
            if (clip && clip.frames) {
              const effects = clip.effects || [];
              const frame = clip.frames[ildaPlayerCurrentFrameIndex.current % clip.frames.length];
              const modifiedFrame = applyEffects(frame, effects);
              window.electronAPI.send('send-frame', { ip, frame: modifiedFrame });
            }
          });
          ildaPlayerCurrentFrameIndex.current++;
        }
        lastFrameTime = currentTime;
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    if (isPlaying) {
      animationFrameId = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(animationFrameId);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [activeClipsData, selectedDac, isPlaying]);

  const selectedClipEffects =
    selectedLayerIndex !== null && selectedColIndex !== null
      ? clipContents[selectedLayerIndex][selectedColIndex]?.effects || []
      : [];

  const handleEffectParameterChange = useCallback((layerIndex, colIndex, effectIndex, paramName, newValue) => {
    dispatch({ type: 'UPDATE_EFFECT_PARAMETER', payload: { layerIndex, colIndex, effectIndex, paramName, newValue } });
  }, []);

  return (
    <GeneratorWorkerProvider>
      <div className="app">
        <ErrorBoundary>
          <NotificationPopup message={notification.message} visible={notification.visible} />
        <div className="main-content">
          <div className="top-bar-left-area">
            <CompositionControls />
            <MasterIntensitySlider />
            <LaserOnOffButton />
          </div>
          <div className="layer-controls-container">
            {layers.map((layerName, layerIndex) => {
              const activeColIndex = activeClipIndexes[layerIndex];
              const activeClipDataForLayer = activeColIndex !== null ? clipContents[layerIndex][activeColIndex] : null;
              return (
                <LayerControls
                  key={layerIndex}
                  layerName={layerName}
                  layerIndex={layerIndex}
                  layerEffects={layerEffects[layerIndex]}
                  activeClipData={activeClipDataForLayer}
                  onDeactivateLayerClips={() => handleDeactivateLayerClips(layerIndex)}
                  onShowLayerFullContextMenu={() => handleShowLayerFullContextMenu(layerIndex)}
                />
              );
            })}
          </div>
          <div className="clip-deck-container">
            <div className="clip-deck">
              <div className="column-headers-container">
                {columns.map((colName, colIndex) => (
                  <ColumnHeader key={colIndex} name={colName} index={colIndex} onShowColumnHeaderContextMenu={() => handleShowColumnHeaderContextMenu(colIndex)} />
                ))}
              </div>
              {layers.map((layerName, layerIndex) => (
                <div key={layerIndex} className="layer-row">
                  {columns.map((colName, colIndex) => {
                    const clipContentForMemo = clipContents[layerIndex][colIndex];
                    const memoizedClipContent = useMemo(() => clipContentForMemo, [clipContentForMemo]);

                    return (
                      <Clip
                        key={colIndex}
                        layerIndex={layerIndex}
                        colIndex={colIndex}
                        clipName={clipNames[layerIndex][colIndex]}
                        clipContent={memoizedClipContent}
                        thumbnailFrameIndex={thumbnailFrameIndexes[layerIndex][colIndex]}
                        onActivateClick={() => handleActivateClick(layerIndex, colIndex)}
                        isActive={activeClipIndexes[layerIndex] === colIndex}
                        onUnsupportedFile={showNotification}
                        onDropEffect={(effectData) => handleDropEffectOnClip(layerIndex, colIndex, effectData)}
                        onDropGenerator={handleDropGenerator}
                        onLabelClick={() => handleClipPreview(layerIndex, colIndex)}
                        isSelected={selectedLayerIndex === layerIndex && selectedColIndex === colIndex}
                        ildaParserWorker={ildaParserWorker}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="side-panel">
            <IldaPlayer
              ildaWorkerId={selectedIldaWorkerId}
              totalFrames={selectedIldaTotalFrames}
              showBeamEffect={showBeamEffect}
              beamAlpha={beamAlpha}
              fadeAlpha={fadeAlpha}
              previewScanRate={previewScanRate}
              drawSpeed={drawSpeed}
              onFrameChange={handleFrameChange}
              ildaParserWorker={ildaParserWorker}
            />
            <WorldPreview
              worldData={activeClipsData}
              showBeamEffect={showBeamEffect}
              beamAlpha={beamAlpha}
              fadeAlpha={fadeAlpha}
              previewScanRate={previewScanRate}
              drawSpeed={drawSpeed}
              ildaParserWorker={ildaParserWorker}
            />
            
          </div>
          <div className="middle-bar">
            <div className="middle-bar-left-area">
              <BPMControls onPlay={handlePlay} onPause={handlePause} onStop={handleStop} />
            </div>
            <div className="middle-bar-right-area">
				<MasterSpeedSlider drawSpeed={drawSpeed} onSpeedChange={(value) => dispatch({ type: 'SET_RENDER_SETTING', payload: { setting: 'drawSpeed', value } })} />
            </div>
          </div>
          <div className="bottom-panel">
            <FileBrowser onDropIld={(layerIndex, colIndex, file) => ildaParserWorker.postMessage({ type: 'parse-ilda', file, layerIndex, colIndex })} />
            <GeneratorPanel />
            <EffectPanel />
            <DacPanel onDacSelected={handleDacSelected} />
			<SettingsPanel 
              effects={selectedClipEffects}
              onParameterChange={(effectIndex, paramName, value) => handleEffectParameterChange(selectedLayerIndex, selectedColIndex, effectIndex, paramName, value)}
              selectedLayerIndex={selectedLayerIndex}
              selectedColIndex={selectedColIndex}
            />
          </div>
        </div>
              </ErrorBoundary>
            </div>
          </GeneratorWorkerProvider>
        );
      }
      
      export default App;
