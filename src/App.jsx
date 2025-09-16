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

const MasterIntensitySlider = () => (
  <div className="master-intensity-slider">
    <input type="range" min="0" max="100" defaultValue="50" className="slider" id="masterRange" />
  </div>
);

const LaserOnOffButton = () => (
  <div className="container"><input type="checkbox" /></div>
);

function App() {
  const [columns, setColumns] = useState(Array.from({ length: 8 }, (_, i) => `Col ${i + 1}`));
  const [layers, setLayers] = useState(Array.from({ length: 5 }, (_, i) => `Layer ${i + 1}`));

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
  const [ildaPlayerCurrentFrameIndex, setIldaPlayerCurrentFrameIndex] = useState(0);
  const animationFrameId = useRef(null);

  // New state for rendering settings
  const [showBeamEffect, setShowBeamEffect] = useState(true);
  const [beamAlpha, setBeamAlpha] = useState(0.1);
  const [fadeAlpha, setFadeAlpha] = useState(0.13); // User's preferred value
  const [drawSpeed, setDrawSpeed] = useState(1000); // New state for drawSpeed

  // New state for active clips (one per layer)
  const [activeClipIndexes, setActiveClipIndexes] = useState(Array(layers.length).fill(null));
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

  const handleDropEffectOnLayer = useCallback((layerIndex, effectId) => {
    setLayerEffects(prevEffects => {
      const newEffects = [...prevEffects];
      newEffects[layerIndex] = [...newEffects[layerIndex], effectId];
      return newEffects;
    });
  }, []);

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
    setClipContents(prevContents => {
      const newContents = [...prevContents];
      newContents[layerIndex][colIndex] = parsedData;
      return newContents;
    });
    setClipNames(prevNames => {
        const newNames = [...prevNames];
        newNames[layerIndex][colIndex] = fileName;
        return newNames;
    });
  }, []);

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
    // Clear IldaPlayer if the cleared clip was the one being previewed
    if (selectedLayerIndex === layerIndex && selectedColIndex === colIndex) {
      setIldaFrames([]);
      setIldaPlayerCurrentFrameIndex(0);
    }
  }, [selectedLayerIndex, selectedColIndex, clipContents, clipNames, thumbnailFrameIndexes, activeClipIndexes, setIldaPlayerCurrentFrameIndex]);

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
      window.electronAPI.showLayerContextMenu(layerIndex); // Reusing existing layer context menu for now
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
      newIndexes[layerIndex][colIndex] = ildaPlayerCurrentFrameIndex;
      return newIndexes;
    });
  }, [ildaPlayerCurrentFrameIndex]);

  

  const handleMenuAction = useCallback((action) => {
    if (action.startsWith('set-theme-')) {
      const theme = action.substring('set-theme-'.length);
      setTheme(theme);
      return;
    }
    switch (action) {
      case 'render-mode-high-performance':
        setDrawSpeed(10000); // Example high draw speed
        setFadeAlpha(0.05); // Example crisper fade
        break;
      case 'render-mode-low-performance':
        setDrawSpeed(1000); // Example low draw speed
        setFadeAlpha(0.13); // Example smoother fade
        break;
      case 'toggle-beam-effect':
        setShowBeamEffect(prev => !prev);
        break;
      case 'clip-clear':
        if (selectedLayerIndex !== null && selectedColIndex !== null) {
          handleClearClip(selectedLayerIndex, selectedColIndex);
        }
        break;
      // Handle other menu actions as needed
      default:
        console.log(`Menu action: ${action}`);
    }
  }, [layers.length, columns.length, setDrawSpeed, setFadeAlpha, setShowBeamEffect, selectedLayerIndex, selectedColIndex, handleClearClip]);

  const handleContextMenuAction = useCallback((action) => {
    console.log(`Received context menu action: ${JSON.stringify(action)}`);
    console.log("Context menu action type:", action.type);
    switch (action.type) {
      case 'rename-layer':
        console.log(`Rename layer at index ${action.index}`);
        // Implement rename logic here
        break;
      case 'rename-column':
        console.log(`Rename column at index ${action.index}`);
        // Implement rename logic here
        break;
      case 'update-thumbnail':
        handleUpdateThumbnail(action.layerIndex, action.colIndex);
        break;
      case 'clear-clip':
        handleClearClip(action.layerIndex, action.colIndex);
        break;
      default:
        console.log(`Context menu action: ${action.type} for index ${action.index}`);
    }
  }, [handleUpdateThumbnail, handleClearClip]);

  const handleClipContextMenuCommand = useCallback(({ command, layerIndex, colIndex }) => {
    console.log(`Received clip context command: ${command} for clip L${layerIndex} C${colIndex}`);
    switch (command) {
      case 'update-thumbnail':
        handleUpdateThumbnail(layerIndex, colIndex);
        break;
      case 'cut-clip':
        console.log(`Cut clip L${layerIndex} C${colIndex}`);
        // Implement cut logic here
        break;
      case 'copy-clip':
        console.log(`Copy clip L${layerIndex} C${colIndex}`);
        // Implement copy logic here
        break;
      case 'paste-clip':
        console.log(`Paste clip L${layerIndex} C${colIndex}`);
        // Implement paste logic here
        break;
      case 'rename-clip':
        console.log(`Rename clip L${layerIndex} C${colIndex}`);
        // Implement rename logic here
        break;
      case 'clear-clip':
        handleClearClip(layerIndex, colIndex);
        break;
      default:
        console.log(`Unknown clip context command: ${command}`);
    }
  }, [handleUpdateThumbnail, handleClearClip]);

  const handleRenderSettingsCommand = useCallback(({ setting, value }) => {
    console.log(`Received render settings command: ${setting} with value ${value}`);
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
        console.log(`Unknown render setting: ${setting}`);
    }
  }, []);

  const handleClearColumnClips = useCallback((colIndex) => {
    setClipContents(prevContents => {
      const newContents = prevContents.map(layer => {
        const newLayer = [...layer];
        newLayer[colIndex] = null;
        return newLayer;
      });
      return newContents;
    });
    setClipNames(prevNames => {
      const newNames = prevNames.map((layer, layerIndex) => {
        const newLayer = [...layer];
        newLayer[colIndex] = `Clip ${layerIndex + 1}-${colIndex + 1}`;
        return newLayer;
      });
      return newNames;
    });
    setThumbnailFrameIndexes(prevIndexes => {
      const newIndexes = prevIndexes.map(layer => {
        const newLayer = [...layer];
        newLayer[colIndex] = 0;
        return newLayer;
      });
      return newIndexes;
    });
    setActiveClipIndexes(prevActive => {
      const newActive = [...prevActive];
      // If any layer had an active clip in this column, deactivate it
      return newActive.map(activeCol => (activeCol === colIndex ? null : activeCol));
    });
    // Clear IldaPlayer if any clip in the cleared column was being previewed
    if (selectedColIndex === colIndex) {
      setIldaFrames([]);
      setIldaPlayerCurrentFrameIndex(0);
    }
  }, [selectedColIndex, setIldaFrames, setIldaPlayerCurrentFrameIndex]);

  const handleColumnHeaderClipContextMenuCommand = useCallback(({ command, colIndex }) => {
    if (command === 'clear-column-clips') {
      handleClearColumnClips(colIndex);
      return;
    }

    if (selectedLayerIndex !== null && selectedColIndex !== null) {
      console.log(`Received column header clip context command: ${command} for selected clip L${selectedLayerIndex} C${selectedColIndex}`);
      switch (command) {
        case 'update-thumbnail':
          handleUpdateThumbnail(selectedLayerIndex, selectedColIndex);
          break;
        case 'cut-clip':
          console.log(`Cut selected clip L${selectedLayerIndex} C${selectedColIndex}`);
          // Implement cut logic here
          break;
        case 'copy-clip':
          console.log(`Copy selected clip L${selectedLayerIndex} C${selectedColIndex}`);
          // Implement copy logic here
          break;
        case 'paste-clip':
          console.log(`Paste selected clip L${selectedLayerIndex} C${selectedColIndex}`);
          // Implement paste logic here
          break;
        case 'rename-clip':
          console.log(`Rename selected clip L${selectedLayerIndex} C${selectedColIndex}`);
          // Implement rename logic here
          break;
        case 'clear-clip':
          handleClearClip(selectedLayerIndex, selectedColIndex);
          break;
        default:
          console.log(`Unknown column header clip context command: ${command}`);
      }
    } else {
      console.log(`No clip selected for column header clip context command: ${command}`);
    }
  }, [selectedLayerIndex, selectedColIndex, handleUpdateThumbnail, handleClearClip, handleClearColumnClips]);

  const handleLayerFullContextMenuCommand = useCallback((command, layerIndex) => {
    console.log(`Received layer full context command: ${command} for layer: ${layerIndex}`);
    switch (command) {
      case 'layer-insert-above':
        console.log(`Insert layer above index ${layerIndex}`);
        // Implement insert above logic here
        break;
      case 'layer-insert-below':
        console.log(`Insert layer below index ${layerIndex}`);
        // Implement insert below logic here
        break;
      case 'layer-rename':
        console.log(`Rename layer at index ${layerIndex}`);
        // Implement rename logic here
        break;
      case 'layer-clear-clips':
        handleClearLayerClips(layerIndex);
        break;
      default:
        console.log(`Unknown layer full context command: ${command}`);
    }
  }, [handleClearLayerClips]);

  useEffect(() => {
    if (window.electronAPI) {
      const cleanupMenu = window.electronAPI.onMenuAction(handleMenuAction);
      const cleanupContext = window.electronAPI.onContextMenuActionFromMain(handleContextMenuAction);
      const cleanupClipContext = window.electronAPI.onClipContextMenuCommand(handleClipContextMenuCommand);
      const cleanupRenderSettings = window.electronAPI.onRenderSettingsCommand(handleRenderSettingsCommand);
      const cleanupColumnHeaderClipContext = window.electronAPI.onColumnHeaderClipContextMenuCommand(handleColumnHeaderClipContextMenuCommand);
      const cleanupLayerFullContext = window.electronAPI.onLayerFullContextMenuCommand(handleLayerFullContextMenuCommand);

      return () => {
        cleanupMenu();
        cleanupContext();
        cleanupClipContext();
        cleanupRenderSettings();
        cleanupColumnHeaderClipContext();
        cleanupLayerFullContext();
      };
    }
  }, [handleMenuAction, handleContextMenuAction, handleClipContextMenuCommand, handleRenderSettingsCommand, handleColumnHeaderClipContextMenuCommand, handleLayerFullContextMenuCommand, selectedLayerIndex, selectedColIndex]);

  

  const activeClipsData = layers.map((_, layerIndex) => {
    const activeColIndex = activeClipIndexes[layerIndex];
    if (activeColIndex !== null) {
        return clipContents[layerIndex][activeColIndex];
    }
    return null;
  }).filter(Boolean);

  return (
    <div className="app">
      <NotificationPopup message={notification.message} visible={notification.visible} />

      {/* Top Bar */}
      <div className="top-bar">
        <div className="top-bar-left-area">
          <CompositionControls />
          <MasterIntensitySlider />
          <LaserOnOffButton />
        </div>
        <div className="top-bar-right-area">
          <div className="column-headers-container">
            {columns.map((colName, colIndex) => (
              <ColumnHeader key={colIndex} name={colName} index={colIndex} onShowColumnHeaderContextMenu={() => handleShowColumnHeaderContextMenu(colIndex)} />
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main-content">
        {/* Clip Deck */}
        <div className="clip-deck">
          {layers.map((layerName, layerIndex) => {
            const activeColIndex = activeClipIndexes[layerIndex];
            const activeClipDataForLayer = activeColIndex !== null ? clipContents[layerIndex][activeColIndex] : null;

            return (
              <div key={layerIndex} className="layer-row">
                <LayerControls
                  layerName={layerName}
                  layerIndex={layerIndex}
                  layerEffects={layerEffects[layerIndex]}
                  activeClipData={activeClipDataForLayer}
                  onDeactivateLayerClips={() => handleDeactivateLayerClips(layerIndex)}
                  onShowLayerFullContextMenu={() => handleShowLayerFullContextMenu(layerIndex)}
                />
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
                    onDropGenerator={(parsedData, fileName) => handleDropGenerator(layerIndex, colIndex, parsedData, fileName)}
                    onLabelClick={() => handleClipPreview(layerIndex, colIndex)}
                    isSelected={selectedLayerIndex === layerIndex && selectedColIndex === colIndex}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Panel for Previews */}
      <div className="bottom-panel">
		<FileBrowser onDropIld={handleDropGenerator} />
        <GeneratorPanel />
        <EffectPanel />
        <DacPanel dacs={dacs} />
      </div>
	  <div className="side-panel">
        <IldaPlayer
          ildaFrames={ildaFrames}
          showBeamEffect={showBeamEffect}
          beamAlpha={beamAlpha}
          fadeAlpha={fadeAlpha}
          drawSpeed={drawSpeed}
          onFrameChange={(frameIndex) => {
            setIldaPlayerCurrentFrameIndex(frameIndex);
            }}
        />
        <WorldPreview
          worldData={activeClipsData}
          showBeamEffect={showBeamEffect}
          beamAlpha={beamAlpha}
          fadeAlpha={fadeAlpha}
          drawSpeed={drawSpeed}
        />
      </div>
    </div>
  );
}

export default App;