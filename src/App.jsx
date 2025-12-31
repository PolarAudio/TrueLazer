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
import Mappable from './components/Mappable';
import ErrorBoundary from './components/ErrorBoundary';
import { useIldaParserWorker } from './contexts/IldaParserWorkerContext';
import { useGeneratorWorker } from './contexts/GeneratorWorkerContext';
import { useAudioOutput } from './hooks/useAudioOutput'; // Add this
import { MidiProvider, useMidi } from './contexts/MidiContext'; // Add this
import { ArtnetProvider, useArtnet } from './contexts/ArtnetContext'; // Add this
import MidiMappingOverlay from './components/MidiMappingOverlay'; // Add this
import GlobalQuickAssigns from './components/GlobalQuickAssigns'; // Add this
import { applyEffects, applyOutputProcessing } from './utils/effects';
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
    <div className="master-speed-slider" draggable onDragStart={handleDragStart}>
      <label htmlFor="masterSpeedRange">{playbackFps} FPS</label>
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
  layerEffects: Array(5).fill([]),
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
  ildaFrames: [],
  selectedIldaWorkerId: null,
  selectedIldaTotalFrames: 0,
  bpm: initialSettings?.bpm ?? 120,
  showBeamEffect: initialSettings?.renderSettings?.showBeamEffect ?? true,
  beamAlpha: initialSettings?.renderSettings?.beamAlpha ?? 0.1,
  fadeAlpha: initialSettings?.renderSettings?.fadeAlpha ?? 0.13,
  playbackFps: initialSettings?.renderSettings?.playbackFps ?? 60,
  previewScanRate: initialSettings?.renderSettings?.previewScanRate ?? 1,
  beamRenderMode: initialSettings?.renderSettings?.beamRenderMode ?? 'points',
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
        newClipNames[action.payload.layerIndex] = [...newClipNames[action.payload.layerIndex]];
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
          assignedDacs: [...currentAssignedDacs, { ...action.payload.dac, mirrorX: false, mirrorY: false }],
      };
      newClipContentsWithDac[action.payload.layerIndex][action.payload.colIndex] = updatedClip;
      return { ...state, clipContents: newClipContentsWithDac };
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
        
        // Reuse logic by calling reducer recursively? No, that's bad practice/hard here.
        // We just duplicate the logic for now, or cleaner: create the action payload and fall through?
        // Switch statements don't easily allow fallthrough with changed payload variables.
        // We'll just copy the logic, it's safer.
        
        const newAssigns = { ...state.quickAssigns };
        newAssigns.buttons[index] = {
            ...newAssigns.buttons[index],
            value: newValue
        };
        
        let newState = { ...state, quickAssigns: newAssigns };
    
        const control = newAssigns.buttons[index];
        if (control.link) {
            const { layerIndex, colIndex, effectIndex, paramName, targetType } = control.link;
            
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
        return newState;
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
  const effectStatesRef = useRef(new Map()); // Add effectStatesRef
  const progressRef = useRef({}); // New ref for fine-grained progress
  const [frameTick, setFrameTick] = useState(0);

  const lastFrameFetchTimeRef = useRef({});
  const frameIndexesRef = useRef({});

  const [initialSettings, setInitialSettings] = useState(null);
  const [initialSettingsLoaded, setInitialSettingsLoaded] = useState(false);
  const [showShortcutsWindow, setShowShortcutsWindow] = useState(false);
  const [enabledShortcuts, setEnabledShortcuts] = useState({ midi: false, artnet: false, osc: false, keyboard: false });
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showOutputSettingsWindow, setShowOutputSettingsWindow] = useState(false);
  const [renameModalConfig, setRenameModalConfig] = useState({ title: '', initialValue: '', onSave: () => {} });
  const [activeBottomTab, setActiveBottomTab] = useState('files');

  const [state, dispatch] = useReducer(reducer, getInitialState(initialSettingsLoaded ? initialSettings : {}));
  const {
    columns,
    layers,
    clipContents,
    clipNames,
    thumbnailFrameIndexes,
    layerEffects,
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
                };
            }
        }
    }
    return null;
  }).filter(Boolean), [layers, activeClipIndexes, clipContents]);

  // Refs for real-time access in animation loop
  const layerIntensitiesRef = useRef(layerIntensities);
  const layerAutopilotsRef = useRef(layerAutopilots);
  const layerEffectsRef = useRef(layerEffects); // Add this
  const masterIntensityRef = useRef(masterIntensity);
  const layerBlackoutsRef = useRef(layerBlackouts);
  const layerSolosRef = useRef(layerSolos);
  const globalBlackoutRef = useRef(globalBlackout);
  const dacOutputSettingsRef = useRef(dacOutputSettings);
  const dacsRef = useRef(dacs);
  const activeClipsDataRef = useRef([]);
  const clipContentsRef = useRef(clipContents);
  const activeClipIndexesRef = useRef(activeClipIndexes);
  const clipNamesRef = useRef(clipNames);
  const selectedIldaWorkerIdRef = useRef(selectedIldaWorkerId);
  const selectedIldaTotalFramesRef = useRef(selectedIldaTotalFrames);
  const previousProgressRef = useRef({});
  const prevGeneratorParamsRef = useRef(new Map());
  const prevWorkerIdsRef = useRef(new Map()); // Add this

  useEffect(() => {
    layerIntensitiesRef.current = layerIntensities;
    layerAutopilotsRef.current = layerAutopilots;
    layerEffectsRef.current = layerEffects; // Update this
    masterIntensityRef.current = masterIntensity;
    layerBlackoutsRef.current = layerBlackouts;
    layerSolosRef.current = layerSolos;
    globalBlackoutRef.current = globalBlackout;
    dacOutputSettingsRef.current = dacOutputSettings;
    dacsRef.current = dacs;
    activeClipsDataRef.current = activeClipsData;
    clipContentsRef.current = clipContents;
    activeClipIndexesRef.current = activeClipIndexes;
    clipNamesRef.current = clipNames;
    selectedIldaWorkerIdRef.current = selectedIldaWorkerId;
    selectedIldaTotalFramesRef.current = selectedIldaTotalFrames;
  }, [layerIntensities, layerAutopilots, layerEffects, masterIntensity, layerBlackouts, layerSolos, globalBlackout, dacOutputSettings, dacs, activeClipsData, clipContents, activeClipIndexes, clipNames, selectedIldaWorkerId, selectedIldaTotalFrames]);

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
    document.documentElement.style.setProperty('--theme-color-transparent', `rgba(${r}, ${g}, ${b}, 0.2)`);

    // Save theme to global settings
    if (window.electronAPI && window.electronAPI.setTheme) {
        window.electronAPI.setTheme(theme);
    }
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

    const handleMessage = async (e) => {
      if (e.data.type === 'get-frame' && e.data.success) {
        if (e.data.isStillFrame) {
          const { workerId, frame, layerIndex, colIndex } = e.data;
          
          // Generate Thumbnail
          let thumbnailPath = null;
          const currentClip = clipContentsRef.current[layerIndex]?.[colIndex];
          const effects = currentClip?.effects || [];
          thumbnailPath = await generateThumbnail(frame, effects);

          // Update stillFrame and set parsing status to false
          dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { stillFrame: frame, parsing: false, thumbnailPath } } });
        } else {
          liveFramesRef.current[e.data.workerId] = e.data.frame;
        }
      } else if (e.data.type === 'parse-ilda' && e.data.success) {
        const { workerId, totalFrames, ildaFormat, fileName, filePath, layerIndex, colIndex } = e.data;

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
        
        // Request the still frame using the saved index
        const savedFrameIndex = state.thumbnailFrameIndexes[layerIndex][colIndex] || 0;
        ildaParserWorker.postMessage({ type: 'get-frame', workerId, frameIndex: savedFrameIndex, isStillFrame: true, layerIndex, colIndex });
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
    let previewRefreshAnimationFrameId;
    let lastFrameTime = 0;
    let lastPreviewTime = 0;
    const OUTPUT_FPS = 60;
    const dacFrameInterval = 1000 / OUTPUT_FPS;
    const PREVIEW_FPS = 30;
    const previewInterval = 1000 / PREVIEW_FPS;

    // Helper to merge multiple frames into one for a single DAC channel
    const mergeFrames = (frames) => {
      if (frames.length === 0) return null;
      if (frames.length === 1) return frames[0];

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
      if (!isWorldOutputActive) {
        cancelAnimationFrame(dacRefreshAnimationFrameId);
        return;
      }

      if (currentTime - lastFrameTime > dacFrameInterval) {
        if (window.electronAPI && isWorldOutputActive) {
          const dacGroups = new Map(); // key: "ip:channel", value: { ip, channel, frames: [] }

          // 1. Process Clip Content
          activeClipsDataRef.current.forEach(clip => {
            if (clip && liveFramesRef.current[clip.workerId]) {
              const dacList = (clip.assignedDacs && clip.assignedDacs.length > 0)
                ? clip.assignedDacs
                : (selectedDac ? [selectedDac] : []);

              if (dacList.length === 0) return;

              // Merge clip effects with layer effects
              const layerIdx = clip.layerIndex;
              const currentLayerEffects = layerEffectsRef.current[layerIdx] || [];
              const effects = [...(clip.effects || []), ...currentLayerEffects];
              
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

              // Apply sync overrides to effects
              const syncedEffects = effects.map(eff => {
                  const newParams = { ...eff.params };
                  const definition = effectDefinitions.find(d => d.id === eff.id);
                  if (definition) {
                      definition.paramControls.forEach(ctrl => {
                          const syncKey = `${eff.id}.${ctrl.id}`;
                          const rawSettings = syncSettings[syncKey];
                          
                          // Handle both legacy (string) and new (object) formats
                          const settings = typeof rawSettings === 'string' 
                              ? { syncMode: rawSettings, range: [ctrl.min, ctrl.max], direction: 'forward', style: 'loop' }
                              : rawSettings;

                          if (settings && settings.syncMode && (ctrl.type === 'range' || ctrl.type === 'number')) {
                              let progress = 0;
                              
                              // 1. Calculate Base Progress
                              if (settings.syncMode === 'fps') {
                                  // Default roughly 1Hz cycle
                                  progress = (currentTime * 0.001) % 1.0;
                              } else if (settings.syncMode === 'timeline' || settings.syncMode === 'bpm') {
                                  // Use clip progress (bpm logic handled in frame fetcher, both map to 0-1)
                                  progress = clipProgress;
                              }

                              // 2. Apply Direction
                              if (settings.direction === 'backward') {
                                  progress = 1.0 - progress;
                              } else if (settings.direction === 'pause') {
                                  progress = 0; // Or hold last frame? For now 0 or middle
                              }

                              // 3. Apply Style (Loop is default 0-1)
                              if (settings.style === 'bounce') {
                                  // 0 -> 1 -> 0
                                  progress = progress < 0.5 ? progress * 2 : 2 - (progress * 2);
                              } else if (settings.style === 'once') {
                                  progress = Math.min(progress, 1);
                              }

                              // 4. Map to Range
                              const min = settings.range ? settings.range[0] : ctrl.min;
                              const max = settings.range ? settings.range[1] : ctrl.max;
                              
                              newParams[ctrl.id] = min + (max - min) * progress;
                          }
                      });
                  }
                  return { ...eff, params: newParams };
              });

              const modifiedFrame = applyEffects(intensityAdjustedFrame, syncedEffects, { progress: clipProgress, time: currentTime, effectStates: effectStatesRef.current, assignedDacs: clip.assignedDacs });

              dacList.forEach((targetDac, dacIndex) => {
                const ip = targetDac.ip;
                const channel = targetDac.channel || (targetDac.channels && targetDac.channels.length > 0 ? targetDac.channels[0].serviceID : 0);

                if (channel !== undefined) { // Check undefined instead of 0 to allow channel 0
                  const key = `${ip}:${channel}`;
                  if (!dacGroups.has(key)) {
                    dacGroups.set(key, { ip, channel, frames: [] });
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
                  const settings = dacOutputSettingsRef.current[id];
                  
                  if (settings) {
                      if (!dacGroups.has(id)) {
                          dacGroups.set(id, { ip: dac.ip, channel: ch, frames: [] });
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
          dacGroups.forEach(group => {
            let mergedFrame = mergeFrames(group.frames);
            
            const id = `${group.ip}:${group.channel}`;
            const settings = dacOutputSettingsRef.current[id];
            
            if (mergedFrame && settings) {
                // Apply Dimmer
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

                mergedFrame = applyOutputProcessing(mergedFrame, settings);
            }

            if (mergedFrame) {
              window.electronAPI.sendFrame(group.ip, group.channel, mergedFrame, OUTPUT_FPS);
            }
          });
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
      const currentFrameInterval = 1000 / playbackFps;
      const currentBpm = state.bpm || 120;

      const processClip = (clip, layerIndex, workerId) => {
          if (!lastFrameFetchTimeRef.current[workerId]) {
              lastFrameFetchTimeRef.current[workerId] = timestamp;
          }

          const delta = timestamp - lastFrameFetchTimeRef.current[workerId];
          // We only use audio sync if it's an active clip (not a preview only)
          const audioInfo = activeClipIndexesRef.current[layerIndex] !== null ? getAudioInfo(layerIndex) : null;

          let targetIndex = frameIndexesRef.current[workerId] || 0;
          let currentProgress = 0;
          const totalFrames = clip.totalFrames || 1;
          const pSettings = clip.playbackSettings || { mode: 'fps', duration: totalFrames / 60, beats: 8, speedMultiplier: 1 };

          if (audioInfo && isPlaying && !audioInfo.paused) {
              currentProgress = audioInfo.duration > 0 ? (audioInfo.currentTime / audioInfo.duration) : 0;
              targetIndex = Math.floor(currentProgress * totalFrames);
          } else if (pSettings.mode === 'timeline') {
              const totalDurationMs = (pSettings.duration * 1000) / (pSettings.speedMultiplier || 1);
              if (isPlaying && totalDurationMs > 0) {
                  currentProgress = (delta / totalDurationMs) % 1.0;
                  targetIndex = Math.floor(currentProgress * totalFrames);
              }
          } else if (pSettings.mode === 'bpm') {
              const oneBeatMs = 60000 / currentBpm;
              const totalDurationMs = (pSettings.beats * oneBeatMs) / (pSettings.speedMultiplier || 1);
              if (isPlaying && totalDurationMs > 0) {
                  currentProgress = (delta / totalDurationMs) % 1.0;
                  targetIndex = Math.floor(currentProgress * totalFrames);
              }
          } else if (delta >= currentFrameInterval) {
              const framesToAdvance = Math.floor(delta / currentFrameInterval);
              lastFrameFetchTimeRef.current[workerId] = timestamp - (delta % currentFrameInterval);
              if (isPlaying) {
                  targetIndex = (targetIndex + framesToAdvance);
              }
              currentProgress = totalFrames > 0 ? ((targetIndex % totalFrames) / totalFrames) : 0;
          } else {
              return; 
          }

          if (isNaN(targetIndex)) targetIndex = 0;
          if (isNaN(currentProgress)) currentProgress = 0;

          const prevProgress = previousProgressRef.current[workerId] || 0;
          // Check for loop/completion
          // Only trigger if playing and progress wrapped around (e.g. 0.9 -> 0.1)
          // We use a threshold to avoid jitter, e.g., prev was > 0.9 and current < 0.1
          const didLoop = (prevProgress > 0.9 && currentProgress < 0.1);

          previousProgressRef.current[workerId] = currentProgress;
          progressRef.current[workerId] = currentProgress;
          if (totalFrames > 0) {
              targetIndex = targetIndex % totalFrames;
              if (targetIndex < 0) targetIndex += totalFrames;
          }

          // Autopilot Trigger
          if (didLoop && isPlaying) {
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
      };

      // 1. Process active clips
      layers.forEach((_, layerIndex) => {
          const activeColIndex = activeClipIndexesRef.current[layerIndex];
          if (activeColIndex === null) return;
          const clip = clipContentsRef.current[layerIndex][activeColIndex];
          if (!clip) return;

          let workerId = clip.type === 'ilda' ? clip.workerId : (clip.type === 'generator' ? `generator-${layerIndex}-${activeColIndex}` : null);
          if (!workerId) return;

          processClip(clip, layerIndex, workerId);
      });

      // 2. Process selected clip (for preview) if it's not already handled as active
      const selWorkerId = selectedIldaWorkerIdRef.current;
      if (selWorkerId && !activeClipsDataRef.current.some(c => c.workerId === selWorkerId)) {
          const lIdx = selectedLayerIndex; // We use these from closure as they change rarely and loop restart is OK then
          const cIdx = selectedColIndex;
          if (lIdx !== null && cIdx !== null) {
              const clip = clipContentsRef.current[lIdx][cIdx];
              if (clip) {
                  processClip(clip, lIdx, selWorkerId);
              }
          }
      }

      animationFrameId = requestAnimationFrame(frameFetcherLoop);
    };

    const previewLoop = (timestamp) => {
      if (timestamp - lastPreviewTime > previewInterval) {
        setFrameTick(t => t + 1); // Trigger UI preview re-renders
        lastPreviewTime = timestamp;
      }
      previewRefreshAnimationFrameId = requestAnimationFrame(previewLoop);
    }

    animationFrameId = requestAnimationFrame(frameFetcherLoop);
    previewRefreshAnimationFrameId = requestAnimationFrame(previewLoop);

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
      cancelAnimationFrame(previewRefreshAnimationFrameId);
    };
  }, [ildaParserWorker, playbackFps, isPlaying, isWorldOutputActive, selectedDac, getAudioInfo, state.bpm, selectedLayerIndex, selectedColIndex]);

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
                      } else if (clipToUpdate.type === 'generator' && clipToUpdate.generatorDefinition) {
                          const currentIdx = frameIndexesRef.current[`generator-${layerIndex}-${colIndex}`] || 0;
                          const currentFrame = clipToUpdate.frames?.[currentIdx % clipToUpdate.frames.length];
                          if (currentFrame) {
                              const effects = clipToUpdate.effects || [];
                              generateThumbnail(currentFrame, effects).then(thumbnailPath => {
                                  dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { stillFrame: currentFrame, thumbnailPath } } });
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
          const key = `${layerIndex}-${colIndex}`;
          // Merge defaults for a stable comparison
          const completeParams = { ...clip.generatorDefinition.defaultParams, ...(clip.currentParams || {}) };
          const currentParamsJson = JSON.stringify(completeParams);
          
          if (prevGeneratorParamsRef.current.get(key) !== currentParamsJson) {
            // Parameters changed (via MIDI, Quick Assign, or UI)
            console.log(`[App.jsx] Generator ${key} params changed, regenerating...`);
            regenerateGeneratorClip(layerIndex, colIndex, clip.generatorDefinition, clip.currentParams);
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
        if (action === 'output-settings') {
          setShowOutputSettingsWindow(true);
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

  // Effect to trigger re-parsing of ILDA clips when workerId is missing (e.g. after load)
  useEffect(() => {
      if (!ildaParserWorker) return;

      const clipsToParse = [];
      clipContents.forEach((layer, layerIndex) => {
          layer.forEach((clip, colIndex) => {
              if (clip && clip.type === 'ilda' && clip.filePath && !clip.workerId && !clip.parsing) {
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

            const newClipContent = {
                type: 'generator',
                generatorDefinition,
                frames,
                currentParams,
                playbackSettings: {
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
    if (['text', 'ndi-source', 'spout-receiver'].includes(generatorDefinition.id)) {
      const defaultFontUrl = 'src/fonts/arial.ttf';
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
          console.log(`[App.jsx] handleClipPreview - Dispatched SET_SELECTED_ILDA_DATA for generator. workerId: ${generatorWorkerId}`); // DEBUG LOG
      } else {
        // Clip is empty, clear the selection data
        dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: null, totalFrames: 0, generatorId: null, generatorParams: {} } });
      }
  }, [clipContents]);

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
        playAudio(layerIndex, clip.audioFile.path, isPlaying);
    } else {
        stopAudio(layerIndex);
    }

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
      dispatch({ type: 'ADD_CLIP_EFFECT', payload: { layerIndex, colIndex, effect: effectData } });
  }, []);

  const handleDropDac = useCallback((layerIndex, colIndex, dacData) => {
    console.trace('App.jsx: handleDropDac received dacData:', dacData);
      dispatch({ type: 'SET_CLIP_DAC', payload: { layerIndex, colIndex, dac: dacData } });
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
    if (frame && selectedClipFinalIntensity < 0.999) {
      const isTyped = frame.isTypedArray || frame.points instanceof Float32Array;
      if (isTyped) {
          const pts = frame.points;
          const numPts = pts.length / 8;
          const newPts = new Float32Array(pts);
          for (let i = 0; i < numPts; i++) {
              newPts[i*8+3] *= selectedClipFinalIntensity;
              newPts[i*8+4] *= selectedClipFinalIntensity;
              newPts[i*8+5] *= selectedClipFinalIntensity;
          }
          return { ...frame, points: newPts, isTypedArray: true };
      } else {
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
    }
    return frame;
  }, [frameTick, selectedIldaWorkerId, selectedClipFinalIntensity]);

  const worldFrames = useMemo(() => {
    const frames = {};
    activeClipsData.forEach(clip => {
      if (clip && clip.workerId && liveFramesRef.current[clip.workerId]) {
        const currentLayerEffects = layerEffects[clip.layerIndex] || [];
        const mergedEffects = [...(clip.effects || []), ...currentLayerEffects];
        frames[clip.workerId] = {
          frame: liveFramesRef.current[clip.workerId],
          effects: mergedEffects,
          layerIndex: clip.layerIndex, 
        };
      }
    });
    return frames;
  }, [activeClipsData, frameTick, layerEffects]);

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
        } else if (id.startsWith('quick_knob_')) {
            const index = parseInt(id.split('_')[2]);
            dispatch({ type: 'UPDATE_QUICK_CONTROL', payload: { type: 'knob', index, value: normalizedValue } });
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
              dacSettings={selectedDac ? dacOutputSettings[`${selectedDac.ip}:${selectedDac.channel}`] : null}
            />

          </div>
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
                                  </div>          			<div className="middle-bar-right-area">
          				<p> Right Section of Middle-Bar</p>
                      </div>
                    </div>          <div className="bottom-panel">
            <div className="bottom-panel-tabs-container">
                <div className="bottom-panel-tabs">
                    <button className={`tab-button ${activeBottomTab === 'files' ? 'active' : ''}`} onClick={() => setActiveBottomTab('files')}>Files</button>
                    <button className={`tab-button ${activeBottomTab === 'generators' ? 'active' : ''}`} onClick={() => setActiveBottomTab('generators')}>Generators</button>
                    <button className={`tab-button ${activeBottomTab === 'effects' ? 'active' : ''}`} onClick={() => setActiveBottomTab('effects')}>Effects</button>
                </div>
                <div className="bottom-panel-tab-content">
                    {activeBottomTab === 'files' && <FileBrowser onDropIld={(layerIndex, colIndex, file) => ildaParserWorker.postMessage({ type: 'parse-ilda', file, layerIndex, colIndex })} />}
                    {activeBottomTab === 'generators' && <GeneratorPanel />}
                    {activeBottomTab === 'effects' && <EffectPanel />}
                </div>
            </div>
            
            <DacPanel 
                dacs={dacs} 
                onDacSelected={handleDacSelected} 
                onDacsDiscovered={handleDacsDiscovered} 
                dacSettings={dacOutputSettings}
                onUpdateDacSettings={handleUpdateDacSettings}
            />

            <LayerSettingsPanel
                selectedLayerIndex={selectedLayerIndex}
                autopilotMode={selectedLayerIndex !== null ? state.layerAutopilots[selectedLayerIndex] : 'off'}
                onAutopilotChange={(mode) => dispatch({ type: 'SET_LAYER_AUTOPILOT', payload: { layerIndex: selectedLayerIndex, mode } })}
                layerEffects={selectedLayerIndex !== null ? layerEffects[selectedLayerIndex] : []}
                onAddEffect={(effect) => selectedLayerIndex !== null && dispatch({ type: 'ADD_LAYER_EFFECT', payload: { layerIndex: selectedLayerIndex, effect } })}
                onRemoveEffect={(index) => selectedLayerIndex !== null && dispatch({ type: 'REMOVE_LAYER_EFFECT', payload: { layerIndex: selectedLayerIndex, effectIndex: index } })}
                onParamChange={(effectIndex, paramName, val) => selectedLayerIndex !== null && dispatch({ type: 'UPDATE_LAYER_EFFECT_PARAMETER', payload: { layerIndex: selectedLayerIndex, effectIndex, paramName, newValue: val } })}
            />

            <ClipSettingsPanel
              selectedLayerIndex={selectedLayerIndex}
              selectedColIndex={selectedColIndex}
              clip={selectedClip}
              audioInfo={getAudioInfo(selectedLayerIndex)}
              onAssignAudio={async () => {
                const filePath = await window.electronAPI.showAudioFileDialog();
                if (filePath) {
                    const fileName = filePath.split(/[\\/]/).pop();
                    dispatch({ type: 'SET_CLIP_AUDIO', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, audioFile: { path: filePath, name: fileName } } });
                }
              }}
              onRemoveAudio={() => dispatch({ type: 'REMOVE_CLIP_AUDIO', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex } })}
              onUpdatePlaybackSettings={(lIdx, cIdx, settings) => dispatch({ type: 'UPDATE_CLIP_PLAYBACK_SETTINGS', payload: { layerIndex: lIdx, colIndex: cIdx, settings } })}
              onSetParamSync={(paramId, syncMode) => dispatch({ type: 'SET_CLIP_PARAM_SYNC', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, paramId, syncMode } })}
              onToggleDacMirror={(lIdx, cIdx, dIdx, axis) => dispatch({ type: 'TOGGLE_CLIP_DAC_MIRROR', payload: { layerIndex: lIdx, colIndex: cIdx, dacIndex: dIdx, axis } })}
              onRemoveDac={(dacIndex) => dispatch({ type: 'REMOVE_CLIP_DAC', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, dacIndex } })}
              onRemoveEffect={(lIdx, cIdx, eIdx) => dispatch({ type: 'REMOVE_CLIP_EFFECT', payload: { layerIndex: lIdx, colIndex: cIdx, effectIndex: eIdx } })}
              onParameterChange={handleEffectParameterChange}
              onGeneratorParameterChange={handleGeneratorParameterChange}
            />

			<SettingsPanel
              enabledShortcuts={enabledShortcuts}
              onOpenOutputSettings={() => setShowOutputSettingsWindow(true)}
              quickAssigns={state.quickAssigns}
              onUpdateKnob={(i, v) => dispatch({ type: 'UPDATE_QUICK_CONTROL', payload: { type: 'knob', index: i, value: v } })}
              onToggleButton={(i) => {
                  const btn = state.quickAssigns.buttons[i];
                  const link = btn.link;
                  if (link) {
                      if (link.targetType === 'transport') {
                          if (link.paramName === 'play') handlePlay();
                          else if (link.paramName === 'pause') handlePause();
                          else if (link.paramName === 'stop') handleStop();
                      } else if (link.targetType === 'global') {
                          if (link.paramName === 'blackout') dispatch({ type: 'TOGGLE_GLOBAL_BLACKOUT' });
                          else if (link.paramName === 'laser_output') dispatch({ type: 'TOGGLE_WORLD_OUTPUT_ACTIVE' });
                          else if (link.paramName === 'clear') handleClearAllActive();
                      }
                  }
                  dispatch({ type: 'UPDATE_QUICK_CONTROL', payload: { type: 'button', index: i, value: !btn.value } });
              }}
              onAssign={(type, index, link) => dispatch({ type: 'ASSIGN_QUICK_CONTROL', payload: { type, index, link } })}
            />
          </div>
        </div>
      </ErrorBoundary>
    </div>
    </ArtnetProvider>
    </MidiProvider>
  );
}

export default App;
