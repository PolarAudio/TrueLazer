import React, { useState, useEffect, useCallback, useRef } from 'react';
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

const MasterSpeedSlider = () => (
  <div className="master-speed-slider">
    <input type="range" min="0" max="100" defaultValue="50" className="slider" id="masterSpeedRange" />
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

function App() {
  const [columns, setColumns] = useState(Array.from({ length: 8 }, (_, i) => `Col ${i + 1}`));
  const [layers, setLayers] = useState(Array.from({ length: 5 }, (_, i) => `Layer ${i + 1}`));

  const worker = useIldaParserWorker(); // Get the worker from context

  const initialClipContent = Array(layers.length).fill(null).map(() =>
    Array(columns.length).fill(null)
  );
  const [clipContents, setClipContents] = useState(initialClipContent);

  const initialClipNames = Array(layers.length).fill(null).map((_, layerIndex) =>
    Array(columns.length).fill(null).map((_, colIndex) => `Clip ${layerIndex + 1}-${colIndex + 1}`)
  );
  const [clipNames, setClipNames] = useState(initialClipNames);

  const initialThumbnailIndexes = Array(layers.length).fill(null).map(() =>
    Array(columns.length).fill(0)
  );
  const [thumbnailFrameIndexes, setThumbnailFrameIndexes] = useState(initialThumbnailIndexes);

  const initialLayerEffects = Array(layers.length).fill([]);
  const [layerEffects, setLayerEffects] = useState(initialLayerEffects);

  const [selectedLayerIndex, setSelectedLayerIndex] = useState(null);
  const [selectedColIndex, setSelectedColIndex] = useState(null);
  const [notification, setNotification] = useState({ message: '', visible: false });

  const [dacs, setDacs] = useState([
    { id: 'dac1', name: 'Showbridge 1', channels: ['ch1', 'ch2'] },
    { id: 'dac2', name: 'Showbridge 2', channels: ['ch1', 'ch2'] },
  ]);

  const [ildaFrames, setIldaFrames] = useState([]);
  const ildaPlayerCurrentFrameIndex = useRef(0);

  const [showBeamEffect, setShowBeamEffect] = useState(true);
  const [beamAlpha, setBeamAlpha] = useState(0.1);
  const [fadeAlpha, setFadeAlpha] = useState(0.13);
  const [drawSpeed, setDrawSpeed] = useState(1000);

  const [activeClipIndexes, setActiveClipIndexes] = useState(Array(layers.length).fill(null));

  const handleFrameChange = useCallback((frameIndex) => {
    ildaPlayerCurrentFrameIndex.current = frameIndex;
  }, []);

  const showNotification = useCallback((message) => {
    setNotification({ message, visible: true });
    setTimeout(() => {
      setNotification({ message: '', visible: false });
    }, 3000);
  }, []);

  const setTheme = (theme) => {
    document.documentElement.style.setProperty('--theme-color', `var(--theme-color-${theme})`);
    document.documentElement.style.setProperty('--theme-color-transparent', `var(--theme-color-${theme}-transparent)`);
  };

  const handleDropEffectOnLayer = useCallback((layerIndex, effectData) => {
    setLayerEffects(prevEffects => {
      const newEffects = [...prevEffects];
      newEffects[layerIndex] = [...newEffects[layerIndex], effectData];
      return newEffects;
    });
  }, [setLayerEffects]);
  
  const handleDropEffectOnClip = useCallback((layerIndex, colIndex, effectData) => {
    setClipContents(prevContents => {
      const newContents = [...prevContents];
      if (!newContents[layerIndex][colIndex]) {
        newContents[layerIndex][colIndex] = { effects: [] };
      } else if (!newContents[layerIndex][colIndex].effects) {
        newContents[layerIndex][colIndex] = {
          ...newContents[layerIndex][colIndex],
          effects: []
        };
      }
      
      newContents[layerIndex][colIndex].effects = [
        ...(newContents[layerIndex][colIndex].effects || []),
        effectData
      ];
      
      return newContents;
    });
    
    showNotification(`Effect "${effectData.name}" added to clip`);
  }, [showNotification]);

  const handleClipPreview = useCallback((layerIndex, colIndex) => {
    setSelectedLayerIndex(layerIndex);
    setSelectedColIndex(colIndex);
    const clipData = clipContents[layerIndex][colIndex];
    if (clipData && clipData.frames) {
      setIldaFrames(clipData.frames);
    } else {
      setIldaFrames([]);
    }
  }, [clipContents]);

  const handleActivateClick = useCallback((layerIndex, colIndex) => {
    setActiveClipIndexes(prevActive => {
      const newActive = [...prevActive];
      newActive[layerIndex] = colIndex;
      return newActive;
    });
  }, []);

  const handleDropGenerator = useCallback((layerIndex, colIndex, parsedData, fileName) => {
    setClipContents(prevContents => 
      prevContents.map((layer, lIndex) => 
        lIndex === layerIndex 
          ? layer.map((clip, cIndex) => cIndex === colIndex ? parsedData : clip)
          : layer
      )
    );
    setClipNames(prevNames => 
      prevNames.map((layer, lIndex) => 
        lIndex === layerIndex 
          ? layer.map((name, cIndex) => cIndex === colIndex ? fileName : name)
          : layer
      )
    );
  }, []);

  useEffect(() => {
    if (!worker) return;

    worker.onmessage = (e) => {
      if (e.data.success) {
        const { data, fileName, layerIndex, colIndex } = e.data;
        handleDropGenerator(layerIndex, colIndex, data, fileName);
      } else {
        console.error("Worker parsing error:", e.data.error);
        showNotification(`Error parsing ${e.data.fileName}: ${e.data.error}`);
      }
    };

    return () => {
      worker.onmessage = null;
    };
  }, [worker, handleDropGenerator, showNotification]);

  const handleClearClip = useCallback((layerIndex, colIndex) => {
    setClipContents(prevContents => {
      const newContents = [...prevContents];
      newContents[layerIndex][colIndex] = null;
      return newContents;
    });
    setClipNames(prevNames => {
      const newNames = [...prevNames];
      newNames[layerIndex][colIndex] = `Clip ${layerIndex + 1}-${colIndex + 1}`;
      return newNames;
    });
    setThumbnailFrameIndexes(prevIndexes => {
      const newIndexes = [...prevIndexes];
      newIndexes[layerIndex][colIndex] = 0;
      return newIndexes;
    });
    setActiveClipIndexes(prevActive => {
      const newActive = [...prevActive];
      if (newActive[layerIndex] === colIndex) {
        newActive[layerIndex] = null;
      }
      return newActive;
    });
    if (selectedLayerIndex === layerIndex && selectedColIndex === colIndex) {
      setIldaFrames([]);
      ildaPlayerCurrentFrameIndex.current = 0;
    }
  }, [selectedLayerIndex, selectedColIndex]);

  const handleClearLayerClips = useCallback((layerIndex) => {
    for (let colIndex = 0; colIndex < columns.length; colIndex++) {
      handleClearClip(layerIndex, colIndex);
    }
  }, [columns.length, handleClearClip]);

  const handleDeactivateLayerClips = useCallback((layerIndex) => {
    setActiveClipIndexes(prevActive => {
      const newActive = [...prevActive];
      newActive[layerIndex] = null;
      return newActive;
    });
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
    setThumbnailFrameIndexes(prevIndexes => {
      const newIndexes = [...prevIndexes];
      newIndexes[layerIndex][colIndex] = ildaPlayerCurrentFrameIndex.current;
      return newIndexes;
    });
  }, []);

  const handleMenuAction = useCallback((action) => {
    if (action.startsWith('set-theme-')) {
      const theme = action.substring('set-theme-'.length);
      setTheme(theme);
      return;
    }
    switch (action) {
      case 'render-mode-high-performance':
        setDrawSpeed(1000);
        setFadeAlpha(0.05);
        break;
      case 'render-mode-low-performance':
        setDrawSpeed(100);
        setFadeAlpha(0.13);
        break;
      case 'toggle-beam-effect':
        setShowBeamEffect(prev => !prev);
        break;
      case 'clip-clear':
        if (selectedLayerIndex !== null && selectedColIndex !== null) {
          handleClearClip(selectedLayerIndex, selectedColIndex);
        }
        break;
      default:
    }
  }, [selectedLayerIndex, selectedColIndex, handleClearClip]);

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
    switch (setting) {
      case 'showBeamEffect':
        setShowBeamEffect(value);
        break;
      case 'beamAlpha':
        setBeamAlpha(value);
        break;
      case 'fadeAlpha':
        setFadeAlpha(value);
        break;
      case 'drawSpeed':
        setDrawSpeed(value);
        break;
      default:
    }
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
        return clipContents[layerIndex][activeColIndex];
    }
    return null;
  }).filter(Boolean);

  const selectedClipEffects =
    selectedLayerIndex !== null && selectedColIndex !== null
      ? clipContents[selectedLayerIndex][selectedColIndex]?.effects || []
      : [];

  const handleEffectParameterChange = useCallback((layerIndex, colIndex, effectIndex, paramName, newValue) => {
    setClipContents(prevContents => {
      const newContents = [...prevContents];
      const clip = { ...newContents[layerIndex][colIndex] };
      if (clip && clip.effects) {
        const newEffects = [...clip.effects];
        const effectToUpdate = { ...newEffects[effectIndex] };
        effectToUpdate.params = { ...effectToUpdate.params, [paramName]: newValue };
        newEffects[effectIndex] = effectToUpdate;
        clip.effects = newEffects;
        newContents[layerIndex][colIndex] = clip;
      }
      return newContents;
    });
  }, []);

  return (
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
                  {columns.map((colName, colIndex) => (
                    <Clip
                      key={colIndex}
                      layerIndex={layerIndex}
                      colIndex={colIndex}
                      clipName={clipNames[layerIndex][colIndex]}
                      clipContent={clipContents[layerIndex][colIndex]}
                      thumbnailFrameIndex={thumbnailFrameIndexes[layerIndex][colIndex]}
                      onActivateClick={() => handleActivateClick(layerIndex, colIndex)}
                      isActive={activeClipIndexes[layerIndex] === colIndex}
                      onUnsupportedFile={showNotification}
                      onDropEffect={(effectData) => handleDropEffectOnClip(layerIndex, colIndex, effectData)}
                      onLabelClick={() => handleClipPreview(layerIndex, colIndex)}
                      isSelected={selectedLayerIndex === layerIndex && selectedColIndex === colIndex}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="side-panel">
            <IldaPlayer
              ildaFrames={ildaFrames}
              showBeamEffect={showBeamEffect}
              beamAlpha={beamAlpha}
              fadeAlpha={fadeAlpha}
              drawSpeed={drawSpeed}
              onFrameChange={handleFrameChange}
            />
            <WorldPreview
              worldData={activeClipsData}
              showBeamEffect={showBeamEffect}
              beamAlpha={beamAlpha}
              fadeAlpha={fadeAlpha}
              drawSpeed={drawSpeed}
            />
            
          </div>
          <div className="middle-bar">
            <div className="middle-bar-left-area">
              <BPMControls />
              <MasterSpeedSlider />
            </div>
            <div className="middle-bar-right-area">
            </div>
          </div>
          <div className="bottom-panel">
            <FileBrowser onDropIld={handleDropGenerator} />
            <GeneratorPanel />
            <EffectPanel />
            <DacPanel dacs={dacs} />
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
  );
}

export default App;
