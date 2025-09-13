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

const MasterIntensitySlider = () => (
  <div className="master-intensity-slider">
    <input type="range" min="0" max="100" defaultValue="50" className="slider" id="masterRange" />
  </div>
);

const LaserOnOffButton = () => (
  <div className="container"><input type="checkbox" /></div>
);

const WorldPreview = () => (
  <div className="world-preview">
    <h3>World Preview</h3>
    <div className="preview-area"></div>
  </div>
);

function App() {
  const [columns, setColumns] = useState(Array.from({ length: 13 }, (_, i) => `Col ${i + 1}`));
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
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const animationFrameId = useRef(null);

  // New state for rendering settings
  const [showBeamEffect, setShowBeamEffect] = useState(true);
  const [beamAlpha, setBeamAlpha] = useState(0.1);
  const [fadeAlpha, setFadeAlpha] = useState(0.13); // User's preferred value
  const [drawSpeed, setDrawSpeed] = useState(1000); // New state for drawSpeed

  // New state for active clips (one per layer)
  const [activeClipIndexes, setActiveClipIndexes] = useState(Array(layers.length).fill(null));
  const [lastDroppedClip, setLastDroppedClip] = useState(null);

  const showNotification = useCallback((message) => {
    setNotification({ message, visible: true });
    setTimeout(() => {
      setNotification({ message: '', visible: false });
    }, 3000);
  }, []);

  const addLayer = useCallback(() => {
    setLayers(prevLayers => [...prevLayers, `Layer ${prevLayers.length + 1}`]);
    setClipContents(prevContents => [...prevContents, Array(columns.length).fill(null)]);
    setClipEffects(prevEffects => [...prevEffects, Array(columns.length).fill([])]);
    setLayerEffects(prevEffects => [...prevEffects, []]);
    setClipDacs(prevDacs => [...prevDacs, Array(columns.length).fill(null)]);
  }, [columns.length]);

  const deleteLayer = useCallback((indexToDelete) => {
    setLayers(prevLayers => {
      console.log(`Deleting layer at index: ${indexToDelete}`);
      return prevLayers.filter((_, index) => index !== indexToDelete);
    });
    setClipContents(prevContents => prevContents.filter((_, index) => index !== indexToDelete));
    setClipEffects(prevEffects => prevEffects.filter((_, index) => index !== indexToDelete));
    setLayerEffects(prevEffects => prevEffects.filter((_, index) => index !== indexToDelete));
    setClipDacs(prevDacs => prevDacs.filter((_, index) => index !== indexToDelete));
  }, []);

  const addColumn = useCallback(() => {
    setColumns(prevColumns => [...prevColumns, `Col ${prevColumns.length + 1}`]);
    setClipContents(prevContents => prevContents.map(layer => [...layer, null]));
    setClipEffects(prevEffects => prevEffects.map(layer => [...layer, []]));
    setClipDacs(prevDacs => prevDacs.map(layer => [...layer, null]));
  }, []);

  const deleteColumn = useCallback((indexToDelete) => {
    setColumns(prevColumns => {
      console.log(`Deleting column at index: ${indexToDelete}`);
      return prevColumns.filter((_, index) => index !== indexToDelete);
    });
    setClipContents(prevContents => prevContents.map(layer => layer.filter((_, index) => index !== indexToDelete)));
    setClipEffects(prevEffects => prevEffects.map(layer => layer.filter((_, index) => index !== indexToDelete)));
    setClipDacs(prevDacs => prevDacs.map(layer => layer.filter((_, index) => index !== indexToDelete)));
  }, []);

  const handleDropEffectOnClip = useCallback((layerIndex, colIndex, effectId) => {
    setClipEffects(prevEffects => {
      const newEffects = [...prevEffects];
      newEffects[layerIndex][colIndex] = [...newEffects[layerIndex][colIndex], effectId];
      return newEffects;
    });
  }, []);

  const handleDropEffectOnLayer = useCallback((layerIndex, effectId) => {
    setLayerEffects(prevEffects => {
      const newEffects = [...prevEffects];
      newEffects[layerIndex] = [...newEffects[layerIndex], effectId];
      return newEffects;
    });
  }, []);

  const handleDropDacOnClip = useCallback((layerIndex, colIndex, dacId, channelId) => {
    setClipDacs(prevDacs => {
      const newDacs = [...prevDacs];
      newDacs[layerIndex][colIndex] = { dacId, channelId };
      return newDacs;
    });
  }, []);

  const handleClipClick = useCallback((layerIndex, colIndex) => {
    console.log(`Previewing clip: Layer ${layerIndex}, Column ${colIndex}`); // Add this log
    setSelectedLayerIndex(layerIndex);
    setSelectedColIndex(colIndex);
    const clipData = clipContents[layerIndex][colIndex];
    if (clipData && clipData.frames) {
      console.log(`Found ${clipData.frames.length} frames for preview.`); // Add this log
      setIldaFrames(clipData.frames);
      setCurrentFrameIndex(0);
    } else {
      console.log("No frames found for preview."); // Add this log
      setIldaFrames([]);
    }
  }, [clipContents]);

  const handlePreviewClick = useCallback((layerIndex, colIndex) => {
    const clipData = clipContents[layerIndex][colIndex];
    if (clipData && clipData.frames) {
      setIldaFrames(clipData.frames);
      setCurrentFrameIndex(0);
    } else {
      setIldaFrames([]);
    }
  }, [clipContents]);

  const handleActivateClick = useCallback((layerIndex, colIndex) => {
    console.log(`Activating clip: Layer ${layerIndex}, Column ${colIndex}`); // Add this log
    setActiveClipIndexes(prevActive => {
      const newActive = [...prevActive];
      newActive[layerIndex] = colIndex;
      return newActive;
    });
    // Also set as selected for immediate preview update
    setSelectedLayerIndex(layerIndex);
    setSelectedColIndex(colIndex);
    const clipData = clipContents[layerIndex][colIndex];
    if (clipData && clipData.frames) {
      setIldaFrames(clipData.frames);
      setCurrentFrameIndex(0);
    } else {
      setIldaFrames([]);
    }
  }, [clipContents]);

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
    // Set the last dropped clip to be activated by useEffect
    setLastDroppedClip({ layerIndex, colIndex });
  }, []);

  // useEffect to activate the clip after it has been dropped
  useEffect(() => {
    if (lastDroppedClip) {
      handleActivateClick(lastDroppedClip.layerIndex, lastDroppedClip.colIndex);
      setLastDroppedClip(null); // Reset after activation
    }
  }, [lastDroppedClip]);

  const handleUpdateThumbnail = useCallback((layerIndex, colIndex) => {
    if (selectedLayerIndex === layerIndex && selectedColIndex === colIndex) {
      setThumbnailFrameIndexes(prevIndexes => {
        const newIndexes = [...prevIndexes];
        newIndexes[layerIndex][colIndex] = currentFrameIndex;
        return newIndexes;
      });
    }
  }, [selectedLayerIndex, selectedColIndex, currentFrameIndex]);

  useEffect(() => {
    if (window.electronAPI) {
      const handleMenuAction = (action) => {
        switch (action) {
          case 'layer-new':
            addLayer();
            break;
          case 'layer-delete':
            // For simplicity, delete the last layer for now
            deleteLayer(layers.length - 1);
            break;
          case 'column-new':
            addColumn();
            break;
          case 'column-remove':
            // For simplicity, remove the last column for now
            deleteColumn(columns.length - 1);
            break;
          // Handle other menu actions as needed
          default:
            console.log(`Menu action: ${action}`);
        }
      };

      const handleContextMenuAction = (action) => {
        console.log(`Received context menu action: ${JSON.stringify(action)}`);
        switch (action.type) {
          case 'delete-layer':
            deleteLayer(action.index);
            break;
          case 'rename-layer':
            console.log(`Rename layer at index ${action.index}`);
            // Implement rename logic here
            break;
          case 'delete-column':
            deleteColumn(action.index);
            break;
          case 'rename-column':
            console.log(`Rename column at index ${action.index}`);
            // Implement rename logic here
            break;
          default:
            console.log(`Context menu action: ${action.type} for index ${action.index}`);
        }
      };

      const cleanupMenu = window.electronAPI.onMenuAction(handleMenuAction);
      const cleanupContext = window.electronAPI.onContextMenuActionFromMain(handleContextMenuAction);

      return () => {
        cleanupMenu();
        cleanupContext();
      };
    }
  }, [addLayer, deleteLayer, addColumn, deleteColumn]); // Dependencies are now the memoized functions

  useEffect(() => {
    if (ildaFrames.length > 1) {
        const interval = setInterval(() => {
            setCurrentFrameIndex(prevIndex => (prevIndex + 1) % ildaFrames.length);
        }, 100); // Change frame every 100ms
        return () => clearInterval(interval);
    }
  }, [ildaFrames]);

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
        <CompositionControls />
        <MasterIntensitySlider />
        <LaserOnOffButton />
        <div className="column-headers-container">
          {columns.map((colName, colIndex) => (
            <ColumnHeader key={colIndex} name={colName} />
          ))}
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
                />
                {columns.map((colName, colIndex) => (
                  <Clip
                    key={colIndex}
                    layerIndex={layerIndex}
                    colIndex={colIndex}
                    clipName={clipNames[layerIndex][colIndex]}
                    clipContent={clipContents[layerIndex][colIndex]}
                    thumbnailFrameIndex={thumbnailFrameIndexes[layerIndex][colIndex]}
                    onPreviewClick={() => handleClipClick(layerIndex, colIndex)}
                    onActivateClick={() => handleActivateClick(layerIndex, colIndex)}
                    onUpdateThumbnail={handleUpdateThumbnail}
                    isActive={activeClipIndexes[layerIndex] === colIndex}
                    onUnsupportedFile={showNotification}
                    onDropGenerator={(parsedData, fileName) => handleDropGenerator(layerIndex, colIndex, parsedData, fileName)}
                  />
                ))}
              </div>
            );
          })}}
        </div>
      </div>

      {/* Bottom Panel for Previews */}
      <div className="bottom-panel">
        <IldaPlayer
          ildaFrames={ildaFrames}
          currentFrameIndex={currentFrameIndex}
          setCurrentFrameIndex={setCurrentFrameIndex}
          showBeamEffect={showBeamEffect}
          beamAlpha={beamAlpha}
          fadeAlpha={fadeAlpha}
          drawSpeed={drawSpeed}
        />
		<FileBrowser onDropIld={handleDropGenerator} />
        <GeneratorPanel />
        <EffectPanel />
        <DacPanel dacs={dacs} />
        <WorldPreview worldData={activeClipsData} />
      </div>
    </div>
  );
}

export default App;
