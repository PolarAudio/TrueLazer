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
import ShortcutsWindow from './components/ShortcutsWindow';
import RenameModal from './components/RenameModal';
import Mappable from './components/Mappable';
import ErrorBoundary from './components/ErrorBoundary';
import { useIldaParserWorker } from './contexts/IldaParserWorkerContext';
import { useGeneratorWorker } from './contexts/GeneratorWorkerContext';
import { useAudioOutput } from './hooks/useAudioOutput'; // Add this
import { MidiProvider, useMidi } from './contexts/MidiContext'; // Add this
import { ArtnetProvider, useArtnet } from './contexts/ArtnetContext'; // Add this
import MidiMappingOverlay from './components/MidiMappingOverlay'; // Add this
import { applyEffects } from './utils/effects';
import { generateCircle, generateSquare, generateLine, generateStar, generateText } from './utils/generators'; // Import generator functions

const MasterSpeedSlider = React.memo(({ playbackFps, onSpeedChange }) => (
  <div className="master-speed-slider">
    <label htmlFor="masterSpeedRange">Playback Speed ({playbackFps} FPS)</label>
    <Mappable id="master_speed">
        <input type="range" min="1" max="120" value={playbackFps} className="slider_hor" id="masterSpeedRange" onChange={(e) => onSpeedChange(parseInt(e.target.value))} />
    </Mappable>
  </div>
));

const LaserOnOffButton = React.memo(({ isWorldOutputActive, onToggleWorldOutput }) => (
  <div className="container">
    <Mappable id="laser_output">
        <input type="checkbox" checked={isWorldOutputActive} onChange={onToggleWorldOutput} />
    </Mappable>
  </div>
));

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
  layerBlackouts: Array(5).fill(false), // Add layer blackouts
  layerSolos: Array(5).fill(false), // Add layer solos
  masterIntensity: 1, // Add this
  globalBlackout: false, // Add global blackout
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
  playbackFps: initialSettings?.renderSettings?.playbackFps ?? 60,
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
    case 'SET_COLUMN_NAME': {
        const newColumns = [...state.columns];
        newColumns[action.payload.index] = action.payload.name;
        return { ...state, columns: newColumns };
    }
    case 'SET_LAYERS':
      return { ...state, layers: action.payload };
    case 'SET_LAYER_NAME': {
        const newLayers = [...state.layers];
        newLayers[action.payload.index] = action.payload.name;
        return { ...state, layers: newLayers };
    }
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
        clearedClipContents[action.payload.layerIndex] = [...clearedClipContents[action.payload.layerIndex]];
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
    case 'CLEAR_ALL_ACTIVE_CLIPS': {
        return { ...state, activeClipIndexes: Array(state.layers.length).fill(null) };
    }
    case 'SET_LAYER_INTENSITY': {
        const newLayerIntensities = [...state.layerIntensities];
        newLayerIntensities[action.payload.layerIndex] = action.payload.intensity;
        return { ...state, layerIntensities: newLayerIntensities };
    }
    case 'TOGGLE_LAYER_BLACKOUT': {
        const newLayerBlackouts = [...state.layerBlackouts];
        newLayerBlackouts[action.payload.layerIndex] = !newLayerBlackouts[action.payload.layerIndex];
        return { ...state, layerBlackouts: newLayerBlackouts };
    }
    case 'TOGGLE_LAYER_SOLO': {
        const newLayerSolos = [...state.layerSolos];
        const wasSolo = newLayerSolos[action.payload.layerIndex];
        newLayerSolos.fill(false); // Exclusive solo: clear others
        if (!wasSolo) {
            newLayerSolos[action.payload.layerIndex] = true;
        }
        return { ...state, layerSolos: newLayerSolos };
    }
    case 'SET_MASTER_INTENSITY': {
        return { ...state, masterIntensity: action.payload };
    }
    case 'TOGGLE_GLOBAL_BLACKOUT': {
        return { ...state, globalBlackout: !state.globalBlackout };
    }
    case 'SET_RENDER_SETTING':
        return { ...state, [action.payload.setting]: action.payload.value };
    case 'UPDATE_EFFECT_PARAMETER': {
        const updatedClipContents = [...state.clipContents];
        updatedClipContents[action.payload.layerIndex] = [...updatedClipContents[action.payload.layerIndex]];
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
        updatedGenClipContents[action.payload.layerIndex] = [...updatedGenClipContents[action.payload.layerIndex]];
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
    case 'TOGGLE_WORLD_OUTPUT_ACTIVE':
      return { ...state, isWorldOutputActive: !state.isWorldOutputActive };
    case 'SET_CLIPBOARD':
      return { ...state, clipClipboard: action.payload };
    case 'SET_CLIP_DAC': {
      console.log('App.jsx Reducer: SET_CLIP_DAC payload.dac:', action.payload.dac);
      const newClipContentsWithDac = [...state.clipContents];
      // Ensure the layer array exists and create a new copy of it
      if (!newClipContentsWithDac[action.payload.layerIndex]) {
          console.error(`Reducer Error: Layer array at index ${action.payload.layerIndex} is undefined. Action:`, action);
          return state;
      }
      newClipContentsWithDac[action.payload.layerIndex] = [...newClipContentsWithDac[action.payload.layerIndex]];

      // Get the existing clip, create a new copy of it, and then modify its dac
      const existingClip = newClipContentsWithDac[action.payload.layerIndex][action.payload.colIndex] || {};
      
      const currentAssignedDacs = existingClip.assignedDacs || [];
      // Check for duplicates
      if (currentAssignedDacs.some(d => d.ip === action.payload.dac.ip && d.channel === action.payload.dac.channel)) {
          return state;
      }

      const updatedClip = {
          ...existingClip,
          assignedDacs: [...currentAssignedDacs, action.payload.dac],
      };
      newClipContentsWithDac[action.payload.layerIndex][action.payload.colIndex] = updatedClip;
      return { ...state, clipContents: newClipContentsWithDac };
    }
    case 'REMOVE_CLIP_DAC': {
        const newClipContents = [...state.clipContents];
        newClipContents[action.payload.layerIndex] = [...newClipContents[action.payload.layerIndex]];
        const { layerIndex, colIndex, dacIndex } = action.payload;
        const existingClip = newClipContents[layerIndex][colIndex];
        if (existingClip && existingClip.assignedDacs) {
            const newAssignedDacs = [...existingClip.assignedDacs];
            newAssignedDacs.splice(dacIndex, 1);
      newClipContents[action.payload.layerIndex][action.payload.colIndex] = {
                ...existingClip,
                assignedDacs: newAssignedDacs
            };
            return { ...state, clipContents: newClipContents };
        }
        return state;
    }
    case 'SET_CLIP_AUDIO': {
        const newClipContents = [...state.clipContents];
        const { layerIndex, colIndex, audioFile } = action.payload;
        newClipContents[layerIndex] = [...newClipContents[layerIndex]];
        const existingClip = newClipContents[layerIndex][colIndex];
        if (existingClip) {
            newClipContents[layerIndex][colIndex] = {
                ...existingClip,
                audioFile
            };
            return { ...state, clipContents: newClipContents };
        }
        return state;
    }
    case 'REMOVE_CLIP_AUDIO': {
        const newClipContents = [...state.clipContents];
        const { layerIndex, colIndex } = action.payload;
        newClipContents[layerIndex] = [...newClipContents[layerIndex]];
        const existingClip = newClipContents[layerIndex][colIndex];
        if (existingClip) {
            newClipContents[layerIndex][colIndex] = {
                ...existingClip,
                audioFile: null
            };
            return { ...state, clipContents: newClipContents };
        }
        return state;
    }


    case 'SET_CLIP_PARSING_STATUS': {
        const { layerIndex, colIndex, status } = action.payload;
        const newClipContents = [...state.clipContents];
        // Copy inner array
        newClipContents[layerIndex] = [...newClipContents[layerIndex]];
        const existingClip = newClipContents[layerIndex][colIndex] || {};
        newClipContents[layerIndex][colIndex] = { ...existingClip, parsing: status };
        return { ...state, clipContents: newClipContents };
    }
    case 'SET_THUMBNAIL_RENDER_MODE':
      return { ...state, thumbnailRenderMode: action.payload };
    case 'SET_CLIP_TRIGGER_STYLE': {
        const { layerIndex, colIndex, style } = action.payload;
        const newClipContents = [...state.clipContents];
        newClipContents[layerIndex] = [...newClipContents[layerIndex]];
        const existingClip = newClipContents[layerIndex][colIndex] || {};
        newClipContents[layerIndex][colIndex] = { ...existingClip, triggerStyle: style };
        return { ...state, clipContents: newClipContents };
    }
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
            playbackFps: action.payload.renderSettings?.playbackFps ?? state.playbackFps,
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

const THEME_COLORS = {
    'orange': { full: 9, dim: 10 }, // Orange
    'yellow': { full: 13, dim: 14 }, // Yellow
    'cyan': { full: 30, dim: 31 }, // Cyan
    'light-blue': { full: 29, dim: 29 }, // Teal
    'blue': { full: 45, dim: 46 }, // Blue
    'magenta': { full: 53, dim: 54 }, // Magenta
    'red': { full: 5, dim: 6 }, // Red
    'green': { full: 21, dim: 22 }, // Green
    'white': { full: 3, dim: 1 }, // White/Gray
};

const MidiFeedbackHandler = ({ isPlaying, globalBlackout, layerBlackouts, layerSolos, isWorldOutputActive, clipContents, activeClipIndexes, theme }) => {
  const { sendFeedback, mappings } = useMidi();
  
  // Transport and Global feedback
  useEffect(() => {
    sendFeedback('transport_play', isPlaying);
    sendFeedback('transport_stop', !isPlaying);
  }, [isPlaying, sendFeedback]);

  useEffect(() => {
    sendFeedback('comp_blackout', globalBlackout);
  }, [globalBlackout, sendFeedback]);

  useEffect(() => {
    sendFeedback('laser_output', isWorldOutputActive);
  }, [isWorldOutputActive, sendFeedback]);

  // Layer controls feedback
  useEffect(() => {
    layerBlackouts.forEach((active, index) => {
      sendFeedback(`layer_${index}_blackout`, active);
    });
  }, [layerBlackouts, sendFeedback]);

  useEffect(() => {
    layerSolos.forEach((active, index) => {
      sendFeedback(`layer_${index}_solo`, active);
    });
  }, [layerSolos, sendFeedback]);

  // Clip Grid Feedback
  useEffect(() => {
      if (!clipContents || !activeClipIndexes) return;

      const colors = THEME_COLORS[theme] || THEME_COLORS['orange'];

      clipContents.forEach((layer, layerIndex) => {
          layer.forEach((clip, colIndex) => {
              const controlId = `clip_${layerIndex}_${colIndex}`;
              // Only send feedback if this clip is actually mapped
              if (mappings[controlId]) {
                  const isActive = activeClipIndexes[layerIndex] === colIndex;
                  const hasContent = clip !== null && (clip.type === 'ilda' || clip.type === 'generator');
                  
                  let velocity = 0; // Off
                  if (isActive) {
                      velocity = colors.full; // Full brightness / Active color
                  } else if (hasContent) {
                      velocity = colors.dim; // Dimmed / Content color
                  }
                  
                  sendFeedback(controlId, velocity);
              }
          });
      });
  }, [clipContents, activeClipIndexes, theme, mappings, sendFeedback]);

  return null;
};

function App() {
  const ildaParserWorker = useIldaParserWorker();
  const generatorWorker = useGeneratorWorker();
  const { 
    devices: audioDevices, 
    selectedDeviceId, 
    setSelectedDeviceId, 
    playAudio, 
    stopAudio, 
    pauseAllAudio,
    resumeAllAudio,
    setPlaybackRate,
    resetAllAudio,
    stopAllAudio,
    getAudioInfo
  } = useAudioOutput(); // Initialize hook
  const initializedChannels = useRef(new Set());
  const ildaPlayerCurrentFrameIndex = useRef(0);
  
  const liveFramesRef = useRef({});
  const [frameTick, setFrameTick] = useState(0);

  const lastFrameFetchTimeRef = useRef({});
  const frameIndexesRef = useRef({});

  const [initialSettings, setInitialSettings] = useState(null);
  const [initialSettingsLoaded, setInitialSettingsLoaded] = useState(false);
  const [showShortcutsWindow, setShowShortcutsWindow] = useState(false);
  const [enabledShortcuts, setEnabledShortcuts] = useState({ midi: false, artnet: false, osc: false, keyboard: false });
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameModalConfig, setRenameModalConfig] = useState({ title: '', initialValue: '', onSave: () => {} });

  const [state, dispatch] = useReducer(reducer, getInitialState(initialSettingsLoaded ? initialSettings : {}));
  const {
    columns,
    layers,
    clipContents,
    clipNames,
    thumbnailFrameIndexes,
    layerEffects,
    layerIntensities,
    layerBlackouts, // Add this
    layerSolos, // Add this
    masterIntensity,
    globalBlackout, // Add this
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
    playbackFps,
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

  // Refs for real-time access in animation loop
  const layerIntensitiesRef = useRef(layerIntensities);
  const masterIntensityRef = useRef(masterIntensity);
  const layerBlackoutsRef = useRef(layerBlackouts);
  const layerSolosRef = useRef(layerSolos);
  const globalBlackoutRef = useRef(globalBlackout);

  useEffect(() => {
    layerIntensitiesRef.current = layerIntensities;
    masterIntensityRef.current = masterIntensity;
    layerBlackoutsRef.current = layerBlackouts;
    layerSolosRef.current = layerSolos;
    globalBlackoutRef.current = globalBlackout;
  }, [layerIntensities, masterIntensity, layerBlackouts, layerSolos, globalBlackout]);

  const handlePlaybackFpsChange = useCallback((value) => {
    dispatch({ type: 'SET_RENDER_SETTING', payload: { setting: 'playbackFps', value } });
  }, []);

  useEffect(() => {
    const rate = playbackFps / 60;
    setPlaybackRate(rate);
  }, [playbackFps, setPlaybackRate]);

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
                      assignedDacs: clip.assignedDacs || [],
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
                      assignedDacs: clip.assignedDacs || [],
                      ildaFormat: 0,
                      stillFrame, 
                      layerIndex,
                  };
              }
          }
      }
      return null;
    }).filter(Boolean), [layers, activeClipIndexes, clipContents]);

  // Update CSS variables when theme changes
  useEffect(() => {
    const themeColors = {
      'orange': '#ff7f00',
      'yellow': '#ffff00',
      'cyan': '#00ffff',
      'light-blue': '#add8e6',
      'blue': '#0000ff',
      'magenta': '#ff00ff',
      'red': '#ff0000',
      'green': '#00ff00',
      'white': '#ffffff'
    };
    const color = themeColors[theme] || themeColors['orange'];
    document.documentElement.style.setProperty('--theme-color', color);
  }, [theme]);

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
          liveFramesRef.current[e.data.workerId] = e.data.frame;
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
    const frameInterval = 1000 / playbackFps;

    // Animate function for DAC output
    const animate = (currentTime) => {
      if (!isWorldOutputActive) {
        cancelAnimationFrame(dacRefreshAnimationFrameId);
        return;
      }

      if (currentTime - lastFrameTime > frameInterval) {
        if (window.electronAPI && activeClipsData.length > 0 && isWorldOutputActive) {
          activeClipsData.forEach(clip => {
            if (clip && liveFramesRef.current[clip.workerId]) {
              const dacList = (clip.assignedDacs && clip.assignedDacs.length > 0)
                ? clip.assignedDacs
                : (selectedDac ? [selectedDac] : []);

              if (dacList.length === 0) return;

              const effects = clip.effects || [];
              const frame = liveFramesRef.current[clip.workerId];

              // Calculate Effective Intensity using Refs
              const layerIntensity = layerIntensitiesRef.current[clip.layerIndex];
              const isGlobalBlackout = globalBlackoutRef.current;
              const isLayerBlackout = layerBlackoutsRef.current[clip.layerIndex];
              const isLayerSolo = layerSolosRef.current[clip.layerIndex];
              const isAnySolo = layerSolosRef.current.some(s => s);

              let effectiveIntensity = layerIntensity;

              if (isGlobalBlackout) {
                  effectiveIntensity = 0;
              } else if (isAnySolo) {
                  if (!isLayerSolo) {
                      effectiveIntensity = 0;
                  } else {
                    // If self is solo, but self is blackout? Blackout takes precedence usually
                    if (isLayerBlackout) {
                        effectiveIntensity = 0;
                    }
                  }
              } else {
                  if (isLayerBlackout) {
                      effectiveIntensity = 0;
                  }
              }

              const finalIntensity = effectiveIntensity * masterIntensityRef.current;

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

              dacList.forEach(targetDac => {
                const ip = targetDac.ip;
                // Use serviceID from the channel object
                const channel = targetDac.channel || (targetDac.channels && targetDac.channels.length > 0 ? targetDac.channels[0].serviceID : 0);

                if (channel !== 0) {
                  window.electronAPI.sendFrame(ip, channel, modifiedFrame, playbackFps);
                }
              });
            }
          });
        }
        lastFrameTime = currentTime;
      }
      dacRefreshAnimationFrameId = requestAnimationFrame(animate);
    };

    // Frame fetcher loop for updating liveFrames
    const frameFetcherLoop = (timestamp) => {
      const currentFrameInterval = 1000 / playbackFps;

      // 1. Process active clips
      layers.forEach((_, layerIndex) => {
          const activeColIndex = activeClipIndexes[layerIndex];
          if (activeColIndex === null) return;
          const clip = clipContents[layerIndex][activeColIndex];
          if (!clip) return;

          let workerId = clip.type === 'ilda' ? clip.workerId : (clip.type === 'generator' ? `generator-${layerIndex}-${activeColIndex}` : null);
          if (!workerId) return;

          if (!lastFrameFetchTimeRef.current[workerId]) {
              lastFrameFetchTimeRef.current[workerId] = timestamp;
          }
          
          const delta = timestamp - lastFrameFetchTimeRef.current[workerId];
          const audioInfo = getAudioInfo(layerIndex);
          
          let targetIndex = frameIndexesRef.current[workerId] || 0;

          if (audioInfo && isPlaying && !audioInfo.paused) {
              // Absolute sync to audio: frameIndex = seconds * fps
              targetIndex = Math.floor(audioInfo.currentTime * playbackFps);
          } else if (delta >= currentFrameInterval) {
              // Clock sync with frame skipping for non-audio or paused state
              const framesToAdvance = Math.floor(delta / currentFrameInterval);
              lastFrameFetchTimeRef.current[workerId] = timestamp - (delta % currentFrameInterval);
              if (isPlaying) {
                  targetIndex = (targetIndex + framesToAdvance);
              }
          } else {
              return; // Not time yet for this worker
          }

          if (clip.totalFrames > 0) {
              targetIndex = targetIndex % clip.totalFrames;
          }
          
          if (frameIndexesRef.current[workerId] !== targetIndex || !liveFramesRef.current[workerId]) {
              frameIndexesRef.current[workerId] = targetIndex;
              if (clip.type === 'ilda') {
                  ildaParserWorker.postMessage({ type: 'get-frame', workerId, frameIndex: targetIndex });
              } else if (clip.type === 'generator') {
                  if (clip.frames && clip.frames[targetIndex % clip.frames.length]) {
                      liveFramesRef.current[workerId] = clip.frames[targetIndex % clip.frames.length];
                  }
              }
          }
      });

      // 2. Process selected clip (for preview) if it's not active
      if (selectedIldaWorkerId && !activeClipsData.some(c => c.workerId === selectedIldaWorkerId)) {
          const workerId = selectedIldaWorkerId;
          if (!lastFrameFetchTimeRef.current[workerId]) {
              lastFrameFetchTimeRef.current[workerId] = timestamp;
          }
          const delta = timestamp - lastFrameFetchTimeRef.current[workerId];
          if (delta >= currentFrameInterval) {
              const framesToAdvance = Math.floor(delta / currentFrameInterval);
              lastFrameFetchTimeRef.current[workerId] = timestamp - (delta % currentFrameInterval);
              
              const currentFrameIndex = frameIndexesRef.current[workerId] || 0;
              let nextFrameIndex = currentFrameIndex;

              if (isPlaying) {
                  nextFrameIndex = (currentFrameIndex + framesToAdvance) % (selectedIldaTotalFrames || 1);
                  frameIndexesRef.current[workerId] = nextFrameIndex;
              }

              if (workerId.startsWith('generator-')) {
                  // For generator clips, find the clip and update liveFrames
                   // We need to find the clip in clipContents. 
                   // workerId format: generator-{layerIndex}-{colIndex}
                   const parts = workerId.split('-');
                   if (parts.length === 3) {
                       const lIndex = parseInt(parts[1]);
                       const cIndex = parseInt(parts[2]);
                       const clip = state.clipContents[lIndex][cIndex];
                       if (clip && clip.type === 'generator' && clip.frames) {
                           liveFramesRef.current[workerId] = clip.frames[nextFrameIndex % clip.frames.length];
                       }
                   }
              } else {
                  // For ILDA clips, request frame from worker
                  ildaParserWorker.postMessage({ type: 'get-frame', workerId, frameIndex: nextFrameIndex });
              }
          }
      }

      animationFrameId = requestAnimationFrame(frameFetcherLoop);
      setFrameTick(t => t + 1); // Trigger UI preview re-renders
    };

    animationFrameId = requestAnimationFrame(frameFetcherLoop);
    
    // Start DAC animation if world output is active
    if (isWorldOutputActive) {
      dacRefreshAnimationFrameId = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(dacRefreshAnimationFrameId);
    }


    return () => {
      ildaParserWorker.removeEventListener('message', handleMessage);
      cancelAnimationFrame(animationFrameId);
      cancelAnimationFrame(dacRefreshAnimationFrameId); // Clean up DAC animation frame
    };
  }, [ildaParserWorker, workerIdsToFetch, playbackFps, clipContents, isPlaying, activeClipsData, isWorldOutputActive, selectedDac, state.clipContents, selectedIldaWorkerId, selectedIldaTotalFrames, getAudioInfo]);

    // Listen for context menu commands
    useEffect(() => {
        let unsubClip, unsubLayer, unsubCtx;

        if (window.electronAPI) {
            unsubClip = window.electronAPI.onClipContextMenuCommand((command, layerIndex, colIndex) => {
                console.log(`Clip context menu command received: ${command} for ${layerIndex}-${colIndex}`);
                if (command === 'update-thumbnail') {
                    const clipToUpdate = clipContents[layerIndex][colIndex];
                    if (clipToUpdate) {
                        if (clipToUpdate.type === 'ilda' && clipToUpdate.workerId && ildaParserWorker) {
                            const currentFrame = frameIndexesRef.current[clipToUpdate.workerId] || 0;
                            ildaParserWorker.postMessage({
                                type: 'get-frame',
                                workerId: clipToUpdate.workerId,
                                frameIndex: currentFrame,
                                isStillFrame: true,
                                layerIndex,
                                colIndex,
                            });
                        } else if (clipToUpdate.type === 'generator' && clipToUpdate.generatorDefinition && generatorWorker) {
                            regenerateGeneratorClip(layerIndex, colIndex, clipToUpdate.generatorDefinition, clipToUpdate.currentParams);
                        }
                    }
                } else if (command === 'clear-clip') {
                    dispatch({ type: 'CLEAR_CLIP', payload: { layerIndex, colIndex } });
                } else if (command === 'rename-clip') {
                    const oldName = clipNames[layerIndex][colIndex];
                    setRenameModalConfig({
                        title: 'Rename Clip',
                        initialValue: oldName,
                        onSave: (newName) => dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: newName } })
                    });
                    setShowRenameModal(true);
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
                        let contentToPaste = { ...content };
                        if (contentToPaste.type === 'ilda') {
                            contentToPaste.workerId = null;
                        }

                        dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: contentToPaste }});
                        dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name }});
                        showNotification('Clip pasted.');
                        
                        setTimeout(() => {
                            const newClip = contentToPaste;
                            if (newClip.type === 'generator' && newClip.generatorDefinition) {
                                regenerateGeneratorClip(layerIndex, colIndex, newClip.generatorDefinition, newClip.currentParams);
                            }
                        }, 100);

                    } else {
                        showNotification('Clipboard is empty.');
                    }
                } else if (command === 'set-trigger-style-normal') {
                    dispatch({ type: 'SET_CLIP_TRIGGER_STYLE', payload: { layerIndex, colIndex, style: 'normal' } });
                } else if (command === 'set-trigger-style-toggle') {
                    dispatch({ type: 'SET_CLIP_TRIGGER_STYLE', payload: { layerIndex, colIndex, style: 'toggle' } });
                } else if (command === 'set-trigger-style-flash') {
                    dispatch({ type: 'SET_CLIP_TRIGGER_STYLE', payload: { layerIndex, colIndex, style: 'flash' } });
                }
            });

            unsubLayer = window.electronAPI.onLayerFullContextMenuCommand((command, layerIndex) => {
                console.log(`Layer context menu command received: ${command} for ${layerIndex}`);
                if (command === 'layer-rename') {
                    const oldName = layers[layerIndex];
                    setRenameModalConfig({
                        title: 'Rename Layer',
                        initialValue: oldName,
                        onSave: (newName) => dispatch({ type: 'SET_LAYER_NAME', payload: { index: layerIndex, name: newName } })
                    });
                    setShowRenameModal(true);
                } else if (command === 'layer-clear-clips') {
                    dispatch({ type: 'DEACTIVATE_LAYER_CLIPS', payload: { layerIndex } });
                }
            });

            unsubCtx = window.electronAPI.onContextMenuActionFromMain((action) => {
                console.log(`General context menu action received:`, action);
                if (action.type === 'rename-column') {
                    const oldName = columns[action.index];
                    setRenameModalConfig({
                        title: 'Rename Column',
                        initialValue: oldName,
                        onSave: (newName) => dispatch({ type: 'SET_COLUMN_NAME', payload: { index: action.index, name: newName } })
                    });
                    setShowRenameModal(true);
                } else if (action.type === 'rename-layer') { // Support for simpler layer menu if used
                    const oldName = layers[action.index];
                    setRenameModalConfig({
                        title: 'Rename Layer',
                        initialValue: oldName,
                        onSave: (newName) => dispatch({ type: 'SET_LAYER_NAME', payload: { index: action.index, name: newName } })
                    });
                    setShowRenameModal(true);
                }
            });
        }

        return () => {
            if (unsubClip) unsubClip();
            if (unsubLayer) unsubLayer();
            if (unsubCtx) unsubCtx();
        };
    }, [clipContents, clipNames, layers, columns, ildaParserWorker, generatorWorker, state.clipClipboard]);

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

    const loadInitialSettings = async () => {
        if (window.electronAPI && window.electronAPI.getAllSettings) {
            const settings = await window.electronAPI.getAllSettings();
            if (settings) {
                if (settings.shortcutsState) {
                    setEnabledShortcuts(settings.shortcutsState);
                }
                dispatch({ type: 'LOAD_SETTINGS', payload: settings });
            }
        }
    };
    loadInitialSettings();

    if (window.electronAPI) {
      // Listener for general menu actions like theme changes
      unlistenMenu = window.electronAPI.onMenuAction((action) => {
        console.log("Menu action received:", action);
        if (action.startsWith('set-theme-')) {
          const themeColor = action.split('set-theme-')[1];
          dispatch({ type: 'SET_THEME', payload: themeColor });
        } else if (action === 'shortcuts-window' || (action.startsWith('open-') && action.endsWith('-settings'))) {
            setShowShortcutsWindow(true);
        } else if (action.startsWith('toggle-')) {
            // action format: toggle-midi-true
            const parts = action.split('-');
            if (parts.length === 3) {
                const protocol = parts[1]; // midi, artnet, osc, keyboard
                const isEnabled = parts[2] === 'true';
                setEnabledShortcuts(prev => ({ ...prev, [protocol]: isEnabled }));
            }
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
            liveFramesRef.current[generatorWorkerId] = frames[0]; // Assuming frames[0] is the primary frame
        } else {
            showNotification(`Error generating frames: ${e.data.error}`);
        }
    };

    generatorWorker.addEventListener('message', handleMessage);

    return () => {
        generatorWorker.removeEventListener('message', handleMessage);
    };
  }, [generatorWorker, state.clipContents]); // Add state.clipContents to dependency array to get the latest version

  const handleDropGenerator = useCallback((layerIndex, colIndex, generatorDefinition) => {
    console.log('[App.jsx] handleDropGenerator - Received generatorDefinition:', generatorDefinition); // DEBUG LOG
    if (generatorWorker) {
        console.log('[App.jsx] handleDropGenerator - Using new regenerateGeneratorClip function'); // DEBUG LOG
        regenerateGeneratorClip(layerIndex, colIndex, generatorDefinition, generatorDefinition.defaultParams);
    }
  }, [generatorWorker]);

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

  const handleDeactivateLayerClips = useCallback((layerIndex) => {
    stopAudio(layerIndex); // Stop audio for this layer
    dispatch({ type: 'DEACTIVATE_LAYER_CLIPS', payload: { layerIndex } });
  }, [stopAudio]);

  const handleClearAllActive = useCallback(() => {
    stopAllAudio(); // Stop all audio
    dispatch({ type: 'CLEAR_ALL_ACTIVE_CLIPS' });
  }, [stopAllAudio]);

  const handlePlay = useCallback(() => {
    // 1. Resume any audio that was already loaded/paused
    resumeAllAudio();
    
    // 2. Start audio for any active clips that might have been "cued" while transport was stopped
    layers.forEach((_, layerIndex) => {
        const activeColIndex = activeClipIndexes[layerIndex];
        if (activeColIndex !== null) {
            const clip = clipContents[layerIndex][activeColIndex];
            if (clip && clip.audioFile && !getAudioInfo(layerIndex)) {
                playAudio(layerIndex, clip.audioFile.path, true);
            }
        }
    });

    dispatch({ type: 'SET_IS_PLAYING', payload: true });
  }, [resumeAllAudio, layers, activeClipIndexes, clipContents, getAudioInfo, playAudio]);

  const handlePause = useCallback(() => {
    pauseAllAudio();
    dispatch({ type: 'SET_IS_PLAYING', payload: false });
  }, [pauseAllAudio]);

  const handleStop = useCallback(() => {
    resetAllAudio();
    pauseAllAudio();
    dispatch({ type: 'SET_IS_PLAYING', payload: false });
    frameIndexesRef.current = {};
  }, [resetAllAudio, pauseAllAudio]);

  const handleActivateClick = useCallback((layerIndex, colIndex, isPress = true) => {
    const clip = clipContents[layerIndex][colIndex];
    
    if (!clip) {
        if (isPress) {
            handleClipPreview(layerIndex, colIndex);
            handleDeactivateLayerClips(layerIndex);
        }
        return;
    }

    const style = clip.triggerStyle || 'normal';
    const currentActiveCol = activeClipIndexes[layerIndex];

    if (style === 'normal') {
        if (!isPress) return;
        // Proceed to activate
    } else if (style === 'toggle') {
        if (!isPress) return;
        if (currentActiveCol === colIndex) {
            handleDeactivateLayerClips(layerIndex);
            return;
        }
        // Proceed to activate
    } else if (style === 'flash') {
        if (isPress) {
            // Proceed to activate
        } else {
            if (currentActiveCol === colIndex) {
                handleDeactivateLayerClips(layerIndex);
            }
            return;
        }
    }

    if (clip && clip.type === 'generator' && clip.frames) {
      const generatorWorkerId = `generator-${layerIndex}-${colIndex}`;
      // Ensure the frame is in liveFrames so WorldPreview can render it.
      liveFramesRef.current[generatorWorkerId] = clip.frames[0];
    }
    
    // Manage associated audio: load/cue it regardless of playback state, but only play if `isPlaying`
    if (clip && clip.audioFile) {
        playAudio(layerIndex, clip.audioFile.path, isPlaying);
    } else {
        stopAudio(layerIndex);
    }

    dispatch({ type: 'SET_ACTIVE_CLIP', payload: { layerIndex, colIndex } });
  }, [clipContents, activeClipIndexes, handleDeactivateLayerClips, playAudio, isPlaying, stopAudio]);

  const handleDropEffectOnClip = useCallback((layerIndex, colIndex, effectData) => {
      dispatch({ type: 'ADD_CLIP_EFFECT', payload: { layerIndex, colIndex, effect: effectData } });
  }, []);

  const handleDropDac = useCallback((layerIndex, colIndex, dacData) => {
    console.trace('App.jsx: handleDropDac received dacData:', dacData);
      dispatch({ type: 'SET_CLIP_DAC', payload: { layerIndex, colIndex, dac: dacData } });
  }, []);

  const handleClipPreview = useCallback((layerIndex, colIndex) => {
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
  }, [clipContents]);

  const handleShowLayerFullContextMenu = (layerIndex) => {
    if (window.electronAPI && window.electronAPI.showLayerFullContextMenu) {
        window.electronAPI.showLayerFullContextMenu(layerIndex);
    }
  };

  const handleShowColumnHeaderContextMenu = (colIndex) => {
    if (window.electronAPI && window.electronAPI.showColumnContextMenu) {
        window.electronAPI.showColumnContextMenu(colIndex);
    }
  };

  const handleColumnTrigger = (colIndex) => {
    layers.forEach((_, layerIndex) => {
      const clip = clipContents[layerIndex][colIndex];
      if (clip && (clip.type === 'ilda' || clip.type === 'generator')) {
        handleActivateClick(layerIndex, colIndex);
      } else {
        handleDeactivateLayerClips(layerIndex);
      }
    });
  };

  const handleDacSelected = useCallback((dac) => {
    dispatch({ type: 'SET_SELECTED_DAC', payload: dac });
  }, []);

  const handleDacsDiscovered = useCallback((dacs) => {
    dispatch({ type: 'SET_DACS', payload: dacs });
  }, []);

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
    const frame = liveFramesRef.current[selectedIldaWorkerId] || null;
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
  }, [frameTick, selectedIldaWorkerId, selectedClipFinalIntensity]);

      const worldFrames = useMemo(() => {
        const frames = {};
        activeClipsData.forEach(clip => {
          if (clip && clip.workerId && liveFramesRef.current[clip.workerId]) {
            frames[clip.workerId] = {
              frame: liveFramesRef.current[clip.workerId],
              effects: clip.effects || [],
              layerIndex: clip.layerIndex, // Add layerIndex here
            };
          }
        });
        return frames;
      }, [activeClipsData, frameTick]);

  const effectiveLayerIntensities = useMemo(() => {
      const isAnySolo = layerSolos.some(s => s);
      return layerIntensities.map((intensity, index) => {
          if (globalBlackout) return 0;
          if (isAnySolo) {
              if (!layerSolos[index]) return 0;
              // If self is solo, but self is blackout? Blackout takes precedence usually
              if (layerBlackouts[index]) return 0;
          } else {
              if (layerBlackouts[index]) return 0;
          }
          return intensity;
      });
  }, [layerIntensities, layerBlackouts, layerSolos, globalBlackout]);

  const handleMidiCommand = useCallback((id, value, maxValue = 127) => {
    // Basic threshold for button triggers to avoid noise or NoteOff (velocity 0)
    // ALLOW value 0 if it's a clip trigger (to support Flash mode release)
    if (value === 0 && !id.endsWith('_intensity') && id !== 'master_intensity' && id !== 'master_speed' && !id.startsWith('clip_')) return;

    const normalizedValue = value / maxValue;

    switch (id) {
      case 'transport_play':
        if (value > 0) handlePlay();
        break;
      case 'transport_pause':
        if (value > 0) handlePause();
        break;
      case 'transport_stop':
        if (value > 0) handleStop();
        break;
      case 'comp_blackout':
        if (value > 0) dispatch({ type: 'TOGGLE_GLOBAL_BLACKOUT' });
        break;
      case 'comp_clear':
        if (value > 0) handleClearAllActive();
        break;
      case 'master_intensity':
        dispatch({ type: 'SET_MASTER_INTENSITY', payload: normalizedValue });
        break;
      case 'master_speed':
        // Map 0-1 to 1-120 FPS
        const newFps = Math.max(1, Math.round(normalizedValue * 120));
        handlePlaybackFpsChange(newFps);
        break;
      case 'laser_output':
        if (value > 0) dispatch({ type: 'TOGGLE_WORLD_OUTPUT_ACTIVE' });
        break;
      default:
        // Handle dynamic IDs (e.g. layer_1_blackout)
        if (id.startsWith('layer_')) {
             const parts = id.split('_');
             const layerIndex = parseInt(parts[1]);
             const action = parts[2]; // 'blackout', 'solo', 'intensity', 'clear'
             
             if (action === 'blackout' && value > 0) {
                 dispatch({ type: 'TOGGLE_LAYER_BLACKOUT', payload: { layerIndex } });
             } else if (action === 'solo' && value > 0) {
                 dispatch({ type: 'TOGGLE_LAYER_SOLO', payload: { layerIndex } });
             } else if (action === 'intensity') {
                 dispatch({ type: 'SET_LAYER_INTENSITY', payload: { layerIndex, intensity: normalizedValue } });
             } else if (action === 'clear' && value > 0) {
                 handleDeactivateLayerClips(layerIndex);
             }
        } else if (id.startsWith('clip_')) {
            const parts = id.split('_');
            const layerIndex = parseInt(parts[1]);
            const colIndex = parseInt(parts[2]);
            const isPreview = parts[3] === 'preview';
            
            if (isPreview) {
                if (value > 0) handleClipPreview(layerIndex, colIndex);
            } else {
                handleActivateClick(layerIndex, colIndex, value > 0);
            }
        } else if (id.startsWith('column_')) {
            const parts = id.split('_');
            const colIndex = parseInt(parts[1]);
            if (value > 0) {
                handleColumnTrigger(colIndex);
            }
        }
    }
  }, [handlePlay, handlePause, handleStop, handleClearAllActive, handleDeactivateLayerClips, handlePlaybackFpsChange]);

  return (
    <MidiProvider onMidiCommand={handleMidiCommand}>
    <ArtnetProvider onArtnetCommand={(id, value) => handleMidiCommand(id, value, 255)}>
    <MidiFeedbackHandler 
        isPlaying={isPlaying} 
        globalBlackout={globalBlackout} 
        layerBlackouts={layerBlackouts} 
        layerSolos={layerSolos} 
        isWorldOutputActive={isWorldOutputActive}
        clipContents={clipContents}
        activeClipIndexes={activeClipIndexes}
        theme={theme}
    />
    <MidiMappingOverlay />
    <div className="app">
      <ErrorBoundary>
        <NotificationPopup message={notification.message} visible={notification.visible} />
        <RenameModal 
            show={showRenameModal} 
            title={renameModalConfig.title} 
            initialValue={renameModalConfig.initialValue} 
            onSave={renameModalConfig.onSave} 
            onClose={() => setShowShortcutsWindow(false) || setShowRenameModal(false)} 
        />
        <div className="main-content">
            <div className="top-bar-left-area">
              <CompositionControls 
                masterIntensity={state.masterIntensity} 
                onMasterIntensityChange={(value) => dispatch({ type: 'SET_MASTER_INTENSITY', payload: value })} 
                onClearAllActive={handleClearAllActive}
                isGlobalBlackout={globalBlackout}
                onToggleGlobalBlackout={() => dispatch({ type: 'TOGGLE_GLOBAL_BLACKOUT' })}
              />
              <LaserOnOffButton
                isWorldOutputActive={isWorldOutputActive}
                onToggleWorldOutput={() => dispatch({ type: 'TOGGLE_WORLD_OUTPUT_ACTIVE' })}
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

              const liveFrameForLayer = activeClipDataForLayer ? liveFramesRef.current[activeClipDataForLayer.workerId] : null;
            
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
                  isBlackout={layerBlackouts[layerIndex]}
                  isSolo={layerSolos[layerIndex]}
                  onToggleBlackout={() => dispatch({ type: 'TOGGLE_LAYER_BLACKOUT', payload: { layerIndex } })}
                  onToggleSolo={() => dispatch({ type: 'TOGGLE_LAYER_SOLO', payload: { layerIndex } })}
                />
              );
            })}          </div>
          <div className="clip-deck-container">
            <div className="clip-deck">
              <div className="column-headers-container">
                {columns.map((colName, colIndex) => (
                  <ColumnHeader 
                    key={colIndex} 
                    name={colName} 
                    index={colIndex} 
                    onTrigger={() => handleColumnTrigger(colIndex)}
                    onShowColumnHeaderContextMenu={() => handleShowColumnHeaderContextMenu(colIndex)} 
                  />
                ))}
              </div>
              {layers.map((layerName, layerIndex) => (
                <div key={layerIndex} className="layer-row">
                  {columns.map((colName, colIndex) => {
                    const currentClipContent = clipContents[layerIndex][colIndex];

                    // Determine workerId for this clip to fetch frames
                    let clipWorkerId = null;
                    if (currentClipContent && currentClipContent.type === 'ilda') {
                      clipWorkerId = currentClipContent.workerId;
                    } else if (currentClipContent && currentClipContent.type === 'generator') {
                      clipWorkerId = `generator-${layerIndex}-${colIndex}`;
                    }

                    const clipLiveFrame = clipWorkerId ? liveFramesRef.current[clipWorkerId] : null;
                    const clipStillFrame = currentClipContent && currentClipContent.type === 'ilda' ? currentClipContent.stillFrame : (currentClipContent && currentClipContent.type === 'generator' ? currentClipContent.frames[0] : null);
                    
                    return (
                      <Clip
                        key={colIndex}
                        layerIndex={layerIndex}
                        colIndex={colIndex}
                        clipName={clipNames[layerIndex][colIndex]}
                        clipContent={currentClipContent}
                        thumbnailFrameIndex={thumbnailFrameIndexes[layerIndex][colIndex]}
                        thumbnailRenderMode={thumbnailRenderMode} // Add this prop
                        liveFrame={clipLiveFrame} // Add this prop
                        stillFrame={clipStillFrame} // Add this prop
                        onActivateClick={(isPress) => handleActivateClick(layerIndex, colIndex, isPress)}
                        isActive={activeClipIndexes[layerIndex] === colIndex}
                        onUnsupportedFile={showNotification}
                        onDropEffect={(effectData) => handleDropEffectOnClip(layerIndex, colIndex, effectData)}
                        onDropGenerator={handleDropGenerator}
                        onDropDac={(passedLayerIndex, passedColIndex, dacDataFromClip) => {
                            console.log('App.jsx: Lambda dacData from Clip:', dacDataFromClip);
                            handleDropDac(passedLayerIndex, passedColIndex, dacDataFromClip);
                        }}
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
              layerIntensities={effectiveLayerIntensities}
              masterIntensity={masterIntensity}
            />
            
          </div>
          <div className="middle-bar">
            <div className="middle-bar-left-area">
              <BPMControls onPlay={handlePlay} onPause={handlePause} onStop={handleStop} />
            </div>
            <div className="middle-bar-mid-area">
				<MasterSpeedSlider playbackFps={playbackFps} onSpeedChange={handlePlaybackFpsChange} />
            </div>
			<div className="middle-bar-right-area">
				<p> Right Section of Middle-Bar</p>
            </div>
          </div>
          <div className="bottom-panel">
            <FileBrowser onDropIld={(layerIndex, colIndex, file) => ildaParserWorker.postMessage({ type: 'parse-ilda', file, layerIndex, colIndex })} />
            <GeneratorPanel />
            <EffectPanel />
            <DacPanel dacs={dacs} onDacSelected={handleDacSelected} onDacsDiscovered={handleDacsDiscovered} />
			<SettingsPanel 
              effects={selectedClipEffects}
              assignedDacs={selectedClip?.assignedDacs || []}
              onRemoveDac={(dacIndex) => dispatch({ type: 'REMOVE_CLIP_DAC', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, dacIndex } })}
              audioFile={selectedClip?.audioFile}
              onAssignAudio={async () => {
                const filePath = await window.electronAPI.showAudioFileDialog();
                if (filePath) {
                    const fileName = filePath.split(/[\\/]/).pop();
                    dispatch({ type: 'SET_CLIP_AUDIO', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, audioFile: { path: filePath, name: fileName } } });
                }
              }}
              onRemoveAudio={() => dispatch({ type: 'REMOVE_CLIP_AUDIO', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex } })}
              audioInfo={getAudioInfo(selectedLayerIndex)}
              onParameterChange={handleEffectParameterChange}
              selectedLayerIndex={selectedLayerIndex}
              selectedColIndex={selectedColIndex}
              selectedGeneratorId={selectedGeneratorId}
              selectedGeneratorParams={selectedGeneratorParams}
              onGeneratorParameterChange={handleGeneratorParameterChange}
              enabledShortcuts={enabledShortcuts}
            />          </div>
        </div>
      </ErrorBoundary>
    </div>
    </ArtnetProvider>
    </MidiProvider>
  );
}
      
export default App;