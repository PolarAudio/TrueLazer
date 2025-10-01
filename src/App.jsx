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


  // New state for rendering settings
  const [showBeamEffect, setShowBeamEffect] = useState(true);
  const [beamAlpha, setBeamAlpha] = useState(0.1);
  const [fadeAlpha, setFadeAlpha] = useState(0.13); // User's preferred value
  const [drawSpeed, setDrawSpeed] = useState(1000); // New state for drawSpeed

  // New state for active clips (one per layer)
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
  // Here you can store the effect data with the clip
  // For example, you might want to add it to clipContents or create a separate state
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
    console.log('handleClipPreview - clipData:', clipData);
    if (clipData && clipData.frames) {
      setIldaFrames(clipData.frames);
      console.log('handleClipPreview - setting IldaFrames:', clipData.frames.length);
    } else {
      setIldaFrames([]);
      console.log('handleClipPreview - setting empty IldaFrames');
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
  if (!parsedData || !parsedData.frames) {
    showNotification('Invalid file format');
    return;
  }
  // Check if this is actually effect data
  if (parsedData && parsedData.type === 'effect') {
    handleDropEffectOnClip(layerIndex, colIndex, parsedData);
    return;
  }
  
  // Original ILD file handling
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
}, [showNotification, handleDropEffectOnClip]);

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
      ildaPlayerCurrentFrameIndex.current = 0;
    }
  }, [selectedLayerIndex, selectedColIndex, setClipContents, setClipNames, setThumbnailFrameIndexes, setActiveClipIndexes, setIldaFrames]);

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
        setDrawSpeed(1000); // Example high draw speed
        setFadeAlpha(0.05); // Example crisper fade
        break;
      case 'render-mode-low-performance':
        setDrawSpeed(100); // Example low draw speed
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
    }
  }, [layers.length, columns.length, setDrawSpeed, setFadeAlpha, setShowBeamEffect, selectedLayerIndex, selectedColIndex, handleClearClip]);



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
      ildaPlayerCurrentFrameIndex.current = 0;
    }
  }, [selectedColIndex, setIldaFrames, setClipContents, setClipNames, setThumbnailFrameIndexes, setActiveClipIndexes]);

  const handleColumnHeaderClipContextMenuCommand = useCallback(({ command, colIndex }) => {
    if (command === 'clear-column-clips') {
      handleClearColumnClips(colIndex);
      return;
    }

    if (selectedLayerIndex !== null && selectedColIndex !== null) {
      switch (command) {
        case 'update-thumbnail':
          handleUpdateThumbnail(selectedLayerIndex, selectedColIndex);
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
          handleClearClip(selectedLayerIndex, selectedColIndex);
          break;
        default:
      }
    } else {
    }
  }, [selectedLayerIndex, selectedColIndex, handleUpdateThumbnail, handleClearClip, handleClearColumnClips, showNotification]);

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

  return (
    <div className="app">
      <ErrorBoundary>
        <NotificationPopup message={notification.message} visible={notification.visible} />
        {/* Main Content Area */}
        <div className="main-content">
  		{/* Top Bar */}
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
  					onDropGenerator={(parsedData, fileName) => handleDropGenerator(layerIndex, colIndex, parsedData, fileName)}
  					onDropEffect={(effectData) => handleDropEffectOnClip(layerIndex, colIndex, effectData)} // Add this
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
  		{/* Middle Bar */}
  		<div className="middle-bar">
  			<div className="middle-bar-left-area">
  				<BPMControls />
  				<MasterSpeedSlider />
  			</div>
  			<div className="middle-bar-right-area">

  			</div>
  		</div>
  		{/* Bottom Panel for Previews */}
            <div className="bottom-panel">
  			<FileBrowser onDropIld={handleDropGenerator} />
  			<GeneratorPanel />
  			<EffectPanel />
  			<DacPanel dacs={dacs} />
              <SettingsPanel />
            </div>
        </div>
      </ErrorBoundary>
    </div>
  );
}

export default App;