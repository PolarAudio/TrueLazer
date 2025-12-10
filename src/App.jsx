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
import { useGeneratorWorker } from './contexts/GeneratorWorkerContext';
import { applyEffects } from './utils/effects';
import { generateCircle, generateSquare, generateLine, generateStar, generateText } from './utils/generators'; // Import generator functions

const MasterSpeedSlider = ({ drawSpeed, onSpeedChange }) => (
  <div className="master-speed-slider">
    <label htmlFor="masterSpeedRange">Playback Speed</label>
    <input type="range" min="30" max="250" value={drawSpeed} className="slider_hor" id="masterSpeedRange" onChange={(e) => onSpeedChange(parseInt(e.target.value))} />
  </div>
);

const LaserOnOffButton = ({ isWorldOutputActive, onToggleWorldOutput }) => (
  <div className="container">
    <input type="checkbox" checked={isWorldOutputActive} onChange={onToggleWorldOutput} />
  </div>
);

const getInitialState = (initialSettings) => ({
  columns: Array.from({ length: 8 }, (_, i) => `Col ${i + 1}`),
  layers: Array.from({ length: 5 }, (_, i) => `Layer ${i + 1}`),
  clipContents: Array(5).fill(null).map(() => Array(8).fill(null).map(() => ({ parsing: false }))),
  clipNames: Array(5).fill(null).map((_, layerIndex) =>
    Array(8).fill(null).map((_, colIndex) => `Clip ${layerIndex + 1}-${colIndex + 1}`)
  ),
  thumbnailFrameIndexes: Array(5).fill(null).map(() => Array(8).fill(0)),
  layerEffects: Array(5).fill([]),
  layerIntensities: Array(5).fill(1), // Add this
  masterIntensity: 1, // Add this
  selectedLayerIndex: null,
  selectedColIndex: null,
  notification: { message: '', visible: false },
  dacs: [],
  selectedDac: initialSettings?.dacAssignment?.selectedDac ?? null,
  ildaFrames: [],
  selectedIldaWorkerId: null,
  selectedIldaTotalFrames: 0,
  showBeamEffect: initialSettings?.renderSettings?.showBeamEffect ?? true,
  beamAlpha: initialSettings?.renderSettings?.beamAlpha ?? 0.1,
  fadeAlpha: initialSettings?.renderSettings?.fadeAlpha ?? 0.13,
  drawSpeed: initialSettings?.renderSettings?.drawSpeed ?? 33,
  previewScanRate: initialSettings?.renderSettings?.previewScanRate ?? 1,
  beamRenderMode: initialSettings?.renderSettings?.beamRenderMode ?? 'points',
  activeClipIndexes: Array(5).fill(null),
  isPlaying: false,
  isWorldOutputActive: false, // Controls whether frames are sent to DACs
  thumbnailRenderMode: initialSettings?.thumbnailRenderMode ?? 'still', // 'still' for static thumbnail, 'active' for live rendering
  theme: initialSettings?.theme ?? 'orange', // Add theme to state
  projectLoadTimestamp: null, // Add this to track project loads
  clipClipboard: null, // For copy/paste
});

function reducer(state, action) {
  switch (action.type) {
    case 'SET_COLUMNS':
      return { ...state, columns: action.payload };
    case 'SET_LAYERS':
      return { ...state, layers: action.payload };
    case 'SET_CLIP_CONTENT': {
      const newClipContents = [...state.clipContents];
      // Ensure the layer array exists
      if (!newClipContents[action.payload.layerIndex]) {
          console.error(`Reducer Error: Layer array at index ${action.payload.layerIndex} is undefined. Action:`, action);
          return state; // Return current state to prevent crash
      }
      // Create a new array for the specific layer to ensure immutability
      newClipContents[action.payload.layerIndex] = [...newClipContents[action.payload.layerIndex]];
      
      const existingClipContent = newClipContents[action.payload.layerIndex][action.payload.colIndex] || {};
      newClipContents[action.payload.layerIndex][action.payload.colIndex] = {
          ...existingClipContent, // Preserve existing properties like 'type', 'workerId', 'totalFrames', 'ildaFormat', 'fileName', 'filePath', 'effects'
          ...action.payload.content, // Apply new content (which can include stillFrame and parsing status)
      };
      return { ...state, clipContents: newClipContents };
    }
    case 'SET_CLIP_NAME': {
        const newClipNames = [...state.clipNames];
        newClipNames[action.payload.layerIndex][action.payload.colIndex] = action.payload.name;
        return { ...state, clipNames: newClipNames };
    }
    case 'SET_THUMBNAIL_FRAME_INDEX': {
        const newThumbnailFrameIndexes = [...state.thumbnailFrameIndexes];
        newThumbnailFrameIndexes[action.payload.layerIndex][action.payload.colIndex] = action.payload.index;
        return { ...state, thumbnailFrameIndexes: newThumbnailFrameIndexes };
    }
    case 'ADD_LAYER_EFFECT': {
        const newLayerEffects = [...state.layerEffects];
        newLayerEffects[action.payload.layerIndex].push(action.payload.effect);
        return { ...state, layerEffects: newLayerEffects };
    }
    case 'ADD_CLIP_EFFECT': {
        const newClipContentsWithEffect = [...state.clipContents];
        // Ensure the layer array exists and create a new copy of it
        if (!newClipContentsWithEffect[action.payload.layerIndex]) {
            console.error(`Reducer Error: Layer array at index ${action.payload.layerIndex} is undefined. Action:`, action);
            return state;
        }
        newClipContentsWithEffect[action.payload.layerIndex] = [...newClipContentsWithEffect[action.payload.layerIndex]];

        // Get the existing clip, create a new copy of it, and then modify its effects
        const existingClip = newClipContentsWithEffect[action.payload.layerIndex][action.payload.colIndex] || {};
        
        // Create a new effect "instance" with its own params object
        const newEffectInstance = {
          ...action.payload.effect,
          params: { ...action.payload.effect.defaultParams }
        };

        const updatedClip = {
            ...existingClip,
            effects: [...(existingClip.effects || []), newEffectInstance],
        };
        newClipContentsWithEffect[action.payload.layerIndex][action.payload.colIndex] = updatedClip;
        return { ...state, clipContents: newClipContentsWithEffect };
    }
    case 'SET_SELECTED_CLIP':
        return { ...state, selectedLayerIndex: action.payload.layerIndex, selectedColIndex: action.payload.colIndex };
    case 'SET_NOTIFICATION':
        return { ...state, notification: action.payload };
    case 'SET_ILDA_FRAMES': // This might become deprecated or refactored later
        return { ...state, ildaFrames: action.payload };
    case 'SET_SELECTED_ILDA_DATA': // For ILDA files, or when a generator's frame is selected
        return { ...state, selectedIldaWorkerId: action.payload.workerId, selectedIldaTotalFrames: action.payload.totalFrames, selectedGeneratorId: action.payload.generatorId, selectedGeneratorParams: action.payload.generatorParams };
    case 'SET_ACTIVE_CLIP': {
        const newActiveClipIndexes = [...state.activeClipIndexes];
        newActiveClipIndexes[action.payload.layerIndex] = action.payload.colIndex;
        return { ...state, activeClipIndexes: newActiveClipIndexes };
    }
    case 'CLEAR_CLIP': {
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
    }
    case 'DEACTIVATE_LAYER_CLIPS': {
        const deactivatedActiveClipIndexes = [...state.activeClipIndexes];
        deactivatedActiveClipIndexes[action.payload.layerIndex] = null;
        return { ...state, activeClipIndexes: deactivatedActiveClipIndexes };
    }
    case 'SET_LAYER_INTENSITY': {
        const newLayerIntensities = [...state.layerIntensities];
        newLayerIntensities[action.payload.layerIndex] = action.payload.intensity;
        return { ...state, layerIntensities: newLayerIntensities };
    }
    case 'SET_MASTER_INTENSITY': {
        return { ...state, masterIntensity: action.payload };
    }
    case 'SET_RENDER_SETTING':
        return { ...state, [action.payload.setting]: action.payload.value };
    case 'UPDATE_EFFECT_PARAMETER': {
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
    }
    case 'UPDATE_GENERATOR_PARAM': {
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
    }
    case 'SET_DACS':
      return { ...state, dacs: action.payload };
    case 'SET_SELECTED_DAC':
      return { ...state, selectedDac: action.payload };
    case 'SET_IS_PLAYING':
      return { ...state, isPlaying: action.payload };
    case 'SET_WORLD_OUTPUT_ACTIVE':
      return { ...state, isWorldOutputActive: action.payload };
    case 'SET_CLIPBOARD':
      return { ...state, clipClipboard: action.payload };
    case 'SET_CLIP_DAC': {
      const newClipContentsWithDac = [...state.clipContents];
      // Ensure the layer array exists and create a new copy of it
      if (!newClipContentsWithDac[action.payload.layerIndex]) {
          console.error(`Reducer Error: Layer array at index ${action.payload.layerIndex} is undefined. Action:`, action);
          return state;
      }
      newClipContentsWithDac[action.payload.layerIndex] = [...newClipContentsWithDac[action.payload.layerIndex]];

      // Get the existing clip, create a new copy of it, and then modify its dac
      const existingClip = newClipContentsWithDac[action.payload.layerIndex][action.payload.colIndex] || {};
      const updatedClip = {
          ...existingClip,
          dac: action.payload.dac,
      };
      newClipContentsWithDac[action.payload.layerIndex][action.payload.colIndex] = updatedClip;
      return { ...state, clipContents: newClipContentsWithDac };
    }


    case 'SET_THUMBNAIL_RENDER_MODE':
      return { ...state, thumbnailRenderMode: action.payload };
    case 'SET_THEME':
        return { ...state, theme: action.payload };
    case 'UPDATE_THUMBNAIL': {
    const { layerIndex, colIndex, frameIndex } = action.payload;
    const newThumbnailFrameIndexes = [...state.thumbnailFrameIndexes];
    newThumbnailFrameIndexes[layerIndex][colIndex] = frameIndex;
    return { ...state, thumbnailFrameIndexes: newThumbnailFrameIndexes };
    }
    case 'RESET_STATE':
        return getInitialState({});
    case 'LOAD_PROJECT':
        const loadedState = { ...state, ...action.payload };
        // Invalidate workerIds for ILDA clips to trigger re-parsing
        loadedState.clipContents = loadedState.clipContents.map(layer =>
            layer.map(clip => {
                if (clip && clip.type === 'ilda') {
                    return { ...clip, workerId: null };
                }
                return clip;
            })
        );
        // Reset active and selected clip states
        loadedState.activeClipIndexes = Array(state.layers.length).fill(null);
        loadedState.selectedLayerIndex = null;
        loadedState.selectedColIndex = null;
        loadedState.selectedIldaWorkerId = null;
        loadedState.selectedIldaTotalFrames = 0;
        loadedState.selectedGeneratorId = null;
        loadedState.selectedGeneratorParams = {};
        loadedState.projectLoadTimestamp = Date.now(); // Add timestamp
        return loadedState;
    case 'LOAD_SETTINGS':
        return {
            ...state,
            showBeamEffect: action.payload.renderSettings?.showBeamEffect ?? state.showBeamEffect,
            beamAlpha: action.payload.renderSettings?.beamAlpha ?? state.beamAlpha,
            fadeAlpha: action.payload.renderSettings?.fadeAlpha ?? state.fadeAlpha,
            drawSpeed: action.payload.renderSettings?.drawSpeed ?? state.drawSpeed,
            previewScanRate: action.payload.renderSettings?.previewScanRate ?? state.previewScanRate,
            beamRenderMode: action.payload.renderSettings?.beamRenderMode ?? state.beamRenderMode,
            theme: action.payload.theme ?? state.theme,
            thumbnailRenderMode: action.payload.thumbnailRenderMode ?? state.thumbnailRenderMode,
            selectedDac: action.payload.selectedDac ?? state.selectedDac,
            // sliderValue, dacAssignment (other than selectedDac), lastOpenedProject will be handled as full objects
            // These will likely require more complex merging or direct assignment based on their structure
        };
    default:
      return state;
  }
}

function App() {
  const ildaParserWorker = useIldaParserWorker();
  const generatorWorker = useGeneratorWorker();
  const ildaPlayerCurrentFrameIndex = useRef(0);
  const playCommandSentRef = useRef(false);
  const [liveFrames, setLiveFrames] = useState({});
  const liveFramesRef = useRef();
  liveFramesRef.current = liveFrames;
  const lastFrameFetchTimeRef = useRef({});
  const frameIndexesRef = useRef({});

  const [initialSettings, setInitialSettings] = useState(null);
  const [initialSettingsLoaded, setInitialSettingsLoaded] = useState(false);

  const [state, dispatch] = useReducer(reducer, getInitialState(initialSettingsLoaded ? initialSettings : {}));
  const {
    columns,
    layers,
    clipContents,
    clipNames,
    thumbnailFrameIndexes,
    layerEffects,
    layerIntensities,
    masterIntensity,
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
    beamRenderMode,
    activeClipIndexes,
    isPlaying,
    isWorldOutputActive,
    selectedGeneratorId,
    selectedGeneratorParams,
    thumbnailRenderMode, // Add this
    theme,
  } = state;

  const showNotification = (message) => {
    dispatch({ type: 'SET_NOTIFICATION', payload: { message, visible: true } });
    setTimeout(() => {
      dispatch({ type: 'SET_NOTIFICATION', payload: { message: '', visible: false } });
    }, 3000);
  };

    const activeClipsData = useMemo(() => layers.map((_, layerIndex) => {
      const activeColIndex = activeClipIndexes[layerIndex];
      if (activeColIndex !== null) {
          const clip = clipContents[layerIndex][activeColIndex];
          if (clip) {
              let workerId;
              let stillFrame = null; 

              if (clip.type === 'ilda' && clip.workerId && clip.totalFrames) {
                  workerId = clip.workerId;
                  stillFrame = clip.stillFrame; 

                  return {
                      type: 'ilda',
                      workerId,
                      totalFrames: clip.totalFrames,
                      effects: clip.effects || [],
                      dac: clip.dac || null,
                      ildaFormat: clip.ildaFormat || 0,
                      stillFrame,
                      layerIndex,
                  };
              } else if (clip.type === 'generator' && clip.frames && clip.generatorDefinition) {
                  workerId = `generator-${layerIndex}-${activeColIndex}`;
                  stillFrame = clip.frames[0];
                  return {
                      type: 'generator',
                      workerId,
                      totalFrames: clip.frames.length,
                      effects: clip.effects || [],
                      dac: clip.dac || null,
                      ildaFormat: 0,
                      stillFrame, 
                      layerIndex,
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
        if (e.data.isStillFrame) {
          const { workerId, frame, layerIndex, colIndex } = e.data;
          // Update stillFrame and set parsing status to false in a single SET_CLIP_CONTENT dispatch
          dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { stillFrame: frame, parsing: false } } });
        } else {
          setLiveFrames(prev => ({ ...prev, [e.data.workerId]: e.data.frame })); // Update liveFrames
        }
      } else if (e.data.type === 'parse-ilda' && e.data.success) {
        const { workerId, totalFrames, ildaFormat, fileName, filePath, layerIndex, colIndex } = e.data;
        
        // Get existing clip to preserve effects
        const existingClip = state.clipContents[layerIndex][colIndex] || {};

        const newClipContent = {
          ...existingClip,
          type: 'ilda',
          workerId,
          totalFrames,
          ildaFormat,
          fileName,
          filePath,
          stillFrame: null, // Initialize stillFrame to null
          parsing: true, // Set parsing status to true
        };
        dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: newClipContent } });
        dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: fileName } }); // Update clip name
        // Request the still frame
        ildaParserWorker.postMessage({ type: 'get-frame', workerId, frameIndex: 0, isStillFrame: true, layerIndex, colIndex });
      } else if (e.data.success === false) {
        showNotification(`Worker error: ${e.data.error}`);
        const { layerIndex, colIndex } = e.data; // Get layerIndex and colIndex from error message
        if (layerIndex !== undefined && colIndex !== undefined) {
          dispatch({ type: 'SET_CLIP_PARSING_STATUS', payload: { layerIndex, colIndex, status: false } }); // Parsing finished with error
        }
      }
    };
    ildaParserWorker.addEventListener('message', handleMessage);
    
    let animationFrameId;
    let dacRefreshAnimationFrameId;
    let lastFrameTime = 0;
    const DAC_REFRESH_INTERVAL = 30; // approx 30-33ms for 30fps

    // Animate function for DAC output
    const animate = (currentTime) => {
      if (!isWorldOutputActive) {
        cancelAnimationFrame(dacRefreshAnimationFrameId);
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
            if (clip && liveFramesRef.current[clip.workerId]) {
              const targetDac = clip.dac || selectedDac; // Use clip-specific DAC if available, otherwise global selectedDac
              if (targetDac) {
                const ip = targetDac.ip;
                const channel = targetDac.channel;
                const effects = clip.effects || [];
                const frame = liveFramesRef.current[clip.workerId];

                // Apply layer and master intensity
                const layerIntensity = state.layerIntensities[clip.layerIndex];
                const finalIntensity = layerIntensity * state.masterIntensity;

                const intensityAdjustedFrame = {
                  ...frame,
                  points: frame.points.map(p => ({
                    ...p,
                    r: Math.round(p.r * finalIntensity),
                    g: Math.round(p.g * finalIntensity),
                    b: Math.round(p.b * finalIntensity),
                  })),
                };

                const modifiedFrame = applyEffects(intensityAdjustedFrame, effects);
                const ildaFormat = clip.ildaFormat || 0;
                window.electronAPI.send('send-frame', { ip, channel, frame: modifiedFrame, fps: drawSpeed, ildaFormat });
              }
            }
          });
        }
        lastFrameTime = currentTime;
      }
      dacRefreshAnimationFrameId = requestAnimationFrame(animate);
    };

    // Frame fetcher loop for updating liveFrames
    const frameFetcherLoop = (timestamp) => {
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


      animationFrameId = requestAnimationFrame(frameFetcherLoop);
    };

    animationFrameId = requestAnimationFrame(frameFetcherLoop);
    
    // Start DAC animation if world output is active
    if (isWorldOutputActive) {
      dacRefreshAnimationFrameId = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(dacRefreshAnimationFrameId);
      playCommandSentRef.current = false; // Reset when output is inactive
    }


    return () => {
      ildaParserWorker.removeEventListener('message', handleMessage);
      cancelAnimationFrame(animationFrameId);
      cancelAnimationFrame(dacRefreshAnimationFrameId); // Clean up DAC animation frame
    };
  }, [ildaParserWorker, workerIdsToFetch, drawSpeed, clipContents, isPlaying, activeClipsData, isWorldOutputActive, selectedDac, playCommandSentRef, state.clipContents]);

    // Listen for context menu commands for clips
    useEffect(() => {
        if (window.electronAPI && window.electronAPI.onClipContextMenuCommand) {
            const unsubscribe = window.electronAPI.onClipContextMenuCommand((command, layerIndex, colIndex) => {
                console.log(`Clip context menu command received: ${command} for ${layerIndex}-${colIndex}`);
                if (command === 'update-thumbnail') {
                    const clipToUpdate = clipContents[layerIndex][colIndex];
                    if (clipToUpdate) {
                        if (clipToUpdate.type === 'ilda' && clipToUpdate.workerId && ildaParserWorker) {
                            const currentFrame = frameIndexesRef.current[clipToUpdate.workerId] || 0;
                            console.log(`[App.jsx] Requesting new ILDA thumbnail for ${layerIndex}-${colIndex} at frame ${currentFrame}`);
                            ildaParserWorker.postMessage({
                                type: 'get-frame',
                                workerId: clipToUpdate.workerId,
                                frameIndex: currentFrame,
                                isStillFrame: true,
                                layerIndex,
                                colIndex,
                            });
                        } else if (clipToUpdate.type === 'generator' && clipToUpdate.generatorDefinition && generatorWorker) {
                            console.log(`[App.jsx] Re-running generator for thumbnail update: ${layerIndex}-${colIndex}`);
                            regenerateGeneratorClip(layerIndex, colIndex, clipToUpdate.generatorDefinition, clipToUpdate.currentParams);
                        }
                    }
                } else if (command === 'clear-clip') {
                    dispatch({ type: 'CLEAR_CLIP', payload: { layerIndex, colIndex } });
                } else if (command === 'rename-clip') {
                    const oldName = clipNames[layerIndex][colIndex];
                    const newName = prompt("Enter new clip name:", oldName);
                    if (newName) {
                        dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: newName } });
                    }
                } else if (command === 'copy-clip') {
                    const clipToCopy = {
                        content: clipContents[layerIndex][colIndex],
                        name: clipNames[layerIndex][colIndex],
                    };
                    dispatch({ type: 'SET_CLIPBOARD', payload: clipToCopy });
                    showNotification('Clip copied.');
                } else if (command === 'cut-clip') {
                    const clipToCut = {
                        content: clipContents[layerIndex][colIndex],
                        name: clipNames[layerIndex][colIndex],
                    };
                    dispatch({ type: 'SET_CLIPBOARD', payload: clipToCut });
                    dispatch({ type: 'CLEAR_CLIP', payload: { layerIndex, colIndex } });
                    showNotification('Clip cut.');
                } else if (command === 'paste-clip') {
                    if (state.clipClipboard) {
                        const { content, name } = state.clipClipboard;
                        // To properly "load" the pasted clip, we need to treat it like a new clip.
                        // For ILDA, invalidate the workerId. For generators, just set the content.
                        let contentToPaste = { ...content };
                        if (contentToPaste.type === 'ilda') {
                            contentToPaste.workerId = null; // This will trigger re-parsing via the project-load useEffect
                        }

                        dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: contentToPaste }});
                        dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name }});
                        showNotification('Clip pasted.');
                        
                        // Manually trigger regeneration after paste
                        // Need a slight delay for state to update before we read it in the regeneration functions
                        setTimeout(() => {
                            const newClip = contentToPaste;
                            if (newClip.type === 'generator' && newClip.generatorDefinition) {
                                regenerateGeneratorClip(layerIndex, colIndex, newClip.generatorDefinition, newClip.currentParams);
                            }
                            // The ILDA re-parsing is handled by a useEffect that watches for clips with no workerId
                        }, 100);

                    } else {
                        showNotification('Clipboard is empty.');
                    }
                } else if (command === 'set-clip-thumbnail-mode-still') {
                    // This command could be handled here if specific clip modes were supported
                } else if (command === 'set-clip-thumbnail-mode-active') {
                    // This command could be handled here if specific clip modes were supported
                }
            });
            return () => unsubscribe();
        }
    }, [clipContents, ildaParserWorker, state.clipClipboard]);

  const prevThumbnailFrameIndexesRef = useRef(thumbnailFrameIndexes);
  useEffect(() => {
    // Find which thumbnails have changed and fetch new still frames
    for (let i = 0; i < layers.length; i++) {
      for (let j = 0; j < columns.length; j++) {
        const currentIndex = thumbnailFrameIndexes[i][j];
        const prevIndex = prevThumbnailFrameIndexesRef.current[i][j];

        if (currentIndex !== prevIndex) {
          const clip = clipContents[i][j];
          if (clip && clip.type === 'ilda' && clip.workerId) {
            console.log(`[App.jsx] Fetching new still frame for ${i}-${j} at index ${currentIndex}`);
            ildaParserWorker.postMessage({
              type: 'get-frame',
              workerId: clip.workerId,
              frameIndex: currentIndex,
              isStillFrame: true,
              layerIndex: i,
              colIndex: j,
            });
          }
        }
      }
    }
    // Update the ref for the next render
    prevThumbnailFrameIndexesRef.current = thumbnailFrameIndexes;
  }, [thumbnailFrameIndexes, clipContents, layers.length, columns.length, ildaParserWorker]);

  // Re-parse ILDA files and re-generate generator frames on project load
  useEffect(() => {
    if (!state.projectLoadTimestamp || !ildaParserWorker || !generatorWorker) return;

    console.log("Project loaded, regenerating content...");

    clipContents.forEach((layer, layerIndex) => {
      layer.forEach((clip, colIndex) => {
        if (clip) {
          if (clip.type === 'ilda' && clip.filePath && !clip.workerId) {
            console.log(`Reparsing ILDA file for clip ${layerIndex}-${colIndex}: ${clip.filePath}`);
            ildaParserWorker.postMessage({
              type: 'load-and-parse-ilda',
              fileName: clip.fileName,
              filePath: clip.filePath,
              layerIndex,
              colIndex,
            });
          } else if (clip.type === 'generator' && clip.generatorDefinition) {
            console.log(`Regenerating generator clip ${layerIndex}-${colIndex} on project load`);
            regenerateGeneratorClip(layerIndex, colIndex, clip.generatorDefinition, clip.currentParams);
          }
        }
      });
    });
  }, [state.projectLoadTimestamp, ildaParserWorker, generatorWorker]);

  // Listen for project management commands
  useEffect(() => {
    let unlistenNew, unlistenOpen, unlistenSave, unlistenSaveAs, unlistenLoad;

    if (window.electronAPI) {
      unlistenNew = window.electronAPI.on('new-project', () => dispatch({ type: 'RESET_STATE' }));
      unlistenOpen = window.electronAPI.on('open-project', () => { /* This is handled in main.js */ });
      unlistenSave = window.electronAPI.on('save-project', () => window.electronAPI.send('save-project', state));
      unlistenSaveAs = window.electronAPI.on('save-project-as', () => window.electronAPI.send('save-project-as', state));
      unlistenLoad = window.electronAPI.on('load-project-data', (data) => {
        dispatch({ type: 'LOAD_PROJECT', payload: data });
      });
    }

    // Cleanup
    return () => {
      if (unlistenNew) unlistenNew();
      if (unlistenOpen) unlistenOpen();
      if (unlistenSave) unlistenSave();
      if (unlistenSaveAs) unlistenSaveAs();
      if (unlistenLoad) unlistenLoad();
    };
  }, [state]);

  // Listen for menu actions for theme and render settings
  useEffect(() => {
    let unlistenMenu, unlistenRenderSettings;

    if (window.electronAPI) {
      // Listener for general menu actions like theme changes
      unlistenMenu = window.electronAPI.onMenuAction((action) => {
        console.log("Menu action received:", action);
        if (action.startsWith('set-theme-')) {
          const themeColor = action.split('set-theme-')[1];
          dispatch({ type: 'SET_THEME', payload: themeColor });
        }
      });

      // Listener for specific render settings commands
      unlistenRenderSettings = window.electronAPI.onRenderSettingsCommand((command) => {
        console.log("Render settings command received:", command);
        dispatch({ type: 'SET_RENDER_SETTING', payload: { setting: command.setting, value: command.value } });
      });
    }

    // Cleanup
    return () => {
      if (unlistenMenu) unlistenMenu();
      if (unlistenRenderSettings) unlistenRenderSettings();
    };
  }, []); // Empty dependency array so it only runs once on mount

  // Handles requests from ildaParserWorker to read files from the main process
  useEffect(() => {
    if (!ildaParserWorker) return;

    const handleWorkerRequest = async (e) => {
      if (e.data.type === 'request-file-content') {
        const { filePath, requestId } = e.data;
        try {
          const arrayBuffer = await window.electronAPI.readFileForWorker(filePath);
          ildaParserWorker.postMessage({
            type: 'file-content-response',
            requestId,
            arrayBuffer,
          }, [arrayBuffer]); // Transferrable
        } catch (error) {
          console.error(`Renderer: Failed to read file for worker: ${filePath}`, error);
          ildaParserWorker.postMessage({
            type: 'file-content-response',
            requestId,
            error: error.message,
          });
        }
      } else if (e.data.type === 'parsing-status') {
        const { layerIndex, colIndex, status } = e.data;
        dispatch({ type: 'SET_CLIP_PARSING_STATUS', payload: { layerIndex, colIndex, status } });
      }
    };

    ildaParserWorker.addEventListener('message', handleWorkerRequest);
    return () => {
      ildaParserWorker.removeEventListener('message', handleWorkerRequest);
    };
  }, [ildaParserWorker]);

  const selectedClipEffects = useMemo(() => {
    return selectedLayerIndex !== null && selectedColIndex !== null
      ? clipContents[selectedLayerIndex][selectedColIndex]?.effects || []
      : [];
  }, [selectedLayerIndex, selectedColIndex, clipContents]);

  const handleEffectParameterChange = useCallback((layerIndex, colIndex, effectIndex, paramName, newValue) => {
    console.log('[App.jsx] handleEffectParameterChange:', { layerIndex, colIndex, effectIndex, paramName, newValue });
    dispatch({ type: 'UPDATE_EFFECT_PARAMETER', payload: { layerIndex, colIndex, effectIndex, paramName, newValue } });
  }, []);


  // Re-run generator when parameters of the selected clip change - REMOVED TO PREVENT LOOP

  useEffect(() => {
    if (!generatorWorker) return;

    const handleMessage = (e) => {
        if (e.data.success) {
            const { layerIndex, colIndex, frames, generatorDefinition, currentParams } = e.data;
            
            // Get the existing clip to preserve its effects and other properties
            const existingClip = state.clipContents[layerIndex][colIndex] || {};

            const newClipContent = {
                ...existingClip, // Preserve existing properties like effects
                type: 'generator',
                generatorDefinition,
                frames,
                currentParams,
            };
            dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: newClipContent } });

            // **NEW**: Also update liveFrames for this generated clip's workerId
            const generatorWorkerId = `generator-${layerIndex}-${colIndex}`;
            setLiveFrames(prev => ({ ...prev, [generatorWorkerId]: frames[0] })); // Assuming frames[0] is the primary frame
        } else {
            showNotification(`Error generating frames: ${e.data.error}`);
        }
    };

    generatorWorker.addEventListener('message', handleMessage);

    return () => {
        generatorWorker.removeEventListener('message', handleMessage);
    };
  }, [generatorWorker, state.clipContents]); // Add state.clipContents to dependency array to get the latest version

  const handleDropGenerator = (layerIndex, colIndex, generatorDefinition) => {
    console.log('[App.jsx] handleDropGenerator - Received generatorDefinition:', generatorDefinition); // DEBUG LOG
    if (generatorWorker) {
        console.log('[App.jsx] handleDropGenerator - Using new regenerateGeneratorClip function'); // DEBUG LOG
        regenerateGeneratorClip(layerIndex, colIndex, generatorDefinition, generatorDefinition.defaultParams);
    }
  };

  const regenerateGeneratorClip = async (layerIndex, colIndex, generatorDefinition, params) => {
    // Create a complete params object to ensure stability
    const completeParams = { ...generatorDefinition.defaultParams, ...params };

    let fontBuffer = null;
    if (generatorDefinition.id === 'text') {
      const defaultFontUrl = 'C:\\Windows\\Fonts\\arial.ttf';
      let fontUrl = completeParams.fontUrl;

      // Migration for old projects with dead URLs
      const deadUrls = [
        'https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto-Regular.ttf',
        'https://raw.githubusercontent.com/googlefonts/roboto-2/main/src/hinted/Roboto-Regular.ttf'
      ];
      if (deadUrls.includes(fontUrl)) {
        fontUrl = defaultFontUrl;
      }

      try {
        if (fontUrl.startsWith('http')) {
          if (window.electronAPI && window.electronAPI.fetchUrlAsArrayBuffer) {
            fontBuffer = await window.electronAPI.fetchUrlAsArrayBuffer(fontUrl);
          } else {
            throw new Error('URL fetching API is not available.');
          }
        } else {
          if (window.electronAPI && window.electronAPI.readFileForWorker) {
            fontBuffer = await window.electronAPI.readFileForWorker(fontUrl);
          } else {
            throw new Error('File reading API is not available.');
          }
        }
      } catch (error) {
        console.error(`Failed to load font for text generator at ${layerIndex}-${colIndex}:`, error);
        showNotification(`Font error: ${error.message}`);
        return; 
      }
    }

    const message = {
      type: 'generate',
      layerIndex,
      colIndex,
      generator: generatorDefinition,
      params: completeParams, // Pass the complete params
      fontBuffer,
    };

    if (fontBuffer) {
      generatorWorker.postMessage(message, [fontBuffer]);
    } else {
      generatorWorker.postMessage(message);
    }
  };

  const handleActivateClick = (layerIndex, colIndex) => {
    const clip = clipContents[layerIndex][colIndex];
    if (clip && clip.type === 'generator' && clip.frames) {
      const generatorWorkerId = `generator-${layerIndex}-${colIndex}`;
      // Ensure the frame is in liveFrames so WorldPreview can render it.
      setLiveFrames(prev => ({ ...prev, [generatorWorkerId]: clip.frames[0] }));
    }
    dispatch({ type: 'SET_ACTIVE_CLIP', payload: { layerIndex, colIndex } });
  };

  const handleDropEffectOnClip = (layerIndex, colIndex, effectData) => {
      dispatch({ type: 'ADD_CLIP_EFFECT', payload: { layerIndex, colIndex, effect: effectData } });
  };

  const handleDropDac = (layerIndex, colIndex, dacData) => {
      dispatch({ type: 'SET_CLIP_DAC', payload: { layerIndex, colIndex, dac: dacData } });
  };

  const handleClipPreview = (layerIndex, colIndex) => {
      dispatch({ type: 'SET_SELECTED_CLIP', payload: { layerIndex, colIndex } });
      const clip = clipContents[layerIndex][colIndex];
      if (clip && clip.type === 'ilda') {
          dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: clip.workerId, totalFrames: clip.totalFrames, generatorId: null, generatorParams: {} } });
      } else if (clip && clip.type === 'generator') {
          const generatorWorkerId = `generator-${layerIndex}-${colIndex}`; // Generate a workerId
          dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: generatorWorkerId, generatorId: clip.generatorDefinition.id, generatorParams: clip.currentParams, totalFrames: clip.frames.length } });
          console.log(`[App.jsx] handleClipPreview - Dispatched SET_SELECTED_ILDA_DATA for generator. workerId: ${generatorWorkerId}`); // DEBUG LOG
      } else {
        // Clip is empty, clear the selection data
        dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: null, totalFrames: 0, generatorId: null, generatorParams: {} } });
      }
  };

  const handleDeactivateLayerClips = (layerIndex) => {
    dispatch({ type: 'DEACTIVATE_LAYER_CLIPS', payload: { layerIndex } });
  };

  const handleShowLayerFullContextMenu = (layerIndex) => {
    if (window.electronAPI && window.electronAPI.showLayerContextMenu) {
        window.electronAPI.showLayerContextMenu(layerIndex);
    }
  };

  const handleShowColumnHeaderContextMenu = (colIndex) => {
    if (window.electronAPI && window.electronAPI.showColumnContextMenu) {
        window.electronAPI.showColumnContextMenu(colIndex);
    }
  };

  const handlePlay = () => {
    dispatch({ type: 'SET_IS_PLAYING', payload: true });
  };

  const handlePause = () => {
    dispatch({ type: 'SET_IS_PLAYING', payload: false });
  };

  const handleStop = () => {
    dispatch({ type: 'SET_IS_PLAYING', payload: false });
    frameIndexesRef.current = {};
  };

  const handleDacSelected = (dac) => {
    dispatch({ type: 'SET_SELECTED_DAC', payload: dac });
  };

  const handleGeneratorParameterChange = (paramName, newValue) => {
    if (selectedLayerIndex !== null && selectedColIndex !== null) {
      // Get the current clip and its definition
      const clip = clipContents[selectedLayerIndex][selectedColIndex];
      if (!clip || !clip.generatorDefinition) return;

      // Create the next version of the parameters object
      const nextParams = { ...clip.currentParams, [paramName]: newValue };

      // Dispatch the state update
      dispatch({
          type: 'UPDATE_GENERATOR_PARAM',
          payload: {
              layerIndex: selectedLayerIndex,
              colIndex: selectedColIndex,
              paramName,
              newValue,
          },
      });

      // Immediately trigger regeneration with the new parameters
      regenerateGeneratorClip(selectedLayerIndex, selectedColIndex, clip.generatorDefinition, nextParams);
    }
  };
  
  const selectedClip = selectedLayerIndex !== null && selectedColIndex !== null
    ? clipContents[selectedLayerIndex][selectedColIndex]
    : null;

  const selectedClipLayerIndex = selectedClip ? selectedLayerIndex : null;
  const selectedClipLayerIntensity = selectedClipLayerIndex !== null ? layerIntensities[selectedClipLayerIndex] : 1;
  const selectedClipFinalIntensity = selectedClipLayerIntensity * masterIntensity;

  const selectedClipFrame = useMemo(() => {
    const frame = liveFrames[selectedIldaWorkerId] || null;
    if (frame && selectedClipFinalIntensity !== 1) {
      return {
        ...frame,
        points: frame.points.map(p => ({
          ...p,
          r: Math.round(p.r * selectedClipFinalIntensity),
          g: Math.round(p.g * selectedClipFinalIntensity),
          b: Math.round(p.b * selectedClipFinalIntensity),
        })),
      };
    }
    return frame;
  }, [liveFrames, selectedIldaWorkerId, selectedClipFinalIntensity]);

      const worldFrames = useMemo(() => {
        const frames = {};
        activeClipsData.forEach(clip => {
          if (clip && clip.workerId && liveFrames[clip.workerId]) {
            frames[clip.workerId] = {
              frame: liveFrames[clip.workerId],
              effects: clip.effects || [],
              layerIndex: clip.layerIndex, // Add layerIndex here
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
              <CompositionControls masterIntensity={state.masterIntensity} onMasterIntensityChange={(value) => dispatch({ type: 'SET_MASTER_INTENSITY', payload: value })} />
              <LaserOnOffButton
                isWorldOutputActive={isWorldOutputActive}
                onToggleWorldOutput={() => dispatch({ type: 'SET_WORLD_OUTPUT_ACTIVE', payload: !isWorldOutputActive })}
              />
            </div>          
		<div className="layer-controls-container">
            {layers.map((layerName, layerIndex) => {
              const activeClipDataForLayer = activeClipsData.find(clip => {
                const activeColIndex = activeClipIndexes[layerIndex];
            
                if (activeColIndex === null) return false;
            
                const currentClipContent = clipContents[layerIndex][activeColIndex];
                if (!currentClipContent) return false;
            
                if (currentClipContent.type === 'ilda') {
                  return clip.workerId === currentClipContent.workerId;
                } else if (currentClipContent.type === 'generator') {
                  return clip.workerId === `generator-${layerIndex}-${activeColIndex}`;
                }
                return false;
              }) || null;

              const liveFrameForLayer = activeClipDataForLayer ? liveFrames[activeClipDataForLayer.workerId] : null;
            
              return (
                <LayerControls
                  key={layerIndex}
                  layerName={layerName}
                  index={layerIndex}
                  layerEffects={layerEffects[layerIndex]}
                  activeClipData={activeClipDataForLayer}
                  liveFrame={liveFrameForLayer}
                  thumbnailRenderMode={thumbnailRenderMode} // Add this prop
                  intensity={state.layerIntensities[layerIndex]}
                  onIntensityChange={(value) => dispatch({ type: 'SET_LAYER_INTENSITY', payload: { layerIndex, intensity: value } })}
                  onDeactivateLayerClips={() => handleDeactivateLayerClips(layerIndex)}
                  onShowLayerFullContextMenu={() => handleShowLayerFullContextMenu(layerIndex)}
                />
              );
            })}          </div>
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

                    // Determine workerId for this clip to fetch frames
                    let clipWorkerId = null;
                    if (memoizedClipContent && memoizedClipContent.type === 'ilda') {
                      clipWorkerId = memoizedClipContent.workerId;
                    } else if (memoizedClipContent && memoizedClipContent.type === 'generator') {
                      clipWorkerId = `generator-${layerIndex}-${colIndex}`;
                    }

                    const clipLiveFrame = clipWorkerId ? liveFrames[clipWorkerId] : null;
                    const clipStillFrame = memoizedClipContent && memoizedClipContent.type === 'ilda' ? memoizedClipContent.stillFrame : (memoizedClipContent && memoizedClipContent.type === 'generator' ? memoizedClipContent.frames[0] : null);
                    
                    // Removed verbose logging for efficiency
                    // if (memoizedClipContent) { // NEW CONDITIONAL LOGGING
                    //   console.log(`[App.jsx] Clip ${layerIndex}-${colIndex} - clipWorkerId: ${clipWorkerId}, clipStillFrame:`, clipStillFrame); // DEBUG LOG
                    // }


                    return (
                      <Clip
                        key={colIndex}
                        layerIndex={layerIndex}
                        colIndex={colIndex}
                        clipName={clipNames[layerIndex][colIndex]}
                        clipContent={memoizedClipContent}
                        thumbnailFrameIndex={thumbnailFrameIndexes[layerIndex][colIndex]}
                        thumbnailRenderMode={thumbnailRenderMode} // Add this prop
                        liveFrame={clipLiveFrame} // Add this prop
                        stillFrame={clipStillFrame} // Add this prop
                        onActivateClick={() => handleActivateClick(layerIndex, colIndex)}
                        isActive={activeClipIndexes[layerIndex] === colIndex}
                        onUnsupportedFile={showNotification}
                        onDropEffect={(effectData) => handleDropEffectOnClip(layerIndex, colIndex, effectData)}
                        onDropGenerator={handleDropGenerator}
                        onDropDac={(dacData) => handleDropDac(layerIndex, colIndex, dacData)}
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
            <div className="thumbnail-render-mode-selector">
                <label htmlFor="thumbnailRenderMode">Thumbnail Mode:</label>
                <select
                    id="thumbnailRenderMode"
                    value={thumbnailRenderMode}
                    onChange={(e) => dispatch({ type: 'SET_THUMBNAIL_RENDER_MODE', payload: e.target.value })}
                >
                    <option value="still">Still Frame</option>
                    <option value="active">Live Render</option>
                </select>
            </div>
			<IldaPlayer
              frame={selectedClipFrame}
              effects={selectedClipEffects}
              showBeamEffect={showBeamEffect}
              beamAlpha={beamAlpha}
              fadeAlpha={fadeAlpha}
              previewScanRate={previewScanRate}
              beamRenderMode={beamRenderMode}
              intensity={selectedClipFinalIntensity}
            />
            <WorldPreview
              activeFrames={worldFrames}
              showBeamEffect={showBeamEffect}
              beamAlpha={beamAlpha}
              fadeAlpha={fadeAlpha}
              previewScanRate={previewScanRate}
              beamRenderMode={beamRenderMode}
              layerIntensities={layerIntensities}
              masterIntensity={masterIntensity}
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
              onParameterChange={handleEffectParameterChange}
              selectedLayerIndex={selectedLayerIndex}
              selectedColIndex={selectedColIndex}
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