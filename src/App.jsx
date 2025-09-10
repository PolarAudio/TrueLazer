import React, { useState, useEffect, useCallback } from 'react';
import CompositionControls from './components/CompositionControls';
import ColumnHeader from './components/ColumnHeader';
import LayerControls from './components/LayerControls';
import Clip from './components/Clip';
import FileBrowser from './components/FileBrowser';
import GeneratorPanel from './components/GeneratorPanel';
import EffectPanel from './components/EffectPanel';
import DacPanel from './components/DacPanel';
import NotificationPopup from './components/NotificationPopup';

const MasterIntensitySlider = () => (
  <div className="master-intensity-slider">
    <input type="range" min="0" max="100" defaultValue="50" className="slider" id="masterRange" />
  </div>
);

const LaserOnOffButton = () => (
  <button className="laser-on-off-button">Laser On/Off</button>
);

const SelectedClipPreview = () => (
  <div className="selected-clip-preview">
    <h3>Selected Clip Preview</h3>
    <div className="preview-area"></div>
  </div>
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

  // Initialize clip content state
  const initialClipContent = Array(layers.length).fill(null).map(() =>
    Array(columns.length).fill(null)
  );
  const [clipContents, setClipContents] = useState(initialClipContent);

  // Initialize clip effects state (2D array of arrays)
  const initialClipEffects = Array(layers.length).fill(null).map(() =>
    Array(columns.length).fill([])
  );
  const [clipEffects, setClipEffects] = useState(initialClipEffects);

  // Initialize layer effects state (1D array of arrays)
  const initialLayerEffects = Array(layers.length).fill([]);
  const [layerEffects, setLayerEffects] = useState(initialLayerEffects);

  // Initialize DAC assignment for clips (2D array of objects { dacId, channelId })
  const initialClipDacs = Array(layers.length).fill(null).map(() =>
    Array(columns.length).fill(null)
  );
  const [clipDacs, setClipDacs] = useState(initialClipDacs);

  const [selectedLayerIndex, setSelectedLayerIndex] = useState(null);
  const [selectedColIndex, setSelectedColIndex] = useState(null);
  const [showShortcutsWindow, setShowShortcutsWindow] = useState(false);
  const [notification, setNotification] = useState({ message: '', visible: false });
  const initialClipNames = Array(layers.length).fill(null).map((_, layerIndex) =>
    Array(columns.length).fill(null).map((_, colIndex) => `Clip ${layerIndex + 1}-${colIndex + 1}`)
  );
  const [clipNames, setClipNames] = useState(initialClipNames);

  const showNotification = useCallback((message) => {
    setNotification({ message, visible: true });
    setTimeout(() => {
      setNotification({ message: '', visible: false });
    }, 3000); // Hide after 3 seconds
  }, []);

  

  // Hardcoded DACs for now
  const [dacs, setDacs] = useState([
    { id: 'dac1', name: 'Showbridge 1', channels: ['ch1', 'ch2'] },
    { id: 'dac2', name: 'Showbridge 2', channels: ['ch1', 'ch2'] },
  ]);

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

  const handleDropGenerator = useCallback((layerIndex, colIndex, parsedData, fileName) => {
    setClipContents(prevContents => {
      const newContents = [...prevContents];
      newContents[layerIndex][colIndex] = parsedData;
      return newContents;
    });
    if (fileName) {
      setClipNames(prevNames => {
        const newNames = [...prevNames];
        newNames[layerIndex][colIndex] = fileName;
        return newNames;
      });
    }
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
    console.log(`Clip clicked: Layer ${layerIndex}, Column ${colIndex}`);
    setSelectedLayerIndex(layerIndex);
    setSelectedColIndex(colIndex);
  }, []);

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

  const selectedClipData = selectedLayerIndex !== null && selectedColIndex !== null
    ? {
        clipName: `Clip ${selectedLayerIndex + 1}-${selectedColIndex + 1}`,
        generatorId: clipContents[selectedLayerIndex][selectedColIndex],
        clipEffects: clipEffects[selectedLayerIndex][selectedColIndex],
        dacAssignment: clipDacs[selectedLayerIndex][selectedColIndex],
      }
    : null;

  return (
    <div className="app">
      <div className="main-content">
        <div className="left-panel">
          <div className="composition-row">
		    <div className="composition-controls-top">
              <span className="composition-label">Comp</span>
              <span className="comp-control-button">X</span>
              <span className="comp-control-button">B</span>
			  <MasterIntensitySlider />
			  <LaserOnOffButton />
            </div>
          </div>
          {layers.map((layerName, index) => (
            <LayerControls
              key={index}
              layerName={layerName}
              index={index}
              onDropEffect={(effectId) => handleDropEffectOnLayer(index, effectId)}
              layerEffects={layerEffects[index]}
            />
          ))}
        </div>
        <div className="clip-deck">
          <div className="composition-header-row">
            <div className="column-headers">
              {columns.map((colName, index) => (
                <ColumnHeader key={index} name={colName} index={index} />
              ))}
            </div>
          </div>
          {layers.map((layerName, layerIndex) => (
            <div key={layerIndex} className="layer-row">
              <div className="clip-container">
                {columns.map((colName, colIndex) => (
                  <Clip
                    key={colIndex}
                    clipName={clipNames[layerIndex][colIndex]}
                    onDropGenerator={(generatorId, fileName) => handleDropGenerator(layerIndex, colIndex, generatorId, fileName)}
                    generatorId={clipContents[layerIndex][colIndex]}
                    onDropEffect={(effectId) => handleDropEffectOnClip(layerIndex, colIndex, effectId)}
                    onUnsupportedFile={showNotification}
                    clipEffects={clipEffects[layerIndex][colIndex]}
                    onClick={() => handleClipClick(layerIndex, colIndex)}
                    isSelected={selectedLayerIndex === layerIndex && selectedColIndex === colIndex}
                    dacAssignment={clipDacs[layerIndex][colIndex]}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
		<div className="bottom-panel">
			<SelectedClipPreview selectedClipData={selectedClipData} />
			<WorldPreview
				allClipContents={clipContents}
				allClipEffects={clipEffects}
				allLayerEffects={layerEffects}
			/>
			<GeneratorPanel />
			<EffectPanel />
			<DacPanel dacs={dacs} />
			<FileBrowser />
		</div>

      {/* Temporarily remove window components for simplification */}
      {/* {showShortcutsWindow && <ShortcutsWindow onClose={toggleShortcutsWindow} />}
      {showOutputSettingsWindow && <OutputSettingsWindow onClose={toggleOutputSettingsWindow} />} */}
    {/* {showShortcutsWindow && <ShortcutsWindow onClose={toggleShortcutsWindow} />} */}
      {/* {showOutputSettingsWindow && <OutputSettingsWindow onClose={toggleOutputSettingsWindow} />} */}
      <NotificationPopup message={notification.message} visible={notification.visible} />
    </div>
  );
}

export default App;
