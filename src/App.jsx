import React, { useReducer, useEffect, useCallback, useRef, useMemo, useState } from 'react';
import CompositionControls from './components/CompositionControls';
import ColumnHeader from './components/ColumnHeader';
import LayerControls from './components/LayerControls';
import Clip from './components/Clip';
import FileBrowser from './components/FileBrowser';
import GeneratorPanel from './components/GeneratorPanel';
import EffectPanel from './components/EffectPanel';
import DacPanel from './components/DacPanel';
import ClipSettingsPanel from './components/ClipSettingsPanel';
import LayerSettingsPanel from './components/LayerSettingsPanel'; // Add this
import NotificationPopup from './components/NotificationPopup';
import IldaPlayer from './components/IldaPlayer';
import WorldPreview from './components/WorldPreview';
import BPMControls from './components/BPMControls';
import TransportControls from './components/TransportControls';
import SettingsPanel from './components/SettingsPanel';
import GeneratorSettingsPanel from './components/GeneratorSettingsPanel';
import ShortcutsWindow from './components/ShortcutsWindow';
import RenameModal from './components/RenameModal';
import OutputSettingsWindow from './components/OutputSettingsWindow';
import AudioSettingsWindow from './components/AudioSettingsWindow';
import RelocateModal from './components/RelocateModal';
import Mappable from './components/Mappable';
import ErrorBoundary from './components/ErrorBoundary';
import { useIldaParserWorker } from './contexts/IldaParserWorkerContext';
import { useGeneratorWorker } from './contexts/GeneratorWorkerContext';
import { useAudioOutput } from './hooks/useAudioOutput'; // Add this
import { useAudio } from './contexts/AudioContext.jsx'; // Add this
import { MidiProvider, useMidi } from './contexts/MidiContext'; // Add this
import { ArtnetProvider, useArtnet } from './contexts/ArtnetContext'; // Add this
import { KeyboardProvider, useKeyboard } from './contexts/KeyboardContext'; // Add this
import MidiMappingOverlay from './components/MidiMappingOverlay'; // Add this
import GlobalQuickAssigns from './components/GlobalQuickAssigns'; // Add this
import { applyEffects, applyOutputProcessing, resolveParam } from './utils/effects';
import { optimizePoints } from './utils/optimizer';
import { effectDefinitions } from './utils/effectDefinitions';
import { sendNote } from './utils/midi';
import { generateCircle, generateSquare, generateLine, generateStar, generateText } from './utils/generators'; // Import generator functions

const generateId = () => Math.random().toString(36).substr(2, 9);

const MasterSpeedSlider = React.memo(({ playbackFps, onSpeedChange }) => {
  const handleDragStart = (e) => {
    e.dataTransfer.setData('application/x-truelazer-param', JSON.stringify({
        type: 'range',
        paramName: 'master_speed',
        targetType: 'global',
        label: 'SPEED',
        min: 1,
        max: 120,
        step: 1
    }));
  };

  return (
    <div className="master-speed-slider">
      <label htmlFor="masterSpeedRange" draggable onDragStart={handleDragStart}>{playbackFps} FPS</label>
      <Mappable id="master_speed">
          <input type="range" min="1" max="120" value={playbackFps} className="slider_hor" id="masterSpeedRange" onChange={(e) => onSpeedChange(parseInt(e.target.value))} />
      </Mappable>
    </div>
  );
});

const LaserOnOffButton = React.memo(({ isWorldOutputActive, onToggleWorldOutput }) => {
  const handleDragStart = (e) => {
    e.dataTransfer.setData('application/x-truelazer-param', JSON.stringify({
        type: 'toggle',
        paramName: 'laser_output',
        targetType: 'global',
        label: 'LASER'
    }));
  };

  return (
    <div className="container" draggable onDragStart={handleDragStart}>
      <Mappable id="laser_output">
          <input type="checkbox" checked={isWorldOutputActive} onChange={onToggleWorldOutput} />
      </Mappable>
    </div>
  );
});

const ensureArrayStructure = (arr, rows, cols, defaultValueFactory) => {
  if (!Array.isArray(arr) || arr.length !== rows) {
    return Array(rows).fill(null).map((_, r) => 
      Array(cols).fill(null).map((_, c) => defaultValueFactory(r, c))
    );
  }
  return arr.map((row, r) => {
    if (!Array.isArray(row) || row.length !== cols) {
      return Array(cols).fill(null).map((_, c) => defaultValueFactory(r, c));
    }
    return row;
  });
};

const getInitialState = (initialSettings) => ({
  columns: Array.from({ length: 8 }, (_, i) => `Col ${i + 1}`),
  layers: Array.from({ length: 5 }, (_, i) => `Layer ${i + 1}`),
  clipContents: ensureArrayStructure(initialSettings?.clipContents, 5, 8, () => ({ parsing: false })),
  clipNames: ensureArrayStructure(initialSettings?.clipNames, 5, 8, (r, c) => `Clip ${r + 1}-${c + 1}`),
  thumbnailFrameIndexes: Array(5).fill(null).map(() => Array(8).fill(0)),
  layerEffects: Array.from({ length: 5 }, () => []),
  layerAssignedDacs: initialSettings?.layerAssignedDacs ?? Array(5).fill([]),
  layerIntensities: Array(5).fill(1), // Add this
  layerAutopilots: Array(5).fill('off'), // Add layer autopilots
  layerBlackouts: Array(5).fill(false), // Add layer blackouts
  layerSolos: Array(5).fill(false), // Add layer solos
  masterIntensity: 1, // Add this
  globalBlackout: false, // Add global blackout
  selectedLayerIndex: null,
  selectedColIndex: null,
  notification: { message: '', visible: false },
  dacs: [],
  selectedDac: initialSettings?.dacAssignment?.selectedDac ?? initialSettings?.selectedDac ?? null,
  fileBrowserViewMode: 'list',
  layerUiStates: Array(6).fill({}),
  ildaFrames: [],
  selectedIldaWorkerId: null,
  selectedIldaTotalFrames: 0,
  bpm: initialSettings?.bpm ?? 120,
  showBeamEffect: initialSettings?.renderSettings?.showBeamEffect ?? true,
  beamAlpha: initialSettings?.renderSettings?.beamAlpha ?? 0.1,
  fadeAlpha: initialSettings?.renderSettings?.fadeAlpha ?? 0.13,
  playbackFps: initialSettings?.renderSettings?.playbackFps ?? 60,
  previewScanRate: initialSettings?.renderSettings?.previewScanRate ?? 1,
  beamRenderMode: initialSettings?.renderSettings?.beamRenderMode ?? 'both',
  worldShowBeamEffect: initialSettings?.renderSettings?.worldShowBeamEffect ?? true,
  worldBeamRenderMode: initialSettings?.renderSettings?.worldBeamRenderMode ?? 'both',
  activeClipIndexes: Array(5).fill(null),
  isPlaying: false,
  isStopped: true, // Add this
  isWorldOutputActive: false, // Controls whether frames are sent to DACs
  thumbnailRenderMode: initialSettings?.thumbnailRenderMode ?? 'still', // 'still' for static thumbnail, 'active' for live rendering
  theme: initialSettings?.theme ?? 'orange', // Add theme to state
  projectLoadTimestamp: null, // Add this to track project loads
  clipClipboard: null, // For copy/paste
  dacOutputSettings: initialSettings?.dacOutputSettings ?? {}, // Add dacOutputSettings to state
  quickAssigns: {
      knobs: Array(8).fill(null).map(() => ({ value: 0, label: null, link: null })),
      buttons: Array(8).fill(null).map(() => ({ value: false, label: null, link: null }))
  },
});

function reducer(state, action) {
  switch (action.type) {
    case 'SET_DAC_OUTPUT_SETTINGS': {
        return {
            ...state,
            dacOutputSettings: {
                ...state.dacOutputSettings,
                [action.payload.id]: action.payload.settings
            }
        };
    }
    case 'SET_COLUMNS': {
      return { ...state, columns: action.payload };
	}
    case 'SET_COLUMN_NAME': {
        const newColumns = [...state.columns];
        newColumns[action.payload.index] = action.payload.name;
        return { ...state, columns: newColumns };
    }
    case 'SET_LAYERS': {
      return { ...state, layers: action.payload };
	}
    case 'SET_LAYER_NAME': {
        const newLayers = [...state.layers];
        newLayers[action.payload.index] = action.payload.name;
        return { ...state, layers: newLayers };
    }
    case 'SET_CLIP_CONTENT': {
      const { layerIndex, colIndex, content } = action.payload;
      if (layerIndex === undefined || colIndex === undefined) return state;

      const newClipContents = [...state.clipContents];
      // Ensure the layer array exists
      if (!newClipContents[layerIndex]) {
          console.error(`Reducer Error: Layer array at index ${layerIndex} is undefined. Action:`, action);
          return state; // Return current state to prevent crash
      }
      // Create a new array for the specific layer to ensure immutability
      newClipContents[layerIndex] = [...newClipContents[layerIndex]];

      const existingClipContent = newClipContents[layerIndex][colIndex] || {};
      newClipContents[layerIndex][colIndex] = {
          ...existingClipContent, // Preserve existing properties like 'type', 'workerId', 'totalFrames', 'ildaFormat', 'fileName', 'filePath', 'effects'
          ...content, // Apply new content (which can include stillFrame and parsing status)
      };
      return { ...state, clipContents: newClipContents };
    }
    case 'SET_CLIP_NAME': {
        const { layerIndex, colIndex, name } = action.payload;
        if (layerIndex === undefined || colIndex === undefined) return state;
        
        const newClipNames = [...state.clipNames];
        if (newClipNames[layerIndex]) {
            newClipNames[layerIndex] = [...newClipNames[layerIndex]];
            newClipNames[layerIndex][colIndex] = name;
        }
        return { ...state, clipNames: newClipNames };
    }
    case 'SET_THUMBNAIL_FRAME_INDEX': {
        const newThumbnailFrameIndexes = [...state.thumbnailFrameIndexes];
        newThumbnailFrameIndexes[action.payload.layerIndex][action.payload.colIndex] = action.payload.index;
        return { ...state, thumbnailFrameIndexes: newThumbnailFrameIndexes };
    }
    case 'ADD_LAYER_EFFECT': {
        const newLayerEffects = [...state.layerEffects];
        const newEffectInstance = {
            ...action.payload.effect,
            instanceId: generateId(),
            params: { ...action.payload.effect.defaultParams }
        };
        newLayerEffects[action.payload.layerIndex].push(newEffectInstance);
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
          instanceId: generateId(),
          params: { ...action.payload.effect.defaultParams }
        };

        const updatedClip = {
            ...existingClip,
            effects: [...(existingClip.effects || []), newEffectInstance],
        };
        newClipContentsWithEffect[action.payload.layerIndex][action.payload.colIndex] = updatedClip;
        return { ...state, clipContents: newClipContentsWithEffect };
    }
    case 'SET_SELECTED_CLIP': {
        return { ...state, selectedLayerIndex: action.payload.layerIndex, selectedColIndex: action.payload.colIndex };
	}
    case 'SET_NOTIFICATION': {
        return { ...state, notification: action.payload };
	}
    case 'SET_ILDA_FRAMES': {// This might become deprecated or refactored later
        return { ...state, ildaFrames: action.payload };
	}
    case 'SET_SELECTED_ILDA_DATA': {// For ILDA files, or when a generator's frame is selected
        return { ...state, selectedIldaWorkerId: action.payload.workerId, selectedIldaTotalFrames: action.payload.totalFrames, selectedGeneratorId: action.payload.generatorId, selectedGeneratorParams: action.payload.generatorParams };
	}
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
    case 'SET_LAYER_AUTOPILOT': {
        const newLayerAutopilots = [...state.layerAutopilots];
        newLayerAutopilots[action.payload.layerIndex] = action.payload.mode;
        return { ...state, layerAutopilots: newLayerAutopilots };
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
    case 'SET_RENDER_SETTING': {
        return { ...state, [action.payload.setting]: action.payload.value };
	}
    case 'SET_FILE_BROWSER_VIEW_MODE': {
        return { ...state, fileBrowserViewMode: action.payload };
    }
    case 'UPDATE_CLIP_UI_STATE': {
        const { layerIndex, colIndex, uiState } = action.payload;
        const updatedClipContents = [...state.clipContents];
        updatedClipContents[layerIndex] = [...updatedClipContents[layerIndex]];
        const clipToUpdate = { ...updatedClipContents[layerIndex][colIndex] };
        if (clipToUpdate) {
            clipToUpdate.uiState = {
                ...(clipToUpdate.uiState || {}),
                ...uiState
            };
            updatedClipContents[layerIndex][colIndex] = clipToUpdate;
        }
        return { ...state, clipContents: updatedClipContents };
    }
    case 'UPDATE_LAYER_UI_STATE': {
        const { layerIndex, uiState } = action.payload;
        const newLayerUiStates = [...state.layerUiStates];
        newLayerUiStates[layerIndex] = {
            ...newLayerUiStates[layerIndex],
            ...uiState
        };
        return { ...state, layerUiStates: newLayerUiStates };
    }
    case 'REMOVE_CLIP_EFFECT': {
        const updatedClipContents = [...state.clipContents];
        updatedClipContents[action.payload.layerIndex] = [...updatedClipContents[action.payload.layerIndex]];
        const clipToUpdate = { ...updatedClipContents[action.payload.layerIndex][action.payload.colIndex] };
        if (clipToUpdate && clipToUpdate.effects) {
            const newEffects = [...clipToUpdate.effects];
            newEffects.splice(action.payload.effectIndex, 1);
            clipToUpdate.effects = newEffects;
            updatedClipContents[action.payload.layerIndex][action.payload.colIndex] = clipToUpdate;
        }
        return { ...state, clipContents: updatedClipContents };
    }
    case 'REORDER_CLIP_EFFECTS': {
        const { layerIndex, colIndex, oldIndex, newIndex } = action.payload;
        const updatedClipContents = [...state.clipContents];
        updatedClipContents[layerIndex] = [...updatedClipContents[layerIndex]];
        const clipToUpdate = { ...updatedClipContents[layerIndex][colIndex] };
        if (clipToUpdate && clipToUpdate.effects) {
            const newEffects = [...clipToUpdate.effects];
            const [movedEffect] = newEffects.splice(oldIndex, 1);
            newEffects.splice(newIndex, 0, movedEffect);
            clipToUpdate.effects = newEffects;
            updatedClipContents[layerIndex][colIndex] = clipToUpdate;
        }
        return { ...state, clipContents: updatedClipContents };
    }
    case 'REMOVE_LAYER_EFFECT': {
        const newLayerEffects = [...state.layerEffects];
        if (newLayerEffects[action.payload.layerIndex]) {
            newLayerEffects[action.payload.layerIndex] = [...newLayerEffects[action.payload.layerIndex]];
            newLayerEffects[action.payload.layerIndex].splice(action.payload.effectIndex, 1);
        }
        return { ...state, layerEffects: newLayerEffects };
    }
    case 'UPDATE_LAYER_EFFECT_PARAMETER': {
        const newLayerEffects = [...state.layerEffects];
        if (newLayerEffects[action.payload.layerIndex]) {
             newLayerEffects[action.payload.layerIndex] = [...newLayerEffects[action.payload.layerIndex]];
             const effectIndex = action.payload.effectIndex;
             if (newLayerEffects[action.payload.layerIndex][effectIndex]) {
                 const effect = { ...newLayerEffects[action.payload.layerIndex][effectIndex] };
                 effect.params = { ...effect.params, [action.payload.paramName]: action.payload.newValue };
                 newLayerEffects[action.payload.layerIndex][effectIndex] = effect;
             }
        }
        return { ...state, layerEffects: newLayerEffects };
    }
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
    case 'UPDATE_CLIP_PLAYBACK_SETTINGS': {
        const updatedClipContents = [...state.clipContents];
        updatedClipContents[action.payload.layerIndex] = [...updatedClipContents[action.payload.layerIndex]];
        const clipToUpdate = { ...updatedClipContents[action.payload.layerIndex][action.payload.colIndex] };
        if (clipToUpdate) {
            clipToUpdate.playbackSettings = {
                ...(clipToUpdate.playbackSettings || { mode: 'fps', duration: 1, beats: 8, speedMultiplier: 1 }),
                ...action.payload.settings
            };
            updatedClipContents[action.payload.layerIndex][action.payload.colIndex] = clipToUpdate;
        }
        return { ...state, clipContents: updatedClipContents };
    }
    case 'SET_CLIP_PARAM_SYNC': {
        const { layerIndex, colIndex, paramId, syncMode } = action.payload;
        const updatedClipContents = [...state.clipContents];
        updatedClipContents[layerIndex] = [...updatedClipContents[layerIndex]];
        const clipToUpdate = { ...updatedClipContents[layerIndex][colIndex] };
        if (clipToUpdate) {
            const currentSync = clipToUpdate.syncSettings || {};
            // Toggle syncMode: if same mode clicked again, turn off (null)
            const nextMode = currentSync[paramId] === syncMode ? null : syncMode;
            clipToUpdate.syncSettings = {
                ...currentSync,
                [paramId]: nextMode
            };
            updatedClipContents[layerIndex][colIndex] = clipToUpdate;
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
    case 'SET_DACS': {
      return { ...state, dacs: action.payload };
	}
    case 'SET_BPM': {
      return { ...state, bpm: action.payload };
	}
    case 'SET_SELECTED_DAC': {
      return { ...state, selectedDac: action.payload };
	}
    case 'SET_IS_PLAYING': {
      return { ...state, isPlaying: action.payload };
	}
    case 'SET_IS_STOPPED': {
      return { ...state, isStopped: action.payload };
	}
    case 'SET_WORLD_OUTPUT_ACTIVE': {
      return { ...state, isWorldOutputActive: action.payload };
	}
    case 'TOGGLE_WORLD_OUTPUT_ACTIVE': {
      return { ...state, isWorldOutputActive: !state.isWorldOutputActive };
	}
    case 'SET_CLIPBOARD': {
      return { ...state, clipClipboard: action.payload };
	}
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

      let currentAssignedDacs = existingClip.assignedDacs || [];
      
      const dacsToAdd = [];
      const cleanDac = (d) => {
          const { channels, allChannels, ...rest } = d;
          return rest;
      };

      if (action.payload.dac.allChannels && action.payload.dac.channels) {
          action.payload.dac.channels.forEach(ch => {
              if (!currentAssignedDacs.some(d => d.ip === action.payload.dac.ip && d.channel === ch.serviceID)) {
                  dacsToAdd.push({ ...cleanDac(action.payload.dac), channel: ch.serviceID, mirrorX: false, mirrorY: false });
              }
          });
      } else {
          const targetChannel = action.payload.dac.channel;
          if (targetChannel !== undefined && !currentAssignedDacs.some(d => d.ip === action.payload.dac.ip && d.channel === targetChannel)) {
              dacsToAdd.push({ ...cleanDac(action.payload.dac), channel: targetChannel, mirrorX: false, mirrorY: false });
          }
      }

      if (dacsToAdd.length === 0) return state;

      const updatedClip = {
          ...existingClip,
          assignedDacs: [...currentAssignedDacs, ...dacsToAdd],
      };
      newClipContentsWithDac[action.payload.layerIndex][action.payload.colIndex] = updatedClip;
      return { ...state, clipContents: newClipContentsWithDac };
    }
    case 'SET_LAYER_DAC': {
        const { layerIndex, dac } = action.payload;
        const newLayerAssignedDacs = [...state.layerAssignedDacs];
        const currentDacs = newLayerAssignedDacs[layerIndex] || [];
        
        let dacsToAdd = [];
        const cleanDac = (d) => {
            const { channels, allChannels, ...rest } = d;
            return rest;
        };
  
        if (dac.allChannels && dac.channels) {
            dac.channels.forEach(ch => {
                if (!currentDacs.some(d => d.ip === dac.ip && d.channel === ch.serviceID)) {
                    dacsToAdd.push({ ...cleanDac(dac), channel: ch.serviceID, mirrorX: false, mirrorY: false });
                }
            });
        } else {
            const targetChannel = dac.channel;
            if (targetChannel !== undefined && !currentDacs.some(d => d.ip === dac.ip && d.channel === targetChannel)) {
                dacsToAdd.push({ ...cleanDac(dac), channel: targetChannel, mirrorX: false, mirrorY: false });
            }
        }
  
        if (dacsToAdd.length === 0) return state;
  
        newLayerAssignedDacs[layerIndex] = [...currentDacs, ...dacsToAdd];
        return { ...state, layerAssignedDacs: newLayerAssignedDacs };
    }
    case 'TOGGLE_CLIP_DAC_MIRROR': {
        const { layerIndex, colIndex, dacIndex, axis } = action.payload;
        const newClipContents = [...state.clipContents];
        newClipContents[layerIndex] = [...newClipContents[layerIndex]];
        const existingClip = { ...newClipContents[layerIndex][colIndex] };
        if (existingClip && existingClip.assignedDacs) {
            const newAssignedDacs = [...existingClip.assignedDacs];
            const targetDac = { ...newAssignedDacs[dacIndex] };
            if (axis === 'x') targetDac.mirrorX = !targetDac.mirrorX;
            if (axis === 'y') targetDac.mirrorY = !targetDac.mirrorY;
            newAssignedDacs[dacIndex] = targetDac;
            existingClip.assignedDacs = newAssignedDacs;
            newClipContents[layerIndex][colIndex] = existingClip;
            return { ...state, clipContents: newClipContents };
        }
        return state;
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
    case 'TOGGLE_LAYER_DAC_MIRROR': {
        const { layerIndex, dacIndex, axis } = action.payload;
        const newLayerAssignedDacs = [...state.layerAssignedDacs];
        const layerDacs = newLayerAssignedDacs[layerIndex] ? [...newLayerAssignedDacs[layerIndex]] : [];
        
        if (layerDacs[dacIndex]) {
            const targetDac = { ...layerDacs[dacIndex] };
            if (axis === 'x') targetDac.mirrorX = !targetDac.mirrorX;
            if (axis === 'y') targetDac.mirrorY = !targetDac.mirrorY;
            layerDacs[dacIndex] = targetDac;
            newLayerAssignedDacs[layerIndex] = layerDacs;
            return { ...state, layerAssignedDacs: newLayerAssignedDacs };
        }
        return state;
    }
    case 'REMOVE_LAYER_DAC': {
        const { layerIndex, dacIndex } = action.payload;
        const newLayerAssignedDacs = [...state.layerAssignedDacs];
        if (newLayerAssignedDacs[layerIndex]) {
            const layerDacs = [...newLayerAssignedDacs[layerIndex]];
            layerDacs.splice(dacIndex, 1);
            newLayerAssignedDacs[layerIndex] = layerDacs;
            return { ...state, layerAssignedDacs: newLayerAssignedDacs };
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
                audioFile,
                audioVolume: existingClip.audioVolume !== undefined ? existingClip.audioVolume : 1.0
            };
            return { ...state, clipContents: newClipContents };
        }
        return state;
    }
    case 'SET_CLIP_AUDIO_VOLUME': {
        const newClipContents = [...state.clipContents];
        const { layerIndex, colIndex, volume } = action.payload;
        newClipContents[layerIndex] = [...newClipContents[layerIndex]];
        const existingClip = newClipContents[layerIndex][colIndex];
        if (existingClip) {
            newClipContents[layerIndex][colIndex] = {
                ...existingClip,
                audioVolume: volume
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
        if (newClipContents[layerIndex]) {
            newClipContents[layerIndex] = [...newClipContents[layerIndex]];
            const existingClip = newClipContents[layerIndex][colIndex] || {};
            newClipContents[layerIndex][colIndex] = { ...existingClip, parsing: status };
            return { ...state, clipContents: newClipContents };
        }
        return state;
    }
    case 'SET_BULK_PARSING_STATUS': {
        const newClipContents = [...state.clipContents];
        // Clone all layers first to ensure immutability if any changes occur
        // Optimization: only clone affected layers.
        const affectedLayers = new Set(action.payload.map(p => p.layerIndex));
        affectedLayers.forEach(lIdx => {
             if(newClipContents[lIdx]) newClipContents[lIdx] = [...newClipContents[lIdx]];
        });

        action.payload.forEach(({ layerIndex, colIndex, status }) => {
            if (newClipContents[layerIndex]) {
                 const existingClip = newClipContents[layerIndex][colIndex] || {};
                 newClipContents[layerIndex][colIndex] = { ...existingClip, parsing: status };
            }
        });
        return { ...state, clipContents: newClipContents };
    }
    case 'SET_THUMBNAIL_RENDER_MODE': {
      return { ...state, thumbnailRenderMode: action.payload };
	}
    case 'SET_CLIP_TRIGGER_STYLE': {
        const { layerIndex, colIndex, style } = action.payload;
        const newClipContents = [...state.clipContents];
        newClipContents[layerIndex] = [...newClipContents[layerIndex]];
        const existingClip = newClipContents[layerIndex][colIndex] || {};
        newClipContents[layerIndex][colIndex] = { ...existingClip, triggerStyle: style };
        return { ...state, clipContents: newClipContents };
    }
    case 'SET_THEME': {
        return { ...state, theme: action.payload };
	}
    case 'UPDATE_THUMBNAIL': {
        const { layerIndex, colIndex, frameIndex } = action.payload;
        const newThumbnailFrameIndexes = [...state.thumbnailFrameIndexes];
        newThumbnailFrameIndexes[layerIndex] = [...newThumbnailFrameIndexes[layerIndex]];
        newThumbnailFrameIndexes[layerIndex][colIndex] = frameIndex;
        return { ...state, thumbnailFrameIndexes: newThumbnailFrameIndexes };
    }
    case 'RESET_STATE': {
        return getInitialState({});
	}
    case 'LOAD_PROJECT': {
        const loadedState = { ...state, ...action.payload };
        // Validate structures
        loadedState.clipContents = ensureArrayStructure(loadedState.clipContents, 5, 8, () => ({ parsing: false }));
        loadedState.clipNames = ensureArrayStructure(loadedState.clipNames, 5, 8, (r, c) => `Clip ${r + 1}-${c + 1}`);
        
        // Invalidate workerIds for ILDA clips to trigger re-parsing
        loadedState.clipContents = loadedState.clipContents.map(layer =>
            layer.map(clip => {
                if (clip && clip.type === 'ilda') {
                    return { ...clip, workerId: null, parsing: false };
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
	}
    case 'LOAD_SETTINGS': {
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
            clipNames: action.payload.clipNames ? ensureArrayStructure(action.payload.clipNames, 5, 8, (r, c) => `Clip ${r + 1}-${c + 1}`) : state.clipNames,
            dacOutputSettings: action.payload.dacOutputSettings ?? state.dacOutputSettings,
            // sliderValue, dacAssignment (other than selectedDac), lastOpenedProject will be handled as full objects
            // These will likely require more complex merging or direct assignment based on their structure
        };
	}
    case 'ASSIGN_QUICK_CONTROL': {
        const { type, index, link } = action.payload; // type: 'knob' or 'button'
        const newAssigns = { 
            knobs: [...state.quickAssigns.knobs],
            buttons: [...state.quickAssigns.buttons]
        };
        const collection = type === 'knob' ? 'knobs' : 'buttons';
        newAssigns[collection][index] = {
            ...newAssigns[collection][index],
            label: link.paramName || link.paramId,
            link: link,
            // Store range data for scaling
            min: link.min,
            max: link.max,
            step: link.step
        };
        return { ...state, quickAssigns: newAssigns };
    }
    case 'UPDATE_QUICK_CONTROL': {
        const { type, index, value } = action.payload;
		const targetKey = type === 'button' ? 'buttons' : 'knobs';
        
        const newAssigns = { 
            knobs: [...state.quickAssigns.knobs],
            buttons: [...state.quickAssigns.buttons]
        };
        const collection = type === 'knob' ? 'knobs' : 'buttons';
        const control = newAssigns[collection][index];
        
        // Update the UI state of the control
        newAssigns[collection][index] = {
            ...control,
            value: value
        };
        
        let newState = { ...state, quickAssigns: newAssigns };
    
        // Update linked parameter if exists
        if (control.link) {
            const { layerIndex, colIndex, effectIndex, targetType } = control.link;
            const paramName = control.link.paramName || control.link.paramId;
            
            // Calculate target value
            let targetValue = value;
            if (type === 'knob' && control.min !== undefined && control.max !== undefined) {
                // Scale 0-1 to min-max
                targetValue = control.min + (value * (control.max - control.min));
                if (control.step) {
                    targetValue = Math.round(targetValue / control.step) * control.step;
                }
                // Fix floating point precision issues
                targetValue = parseFloat(targetValue.toFixed(5));
            }
            
            console.log(`Updating ${targetType} param ${paramName} to ${targetValue} (Link: L${layerIndex} C${colIndex} E${effectIndex})`);

                            if (targetType === 'layerEffect') {
                                const newLayerEffects = [...newState.layerEffects];
                                if (newLayerEffects[layerIndex]) {
                                    newLayerEffects[layerIndex] = [...newLayerEffects[layerIndex]];
                                    if (newLayerEffects[layerIndex][effectIndex]) {
                                        const effect = { ...newLayerEffects[layerIndex][effectIndex] };
                                        effect.params = { ...effect.params, [paramName]: targetValue };
                                        newLayerEffects[layerIndex][effectIndex] = effect;
                                        newState = { ...newState, layerEffects: newLayerEffects };
                                    }
                                }
                            } else if (targetType === 'global') {
                                if (paramName === 'master_intensity') newState = { ...newState, masterIntensity: targetValue };
                                else if (paramName === 'master_speed') newState = { ...newState, playbackFps: targetValue };
                            } else {
                                const updatedClipContents = [...newState.clipContents];                // Check if layer exists
                if (updatedClipContents[layerIndex]) {
                     updatedClipContents[layerIndex] = [...updatedClipContents[layerIndex]];
                     const clip = updatedClipContents[layerIndex][colIndex];
                     
                     if (clip) {
                        if (targetType === 'effect' && clip.effects && clip.effects[effectIndex]) {
                             const newEffects = [...clip.effects];
                             const effect = { ...newEffects[effectIndex] };
                             effect.params = { ...effect.params, [paramName]: targetValue };
                             newEffects[effectIndex] = effect;
                             updatedClipContents[layerIndex][colIndex] = { ...clip, effects: newEffects };
                        } else if (targetType === 'generator') {
                             updatedClipContents[layerIndex][colIndex] = {
                                 ...clip,
                                 currentParams: { ...clip.currentParams, [paramName]: targetValue }
                             };
                        }
                     }
                     newState.clipContents = updatedClipContents;
                }
            }
        }
        return newState;
    }
    case 'TOGGLE_QUICK_BUTTON': {
        const { index } = action.payload;
        const currentVal = state.quickAssigns.buttons[index].value;
        const newValue = !currentVal;
        
        const newAssigns = { 
            ...state.quickAssigns,
            buttons: [...state.quickAssigns.buttons] // Create copy of array
        };
        newAssigns.buttons[index] = {
            ...newAssigns.buttons[index],
            value: newValue
        };
        
        let newState = { ...state, quickAssigns: newAssigns };
    
        const control = newAssigns.buttons[index];
        if (control.link) {
            const { layerIndex, colIndex, effectIndex, paramName, targetType } = control.link;
            if (targetType === 'global') {
				if (paramName === 'blackout') {
					newState.globalBlackout = newValue;
				} else if (paramName === 'laser_output') {
					newState.isWorldOutputActive = newValue;
				}
			}	
            if (targetType === 'layer') {
                if (paramName === 'blackout') {
                    const newLayerBlackouts = [...newState.layerBlackouts];
                    newLayerBlackouts[layerIndex] = newValue;
                    newState = { ...newState, layerBlackouts: newLayerBlackouts };
                } else if (paramName === 'solo') {
                    const newLayerSolos = [...newState.layerSolos];
                    if (newValue) {
                        newLayerSolos.fill(false);
                        newLayerSolos[layerIndex] = true;
                    } else {
                        newLayerSolos[layerIndex] = false;
                    }
                    newState = { ...newState, layerSolos: newLayerSolos };
                } else if (paramName === 'clear') {
                    // 'clear' is usually an action, not a state.
                    // But if it's a toggle button, what does 'on' mean?
                    // Clear is usually momentary.
                    // If we assigned it to a button, we probably want it to trigger on True?
                    if (newValue) {
                       // We can't easily trigger side-effect here (clearing clips) because it involves complex state changes
                       // But we can call CLEAR_CLIP or DEACTIVATE_LAYER_CLIPS logic directly?
                       // Since we are in reducer, we can modify state.
                       const deactivatedActiveClipIndexes = [...newState.activeClipIndexes];
                       deactivatedActiveClipIndexes[layerIndex] = null;
                       newState = { ...newState, activeClipIndexes: deactivatedActiveClipIndexes };
                       
                       // Reset button to false immediately for momentary effect?
                       newAssigns.buttons[index].value = false;
                       newState.quickAssigns = newAssigns;
                    }
                } else if (paramName === 'autopilot') {
                    // Assuming value maps to some autopilot mode? Or just toggle on/off?
                    // Autopilot is 'off', 'forward', 'random'.
                    // Toggle could cycle or switch between off/forward.
                    // For now, let's assume it switches off <-> forward
                    const newLayerAutopilots = [...newState.layerAutopilots];
                    newLayerAutopilots[layerIndex] = newValue ? 'forward' : 'off';
                    newState = { ...newState, layerAutopilots: newLayerAutopilots };
                }
            } else {
                const updatedClipContents = [...newState.clipContents];
                if (updatedClipContents[layerIndex]) {
                     updatedClipContents[layerIndex] = [...updatedClipContents[layerIndex]];
                     const clip = updatedClipContents[layerIndex][colIndex];
                     
                     if (clip) {
                        if (targetType === 'effect' && clip.effects && clip.effects[effectIndex]) {
                             const newEffects = [...clip.effects];
                             const effect = { ...newEffects[effectIndex] };
                             effect.params = { ...effect.params, [paramName]: newValue };
                             newEffects[effectIndex] = effect;
                             updatedClipContents[layerIndex][colIndex] = { ...clip, effects: newEffects };
                        } else if (targetType === 'generator') {
                             updatedClipContents[layerIndex][colIndex] = {
                                 ...clip,
                                 currentParams: { ...clip.currentParams, [paramName]: newValue }
                             };
                        }
                     }
                     newState.clipContents = updatedClipContents;
                }
            }
        }
        return newState;
    }
    case 'UPDATE_CLIP_FILE_PATH': {
        const { oldPath, newPath } = action.payload;
        console.log(`Reducer: Updating clip path from ${oldPath} to ${newPath}`);
        const newClipContents = state.clipContents.map(layer => 
            layer.map(clip => {
                let updatedClip = clip;
                if (clip && clip.filePath === oldPath) {
                    updatedClip = { ...updatedClip, filePath: newPath, parsingFailed: false };
                }
                if (clip && clip.audioFile && clip.audioFile.path === oldPath) {
                    updatedClip = { 
                        ...updatedClip, 
                        audioFile: { ...clip.audioFile, path: newPath } 
                    };
                }
                return updatedClip;
            })
        );
        return { ...state, clipContents: newClipContents };
    }
    case 'SET_CLIP_PARSING_FAILED': {
        const { layerIndex, colIndex, failed } = action.payload;
        const newClipContents = [...state.clipContents];
        if (newClipContents[layerIndex]) {
            newClipContents[layerIndex] = [...newClipContents[layerIndex]];
            const existingClip = newClipContents[layerIndex][colIndex];
            if (existingClip) {
                newClipContents[layerIndex][colIndex] = { ...existingClip, parsingFailed: failed };
            }
        }
        return { ...state, clipContents: newClipContents };
    }
    default: 
	return state;
  }
}

const THEME_COLORS = {
    'orange': { full: 60, dim: 10 }, // Orange
    'yellow': { full: 74, dim: 15 }, // Yellow
    'cyan': { full: 36, dim: 35 }, // Cyan
    'light-blue': { full: 41, dim: 43 }, // Light-Blue
    'blue': { full: 45, dim: 47 }, // Blue
    'magenta': { full: 53, dim: 55 }, // Magenta
    'red': { full: 5, dim: 7 }, // Red
    'green': { full: 21, dim: 23 }, // Green
    'white': { full: 3, dim: 1 }, // White/Gray
};

const MidiFeedbackHandler = ({ isPlaying, globalBlackout, layerBlackouts, layerSolos, isWorldOutputActive, clipContents, activeClipIndexes, theme, bpm, quickAssigns }) => {
  const { sendFeedback, mappings, selectedMidiInputId, midiInitialized } = useMidi();

  // Metronome BPM Blink
  useEffect(() => {
    if (!selectedMidiInputId || !midiInitialized || !isPlaying) {
        // Ensure LED is off when not playing
        if (midiInitialized && selectedMidiInputId) {
            // Note 90 is F#6 (or F#7 depending on octaving) - identifier "F#6"
            sendNote(selectedMidiInputId, "F#6", 0, 1);
        }
        return;
    }

    let isOn = false;
    const beatInterval = 60000 / (bpm || 120);

    const interval = setInterval(() => {
        isOn = !isOn;
        // Sending directly via utils/midi to ensure we hit the right button regardless of mapping
        sendNote(selectedMidiInputId, "F#6", isOn ? 127 : 0, 1);
    }, beatInterval / 2); // Toggle twice per beat for a pulse

    return () => {
        clearInterval(interval);
        sendNote(selectedMidiInputId, "F#6", 0, 1);
    };
  }, [isPlaying, bpm, selectedMidiInputId, midiInitialized]);

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
                  const triggerStyle = clip?.triggerStyle || 'normal';

                  let velocity = 0; // Off
                  let overrideChannel = null;

                  if (isActive) {
                      velocity = colors.full; // Full brightness / Active color
                      // If trigger style is toggle, use APC40's pulsing feature
                      // Pulsing is triggered by sending Note On on channels 7-10
                      // Channel 10 = 1/2 pulsing (Slow)
                      if (triggerStyle === 'toggle') {
                          overrideChannel = 10;
                      }
                  } else if (hasContent) {
                      velocity = colors.dim; // Dimmed / Content color
                  }

                  sendFeedback(controlId, velocity, overrideChannel);
              }
          });
      });
  }, [clipContents, activeClipIndexes, theme, mappings, sendFeedback]);

  // Quick Assigns Feedback
  useEffect(() => {
      if (!quickAssigns) return;
      const colors = THEME_COLORS[theme] || THEME_COLORS['orange'];
      quickAssigns.buttons.forEach((btn, index) => {
          sendFeedback(`quick_btn_${index}`, btn.value ? colors.full : 0);
      });
  }, [quickAssigns, theme, sendFeedback]);

  return null;
};

const generateThumbnail = async (frame, effects, layerIndex, colIndex) => {
    // Basic validation
    if (!frame || !frame.points) return null;

    // Apply effects to the frame for the thumbnail
    // We pass a minimal context since we are generating a static thumbnail
    let processedFrame = frame;
    try {
        if (effects && effects.length > 0) {
             processedFrame = applyEffects(frame, effects, { 
                progress: 0, 
                time: 0, 
                effectStates: {}, 
                assignedDacs: [] 
            });
        }
    } catch (e) {
        console.warn("Failed to apply effects for thumbnail:", e);
    }

    const width = 128;
    const height = 128;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Fill background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const points = processedFrame.points;
    const isTyped = processedFrame.isTypedArray || (points instanceof Float32Array);
    const numPoints = isTyped ? (points.length / 8) : points.length;

    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    
    let lastX = null;
    let lastY = null;

    for (let i = 0; i < numPoints; i++) {
        let x, y, r, g, b, blanking;
        if (isTyped) {
            x = points[i*8];
            y = points[i*8+1];
            r = points[i*8+3];
            g = points[i*8+4];
            b = points[i*8+5];
            blanking = points[i*8+6] > 0.5;
        } else {
            const p = points[i];
            x = p.x;
            y = p.y;
            r = p.r;
            g = p.g;
            b = p.b;
            blanking = p.blanking;
        }

        // Map Normalized Coordinates (-1 to 1) to Canvas (0 to width/height)
        // Y is inverted in ILDA relative to Canvas (usually +Y is up, Canvas +Y is down)
        const screenX = (x + 1) * 0.5 * width;
        const screenY = (1 - (y + 1) * 0.5) * height;

        if (!blanking) {
            if (lastX !== null) {
                ctx.beginPath();
                ctx.moveTo(lastX, lastY);
                ctx.lineTo(screenX, screenY);
                
                // Color
                const ir = Math.floor(Math.max(0, Math.min(1, r)) * 255);
                const ig = Math.floor(Math.max(0, Math.min(1, g)) * 255);
                const ib = Math.floor(Math.max(0, Math.min(1, b)) * 255);
                
                ctx.strokeStyle = `rgb(${ir},${ig},${ib})`;
                ctx.stroke();
            }
        }

        lastX = screenX;
        lastY = screenY;
    }

    // Convert to Blob and then ArrayBuffer
    try {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const arrayBuffer = await blob.arrayBuffer();

        if (window.electronAPI && window.electronAPI.saveThumbnail) {
             // Deterministic filename based on slot
             const filename = `thumb_L${layerIndex}_C${colIndex}.png`;
             return await window.electronAPI.saveThumbnail(arrayBuffer, filename);
        }
    } catch (e) {
        console.error("Error generating/saving thumbnail:", e);
    }
    
    return null;
};

const StatsDisplay = React.memo(({ type, previewFrameCountRef, totalPointsSentRef, activeChannelsCountRef, lastStatUpdateTimeRef }) => {
    const [stats, setStats] = useState({ cpu: '0.0', ram: '0', fps: 0, pps: 0, avgPps: 0 });

    useEffect(() => {
        // IPC Listener for System Stats (CPU/RAM)
        const unsub = window.electronAPI?.onSystemStats((systemData) => {
            setStats(prev => ({ ...prev, ...systemData }));
        });

        // ONLY the performance instance calculates FPS/PPS and resets counters.
        // If we had two intervals resetting the same refs, they would fight and show 0.
        let interval;
        if (type === 'performance' && lastStatUpdateTimeRef && previewFrameCountRef && totalPointsSentRef && activeChannelsCountRef) {
            interval = setInterval(() => {
                const now = performance.now();
                const elapsed = (now - (lastStatUpdateTimeRef.current || 0)) / 1000;
                
                if (elapsed > 0) {
                    const currentFps = Math.round((previewFrameCountRef.current || 0) / elapsed);
                    const totalPps = Math.round((totalPointsSentRef.current || 0) / elapsed);
                    const avgPps = (activeChannelsCountRef.current || 0) > 0 ? Math.round(totalPps / activeChannelsCountRef.current) : 0;
                    
                    setStats(prev => ({ ...prev, fps: currentFps, pps: totalPps, avgPps: avgPps }));
                    
                    // Reset shared counters for the next second
                    previewFrameCountRef.current = 0;
                    totalPointsSentRef.current = 0;
                    lastStatUpdateTimeRef.current = now;
                }
            }, 1000);
        }

        return () => {
            if (unsub) unsub();
            if (interval) clearInterval(interval);
        };
    }, [type, previewFrameCountRef, totalPointsSentRef, activeChannelsCountRef, lastStatUpdateTimeRef]);

    if (type === 'system') {
        return (
            <div className="systemStats">
                <p className="sysStats">CPU: {stats.cpu}%</p><p className="sysStats">RAM: {stats.ram}MB</p>
            </div>
        );
    }

    return (
        <div className="performanceStats">
            <p className="perfStats">FPS: {stats.fps}</p><p className="perfStats">AnimPPS: {stats.avgPps} (Avg)</p>
        </div>
    );
});

const SystemMonitor = React.memo(({
	playbackFps,previewScanRate,previewFrameCountRef,totalPointsSentRef,activeChannelsCountRef,lastStatUpdateTimeRef
}) => {
	return (
		<div className="system-monitor-grid">
			<StatsDisplay 
				type="performance" 
				previewFrameCountRef={previewFrameCountRef}
				totalPointsSentRef={totalPointsSentRef}
				activeChannelsCountRef={activeChannelsCountRef}
				lastStatUpdateTimeRef={lastStatUpdateTimeRef}
			/>
			<StatsDisplay 
				type="system" 
				previewFrameCountRef={previewFrameCountRef}
				totalPointsSentRef={totalPointsSentRef}
				activeChannelsCountRef={activeChannelsCountRef}
				lastStatUpdateTimeRef={lastStatUpdateTimeRef}
			/>
		</div>
	);
});
		
const SidePanelContainer = React.memo(({ 
    clipContents, activeClipIndexes, layerEffects, bpm, playbackFps, 
    selectedLayerIndex, selectedColIndex, liveFramesRef, progressRef, 
    selectedDac, liveDacOutputSettingsRef, dacOutputSettings, 
    getAudioInfo, fftLevels, getFftLevels, effectStatesRef, clipActivationTimesRef,
    showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode,
    worldShowBeamEffect, worldBeamRenderMode, masterIntensity, layerIntensities, globalBlackout, layerSolos, layerBlackouts,
    handleToggleBeamEffect, handleCycleDisplayMode,
    previewFrameCountRef, totalPointsSentRef, activeChannelsCountRef, lastStatUpdateTimeRef,
    liveClipContentsRef
}) => {
    const [tick, setTick] = useState(0);
    const lastPreviewTimeRef = useRef(0);
    const previewTimeRef = useRef(performance.now());
    const previewInterval = 1000 / 70; // Target >60Hz to reliably catch every 60Hz VSync frame

    useEffect(() => {
        let rafId;
        const loop = (timestamp) => {
            if (timestamp - lastPreviewTimeRef.current > previewInterval) {
                previewFrameCountRef.current++;
                previewTimeRef.current = performance.now();
                setTick(t => t + 1);
                lastPreviewTimeRef.current = timestamp;
            }
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
    }, [previewInterval, previewFrameCountRef]);

    // DERIVED PREVIEW DATA - Use Live Ref for immediate feedback
    const clipSource = liveClipContentsRef?.current || clipContents;
    const selectedClip = selectedLayerIndex !== null && selectedColIndex !== null ? clipSource[selectedLayerIndex][selectedColIndex] : null;
    const targetPreviewWorkerId = selectedColIndex !== null 
        ? (selectedClip?.type === 'ilda' ? selectedClip?.workerId : `generator-${selectedLayerIndex}-${selectedColIndex}`)
        : (selectedLayerIndex !== null ? (activeClipIndexes[selectedLayerIndex] !== null ? (clipSource[selectedLayerIndex][activeClipIndexes[selectedLayerIndex]]?.type === 'ilda' ? clipSource[selectedLayerIndex][activeClipIndexes[selectedLayerIndex]]?.workerId : `generator-${selectedLayerIndex}-${activeClipIndexes[selectedLayerIndex]}`) : null) : null);

    const selectedClipFrame = targetPreviewWorkerId ? liveFramesRef.current[targetPreviewWorkerId] : null;
    const selectedClipProgress = targetPreviewWorkerId ? (progressRef.current[targetPreviewWorkerId] || 0) : 0;

    let selectedClipEffects = [];
    let selectedClipFinalIntensity = 1;

    if (selectedLayerIndex !== null) {
        const lEffects = layerEffects[selectedLayerIndex] || [];
        if (selectedColIndex !== null) {
            const clipEffects = selectedClip?.effects || [];
            selectedClipEffects = [...clipEffects, ...lEffects];
        } else {
             const activeCol = activeClipIndexes[selectedLayerIndex];
             if (activeCol !== null) {
                 const clipEffects = clipSource[selectedLayerIndex][activeCol]?.effects || [];
                 selectedClipEffects = [...clipEffects, ...lEffects];
             } else {
                 selectedClipEffects = lEffects;
             }
        }

        const isAnySolo = layerSolos.some(s => s);
        let effIntensity = layerIntensities[selectedLayerIndex];
        if (globalBlackout) effIntensity = 0;
        else if (isAnySolo) effIntensity = layerSolos[selectedLayerIndex] ? (layerBlackouts[selectedLayerIndex] ? 0 : effIntensity) : 0;
        else if (layerBlackouts[selectedLayerIndex]) effIntensity = 0;
        selectedClipFinalIntensity = effIntensity * masterIntensity;
    }

    const worldFrames = useMemo(() => {
        const frames = {};
        activeClipIndexes.forEach((colIndex, layerIndex) => {
          if (colIndex !== null) {
            const clip = clipSource[layerIndex][colIndex];
            if (clip) {
              let workerId = clip.type === 'ilda' ? clip.workerId : `generator-${layerIndex}-${colIndex}`;
              if (workerId && liveFramesRef.current[workerId]) {
                frames[workerId] = {
                  frame: liveFramesRef.current[workerId],
                  effects: [...(clip.effects || []), ...(layerEffects[layerIndex] || [])],
                  layerIndex,
                  syncSettings: clip.syncSettings || {},
                  bpm: bpm,
                  clipDuration: (() => {
                      const pb = clip.playbackSettings || {};
                      if (pb.mode === 'timeline') return pb.duration || 1;
                      if (pb.mode === 'bpm') return ((pb.beats || 8) * 60) / (bpm || 120);
                      return (clip.totalFrames || 30) / (clip.fps || playbackFps || 30);
                  })(),
                  progress: progressRef.current[workerId] || 0,
                  effectStates: effectStatesRef.current,
                  clipActivationTime: clipActivationTimesRef.current[layerIndex] || 0
                };
              }
            }
          }
        });
        return frames;
    }, [activeClipIndexes, clipSource, tick, bpm, layerEffects, playbackFps, liveFramesRef, progressRef, effectStatesRef, clipActivationTimesRef]);

    const effectiveLayerIntensities = useMemo(() => {
        const isAnySolo = layerSolos.some(s => s);
        return layerIntensities.map((intensity, index) => {
            if (globalBlackout) return 0;
            if (isAnySolo) return layerSolos[index] ? (layerBlackouts[index] ? 0 : intensity) : 0;
            return layerBlackouts[index] ? 0 : intensity;
        });
    }, [layerIntensities, layerBlackouts, layerSolos, globalBlackout]);

    return (
		<div className="side-panel">
			<IldaPlayer
				frame={selectedClipFrame}
				effects={selectedClipEffects}
				showBeamEffect={showBeamEffect}
				beamAlpha={beamAlpha}
				fadeAlpha={fadeAlpha}
				previewScanRate={previewScanRate}
				beamRenderMode={beamRenderMode}
				intensity={selectedClipFinalIntensity}
				syncSettings={selectedClip?.syncSettings}
				bpm={bpm}
				clipDuration={(() => {
					const pb = selectedClip?.playbackSettings || {};
					if (pb.mode === 'timeline') return pb.duration || 1;
					if (pb.mode === 'bpm') return ((pb.beats || 8) * 60) / (bpm || 120);
					return (selectedClip?.totalFrames || 30) / (selectedClip?.fps || playbackFps || 30);
				})()}
				progress={selectedClipProgress}
				previewTime={previewTimeRef.current}
				fftLevels={getFftLevels ? getFftLevels() : fftLevels}
				effectStates={effectStatesRef.current}
				clipActivationTime={selectedLayerIndex !== null ? (clipActivationTimesRef.current[selectedLayerIndex] || 0) : 0}
				onToggleBeamEffect={() => handleToggleBeamEffect('clip')}
				onCycleDisplayMode={() => handleCycleDisplayMode('clip')}
			/>
			<WorldPreview
				activeFrames={worldFrames}
				showBeamEffect={worldShowBeamEffect}
				beamAlpha={beamAlpha}
				fadeAlpha={fadeAlpha}
				previewScanRate={previewScanRate}
				beamRenderMode={worldBeamRenderMode}
				layerIntensities={effectiveLayerIntensities}
				masterIntensity={masterIntensity}
				dacSettings={selectedDac ? (liveDacOutputSettingsRef.current ? liveDacOutputSettingsRef.current[`${selectedDac.ip}:${selectedDac.channel}`] : dacOutputSettings[`${selectedDac.ip}:${selectedDac.channel}`]) : null}
				previewTime={previewTimeRef.current}
				fftLevels={getFftLevels ? getFftLevels() : fftLevels}
				onToggleBeamEffect={() => handleToggleBeamEffect('world')}
				onCycleDisplayMode={() => handleCycleDisplayMode('world')}
			/>
		</div>	
	)
});



function App() {
  const ildaParserWorker = useIldaParserWorker();
    const generatorWorker = useGeneratorWorker();
    const uiGeneratorWorkerRef = useRef(null);
    const { fftLevels, getFftLevels } = useAudio() || {};

    useEffect(() => {
        const worker = new Worker(new URL('./utils/ui-generators.worker.js', import.meta.url), { type: 'module' });
        uiGeneratorWorkerRef.current = worker;

        const handleUiMessage = (e) => {
            if (e.data.browserFile) return;

            // Handle processing queue
            if (e.data.layerIndex !== undefined && e.data.colIndex !== undefined) {
                const clipKey = `${e.data.layerIndex}-${e.data.colIndex}`;
                generatorProcessingMap.current.set(clipKey, false); // Mark free
                
                // Check for pending
                if (generatorPendingMap.current.has(clipKey)) {
                    const { message, transferables } = generatorPendingMap.current.get(clipKey);
                    generatorPendingMap.current.delete(clipKey);
                    
                    // Send pending request
                    console.log(`[App.jsx] UI Generator ${clipKey} free, processing pending seq ${message.seq}`);
                    generatorProcessingMap.current.set(clipKey, true);
                    worker.postMessage(message, transferables);
                }
            }

            if (e.data.success) {
                const { layerIndex, colIndex, frames, generatorDefinition, currentParams, isLive, isAutoUpdate, seq } = e.data;

                if (layerIndex === undefined || colIndex === undefined) return;

                // Discard out-of-order responses for non-live updates
                if (seq !== undefined) {
                    if (seq < latestProcessedSeqRef.current) return;
                    latestProcessedSeqRef.current = seq;
                }

                // Update liveFrames ref
                const generatorWorkerId = `generator-${layerIndex}-${colIndex}`;
                liveFramesRef.current[generatorWorkerId] = frames[0];

                // Only dispatch to state if it's NOT a live frame update (i.e., it's a parameter change)
                // AND if it's NOT an automated update (prevents 60fps state updates during animation)
                if (!isLive && !isAutoUpdate) {
                    const existingClip = clipContentsRef.current[layerIndex][colIndex] || {};
                    const newClipContent = {
                        ...existingClip,
                        type: 'generator',
                        generatorDefinition,
                        frames,
                        currentParams,
                        playbackSettings: existingClip.playbackSettings || {
                            mode: 'fps',
                            duration: 5,
                            beats: 8,
                            speedMultiplier: 1
                        },
                    };
                    
                    dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: newClipContent } });

                    const currentName = clipNamesRef.current[layerIndex][colIndex];
                    const defaultPattern = `Clip ${layerIndex + 1}-${colIndex + 1}`;
                    if (currentName === defaultPattern) {
                        dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: generatorDefinition.name } });
                    }
                }
            } else {
                showNotification(`UI Generator error: ${e.data.error}`);
            }
        };

        worker.addEventListener('message', handleUiMessage);

        return () => {
            worker.removeEventListener('message', handleUiMessage);
            worker.terminate();
        };
    }, []);
  
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
    getAudioInfo,
    setClipVolume
  } = useAudioOutput(); // Initialize hook
  const initializedChannels = useRef(new Set());
  const ildaPlayerCurrentFrameIndex = useRef(0);

  const liveFramesRef = useRef({});
  const effectStatesRef = useRef(new Map()); // Add effectStatesRef
  const progressRef = useRef({}); // New ref for fine-grained progress
  const clipActivationTimesRef = useRef({});

  const lastFrameFetchTimeRef = useRef({});
  const frameIndexesRef = useRef({});

  const [initialSettings, setInitialSettings] = useState(null);
  const [initialSettingsLoaded, setInitialSettingsLoaded] = useState(false);
  const [showShortcutsWindow, setShowShortcutsWindow] = useState(false);
  const [enabledShortcuts, setEnabledShortcuts] = useState({ midi: false, artnet: false, osc: false, keyboard: false });
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showOutputSettingsWindow, setShowOutputSettingsWindow] = useState(false);
  const [showAudioSettingsWindow, setShowAudioSettingsWindow] = useState(false);
  const [showFftSettingsWindow, setShowFftSettingsWindow] = useState(false);
  const [renameModalConfig, setRenameModalConfig] = useState({ title: '', initialValue: '', onSave: () => {} });
  const [activeBottomTab_1, setActiveBottomTab_1] = useState('files');
  const [activeBottomTab_2, setActiveBottomTab_2] = useState('clip');
  const [missingFiles, setMissingFiles] = useState([]);

  // Refs for performance tracking
  const previewFrameCountRef = useRef(0);
  const totalPointsSentRef = useRef(0);
  const activeChannelsCountRef = useRef(0);
  const lastStatUpdateTimeRef = useRef(performance.now());

  const [state, dispatch] = useReducer(reducer, getInitialState(initialSettingsLoaded ? initialSettings : {}));
  
  const debounceTimersRef = useRef(new Map());
  const debouncedDispatch = useCallback((id, action, delay = 30) => {
      if (debounceTimersRef.current.has(id)) {
          clearTimeout(debounceTimersRef.current.get(id));
      }
      const timer = setTimeout(() => {
          dispatch(action);
          debounceTimersRef.current.delete(id);
      }, delay);
      debounceTimersRef.current.set(id, timer);
  }, []);

  const {
    columns,
    layers,
    clipContents,
    clipNames,
    thumbnailFrameIndexes,
    layerEffects,
    layerAssignedDacs,
    layerIntensities,
    layerAutopilots, // Add layer autopilots
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
    worldShowBeamEffect,
    worldBeamRenderMode,
    activeClipIndexes,
    isPlaying,
    isWorldOutputActive,
    selectedGeneratorId,
    selectedGeneratorParams,
    thumbnailRenderMode, // Add this
    theme,
    dacOutputSettings,
  } = state;

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
                    syncSettings: clip.syncSettings || {},
                    fps: clip.fps || null
                };
            } else if (clip.type === 'generator' && clip.frames && clip.generatorDefinition) {
                workerId = `generator-${layerIndex}-${activeColIndex}`;
                stillFrame = clip.stillFrame || clip.frames?.[0] || null;
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
                    syncSettings: clip.syncSettings || {},
                    fps: clip.fps || null
                };
            }
        }
    }
    return null;
  }).filter(Boolean), [layers, activeClipIndexes, clipContents]);

      const clipContentsRef = useRef(clipContents);

      const liveClipContentsRef = useRef(null); 

      const hasPendingClipUpdate = useRef(false); // Flag to prevent overwriting live ref with stale state during interaction

    

      const liveDacOutputSettingsRef = useRef(null);

      const hasPendingDacUpdate = useRef(false);

    

      useEffect(() => {

          if (clipContents) {

              liveClipContentsRef.current = structuredClone(clipContents);

          }

      }, []); // Only on mount, subsequent updates handled by specific effect

    

      useEffect(() => {

          if (dacOutputSettings) {

              liveDacOutputSettingsRef.current = structuredClone(dacOutputSettings);

          }

      }, []); // Only on mount

    

      // Refs for real-time access in animation loop

      const layerIntensitiesRef = useRef(layerIntensities);

    const layerAutopilotsRef = useRef(layerAutopilots);

    const layerEffectsRef = useRef(layerEffects); // Update this

    const masterIntensityRef = useRef(masterIntensity);

    const layerBlackoutsRef = useRef(layerBlackouts);

    const layerSolosRef = useRef(layerSolos);

    const globalBlackoutRef = useRef(globalBlackout);
    const isPlayingRef = useRef(isPlaying);
    const isWorldOutputActiveRef = useRef(isWorldOutputActive);
    const selectedDacRef = useRef(selectedDac);
    const bpmRef = useRef(state.bpm);
    const selectedLayerIndexRef = useRef(selectedLayerIndex);
    const selectedColIndexRef = useRef(selectedColIndex);
    const getAudioInfoRef = useRef(getAudioInfo);

    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
    useEffect(() => { isWorldOutputActiveRef.current = isWorldOutputActive; }, [isWorldOutputActive]);
    useEffect(() => { selectedDacRef.current = selectedDac; }, [selectedDac]);
    useEffect(() => { bpmRef.current = state.bpm; }, [state.bpm]);
    useEffect(() => { selectedLayerIndexRef.current = selectedLayerIndex; }, [selectedLayerIndex]);
    useEffect(() => { selectedColIndexRef.current = selectedColIndex; }, [selectedColIndex]);
    useEffect(() => { getAudioInfoRef.current = getAudioInfo; }, [getAudioInfo]);

    const playbackFpsRef = useRef(playbackFps);
    useEffect(() => { playbackFpsRef.current = playbackFps; }, [playbackFps]);

    const dacOutputSettingsRef = useRef(dacOutputSettings);

    const dacsRef = useRef(dacs);

    const activeClipsDataRef = useRef([]);

    // const clipContentsRef = useRef(clipContents); // Removed, handled above with live logic

    const activeClipIndexesRef = useRef(activeClipIndexes);
    const layerAssignedDacsRef = useRef(layerAssignedDacs);

    const clipNamesRef = useRef(clipNames);

    const selectedIldaWorkerIdRef = useRef(selectedIldaWorkerId);

    const selectedIldaTotalFramesRef = useRef(selectedIldaTotalFrames);

    const previousProgressRef = useRef({});

    const prevGeneratorParamsRef = useRef(new Map());

    const prevWorkerIdsRef = useRef(new Map()); // Add this

        const lastNdiSourceNameRef = useRef(null); // Ref to track NDI source name across renders
    
        const accumulatedTimeRef = useRef({}); // Add accumulatedTimeRef
        
        const hoveredClipRef = useRef(null); // { layerIndex, colIndex } or null
    
        const generatorRequestSeqRef = useRef(0); // Track latest request ID
            const latestProcessedSeqRef = useRef(0); // Track latest processed response ID        
            const generatorProcessingMap = useRef(new Map()); // key: "layer-col", val: boolean
            const generatorPendingMap = useRef(new Map()); // key: "layer-col", val: { message, transferables }        
            const previewTimeRef = useRef(performance.now());
      
            useEffect(() => {  
          // If we have a pending local update, it means the Ref is already ahead of (or equal to) the State.
          // We skip overwriting the Ref with potentially stale State to prevent "jumping back".
          if (hasPendingClipUpdate.current) {
              hasPendingClipUpdate.current = false;
              return;
          }
          if (clipContents) {
              liveClipContentsRef.current = structuredClone(clipContents);
          }
      }, [clipContents]);

      useEffect(() => {
          if (hasPendingDacUpdate.current) {
              hasPendingDacUpdate.current = false;
              return;
          }
          if (dacOutputSettings) {
              liveDacOutputSettingsRef.current = structuredClone(dacOutputSettings);
          }
      }, [dacOutputSettings]);

      useEffect(() => {
        layerIntensitiesRef.current = layerIntensities;
        layerAutopilotsRef.current = layerAutopilots;
        layerEffectsRef.current = layerEffects; // Update this
        masterIntensityRef.current = masterIntensity;
        layerBlackoutsRef.current = layerBlackouts;
        layerSolosRef.current = layerSolos;
        globalBlackoutRef.current = globalBlackout;
        playbackFpsRef.current = playbackFps;
        // dacOutputSettingsRef.current = dacOutputSettings; // Removed, using liveDacOutputSettingsRef
        dacsRef.current = dacs;
                activeClipsDataRef.current = activeClipsData;
                clipContentsRef.current = clipContents; // We use liveClipContentsRef now but keep this synced for event handlers
                activeClipIndexesRef.current = activeClipIndexes;
                layerAssignedDacsRef.current = layerAssignedDacs;

        clipNamesRef.current = clipNames;
        selectedIldaWorkerIdRef.current = selectedIldaWorkerId;
        selectedIldaTotalFramesRef.current = selectedIldaTotalFrames;
      }, [layerIntensities, layerAssignedDacs, layerAutopilots, layerEffects, masterIntensity, layerBlackouts, layerSolos, globalBlackout, dacOutputSettings, dacs, activeClipsData, clipContents, activeClipIndexes, clipNames, selectedIldaWorkerId, selectedIldaTotalFrames]);

  const generateTestLineFrame = useCallback((yPos) => {
      // yPos: 0 (top) to 1 (bottom). ILDA: 1 to -1.
      const y = 1 - (yPos * 2);
      const points = [];
      const numPoints = 100;
      for (let i = 0; i < numPoints; i++) {
          const x = (i / (numPoints - 1)) * 2 - 1; // -1 to 1
          points.push({ x, y, r: 0, g: 255, b: 0, blanking: false });
      }
      return { points, isTypedArray: false };
  }, []);

  const handleUpdateDacSettings = useCallback((dacId, settings) => {
    // 1. Direct Mutation
    if (liveDacOutputSettingsRef.current) {
        liveDacOutputSettingsRef.current[dacId] = settings;
        hasPendingDacUpdate.current = true;
    }
    // 2. Dispatch
    dispatch({ type: 'SET_DAC_OUTPUT_SETTINGS', payload: { id: dacId, settings } });
  }, []);

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

  // Update CSS variables when theme changes
  useEffect(() => {
    const themeColors = {
      'orange': '#ff5e00',
      'yellow': '#ffd400',
      'cyan': '#00fff3',
      'light-blue': '#0089ff',
      'blue': '#005aff',
      'magenta': '#fb00ff',
      'red': '#ff0000',
      'green': '#00ff00',
      'white': '#ffffff'
    };
    const color = themeColors[theme] || themeColors['orange'];
    document.documentElement.style.setProperty('--theme-color', color);

    // Convert hex to rgba for the transparent variable (20% opacity)
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    document.documentElement.style.setProperty('--theme-color-transparent', `rgba(${r}, ${g}, ${b}, 0.3)`);

    // Save theme to global settings
    if (window.electronAPI && window.electronAPI.setTheme) {
        window.electronAPI.setTheme(theme);
    }
  }, [theme]);

  // Sync selected DAC to main process
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.setSelectedDac) {
        window.electronAPI.setSelectedDac(selectedDac);
    }
  }, [selectedDac]);

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

    const handleMessage = async (e) => {
      if (e.data.browserFile) return; // Ignore messages for the FileBrowser

      if (e.data.type === 'get-frame' && e.data.success) {
        if (e.data.isStillFrame) {
          const { workerId, frame, layerIndex, colIndex } = e.data;
          
          if (layerIndex === undefined || colIndex === undefined) return;

          // Generate Thumbnail
          let thumbnailPath = null;
          // Use live ref if available for latest data, else ref.current
          const clipSource = liveClipContentsRef.current ? liveClipContentsRef.current : clipContentsRef.current;
          const currentClip = clipSource?.[layerIndex]?.[colIndex];
          const effects = currentClip?.effects || [];
          
          // Determine settings for thumbnail: use first assigned DAC or selected DAC
          let settingsForThumbnail = null;
          const assignedDacs = currentClip?.assignedDacs || [];
          if (assignedDacs.length > 0) {
              const dac = assignedDacs[0];
              const dacKey = `${dac.ip}:${dac.channel}`;
              settingsForThumbnail = dacOutputSettingsRef.current[dacKey];
          } else if (selectedDac) {
              const dacKey = `${selectedDac.ip}:${selectedDac.channel}`;
              settingsForThumbnail = dacOutputSettingsRef.current[dacKey];
          }

          let frameToProcess = frame;
          if (settingsForThumbnail) {
              // Apply output processing (Zones, Crop, Flip) to the frame *before* thumbnail generation
              // applyOutputProcessing expects a frame object
              frameToProcess = applyOutputProcessing(frame, settingsForThumbnail);
          }

          thumbnailPath = await generateThumbnail(frameToProcess, effects, layerIndex, colIndex);

          // Update stillFrame and set parsing status to false
          dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { stillFrame: frame, parsing: false, thumbnailPath, thumbnailVersion: Date.now() } } });
        } else {
          liveFramesRef.current[e.data.workerId] = e.data.frame;
        }
      } else if (e.data.type === 'parse-ilda' && e.data.success) {
        const { workerId, totalFrames, ildaFormat, fileName, filePath, layerIndex, colIndex } = e.data;

        if (layerIndex === undefined || colIndex === undefined) return;

        const newClipContent = {
          type: 'ilda',
          workerId,
          totalFrames,
          ildaFormat,
          fileName,
          filePath,
          parsing: true, // Set parsing status to true
          playbackSettings: {
            mode: 'fps',
            duration: totalFrames / 60,
            beats: 8,
            speedMultiplier: 1
          },
        };
        dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: newClipContent } });
        
        // Only update the clip name if it's currently the default name
        const currentName = clipNamesRef.current[layerIndex][colIndex];
        const defaultPattern = `Clip ${layerIndex + 1}-${colIndex + 1}`;
        if (currentName === defaultPattern) {
            dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: fileName } });
        }
        
        // Removed redundant get-frame call to prevent duplicate thumbnail generation
        // The useEffect watching workerBecameValid will trigger it
      } else if (e.data.type === 'get-all-frames' && e.data.success) {
          console.log('Received get-all-frames response:', e.data);
          const { frames, workerId, layerIndex, colIndex } = e.data;
          
          if (layerIndex === undefined || colIndex === undefined) return;

          // Use dynamic import for writer
          import('./utils/ilda-writer.js').then(({ framesToIlda }) => {
              const buffer = framesToIlda(frames);
              const clip = clipContentsRef.current[layerIndex][colIndex];
              const defaultName = clip.fileName || 'export.ild';
              
              if (window.electronAPI && window.electronAPI.saveIldaFile) {
                  window.electronAPI.saveIldaFile(buffer, defaultName).then(res => {
                      if (res.success) showNotification(`Exported to ${res.filePath}`);
                      else if (res.error) showNotification(`Export failed: ${res.error}`);
                  });
              }
          }).catch(err => console.error('Failed to load ilda-writer in response:', err));
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
    const OUTPUT_FPS = 60;
    const dacFrameInterval = 1000 / OUTPUT_FPS;

    // Helper to merge multiple frames into one for a single DAC channel
    const mergeFrames = (frames) => {
      if (frames.length === 0) return null;
      if (frames.length === 1) {
          const f = frames[0];
          const isTyped = f.points instanceof Float32Array || f.isTypedArray;
          return {
              ...f,
              points: isTyped ? new Float32Array(f.points) : f.points.map(p => ({ ...p })),
              isTypedArray: isTyped
          };
      }

      let totalPoints = 0;
      frames.forEach((f, idx) => {
        const isTyped = f.points instanceof Float32Array || f.isTypedArray;
        const numPoints = isTyped ? (f.points.length / 8) : f.points.length;
        totalPoints += numPoints;
        // Add 2 transition points between each clip
        if (idx < frames.length - 1) {
          totalPoints += 2;
        }
      });

      const mergedPoints = new Float32Array(totalPoints * 8);
      let currentPointOffset = 0;

      frames.forEach((f, frameIdx) => {
        const isTyped = f.points instanceof Float32Array || f.isTypedArray;
        const numPoints = isTyped ? (f.points.length / 8) : f.points.length;

        // Copy clip points
        for (let i = 0; i < numPoints; i++) {
          const targetOffset = (currentPointOffset + i) * 8;
          if (isTyped) {
            const srcOffset = i * 8;
            mergedPoints.set(f.points.subarray(srcOffset, srcOffset + 8), targetOffset);
          } else {
            const p = f.points[i];
            mergedPoints[targetOffset] = p.x;
            mergedPoints[targetOffset + 1] = p.y;
            mergedPoints[targetOffset + 2] = p.z || 0;
            mergedPoints[targetOffset + 3] = p.r;
            mergedPoints[targetOffset + 4] = p.g;
            mergedPoints[targetOffset + 5] = p.b;
            mergedPoints[targetOffset + 6] = p.blanking ? 1 : 0;
            mergedPoints[targetOffset + 7] = p.lastPoint ? 1 : 0;
          }
          // Reset lastPoint for all points as we'll set it at the very end
          mergedPoints[targetOffset + 7] = 0;
        }

        currentPointOffset += numPoints;

        // Add transition to next clip
        if (frameIdx < frames.length - 1) {
          const nextFrame = frames[frameIdx + 1];
          const nextIsTyped = nextFrame.points instanceof Float32Array || nextFrame.isTypedArray;

          // Get last point of current clip
          const lastX = mergedPoints[(currentPointOffset - 1) * 8];
          const lastY = mergedPoints[(currentPointOffset - 1) * 8 + 1];

          // Get first point of next clip
          let nextX, nextY;
          if (nextIsTyped) {
            nextX = nextFrame.points[0];
            nextY = nextFrame.points[1];
          } else {
            nextX = nextFrame.points[0].x;
            nextY = nextFrame.points[0].y;
          }

          // Transition Point 1: At current clip's last position but blanked
          let t1Offset = currentPointOffset * 8;
          mergedPoints[t1Offset] = lastX;
          mergedPoints[t1Offset + 1] = lastY;
          mergedPoints[t1Offset + 6] = 1; // blanking
          mergedPoints[t1Offset + 3] = 0; // r
          mergedPoints[t1Offset + 4] = 0; // g
          mergedPoints[t1Offset + 5] = 0; // b

          // Transition Point 2: At next clip's first position and blanked
          let t2Offset = (currentPointOffset + 1) * 8;
          mergedPoints[t2Offset] = nextX;
          mergedPoints[t2Offset + 1] = nextY;
          mergedPoints[t2Offset + 6] = 1; // blanking
          mergedPoints[t2Offset + 3] = 0; // r
          mergedPoints[t2Offset + 4] = 0; // g
          mergedPoints[t2Offset + 5] = 0; // b

          currentPointOffset += 2;
        }
      });

      // Set lastPoint on the very last point
      mergedPoints[(totalPoints - 1) * 8 + 7] = 1;

      return {
        points: mergedPoints,
        isTypedArray: true
      };
    };

    // Animate function for DAC output
    const animate = (currentTime) => {
      if (!isWorldOutputActiveRef.current) {
        cancelAnimationFrame(dacRefreshAnimationFrameId);
        return;
      }

      if (currentTime - lastFrameTime > dacFrameInterval) {
        if (window.electronAPI && isWorldOutputActiveRef.current) {
          const dacGroups = new Map(); // key: "ip:channel", value: { ip, channel, frames: [] }

          // 1. Process Clip Content
          activeClipsDataRef.current.forEach(clip => {
            if (clip && liveFramesRef.current[clip.workerId]) {
              const layerDacs = layerAssignedDacsRef.current[clip.layerIndex] || [];
              const clipDacs = clip.assignedDacs || [];
              
              let combinedDacs = [...layerDacs, ...clipDacs];
              if (combinedDacs.length === 0 && selectedDacRef.current) {
                  combinedDacs = [selectedDacRef.current];
              }

              const dacList = [];
              const seen = new Set();
              combinedDacs.forEach(d => {
                  const ch = d.channel !== undefined ? d.channel : (d.channels && d.channels.length > 0 ? d.channels[0].serviceID : 0);
                  const key = `${d.ip}:${ch}`;
                  if (!seen.has(key)) {
                      seen.add(key);
                      dacList.push({ ...d, channel: ch });
                  }
              });

              if (dacList.length === 0) return;

              // Use Live Ref for Effects to prevent jitter
              const clipSource = liveClipContentsRef.current || clipContentsRef.current;
              const liveClip = clipSource[clip.layerIndex][activeClipIndexesRef.current[clip.layerIndex]];
              const liveEffects = liveClip ? (liveClip.effects || []) : (clip.effects || []);

              // Merge clip effects with layer effects
              const layerIdx = clip.layerIndex;
              const currentLayerEffects = layerEffectsRef.current[layerIdx] || [];
              const effects = [...liveEffects, ...currentLayerEffects];
              
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
              if (finalIntensity <= 0) return; // Don't even process if invisible

              const clipProgress = progressRef.current[clip.workerId] || 0;
              const syncSettings = clip.syncSettings || {};

              const intensityAdjustedFrame = {
                ...frame,
                points: isTypedArray(frame.points) ? frame.points : frame.points.map(p => ({
                  ...p,
                  r: Math.round(p.r * finalIntensity),
                  g: Math.round(p.g * finalIntensity),
                  b: Math.round(p.b * finalIntensity),
                })),
              };

              // If it's a typed array we need to handle intensity differently during applyEffects or before
              if (isTypedArray(intensityAdjustedFrame.points)) {
                  const pts = intensityAdjustedFrame.points;
                  const numPts = pts.length / 8;
                  const newPts = new Float32Array(pts);
                  for(let i=0; i<numPts; i++) {
                      newPts[i*8+3] *= finalIntensity;
                      newPts[i*8+4] *= finalIntensity;
                      newPts[i*8+5] *= finalIntensity;
                  }
                  intensityAdjustedFrame.points = newPts;
              }

              // Calculate clip duration in seconds
              const playbackSettings = liveClip ? liveClip.playbackSettings : (clip.playbackSettings || {});
              let clipDuration = 1;

              if (playbackSettings.mode === 'timeline') {
                  clipDuration = playbackSettings.duration || 1;
              } else if (playbackSettings.mode === 'bpm') {
                  const currentBpm = bpmRef.current || 120;
                  const beats = playbackSettings.beats || 8;
                  clipDuration = (beats * 60) / currentBpm;
              } else {
                  // FPS Mode
                  const clipFps = playbackSettings.fps || clip.fps || playbackFpsRef.current || 30;
                  const totalFrames = clip.totalFrames || 30;
                  clipDuration = totalFrames / clipFps;
              }
              // Adjust for speed multiplier if needed, but usually resolveParam handles speed separately?
              // resolveParam uses clipDuration to map progress (0..1) to Time.
              // If speedMultiplier affects playback speed (how fast progress moves 0..1), 
              // then clipDuration (Real Time duration of 0..1) changes.
              // So yes, we should probably account for speedMultiplier.
              // BUT, frameFetcherLoop handles the progress advancement speed using speedMultiplier.
              // So 'progress' is already speed-adjusted.
              // If we want 'clipTime' to be "Real World Time elapsed within the clip", 
              // we should use the "Nominal Duration" / Speed.
              const speedMult = playbackSettings.speedMultiplier || 1;
              if (speedMult !== 0) clipDuration /= speedMult;

              // Pre-optimization to handle effect-based discontinuities (e.g. Delay)
              // This aligns with "Option 3" of the architectural fix.
              const optimizedPts = optimizePoints(intensityAdjustedFrame.points);
              intensityAdjustedFrame.points = optimizedPts;
              intensityAdjustedFrame.isTypedArray = true;

              const modifiedFrame = applyEffects(intensityAdjustedFrame, effects, { 
                  progress: clipProgress, 
                  time: currentTime, 
                  effectStates: effectStatesRef.current, 
                  assignedDacs: dacList, // Pass the combined list of DACs (Layer + Clip)
                  syncSettings: clip.syncSettings || {},
                  bpm: bpmRef.current,
                  clipDuration: clipDuration,
                  fftLevels: getFftLevels ? getFftLevels() : fftLevels // Use helper for fresh data
              });

              dacList.forEach((targetDac, dacIndex) => {
                const ip = targetDac.ip;
                const channel = targetDac.channel || (targetDac.channels && targetDac.channels.length > 0 ? targetDac.channels[0].serviceID : 0);

                if (channel !== undefined) { // Check undefined instead of 0 to allow channel 0
                  const key = `${ip}:${channel}`;
                  if (!dacGroups.has(key)) {
                    dacGroups.set(key, { ip, channel, type: targetDac.type, frames: [] });
                  }

                  // Apply channel-level mirroring if specified
                  let finalDacFrame = modifiedFrame;
                  
                  // Check for Delay Distribution
                  if (modifiedFrame.points && modifiedFrame.points._channelDistributions) {
                      const dist = modifiedFrame.points._channelDistributions.get(dacIndex);
                      if (dist) {
                          // Slice the frame for this channel
                          const subPoints = modifiedFrame.points.subarray(dist.start, dist.start + dist.length);
                          // Create new frame object with sliced points, preserving other props
                          finalDacFrame = { ...modifiedFrame, points: subPoints };
                      } else {
                          // If this DAC is not in the distribution map (e.g. 5th laser, only 4 delays),
                          // we should probably output nothing or the current frame?
                          // Let's output nothing (Blank) to be safe and clean.
                          finalDacFrame = { ...modifiedFrame, points: new Float32Array(0) };
                      }
                  }

                  if (targetDac.mirrorX || targetDac.mirrorY) {
                      const pts = finalDacFrame.points;
                      const isT = finalDacFrame.isTypedArray;
                      const n = isT ? (pts.length / 8) : pts.length;
                      const newPts = isT ? new Float32Array(pts) : pts.map(p => ({ ...p }));

                      for(let i=0; i<n; i++) {
                          if (isT) {
                              if (targetDac.mirrorX) newPts[i*8] = -newPts[i*8];
                              if (targetDac.mirrorY) newPts[i*8+1] = -newPts[i*8+1];
                          } else {
                              if (targetDac.mirrorX) newPts[i].x = -newPts[i].x;
                              if (targetDac.mirrorY) newPts[i].y = -newPts[i].y;
                          }
                      }
                      finalDacFrame = { ...finalDacFrame, points: newPts };
                  }

                  dacGroups.get(key).frames.push(finalDacFrame);
                }
              });
            }
          });

          // 2. Process Test Lines and ensure all available DACs are considered
          dacsRef.current.forEach(dac => {
              const channels = (dac.channels && dac.channels.length > 0) ? dac.channels.map(c => c.serviceID) : [0];
              channels.forEach(ch => {
                  const id = `${dac.ip}:${ch}`;
                  const settings = liveDacOutputSettingsRef.current ? liveDacOutputSettingsRef.current[id] : dacOutputSettingsRef.current[id];
                  
                  if (settings) {
                      if (!dacGroups.has(id)) {
                          dacGroups.set(id, { ip: dac.ip, channel: ch, type: dac.type, frames: [] });
                      }
                      
                      const group = dacGroups.get(id);
                      
                      if (settings.testLineEnabled) {
                          const testFrame = generateTestLineFrame(settings.testLineY !== undefined ? settings.testLineY : 0.5);
                          group.frames = [testFrame]; // Override existing frames
                      }
                  }
              });
          });

          // Send merged frames to each DAC channel
          let activeCount = 0;
          dacGroups.forEach(group => {
            let mergedFrame = mergeFrames(group.frames);
            
            const id = `${group.ip}:${group.channel}`;
            const settings = liveDacOutputSettingsRef.current ? liveDacOutputSettingsRef.current[id] : dacOutputSettingsRef.current[id];
            
            if (mergedFrame && settings) {
                // ... dimmer logic ...
                if (settings.dimmer !== undefined && settings.dimmer < 1) {
                     const dim = settings.dimmer;
                     const pts = mergedFrame.points;
                     const isT = mergedFrame.isTypedArray;
                     const n = isT ? (pts.length / 8) : pts.length;
                     for(let i=0; i<n; i++) {
                         if (isT) {
                             pts[i*8+3] *= dim;
                             pts[i*8+4] *= dim;
                             pts[i*8+5] *= dim;
                         } else {
                             pts[i].r *= dim;
                             pts[i].g *= dim;
                             pts[i].b *= dim;
                         }
                     }
                }

                mergedFrame = applyOutputProcessing(mergedFrame, settings, false);
            }

            if (mergedFrame) {
              activeCount++;
              const numPts = isTypedArray(mergedFrame.points) ? (mergedFrame.points.length / 8) : mergedFrame.points.length;
              totalPointsSentRef.current += numPts;
              // Optimization: send points buffer directly to reduce overhead
              // Passing { skipOptimization: true } because we already optimized before effects
              window.electronAPI.sendFrame(group.ip, group.channel, mergedFrame.points, OUTPUT_FPS, group.type, { skipOptimization: true });
            }
          });
          activeChannelsCountRef.current = activeCount;
        }
        lastFrameTime = currentTime;
      }
      dacRefreshAnimationFrameId = requestAnimationFrame(animate);
    };

    function isTypedArray(obj) {
        return !!obj && (obj instanceof Float32Array || obj.buffer instanceof ArrayBuffer);
    }

    // Frame fetcher loop for updating liveFrames
    const frameFetcherLoop = (timestamp) => {
      const currentFrameInterval = 1000 / playbackFpsRef.current;
      const currentBpm = bpmRef.current || 120;

      const processClip = (clip, layerIndex, colIndex, workerId) => {
          if (!lastFrameFetchTimeRef.current[workerId]) {
              lastFrameFetchTimeRef.current[workerId] = timestamp;
          }
          
          // Calculate time since last frame
          let dt = timestamp - lastFrameFetchTimeRef.current[workerId];
          
          // Sanity check for huge jumps (e.g. tab inactive)
          if (dt > 1000) dt = currentFrameInterval;
          
          // Only advance time if playing
          if (isPlayingRef.current) {
              if (accumulatedTimeRef.current[workerId] === undefined) {
                  accumulatedTimeRef.current[workerId] = 0;
              }
              accumulatedTimeRef.current[workerId] += dt;
          }
          
          const totalElapsed = accumulatedTimeRef.current[workerId] || 0;

          // We only use audio sync if it's an active clip (not a preview only)
          const audioInfo = activeClipIndexesRef.current[layerIndex] !== null ? getAudioInfoRef.current(layerIndex) : null;

          let targetIndex = frameIndexesRef.current[workerId] || 0;
          let currentProgress = 0;
          const totalFrames = clip.totalFrames || 1;
          const pSettings = clip.playbackSettings || { mode: 'fps', duration: totalFrames / 60, beats: 8, speedMultiplier: 1 };

          if (audioInfo && isPlayingRef.current && !audioInfo.paused) {
              currentProgress = audioInfo.duration > 0 ? (audioInfo.currentTime / audioInfo.duration) : 0;
              targetIndex = Math.floor(currentProgress * totalFrames);
          } else if (pSettings.mode === 'timeline') {
              const totalDurationMs = (pSettings.duration * 1000) / (pSettings.speedMultiplier || 1);
              if (totalDurationMs > 0) {
                  currentProgress = (totalElapsed / totalDurationMs) % 1.0;
                  targetIndex = Math.floor(currentProgress * totalFrames);
              }
          } else if (pSettings.mode === 'bpm') {
              const oneBeatMs = 60000 / currentBpm;
              const totalDurationMs = (pSettings.beats * oneBeatMs) / (pSettings.speedMultiplier || 1);
              if (totalDurationMs > 0) {
                  currentProgress = (totalElapsed / totalDurationMs) % 1.0;
                  targetIndex = Math.floor(currentProgress * totalFrames);
              }
          } else {
              // FPS Mode (Default)
              const clipFps = pSettings.fps || 60;
              const clipFrameInterval = 1000 / (clipFps * (pSettings.speedMultiplier || 1));
              
              if (dt >= clipFrameInterval) {
                  const framesToAdvance = Math.floor(dt / clipFrameInterval);
                  if (isPlayingRef.current) {
                      lastFrameFetchTimeRef.current[workerId] = timestamp - (dt % clipFrameInterval);
                      targetIndex = (targetIndex + framesToAdvance);
                  } else {
                      lastFrameFetchTimeRef.current[workerId] = timestamp;
                  }
                  currentProgress = totalFrames > 0 ? ((targetIndex % totalFrames) / totalFrames) : 0;
              } else {
                  return; // Not enough time passed
              }
          }
          
          // For non-FPS modes, we update lastFrameFetchTimeRef every loop to keep dt correct
          if (pSettings.mode !== 'fps') {
              lastFrameFetchTimeRef.current[workerId] = timestamp;
          }

          if (isNaN(targetIndex)) targetIndex = 0;
          if (isNaN(currentProgress)) currentProgress = 0;

          const prevProgress = previousProgressRef.current[workerId] || 0;
          // Check for loop/completion
          const didLoop = (prevProgress > 0.9 && currentProgress < 0.1);

          previousProgressRef.current[workerId] = currentProgress;
          progressRef.current[workerId] = currentProgress;
          if (totalFrames > 0) {
              targetIndex = targetIndex % totalFrames;
              if (targetIndex < 0) targetIndex += totalFrames;
          }

          // Autopilot Trigger
          if (didLoop && isPlayingRef.current) {
             const mode = layerAutopilotsRef.current[layerIndex];
             if (mode && mode !== 'off') {
                 // Trigger next clip
                 const currentLayerClips = clipContentsRef.current[layerIndex];
                 const currentCol = activeClipIndexesRef.current[layerIndex];
                 let nextCol = -1;

                 if (mode === 'forward') {
                     // Find next column with content
                     for (let i = 1; i < currentLayerClips.length; i++) {
                         const idx = (currentCol + i) % currentLayerClips.length;
                         const clip = currentLayerClips[idx];
                         if (clip && (clip.type === 'ilda' || clip.type === 'generator')) {
                             nextCol = idx;
                             break;
                         }
                     }
                 } else if (mode === 'random') {
                     // Find all valid columns
                     const validCols = currentLayerClips.map((c, i) => (c && (c.type === 'ilda' || c.type === 'generator')) ? i : -1).filter(i => i !== -1);
                     if (validCols.length > 0) {
                         const randIdx = Math.floor(Math.random() * validCols.length);
                         nextCol = validCols[randIdx];
                         // Avoid repeating same clip if possible
                         if (nextCol === currentCol && validCols.length > 1) {
                             nextCol = validCols[(randIdx + 1) % validCols.length];
                         }
                     }
                 }

                 if (nextCol !== -1 && nextCol !== currentCol) {
                     // We need to call handleActivateClick, but we are in a loop.
                     // Use setTimeout to break out of the loop and safe update state.
                     setTimeout(() => {
                         handleActivateClick(layerIndex, nextCol);
                     }, 0);
                 }
             }
          }

          // Calculate clip duration for sync
          let clipDuration = 1;
          if (pSettings.mode === 'timeline') {
              clipDuration = pSettings.duration || 1;
          } else if (pSettings.mode === 'bpm') {
              clipDuration = ((pSettings.beats || 8) * 60) / currentBpm;
          } else {
              clipDuration = totalFrames / (pSettings.fps || 60);
          }

          // Generator Parameter Animation Sync
          if (clip.type === 'generator') {
              const syncSettings = clip.syncSettings || {};
                                const generatorId = clip.generatorDefinition?.id;
                                const genDef = clip.generatorDefinition;
                                
                                const animatedParams = Object.keys(syncSettings).filter(key => key.startsWith(`${generatorId}.`));
                                
                                if (animatedParams.length > 0) {
                                    const currentParams = clip.currentParams || {};
                                    const resolvedParams = { ...currentParams };
                                    let changed = false;
                                    
                                    const context = {
                                        time: timestamp,
                                        progress: currentProgress,
                                        bpm: currentBpm,
                                        clipDuration: clipDuration,
                                        fftLevels: getFftLevels ? getFftLevels() : fftLevels,
                                        activationTime: clipActivationTimesRef.current[layerIndex] || 0
                                    };
              
                                    for (const paramKey of animatedParams) {
                                        const paramId = paramKey.split('.')[1];
                                        const control = genDef?.paramControls?.find(c => c.id === paramId);
                                        const baseValue = currentParams[paramId] !== undefined ? currentParams[paramId] : clip.generatorDefinition.defaultParams[paramId];
                                        const newValue = resolveParam(paramId, baseValue, syncSettings[paramKey], context, control?.min, control?.max);
                                        
                                        if (newValue !== resolvedParams[paramId]) {
                                            resolvedParams[paramId] = newValue;
                                            changed = true;
                                        }
                                    }                  
                  if (changed) {
                      const seq = ++generatorRequestSeqRef.current;
                      regenerateGeneratorClip(layerIndex, colIndex, clip.generatorDefinition, resolvedParams, seq, true);
                  }
              }
          }

          if (frameIndexesRef.current[workerId] !== targetIndex || !liveFramesRef.current[workerId]) {
              frameIndexesRef.current[workerId] = targetIndex;
              if (clip.type === 'ilda') {
                  ildaParserWorker.postMessage({ type: 'get-frame', workerId, frameIndex: targetIndex });
              } else if (clip.type === 'generator') {
                  // Only overwrite from clip.frames if it's an animation (multi-frame)
                  // For single-frame generators, the worker updates liveFramesRef directly
                  // and we avoid overwriting with potentially stale frames from state.
                  if (clip.frames && clip.frames.length > 1) {
                      if (clip.frames[targetIndex % clip.frames.length]) {
                          liveFramesRef.current[workerId] = clip.frames[targetIndex % clip.frames.length];
                      }
                  } else if (!liveFramesRef.current[workerId] && clip.frames && clip.frames.length > 0) {
                      // Initial load
                      liveFramesRef.current[workerId] = clip.frames[0];
                  }
              }
          }
      };

      // 1. Process active clips
      layers.forEach((_, layerIndex) => {
          const activeColIndex = activeClipIndexesRef.current[layerIndex];
          if (activeColIndex === null) return;
          // Use live content ref for latest params
          const clipSource = liveClipContentsRef.current || clipContentsRef.current;
          const clip = clipSource[layerIndex][activeColIndex];
          if (!clip) return;

          let workerId = clip.type === 'ilda' ? clip.workerId : (clip.type === 'generator' ? `generator-${layerIndex}-${activeColIndex}` : null);
          if (!workerId) return;

          processClip(clip, layerIndex, activeColIndex, workerId);
      });

      // 2. Process selected clip (for preview) if it's not already handled as active
      const selWorkerId = selectedIldaWorkerIdRef.current;
      if (selWorkerId && !activeClipsDataRef.current.some(c => c.workerId === selWorkerId)) {
          const lIdx = selectedLayerIndexRef.current; // Use Ref
          const cIdx = selectedColIndexRef.current; // Use Ref
          if (lIdx !== null && cIdx !== null) {
              const clipSource = liveClipContentsRef.current || clipContentsRef.current;
              const clip = clipSource[lIdx][cIdx];
              if (clip) {
                  processClip(clip, lIdx, cIdx, selWorkerId);
              }
          }
      }

      // 3. Process hovered clip (for hover preview)
      if (hoveredClipRef.current) {
          const { layerIndex, colIndex } = hoveredClipRef.current;
          // Avoid double processing if it's already active or selected
          const isActive = activeClipIndexesRef.current[layerIndex] === colIndex;
          const isSelected = selectedLayerIndexRef.current === layerIndex && selectedColIndexRef.current === colIndex; // Use Refs
          const selWorkerId = selectedIldaWorkerIdRef.current;
          
          if (!isActive) {
               const clipSource = liveClipContentsRef.current || clipContentsRef.current;
               const clip = clipSource[layerIndex]?.[colIndex];
               if (clip) {
                   let workerId = clip.type === 'ilda' ? clip.workerId : (clip.type === 'generator' ? `generator-${layerIndex}-${colIndex}` : null);
                   // Also check if this workerId is the selected one (handled in step 2), to avoid duplicate
                   if (workerId && workerId !== selWorkerId) {
                        processClip(clip, layerIndex, colIndex, workerId);
                   }
               }
          }
      }

      animationFrameId = requestAnimationFrame(frameFetcherLoop);
    };

    animationFrameId = requestAnimationFrame(frameFetcherLoop);

    // Start DAC animation if world output is active
    if (isWorldOutputActive) {
      dacRefreshAnimationFrameId = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(dacRefreshAnimationFrameId);
    }


    // Cleanup on unmount
    return () => {
      ildaParserWorker.removeEventListener('message', handleMessage);
      cancelAnimationFrame(animationFrameId);
      cancelAnimationFrame(dacRefreshAnimationFrameId); // Clean up DAC animation frame
    };
  }, [ildaParserWorker, isWorldOutputActive]); // Minimal dependencies

    // Listen for context menu commands
  useEffect(() => {
      let unsubClip, unsubLayer, unsubCtx;

      if (window.electronAPI) {
          unsubClip = window.electronAPI.onClipContextMenuCommand((command, layerIndex, colIndex) => {
              console.log(`Clip context menu command received: ${command} for ${layerIndex}-${colIndex}`);
              if (command === 'export-ilda') {
                  const clipToExport = clipContentsRef.current[layerIndex][colIndex];
                  console.log('Exporting clip:', clipToExport);
                  if (clipToExport) {
                      if (clipToExport.type === 'ilda' && clipToExport.workerId && ildaParserWorker) {
                          showNotification('Preparing ILDA export...');
                          console.log('Requesting frames from worker:', clipToExport.workerId);
                          ildaParserWorker.postMessage({
                              type: 'get-all-frames',
                              workerId: clipToExport.workerId,
                              layerIndex,
                              colIndex,
                          });
                      } else if (clipToExport.type === 'generator' && clipToExport.frames) {
                          console.log('Exporting generator frames with effects...');
                          import('./utils/ilda-writer.js').then(({ framesToIlda }) => {
                              const fps = playbackFps || 60;
                              let duration = 2.0; // Default 2s
                              
                              if (clipToExport.playbackSettings) {
                                  if (clipToExport.playbackSettings.mode === 'timeline' && clipToExport.playbackSettings.duration) {
                                      duration = clipToExport.playbackSettings.duration;
                                  } else if (clipToExport.playbackSettings.mode === 'bpm' && clipToExport.playbackSettings.beats) {
                                      const bpm = state.bpm || 120;
                                      duration = (clipToExport.playbackSettings.beats / bpm) * 60;
                                  } else if (clipToExport.playbackSettings.mode === 'fps' && clipToExport.frames.length > 1) {
                                      duration = clipToExport.frames.length / fps;
                                  }
                              }

                              const totalExportFrames = Math.ceil(duration * fps);
                              const bakedFrames = [];
                              
                              // We need a clean effect state for the export
                              const exportEffectStates = new Map();

                              for (let i = 0; i < totalExportFrames; i++) {
                                  const time = i * (1000 / fps);
                                  const progress = i / totalExportFrames;
                                  
                                  // Select base frame from generator (looping)
                                  const baseFrameIdx = Math.floor(progress * clipToExport.frames.length) % clipToExport.frames.length;
                                  const baseFrame = clipToExport.frames[baseFrameIdx];
                                  
                                  if (baseFrame) {
                                      // Clone frame to avoid mutating original
                                      const frameClone = { ...baseFrame }; 
                                      
                                      // Apply Effects
                                      // Filter effects for export (ignore Delay/Chase in channel mode)
                                  const effectsToApply = (clipToExport.effects || []).filter(eff => {
                                      if ((eff.id === 'delay' || eff.id === 'chase') && eff.params?.mode === 'channel') {
                                          return false;
                                      }
                                      return true;
                                  });

                                  const processedFrame = applyEffects(frameClone, effectsToApply, {
                                          time: time,
                                          progress: progress,
                                          effectStates: exportEffectStates,
                                          syncSettings: clipToExport.syncSettings || {},
                                          bpm: state.bpm,
                                          clipDuration: duration,
                                          assignedDacs: clipToExport.assignedDacs || []
                                      });
                                      
                                      // Convert TypedArray back to points structure if needed by writer?
                                      // ilda-writer.js handles {x,y,r,g,b...} objects. 
                                      // applyEffects returns TypedArray in `processedFrame.points` (format X,Y,Z,R,G,B,BLK,LAST)
                                      // We need to convert this back to object array for `ilda-writer.js` OR update `ilda-writer.js` to handle typed arrays.
                                      // `ilda-writer.js` ALREADY handles objects.
                                      // Let's check `ilda-writer.js` if it handles TypedArrays.
                                      // I wrote it recently. Let me check.
                                      
                                      // Checking ilda-writer.js logic:
                                      // It iterates: const p = points[i]; let x = p.x ...
                                      // It expects OBJECTS.
                                      // applyEffects returns TypedArray.
                                      // So we MUST convert TypedArray back to Objects for the writer.
                                      
                                      const pts = processedFrame.points;
                                      const numPts = pts.length / 8;
                                      const objectPoints = [];
                                      for(let k=0; k<numPts; k++) {
                                          objectPoints.push({
                                              x: pts[k*8],
                                              y: pts[k*8+1],
                                              z: pts[k*8+2],
                                              r: pts[k*8+3],
                                              g: pts[k*8+4],
                                              b: pts[k*8+5],
                                              blanking: pts[k*8+6] > 0.5,
                                              lastPoint: pts[k*8+7] > 0.5
                                          });
                                      }
                                      
                                      bakedFrames.push({
                                          ...processedFrame,
                                          points: objectPoints,
                                          frameName: `Frame ${i}`,
                                          companyName: 'TrueLazer'
                                      });
                                  }
                              }

                              const buffer = framesToIlda(bakedFrames);
                              const defaultName = `${clipToExport.generatorDefinition?.name || 'generator'}_export.ild`;
                              if (window.electronAPI && window.electronAPI.saveIldaFile) {
                                  window.electronAPI.saveIldaFile(buffer, defaultName).then(res => {
                                      if (res.success) showNotification(`Exported to ${res.filePath}`);
                                      else if (res.error) showNotification(`Export failed: ${res.error}`);
                                  });
                              }
                          }).catch(err => console.error('Failed to export generator:', err));
                      } else {
                          console.warn('Clip type not supported for export or missing data:', clipToExport.type, clipToExport);
                          if (clipToExport.type === 'ilda' && !clipToExport.workerId) {
                              showNotification('Clip data not loaded. Please play the clip to load it.');
                          } else if (clipToExport.type === 'generator' && !clipToExport.frames) {
                               showNotification('Generator not rendered yet.');
                          }
                      }
                  }
              } else if (command === 'update-thumbnail') {
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
                      } else if (clipToUpdate.type === 'generator' && clipToUpdate.generatorDefinition) {
                          const currentIdx = frameIndexesRef.current[`generator-${layerIndex}-${colIndex}`] || 0;
                          const currentFrame = clipToUpdate.frames?.[currentIdx % clipToUpdate.frames.length];
                          if (currentFrame) {
                              const effects = clipToUpdate.effects || [];
                              generateThumbnail(currentFrame, effects, layerIndex, colIndex).then(thumbnailPath => {
                                  dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { stillFrame: currentFrame, thumbnailPath, thumbnailVersion: Date.now() } } });
                              });
                          }
                      }
                  }
              } else if (command === 'clear-clip') {
                  dispatch({ type: 'CLEAR_CLIP', payload: { layerIndex, colIndex } });
              } else if (command === 'rename-clip') {
                  const oldName = clipNamesRef.current[layerIndex][colIndex];
                  setRenameModalConfig({
                      title: 'Rename Clip',
                      initialValue: oldName,
                      onSave: (newName) => dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: newName } })
                  });
                  setShowRenameModal(true);
              } else if (command === 'copy-clip') {
                  const clipToCopy = {
                      content: clipContentsRef.current[layerIndex][colIndex],
                      name: clipNamesRef.current[layerIndex][colIndex],
                  };
                  dispatch({ type: 'SET_CLIPBOARD', payload: clipToCopy });
                  showNotification('Clip copied.');
              } else if (command === 'cut-clip') {
                  const clipToCut = {
                      content: clipContentsRef.current[layerIndex][colIndex],
                      name: clipNamesRef.current[layerIndex][colIndex],
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
                              const key = `${layerIndex}-${colIndex}`;
                              const completeParams = { ...newClip.generatorDefinition.defaultParams, ...newClip.currentParams };
                              prevGeneratorParamsRef.current.set(key, JSON.stringify(completeParams));

                              const seq = ++generatorRequestSeqRef.current;
                              regenerateGeneratorClip(layerIndex, colIndex, newClip.generatorDefinition, newClip.currentParams, seq);
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

      // Find which thumbnails have changed or where workerId became valid

      for (let i = 0; i < layers.length; i++) {

        for (let j = 0; j < columns.length; j++) {

          const currentIndex = thumbnailFrameIndexes[i][j];

          const prevIndex = prevThumbnailFrameIndexesRef.current[i][j];

          const clip = clipContents[i][j];

          const currentWorkerId = clip?.workerId;

          const prevWorkerId = prevWorkerIdsRef.current.get(`${i}-${j}`);

  

          const indexChanged = currentIndex !== prevIndex;

          const workerBecameValid = currentWorkerId && !prevWorkerId;

  

          if ((indexChanged || workerBecameValid) && clip && clip.type === 'ilda' && currentWorkerId) {

            console.log(`[App.jsx] Fetching still frame for ${i}-${j} at index ${currentIndex}. Reason: ${indexChanged ? 'index change' : 'worker ready'}`);

            ildaParserWorker.postMessage({

              type: 'get-frame',

              workerId: currentWorkerId,

              frameIndex: currentIndex,

              isStillFrame: true,

              layerIndex: i,

              colIndex: j,

            });

          }

          

          // Update workerId ref

          if (currentWorkerId) prevWorkerIdsRef.current.set(`${i}-${j}`, currentWorkerId);

          else prevWorkerIdsRef.current.delete(`${i}-${j}`);

        }

      }

      // Update the ref for the next render

      prevThumbnailFrameIndexesRef.current = thumbnailFrameIndexes;

    }, [thumbnailFrameIndexes, clipContents, layers.length, columns.length, ildaParserWorker]);

  // Sync generator frames whenever their parameters change
  useEffect(() => {
    if (!generatorWorker) return;

    clipContents.forEach((layer, layerIndex) => {
      layer.forEach((clip, colIndex) => {
        if (clip && clip.type === 'generator' && clip.generatorDefinition) {
          // Skip NDI source here as it's handled by the NDI frame loop
          if (clip.generatorDefinition.id === 'ndi-source') return;

          const key = `${layerIndex}-${colIndex}`;
          // Merge defaults for a stable comparison
          const completeParams = { ...clip.generatorDefinition.defaultParams, ...(clip.currentParams || {}) };
          const currentParamsJson = JSON.stringify(completeParams);
          
          if (prevGeneratorParamsRef.current.get(key) !== currentParamsJson) {
            // Parameters changed (via MIDI, Quick Assign, or UI)
            console.log(`[App.jsx] Generator ${key} params changed, regenerating...`);
            const seq = ++generatorRequestSeqRef.current;
            regenerateGeneratorClip(layerIndex, colIndex, clip.generatorDefinition, clip.currentParams, seq);
            prevGeneratorParamsRef.current.set(key, currentParamsJson);
          }
        }
      });
    });
  }, [clipContents, generatorWorker]);

  // Re-parse ILDA files and re-generate generator frames on project load
  useEffect(() => {
    if (!state.projectLoadTimestamp || !ildaParserWorker || !generatorWorker) return;

    console.log("Project loaded, regenerating content...");

    const audioChecks = [];

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
            const seq = ++generatorRequestSeqRef.current;
            regenerateGeneratorClip(layerIndex, colIndex, clip.generatorDefinition, clip.currentParams, seq);
          }

          // Check for missing audio files
          if (clip.audioFile && clip.audioFile.path && window.electronAPI && window.electronAPI.checkFileExists) {
              audioChecks.push(
                  window.electronAPI.checkFileExists(clip.audioFile.path).then(exists => {
                      if (!exists) {
                          setMissingFiles(prev => {
                              const reqId = `audio-${layerIndex}-${colIndex}`;
                              if (prev.some(f => f.requestId === reqId)) return prev;
                              return [...prev, { 
                                  filePath: clip.audioFile.path, 
                                  fileName: clip.audioFile.name || clip.audioFile.path.split(/[/\\]/).pop(), 
                                  requestId: reqId,
                                  type: 'audio' 
                              }];
                          });
                      }
                  })
              );
          }
        }
      });
    });
  }, [state.projectLoadTimestamp, ildaParserWorker, generatorWorker]);

  // Listen for thumbnail mode updates from Main Process (Menu)
  useEffect(() => {
      if (window.electronAPI && window.electronAPI.onUpdateThumbnailRenderMode) {
          const unsubscribe = window.electronAPI.onUpdateThumbnailRenderMode((mode) => {
              console.log('App.jsx: Received thumbnail mode update:', mode);
              dispatch({ type: 'SET_THUMBNAIL_RENDER_MODE', payload: mode });
          });
          return () => unsubscribe();
      }
  }, []);

  const handleThumbnailModeChange = (e) => {
      const mode = e.target.value;
      dispatch({ type: 'SET_THUMBNAIL_RENDER_MODE', payload: mode });
      if (window.electronAPI && window.electronAPI.sendRendererThumbnailModeChanged) {
          window.electronAPI.sendRendererThumbnailModeChanged(mode);
      }
  };

  // Listen for project management commands
  // Ref to hold the latest state for event listeners
  const stateRef = useRef(state);
  useEffect(() => {
      stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let unlistenNew, unlistenOpen, unlistenSave, unlistenSaveAs, unlistenLoad;

    if (window.electronAPI) {
      unlistenNew = window.electronAPI.on('new-project', () => dispatch({ type: 'RESET_STATE' }));
      unlistenOpen = window.electronAPI.on('open-project', () => { /* This is handled in main.js */ });
      
      // Use ref to access latest state without re-binding listeners
      unlistenSave = window.electronAPI.on('save-project', () => {
          console.log("Saving project with state:", stateRef.current);
          window.electronAPI.send('save-project', stateRef.current);
      });
      unlistenSaveAs = window.electronAPI.on('save-project-as', () => {
          console.log("Saving project AS with state:", stateRef.current);
          window.electronAPI.send('save-project-as', stateRef.current);
      });
      
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
  }, []); // Run once on mount

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
        if (action === 'output-settings') {
          setShowOutputSettingsWindow(true);
        } else if (action === 'settings-audio-output') {
          setShowAudioSettingsWindow(true);
        } else if (action === 'settings-audio-fft') {
          setShowFftSettingsWindow(true);
        } else if (action.startsWith('set-theme-')) {
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
          if (window.electronAPI && window.electronAPI.checkFileExists) {
              const exists = await window.electronAPI.checkFileExists(filePath);
              if (!exists) {
                  throw new Error(`File not found: ${filePath}`);
              }
          }

          const arrayBuffer = await window.electronAPI.readFileForWorker(filePath);
          ildaParserWorker.postMessage({
            type: 'file-content-response',
            requestId,
            arrayBuffer,
          }, [arrayBuffer]); // Transferrable
        } catch (error) {
          console.warn(`File missing or read error: ${filePath}`, error.message);
          
          // Instead of immediate prompt, add to missing files list
          const fileName = filePath.split(/[/\\]/).pop();
          setMissingFiles(prev => {
              // Avoid duplicates
              if (prev.some(f => f.requestId === requestId)) return prev;
              return [...prev, { filePath, fileName, requestId }];
          });
        }
      } else if (e.data.type === 'parsing-status') {
        const { layerIndex, colIndex, status } = e.data;
        if (layerIndex !== undefined && colIndex !== undefined) {
            dispatch({ type: 'SET_CLIP_PARSING_STATUS', payload: { layerIndex, colIndex, status } });
            if (!status) {
                // Mark as failed so we don't retry endlessly
                dispatch({ type: 'SET_CLIP_PARSING_FAILED', payload: { layerIndex, colIndex, failed: true } });
            }
        }
      }
    };

    ildaParserWorker.addEventListener('message', handleWorkerRequest);
    return () => {
      ildaParserWorker.removeEventListener('message', handleWorkerRequest);
    };
  }, [ildaParserWorker]);

  // Effect to trigger re-parsing of ILDA clips when workerId is missing (e.g. after load)
  useEffect(() => {
      if (!ildaParserWorker) return;

      const clipsToParse = [];
      clipContents.forEach((layer, layerIndex) => {
          layer.forEach((clip, colIndex) => {
              if (clip && clip.type === 'ilda' && clip.filePath && !clip.workerId && !clip.parsing && !clip.parsingFailed) {
                  clipsToParse.push({ layerIndex, colIndex, fileName: clip.fileName, filePath: clip.filePath });
              }
          });
      });

      if (clipsToParse.length > 0) {
          console.log(`Triggering re-parse for ${clipsToParse.length} clips.`);
          // Bulk update status to parsing
          dispatch({ 
              type: 'SET_BULK_PARSING_STATUS', 
              payload: clipsToParse.map(c => ({ layerIndex: c.layerIndex, colIndex: c.colIndex, status: true })) 
          });

          // Send requests
          clipsToParse.forEach(clip => {
              ildaParserWorker.postMessage({
                  type: 'load-and-parse-ilda',
                  fileName: clip.fileName,
                  filePath: clip.filePath,
                  layerIndex: clip.layerIndex,
                  colIndex: clip.colIndex
              });
          });
      }
  }, [clipContents, ildaParserWorker]);

  // Calculate directly on render to ensure live params are used
  const source = liveClipContentsRef.current || clipContents;
  let selectedClipEffects = [];

  if (selectedLayerIndex !== null) {
      const lEffects = layerEffects[selectedLayerIndex] || [];
      
      if (selectedColIndex !== null) {
          const clipEffects = source[selectedLayerIndex][selectedColIndex]?.effects || [];
          selectedClipEffects = [...clipEffects, ...lEffects];
      } else {
           // Layer Mode: Use active clip effects
           const activeCol = activeClipIndexes[selectedLayerIndex];
           if (activeCol !== null) {
               const clipEffects = source[selectedLayerIndex][activeCol]?.effects || [];
               selectedClipEffects = [...clipEffects, ...lEffects];
           } else {
               selectedClipEffects = lEffects;
           }
      }
  }

  const handleEffectParameterChange = useCallback((layerIndex, colIndex, effectIndex, paramName, newValue) => {
    // 1. Direct Mutation for Instant Preview
    if (liveClipContentsRef.current && liveClipContentsRef.current[layerIndex] && liveClipContentsRef.current[layerIndex][colIndex]) {
        const clip = liveClipContentsRef.current[layerIndex][colIndex];
        if (clip && clip.effects && clip.effects[effectIndex]) {
            clip.effects[effectIndex].params[paramName] = newValue;
            hasPendingClipUpdate.current = true; // Signal that we have a local update
        }
    }
    // 2. Dispatch for State Persistence - DEBOUNCED
    debouncedDispatch(
        `effect-${layerIndex}-${colIndex}-${effectIndex}-${paramName}`, 
        { type: 'UPDATE_EFFECT_PARAMETER', payload: { layerIndex, colIndex, effectIndex, paramName, newValue } }
    );
  }, [debouncedDispatch]);


  // Re-run generator when parameters of the selected clip change - REMOVED TO PREVENT LOOP

  useEffect(() => {
    if (!generatorWorker) return;

    const handleMessage = (e) => {
        if (e.data.browserFile) return;

        // Handle processing queue
        if (e.data.layerIndex !== undefined && e.data.colIndex !== undefined) {
            const clipKey = `${e.data.layerIndex}-${e.data.colIndex}`;
            generatorProcessingMap.current.set(clipKey, false); // Mark free
            
            // Check for pending
            if (generatorPendingMap.current.has(clipKey)) {
                const { message, transferables } = generatorPendingMap.current.get(clipKey);
                generatorPendingMap.current.delete(clipKey);
                
                // Send pending request
                generatorProcessingMap.current.set(clipKey, true);
                generatorWorker.postMessage(message, transferables);
            }
        }

        if (e.data.success) {
            const { layerIndex, colIndex, frames, generatorDefinition, currentParams, isLive, isAutoUpdate, seq } = e.data;

            if (layerIndex === undefined || colIndex === undefined) return;

            // Discard out-of-order responses for non-live updates
            if (seq !== undefined) {
                if (seq < latestProcessedSeqRef.current) return;
                latestProcessedSeqRef.current = seq;
            }

            // Update liveFrames ref regardless of whether it's a live update or param change
            const generatorWorkerId = `generator-${layerIndex}-${colIndex}`;
            liveFramesRef.current[generatorWorkerId] = frames[0];

            // Only dispatch to state if it's NOT a live frame update (i.e., it's a parameter change)
            // AND if it's NOT an automated update (prevents 60fps state updates during animation)
            // AND if it matches the latest requested sequence
            if (!isLive && !isAutoUpdate && seq === generatorRequestSeqRef.current) {
                const existingClip = clipContentsRef.current[layerIndex][colIndex] || {};
                
                const newClipContent = {
                    ...existingClip, // Preserve existing settings (syncSettings, audio, dacs, etc)
                    type: 'generator',
                    generatorDefinition,
                    frames,
                    stillFrame: frames[0], // Update still frame for thumbnail
                    currentParams,
                    // Preserve playbackSettings if they exist, otherwise use defaults
                    playbackSettings: existingClip.playbackSettings || {
                        mode: 'fps',
                        duration: frames.length / 60,
                        beats: 8,
                        speedMultiplier: 1
                    },
                };
                
                dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: newClipContent } });

                // Only update the clip name if it's currently the default name
                const currentName = clipNamesRef.current[layerIndex][colIndex];
                const defaultPattern = `Clip ${layerIndex + 1}-${colIndex + 1}`;
                if (currentName === defaultPattern) {
                    dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: generatorDefinition.name } });
                }
            } else {
                // If it's a live frame update or auto update, signal ready for the next one (for NDI etc)
                if (window.electronAPI && window.electronAPI.ndiSignalReady) {
                    window.electronAPI.ndiSignalReady();
                }
            }
        } else {
            showNotification(`Error generating frames: ${e.data.error}`);
        }
    };

    generatorWorker.addEventListener('message', handleMessage);

    return () => {
        generatorWorker.removeEventListener('message', handleMessage);
    };
  }, [generatorWorker]); // Removed state.clipContents, using ref instead

  const handleDropGenerator = useCallback((layerIndex, colIndex, generatorDefinition) => {
    if (generatorWorker) {
        
        // Initialize prev params to avoid immediate double-regen or diff issues
        const key = `${layerIndex}-${colIndex}`;
        const completeParams = { ...generatorDefinition.defaultParams };
        prevGeneratorParamsRef.current.set(key, JSON.stringify(completeParams));

        const seq = ++generatorRequestSeqRef.current;
        regenerateGeneratorClip(layerIndex, colIndex, generatorDefinition, generatorDefinition.defaultParams, seq);
    }
  }, [generatorWorker]);

  const regenerateGeneratorClip = async (layerIndex, colIndex, generatorDefinition, params, seq, isAutoUpdate = false) => {
    // Create a complete params object to ensure stability
    const completeParams = { ...generatorDefinition.defaultParams, ...params };
    const clipKey = `${layerIndex}-${colIndex}`;

    let fontBuffer = null;
    if (['text', 'ndi-source', 'spout-receiver'].includes(generatorDefinition.id)) {
      const defaultFontUrl = 'src/fonts/Geometr415 Blk BT Black.ttf';
      let fontUrl = completeParams.fontUrl || defaultFontUrl;

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
      seq, // Pass sequence number
      isAutoUpdate
    };
    
    const transferables = fontBuffer ? [fontBuffer] : [];

    // Throttling Logic
    if (generatorProcessingMap.current.get(clipKey)) {
        // Worker is busy for this clip, queue this request (replacing any previous pending)
        console.log(`[App.jsx] Generator ${clipKey} busy, queuing seq ${seq}`);
        generatorPendingMap.current.set(clipKey, { message, transferables });
    } else {
        // Worker is free, send immediately
        generatorProcessingMap.current.set(clipKey, true);
        if (uiGeneratorWorkerRef.current) {
            uiGeneratorWorkerRef.current.postMessage(message, transferables);
        }
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
                playAudio(layerIndex, clip.audioFile.path, clip.audioVolume ?? 1.0, true);
            }
        }
    });

    dispatch({ type: 'SET_IS_PLAYING', payload: true });
    dispatch({ type: 'SET_IS_STOPPED', payload: false });
  }, [resumeAllAudio, layers, activeClipIndexes, clipContents, getAudioInfo, playAudio]);

  const handlePause = useCallback(() => {
    pauseAllAudio();
    dispatch({ type: 'SET_IS_PLAYING', payload: false });
    dispatch({ type: 'SET_IS_STOPPED', payload: false });
  }, [pauseAllAudio]);

  const handleStop = useCallback(() => {
    resetAllAudio();
    pauseAllAudio();
    dispatch({ type: 'SET_IS_PLAYING', payload: false });
    dispatch({ type: 'SET_IS_STOPPED', payload: true });
    frameIndexesRef.current = {};
  }, [resetAllAudio, pauseAllAudio]);

  const handleClipPreview = useCallback((layerIndex, colIndex) => {
      dispatch({ type: 'SET_SELECTED_CLIP', payload: { layerIndex, colIndex } });
      const clip = clipContents[layerIndex][colIndex];
      if (clip && clip.type === 'ilda') {
          dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: clip.workerId, totalFrames: clip.totalFrames, generatorId: null, generatorParams: {} } });
      } else if (clip && clip.type === 'generator') {
          const generatorWorkerId = `generator-${layerIndex}-${colIndex}`; // Generate a workerId
          dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: generatorWorkerId, generatorId: clip.generatorDefinition.id, generatorParams: clip.currentParams, totalFrames: clip.frames.length } });
      } else {
        // Clip is empty, clear the selection data
        dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: null, totalFrames: 0, generatorId: null, generatorParams: {} } });
      }
  }, [clipContents]);

  const handleClipHover = useCallback((layerIndex, colIndex, isHovering) => {
      if (isHovering) {
          hoveredClipRef.current = { layerIndex, colIndex };
      } else {
          // Only clear if it matches the current one (prevent clearing if moved quickly to another)
          if (hoveredClipRef.current && hoveredClipRef.current.layerIndex === layerIndex && hoveredClipRef.current.colIndex === colIndex) {
              hoveredClipRef.current = null;
          }
      }
  }, []);

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

    if (clip && clip.type === 'generator' && clip.frames && clip.frames.length > 0) {
      const generatorWorkerId = `generator-${layerIndex}-${colIndex}`;
      // Ensure the frame is in liveFrames so WorldPreview can render it.
      liveFramesRef.current[generatorWorkerId] = clip.frames[0];
      lastFrameFetchTimeRef.current[generatorWorkerId] = performance.now();
      frameIndexesRef.current[generatorWorkerId] = 0;
    } else if (clip && clip.type === 'ilda' && clip.workerId) {
      lastFrameFetchTimeRef.current[clip.workerId] = performance.now();
      frameIndexesRef.current[clip.workerId] = 0;
    }

    // Manage associated audio: load/cue it regardless of playback state, but only play if `isPlaying`
    if (clip && clip.audioFile) {
        playAudio(layerIndex, clip.audioFile.path, clip.audioVolume ?? 1.0, isPlaying).catch(err => {
            console.warn(`Failed to play audio for clip ${layerIndex}-${colIndex}:`, err);
            // Add to missing files if it's a "NotSupportedError" or similar (usually indicates file issues)
            // Note: error.code might be useful.
            setMissingFiles(prev => {
                const reqId = `audio-${layerIndex}-${colIndex}`;
                if (prev.some(f => f.requestId === reqId)) return prev;
                return [...prev, { 
                    filePath: clip.audioFile.path, 
                    fileName: clip.audioFile.name || clip.audioFile.path.split(/[/\\]/).pop(), 
                    requestId: reqId,
                    type: 'audio' 
                }];
            });
        });
    } else {
        stopAudio(layerIndex);
    }

    // Record activation time
    clipActivationTimesRef.current[layerIndex] = performance.now();

    dispatch({ type: 'SET_ACTIVE_CLIP', payload: { layerIndex, colIndex } });

    // Capture still frame for thumbnail
    if (clip) {
        if (clip.type === 'ilda' && clip.workerId) {
            const currentIndex = frameIndexesRef.current[clip.workerId] || 0;
            dispatch({ type: 'UPDATE_THUMBNAIL', payload: { layerIndex, colIndex, frameIndex: currentIndex } });
        } else if (clip.type === 'generator' && clip.frames) {
            const currentIdx = frameIndexesRef.current[`generator-${layerIndex}-${colIndex}`] || 0;
            const currentFrame = clip.frames[currentIdx % clip.frames.length];
            if (currentFrame) {
                dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { stillFrame: currentFrame } } });
            }
        }
    }
  }, [clipContents, activeClipIndexes, handleDeactivateLayerClips, playAudio, isPlaying, stopAudio, handleClipPreview]);
	
  const handleDropEffectOnClip = useCallback((layerIndex, colIndex, effectData) => {
      // 1. Direct Mutation for Instant Preview
      if (liveClipContentsRef.current && liveClipContentsRef.current[layerIndex] && liveClipContentsRef.current[layerIndex][colIndex]) {
          // Ensure layer array is cloned if we were strictly immutable, but for ref we just need to ensure the object structure exists
          const clip = liveClipContentsRef.current[layerIndex][colIndex];
          if (clip) {
              const newEffectInstance = {
                  ...effectData,
                  instanceId: generateId(),
                  params: { ...effectData.defaultParams }
              };
              clip.effects = [...(clip.effects || []), newEffectInstance];
              hasPendingClipUpdate.current = true;
          }
      }
      
      dispatch({ type: 'ADD_CLIP_EFFECT', payload: { layerIndex, colIndex, effect: effectData } });
  }, []);

  const handleDropEffectOnLayer = useCallback((layerIndex, effectId) => {
    // Find effect definition
    const effectData = effectDefinitions.find(e => (e.id || e.name) === effectId);
    if (effectData) {
        dispatch({ type: 'ADD_LAYER_EFFECT', payload: { layerIndex, effect: effectData } });
    }
  }, []);

  const handleDropDac = useCallback((layerIndex, colIndex, dacData) => {
      hasPendingClipUpdate.current = true;
      dispatch({ type: 'SET_CLIP_DAC', payload: { layerIndex, colIndex, dac: dacData } });
  }, []);

  const handleDropDacOnLayer = useCallback((layerIndex, dacData) => {
    dispatch({ type: 'SET_LAYER_DAC', payload: { layerIndex, dac: dacData } });
  }, []);

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
      let currentClip = null;
      let paramsSource = {};

      // 1. Direct Mutation for Instant Preview & Source of Truth
      if (liveClipContentsRef.current && liveClipContentsRef.current[selectedLayerIndex] && liveClipContentsRef.current[selectedLayerIndex][selectedColIndex]) {
          const liveClip = liveClipContentsRef.current[selectedLayerIndex][selectedColIndex];
          if (liveClip && liveClip.currentParams) {
              liveClip.currentParams[paramName] = newValue;
              hasPendingClipUpdate.current = true;
              currentClip = liveClip;
              paramsSource = liveClip.currentParams;
          }
      }

      // Fallback to state if live ref failed (unlikely)
      if (!currentClip) {
          currentClip = clipContents[selectedLayerIndex][selectedColIndex];
          if (currentClip && currentClip.currentParams) {
             paramsSource = { ...currentClip.currentParams, [paramName]: newValue };
          }
      }

      if (!currentClip || !currentClip.generatorDefinition) return;

      // Dispatch the state update (Persistence) - DEBOUNCED
      debouncedDispatch(
          `generator-${selectedLayerIndex}-${selectedColIndex}-${paramName}`,
          {
              type: 'UPDATE_GENERATOR_PARAM',
              payload: {
                  layerIndex: selectedLayerIndex,
                  colIndex: selectedColIndex,
                  paramName,
                  newValue,
              },
          }
      );

      // Update the previous params ref to prevent the useEffect from triggering a double regeneration
      const key = `${selectedLayerIndex}-${selectedColIndex}`;
      const completeParams = { ...currentClip.generatorDefinition.defaultParams, ...paramsSource };
      prevGeneratorParamsRef.current.set(key, JSON.stringify(completeParams));

      // Immediately trigger regeneration with the new parameters
      // Use paramsSource which contains the accumulated latest state
      const seq = ++generatorRequestSeqRef.current;
      regenerateGeneratorClip(selectedLayerIndex, selectedColIndex, currentClip.generatorDefinition, paramsSource, seq, false);
    }
  };

  const selectedClip = selectedLayerIndex !== null && selectedColIndex !== null
    ? clipContents[selectedLayerIndex][selectedColIndex]
    : null;

  // NDI Lifecycle Management
  useEffect(() => {
      if (!window.electronAPI || !generatorWorker) return;

      const checkNdiClips = async () => {
          // Find any active NDI clip
          let activeNdiClip = null;
          layers.forEach((_, layerIndex) => {
              const activeColIndex = activeClipIndexes[layerIndex];
              if (activeColIndex !== null) {
                  const clip = clipContents[layerIndex][activeColIndex];
                  if (clip && clip.type === 'generator' && clip.generatorDefinition?.id === 'ndi-source') {
                      activeNdiClip = clip;
                  }
              }
          });

          // Also check selected clip for preview
          if (!activeNdiClip && selectedClip?.type === 'generator' && selectedClip?.generatorDefinition?.id === 'ndi-source') {
              activeNdiClip = selectedClip;
          }

          const currentSourceName = activeNdiClip?.currentParams?.sourceName;

          if (currentSourceName && currentSourceName !== 'No Source') {
              if (currentSourceName !== lastNdiSourceNameRef.current) {
                  console.log(`[NDI] Switching to source: ${currentSourceName}`);
                  await window.electronAPI.ndiCreateReceiver(currentSourceName);
                  lastNdiSourceNameRef.current = currentSourceName;
              }
          } else if (lastNdiSourceNameRef.current) {
              console.log(`[NDI] Destroying receiver`);
              await window.electronAPI.ndiDestroyReceiver();
              lastNdiSourceNameRef.current = null;
          }
      };

      checkNdiClips();
  }, [activeClipIndexes, clipContents, selectedClip, layers]);

  // Sync NDI Settings (Resolution)
  useEffect(() => {
      const activeNdiClip = [...activeClipsData, selectedClip].find(c => c?.type === 'generator' && c?.generatorDefinition?.id === 'ndi-source');
      if (activeNdiClip && window.electronAPI?.ndiUpdateSettings) {
          const { captureWidth, captureHeight } = activeNdiClip.currentParams || {};
          if (captureWidth && captureHeight) {
              window.electronAPI.ndiUpdateSettings({ width: captureWidth, height: captureHeight });
          }
      }
  }, [activeClipsData, selectedClip]);

  // NDI Frame Handling
  useEffect(() => {
      if (!window.electronAPI || !generatorWorker) return;

      const unsubscribe = window.electronAPI.onNdiFrame((frame) => {
          // Forward frame to generator worker for processing
          // Use refs for high-frequency loop to avoid closure staleness and overhead
          activeClipIndexesRef.current.forEach((activeColIndex, layerIndex) => {
              if (activeColIndex === null) return;
              const clip = clipContentsRef.current[layerIndex][activeColIndex];
              if (clip && clip.type === 'generator' && clip.generatorDefinition?.id === 'ndi-source') {
                  generatorWorker.postMessage({
                      type: 'generate',
                      layerIndex,
                      colIndex: activeColIndex,
                      generator: clip.generatorDefinition,
                      params: { ...clip.generatorDefinition.defaultParams, ...clip.currentParams },
                      ndiFrame: frame, // Pass the raw frame data
                      isLive: true // Flag to indicate this is a live frame update
                  });
              }
          });

          // Also handle selected clip preview
          if (selectedClip?.type === 'generator' && selectedClip?.generatorDefinition?.id === 'ndi-source') {
              generatorWorker.postMessage({
                  type: 'generate',
                  layerIndex: selectedLayerIndex,
                  colIndex: selectedColIndex,
                  generator: selectedClip.generatorDefinition,
                  params: { ...selectedClip.generatorDefinition.defaultParams, ...selectedClip.currentParams },
                  ndiFrame: frame,
                  isLive: true
              });
          }
      });

      return () => unsubscribe();
  }, [activeClipIndexes, clipContents, selectedClip, selectedLayerIndex, selectedColIndex, layers, generatorWorker]);

  const handleUpdateQuickControl = useCallback((type, index, value) => {
      const collection = type === 'knob' ? 'knobs' : 'buttons';
      const control = state.quickAssigns[collection][index];
      
      if (control.link) {
          const { layerIndex, colIndex, effectIndex, targetType } = control.link;
          const paramName = control.link.paramName || control.link.paramId;
          
          let targetValue = value;
          if (type === 'knob' && control.min !== undefined && control.max !== undefined) {
              targetValue = control.min + (value * (control.max - control.min));
              if (control.step) targetValue = Math.round(targetValue / control.step) * control.step;
              targetValue = parseFloat(targetValue.toFixed(5));
          }

          // 1. IMMEDIATE LIVE UPDATES (Non-destructive mutation of refs)
          if (targetType === 'global') {
              if (paramName === 'master_intensity') masterIntensityRef.current = targetValue;
              else if (paramName === 'master_speed') playbackFpsRef.current = targetValue;
          } else if (targetType === 'layerEffect') {
              if (layerEffectsRef.current[layerIndex] && layerEffectsRef.current[layerIndex][effectIndex]) {
                  layerEffectsRef.current[layerIndex][effectIndex].params[paramName] = targetValue;
              }
          } else if (targetType === 'effect' || targetType === 'generator') {
              if (liveClipContentsRef.current && liveClipContentsRef.current[layerIndex] && liveClipContentsRef.current[layerIndex][colIndex]) {
                  const clip = liveClipContentsRef.current[layerIndex][colIndex];
                  if (targetType === 'effect' && clip.effects && clip.effects[effectIndex]) {
                      clip.effects[effectIndex].params[paramName] = targetValue;
                  } else if (targetType === 'generator' && clip.currentParams) {
                      clip.currentParams[paramName] = targetValue;
                  }
                  hasPendingClipUpdate.current = true;
              }
          }
      }

      // 2. DEBOUNCED STATE UPDATE (For UI and persistence)
      debouncedDispatch(
          `quick-${type}-${index}`, 
          { type: 'UPDATE_QUICK_CONTROL', payload: { type, index, value } }
      );
  }, [state.quickAssigns, debouncedDispatch]);

  const handleMidiCommand = useCallback((id, value, maxValue = 127, type = 'noteon') => {
    // Basic threshold for button triggers to avoid noise or NoteOff (velocity 0)
    // ALLOW value 0 if it's a clip trigger (to support Flash mode release)
    if (value === 0 && !id.endsWith('_intensity') && id !== 'master_intensity' && id !== 'master_speed' && !id.startsWith('clip_') && id !== 'bpm_value' && id !== 'bpm_fine_up' && id !== 'bpm_fine_down' && !id.startsWith('quick_') && !id.startsWith('dimmer_')) return;

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
        masterIntensityRef.current = normalizedValue;
        debouncedDispatch('master_intensity', { type: 'SET_MASTER_INTENSITY', payload: normalizedValue });
        break;
      case 'master_speed':
        // Map 0-1 to 1-120 FPS
        const newFps = Math.max(1, Math.round(normalizedValue * 120));
        debouncedDispatch('master_speed', { type: 'SET_RENDER_SETTING', payload: { setting: 'playbackFps', value: newFps } });
        break;
      case 'laser_output':
        if (value > 0) dispatch({ type: 'TOGGLE_WORLD_OUTPUT_ACTIVE' });
        break;
      case 'bpm_value':
        if (type === 'controlchange') {
            // Check for relative encoder behavior (APC40 style)
            // If value is small (1, 2...) it's +, if large (127, 126...) it's -
            let delta = 0;
            if (value <= 10) delta = value; // Right turn
            else if (value >= 118) delta = value - 128; // Left turn (127 -> -1)

            if (delta !== 0) {
                dispatch({ type: 'SET_BPM', payload: Math.max(1, Math.min(999, (state.bpm || 120) + delta)) });
            }
        }
        break;
      case 'bpm_fine_up':
        if (value > 0) dispatch({ type: 'SET_BPM', payload: Math.min(999, (state.bpm || 120) + 0.1) });
        break;
      case 'bpm_fine_down':
        if (value > 0) dispatch({ type: 'SET_BPM', payload: Math.max(1, (state.bpm || 120) - 0.1) });
        break;
      case 'bpm_tap':
        if (value > 0) {
            // We can't easily call handleTap here, but we can implement the logic
            // For now, let's keep it simple as the user didn't ask for MIDI tap yet
        }
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
                 layerIntensitiesRef.current[layerIndex] = normalizedValue;
                 debouncedDispatch(`layer_${layerIndex}_intensity`, { type: 'SET_LAYER_INTENSITY', payload: { layerIndex, intensity: normalizedValue } });
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
        } else if (id.startsWith('quick_knob_')) {
            const index = parseInt(id.split('_')[2]);
            handleUpdateQuickControl('knob', index, normalizedValue);
        } else if (id.startsWith('quick_btn_')) {
            const index = parseInt(id.split('_')[2]);
            if (value > 0) { // Toggle on press
                dispatch({ type: 'TOGGLE_QUICK_BUTTON', payload: { index } });
            }
        } else if (id.startsWith('dimmer_')) {
            // Reconstruct the key: dimmer_192_168_1_50:1 -> 192.168.1.50:1
            const cleanId = id.replace('dimmer_', '').replace(/_/g, '.');
            const currentSettings = dacOutputSettings[cleanId] || {};
            dispatch({ 
                type: 'SET_DAC_OUTPUT_SETTINGS', 
                payload: { 
                    id: cleanId, 
                    settings: { ...currentSettings, dimmer: normalizedValue } 
                } 
            });
        } else {
            // Check if it matches an effect parameter (e.g. rotate_angle)
            // This applies to the CURRENTLY SELECTED CLIP
            const parts = id.split('_');
            if (parts.length >= 2) {
                // Try to map to effect param
                // Format could be "rotate_angle" or "color_r"
                // We iterate selected clip effects to find a match
                if (selectedLayerIndex !== null && selectedColIndex !== null) {
                    const clip = clipContents[selectedLayerIndex][selectedColIndex];
                    if (clip && clip.effects) {
                        const effId = parts[0];
                        const paramId = parts.slice(1).join('_'); // Handle params with underscores
                        
                        const effectIndex = clip.effects.findIndex(e => e.id === effId);
                        if (effectIndex !== -1) {
                            const def = effectDefinitions.find(d => d.id === effId);
                            const ctrl = def?.paramControls.find(c => c.id === paramId);
                            
                            if (ctrl) {
                                // Map normalized MIDI (0-1) to param range
                                let newValue = normalizedValue;
                                if (ctrl.type === 'range' || ctrl.type === 'number') {
                                    newValue = ctrl.min + (ctrl.max - ctrl.min) * normalizedValue;
                                } else if (ctrl.type === 'checkbox') {
                                    newValue = normalizedValue > 0.5;
                                }
                                
                                dispatch({ 
                                    type: 'UPDATE_EFFECT_PARAMETER', 
                                    payload: { 
                                        layerIndex: selectedLayerIndex, 
                                        colIndex: selectedColIndex, 
                                        effectIndex, 
                                        paramName: paramId, 
                                        newValue 
                                    } 
                                });
                            }
                        }
                    }
                }
            }
        }
    }
  }, [handlePlay, handlePause, handleStop, handleClearAllActive, handleDeactivateLayerClips, handlePlaybackFpsChange, state.bpm, handleClipPreview, handleActivateClick, handleColumnTrigger, clipContents, selectedLayerIndex, selectedColIndex, dacOutputSettings]);

  const handleToggleBeamEffect = useCallback((target) => {
      if (target === 'world') {
          const currentVal = state.worldShowBeamEffect ?? true; // Default to true if undefined
          const newValue = !currentVal;
          
          dispatch({ type: 'SET_RENDER_SETTING', payload: { setting: 'worldShowBeamEffect', value: newValue } });
          
          if (window.electronAPI && window.electronAPI.setRenderSettings) {
              const newSettings = {
                  ...state.renderSettings,
                  showBeamEffect: state.showBeamEffect,
                  beamRenderMode: state.beamRenderMode,
                  previewScanRate: state.previewScanRate,
                  beamAlpha: state.beamAlpha,
                  fadeAlpha: state.fadeAlpha,
                  worldShowBeamEffect: newValue,
                  worldBeamRenderMode: state.worldBeamRenderMode ?? 'both'
              };
              window.electronAPI.setRenderSettings(newSettings);
          }
      } else {
          // Clip Preview (Legacy/Default)
          const newValue = !showBeamEffect;
          dispatch({ type: 'SET_RENDER_SETTING', payload: { setting: 'showBeamEffect', value: newValue } });
          
          if (window.electronAPI && window.electronAPI.setRenderSettings) {
              const newSettings = {
                  showBeamEffect: newValue,
                  beamRenderMode,
                  previewScanRate,
                  beamAlpha,
                  fadeAlpha,
                  worldShowBeamEffect: state.worldShowBeamEffect ?? true,
                  worldBeamRenderMode: state.worldBeamRenderMode ?? 'both'
              };
              window.electronAPI.setRenderSettings(newSettings);
          }
      }
  }, [showBeamEffect, beamRenderMode, previewScanRate, beamAlpha, fadeAlpha, state.worldShowBeamEffect, state.worldBeamRenderMode]);

  const handleCycleDisplayMode = useCallback((target) => {
      if (target === 'world') {
          const currentMode = state.worldBeamRenderMode ?? 'both';
          let nextMode = 'points';
          if (currentMode === 'both') nextMode = 'points';
          else if (currentMode === 'points') nextMode = 'lines';
          else if (currentMode === 'lines') nextMode = 'both';
          
          dispatch({ type: 'SET_RENDER_SETTING', payload: { setting: 'worldBeamRenderMode', value: nextMode } });
          
          if (window.electronAPI && window.electronAPI.setRenderSettings) {
              const newSettings = {
                  showBeamEffect,
                  beamRenderMode,
                  previewScanRate,
                  beamAlpha,
                  fadeAlpha,
                  worldShowBeamEffect: state.worldShowBeamEffect ?? true,
                  worldBeamRenderMode: nextMode
              };
              window.electronAPI.setRenderSettings(newSettings);
          }
      } else {
          let nextMode = 'points';
          if (beamRenderMode === 'both') nextMode = 'points';
          else if (beamRenderMode === 'points') nextMode = 'lines';
          else if (beamRenderMode === 'lines') nextMode = 'both';
          
          dispatch({ type: 'SET_RENDER_SETTING', payload: { setting: 'beamRenderMode', value: nextMode } });
          
          if (window.electronAPI && window.electronAPI.setRenderSettings) {
              const newSettings = {
                  showBeamEffect,
                  beamRenderMode: nextMode,
                  previewScanRate,
                  beamAlpha,
                  fadeAlpha,
                  worldShowBeamEffect: state.worldShowBeamEffect ?? true,
                  worldBeamRenderMode: state.worldBeamRenderMode ?? 'both'
              };
              window.electronAPI.setRenderSettings(newSettings);
          }
      }
  }, [showBeamEffect, beamRenderMode, previewScanRate, beamAlpha, fadeAlpha, state.worldShowBeamEffect, state.worldBeamRenderMode]);

  const handleToggleWorldOutput = useCallback(() => {
    const nextActive = !isWorldOutputActive;
    dispatch({ type: 'SET_WORLD_OUTPUT_ACTIVE', payload: nextActive });
    
    if (window.electronAPI) {
        if (nextActive) {
            // Trigger handshake for all available DACs
            // We use the dacs list from state
            state.dacs.forEach(dac => {
                window.electronAPI.startDacOutput(dac.ip, dac.type);
            });
        } else {
            // Stop output for all DACs
            state.dacs.forEach(dac => {
                window.electronAPI.stopDacOutput(dac.ip, dac.type);
            });
        }
    }
  }, [isWorldOutputActive, state.dacs]);

  const handleRelocate = async (fileEntry) => {
      if (!window.electronAPI || !window.electronAPI.showOpenDialog) return;

      try {
          const response = await window.electronAPI.showOpenDialog({
              title: `Locate missing file: ${fileEntry.fileName}`,
              defaultPath: fileEntry.filePath,
              filters: [{ name: 'ILDA Files', extensions: ['ild'] }, { name: 'All Files', extensions: ['*'] }],
              properties: ['openFile']
          });

          if (response) {
              const newPath = response;
              const sep = window.electronAPI.pathSeparator || (newPath.includes('/') ? '/' : '\\');
              
              // 1. Resolve the specifically selected file
              dispatch({ type: 'UPDATE_CLIP_FILE_PATH', payload: { oldPath: fileEntry.filePath, newPath } });
              
              if (fileEntry.type !== 'audio') {
                  const newArrayBuffer = await window.electronAPI.readFileForWorker(newPath);
                  if (ildaParserWorker) {
                      ildaParserWorker.postMessage({
                          type: 'file-content-response',
                          requestId: fileEntry.requestId,
                          arrayBuffer: newArrayBuffer,
                      }, [newArrayBuffer]);
                  }
              }

              // Remove from missing list
              setMissingFiles(prev => prev.filter(f => f.requestId !== fileEntry.requestId));

              // 2. Auto-resolve others by scanning ALL clips
              // We infer the old directory from the fileEntry
              const getDir = (p) => p.substring(0, p.lastIndexOf(sep));
              const getFile = (p) => p.substring(p.lastIndexOf(sep) + 1);
              
              const oldDirectory = getDir(fileEntry.filePath);
              const newDirectory = getDir(newPath);
              
              console.log(`[Relocate] Scanning for other files moving from [${oldDirectory}] to [${newDirectory}]`);

              // Flatten all clips to iterate easily
              const allClips = stateRef.current.clipContents.flat().filter(c => c);
              const processedOldPaths = new Set([fileEntry.filePath]);

              for (const clip of allClips) {
                  // Check ILDA File
                  if (clip.type === 'ilda' && clip.filePath && !processedOldPaths.has(clip.filePath)) {
                       // Check if this file was in the old directory
                       if (getDir(clip.filePath) === oldDirectory) {
                           const fileName = getFile(clip.filePath);
                           const potentialPath = `${newDirectory}${sep}${fileName}`;
                           
                           // Avoid redundant checks if path is unchanged (unlikely here but safe)
                           if (clip.filePath !== potentialPath) {
                               const exists = await window.electronAPI.checkFileExists(potentialPath);
                               if (exists) {
                                   console.log(`[Relocate] Auto-resolving ILDA: ${fileName}`);
                                   dispatch({ type: 'UPDATE_CLIP_FILE_PATH', payload: { oldPath: clip.filePath, newPath: potentialPath } });
                                   processedOldPaths.add(clip.filePath);
                                   
                                   // Try to satisfy worker if it was waiting
                                   if (ildaParserWorker) {
                                       // We don't have the requestId easily here unless we look at missingFiles
                                       // But updating the path prevents future errors. 
                                       // If it was already missing, we should remove it from missingFiles
                                       setMissingFiles(prev => prev.filter(f => f.filePath !== clip.filePath));
                                   }
                               }
                           }
                       }
                  }

                  // Check Audio File
                  if (clip.audioFile && clip.audioFile.path && !processedOldPaths.has(clip.audioFile.path)) {
                       if (getDir(clip.audioFile.path) === oldDirectory) {
                           const fileName = getFile(clip.audioFile.path);
                           const potentialPath = `${newDirectory}${sep}${fileName}`;
                           
                           if (clip.audioFile.path !== potentialPath) {
                               const exists = await window.electronAPI.checkFileExists(potentialPath);
                               if (exists) {
                                   console.log(`[Relocate] Auto-resolving Audio: ${fileName}`);
                                   dispatch({ type: 'UPDATE_CLIP_FILE_PATH', payload: { oldPath: clip.audioFile.path, newPath: potentialPath } });
                                   processedOldPaths.add(clip.audioFile.path);
                                   setMissingFiles(prev => prev.filter(f => f.filePath !== clip.audioFile.path));
                               }
                           }
                       }
                  }
              }
          }
      } catch (error) {
          console.error("Relocation failed:", error);
          showNotification(`Relocation failed: ${error.message}`);
      }
  };

  const handleThumbnailError = useCallback((layerIndex, colIndex) => {
      console.log(`Thumbnail load error for ${layerIndex}-${colIndex}, requesting regeneration...`);
      // Use live ref to get latest clip data if possible
      const clip = clipContentsRef.current[layerIndex][colIndex];
      
      if (clip) {
          if (clip.type === 'ilda' && clip.workerId && ildaParserWorker) {
              const frameIndex = thumbnailFrameIndexes[layerIndex][colIndex] || 0;
              ildaParserWorker.postMessage({
                  type: 'get-frame',
                  workerId: clip.workerId,
                  frameIndex: frameIndex,
                  isStillFrame: true,
                  layerIndex,
                  colIndex,
              });
          } else if (clip.type === 'generator' && clip.stillFrame) {
               generateThumbnail(clip.stillFrame, clip.effects, layerIndex, colIndex).then(path => {
                   if (path) {
                       dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { thumbnailPath: path, thumbnailVersion: Date.now() } } });
                   }
               });
          }
      }
  }, [clipContentsRef, thumbnailFrameIndexes, ildaParserWorker]);

  const handleAudioError = useCallback((layerIndex, colIndex) => {
      // Use live ref to get latest clip data if possible
      const clip = clipContentsRef.current[layerIndex][colIndex];
      
      if (clip && clip.audioFile) {
          setMissingFiles(prev => {
                const reqId = `audio-${layerIndex}-${colIndex}`;
                if (prev.some(f => f.requestId === reqId)) return prev;
                return [...prev, { 
                    filePath: clip.audioFile.path, 
                    fileName: clip.audioFile.name || clip.audioFile.path.split(/[/\\]/).pop(), 
                    requestId: reqId,
                    type: 'audio' 
                }];
            });
      }
  }, [clipContentsRef]);

  return (
    <MidiProvider onMidiCommand={handleMidiCommand}>
    <ArtnetProvider onArtnetCommand={(id, value) => handleMidiCommand(id, value, 255)}>
    <KeyboardProvider onCommand={handleMidiCommand} enabled={enabledShortcuts.keyboard}>
    <MidiFeedbackHandler
        isPlaying={isPlaying}
        globalBlackout={globalBlackout}
        layerBlackouts={layerBlackouts}
        layerSolos={layerSolos}
        isWorldOutputActive={isWorldOutputActive}
        clipContents={clipContents}
        activeClipIndexes={activeClipIndexes}
        theme={theme}
        bpm={state.bpm}
        quickAssigns={state.quickAssigns}
    />
    <MidiMappingOverlay />
    <div className="app">
      <ErrorBoundary>
        <NotificationPopup message={notification.message} visible={notification.visible} />
        <OutputSettingsWindow
            show={showOutputSettingsWindow}
            onClose={() => setShowOutputSettingsWindow(false)}
            dacs={dacs}
            dacSettings={dacOutputSettings}
            onUpdateDacSettings={handleUpdateDacSettings}
        />
        <AudioSettingsWindow
            show={showAudioSettingsWindow || showFftSettingsWindow}
            onClose={() => { setShowAudioSettingsWindow(false); setShowFftSettingsWindow(false); }}
            initialTab={showFftSettingsWindow ? 'fft' : 'output'}
        />
        <RenameModal
            show={showRenameModal}
            title={renameModalConfig.title}
            initialValue={renameModalConfig.initialValue}
            onSave={renameModalConfig.onSave}
            onClose={() => setShowShortcutsWindow(false) || setShowRenameModal(false)}
        />
        <RelocateModal 
            missingFiles={missingFiles}
            onRelocate={handleRelocate}
            onClose={() => setMissingFiles([])}
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
                onToggleWorldOutput={handleToggleWorldOutput}
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
                  onDropEffect={(effectId) => handleDropEffectOnLayer(layerIndex, effectId)}
                  onDropDac={(layerIndex, dacData) => handleDropDacOnLayer(layerIndex, dacData)}
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
                  onLayerSelect={(idx) => dispatch({ type: 'SET_SELECTED_CLIP', payload: { layerIndex: idx, colIndex: null } })}
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
                    const currentClipContent = clipContents?.[layerIndex]?.[colIndex];

                    // Determine workerId for this clip to fetch frames
                    let clipWorkerId = null;
                    if (currentClipContent && currentClipContent.type === 'ilda') {
                      clipWorkerId = currentClipContent.workerId;
                    } else if (currentClipContent && currentClipContent.type === 'generator') {
                      clipWorkerId = `generator-${layerIndex}-${colIndex}`;
                    }

                    const clipLiveFrame = clipWorkerId ? liveFramesRef.current[clipWorkerId] : null;
                    const clipStillFrame = currentClipContent?.stillFrame || (currentClipContent?.type === 'generator' ? currentClipContent.frames?.[0] : null);

                    return (
                      <Clip
                        key={colIndex}
                        layerIndex={layerIndex}
                        colIndex={colIndex}
                        clipName={clipNames?.[layerIndex]?.[colIndex] || `Clip ${layerIndex + 1}-${colIndex + 1}`}
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
                            handleDropDac(passedLayerIndex, passedColIndex, dacDataFromClip);
                        }}
                        onLabelClick={() => handleClipPreview(layerIndex, colIndex)}
                        isSelected={selectedLayerIndex === layerIndex && selectedColIndex === colIndex}
                        ildaParserWorker={ildaParserWorker}
                        onClipHover={handleClipHover}
                        onThumbnailError={handleThumbnailError}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
			<SidePanelContainer 
                clipContents={clipContents}
                activeClipIndexes={activeClipIndexes}
                layerEffects={layerEffects}
                bpm={state.bpm}
                playbackFps={playbackFps}
                selectedLayerIndex={selectedLayerIndex}
                selectedColIndex={selectedColIndex}
                liveFramesRef={liveFramesRef}
                progressRef={progressRef}
                selectedDac={selectedDac}
                liveDacOutputSettingsRef={liveDacOutputSettingsRef}
                dacOutputSettings={dacOutputSettings}
                getAudioInfo={getAudioInfo}
                fftLevels={fftLevels}
                getFftLevels={getFftLevels}
                effectStatesRef={effectStatesRef}
                clipActivationTimesRef={clipActivationTimesRef}
                showBeamEffect={showBeamEffect}
                beamAlpha={beamAlpha}
                fadeAlpha={fadeAlpha}
                previewScanRate={previewScanRate}
                beamRenderMode={beamRenderMode}
                worldShowBeamEffect={worldShowBeamEffect}
                worldBeamRenderMode={worldBeamRenderMode}
                masterIntensity={masterIntensity}
                layerIntensities={layerIntensities}
                globalBlackout={globalBlackout}
                layerSolos={layerSolos}
                layerBlackouts={layerBlackouts}
                handleToggleBeamEffect={handleToggleBeamEffect}
                handleCycleDisplayMode={handleCycleDisplayMode}
                previewFrameCountRef={previewFrameCountRef}
                totalPointsSentRef={totalPointsSentRef}
                activeChannelsCountRef={activeChannelsCountRef}
                lastStatUpdateTimeRef={lastStatUpdateTimeRef}
                liveClipContentsRef={liveClipContentsRef}
            />
            <div className="middle-bar">
                <div className="middle-bar-left-area">
                    <BPMControls
                        bpm={state.bpm}
                        onBpmChange={(newBpm) => dispatch({ type: 'SET_BPM', payload: newBpm })}
                    />
                </div>
                    <div className="middle-bar-mid-area">
                        <TransportControls
                            onPlay={handlePlay}
                            onPause={handlePause}
                            onStop={handleStop}
                            isPlaying={isPlaying}
                            isStopped={state.isStopped}
                        />
						<MasterSpeedSlider playbackFps={playbackFps} onSpeedChange={handlePlaybackFpsChange} />
                    </div>
				<div className="middle-bar-right-area">
                </div>
            </div>
		<div className="bottom-panel">
            <div className="bottom-panel-tabs-container-1">
                <div className="bottom-panel-tabs-1">
                    <button className={`tab-button-1 ${activeBottomTab_1 === 'files' ? 'active' : ''}`} onClick={() => setActiveBottomTab_1('files')}>Files</button>
                    <button className={`tab-button-1 ${activeBottomTab_1 === 'generators' ? 'active' : ''}`} onClick={() => setActiveBottomTab_1('generators')}>Generators</button>
                    <button className={`tab-button-1 ${activeBottomTab_1 === 'effects' ? 'active' : ''}`} onClick={() => setActiveBottomTab_1('effects')}>Effects</button>
                </div>
                <div className="bottom-panel-tab-content-1">
                    {activeBottomTab_1 === 'files' && <FileBrowser 
                        viewMode={state.fileBrowserViewMode}
                        onViewModeChange={(mode) => dispatch({ type: 'SET_FILE_BROWSER_VIEW_MODE', payload: mode })}
                        onDropIld={(layerIndex, colIndex, file) => ildaParserWorker.postMessage({ type: 'parse-ilda', file, layerIndex, colIndex })} 
                    />}
                    {activeBottomTab_1 === 'generators' && <GeneratorPanel />}
                    {activeBottomTab_1 === 'effects' && <EffectPanel />}
                </div>
            </div>
            
			<div className="bottom-panel-tabs-container-2">
				<div className="bottom-panel-tabs-2">
					<button className={`tab-button-2 ${activeBottomTab_2 === 'clip' ? 'active' : ''}`} onClick={() => setActiveBottomTab_2('clip')}>Clip-Settings</button>
					<button className={`tab-button-2 ${activeBottomTab_2 === 'layer' ? 'active' : ''}`} onClick={() => setActiveBottomTab_2('layer')}>Layer-Settings</button>
				</div>
				<div className="bottom-panel-tab-content-2">
					{activeBottomTab_2 === 'clip' && <ClipSettingsPanel
						selectedLayerIndex={selectedLayerIndex}
						selectedColIndex={selectedColIndex}
						clip={selectedClip}
						audioInfo={getAudioInfo(selectedLayerIndex)}
						bpm={state.bpm}
						getFftLevels={getFftLevels}
						onAssignAudio={async () => {
							const filePath = await window.electronAPI.showAudioFileDialog();
							if (filePath) {
								const fileName = filePath.split(/[\\/]/).pop();
								dispatch({ type: 'SET_CLIP_AUDIO', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, audioFile: { path: filePath, name: fileName } } });
							}
						}}
						onRemoveAudio={() => {
							stopAudio(selectedLayerIndex);
							dispatch({ type: 'REMOVE_CLIP_AUDIO', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex } });
						}}
						onUpdateAudioVolume={(lIdx, cIdx, volume) => {
							dispatch({ type: 'SET_CLIP_AUDIO_VOLUME', payload: { layerIndex: lIdx, colIndex: cIdx, volume } });
							setClipVolume(lIdx, volume);
						}}
						onUpdatePlaybackSettings={(lIdx, cIdx, settings) => dispatch({ type: 'UPDATE_CLIP_PLAYBACK_SETTINGS', payload: { layerIndex: lIdx, colIndex: cIdx, settings } })}
						onSetParamSync={(paramId, syncMode) => dispatch({ type: 'SET_CLIP_PARAM_SYNC', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, paramId, syncMode } })}
						onToggleDacMirror={(lIdx, cIdx, dIdx, axis) => dispatch({ type: 'TOGGLE_CLIP_DAC_MIRROR', payload: { layerIndex: lIdx, colIndex: cIdx, dacIndex: dIdx, axis } })}
						onRemoveDac={(dacIndex) => dispatch({ type: 'REMOVE_CLIP_DAC', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, dacIndex } })}
						onRemoveEffect={(lIdx, cIdx, eIdx) => dispatch({ type: 'REMOVE_CLIP_EFFECT', payload: { layerIndex: lIdx, colIndex: cIdx, effectIndex: eIdx } })}
						onReorderEffects={(lIdx, cIdx, oldIdx, newIdx) => dispatch({ type: 'REORDER_CLIP_EFFECTS', payload: { layerIndex: lIdx, colIndex: cIdx, oldIndex: oldIdx, newIndex: newIdx } })}
						onAddEffect={(effect) => dispatch({ type: 'ADD_CLIP_EFFECT', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, effect } })}
						onUpdateClipUiState={(layerIndex, colIndex, uiState) => dispatch({ type: 'UPDATE_CLIP_UI_STATE', payload: { layerIndex, colIndex, uiState } })}
						onParameterChange={handleEffectParameterChange}
						onGeneratorParameterChange={handleGeneratorParameterChange}
						progressRef={progressRef}
						onAudioError={handleAudioError}
					/>}
					{activeBottomTab_2 === 'layer' && <LayerSettingsPanel
						selectedLayerIndex={selectedLayerIndex}
						autopilotMode={selectedLayerIndex !== null ? state.layerAutopilots[selectedLayerIndex] : 'off'}
						onAutopilotChange={(mode) => dispatch({ type: 'SET_LAYER_AUTOPILOT', payload: { layerIndex: selectedLayerIndex, mode } })}
						layerEffects={selectedLayerIndex !== null ? layerEffects[selectedLayerIndex] : []}
						assignedDacs={selectedLayerIndex !== null && state.layerAssignedDacs ? state.layerAssignedDacs[selectedLayerIndex] : []}
						onToggleDacMirror={(layerIndex, dacIndex, axis) => dispatch({ type: 'TOGGLE_LAYER_DAC_MIRROR', payload: { layerIndex, dacIndex, axis } })}
						onRemoveDac={(layerIndex, dacIndex) => dispatch({ type: 'REMOVE_LAYER_DAC', payload: { layerIndex, dacIndex } })}
						onAddEffect={(effect) => selectedLayerIndex !== null && dispatch({ type: 'ADD_LAYER_EFFECT', payload: { layerIndex: selectedLayerIndex, effect } })}
						onRemoveEffect={(index) => selectedLayerIndex !== null && dispatch({ type: 'REMOVE_LAYER_EFFECT', payload: { layerIndex: selectedLayerIndex, effectIndex: index } })}
						onParamChange={(effectIndex, paramName, val) => selectedLayerIndex !== null && dispatch({ type: 'UPDATE_LAYER_EFFECT_PARAMETER', payload: { layerIndex: selectedLayerIndex, effectIndex, paramName, newValue: val } })}
						uiState={selectedLayerIndex !== null ? state.layerUiStates[selectedLayerIndex] : {}}
						onUpdateUiState={(uiState) => dispatch({ type: 'UPDATE_LAYER_UI_STATE', payload: { layerIndex: selectedLayerIndex, uiState } })}
					/>}
				</div>
			</div>
			
            <DacPanel 
                dacs={dacs} 
                onDacSelected={handleDacSelected} 
                onDacsDiscovered={handleDacsDiscovered} 
                dacSettings={dacOutputSettings}
                onUpdateDacSettings={handleUpdateDacSettings}
            />

			<SettingsPanel
              enabledShortcuts={enabledShortcuts}
              onOpenOutputSettings={() => setShowOutputSettingsWindow(true)}
              onOpenShortcutsSettings={() => setShowShortcutsWindow(true)}
              quickAssigns={state.quickAssigns}
              renderSettings={{
                  showBeamEffect,
                  beamAlpha,
                  fadeAlpha,
                  previewScanRate,
                  beamRenderMode,
                  worldShowBeamEffect,
                  worldBeamRenderMode,
                  settingsPanelCollapsed: state.settingsPanelCollapsed
              }}
              onSetRenderSetting={(setting, value) => dispatch({ type: 'SET_RENDER_SETTING', payload: { setting, value } })}
              onUpdateKnob={(i, v) => {
                  handleUpdateQuickControl('knob', i, v);
              }}
              onToggleButton={(i) => {
                  const btn = state.quickAssigns.buttons[i];
                  const link = btn.link;
                  if (link) {
                      if (link.targetType === 'transport') {
                          if (link.paramName === 'play') handlePlay();
                          else if (link.paramName === 'pause') handlePause();
                          else if (link.paramName === 'stop') handleStop();
                      } else if (link.targetType === 'global') {
                          if (link.paramName === 'laser_output') handleToggleWorldOutput();
                          else if (link.paramName === 'clear') handleClearAllActive();
                          // Blackout is handled purely in the reducer via TOGGLE_QUICK_BUTTON
                      } else {
                          // For effect/generator updates, signal pending update to avoid race condition
                          hasPendingClipUpdate.current = true;
                      }
                  }
                  dispatch({ type: 'TOGGLE_QUICK_BUTTON', payload: { index: i } });
              }}
              onAssign={(type, index, link) => dispatch({ type: 'ASSIGN_QUICK_CONTROL', payload: { type, index, link } })}
            />
          </div>
			<div className="SystemMonitor">
				<SystemMonitor
					playbackFps={playbackFps}
					previewScanRate={previewScanRate}
					previewFrameCountRef={previewFrameCountRef}
					totalPointsSentRef={totalPointsSentRef}
					activeChannelsCountRef={activeChannelsCountRef}
					lastStatUpdateTimeRef={lastStatUpdateTimeRef}
				/>
			</div>
        </div>
      </ErrorBoundary>
    </div>
    </KeyboardProvider>
    </ArtnetProvider>
    </MidiProvider>
  );
}

export default App;
