import React, { useReducer, useEffect, useCallback, useRef, useMemo, useState } from 'react';
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
import GeneratorSettingsPanel from './components/GeneratorSettingsPanel';
import ErrorBoundary from './components/ErrorBoundary';
import { useIldaParserWorker } from './contexts/IldaParserWorkerContext';
import { applyEffects } from './utils/effects';
import { generateCircle, generateSquare, generateLine, generateStar, generateText } from './utils/generators'; // Import generator functions

const MasterSpeedSlider = ({ drawSpeed, onSpeedChange }) => (
  <div className="master-speed-slider">
    <label htmlFor="masterSpeedRange">Playback Speed</label>
    <input type="range" min="50" max="250" value={drawSpeed} className="slider" id="masterSpeedRange" onChange={(e) => onSpeedChange(parseInt(e.target.value))} />
  </div>
);

const MasterIntensitySlider = () => (
  <div className="master-intensity-slider">
    <input type="range" min="0" max="100" defaultValue="50" className="slider" id="masterIntensityRange" />
  </div>
);

const LaserOnOffButton = ({ isWorldOutputActive, onToggleWorldOutput }) => (
  <div className="container">
    <label>
      <input type="checkbox" checked={isWorldOutputActive} onChange={onToggleWorldOutput} />
    </label>
  </div>
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
  drawSpeed: 33,
  previewScanRate: 1,
  beamRenderMode: 'points',
  activeClipIndexes: Array(5).fill(null),
  isPlaying: false,
  isWorldOutputActive: false, // Controls whether frames are sent to DACs
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
    case 'SET_ILDA_FRAMES': // This might become deprecated or refactored later
        return { ...state, ildaFrames: action.payload };
    case 'SET_SELECTED_ILDA_DATA': // For ILDA files, or when a generator's frame is selected
        return { ...state, selectedIldaWorkerId: action.payload.workerId, selectedIldaTotalFrames: action.payload.totalFrames, selectedGeneratorId: action.payload.generatorId, selectedGeneratorParams: action.payload.generatorParams };
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
        // Also clear selected clip if it's the one being cleared
        if (state.selectedLayerIndex === action.payload.layerIndex && state.selectedColIndex === action.payload.colIndex) {
          return { ...state, clipContents: clearedClipContents, clipNames: clearedClipNames, thumbnailFrameIndexes: clearedThumbnailFrameIndexes, activeClipIndexes: clearedActiveClipIndexes, selectedLayerIndex: null, selectedColIndex: null, selectedIldaWorkerId: null, selectedIldaTotalFrames: 0, selectedGeneratorId: null, selectedGeneratorParams: {} };
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
    case 'UPDATE_GENERATOR_PARAM':
        const updatedGenClipContents = [...state.clipContents];
        const genClipToUpdate = { ...updatedGenClipContents[action.payload.layerIndex][action.payload.colIndex] };
        if (genClipToUpdate && genClipToUpdate.type === 'generator' && genClipToUpdate.currentParams) {
          genClipToUpdate.currentParams = {
            ...genClipToUpdate.currentParams,
            [action.payload.paramName]: action.payload.newValue
          };
          updatedGenClipContents[action.payload.layerIndex][action.payload.colIndex] = genClipToUpdate;
          // If this is the currently selected clip, update its parameters in the global state too
          if (state.selectedLayerIndex === action.payload.layerIndex && state.selectedColIndex === action.payload.colIndex) {
            return {
              ...state,
              clipContents: updatedGenClipContents,
              selectedGeneratorParams: genClipToUpdate.currentParams,
            };
          }
        }
        return { ...state, clipContents: updatedGenClipContents };
    case 'SET_DACS':
      return { ...state, dacs: action.payload };
    case 'SET_SELECTED_DAC':
      return { ...state, selectedDac: action.payload };
    case 'SET_IS_PLAYING':
      return { ...state, isPlaying: action.payload };
    case 'SET_WORLD_OUTPUT_ACTIVE':
      return { ...state, isWorldOutputActive: action.payload };
    case 'SET_CLIP_DAC':
      const newClipContentsWithDac = [...state.clipContents];
      const clipToUpdateDac = { ...newClipContentsWithDac[action.payload.layerIndex][action.payload.colIndex] };
      clipToUpdateDac.dac = action.payload.dac;
      newClipContentsWithDac[action.payload.layerIndex][action.payload.colIndex] = clipToUpdateDac;
      return { ...state, clipContents: newClipContentsWithDac };
    default:
      return state;
  }
}

function App() {
  const ildaPlayerCurrentFrameIndex = useRef(0);
  const playCommandSentRef = useRef(false);

    const activeClipsData = useMemo(() => layers.map((_, layerIndex) => {
      const activeColIndex = activeClipIndexes[layerIndex];
      if (activeColIndex !== null) {
          const clip = clipContents[layerIndex][activeColIndex];
          if (clip) {
              if (clip.type === 'ilda' && clip.workerId && clip.totalFrames) {
                  return {
                      type: 'ilda',
                      workerId: clip.workerId,
                      totalFrames: clip.totalFrames,
                      effects: clip.effects || [],
                      dac: clip.dac || null,
                      ildaFormat: clip.ildaFormat || 0,
                  };
              } else if (clip.type === 'generator' && clip.frames && clip.generatorDefinition) {
                  // For generators, the "frame" is already the generated one
                  return {
                      type: 'generator',
                      workerId: `generator-${layerIndex}-${activeColIndex}`, // Create a unique ID for the generator's "worker"
                      totalFrames: clip.frames.length, // Typically 1 for static generators
                      effects: clip.effects || [],
                      dac: clip.dac || null,
                      ildaFormat: 0, // Generators don't have an ILDA format in this sense
                      currentFrame: clip.frames[0], // The current (and usually only) frame
                  };
              }
          }
      }
      return null;
    }).filter(Boolean), [layers, activeClipIndexes, clipContents]);

  const workerIdsToFetch = useMemo(() => {
    const ids = new Set();
    if (selectedIldaWorkerId) { // Only add if it's an ILDA worker
      ids.add(selectedIldaWorkerId);
    }
    activeClipsData.forEach(clip => {
      if (clip && clip.type === 'ilda' && clip.workerId) { // Only add ILDA worker IDs
        ids.add(clip.workerId);
      }
    });
    return Array.from(ids);
  }, [selectedIldaWorkerId, activeClipsData]);

  useEffect(() => {
    if (!ildaParserWorker) return;

    const handleMessage = (e) => {
      if (e.data.type === 'get-frame' && e.data.success) {
        setLiveFrames(prev => ({ ...prev, [e.data.workerId]: e.data.frame }));
      }
    };
    ildaParserWorker.addEventListener('message', handleMessage);
    
    let animationFrameId;
    const frameFetcherLoop = (timestamp) => {
      // Handle ILDA clips (frames fetched from worker)
      workerIdsToFetch.forEach(workerId => {
        if (!lastFrameFetchTimeRef.current[workerId]) {
          lastFrameFetchTimeRef.current[workerId] = 0;
        }
        if (timestamp - lastFrameFetchTimeRef.current[workerId] > drawSpeed) {
          lastFrameFetchTimeRef.current[workerId] = timestamp;
          
          const clip = clipContents.flat().find(c => c && c.type === 'ilda' && c.workerId === workerId);
          if (clip && clip.totalFrames > 0) {
            if (frameIndexesRef.current[workerId] === undefined) {
              frameIndexesRef.current[workerId] = 0;
            }
            ildaParserWorker.postMessage({ type: 'get-frame', workerId, frameIndex: frameIndexesRef.current[workerId] });
            
            if (isPlaying) {
              frameIndexesRef.current[workerId] = (frameIndexesRef.current[workerId] + 1) % clip.totalFrames;
            }
          }
        }
      });

      // Handle Generator clips (frames are directly available)
      activeClipsData.filter(clip => clip.type === 'generator').forEach(clip => {
        if (clip && clip.currentFrame) {
          setLiveFrames(prev => ({ ...prev, [clip.workerId]: clip.currentFrame }));
        }
      });

      animationFrameId = requestAnimationFrame(frameFetcherLoop);
    };

    animationFrameId = requestAnimationFrame(frameFetcherLoop);

    return () => {
      ildaParserWorker.removeEventListener('message', handleMessage);
      cancelAnimationFrame(animationFrameId);
    };
  }, [ildaParserWorker, workerIdsToFetch, drawSpeed, clipContents, isPlaying, activeClipsData]);

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
    if (clipData) {
      if (clipData.type === 'ilda' && clipData.workerId && clipData.totalFrames) {
          dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: clipData.workerId, totalFrames: clipData.totalFrames, generatorId: null, generatorParams: {} } });
      } else if (clipData.type === 'generator' && clipData.generatorDefinition && clipData.currentParams) {
          dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: null, totalFrames: 0, generatorId: clipData.generatorDefinition.id, generatorParams: clipData.currentParams } });
      } else {
          dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: null, totalFrames: 0, generatorId: null, generatorParams: {} } });
      }
    } else {
        dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: null, totalFrames: 0, generatorId: null, generatorParams: {} } });
    }
  }, [clipContents]);

  const handleActivateClick = useCallback((layerIndex, colIndex) => {
    console.log('Activated clip:', layerIndex, colIndex);
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
    // When a generator is dropped, use its defaultParams
    console.log('App: handleDropGenerator - Sending defaultParams to worker:', generator.defaultParams); // Added log
    generatorWorker.postMessage({ type: 'generate-frame', generator: { ...generator, params: generator.defaultParams }, layerIndex, colIndex });
  }, [generatorWorker, showNotification]);

  const handleGeneratorParameterChange = useCallback((paramId, newValue) => {
    if (selectedLayerIndex === null || selectedColIndex === null || !generatorWorker) return;

    const clipData = clipContents[selectedLayerIndex][selectedColIndex];
    if (clipData && clipData.type === 'generator') {
      const updatedParams = {
        ...clipData.currentParams,
        [paramId]: newValue,
      };

      // Dispatch action to update the state with new parameters
      dispatch({ type: 'UPDATE_GENERATOR_PARAM', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, paramName: paramId, newValue } });

      // Request the generator worker to re-generate the frame with updated parameters
      console.log('App: handleGeneratorParameterChange - Sending updatedParams to worker:', updatedParams); // Added log
      generatorWorker.postMessage({ type: 'generate-frame', generator: { ...clipData.generatorDefinition, params: updatedParams }, layerIndex: selectedLayerIndex, colIndex: selectedColIndex });
    }
  }, [selectedLayerIndex, selectedColIndex, clipContents, generatorWorker]);

  const handleDropDac = useCallback((layerIndex, colIndex, dac) => {
    console.log('Dropped DAC:', dac, 'on clip:', layerIndex, colIndex);
    dispatch({ type: 'SET_CLIP_DAC', payload: { layerIndex, colIndex, dac } });
    dispatch({ type: 'SET_SELECTED_DAC', payload: dac }); // Also set as global
    showNotification(`DAC ${dac.ip} Channel ${dac.channel} assigned to Clip ${layerIndex + 1}-${colIndex + 1}`);
  }, [showNotification]);

  useEffect(() => {
    console.log('DAC useEffect triggered', { activeClipsData, selectedDac, liveFrames, isWorldOutputActive, drawSpeed, clipContents });
    console.log('App: activeClipsData for DAC useEffect:', activeClipsData); // Integrated log
    console.log('App: liveFrames for DAC useEffect:', liveFrames);       // Integrated log
    let animationFrameId;
    let lastFrameTime = 0;
    const DAC_REFRESH_INTERVAL = 30;

    const animate = (currentTime) => {
      if (!isWorldOutputActive) {
        cancelAnimationFrame(animationFrameId);
        return;
      }

      if (currentTime - lastFrameTime > DAC_REFRESH_INTERVAL) {
        if (window.electronAPI && activeClipsData.length > 0 && isWorldOutputActive) {
          // Send play command once when output becomes active
          if (!playCommandSentRef.current) {
            const targetDacIp = selectedDac ? selectedDac.ip : null; // Assuming a single DAC for play command
            if (targetDacIp) {
              window.electronAPI.sendPlayCommand(targetDacIp);
              playCommandSentRef.current = true;
            }
          }

          activeClipsData.forEach(clip => {
            if (clip && liveFrames[clip.workerId]) {
              const targetDac = clip.dac || selectedDac;
              if (targetDac) {
                const ip = targetDac.ip;
                const channel = targetDac.channel;
                const effects = clip.effects || [];
                const frame = liveFrames[clip.workerId];
                const modifiedFrame = applyEffects(frame, effects);
                const ildaFormat = clip.ildaFormat || 0;
                window.electronAPI.send('send-frame', { ip, channel, frame: modifiedFrame, fps: drawSpeed, ildaFormat });
              }
            }
          });
        }
        lastFrameTime = currentTime;
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    if (isWorldOutputActive) {
      animationFrameId = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(animationFrameId);
      playCommandSentRef.current = false; // Reset when output is inactive
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [activeClipsData, selectedDac, isWorldOutputActive, drawSpeed, clipContents, liveFrames]);

  useEffect(() => {
    if (!ildaParserWorker) return;

    ildaParserWorker.onmessage = (e) => {
      if (e.data.type === 'parse-ilda' && e.data.success) {
        const { workerId, totalFrames, fileName, layerIndex, colIndex, ildaFormat } = e.data;
        // For ILDA files, clipContent remains largely the same
        const newClipContent = { type: 'ilda', workerId, totalFrames, ildaFormat };
        dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: newClipContent } });
        dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: fileName } });
      } else if (e.data.type === 'parse-ilda' && !e.data.success) {
        console.error("Worker parsing error:", e.data.error);
        showNotification(`Error parsing ${e.data.fileName}: ${e.data.error}`);
      }
    };

    return () => {
      ildaParserWorker.onmessage = null;
    };
  }, [ildaParserWorker, showNotification]);

  useEffect(() => {
    if (!generatorWorker) return;

    generatorWorker.onmessage = (e) => {
      if (e.data.success) {
        const { frame, layerIndex, colIndex, generator, params } = e.data;
        console.log('App: Received frame from generator worker:', frame); // Log the received frame
        // For generators, clipContent includes the generator definition and its current parameters
        const newClipContent = {
          type: 'generator',
          generatorDefinition: generator, // Store the full generator definition
          currentParams: params, // Store the current parameters that generated this frame
          frames: [frame], // Generators typically produce a single frame
        };
        dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: newClipContent } });
        dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: generator.name } });
        // If this is the currently selected clip, update the selected generator data
        if (selectedLayerIndex === layerIndex && selectedColIndex === colIndex) {
          dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: null, totalFrames: 0, generatorId: generator.id, generatorParams: params } });
        }
      } else {
        console.error("Generator worker error:", e.data.error);
        showNotification(`Error generating frame: ${e.data.error}`);
      }
    };

    return () => {
      generatorWorker.onmessage = null;
    };
  }, [generatorWorker, showNotification, selectedLayerIndex, selectedColIndex]);

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
    console.log('Selected DAC:', dac);
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
    // Reset all active clip frame indexes to 0
    for (const workerId in frameIndexesRef.current) {
      frameIndexesRef.current[workerId] = 0;
    }
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

  useEffect(() => {
    let animationFrameId;
    let lastFrameTime = 0;
    const DAC_REFRESH_INTERVAL = 30;

    const animate = (currentTime) => {
      if (!isWorldOutputActive) {
        cancelAnimationFrame(animationFrameId);
        return;
      }

      if (currentTime - lastFrameTime > DAC_REFRESH_INTERVAL) {
        if (window.electronAPI && activeClipsData.length > 0 && isWorldOutputActive) {
          // Send play command once when output becomes active
          if (!playCommandSentRef.current) {
            const targetDacIp = selectedDac ? selectedDac.ip : null; // Assuming a single DAC for play command
            if (targetDacIp) {
              window.electronAPI.sendPlayCommand(targetDacIp);
              playCommandSentRef.current = true;
            }
          }

          activeClipsData.forEach(clip => {
            if (clip && liveFrames[clip.workerId]) {
              const targetDac = clip.dac || selectedDac;
              if (targetDac) {
                const ip = targetDac.ip;
                const channel = targetDac.channel;
                const effects = clip.effects || [];
                const frame = liveFrames[clip.workerId];
                const modifiedFrame = applyEffects(frame, effects);
                window.electronAPI.send('send-frame', { ip, channel, frame: modifiedFrame, fps: drawSpeed });
              }
            }
          });
        }
        lastFrameTime = currentTime;
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    if (isWorldOutputActive) {
      animationFrameId = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(animationFrameId);
      playCommandSentRef.current = false; // Reset when output is inactive
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [activeClipsData, selectedDac, isWorldOutputActive, drawSpeed, clipContents, liveFrames]);

  const selectedClipEffects =
    selectedLayerIndex !== null && selectedColIndex !== null
      ? clipContents[selectedLayerIndex][selectedColIndex]?.effects || []
      : [];

  const handleEffectParameterChange = useCallback((layerIndex, colIndex, effectIndex, paramName, newValue) => {
    dispatch({ type: 'UPDATE_EFFECT_PARAMETER', payload: { layerIndex, colIndex, effectIndex, paramName, newValue } });
  }, []);
  
  const selectedClipFrame = liveFrames[selectedIldaWorkerId] || null;

  const worldFrames = useMemo(() => {
    const frames = {};
    activeClipsData.forEach(clip => {
      if (clip && clip.workerId && liveFrames[clip.workerId]) {
        frames[clip.workerId] = {
          frame: liveFrames[clip.workerId],
          effects: clip.effects || []
        };
      }
    });
    return frames;
  }, [activeClipsData, liveFrames]);

  return (
    <div className="app">
      <ErrorBoundary>
        <NotificationPopup message={notification.message} visible={notification.visible} />
        <div className="main-content">
          <div className="top-bar-left-area">
            <CompositionControls />
            <MasterIntensitySlider />
            <LaserOnOffButton
              isWorldOutputActive={isWorldOutputActive}
              onToggleWorldOutput={() => dispatch({ type: 'SET_WORLD_OUTPUT_ACTIVE', payload: !isWorldOutputActive })}
            />
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
                        onDropDac={handleDropDac}
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
              frame={selectedClipFrame}
              showBeamEffect={showBeamEffect}
              beamAlpha={beamAlpha}
              fadeAlpha={fadeAlpha}
              previewScanRate={previewScanRate}
              beamRenderMode={beamRenderMode}
            />
            <WorldPreview
              activeFrames={worldFrames}
              showBeamEffect={showBeamEffect}
              beamAlpha={beamAlpha}
              fadeAlpha={fadeAlpha}
              previewScanRate={previewScanRate}
              beamRenderMode={beamRenderMode}
            />
            
          </div>
          <div className="middle-bar">
            <div className="middle-bar-left-area">
              <BPMControls onPlay={handlePlay} onPause={handlePause} onStop={handleStop} />
            </div>
            <div className="middle-bar-mid-area">
				<MasterSpeedSlider drawSpeed={drawSpeed} onSpeedChange={(value) => dispatch({ type: 'SET_RENDER_SETTING', payload: { setting: 'drawSpeed', value } })} />
            </div>
			<div className="middle-bar-right-area">
				<p> Right Section of Middle-Bar</p>
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
              selectedGeneratorId={selectedGeneratorId}
              selectedGeneratorParams={selectedGeneratorParams}
              onGeneratorParameterChange={handleGeneratorParameterChange}
            />
          </div>
        </div>
      </ErrorBoundary>
    </div>
  );
}
      
export default App;
