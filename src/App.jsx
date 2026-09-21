import React, { useReducer, useEffect, useCallback, useRef, useMemo, useState, startTransition } from 'react';
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
import { ShortcutsWindow } from './components/ShortcutsWindow';
import RenameModal from './components/RenameModal';
import OutputSettingsWindow from './components/OutputSettingsWindow';
import AudioSettingsWindow from './components/AudioSettingsWindow';
import GeneralSettingsWindow from './components/GeneralSettingsWindow';
import OutputProcessingWindow from './components/OutputProcessingWindow';
import RelocateModal from './components/RelocateModal';
import ClipExportWarningModal from './components/ClipExportWarningModal';
import Mappable from './components/Mappable';
import ErrorBoundary from './components/ErrorBoundary';
import ShapeBuilder from './components/ShapeBuilder';
import TimelineEditor from './components/TimelineEditor';
import { timelineBridge } from './contexts/TimelineContext';
import AboutWindow from './components/aboutWindow';
import { useIldaParserWorker } from './contexts/IldaParserWorkerContext';
import { useThumbnailWorker } from './contexts/ThumbnailWorkerContext';
import { useGeneratorWorker } from './contexts/GeneratorWorkerContext';
import { useAudioOutput } from './hooks/useAudioOutput'; // Add this
import { useAudio } from './contexts/AudioContext.jsx'; // Add this
import { MidiProvider, useMidi } from './contexts/MidiContext'; // Add this
import { ArtnetProvider, useArtnet } from './contexts/ArtnetContext'; // Add this
import { KeyboardProvider, useKeyboard } from './contexts/KeyboardContext'; // Add this
import MidiMappingOverlay from './components/MidiMappingOverlay'; // Add this
import GlobalQuickAssigns from './components/GlobalQuickAssigns'; // Add this
import { applyEffects, applyOutputProcessing, resolveParam, calculateAnimPhase } from './utils/effects';
import { optimizePoints } from './utils/optimizer';
import { DEFAULT_PRESET, getPreset, OPT_DEFAULTS } from './utils/hardwarePresets';
import { effectDefinitions } from './utils/effectDefinitions';
import { THEME_COLORS } from './utils/midiColors';
import { sendNote } from './utils/midi';
import { generateCircle, generateSquare, generateLine, generateStar, generateText, generateSinewave } from './utils/generators'; // Import generator functions
import { throttle, debounce } from './utils/throttle';

const generateId = () => Math.random().toString(36).substr(2, 9);

// Resolve the real-time duration (seconds) that layer effects animate over from
// the layer's "Effect Speed Control" settings. Returns null when disabled so
// callers fall back to the clip's own timing.
function resolveLayerEffectDuration(effectSpeed, bpm, fps, totalFrames) {
    if (!effectSpeed || !effectSpeed.mode) return null;
    let duration;
    if (effectSpeed.mode === 'bpm') {
        duration = ((effectSpeed.beats || 8) * 60) / (bpm || 120);
    } else if (effectSpeed.mode === 'fps') {
        duration = (totalFrames || 30) / (fps || 30);
    } else {
        duration = effectSpeed.duration || 1;
    }
    const speedMult = effectSpeed.speedMultiplier || 1;
    if (speedMult !== 0) duration /= speedMult;
    return duration;
}

const MasterSpeedSlider = React.memo(({ playbackFps, onSpeedChange }) => {
    const fpsInputRef = useRef(null);
    useEffect(() => {
        const el = fpsInputRef.current;
        if (!el) return;
        const handler = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;
            onSpeedChange(Math.max(1, Math.min(120, playbackFps + delta)));
        };
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, [playbackFps, onSpeedChange]);

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
            <label
                draggable
                onDragStart={handleDragStart}
                className="draggable-param-label"
            >
                FPS
            </label>
            <div className="value-adjuster">
                <Mappable id="master_speed_down">
                    <button onClick={() => onSpeedChange(Math.max(1, playbackFps - 1))}>-</button>
                </Mappable>
                <Mappable id="master_speed">
                    <input
                        type="number"
                        min="1"
                        max="120"
                        value={playbackFps}
                        onChange={(e) => onSpeedChange(parseInt(e.target.value) || 1)}
                        ref={fpsInputRef}
                    />
                </Mappable>
                <Mappable id="master_speed_up">
                    <button onClick={() => onSpeedChange(Math.min(120, playbackFps + 1))}>+</button>
                </Mappable>
            </div>
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
                <input type="checkbox" className="laser-toggle" checked={isWorldOutputActive} onChange={onToggleWorldOutput} />
            </Mappable>
        </div>
    );
});

const ensureArrayStructure = (arr, pages, rows, cols, defaultValueFactory) => {
    // 1. Handle older 2D structures (rows x cols)
    if (Array.isArray(arr) && arr.length === rows && Array.isArray(arr[0])) {
        // Check if it's actually 2D (the first element is not a nested page-layer array)
        // Usually, if it's 2D, arr[0][0] is a clip object, not an array.
        if (!Array.isArray(arr[0][0])) {
            console.log("Migration: Converting old 2D project layout to 3D pages structure. Clips moved to Page 1.");
            return Array(pages).fill(null).map((_, p) => {
                if (p === 0) return arr; // Put old 2D content in first page
                return Array(rows).fill(null).map((_, r) =>
                    Array(cols).fill(null).map((_, c) => defaultValueFactory(p, r, c))
                );
            });
        }
    }

    // 2. Handle missing or wrong-sized 3D structures
    if (!Array.isArray(arr) || arr.length !== pages) {
        return Array(pages).fill(null).map((_, p) =>
            Array(rows).fill(null).map((_, r) =>
                Array(cols).fill(null).map((_, c) => defaultValueFactory(p, r, c))
            )
        );
    }

    // 3. Deep validation of existing 3D structure
    return arr.map((page, p) => {
        if (!Array.isArray(page) || page.length !== rows) {
            return Array(rows).fill(null).map((_, r) =>
                Array(cols).fill(null).map((_, c) => defaultValueFactory(p, r, c))
            );
        }
        return page.map((row, r) => {
            if (!Array.isArray(row) || row.length !== cols) {
                return Array(cols).fill(null).map((_, c) => defaultValueFactory(p, r, c));
            }
            return row;
        });
    });
};

const getInitialState = (initialSettings) => ({
    columns: Array.from({ length: 8 }, (_, i) => `Col ${i + 1}`),
    layers: Array.from({ length: 5 }, (_, i) => `Layer ${i + 1}`),
    activePageId: initialSettings?.activePageId ?? 0,
    numPages: initialSettings?.numPages ?? 8,
    pageNames: initialSettings?.pageNames ?? Array(initialSettings?.numPages ?? 8).fill(null),
    clipContents: ensureArrayStructure(initialSettings?.clipContents, 8, 5, 8, () => ({ parsing: false })),
    clipNames: ensureArrayStructure(initialSettings?.clipNames, 8, 5, 8, (p, r, c) => `Clip ${r + 1}-${c + 1}`),
    thumbnailFrameIndexes: ensureArrayStructure(initialSettings?.thumbnailFrameIndexes, 8, 5, 8, () => 0),
    layerEffects: Array.from({ length: 5 }, () => []),
    layerAssignedDacs: initialSettings?.layerAssignedDacs ?? Array(5).fill([]),
    layerIntensities: Array(5).fill(1), // Add this
    layerAutopilots: Array(5).fill('off'), // Add layer autopilots
    layerBlackouts: Array(5).fill(false), // Add layer blackouts
    layerSolos: Array(5).fill(false), // Add layer solos
    layerEffectSpeeds: Array(5).fill(null), // Per-layer effect speed control (null = follow clip timing)
    layerSyncSettings: Array(5).fill({}), // Per-layer effect param speed sync (F/T/B/FFT)
    masterIntensity: 1, // Add this
    globalBlackout: false, // Add global blackout
    selectedLayerIndex: null,
    selectedColIndex: null,
    notification: { message: '', visible: false },
    dacs: [],
    selectedDac: initialSettings?.dacAssignment?.selectedDac ?? initialSettings?.selectedDac ?? null,
    fileBrowserViewMode: 'list',
    fileBrowserPath: '',
    layerUiStates: Array(6).fill({}),
    ildaFrames: [],
    selectedIldaWorkerId: null,
    selectedIldaTotalFrames: 0,
    bpm: initialSettings?.bpm ?? 120,
    showBeamEffect: initialSettings?.renderSettings?.showBeamEffect ?? true,
    beamAlpha: initialSettings?.renderSettings?.beamAlpha ?? 0.1,
    fadeAlpha: initialSettings?.renderSettings?.fadeAlpha ?? 0.13,
    playbackFps: initialSettings?.renderSettings?.playbackFps ?? 30,
    previewScanRate: initialSettings?.renderSettings?.previewScanRate ?? 1,
    beamRenderMode: initialSettings?.renderSettings?.beamRenderMode ?? 'both',
    worldShowBeamEffect: initialSettings?.renderSettings?.worldShowBeamEffect ?? true,
    worldBeamRenderMode: initialSettings?.renderSettings?.worldBeamRenderMode ?? 'both',
    optimizationEnabled: initialSettings?.renderSettings?.optimizationEnabled ?? true,
    optimizationMaxDist: Number(initialSettings?.renderSettings?.optimizationMaxDist ?? 0.02),
    optimizationPathDwell: Number(initialSettings?.renderSettings?.optimizationPathDwell ?? 2),
    optimizationSettings: initialSettings?.renderSettings?.optimizationSettings ?? { ...OPT_DEFAULTS },
    layerMergeMode: initialSettings?.renderSettings?.layerMergeMode ?? 'priority',
    activeClipIndexes: initialSettings?.activeClipIndexes ?? Array(5).fill(null),
    isPlaying: false,
    isStopped: true, // Add this
    isWorldOutputActive: false, // Controls whether frames are sent to DACs
    thumbnailRenderMode: initialSettings?.thumbnailRenderMode ?? 'still', // 'still' for static thumbnail, 'active' for live rendering
    theme: initialSettings?.theme ?? 'orange', // Add theme to state
    projectLoadTimestamp: null, // Add this to track project loads
    clipClipboard: null, // For copy/paste
    dacOutputSettings: initialSettings?.dacOutputSettings ?? {}, // Add dacOutputSettings to state
    projectPresets: initialSettings?.projectPresets ?? {}, // Add projectPresets for portability
    quickAssigns: {
        knobs: Array(8).fill(null).map(() => ({ value: 0, label: null, link: null, links: [] })),
        buttons: Array(8).fill(null).map(() => ({ value: false, label: null, link: null, links: [] }))
    },
});

const getQuickControlLinks = (control) => {
    if (Array.isArray(control?.links)) return control.links;
    if (control?.link) return [control.link];
    return [];
};

// For quick-assign knobs linked to an effect param that is part of an X/Y pair
// (see effectDefinitions linkPairs), drive the partner axis too so the linked
// knob moves both together (mirrors the EffectEditor slider behavior). Returns
// the partner param name, or null when unlinked / not a pair member.
const getLinkedPartnerParam = (effectId, paramName, params) => {
    if (!effectId || !paramName) return null;
    if (params && params.linkXY === false) return null;
    const def = effectDefinitions.find(d => (d.id || d.name) === effectId);
    if (!def || !Array.isArray(def.linkPairs)) return null;
    for (const pair of def.linkPairs) {
        if (pair[0] === paramName && pair[1] !== paramName) return pair[1];
        if (pair[1] === paramName && pair[0] !== paramName) return pair[0];
    }
    return null;
};

const formatQuickAssignLabel = (links) => {
    const labels = links.map(l => l.label || l.paramName || l.paramId).filter(Boolean);
    if (labels.length === 0) return null;
    if (labels.length === 1) return labels[0];
    return `${labels[0]} +${labels.length - 1}`;
};

// Per-clip / per-layer UI state carries several key->value maps (which panels are
// collapsed, which effect editors are collapsed, which advanced sub-panels are
// open). A stale snapshot spread in a component would drop sibling entries, so
// these map keys are deep-merged by the reducer instead - components only send
// the single entry they are toggling.
const UI_STATE_MAP_KEYS = ['collapsedPanels', 'collapsedEffects', 'showHsv'];

function mergeUiState(prev, next) {
    const merged = { ...(prev || {}) };
    for (const key of UI_STATE_MAP_KEYS) {
        if ((prev && prev[key]) || (next && next[key])) {
            merged[key] = {
                ...((prev && prev[key]) || {}),
                ...((next && next[key]) || {})
            };
        }
    }
    for (const key of Object.keys(next || {})) {
        if (!UI_STATE_MAP_KEYS.includes(key)) merged[key] = next[key];
    }
    return merged;
}

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
        case 'SET_ACTIVE_PAGE': {
            return { ...state, activePageId: action.payload };
        }
        case 'SET_PAGE_NAME': {
            const newPageNames = [...(state.pageNames || Array(state.numPages || 8).fill(null))];
            newPageNames[action.payload.index] = action.payload.name;
            return { ...state, pageNames: newPageNames };
        }
        case 'REGISTER_PROJECT_PRESET': {
            const { type, subType, preset } = action.payload;
            const newPresets = { ...state.projectPresets };
            if (!newPresets[type]) newPresets[type] = {};
            if (!newPresets[type][subType]) newPresets[type][subType] = {};
            newPresets[type][subType][preset.name] = preset;
            return { ...state, projectPresets: newPresets };
        }
        case 'SET_COLUMNS': {
            return { ...state, columns: action.payload };
        }
        case 'SET_COLUMN_NAME': {
            const newColumns = [...state.columns];
            newColumns[action.payload.index] = action.payload.name;
            return { ...state, columns: newColumns };
        }
        case 'DUPLICATE_COLUMN': {
            const sourceIndex = action.payload.index;
            const newColumns = [...state.columns];
            newColumns.splice(sourceIndex + 1, 0, `${newColumns[sourceIndex]} (Copy)`);

            const newClipContents = state.clipContents.map(layer => {
                const newLayer = [...layer];
                const sourceClip = newLayer[sourceIndex];
                let newClip = null;
                if (sourceClip) {
                    // Deep clone and unique IDs
                    newClip = JSON.parse(JSON.stringify(sourceClip));
                    if (newClip.type === 'ilda') newClip.workerId = null;
                    if (newClip.effects) {
                        const sync = newClip.syncSettings || {};
                        newClip.effects = newClip.effects.map(eff => {
                            const oldId = eff.instanceId;
                            const newId = generateId();
                            Object.keys(sync).forEach(key => {
                                if (oldId && key.startsWith(`${oldId}.`)) {
                                    sync[`${newId}.${key.split('.')[1]}`] = sync[key];
                                    delete sync[key];
                                }
                            });
                            return { ...eff, instanceId: newId };
                        });
                        newClip.syncSettings = sync;
                    }
                }
                newLayer.splice(sourceIndex + 1, 0, newClip);
                return newLayer;
            });

            const newClipNames = state.clipNames.map(layer => {
                const newLayer = [...layer];
                newLayer.splice(sourceIndex + 1, 0, `${newLayer[sourceIndex]} (Copy)`);
                return newLayer;
            });

            const newThumbnailIndexes = state.thumbnailFrameIndexes.map(layer => {
                const newLayer = [...layer];
                newLayer.splice(sourceIndex + 1, 0, newLayer[sourceIndex]);
                return newLayer;
            });

            return {
                ...state,
                columns: newColumns,
                clipContents: newClipContents,
                clipNames: newClipNames,
                thumbnailFrameIndexes: newThumbnailIndexes
            };
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
            // Honor an explicit target page so multi-page flows (generator/ILDA still
            // frames) land on the correct page instead of always the active one.
            const pageIdx = action.payload.pageId ?? state.activePageId;

            // Ensure the page array exists
            if (!newClipContents[pageIdx]) {
                newClipContents[pageIdx] = Array.from({ length: 5 }, () => Array.from({ length: 8 }, () => ({ parsing: false })));
            }
            newClipContents[pageIdx] = [...newClipContents[pageIdx]];

            // Ensure the layer array exists
            if (!newClipContents[pageIdx][layerIndex]) {
                console.error(`Reducer Error: Layer array at index ${layerIndex} on page ${pageIdx} is undefined.`);
                return state;
            }
            newClipContents[pageIdx][layerIndex] = [...newClipContents[pageIdx][layerIndex]];

            const existingClipContent = newClipContents[pageIdx][layerIndex][colIndex] || {};
            newClipContents[pageIdx][layerIndex][colIndex] = {
                ...existingClipContent,
                ...content,
            };
            return { ...state, clipContents: newClipContents };
        }
        case 'SET_CLIP_NAME': {
            const { layerIndex, colIndex, name } = action.payload;
            if (layerIndex === undefined || colIndex === undefined) return state;

            const newClipNames = [...state.clipNames];
            // Honor an explicit target page so multi-page flows (generator/ILDA
            // parsing) name the correct clip instead of always the active one.
            const pageIdx = action.payload.pageId ?? state.activePageId;

            if (!newClipNames[pageIdx]) {
                newClipNames[pageIdx] = Array.from({ length: 5 }, (_, r) => Array.from({ length: 8 }, (_, c) => `Clip ${r + 1}-${c + 1}`));
            }
            newClipNames[pageIdx] = [...newClipNames[pageIdx]];

            if (newClipNames[pageIdx][layerIndex]) {
                newClipNames[pageIdx][layerIndex] = [...newClipNames[pageIdx][layerIndex]];
                newClipNames[pageIdx][layerIndex][colIndex] = name;
            }
            return { ...state, clipNames: newClipNames };
        }
        case 'SET_THUMBNAIL_FRAME_INDEX': {
            const newThumbnailFrameIndexes = [...state.thumbnailFrameIndexes];
            const pageIdx = state.activePageId;

            if (!newThumbnailFrameIndexes[pageIdx]) {
                newThumbnailFrameIndexes[pageIdx] = Array(5).fill(null).map(() => Array(8).fill(0));
            }
            newThumbnailFrameIndexes[pageIdx] = [...newThumbnailFrameIndexes[pageIdx]];
            newThumbnailFrameIndexes[pageIdx][action.payload.layerIndex] = [...newThumbnailFrameIndexes[pageIdx][action.payload.layerIndex]];

            newThumbnailFrameIndexes[pageIdx][action.payload.layerIndex][action.payload.colIndex] = action.payload.index;
            return { ...state, thumbnailFrameIndexes: newThumbnailFrameIndexes };
        }
        case 'ADD_LAYER_EFFECT': {
            const newLayerEffects = [...state.layerEffects];
            const newEffectInstance = {
                ...action.payload.effect,
                instanceId: action.payload.effect.instanceId || generateId(),
                params: { ...action.payload.effect.defaultParams }
            };
            // Replace the inner array (never push into the state-shared array) so an
            // eager live-ref mutation and the reducer copy can't both land in the list.
            const targetEffects = newLayerEffects[action.payload.layerIndex];
            if (targetEffects.some(e => e.instanceId && e.instanceId === newEffectInstance.instanceId)) return state;
            newLayerEffects[action.payload.layerIndex] = [...targetEffects, newEffectInstance];
            {
                const __list = newLayerEffects[action.payload.layerIndex];
                const __seen = new Set(); const __dups = [];
                for (const __e of __list) { const __k = __e.instanceId || __e.id; if (__seen.has(__k)) __dups.push(__k); __seen.add(__k); }
                console.debug('[fx-debug] ADD_LAYER_EFFECT reducer', { len: __list.length, dups: __dups, instanceId: newEffectInstance.instanceId });
            }
            return { ...state, layerEffects: newLayerEffects };
        }
        case 'ADD_CLIP_EFFECT': {
            const pageIdx = state.activePageId;
            const newClipContentsWithEffect = [...state.clipContents];
            newClipContentsWithEffect[pageIdx] = [...newClipContentsWithEffect[pageIdx]];

            if (!newClipContentsWithEffect[pageIdx][action.payload.layerIndex]) {
                console.error(`Reducer Error: Layer array at index ${action.payload.layerIndex} on page ${pageIdx} is undefined.`);
                return state;
            }
            newClipContentsWithEffect[pageIdx][action.payload.layerIndex] = [...newClipContentsWithEffect[pageIdx][action.payload.layerIndex]];

            const existingClip = newClipContentsWithEffect[pageIdx][action.payload.layerIndex][action.payload.colIndex] || {};

            const newEffectInstance = {
                ...action.payload.effect,
                instanceId: action.payload.effect.instanceId || generateId(),
                params: { ...action.payload.effect.defaultParams }
            };

            const updatedClip = {
                ...existingClip,
                effects: [...(existingClip.effects || []), newEffectInstance],
            };
            if ((existingClip.effects || []).some(e => e.instanceId && e.instanceId === newEffectInstance.instanceId)) return state;
            newClipContentsWithEffect[pageIdx][action.payload.layerIndex][action.payload.colIndex] = updatedClip;
            {
                const __clip = updatedClip;
                const __seen = new Set(); const __dups = [];
                for (const __e of (__clip.effects || [])) { const __k = __e.instanceId || __e.id; if (__seen.has(__k)) __dups.push(__k); __seen.add(__k); }
                console.debug('[fx-debug] ADD_CLIP_EFFECT reducer', { len: (__clip.effects || []).length, dups: __dups, instanceId: newEffectInstance.instanceId });
            }
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
            newActiveClipIndexes[action.payload.layerIndex] = {
                pageId: state.activePageId,
                colIndex: action.payload.colIndex
            };
            return { ...state, activeClipIndexes: newActiveClipIndexes };
        }
        case 'CLEAR_CLIP': {
            const pageIdx = state.activePageId;
            const clearedClipContents = [...state.clipContents];
            clearedClipContents[pageIdx] = [...clearedClipContents[pageIdx]];
            clearedClipContents[pageIdx][action.payload.layerIndex] = [...clearedClipContents[pageIdx][action.payload.layerIndex]];
            clearedClipContents[pageIdx][action.payload.layerIndex][action.payload.colIndex] = null;

            const clearedClipNames = [...state.clipNames];
            clearedClipNames[pageIdx] = [...clearedClipNames[pageIdx]];
            clearedClipNames[pageIdx][action.payload.layerIndex] = [...clearedClipNames[pageIdx][action.payload.layerIndex]];
            clearedClipNames[pageIdx][action.payload.layerIndex][action.payload.colIndex] = `Clip ${action.payload.layerIndex + 1}-${action.payload.colIndex + 1}`;

            const clearedThumbnailFrameIndexes = [...state.thumbnailFrameIndexes];
            clearedThumbnailFrameIndexes[pageIdx] = [...clearedThumbnailFrameIndexes[pageIdx]];
            clearedThumbnailFrameIndexes[pageIdx][action.payload.layerIndex] = [...clearedThumbnailFrameIndexes[pageIdx][action.payload.layerIndex]];
            clearedThumbnailFrameIndexes[pageIdx][action.payload.layerIndex][action.payload.colIndex] = 0;

            const clearedActiveClipIndexes = [...state.activeClipIndexes];
            const activeInfo = clearedActiveClipIndexes[action.payload.layerIndex];
            if (activeInfo && activeInfo.pageId === pageIdx && activeInfo.colIndex === action.payload.colIndex) {
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
        case 'CLEAR_PAGE_CLIPS': {
            const pageIdx = action.payload.pageIndex;
            const numLayers = state.layers.length;
            const numCols = state.columns.length;

            const clearedClipContents = [...state.clipContents];
            clearedClipContents[pageIdx] = Array.from({ length: numLayers }, () => Array(numCols).fill(null));

            const clearedClipNames = [...state.clipNames];
            clearedClipNames[pageIdx] = Array.from({ length: numLayers }, (_, r) => Array.from({ length: numCols }, (_, c) => `Clip ${r + 1}-${c + 1}`));

            const clearedThumbnailFrameIndexes = [...state.thumbnailFrameIndexes];
            clearedThumbnailFrameIndexes[pageIdx] = Array.from({ length: numLayers }, () => Array(numCols).fill(0));

            const clearedActiveClipIndexes = [...state.activeClipIndexes];
            clearedActiveClipIndexes.forEach((info, lIdx) => {
                if (info && info.pageId === pageIdx) clearedActiveClipIndexes[lIdx] = null;
            });

            const selectionOnPage = state.selectedLayerIndex !== null && state.selectedLayerIndex !== undefined;
            const isSelectionOnPage = selectionOnPage && state.activeClipIndexes[state.selectedLayerIndex]?.pageId === pageIdx;
            const patch = {
                clipContents: clearedClipContents,
                clipNames: clearedClipNames,
                thumbnailFrameIndexes: clearedThumbnailFrameIndexes,
                activeClipIndexes: clearedActiveClipIndexes
            };
            if (isSelectionOnPage) {
                patch.selectedLayerIndex = null;
                patch.selectedColIndex = null;
                patch.selectedIldaWorkerId = null;
                patch.selectedIldaTotalFrames = 0;
                patch.selectedGeneratorId = null;
                patch.selectedGeneratorParams = {};
            }
            return { ...state, ...patch };
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
            if (typeof action.payload.setting === 'string' && action.payload.setting.startsWith('opt.')) {
                const key = action.payload.setting.slice(4);
                return {
                    ...state,
                    optimizationSettings: {
                        ...(state.optimizationSettings || {}),
                        [key]: action.payload.value,
                    },
                };
            }
            return { ...state, [action.payload.setting]: action.payload.value };
        }
        case 'SET_FILE_BROWSER_VIEW_MODE': {
            return { ...state, fileBrowserViewMode: action.payload };
        }
        case 'SET_FILE_BROWSER_PATH': {
            return { ...state, fileBrowserPath: action.payload };
        }
        case 'UPDATE_CLIP_UI_STATE': {
            const { layerIndex, colIndex, uiState } = action.payload;
            const pageIdx = state.activePageId;
            const updatedClipContents = [...state.clipContents];
            updatedClipContents[pageIdx] = [...updatedClipContents[pageIdx]];
            updatedClipContents[pageIdx][layerIndex] = [...updatedClipContents[pageIdx][layerIndex]];
            const clipToUpdate = { ...updatedClipContents[pageIdx][layerIndex][colIndex] };
            if (clipToUpdate) {
                clipToUpdate.uiState = mergeUiState(clipToUpdate.uiState, uiState);
                updatedClipContents[pageIdx][layerIndex][colIndex] = clipToUpdate;
            }
            return { ...state, clipContents: updatedClipContents };
        }
        case 'UPDATE_LAYER_UI_STATE': {
            const { layerIndex, uiState } = action.payload;
            const newLayerUiStates = [...state.layerUiStates];
            newLayerUiStates[layerIndex] = mergeUiState(newLayerUiStates[layerIndex], uiState);
            return { ...state, layerUiStates: newLayerUiStates };
        }
        case 'SET_LAYER_EFFECT_SPEED': {
            const { layerIndex, settings } = action.payload;
            const newLayerEffectSpeeds = [...state.layerEffectSpeeds];
            if (settings === null) {
                newLayerEffectSpeeds[layerIndex] = null;
            } else {
                newLayerEffectSpeeds[layerIndex] = {
                    mode: 'fps',
                    beats: 8,
                    duration: 1,
                    speedMultiplier: 1,
                    ...(newLayerEffectSpeeds[layerIndex] || {}),
                    ...settings
                };
            }
            return { ...state, layerEffectSpeeds: newLayerEffectSpeeds };
        }
        case 'SET_LAYER_PARAM_SYNC': {
            const { layerIndex, paramId, syncMode } = action.payload;
            const newLayerSyncSettings = [...state.layerSyncSettings];
            const currentSync = newLayerSyncSettings[layerIndex] || {};
            let nextSyncValue;
            if (typeof syncMode === 'string') {
                nextSyncValue = currentSync[paramId] === syncMode ? null : syncMode;
            } else {
                nextSyncValue = syncMode;
            }
            newLayerSyncSettings[layerIndex] = {
                ...currentSync,
                [paramId]: nextSyncValue
            };
            return { ...state, layerSyncSettings: newLayerSyncSettings };
        }
        case 'REMOVE_CLIP_EFFECT': {
            const pageIdx = state.activePageId;
            const updatedClipContents = [...state.clipContents];
            updatedClipContents[pageIdx] = [...updatedClipContents[pageIdx]];
            updatedClipContents[pageIdx][action.payload.layerIndex] = [...updatedClipContents[pageIdx][action.payload.layerIndex]];
            const clipToUpdate = { ...updatedClipContents[pageIdx][action.payload.layerIndex][action.payload.colIndex] };
            if (clipToUpdate && clipToUpdate.effects) {
                const newEffects = [...clipToUpdate.effects];
                newEffects.splice(action.payload.effectIndex, 1);
                clipToUpdate.effects = newEffects;
                updatedClipContents[pageIdx][action.payload.layerIndex][action.payload.colIndex] = clipToUpdate;
            }
            return { ...state, clipContents: updatedClipContents };
        }
        case 'REORDER_CLIP_EFFECTS': {
            const { layerIndex, colIndex, oldIndex, newIndex } = action.payload;
            const pageIdx = state.activePageId;
            const updatedClipContents = [...state.clipContents];
            updatedClipContents[pageIdx] = [...updatedClipContents[pageIdx]];
            updatedClipContents[pageIdx][layerIndex] = [...updatedClipContents[pageIdx][layerIndex]];
            const clipToUpdate = { ...updatedClipContents[pageIdx][layerIndex][colIndex] };
            if (clipToUpdate && clipToUpdate.effects) {
                const newEffects = [...clipToUpdate.effects];
                const [movedEffect] = newEffects.splice(oldIndex, 1);
                newEffects.splice(newIndex, 0, movedEffect);
                clipToUpdate.effects = newEffects;
                updatedClipContents[pageIdx][layerIndex][colIndex] = clipToUpdate;
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
            const pageIdx = state.activePageId;
            const updatedClipContents = [...state.clipContents];
            updatedClipContents[pageIdx] = [...updatedClipContents[pageIdx]];
            updatedClipContents[pageIdx][action.payload.layerIndex] = [...updatedClipContents[pageIdx][action.payload.layerIndex]];
            const clipToUpdate = { ...updatedClipContents[pageIdx][action.payload.layerIndex][action.payload.colIndex] };
            if (clipToUpdate && clipToUpdate.effects) {
                const newEffects = [...clipToUpdate.effects];
                const effectToUpdate = { ...newEffects[action.payload.effectIndex] };
                effectToUpdate.params = { ...effectToUpdate.params, [action.payload.paramName]: action.payload.newValue };
                newEffects[action.payload.effectIndex] = effectToUpdate;
                clipToUpdate.effects = newEffects;
                updatedClipContents[pageIdx][action.payload.layerIndex][action.payload.colIndex] = clipToUpdate;
            }
            return { ...state, clipContents: updatedClipContents };
        }
        case 'UPDATE_CLIP_PLAYBACK_SETTINGS': {
            const pageIdx = state.activePageId;
            const updatedClipContents = [...state.clipContents];
            updatedClipContents[pageIdx] = [...updatedClipContents[pageIdx]];
            updatedClipContents[pageIdx][action.payload.layerIndex] = [...updatedClipContents[pageIdx][action.payload.layerIndex]];
            const clipToUpdate = { ...updatedClipContents[pageIdx][action.payload.layerIndex][action.payload.colIndex] };
            if (clipToUpdate) {
                clipToUpdate.playbackSettings = {
                    ...(clipToUpdate.playbackSettings || { mode: 'fps', duration: 1, beats: 8, speedMultiplier: 1 }),
                    ...action.payload.settings
                };
                updatedClipContents[pageIdx][action.payload.layerIndex][action.payload.colIndex] = clipToUpdate;
            }
            return { ...state, clipContents: updatedClipContents };
        }
        case 'SET_CLIP_PARAM_SYNC': {
            const { layerIndex, colIndex, paramId, syncMode } = action.payload;
            const pageIdx = state.activePageId;
            const updatedClipContents = [...state.clipContents];
            updatedClipContents[pageIdx] = [...updatedClipContents[pageIdx]];
            updatedClipContents[pageIdx][layerIndex] = [...updatedClipContents[pageIdx][layerIndex]];
            const clipToUpdate = { ...updatedClipContents[pageIdx][layerIndex][colIndex] };
            if (clipToUpdate) {
                const currentSync = clipToUpdate.syncSettings || {};
                let nextSyncValue;

                if (typeof syncMode === 'string') {
                    // Toggle mode if it's a simple string
                    nextSyncValue = currentSync[paramId] === syncMode ? null : syncMode;
                } else {
                    // If it's an object (new settings), always apply it
                    nextSyncValue = syncMode;
                }

                clipToUpdate.syncSettings = {
                    ...currentSync,
                    [paramId]: nextSyncValue
                };
                updatedClipContents[pageIdx][layerIndex][colIndex] = clipToUpdate;
            }
            return { ...state, clipContents: updatedClipContents };
        }
        case 'UPDATE_GENERATOR_PARAM': {
            const pageIdx = state.activePageId;
            const updatedGenClipContents = [...state.clipContents];
            updatedGenClipContents[pageIdx] = [...updatedGenClipContents[pageIdx]];
            updatedGenClipContents[pageIdx][action.payload.layerIndex] = [...updatedGenClipContents[pageIdx][action.payload.layerIndex]];
            const genClipToUpdate = { ...updatedGenClipContents[pageIdx][action.payload.layerIndex][action.payload.colIndex] };
            if (genClipToUpdate && genClipToUpdate.type === 'generator' && genClipToUpdate.currentParams) {
                genClipToUpdate.currentParams = {
                    ...genClipToUpdate.currentParams,
                    [action.payload.paramName]: action.payload.newValue
                };
                updatedGenClipContents[pageIdx][action.payload.layerIndex][action.payload.colIndex] = genClipToUpdate;
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
        case 'SET_OPTIMIZATION_ENABLED':
            return { ...state, optimizationEnabled: action.payload };
        case 'SET_OPTIMIZATION_MAX_DIST':
            return { ...state, optimizationMaxDist: action.payload };
        case 'SET_OPTIMIZATION_PATH_DWELL':
            return { ...state, optimizationPathDwell: action.payload };
        case 'TOGGLE_WORLD_OUTPUT_ACTIVE': {
            return { ...state, isWorldOutputActive: !state.isWorldOutputActive };
        }
        case 'SET_CLIPBOARD': {
            return { ...state, clipClipboard: action.payload };
        }
        case 'SET_CLIP_DAC': {
            const pageIdx = state.activePageId;
            const newClipContentsWithDac = [...state.clipContents];
            newClipContentsWithDac[pageIdx] = [...newClipContentsWithDac[pageIdx]];

            if (!newClipContentsWithDac[pageIdx][action.payload.layerIndex]) {
                console.error(`Reducer Error: Layer array at index ${action.payload.layerIndex} on page ${pageIdx} is undefined.`);
                return state;
            }
            newClipContentsWithDac[pageIdx][action.payload.layerIndex] = [...newClipContentsWithDac[pageIdx][action.payload.layerIndex]];

            // Get the existing clip, create a new copy of it, and then modify its dac
            const existingClip = newClipContentsWithDac[pageIdx][action.payload.layerIndex][action.payload.colIndex] || {};

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
            newClipContentsWithDac[pageIdx][action.payload.layerIndex][action.payload.colIndex] = updatedClip;
            return { ...state, clipContents: newClipContentsWithDac };
        }
        case 'SET_CLIP_DAC_GROUP': {
            const { layerIndex, colIndex, groupDacs } = action.payload;
            const pageIdx = state.activePageId;
            const newClipContents = [...state.clipContents];
            newClipContents[pageIdx] = [...newClipContents[pageIdx]];
            newClipContents[pageIdx][layerIndex] = [...newClipContents[pageIdx][layerIndex]];
            const existingClip = newClipContents[pageIdx][layerIndex][colIndex] || {};

            const currentAssignedDacs = existingClip.assignedDacs || [];
            const dacsToAdd = groupDacs.filter(gd => {
                return !currentAssignedDacs.some(d => d.ip === gd.ip && d.channel === gd.channel);
            }).map(gd => ({
                ...gd,
                mirrorX: false,
                mirrorY: false
            }));

            if (dacsToAdd.length === 0) return state;

            newClipContents[pageIdx][layerIndex][colIndex] = {
                ...existingClip,
                assignedDacs: [...currentAssignedDacs, ...dacsToAdd]
            };
            return { ...state, clipContents: newClipContents };
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
        case 'SET_LAYER_DAC_GROUP': {
            const { layerIndex, groupDacs } = action.payload;
            const newLayerAssignedDacs = [...state.layerAssignedDacs];
            const currentDacs = newLayerAssignedDacs[layerIndex] || [];

            const dacsToAdd = groupDacs.filter(gd => {
                return !currentDacs.some(d => d.ip === gd.ip && d.channel === gd.channel);
            }).map(gd => ({
                ...gd,
                mirrorX: false,
                mirrorY: false
            }));

            if (dacsToAdd.length === 0) return state;

            newLayerAssignedDacs[layerIndex] = [...currentDacs, ...dacsToAdd];
            return { ...state, layerAssignedDacs: newLayerAssignedDacs };
        }
        case 'TOGGLE_CLIP_DAC_MIRROR': {
            const { layerIndex, colIndex, dacIndex, axis } = action.payload;
            const pageIdx = state.activePageId;
            const newClipContents = [...state.clipContents];
            newClipContents[pageIdx] = [...newClipContents[pageIdx]];
            newClipContents[pageIdx][layerIndex] = [...newClipContents[pageIdx][layerIndex]];
            const existingClip = { ...newClipContents[pageIdx][layerIndex][colIndex] };
            if (existingClip && existingClip.assignedDacs) {
                const newAssignedDacs = [...existingClip.assignedDacs];
                const targetDac = { ...newAssignedDacs[dacIndex] };
                if (axis === 'x') targetDac.mirrorX = !targetDac.mirrorX;
                if (axis === 'y') targetDac.mirrorY = !targetDac.mirrorY;
                newAssignedDacs[dacIndex] = targetDac;
                existingClip.assignedDacs = newAssignedDacs;
                newClipContents[pageIdx][layerIndex][colIndex] = existingClip;
                return { ...state, clipContents: newClipContents };
            }
            return state;
        }
        case 'REMOVE_CLIP_DAC': {
            const pageIdx = state.activePageId;
            const newClipContents = [...state.clipContents];
            newClipContents[pageIdx] = [...newClipContents[pageIdx]];
            newClipContents[pageIdx][action.payload.layerIndex] = [...newClipContents[pageIdx][action.payload.layerIndex]];
            const { layerIndex, colIndex, dacIndex } = action.payload;
            const existingClip = newClipContents[pageIdx][layerIndex][colIndex];
            if (existingClip && existingClip.assignedDacs) {
                const newAssignedDacs = [...existingClip.assignedDacs];
                newAssignedDacs.splice(dacIndex, 1);
                newClipContents[pageIdx][action.payload.layerIndex][action.payload.colIndex] = {
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
        case 'REORDER_CLIP_DACS': {
            const { layerIndex, colIndex, oldIndex, newIndex } = action.payload;
            const pageIdx = state.activePageId;
            const newClipContents = [...state.clipContents];
            newClipContents[pageIdx] = [...newClipContents[pageIdx]];
            newClipContents[pageIdx][layerIndex] = [...newClipContents[pageIdx][layerIndex]];
            const existingClip = { ...newClipContents[pageIdx][layerIndex][colIndex] };
            if (existingClip && existingClip.assignedDacs && existingClip.assignedDacs.length > 1) {
                const newAssignedDacs = [...existingClip.assignedDacs];
                const clampedNew = Math.max(0, Math.min(newIndex, newAssignedDacs.length - 1));
                const [movedDac] = newAssignedDacs.splice(oldIndex, 1);
                newAssignedDacs.splice(clampedNew, 0, movedDac);
                existingClip.assignedDacs = newAssignedDacs;
                newClipContents[pageIdx][layerIndex][colIndex] = existingClip;
                return { ...state, clipContents: newClipContents };
            }
            return state;
        }
        case 'REORDER_LAYER_DACS': {
            const { layerIndex, oldIndex, newIndex } = action.payload;
            const newLayerAssignedDacs = [...state.layerAssignedDacs];
            if (newLayerAssignedDacs[layerIndex]) {
                const layerDacs = [...newLayerAssignedDacs[layerIndex]];
                if (layerDacs.length > 1) {
                    const clampedNew = Math.max(0, Math.min(newIndex, layerDacs.length - 1));
                    const [movedDac] = layerDacs.splice(oldIndex, 1);
                    layerDacs.splice(clampedNew, 0, movedDac);
                    newLayerAssignedDacs[layerIndex] = layerDacs;
                    return { ...state, layerAssignedDacs: newLayerAssignedDacs };
                }
            }
            return state;
        }
        case 'SET_CLIP_AUDIO': {
            const pageIdx = state.activePageId;
            const newClipContents = [...state.clipContents];
            const { layerIndex, colIndex, audioFile } = action.payload;
            newClipContents[pageIdx] = [...newClipContents[pageIdx]];
            newClipContents[pageIdx][layerIndex] = [...newClipContents[pageIdx][layerIndex]];
            const existingClip = newClipContents[pageIdx][layerIndex][colIndex];
            if (existingClip) {
                newClipContents[pageIdx][layerIndex][colIndex] = {
                    ...existingClip,
                    audioFile,
                    audioVolume: existingClip.audioVolume !== undefined ? existingClip.audioVolume : 1.0
                };
                return { ...state, clipContents: newClipContents };
            }
            return state;
        }
        case 'SET_CLIP_AUDIO_VOLUME': {
            const pageIdx = state.activePageId;
            const newClipContents = [...state.clipContents];
            const { layerIndex, colIndex, volume } = action.payload;
            newClipContents[pageIdx] = [...newClipContents[pageIdx]];
            newClipContents[pageIdx][layerIndex] = [...newClipContents[pageIdx][layerIndex]];
            const existingClip = newClipContents[pageIdx][layerIndex][colIndex];
            if (existingClip) {
                newClipContents[pageIdx][layerIndex][colIndex] = {
                    ...existingClip,
                    audioVolume: volume
                };
                return { ...state, clipContents: newClipContents };
            }
            return state;
        }
        case 'REMOVE_CLIP_AUDIO': {
            const pageIdx = state.activePageId;
            const newClipContents = [...state.clipContents];
            const { layerIndex, colIndex } = action.payload;
            newClipContents[pageIdx] = [...newClipContents[pageIdx]];
            newClipContents[pageIdx][layerIndex] = [...newClipContents[pageIdx][layerIndex]];
            const existingClip = newClipContents[pageIdx][layerIndex][colIndex];
            if (existingClip) {
                newClipContents[pageIdx][layerIndex][colIndex] = {
                    ...existingClip,
                    audioFile: null
                };
                return { ...state, clipContents: newClipContents };
            }
            return state;
        }
        case 'SET_CLIP_PARSING_STATUS': {
            const { layerIndex, colIndex, status, pageId } = action.payload;
            const pageIdx = pageId !== undefined ? pageId : state.activePageId;
            const newClipContents = [...state.clipContents];

            if (newClipContents[pageIdx]) {
                newClipContents[pageIdx] = [...newClipContents[pageIdx]];
                if (newClipContents[pageIdx][layerIndex]) {
                    newClipContents[pageIdx][layerIndex] = [...newClipContents[pageIdx][layerIndex]];
                    const existingClip = newClipContents[pageIdx][layerIndex][colIndex] || {};
                    newClipContents[pageIdx][layerIndex][colIndex] = { ...existingClip, parsing: status };
                    return { ...state, clipContents: newClipContents };
                }
            }
            return state;
        }
        case 'SET_BULK_PARSING_STATUS': {
            const newClipContents = [...state.clipContents];

            // Group by pageIdx for efficient immutable updates
            const affectedPages = new Set(action.payload.map(p => p.pageId !== undefined ? p.pageId : state.activePageId));
            affectedPages.forEach(pIdx => {
                if (newClipContents[pIdx]) newClipContents[pIdx] = [...newClipContents[pIdx]];
            });

            action.payload.forEach(({ layerIndex, colIndex, status, pageId }) => {
                const pIdx = pageId !== undefined ? pageId : state.activePageId;
                if (newClipContents[pIdx] && newClipContents[pIdx][layerIndex]) {
                    newClipContents[pIdx][layerIndex] = [...newClipContents[pIdx][layerIndex]];
                    const existingClip = newClipContents[pIdx][layerIndex][colIndex] || {};
                    newClipContents[pIdx][layerIndex][colIndex] = { ...existingClip, parsing: status };
                }
            });
            return { ...state, clipContents: newClipContents };
        }
        case 'SET_THUMBNAIL_RENDER_MODE': {
            return { ...state, thumbnailRenderMode: action.payload };
        }
        case 'SET_CLIP_TRIGGER_STYLE': {
            const { layerIndex, colIndex, style } = action.payload;
            const pageIdx = state.activePageId;
            const newClipContents = [...state.clipContents];
            newClipContents[pageIdx] = [...newClipContents[pageIdx]];
            newClipContents[pageIdx][layerIndex] = [...newClipContents[pageIdx][layerIndex]];
            const existingClip = newClipContents[pageIdx][layerIndex][colIndex] || {};
            newClipContents[pageIdx][layerIndex][colIndex] = { ...existingClip, triggerStyle: style };
            return { ...state, clipContents: newClipContents };
        }
        case 'SET_THEME': {
            return { ...state, theme: action.payload };
        }
        case 'UPDATE_THUMBNAIL': {
            const { layerIndex, colIndex, frameIndex } = action.payload;
            const pageIdx = state.activePageId;
            const newThumbnailFrameIndexes = [...state.thumbnailFrameIndexes];
            newThumbnailFrameIndexes[pageIdx] = [...newThumbnailFrameIndexes[pageIdx]];
            newThumbnailFrameIndexes[pageIdx][layerIndex] = [...newThumbnailFrameIndexes[pageIdx][layerIndex]];
            newThumbnailFrameIndexes[pageIdx][layerIndex][colIndex] = frameIndex;
            return { ...state, thumbnailFrameIndexes: newThumbnailFrameIndexes };
        }
        case 'RESET_STATE': {
            return getInitialState({});
        }
        case 'LOAD_PROJECT': {
            const loadedState = { ...state, ...action.payload };
            // Validate structures (8 pages, 5 layers, 8 columns)
            loadedState.clipContents = ensureArrayStructure(loadedState.clipContents, 8, 5, 8, () => ({ parsing: false }));
            loadedState.clipNames = ensureArrayStructure(loadedState.clipNames, 8, 5, 8, (p, r, c) => `Clip ${r + 1}-${c + 1}`);
            loadedState.thumbnailFrameIndexes = ensureArrayStructure(loadedState.thumbnailFrameIndexes, 8, 5, 8, () => 0);

            // Invalidate workerIds for ILDA clips across ALL pages to trigger re-parsing
            loadedState.clipContents = loadedState.clipContents.map(page =>
                page.map(layer =>
                    layer.map(clip => {
                        if (clip && clip.type === 'ilda') {
                            return { ...clip, workerId: null, parsing: false, parsingFailed: false };
                        }
                        return clip;
                    })
                )
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
                clipNames: action.payload.clipNames ? ensureArrayStructure(action.payload.clipNames, 8, 5, 8, (p, r, c) => `Clip ${r + 1}-${c + 1}`) : state.clipNames,
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

            // Add pageId to the link if it targets a clip
            const pageId = (link.targetType === 'effect' || link.targetType === 'generator')
                ? (link.pageId ?? state.activePageId)
                : undefined;

            const linked = { ...link, pageId };

            if (type === 'button') {
                // Buttons support multiple assigned actions
                const nextLinks = [...getQuickControlLinks(newAssigns.buttons[index]), linked];
                newAssigns.buttons[index] = {
                    ...newAssigns.buttons[index],
                    label: formatQuickAssignLabel(nextLinks),
                    links: nextLinks,
                    min: link.min,
                    max: link.max,
                    step: link.step
                };
            } else {
                // Knobs support multiple assigned actions
                const nextLinks = [...getQuickControlLinks(newAssigns.knobs[index]), linked];
                newAssigns.knobs[index] = {
                    ...newAssigns.knobs[index],
                    label: formatQuickAssignLabel(nextLinks),
                    links: nextLinks,
                    min: link.min,
                    max: link.max,
                    step: link.step
                };
            }
            return { ...state, quickAssigns: newAssigns };
        }
        case 'CLEAR_QUICK_CONTROL': {
            const { type, index } = action.payload;
            const newAssigns = {
                knobs: [...state.quickAssigns.knobs],
                buttons: [...state.quickAssigns.buttons]
            };
            const collection = type === 'knob' ? 'knobs' : 'buttons';
            newAssigns[collection][index] = type === 'knob'
                ? { value: 0, label: null, links: [] }
                : { value: false, label: null, links: [] };
            return { ...state, quickAssigns: newAssigns };
        }
        case 'REMOVE_QUICK_ASSIGN_LINK': {
            const { type = 'button', index, linkIndex } = action.payload;
            const newAssigns = {
                knobs: [...state.quickAssigns.knobs],
                buttons: [...state.quickAssigns.buttons]
            };
            const collection = type === 'knob' ? 'knobs' : 'buttons';
            const control = newAssigns[collection][index];
            const remainingLinks = getQuickControlLinks(control).filter((_, i) => i !== linkIndex);
            if (remainingLinks.length === 0) {
                newAssigns[collection][index] = type === 'knob'
                    ? { value: 0, label: null, links: [] }
                    : { value: false, label: null, links: [] };
            } else {
                newAssigns[collection][index] = {
                    ...control,
                    label: formatQuickAssignLabel(remainingLinks),
                    links: remainingLinks
                };
            }
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
            const links = getQuickControlLinks(control);
            if (links.length > 0) {
                for (const link of links) {
                    const { layerIndex, colIndex, effectIndex, targetType } = link;
                    const paramName = link.paramName || link.paramId;

                    // Scale 0-1 to this link's min-max range
                    let targetValue = value;
                    if (type === 'knob' && link.min !== undefined && link.max !== undefined) {
                        targetValue = link.min + (value * (link.max - link.min));
                        if (link.step) {
                            targetValue = Math.round(targetValue / link.step) * link.step;
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
                                const partner = getLinkedPartnerParam(link.effectId, paramName, effect.params);
                                if (partner) effect.params = { ...effect.params, [partner]: targetValue };
                                newLayerEffects[layerIndex][effectIndex] = effect;
                                newState = { ...newState, layerEffects: newLayerEffects };
                            }
                        }
                    } else if (targetType === 'global') {
                        if (paramName === 'master_intensity') newState = { ...newState, masterIntensity: targetValue };
                        else if (paramName === 'master_speed') newState = { ...newState, playbackFps: targetValue };
                    } else if (targetType === 'dac') {
                        const dacId = link.dacId;
                        if (dacId) {
                            newState = {
                                ...newState,
                                dacOutputSettings: {
                                    ...(newState.dacOutputSettings || {}),
                                    [dacId]: {
                                        ...(newState.dacOutputSettings[dacId] || {}),
                                        [paramName]: targetValue
                                    }
                                }
                            };
                        }
                    } else {
                        const updatedClipContents = [...newState.clipContents];
                        const pageIdx = link.pageId ?? state.activePageId;

                        if (updatedClipContents[pageIdx] && updatedClipContents[pageIdx][layerIndex]) {
                            updatedClipContents[pageIdx] = [...updatedClipContents[pageIdx]];
                            updatedClipContents[pageIdx][layerIndex] = [...updatedClipContents[pageIdx][layerIndex]];
                            const clip = updatedClipContents[pageIdx][layerIndex][colIndex];

                            if (clip) {
                                if (targetType === 'effect' && clip.effects && clip.effects[effectIndex]) {
                                    const newEffects = [...clip.effects];
                                    const effect = { ...newEffects[effectIndex] };
                                    effect.params = { ...effect.params, [paramName]: targetValue };
                                    const partner = getLinkedPartnerParam(link.effectId, paramName, effect.params);
                                    if (partner) effect.params = { ...effect.params, [partner]: targetValue };
                                    newEffects[effectIndex] = effect;
                                    updatedClipContents[pageIdx][layerIndex][colIndex] = { ...clip, effects: newEffects };
                                } else if (targetType === 'generator') {
                                    updatedClipContents[pageIdx][layerIndex][colIndex] = {
                                        ...clip,
                                        currentParams: { ...clip.currentParams, [paramName]: targetValue }
                                    };
                                }
                            }
                            newState = { ...newState, clipContents: updatedClipContents };
                        }
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
            for (const link of getQuickControlLinks(control)) {
                const { layerIndex, colIndex, effectIndex, targetType } = link;
                const paramName = link.paramName || link.paramId;

                if (targetType === 'global') {
                    if (paramName === 'blackout') newState.globalBlackout = newValue;
                    else if (paramName === 'laser_output') newState.isWorldOutputActive = newValue;
                } else if (targetType === 'layer') {
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
                        if (newValue) {
                            const deactivatedActiveClipIndexes = [...newState.activeClipIndexes];
                            deactivatedActiveClipIndexes[layerIndex] = null;
                            newState = { ...newState, activeClipIndexes: deactivatedActiveClipIndexes };
                            newAssigns.buttons[index].value = false;
                            newState.quickAssigns = newAssigns;
                        }
                    } else if (paramName === 'autopilot') {
                        const newLayerAutopilots = [...newState.layerAutopilots];
                        newLayerAutopilots[layerIndex] = newValue ? 'forward' : 'off';
                        newState = { ...newState, layerAutopilots: newLayerAutopilots };
                    }
                } else if (targetType === 'layerEffect') {
                    const newLayerEffects = [...newState.layerEffects];
                    if (newLayerEffects[layerIndex]) {
                        newLayerEffects[layerIndex] = [...newLayerEffects[layerIndex]];
                        if (newLayerEffects[layerIndex][effectIndex]) {
                            const effect = { ...newLayerEffects[layerIndex][effectIndex] };
                            effect.params = { ...effect.params, [paramName]: newValue };
                            newLayerEffects[layerIndex][effectIndex] = effect;
                            newState = { ...newState, layerEffects: newLayerEffects };
                        }
                    }
                } else {
                    const updatedClipContents = [...newState.clipContents];
                    const pageIdx = link.pageId ?? state.activePageId;

                    if (updatedClipContents[pageIdx] && updatedClipContents[pageIdx][layerIndex]) {
                        updatedClipContents[pageIdx] = [...updatedClipContents[pageIdx]];
                        updatedClipContents[pageIdx][layerIndex] = [...updatedClipContents[pageIdx][layerIndex]];
                        const clip = updatedClipContents[pageIdx][layerIndex][colIndex];

                        if (clip) {
                            if (targetType === 'effect' && clip.effects && clip.effects[effectIndex]) {
                                const newEffects = [...clip.effects];
                                const effect = { ...newEffects[effectIndex] };
                                effect.params = { ...effect.params, [paramName]: newValue };
                                newEffects[effectIndex] = effect;
                                updatedClipContents[pageIdx][layerIndex][colIndex] = { ...clip, effects: newEffects };
                            } else if (targetType === 'generator') {
                                updatedClipContents[pageIdx][layerIndex][colIndex] = {
                                    ...clip,
                                    currentParams: { ...clip.currentParams, [paramName]: newValue }
                                };
                            }
                        }
                        newState = { ...newState, clipContents: updatedClipContents };
                    }
                }
            }
            return newState;
        }
        case 'UPDATE_CLIP_FILE_PATH': {
            const { oldPath, newPath } = action.payload;
            console.log(`Reducer: Updating clip path from ${oldPath} to ${newPath}`);
            const newClipContents = state.clipContents.map(page =>
                page.map(layer =>
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
                )
            );
            return { ...state, clipContents: newClipContents };
        }
        case 'SET_CLIP_PARSING_FAILED': {
            const { layerIndex, colIndex, failed, pageId } = action.payload;
            const pageIdx = pageId !== undefined ? pageId : state.activePageId;
            const newClipContents = [...state.clipContents];

            if (newClipContents[pageIdx]) {
                newClipContents[pageIdx] = [...newClipContents[pageIdx]];
                if (newClipContents[pageIdx][layerIndex]) {
                    newClipContents[pageIdx][layerIndex] = [...newClipContents[pageIdx][layerIndex]];
                    const existingClip = newClipContents[pageIdx][layerIndex][colIndex];
                    if (existingClip) {
                        newClipContents[pageIdx][layerIndex][colIndex] = { ...existingClip, parsingFailed: failed };
                    }
                }
            }
            return { ...state, clipContents: newClipContents };
        }
        default:
            return state;
    }
}

const generateThumbnail = async (frame, effects, layerIndex, colIndex, optimizationEnabled = true, pageId = 0) => {
    // Basic validation
    if (!frame || !frame.points) return null;

    let frameToProcess = frame;
    if (optimizationEnabled) {
        try {
            const optimizedPoints = optimizePoints(frame.points, { isClosed: frame.isClosed });
            frameToProcess = { ...frame, points: optimizedPoints, isTypedArray: true };
        } catch (e) {
            console.warn("Failed to optimize points for thumbnail:", e);
        }
    }

    // Apply effects to the frame for the thumbnail
    let processedFrame = frameToProcess;
    try {
        if (effects && effects.length > 0) {
            processedFrame = applyEffects(frameToProcess, effects, {
                progress: 0,
                time: 0,
                effectStates: new Map(),
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

    // Bail out if there is nothing to draw - never overwrite a good cached
    // thumbnail with a blank/black render (e.g. a transient empty regeneration).
    if (!numPoints || numPoints === 0) return null;

    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';

    let lastX = null;
    let lastY = null;
    let lastWasBlanked = true;

    for (let i = 0; i < numPoints; i++) {
        let x, y, r, g, b, blanking;
        if (isTyped) {
            const off = i * 8;
            x = points[off]; y = points[off + 1];
            r = points[off + 3]; g = points[off + 4]; b = points[off + 5];
            blanking = points[off + 6] > 0.5;
        } else {
            const p = points[i];
            x = p.x; y = p.y;
            r = p.r; g = p.g; b = p.b;
            blanking = !!p.blanking;
        }

        const screenX = (x + 1) * 0.5 * width;
        const screenY = (1 - (y + 1) * 0.5) * height;

        // Draw ONLY if both this point and the previous point are LIT
        if (!blanking && !lastWasBlanked && lastX !== null) {
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(screenX, screenY);

            const ir = Math.floor(Math.max(0, Math.min(255, r)));
            const ig = Math.floor(Math.max(0, Math.min(255, g)));
            const ib = Math.floor(Math.max(0, Math.min(255, b)));

            ctx.strokeStyle = `rgb(${ir},${ig},${ib})`;
            ctx.stroke();
        }

        lastX = screenX;
        lastY = screenY;
        lastWasBlanked = blanking;
    }

    // Automatically close the loop for the thumbnail if the frame is explicitly marked as closed
    let firstX, firstY, firstR, firstG, firstB, firstBlanking;
    if (isTyped) {
        firstX = points[0]; firstY = points[1];
        firstR = points[3]; firstG = points[4]; firstB = points[5];
        firstBlanking = points[6] > 0.5;
    } else {
        const p = points[0];
        firstX = p.x; firstY = p.y;
        firstR = p.r; firstG = p.g; firstB = p.b;
        firstBlanking = !!p.blanking;
    }

    if (processedFrame.isClosed && !lastWasBlanked && !firstBlanking && lastX !== null) {
        const dist = Math.sqrt(Math.pow(lastX - ((firstX + 1) * 0.5 * width), 2) + Math.pow(lastY - ((1 - (firstY + 1) * 0.5) * height), 2));
        // Only close if last and first are not at the exact same pixel
        if (dist > 0.1) {
            const screenX = (firstX + 1) * 0.5 * width;
            const screenY = (1 - (firstY + 1) * 0.5) * height;

            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(screenX, screenY);

            const ir = Math.floor(Math.max(0, Math.min(255, firstR)));
            const ig = Math.floor(Math.max(0, Math.min(255, firstG)));
            const ib = Math.floor(Math.max(0, Math.min(255, firstB)));

            ctx.strokeStyle = `rgb(${ir},${ig},${ib})`;
            ctx.stroke();
        }
    }

    // Convert to Blob and then ArrayBuffer
    try {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const arrayBuffer = await blob.arrayBuffer();

        if (window.electronAPI && window.electronAPI.saveThumbnail) {
            // Page-aware filename so clips on different pages do not overwrite each
            // other's cached thumbnail files.
            const filename = `thumb_P${pageId}_L${layerIndex}_C${colIndex}.png`;
            return await window.electronAPI.saveThumbnail(arrayBuffer, filename);
        }
    } catch (e) {
        console.error("Error generating/saving thumbnail:", e);
    }

    return null;
};

const StatsDisplay = React.memo(({ type, previewFrameCountRef, totalPointsSentRef, activeChannelsCountRef, lastStatUpdateTimeRef, channelPointCountsRef, dacOutputSettingsRef, liveDacOutputSettingsRef, dacs }) => {
    const [stats, setStats] = useState({ cpu: '0.0', ram: '0', fps: 0, pps: 0, avgPps: 0, frameBudget: null });
    const cpuTextRef = useRef(null);
    const ramTextRef = useRef(null);

    useEffect(() => {
        if (type === 'system') {
            // Ref-driven text updates so CPU/RAM IPC never triggers a React render.
            const unsub = window.electronAPI?.onSystemStats((systemData) => {
                if (cpuTextRef.current && systemData.cpu !== undefined) cpuTextRef.current.textContent = `CPU: ${systemData.cpu}%`;
                if (ramTextRef.current && systemData.ram !== undefined) ramTextRef.current.textContent = `RAM: ${systemData.ram}MB`;
            });
            return () => { if (unsub) unsub(); };
        }

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

                    const setStatsUpdate = { fps: currentFps, pps: totalPps, avgPps: avgPps };

                    // PPS budget: show used/available of the channel with the
                    // lowest set POINTS-PER-SECOND budget (the first limit to
                    // hit), turning bright red once above 85% of its budget.
                    // `channelPointCountsRef` accumulates points sent per channel
                    // over this 1s window, so dividing by elapsed yields the
                    // actual PPS — never divide the PPS target down to a per-frame
                    // number and compare it to a per-second count (that treatment
                    // treats the pps figure as frame-scaled /30).
                    if (channelPointCountsRef && (dacOutputSettingsRef || liveDacOutputSettingsRef)) {
                        const usedById = channelPointCountsRef.current || {};
                        const ids = new Set(Object.keys(dacOutputSettingsRef.current || {}));
                        (dacs || []).forEach(dac => {
                            const channels = (dac.channels && dac.channels.length) ? dac.channels : [{ serviceID: 0 }];
                            channels.forEach(ch => ids.add(`${dac.ip}:${ch.serviceID}`));
                        });
                        const candidates = [];
                        ids.forEach(id => {
                            const s = (liveDacOutputSettingsRef && liveDacOutputSettingsRef.current && liveDacOutputSettingsRef.current[id])
                                || (dacOutputSettingsRef.current && dacOutputSettingsRef.current[id]) || {};
                            const preset = (s.ppsPreset && getPreset(s.ppsPreset)) ? getPreset(s.ppsPreset) : getPreset(DEFAULT_PRESET);
                            const effPps = (s.ppsOverride && s.ppsOverride > 0) ? s.ppsOverride : (preset.targetPps || 30000);
                            const usedPps = (usedById[id] || 0) / Math.max(0.001, elapsed);
                            candidates.push({ id, budget: Math.max(1, Math.round(effPps)), used: usedPps });
                        });
                        const usedCandidates = candidates.filter(c => c.used > 0);
                        const pool = usedCandidates.length > 0 ? usedCandidates : candidates;
                        if (pool.length > 0) {
                            pool.sort((a, b) => a.budget - b.budget);
                            const pick = pool[0];
                            const ratio = pick.used / pick.budget;
                            setStatsUpdate.frameBudget = {
                                used: Math.round(pick.used),
                                budget: pick.budget,
                                pct: Math.round(ratio * 100),
                                warn: ratio >= 0.85,
                            };
                        } else {
                            setStatsUpdate.frameBudget = null;
                        }
                        channelPointCountsRef.current = {};
                    }

                    setStats(prev => ({ ...prev, ...setStatsUpdate }));

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
    }, [type, previewFrameCountRef, totalPointsSentRef, activeChannelsCountRef, lastStatUpdateTimeRef, channelPointCountsRef, dacOutputSettingsRef, liveDacOutputSettingsRef, dacs]);

    if (type === 'system') {
        return (
            <div className="systemStats">
                <p ref={cpuTextRef} className="sysStats">CPU: ...</p><p ref={ramTextRef} className="sysStats">RAM: ...</p>
            </div>
        );
    }

    return (
        <div className="performanceStats">
            <p className="perfStats">UI-FPS: {stats.fps}</p><p className="perfStats">Out-PPS: {stats.avgPps} (Avg)</p>
            {stats.frameBudget ? (
                <p className={`perfStats${stats.frameBudget.warn ? ' perfStatsWarn' : ''}`} title="PPS utilization of the channel with the lowest set point budget (used points/sec vs scan rate)">
                    PT: {stats.frameBudget.used}/{stats.frameBudget.budget} ({stats.frameBudget.pct}%)
                </p>
            ) : null}
        </div>
    );
});

const SystemMonitor = React.memo(({
    previewScanRate, previewFrameCountRef, totalPointsSentRef, activeChannelsCountRef, lastStatUpdateTimeRef,
    channelPointCountsRef, dacOutputSettingsRef, liveDacOutputSettingsRef, dacs
}) => {
    return (
        <div className="system-monitor-grid">
            <StatsDisplay
                type="performance"
                previewFrameCountRef={previewFrameCountRef}
                totalPointsSentRef={totalPointsSentRef}
                activeChannelsCountRef={activeChannelsCountRef}
                lastStatUpdateTimeRef={lastStatUpdateTimeRef}
                channelPointCountsRef={channelPointCountsRef}
                dacOutputSettingsRef={dacOutputSettingsRef}
                liveDacOutputSettingsRef={liveDacOutputSettingsRef}
                dacs={dacs}
            />
            <StatsDisplay
                type="system"
                previewFrameCountRef={previewFrameCountRef}
                totalPointsSentRef={totalPointsSentRef}
                activeChannelsCountRef={activeChannelsCountRef}
                lastStatUpdateTimeRef={lastStatUpdateTimeRef}
                channelPointCountsRef={channelPointCountsRef}
                dacOutputSettingsRef={dacOutputSettingsRef}
                liveDacOutputSettingsRef={liveDacOutputSettingsRef}
                dacs={dacs}
            />
        </div>
    );
});

const SidePanelContainer = React.memo(({
    selectedLayerIndex,
    selectedColIndex,
    liveFramesRef,
    progressRef,
    selectedDac,
    liveDacOutputSettingsRef,
    dacOutputSettings,
    getAudioInfo,
    getFftLevels,
    effectStatesRef,
    previewEffectStatesRef,
    clipActivationTimesRef,
    showBeamEffect,
    beamAlpha,
    fadeAlpha,
    previewScanRate,
    beamRenderMode,
    worldShowBeamEffect,
    worldBeamRenderMode,
    handleToggleBeamEffect,
    handleCycleDisplayMode,
    previewFrameCountRef,
    liveClipContentsRef,
    activeClipIndexesRef, // Use Ref
    layerEffectsRef, // Use Ref
    bpmRef, // Use Ref
    layerEffectSpeedsRef, // Use Ref
    layerSyncSettingsRef, // Use Ref
    playbackFpsRef, // Use Ref
    masterIntensityRef, // Use Ref
    layerIntensitiesRef, // Use Ref
    globalBlackoutRef, // Use Ref
    layerSolosRef, // Use Ref
    layerBlackoutsRef, // Use Ref
    optimizationEnabled,
    activePageId
}) => {
    const [tick, setTick] = useState(0);
    const lastPreviewTimeRef = useRef(0);
    const previewTimeRef = useRef(performance.now());
    const lastPreviewSigRef = useRef([]);
    const lastPreviewContentRef = useRef(false);
    const previewInterval = 1000 / 70; // Target >60Hz to reliably catch every 60Hz VSync frame

    // Cheap snapshot of everything the two preview panels actually consume. The tick is
    // allowed to skip the heavy re-render when nothing observable changed (e.g. a clip
    // selected while playback is stopped) without freezing the permanent UI-FPS loop,
    // which always counts frames regardless of whether a render happened. Interaction-
    // driven values (intensity/blackout/effects) are included so slider/toggle edits
    // still re-render immediately.
    const buildPreviewSignature = () => {
        const sig = [];
        const lr = liveFramesRef.current;
        const pr = progressRef.current;

        const addFrame = (wId) => {
            const f = wId ? lr[wId] : null;
            sig.push(wId || '', f ? (f.points || f) : null, pr[wId] !== undefined ? +pr[wId].toFixed(3) : 0);
        };

        // Selected clip preview (IldaPlayer)
        if (selectedLayerIndex !== null && selectedColIndex !== null) {
            const sc = liveClipContentsRef.current?.[activePageId]?.[selectedLayerIndex]?.[selectedColIndex];
            const wId = sc
                ? (sc.type === 'ilda' ? sc.workerId : `generator-${activePageId}-${selectedLayerIndex}-${selectedColIndex}`)
                : null;
            addFrame(wId);
            sig.push(sc || null); // effect/param edits produce a new clip identity -> re-render
        }

        // World preview (WorldPreview) — every active clip's frame + progress
        activeClipIndexesRef.current.forEach((info, layerIndex) => {
            if (info && info.colIndex !== null) {
                const clip = liveClipContentsRef.current?.[info.pageId]?.[layerIndex]?.[info.colIndex];
                const wId = clip ? (clip.type === 'ilda' ? clip.workerId : `generator-${info.pageId}-${layerIndex}-${info.colIndex}`) : null;
                addFrame(wId);
                // Active set membership changes must re-render even if the remaining
                // frames are identical (deactivations/activations while paused).
                sig.push(clip || null, `${info.pageId}:${layerIndex}:${info.colIndex}`);
            }
        });

        // Live mixing/effect refs that must re-render as the user interacts
        sig.push(
            masterIntensityRef.current,
            globalBlackoutRef.current === true,
            (layerIntensitiesRef.current || []).join(','),
            (layerBlackoutsRef.current || []).join(','),
            (layerSolosRef.current || []).join(','),
            (layerEffectSpeedsRef.current || []).map(s => (s ? `${s.mode}:${s.beats}:${s.duration}:${s.speedMultiplier}` : '')).join('|'),
            JSON.stringify(layerSyncSettingsRef.current || [])
        );

        return sig;
    };
    const sigsEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    useEffect(() => {
        let rafId;
        const loop = (timestamp) => {
            try {
                if (timestamp - lastPreviewTimeRef.current > previewInterval) {
                // Always count the frame: UI-FPS is the permanent loop health, not the
                // preview render rate.
                previewFrameCountRef.current++;
                lastPreviewTimeRef.current = timestamp;

                // The preview memos read refs (liveFramesRef, progressRef) that never
                // trigger renders by themselves, so this tick drives them. Re-render only
                // when something observable actually changed — an idle-selected clip or an
                // empty deck must not re-render the whole panel at 70fps.
                const hasPreviewContent =
                    activeClipIndexesRef.current.some(info => info && info.colIndex !== null) ||
                    (selectedLayerIndex !== null && selectedColIndex !== null);
                if (hasPreviewContent) {
                    lastPreviewContentRef.current = true;
                    const sig = buildPreviewSignature();
                    if (!sigsEqual(sig, lastPreviewSigRef.current)) {
                        lastPreviewSigRef.current = sig;
                        previewTimeRef.current = performance.now();
                        setTick(t => t + 1);
                    }
                } else if (lastPreviewContentRef.current) {
                    // Just became fully idle (e.g. the last clip was deactivated): force
                    // one final render so the memoized worldFrames/activeFrames empties
                    // and the world preview drops its last frame — with nothing active,
                    // no further tick would ever re-render to clear it.
                    lastPreviewContentRef.current = false;
                    previewTimeRef.current = performance.now();
                    setTick(t => t + 1);
                } else {
                    lastPreviewSigRef.current = [];
                }
                }
            } catch (err) {
                // UI-FPS tracker must never die: keep the rAF health chain alive.
                console.error('[previewTickLoop] error (kept alive):', err);
            }
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
    }, [previewInterval, previewFrameCountRef, selectedLayerIndex, selectedColIndex, activePageId]);

    // DERIVED PREVIEW DATA - Use Live Refs for immediate feedback and to avoid re-renders
    const clipSource = liveClipContentsRef?.current;
    const pageIdx = activePageId;
    const activeClipIndexes = activeClipIndexesRef.current;
    const layerEffects = layerEffectsRef.current;
    const bpm = bpmRef.current;
    const layerEffectSpeeds = (layerEffectSpeedsRef || { current: [] }).current || [];
    const layerSyncSettings = (layerSyncSettingsRef || { current: [] }).current || [];
    const playbackFps = playbackFpsRef.current;
    const masterIntensity = masterIntensityRef.current;
    const layerIntensities = layerIntensitiesRef.current;
    const globalBlackout = globalBlackoutRef.current;
    const layerSolos = layerSolosRef.current;
    const layerBlackouts = layerBlackoutsRef.current;

    const selectedClip = selectedLayerIndex !== null && selectedColIndex !== null ? clipSource[pageIdx]?.[selectedLayerIndex]?.[selectedColIndex] : null;

    const activeInfo = selectedLayerIndex !== null ? activeClipIndexes[selectedLayerIndex] : null;
    const targetPreviewWorkerId = selectedColIndex !== null
        ? (selectedClip?.type === 'ilda' ? selectedClip?.workerId : `generator-${pageIdx}-${selectedLayerIndex}-${selectedColIndex}`)
        : (activeInfo && activeInfo.colIndex !== null ? (clipSource[activeInfo.pageId]?.[selectedLayerIndex]?.[activeInfo.colIndex]?.type === 'ilda' ? clipSource[activeInfo.pageId]?.[selectedLayerIndex]?.[activeInfo.colIndex]?.workerId : `generator-${activeInfo.pageId}-${selectedLayerIndex}-${activeInfo.colIndex}`) : null);

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
            if (activeInfo && activeInfo.colIndex !== null) {
                const clipEffects = clipSource[activeInfo.pageId]?.[selectedLayerIndex]?.[activeInfo.colIndex]?.effects || [];
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
        activeClipIndexes.forEach((activeInfo, layerIndex) => {
            if (activeInfo && activeInfo.colIndex !== null) {
                const clip = clipSource[activeInfo.pageId]?.[layerIndex]?.[activeInfo.colIndex];
                if (clip) {
                    let workerId = clip.type === 'ilda' ? clip.workerId : `generator-${activeInfo.pageId}-${layerIndex}-${activeInfo.colIndex}`;
                    if (workerId && liveFramesRef.current[workerId]) {
                        const playbackSettings = clip.playbackSettings || {};
                        // Layer effects resolve their F/T/B/FFT speed sync from the layer's own
                        // sync settings (instanceId-keyed, so merging with the clip's is safe)
                        // and animate over the layer's Effect Speed Control duration when enabled.
                        const layerFxDuration = resolveLayerEffectDuration(
                            layerEffectSpeeds[layerIndex],
                            bpm,
                            playbackFps,
                            clip.totalFrames
                        );
                        frames[workerId] = {
                            frame: liveFramesRef.current[workerId],
                            effects: [...(clip.effects || []), ...(layerEffects[layerIndex] || [])],
                            layerIndex,
                            syncSettings: { ...(clip.syncSettings || {}), ...(layerSyncSettings[layerIndex] || {}) },
                            bpm: bpm,
                            clipDuration: layerFxDuration !== null ? layerFxDuration : (() => {
                                const pb = clip.playbackSettings || {};
                                if (pb.mode === 'timeline') return pb.duration || 1;
                                if (pb.mode === 'bpm') return ((pb.beats || 8) * 60) / (bpm || 120);
                                return (clip.totalFrames || 30) / (clip.fps || playbackFps || 30);
                            })(),
                            progress: progressRef.current[workerId] || 0,
                            effectStates: previewEffectStatesRef.current,
                            clipActivationTime: clipActivationTimesRef.current[layerIndex] || 0,
                            // Playback direction and style for effects
                            playbackDirection: playbackSettings.direction || 'forward',
                            playbackStyle: playbackSettings.style || 'loop'
                        };
                    }
                }
            }
        });
        return frames;
    }, [tick, liveFramesRef, layerEffects, layerSyncSettings, layerEffectSpeeds, bpm, playbackFps]); // Driven by tick

    const effectiveLayerIntensities = useMemo(() => {
        const isAnySolo = layerSolos.some(s => s);
        return layerIntensities.map((intensity, index) => {
            if (globalBlackout) return 0;
            if (isAnySolo) return layerSolos[index] ? (layerBlackouts[index] ? 0 : intensity) : 0;
            return layerBlackouts[index] ? 0 : intensity;
        });
    }, [tick]); // Driven by tick

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
                syncSettings={{ ...(selectedClip?.syncSettings || {}), ...(selectedLayerIndex !== null ? (layerSyncSettings[selectedLayerIndex] || {}) : {}) }}
                bpm={bpm}
                clipDuration={(() => {
                    const pb = selectedClip?.playbackSettings || {};
                    const layerFxDuration = selectedLayerIndex !== null
                        ? resolveLayerEffectDuration(layerEffectSpeeds[selectedLayerIndex], bpm, playbackFps, selectedClip?.totalFrames)
                        : null;
                    if (layerFxDuration !== null) return layerFxDuration;
                    if (pb.mode === 'timeline') return pb.duration || 1;
                    if (pb.mode === 'bpm') return ((pb.beats || 8) * 60) / (bpm || 120);
                    return (selectedClip?.totalFrames || 30) / (selectedClip?.fps || playbackFps || 30);
                })()}
                progress={selectedClipProgress}
                previewTime={previewTimeRef.current}
                fftLevels={getFftLevels ? getFftLevels() : fftLevels}
                effectStates={previewEffectStatesRef.current}
                clipActivationTime={selectedLayerIndex !== null ? (clipActivationTimesRef.current[selectedLayerIndex] || 0) : 0}
                optimizationEnabled={optimizationEnabled}
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
                optimizationEnabled={optimizationEnabled}
                onToggleBeamEffect={() => handleToggleBeamEffect('world')}
                onCycleDisplayMode={() => handleCycleDisplayMode('world')}
            />
        </div>
    )
});



function App() {
    const ildaParserWorker = useIldaParserWorker();
    const thumbnailWorker = useThumbnailWorker();
    const generatorWorker = useGeneratorWorker();
    const { fftLevels, getFftLevels, fftDataRef, timeDataRef } = useAudio() || {};

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
    // Preview renderers advance delay/chase history too; this separate map keeps the
    // preview from double-advancing (and distorting timing of) the DAC output history.
    const previewEffectStatesRef = useRef(new Map());
    const progressRef = useRef({}); // New ref for fine-grained progress
    const clipActivationTimesRef = useRef({});

    const lastFrameFetchTimeRef = useRef({});
    const frameIndexesRef = useRef({});
    const backgroundRunningClipsRef = useRef(new Set()); // {layerIndex, clipWorkerId, pageIdx, clipType}
    const backgroundRafRef = useRef(null);
    const processClipRef = useRef(null); // Latest processClip instance, shared with the background flash loop
    const workerLoadedFontsRef = useRef(new Set()); // Track fonts already sent to worker
    const lastMidiValuesRef = useRef({}); // For 'fake_relative' mode mapping
    const tapTempoTimesRef = useRef([]); // Timestamps for tap tempo (shared by TAP button + mappings)
    const lastTapMidiValueRef = useRef(0); // Rising-edge guard for mapped tap triggers

    const [initialSettings, setInitialSettings] = useState(null);
    const [initialSettingsLoaded, setInitialSettingsLoaded] = useState(false);
    const [currentPage, setCurrentPage] = useState('main'); // 'main', 'shapeBuilder', 'timeline'
    const [showAboutWindow, setShowAboutWindow] = useState(false);
    const [showShortcutsWindow, setShowShortcutsWindow] = useState(false);
    const [enabledShortcuts, setEnabledShortcuts] = useState({ midi: false, artnet: false, osc: false, keyboard: false });
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [showOutputSettingsWindow, setShowOutputSettingsWindow] = useState(false);
    const [showAudioSettingsWindow, setShowAudioSettingsWindow] = useState(false);
    const [showFftSettingsWindow, setShowFftSettingsWindow] = useState(false);
    const [showGeneralSettingsWindow, setShowGeneralSettingsWindow] = useState(false);
    const [showOutputProcessingWindow, setShowOutputProcessingWindow] = useState(false);
    const [exportTimingWarning, setExportTimingWarning] = useState(null);
    const [renameModalConfig, setRenameModalConfig] = useState({ title: '', initialValue: '', onSave: () => { } });
    const [activeBottomTab_1, setActiveBottomTab_1] = useState('files');
    const [activeBottomTab_2, setActiveBottomTab_2] = useState('clip');
    const [missingFiles, setMissingFiles] = useState([]);

    // Refs for performance tracking
    const previewFrameCountRef = useRef(0);
    const totalPointsSentRef = useRef(0);
    const activeChannelsCountRef = useRef(0);
    const lastStatUpdateTimeRef = useRef(performance.now());
    const channelPointCountsRef = useRef({}); // id -> points sent this stats window

    const [state, dispatch] = useReducer(reducer, getInitialState(initialSettingsLoaded ? initialSettings : {}));

    const throttledDispatchesRef = useRef(new Map()); // id -> throttled function

    const throttledDispatch = useCallback((id, action, delay = 16.6) => {
        if (!throttledDispatchesRef.current.has(id)) {
            // Create a new throttled function for this ID
            const throttled = throttle((act) => dispatch(act), delay);
            throttledDispatchesRef.current.set(id, throttled);
        }
        throttledDispatchesRef.current.get(id)(action);
    }, [dispatch]);

    const debouncedDispatchesRef = useRef(new Map()); // id -> debounced function

    // Leading+trailing debounce: a continuous stream (slider drag) commits once
    // immediately and once when it rests, so the reducer + React tree re-render
    // stays off the 30fps DAC output loop's main thread while dragging.
    const debouncedDispatch = useCallback((id, action, delay = 120, leading = true) => {
        if (!debouncedDispatchesRef.current.has(id)) {
            const debounced = debounce((act) => dispatch(act), delay, leading);
            debouncedDispatchesRef.current.set(id, debounced);
        }
        debouncedDispatchesRef.current.get(id)(action);
    }, [dispatch]);

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
        layerEffectSpeeds,
        layerSyncSettings,
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
        bpm, // Add this
        showBeamEffect,
        beamAlpha,
        fadeAlpha,
        playbackFps,
        previewScanRate,
        beamRenderMode,
        worldShowBeamEffect,
        worldBeamRenderMode,
        optimizationEnabled,
        optimizationMaxDist,
        optimizationPathDwell,
        optimizationSettings,
        layerMergeMode,
        activeClipIndexes,
        isPlaying,
        isStopped, // Add this
        isWorldOutputActive,
        activePageId,
        numPages,
        pageNames,
        selectedGeneratorId,
        selectedGeneratorParams,
        thumbnailRenderMode,
        theme,
        dacOutputSettings,
        fileBrowserViewMode, // Add this
        fileBrowserPath, // Add this
        layerUiStates,
        settingsPanelCollapsed, // Add this
        quickAssigns
    } = state;

    const activeClipsData = useMemo(() => layers.map((_, layerIndex) => {
        const activeInfo = activeClipIndexes[layerIndex];
        if (activeInfo && activeInfo.colIndex !== null) {
            const { pageId, colIndex } = activeInfo;
            const clip = clipContents[pageId]?.[layerIndex]?.[colIndex];
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
                        pageId,
                        colIndex,
                        syncSettings: clip.syncSettings || {},
                        fps: clip.fps || null,
                        frames: clip.frames || []
                    };
                } else if (clip.type === 'generator' && clip.frames && clip.generatorDefinition) {
                    workerId = `generator-${layerIndex}-${colIndex}`; // workerId remains position-based for now? No, should probably be page-aware if we want multiple pages active.
                    // Wait, if workerId is 'generator-L-C', then Page 1 Clip (1,1) and Page 2 Clip (1,1) will conflict.
                    // It MUST be page-aware.
                    workerId = `generator-${pageId}-${layerIndex}-${colIndex}`;
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
                        pageId,
                        colIndex,
                        syncSettings: clip.syncSettings || {},
                        fps: clip.fps || null,
                        frames: clip.frames || []
                    };
                }
            }
        }
        return null;
    }).filter(Boolean), [layers, activeClipIndexes, clipContents]);

    // The clip currently active on the selected layer, used to drive the
    // animated-value playhead for layer effects in the settings panel.
    const selectedLayerActiveClip = useMemo(() => {
        if (selectedLayerIndex === null) return null;
        const activeInfo = activeClipIndexes[selectedLayerIndex];
        if (!activeInfo || activeInfo.colIndex === null) return null;
        return clipContents[activeInfo.pageId]?.[selectedLayerIndex]?.[activeInfo.colIndex] || null;
    }, [activeClipIndexes, clipContents, selectedLayerIndex]);

    // Worker id used by the preview loop to advance progress for the active
    // clip's layer effects (generator clips are keyed by position).
    const selectedLayerActiveWorkerId = useMemo(() => {
        if (selectedLayerIndex === null) return null;
        const activeInfo = activeClipIndexes[selectedLayerIndex];
        if (!activeInfo || activeInfo.colIndex === null) return null;
        const clip = clipContents[activeInfo.pageId]?.[selectedLayerIndex]?.[activeInfo.colIndex];
        if (!clip) return null;
        if (clip.type === 'ilda') return clip.workerId || null;
        if (clip.type === 'generator') return `generator-${activeInfo.pageId}-${selectedLayerIndex}-${activeInfo.colIndex}`;
        return null;
    }, [activeClipIndexes, clipContents, selectedLayerIndex]);

    const clipContentsRef = useRef(clipContents);

    const liveClipContentsRef = useRef(null);

    const hasPendingClipUpdate = useRef(false); // Flag to prevent overwriting live ref with stale state during interaction

    // Remember the last selected clip per page:layer so that clicking a layer
    // keeps the Clip-Settings panel intact (sticky clip selection).
    const stickyClipColsRef = useRef({}); // { pageIdx: { layerIndex: colIndex } }

    // Dedupe guard for effect drops: some environments can deliver the same
    // physical drop to more than one handler (double event/dispatch). Suppress a
    // repeat ADD of the same effect to the same target within 350ms.
    const lastEffectAddRef = useRef({}); // key -> { id, time }



    const liveDacOutputSettingsRef = useRef(null);

    const hasPendingDacUpdate = useRef(false);



    useEffect(() => {

        if (clipContents) {

            liveClipContentsRef.current = clipContents;

        }

    }, []); // Only on mount, subsequent updates handled by specific effect



    useEffect(() => {

        if (dacOutputSettings) {

            liveDacOutputSettingsRef.current = dacOutputSettings;

        }

    }, []); // Only on mount



    // Refs for real-time access in animation loop

    const layerIntensitiesRef = useRef(layerIntensities);

    const layerAutopilotsRef = useRef(layerAutopilots);

    const layerEffectsRef = useRef(layerEffects); // Update this

    // Temporary diagnostic: log if the "Layer Effects" list ever renders two
    // entries that share a key (indicates the same effect added twice).
    useEffect(() => {
        const cur = layerEffectsRef.current || [];
        const list = cur[selectedLayerIndex] || [];
        const seen = new Set();
        const dups = [];
        for (const e of list) {
            const k = e.instanceId || e.id;
            if (k !== undefined && seen.has(k)) dups.push(k);
            seen.add(k);
        }
        if (dups.length > 0) console.debug('[fx-debug] Panel list has duplicate keys:', dups, 'total:', list.length);
    }, [selectedLayerIndex, layerEffectsRef.current[selectedLayerIndex]]);

    const layerEffectSpeedsRef = useRef(layerEffectSpeeds);
    const layerSyncSettingsRef = useRef(layerSyncSettings);

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
    const selectedClipRef = useRef(null);
    const getAudioInfoRef = useRef(getAudioInfo);
    const optimizationEnabledRef = useRef(optimizationEnabled);
    const optimizationMaxDistRef = useRef(optimizationMaxDist);
    const optimizationPathDwellRef = useRef(optimizationPathDwell);
    const optimizationSettingsRef = useRef(optimizationSettings);
    useEffect(() => { optimizationSettingsRef.current = optimizationSettings; }, [optimizationSettings]);
    useEffect(() => {
        if (window.electronAPI && window.electronAPI.setRenderSettings) {
            window.electronAPI.setRenderSettings({
                ...state.renderSettings,
                optimizationSettings: optimizationSettings,
            });
        }
    }, [optimizationSettings]);
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
    useEffect(() => { isWorldOutputActiveRef.current = isWorldOutputActive; }, [isWorldOutputActive]);

    // While the Timeline window is open the grid's render loop must not feed a
    // second, competing dac-frame-update stream to the same DAC channels.
    const isTimelinePageActiveRef = useRef(currentPage === 'timeline');
    useEffect(() => { isTimelinePageActiveRef.current = currentPage === 'timeline'; }, [currentPage]);

    useEffect(() => { selectedDacRef.current = selectedDac; }, [selectedDac]);
    useEffect(() => { bpmRef.current = state.bpm; }, [state.bpm]);
    useEffect(() => { selectedLayerIndexRef.current = selectedLayerIndex; }, [selectedLayerIndex]);
    useEffect(() => { selectedColIndexRef.current = selectedColIndex; }, [selectedColIndex]);
    useEffect(() => { getAudioInfoRef.current = getAudioInfo; }, [getAudioInfo]);
    useEffect(() => { optimizationEnabledRef.current = optimizationEnabled; }, [optimizationEnabled]);
    useEffect(() => { optimizationMaxDistRef.current = Number(optimizationMaxDist); }, [optimizationMaxDist]);
    useEffect(() => { optimizationPathDwellRef.current = Number(optimizationPathDwell); }, [optimizationPathDwell]);

    const playbackFpsRef = useRef(playbackFps);
    useEffect(() => { playbackFpsRef.current = playbackFps; }, [playbackFps]);

    const dacOutputSettingsRef = useRef(dacOutputSettings);

    const dacsRef = useRef(dacs);

    const dacSentFramesRef = useRef({});

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
    const fontBufferCacheRef = useRef(new Map()); // Cache for font buffers to prevent 60fps disk reads

    const lastNdiSourceNameRef = useRef(null); // Ref to track NDI source name across renders

    const accumulatedTimeRef = useRef({}); // Add accumulatedTimeRef

    const hoveredClipRef = useRef(null); // { layerIndex, colIndex } or null

    const generatorRequestSeqRef = useRef(0); // Track latest request ID
    // Last wall-clock time a genuine "live" regeneration (waveform/timer) was issued
    // per workerId, so those never regenerate faster than the clip's frame rate.
    const generatorLiveRegenTimeRef = useRef(new Map()); // key: workerId, val: ts
    const latestProcessedSeqRef = useRef(new Map()); // Track latest processed response ID per clip
    const generatorLastRequestedSeqRef = useRef(new Map()); // Track latest REQUESTED seq per clip
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
            liveClipContentsRef.current = clipContents;
        }
    }, [clipContents]);

    useEffect(() => {
        if (hasPendingDacUpdate.current) {
            hasPendingDacUpdate.current = false;
            return;
        }
        if (dacOutputSettings) {
            liveDacOutputSettingsRef.current = dacOutputSettings;
        }
    }, [dacOutputSettings]);

    // Persist output settings (dimmer, safety zones, output area, test lines,
    // transforms, PPS config) to the settings store so they survive a restart
    // even without a full project save. Debounced to avoid a store write per
    // drag event.
    useEffect(() => {
        if (!initialSettingsLoaded) return;
        const t = setTimeout(() => {
            if (window.electronAPI && window.electronAPI.saveDacOutputSettings) {
                window.electronAPI.saveDacOutputSettings(dacOutputSettings);
            }
        }, 300);
        return () => clearTimeout(t);
    }, [dacOutputSettings, initialSettingsLoaded]);

    useEffect(() => {
        layerIntensitiesRef.current = layerIntensities;
        layerAutopilotsRef.current = layerAutopilots;
        layerEffectsRef.current = layerEffects; // Update this
        layerEffectSpeedsRef.current = layerEffectSpeeds;
        layerSyncSettingsRef.current = layerSyncSettings;
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
    }, [layerIntensities, layerAssignedDacs, layerAutopilots, layerEffects, layerEffectSpeeds, layerSyncSettings, masterIntensity, layerBlackouts, layerSolos, globalBlackout, dacOutputSettings, dacs, activeClipsData, clipContents, activeClipIndexes, clipNames, selectedIldaWorkerId, selectedIldaTotalFrames]);

    const generateTestLineFrame = useCallback((yPos, compStart, compEnd, shiftX) => {
        const y = 1 - (yPos * 2);
        const points = [];
        const numPoints = 300;
        const cs = compStart || 0, ce = compEnd || 0;
        const sx = shiftX || 0;
        const x1 = -1, x2 = 1;
        const push = (x, y, r, g, b, blanking) => points.push({ x: x + sx, y, r, g, b, blanking });
        push(x1, y, 0, 0, 0, true);
        for (let h = 0; h < 10; h++) {
            push(x1, y, 0, 0, 0, true);
        }
        // Blue dwell dot at the TRUE START position (not compensated): the galvo
        // settles here, marking the real x=-1 endpoint. The line's blue point is
        // then measured against it the same way the red end is.
        for (let d = 0; d < 6; d++) {
            push(x1, y, 0, 0, 255, false);
        }
        // Shift commanded points by a linear profile: compStart at the line
        // start, compEnd at the line end. The galvo's tracking error is
        // non-uniform along the draw, so a single uniform shift can't fix
        // both ends and the middle at once.
        // The sweep is split at the commanded center (x=0, compensated by the
        // same profile) and a settled dwell dot is placed there. A single fast
        // through-sweep never lets the beam settle at center, so its apparent
        // midpoint is wherever lag leaves it — NOT the physical field center
        // where idle content actually sits. The center dwell gives the galvo
        // time to settle to the true x=0 (like the end dwells), so safety zones
        // referenced to this line align with real frame content.
        const sweep = (t, isFirst) => {
            const comp = cs * (1 - t) + ce * t;
            const x = x1 + (x2 - x1) * t + comp;
            let r = 0, g = 0, b = 0;
            if (isFirst) { b = 255; }
            else if (t >= 1) { r = 255; }
            else { g = 255; }
            push(x, y, r, g, b, false);
        };
        const centerT = (1 - cs) / (2 - cs + ce);
        const split = Math.max(0, Math.min(1, centerT));
        const half = Math.max(0, Math.min(numPoints - 1, Math.floor(numPoints * split)));
        for (let i = 0; i <= half; i++) {
            sweep(i / (numPoints - 1), i === 0);
        }
        // Cyan dwell dot at the TRUE CENTER position: settles at commanded x=0,
        // which is also where a centered clip's content sits.
        for (let d = 0; d < 16; d++) {
            push(0, y, 0, 255, 255, false);
        }
        for (let i = half; i <= numPoints - 1; i++) {
            sweep(i / (numPoints - 1), false);
        }
        // Red dwell dot at the TRUE END position (not compensated): the galvo
        // settles here, marking the real x=1 endpoint.
        for (let d = 0; d < 20; d++) {
            push(x2, y, 255, 0, 0, false);
        }
        for (let h = 0; h < 5; h++) {
            push(x2, y, 0, 0, 0, true);
        }
        return { points, isTypedArray: false };
    }, []);

    const generateVerticalTestLineFrame = useCallback((xPos, compStart, compEnd, shiftY) => {
        const x = (xPos * 2) - 1;
        const points = [];
        const numPoints = 300;
        const cs = compStart || 0, ce = compEnd || 0;
        const sy = shiftY || 0;
        const y1 = 1, y2 = -1;
        const push = (x, y, r, g, b, blanking) => points.push({ x, y: y + sy, r, g, b, blanking });
        push(x, y1, 0, 0, 0, true);
        for (let h = 0; h < 10; h++) {
            push(x, y1, 0, 0, 0, true);
        }
        // Blue dwell dot at the TRUE START position (not compensated): the galvo
        // settles here, marking the real y=1 endpoint.
        for (let d = 0; d < 6; d++) {
            push(x, y1, 0, 0, 255, false);
        }
        // See generateTestLineFrame: the sweep is split at the commanded center
        // (y=0) with a settled cyan dwell dot there, so the line's center is the
        // true physical field center instead of whatever the lag trajectory puts
        // it at. Safety zones referenced to this line then align with content.
        const sweep = (t, isFirst) => {
            // Shift commanded points by a linear profile: compStart at the line
            // start, compEnd at the line end (applied against -y motion).
            const comp = cs * (1 - t) + ce * t;
            const y = y1 + (y2 - y1) * t - comp;
            let r = 0, g = 0, b = 0;
            if (isFirst) { b = 255; }
            else if (t >= 1) { r = 255; }
            else { g = 255; }
            push(x, y, r, g, b, false);
        };
        const centerT = (1 - cs) / (2 - cs + ce);
        const split = Math.max(0, Math.min(1, centerT));
        const half = Math.max(0, Math.min(numPoints - 1, Math.floor(numPoints * split)));
        for (let i = 0; i <= half; i++) {
            sweep(i / (numPoints - 1), i === 0);
        }
        // Cyan dwell dot at the TRUE CENTER position.
        for (let d = 0; d < 16; d++) {
            push(x, 0, 0, 255, 255, false);
        }
        for (let i = half; i <= numPoints - 1; i++) {
            sweep(i / (numPoints - 1), false);
        }
        // Red dwell dot at the TRUE END position (not compensated): the galvo
        // settles here, marking the real y=-1 endpoint.
        for (let d = 0; d < 20; d++) {
            push(x, y2, 255, 0, 0, false);
        }
        for (let h = 0; h < 5; h++) {
            push(x, y2, 0, 0, 0, true);
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

    const showNotification = useCallback((message) => {
        dispatch({ type: 'SET_NOTIFICATION', payload: { message, visible: true } });
        setTimeout(() => {
            dispatch({ type: 'SET_NOTIFICATION', payload: { message: '', visible: false } });
        }, 3000);
    }, [dispatch]);

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
                    const { workerId, frame, layerIndex, colIndex, pageId = stateRef.current.activePageId } = e.data;

                    if (layerIndex === undefined || colIndex === undefined) return;

                    // Generate Thumbnail
                    let thumbnailPath = null;
                    // Use live ref if available for latest data, else ref.current
                    const clipSource = liveClipContentsRef.current ? liveClipContentsRef.current : clipContentsRef.current;
                    const currentClip = clipSource?.[pageId]?.[layerIndex]?.[colIndex];
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

                    thumbnailPath = await generateThumbnail(frameToProcess, effects, layerIndex, colIndex, optimizationEnabled, pageId);

                    // Update stillFrame and set parsing status to false
                    dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { stillFrame: frame, parsing: false, thumbnailPath, thumbnailVersion: Date.now() }, pageId } });
                } else {
                    liveFramesRef.current[e.data.workerId] = e.data.frame;
                }
            } else if (e.data.type === 'parse-ilda' && e.data.success) {
                const { workerId, totalFrames, ildaFormat, fileName, filePath, layerIndex, colIndex, pageId = stateRef.current.activePageId } = e.data;

                if (layerIndex === undefined || colIndex === undefined) return;

                const existingClip = clipContentsRef.current?.[pageId]?.[layerIndex]?.[colIndex] || {};

                const newClipContent = {
                    type: 'ilda',
                    workerId,
                    totalFrames,
                    ildaFormat,
                    fileName,
                    filePath,
                    parsing: true, // Set parsing status to true
                    // Preserve the user's saved playback config across re-parses
                    // (BPM/timeline sync speed, beats, duration, FPS). A re-parse
                    // runs on every project load, so hardcoding FPS defaults here
                    // silently reverted BPM-synced clips — same caveat applies to
                    // the relocated filePath echoed below.
                    playbackSettings: existingClip.playbackSettings || {
                        mode: 'fps',
                        duration: totalFrames / 60,
                        beats: 8,
                        speedMultiplier: 1
                    },
                };
                dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: newClipContent, pageId } });

                // Only update the clip name if it's currently the default name
                const currentName = clipNamesRef.current[pageId][layerIndex][colIndex];
                const defaultPattern = `Clip ${layerIndex + 1}-${colIndex + 1}`;
                if (currentName === defaultPattern) {
                    dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: fileName, pageId } });
                }

                // Removed redundant get-frame call to prevent duplicate thumbnail generation
                // The useEffect watching workerBecameValid will trigger it
            } else if (e.data.type === 'get-all-frames' && e.data.success) {
                console.log('Received get-all-frames response:', e.data);
                const { frames, workerId, layerIndex, colIndex, pageId = stateRef.current.activePageId } = e.data;

                if (layerIndex === undefined || colIndex === undefined) return;

                // Use dynamic import for writer
                import('./utils/ilda-writer.js').then(({ framesToIlda }) => {
                    const buffer = framesToIlda(frames);
                    const clip = clipContentsRef.current[pageId]?.[layerIndex]?.[colIndex];
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
        let dacProcessTimeoutId;
        let lastFrameTime = 0;
        const OUTPUT_FPS = 30;
        const dacFrameInterval = 1000 / OUTPUT_FPS;

        // Helper to merge multiple frames into one for a single DAC channel
        const mergeFrames = (frames) => {
            if (frames.length === 0) return null;
            if (frames.length === 1) {
                const f = frames[0];
                const isTyped = f.points instanceof Float32Array || f.isTypedArray;
                if (isTyped) {
                    return { ...f, points: new Float32Array(f.points), isTypedArray: true };
                }
                // Convert object points to Float32Array for consistent DAC pipeline
                const pts = new Float32Array(f.points.length * 8);
                for (let i = 0; i < f.points.length; i++) {
                    const p = f.points[i];
                    pts[i * 8] = p.x; pts[i * 8 + 1] = p.y; pts[i * 8 + 2] = p.z || 0;
                    pts[i * 8 + 3] = p.r; pts[i * 8 + 4] = p.g; pts[i * 8 + 5] = p.b;
                    pts[i * 8 + 6] = p.blanking ? 1 : 0; pts[i * 8 + 7] = 0;
                }
                return { ...f, points: pts, isTypedArray: true };
            }

            const TRANSITION_STEPS = 20;
            let totalPoints = 0;
            frames.forEach((f, idx) => {
                const isTyped = f.points instanceof Float32Array || f.isTypedArray;
                const numPoints = isTyped ? (f.points.length / 8) : f.points.length;
                totalPoints += numPoints;
                // Add transition points between each clip
                if (idx < frames.length - 1) {
                    totalPoints += TRANSITION_STEPS;
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

                    // Interpolate blanked points from last to next position so the
                    // blanking circuit has enough time to settle. More steps = slower
                    // movement = more time for blanking to engage per step.
                    for (let s = 1; s <= TRANSITION_STEPS; s++) {
                        const t = s / TRANSITION_STEPS;
                        const off = (currentPointOffset + s - 1) * 8;
                        mergedPoints[off] = lastX + (nextX - lastX) * t;
                        mergedPoints[off + 1] = lastY + (nextY - lastY) * t;
                        mergedPoints[off + 6] = 1;
                        mergedPoints[off + 3] = 0;
                        mergedPoints[off + 4] = 0;
                        mergedPoints[off + 5] = 0;
                    }
                    currentPointOffset += TRANSITION_STEPS;
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
        const animate = () => {
            if (!isWorldOutputActiveRef.current) {
                clearTimeout(dacProcessTimeoutId);
                return;
            }

            const now = performance.now();
            if (now - lastFrameTime >= dacFrameInterval) {
                // Fixed-step cadence: advance the frame clock to the CURRENT slot
                // instead of `lastFrameTime = now`. Under a main-thread stall the
                // accumulated delay is collapsed into whole missed slots (dropped
                // frames), never partial drift — so the stream re-fires on the exact
                // 30fps grid instead of bursting after a stall, which the main
                // process's rigid 30fps sampler previously rode as a per-channel
                // "repeat, then catch back up".
                const missedFrames = Math.max(1, Math.floor((now - lastFrameTime) / dacFrameInterval));
                lastFrameTime += missedFrames * dacFrameInterval;
                if (window.electronAPI && isWorldOutputActiveRef.current && !isTimelinePageActiveRef.current) {
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
                            const liveClip = clipSource[clip.pageId]?.[clip.layerIndex]?.[clip.colIndex];
                            const liveEffects = liveClip ? (liveClip.effects || []) : (clip.effects || []);

                            // Clip effects and layer effects are applied separately so layer
                            // effects can use the layer's own Effect Speed Control timing.
                            const layerIdx = clip.layerIndex;
                            const currentLayerEffects = layerEffectsRef.current[layerIdx] || [];

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
                            const syncSettings = liveClip?.syncSettings || clip.syncSettings || {};

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
                                for (let i = 0; i < numPts; i++) {
                                    newPts[i * 8 + 3] *= finalIntensity;
                                    newPts[i * 8 + 4] *= finalIntensity;
                                    newPts[i * 8 + 5] *= finalIntensity;
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

                            const effectContext = {
                                progress: clipProgress,
                                time: now,
                                effectStates: effectStatesRef.current,
                                assignedDacs: dacList, // Pass the combined list of DACs (Layer + Clip)
                                syncSettings: clip.syncSettings || {},
                                bpm: bpmRef.current,
                                fftLevels: getFftLevels ? getFftLevels() : fftLevels // Use helper for fresh data
                            };

                            // Apply clip effects with the clip's own playback timing and sync settings.
                            let modifiedFrame = applyEffects(intensityAdjustedFrame, [...liveEffects], {
                                ...effectContext,
                                syncSettings: clip.syncSettings || {},
                                clipDuration: clipDuration
                            });

                            // Apply layer effects with the layer's Effect Speed Control timing when
                            // configured; otherwise fall back to the clip duration so existing
                            // behaviour (layer effects timed to the clip) is preserved. Layer effects
                            // also resolve their F/T/B/FFT speed sync from the layer's own sync
                            // settings rather than the clip's.
                            if (currentLayerEffects.length > 0) {
                                const layerEffectDuration = resolveLayerEffectDuration(
                                    (layerEffectSpeedsRef.current || [])[layerIdx],
                                    bpmRef.current,
                                    playbackFpsRef.current,
                                    clip.totalFrames
                                ) ?? clipDuration;
                                modifiedFrame = applyEffects(modifiedFrame, currentLayerEffects, {
                                    ...effectContext,
                                    syncSettings: (layerSyncSettingsRef.current || [])[layerIdx] || {},
                                    clipDuration: layerEffectDuration
                                });
                            }

                            // Optimization AFTER effects ensures all transitions (Mirror, Delay, Blanking) are handled.
                            // The optimizer is now budget-aware (maxPoints) and handles corner dwell and interpolation
                            // within the point budget, so the post-hoc subsample below is only a safety net.
                            if (optimizationEnabledRef.current) {
                                const optimizedPts = optimizePoints(modifiedFrame.points, {
                                    ...(optimizationSettingsRef.current || {}),
                                    maxDist: Number(optimizationMaxDistRef.current || 0.02),
                                    pathDwell: Number(optimizationPathDwellRef.current || 2),
                                    maxPoints: 1000,
                                    isClosed: modifiedFrame.isClosed
                                });
                                modifiedFrame.points = optimizedPts;
                                modifiedFrame.isTypedArray = true;
                            } else {
                                // Convert to Float32Array so the Showbridge fill's interpolation
                                // block (which requires Float32Array) runs. Without this, only
                                // one raw cycle reaches the DAC — the shape is too dim.
                                if (modifiedFrame.points && !(modifiedFrame.points instanceof Float32Array)) {
                                    const pts = modifiedFrame.points;
                                    const n = pts.length;
                                    const arr = new Float32Array(n * 8);
                                    for (let i = 0; i < n; i++) {
                                        const p = pts[i];
                                        const off = i * 8;
                                        arr[off] = p.x; arr[off + 1] = p.y; arr[off + 2] = p.z || 0;
                                        arr[off + 3] = p.r; arr[off + 4] = p.g; arr[off + 5] = p.b;
                                        arr[off + 6] = p.blanking ? 1 : 0;
                                        arr[off + 7] = p.lastPoint ? 1 : 0;
                                    }
                                    modifiedFrame.points = arr;
                                    modifiedFrame.isTypedArray = true;
                                }

                                // Safety cap when optimizer is off
                                const MAX_PTS_PER_FRAME = 1000;
                                const pts = modifiedFrame.points;
                                if (pts) {
                                    const isT = modifiedFrame.isTypedArray || pts instanceof Float32Array;
                                    const n = isT ? (pts.length / 8) : pts.length;
                                    const dists = isT && pts._channelDistributions;

                                    const decimate = (src, num, maxOut) => {
                                        const step = num / maxOut;
                                        const out = [];
                                        let prevBlank = null;
                                        for (let i = 0; i < num; i++) {
                                            const blank = isT ? (src[i * 8 + 6] === 1) : !!src[i].blanking;
                                            const blankChanged = prevBlank !== null && blank !== prevBlank;
                                            const keep = (i === 0) || (i === num - 1) ||
                                                blankChanged ||
                                                (Math.floor(i / step) !== Math.floor((i - 1) / step));
                                            if (keep) {
                                                if (isT) {
                                                    for (let k = 0; k < 8; k++) out.push(src[i * 8 + k]);
                                                } else {
                                                    const p = src[i];
                                                    out.push(p.x, p.y, p.z || 0, p.r, p.g, p.b, p.blanking ? 1 : 0, p.lastPoint ? 1 : 0);
                                                }
                                            }
                                            prevBlank = blank;
                                        }
                                        return out;
                                    };

                                    if (isT && dists && n > MAX_PTS_PER_FRAME) {
                                        // Channel-based frame (delay/chase): decimate each per-DAC
                                        // slice independently and rebuild the distribution map so
                                        // per-DAC slicing stays valid.
                                        const keys = Array.from(dists.keys()).sort((a, b) => dists.get(a).start - dists.get(b).start);
                                        const out = [];
                                        const newDists = new Map();
                                        let outOffset = 0;
                                        for (const key of keys) {
                                            const d = dists.get(key);
                                            const start = Math.max(0, d.start);
                                            const end = Math.min(d.start + d.length, pts.length);
                                            if (end <= start) continue;
                                            const slice = pts.subarray(start, end);
                                            const sliceN = slice.length / 8;
                                            const decimated = decimate(slice, sliceN, Math.max(1, Math.min(MAX_PTS_PER_FRAME, sliceN)));
                                            if (decimated.length === 0) continue;
                                            newDists.set(key, { start: outOffset, length: decimated.length });
                                            out.push(...decimated);
                                            outOffset += decimated.length;
                                        }
                                        if (out.length > 0) {
                                            const rebuilt = new Float32Array(out);
                                            rebuilt._channelDistributions = newDists;
                                            modifiedFrame.points = rebuilt;
                                            modifiedFrame.isTypedArray = true;
                                        }
                                    } else if (n > MAX_PTS_PER_FRAME) {
                                        modifiedFrame.points = new Float32Array(decimate(pts, n, MAX_PTS_PER_FRAME));
                                        modifiedFrame.isTypedArray = true;
                                    }
                                }
                            }

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

                                        for (let i = 0; i < n; i++) {
                                            if (isT) {
                                                if (targetDac.mirrorX) newPts[i * 8] = -newPts[i * 8];
                                                if (targetDac.mirrorY) newPts[i * 8 + 1] = -newPts[i * 8 + 1];
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

                                if (settings.testLineEnabled || settings.verticalTestLineEnabled) {
                                    const frames = [];
                                    if (settings.testLineEnabled) {
                                        frames.push(generateTestLineFrame(
                                            settings.testLineY !== undefined ? settings.testLineY : 0.5,
                                            settings.testLineLagCompStart || 0,
                                            settings.testLineLagCompEnd !== undefined ? settings.testLineLagCompEnd : (settings.testLineLagComp || 0),
                                            settings.testLineShiftX || 0
                                        ));
                                    }
                                    if (settings.verticalTestLineEnabled) {
                                        frames.push(generateVerticalTestLineFrame(
                                            settings.testLineX !== undefined ? settings.testLineX : 0.5,
                                            settings.testLineLagCompStart || 0,
                                            settings.testLineLagCompEnd !== undefined ? settings.testLineLagCompEnd : (settings.testLineLagComp || 0),
                                            settings.testLineShiftY || 0
                                        ));
                                    }
                                    group.frames = frames;
                                }

                                // Configured DAC channel with no active clip / test-line
                                // content: push a laser-off blank frame so the channel still
                                // appears in dac-frame-update. Without this, an idle channel
                                // is omitted entirely and (esp. for Showbridge) the DAC would
                                // be starved of packets and cut output abruptly instead of
                                // receiving a proper laser-off blank/clear frame.
                                if (group.frames.length === 0) {
                                    group.frames.push({
                                        points: new Float32Array([0, 0, 0, 0, 0, 0, 1, 0]),
                                        isTypedArray: true,
                                        _idleBlank: true
                                    });
                                }
                            }
                        });
                    });

                    // Send merged frames to each DAC channel
                    let activeCount = 0;
                    const framesToSend = {};
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
                                for (let i = 0; i < n; i++) {
                                    if (isT) {
                                        pts[i * 8 + 3] *= dim;
                                        pts[i * 8 + 4] *= dim;
                                        pts[i * 8 + 5] *= dim;
                                    } else {
                                        pts[i].r *= dim;
                                        pts[i].g *= dim;
                                        pts[i].b *= dim;
                                    }
                                }
                            }

                            mergedFrame = applyOutputProcessing(mergedFrame, settings, false);

                            // Project safety-zone outlines into the frame data when enabled:
                            // a lit rectangle around each zone drawn in the same post-transform
                            // space as the zone blanking, so the boundary is visible ON THE
                            // LASER (not just the canvas overlay) for physical calibration.
                            if (settings.zoneOutlineEnabled && settings.safetyZones && settings.safetyZones.length > 0) {
                                const pts = mergedFrame.points;
                                if (pts instanceof Float32Array) {
                                    const outline = [];
                                    const toX = (u) => u * 2 - 1;
                                    const toY = (v) => 1 - v * 2;
                                    const EDGE_PTS = 8;
                                    const pushOutline = (X, Y) => outline.push(X, Y, 0, 255, 170, 0, 0, 0); // amber
                                    settings.safetyZones.forEach((zone) => {
                                        let u0 = zone.x, u1 = zone.x + zone.w, v0 = zone.y, v1 = zone.y + zone.h;
                                        if (settings.transformationEnabled && settings.outputArea && settings.transformationMode === 'scale') {
                                            u0 = settings.outputArea.x + u0 * settings.outputArea.w;
                                            u1 = settings.outputArea.x + u1 * settings.outputArea.w;
                                            v0 = settings.outputArea.y + v0 * settings.outputArea.h;
                                            v1 = settings.outputArea.y + v1 * settings.outputArea.h;
                                        }
                                        // Skip zones fully outside the visible field.
                                        if (u1 <= 0 || u0 >= 1 || v1 <= 0 || v0 >= 1) return;
                                        const x0 = Math.max(-1, toX(Math.max(0, u0)));
                                        const x1 = Math.min(1, toX(Math.min(1, u1)));
                                        const yTop = Math.max(-1, toY(Math.max(0, v0)));
                                        const yBot = Math.min(1, toY(Math.min(1, v1)));
                                        // Corner dwell: repeat the point at each 90° corner so the
                                        // galvo settles and the outline's corners stay sharp on the
                                        // physical laser instead of rounding into the blanking path.
                                        const CORNER_DWELL = 8;
                                        const corner = (X, Y) => {
                                            for (let c = 0; c < CORNER_DWELL; c++) pushOutline(X, Y);
                                        };
                                        // Each edge runs from its start corner toward its end corner
                                        // (non-inclusive), then the destination corner is dwelled.
                                        // Top edge left -> right, dwell top-right corner.
                                        for (let i = 0; i < EDGE_PTS; i++) pushOutline(x0 + (x1 - x0) * i / EDGE_PTS, yTop);
                                        corner(x1, yTop);
                                        // Right edge top -> bottom, dwell bottom-right corner.
                                        for (let i = 0; i < EDGE_PTS; i++) pushOutline(x1, yTop + (yBot - yTop) * i / EDGE_PTS);
                                        corner(x1, yBot);
                                        // Bottom edge right -> left, dwell bottom-left corner.
                                        for (let i = 0; i < EDGE_PTS; i++) pushOutline(x1 - (x1 - x0) * i / EDGE_PTS, yBot);
                                        corner(x0, yBot);
                                        // Left edge bottom -> top, dwell top-left corner (the start
                                        // point), closing the loop back onto the first outline point.
                                        for (let i = 0; i < EDGE_PTS; i++) pushOutline(x0, yBot - (yBot - yTop) * i / EDGE_PTS);
                                        corner(x0, yTop);
                                    });
                                    if (outline.length > 0) {
                                        const merged = new Float32Array(pts.length + outline.length);
                                        merged.set(pts, 0);
                                        merged.set(outline, pts.length);
                                        // Mark the last outline point as the frame's end point so
                                        // the cycle terminates after the outline closes.
                                        merged[merged.length - 1] = 1;
                                        mergedFrame = { ...mergedFrame, points: merged };
                                    }
                                }
                            }
                        }

                        if (mergedFrame) {
                            // Idle laser-off blank frames keep the DAC fed with a clean clear
                            // packet, but must not count as an active channel (would skew the
                            // active-channel count and average PPS in the stats display).
                            const isIdleBlank = !!mergedFrame._idleBlank;
                            if (!isIdleBlank) {
                                activeCount++;
                                const numPts = isTypedArray(mergedFrame.points) ? (mergedFrame.points.length / 8) : mergedFrame.points.length;
                                totalPointsSentRef.current += numPts;
                                channelPointCountsRef.current[id] = (channelPointCountsRef.current[id] || 0) + numPts;
                            }

                            // Per-channel hardware-correction invert + timing target. These ride
                            // along on `options` so the main-process sendFrame() applies the X/Y
                            // flip exactly at the physical DAC boundary and feeds the per-channel
                            // PPS target into the EtherDream/Showbridge frame rate. ppsOverride
                            // (explicit) wins over the hardware preset's targetPps. A channel may
                            // have frame data before any output settings exist, so fall back to
                            // safe defaults here and never assume `settings` is defined.
                            const s = settings || {};
                            const preset = (s.ppsPreset && getPreset(s.ppsPreset)) ? getPreset(s.ppsPreset) : getPreset(DEFAULT_PRESET);
                            const targetPpsValue = (s.ppsOverride && s.ppsOverride > 0)
                                ? s.ppsOverride
                                : (preset && preset.targetPps ? preset.targetPps : 30000);

                            const optionsForFrame = {
                                skipOptimization: optimizationEnabledRef.current,
                                flipX: !!s.flipX,
                                flipY: !!s.flipY,
                                pps: targetPpsValue,
                                targetPps: targetPpsValue,
                            };
                            if (s.targetFps && s.targetFps > 0) optionsForFrame.targetFps = s.targetFps;
                            if (s.targetMode) optionsForFrame.targetMode = s.targetMode;

                            framesToSend[id] = {
                                points: mergedFrame.points,
                                ip: group.ip,
                                channel: group.channel,
                                type: group.type,
                                options: optionsForFrame
                            };
                        }
                    });
                    activeChannelsCountRef.current = activeCount;
                    // Expose the processed frames per channel for the Output Settings
                    // canvas preview background (already flip/scale-transformed).
                    dacSentFramesRef.current = framesToSend;
                    // Send the latest processed frames to the main process, which has its own
                    // event loop and sends them to the DAC on a reliable setInterval timer
                    // completely independent of React rendering.
                    if (window.electronAPI && Object.keys(framesToSend).length > 0) {
                        window.electronAPI.send('dac-frame-update', framesToSend);
                    }
                }
                // lastFrameTime was already aligned to the current frame slot at the
                // top of the tick; do NOT reset it to `now` here, or the grid drifts.
            }
            // Fire exactly on the next 30fps grid slot (lastFrameTime is on-slot).
            const nextFireAt = lastFrameTime + dacFrameInterval;
            dacProcessTimeoutId = setTimeout(animate, Math.max(0, nextFireAt - performance.now()));
        };

        function isTypedArray(obj) {
            return !!obj && (obj instanceof Float32Array || obj.buffer instanceof ArrayBuffer);
        }

        // Frame fetcher loop for updating liveFrames
        const frameFetcherLoop = (timestamp) => {
            try {
            const currentFrameInterval = 1000 / playbackFpsRef.current;
            const currentBpm = bpmRef.current || 120;

            const processClip = (clip, layerIndex, colIndex, workerId, isPreview = false, ts = timestamp, skipRegen = false) => {
                const pageIdx = clip.pageId !== undefined ? clip.pageId : stateRef.current.activePageId;

                if (!lastFrameFetchTimeRef.current[workerId]) {
                    lastFrameFetchTimeRef.current[workerId] = ts;
                }

                // Calculate time since last frame
                let dt = ts - lastFrameFetchTimeRef.current[workerId];

                // Sanity check for huge jumps (e.g. tab inactive)
                if (dt > 1000) dt = currentFrameInterval;

                // Only advance time if playing, OR if this is a virtual
                // preview (hovered/selected generator clip) so its thumbnail
                // can render live even when the transport is stopped.
                if (isPlayingRef.current || isPreview) {
                    if (accumulatedTimeRef.current[workerId] === undefined) {
                        accumulatedTimeRef.current[workerId] = 0;
                    }
                    accumulatedTimeRef.current[workerId] += dt;
                }

                const totalElapsed = accumulatedTimeRef.current[workerId] || 0;

                // We only use audio sync if it's an active clip (not a preview only)
                const activeInfo = activeClipIndexesRef.current[layerIndex];
                const isActive = activeInfo && activeInfo.pageId === pageIdx && activeInfo.colIndex === colIndex;
                const audioInfo = isActive ? getAudioInfoRef.current(layerIndex) : null;

                let targetIndex = frameIndexesRef.current[workerId] || 0;
                let currentProgress = 0;
                const totalFrames = clip.totalFrames || 1;
                const pSettings = clip.playbackSettings || { mode: 'fps', duration: totalFrames / 30, beats: 8, speedMultiplier: 1 };

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
                    const clipFps = pSettings.fps || 30;
                    const clipFrameInterval = 1000 / (clipFps * (pSettings.speedMultiplier || 1));

                    const isSingleFrameGen = clip.type === 'generator' && (!clip.frames || clip.frames.length <= 1);

                    if (dt >= clipFrameInterval || isSingleFrameGen) {
                        const framesToAdvance = Math.floor(dt / clipFrameInterval);
                        if (isPlayingRef.current || isPreview) {
                            lastFrameFetchTimeRef.current[workerId] = ts - (dt % clipFrameInterval);
                            targetIndex = (targetIndex + framesToAdvance);
                        } else {
                            lastFrameFetchTimeRef.current[workerId] = ts;
                        }

                        if (isSingleFrameGen) {
                            // Virtual progress for single-frame generators based on pSettings.duration
                            const virtualDurMs = (pSettings.duration || 1.0) * 1000;
                            currentProgress = (totalElapsed / virtualDurMs) % 1.0;
                            targetIndex = 0; // Always frame 0
                        } else {
                            currentProgress = totalFrames > 0 ? ((targetIndex % totalFrames) / totalFrames) : 0;
                        }
                    } else {
                        // If not enough time passed for a new frame, we still keep current targetIndex
                        // and we don't return here anymore, so parameter animation can run every loop
                        targetIndex = frameIndexesRef.current[workerId] || 0;
                        currentProgress = progressRef.current[workerId] || 0;
                    }
                }

                // For non-FPS modes, we update lastFrameFetchTimeRef every loop to keep dt correct
                if (pSettings.mode !== 'fps') {
                    lastFrameFetchTimeRef.current[workerId] = ts;
                }

                if (isNaN(targetIndex)) targetIndex = 0;
                if (isNaN(currentProgress)) currentProgress = 0;

                // Apply playback direction and style for ILDA clips (not generators)
                if (clip.type === 'ilda' && clip.playbackSettings) {
                    const playbackSettings = clip.playbackSettings;
                    const direction = playbackSettings.direction || 'forward';
                    const style = playbackSettings.style || 'loop';

                    if (direction !== 'forward' || style !== 'loop') {
                        // Use calculateAnimPhase to get the modified progress
                        const animPhase = calculateAnimPhase(currentProgress, { style, direction }, 0, [0, totalFrames - 1]);
                        targetIndex = Math.floor(animPhase);
                    }
                }

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
                        const currentLayerClips = clipContentsRef.current[pageIdx]?.[layerIndex] || [];
                        const activeInfo = activeClipIndexesRef.current[layerIndex];
                        if (activeInfo && activeInfo.pageId === pageIdx) {
                            const currentCol = activeInfo.colIndex;
                            let nextCol = -1;
                            if (mode === 'forward') {
                                for (let i = 1; i < 8; i++) {
                                    const idx = (currentCol + i) % 8;
                                    if (currentLayerClips[idx]) {
                                        nextCol = idx;
                                        break;
                                    }
                                }
                            } else if (mode === 'random') {
                                const validCols = currentLayerClips.map((c, idx) => c ? idx : null).filter(idx => idx !== null && idx !== currentCol);
                                if (validCols.length > 0) {
                                    nextCol = validCols[Math.floor(Math.random() * validCols.length)];
                                }
                            }
                            if (nextCol !== -1) {
                                setTimeout(() => handleActivateClick(layerIndex, nextCol), 0);
                            }
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
                    // FPS mode or default
                    if (clip.type === 'generator' && (!clip.frames || clip.frames.length <= 1)) {
                        clipDuration = pSettings.duration || 1.0;
                    } else {
                        clipDuration = totalFrames / (pSettings.fps || 30);
                    }
                }

                // Generator Parameter Animation Sync + real-time re-generation.
                // processClip is called by multiple drivers — the active output loop
                // (once per rAF), the thumbnail regen loop AND the background loop for
                // released flash clips. Time-based animated params change every call,
                // so without ONE shared per-clip budget each driver would enqueue a fresh
                // full-frame regen every rAF (~80+/s for an active flash generator): the
                // worker queue floods and every response structured-clones a big typed
                // array back to the main thread, tanking UI and DAC output frames.
                if (clip.type === 'generator') {
                    const syncSettings = clip.syncSettings || {};
                    const generatorId = clip.generatorDefinition?.id;
                    const genDef = clip.generatorDefinition;

                    const genLiveMinInterval = Math.max(16, 1000 / Math.max(1, pSettings.fps || 30));
                    const lastGenLive = generatorLiveRegenTimeRef.current.get(workerId) || 0;
                    const genBudgetOk = (ts - lastGenLive) >= genLiveMinInterval;

                    const animatedParams = Object.keys(syncSettings).filter(key => key.startsWith(`${generatorId}.`));
                    let resolvedParams = null;
                    let changed = false;

                    if (animatedParams.length > 0) {
                        const currentParams = clip.currentParams || {};
                        resolvedParams = { ...currentParams };

                        const context = {
                            time: ts,
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
                    }

                    const timeVarying = generatorId === 'waveform' || generatorId === 'timer';

                    if (genBudgetOk && !skipRegen && (changed || timeVarying)) {
                        generatorLiveRegenTimeRef.current.set(workerId, ts);

                        if (changed) {
                            // Param-animation wins the shared budget for this tick: it
                            // carries the resolved params, the frame is regenerated with
                            // them, and the audio-driven paths wait for the next slot.
                            const seq = ++generatorRequestSeqRef.current;
                            regenerateGeneratorClip(layerIndex, colIndex, clip.generatorDefinition, resolvedParams, seq, true, false, null, null, pageIdx);
                        } else if (generatorId === 'waveform') {
                            const params = clip.currentParams || {};
                            const data = (params.mode === 'waveform') ? timeDataRef.current : fftDataRef.current;
                            const seq = ++generatorRequestSeqRef.current;
                            const context = {
                                time: ts,
                                activationTime: clipActivationTimesRef.current[layerIndex] || 0
                            };
                            regenerateGeneratorClip(layerIndex, colIndex, clip.generatorDefinition, params, seq, false, true, data, context, pageIdx);
                        } else if (generatorId === 'timer') {
                            const params = clip.currentParams || {};
                            const seq = ++generatorRequestSeqRef.current;
                            const context = {
                                time: ts,
                                activationTime: clipActivationTimesRef.current[layerIndex] || 0
                            };
                            regenerateGeneratorClip(layerIndex, colIndex, clip.generatorDefinition, params, seq, false, true, null, context, pageIdx);
                        }
                    }
                }

                if (frameIndexesRef.current[workerId] !== targetIndex || !liveFramesRef.current[workerId]) {
                    frameIndexesRef.current[workerId] = targetIndex;
                    if (!skipRegen) {
                        if (clip.type === 'ilda') {
                            ildaParserWorker.postMessage({ type: 'get-frame', workerId, frameIndex: targetIndex, pageId: pageIdx });
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
                }
            };

            // Expose the current processClip instance so the flash background loop can
            // advance released clips with the SAME timing/state driver as the active
            // loop (progress, sync parameters, frame indexes stay continuous).
            processClipRef.current = (bgClip, layerIdx, colIdx, workerId, isPreview = false, ts = performance.now(), skipRegen = false) => {
                processClip(bgClip, layerIdx, colIdx, workerId, isPreview, ts, skipRegen);
            };

            // 1. Process active clips across ALL pages (as tracked in activeClipIndexes)
            layers.forEach((_, layerIndex) => {
                const activeInfo = activeClipIndexesRef.current[layerIndex];
                if (!activeInfo || activeInfo.colIndex === null) return;

                const { pageId, colIndex } = activeInfo;
                // Use live content ref for latest params
                const clipSource = liveClipContentsRef.current || clipContentsRef.current;
                const clip = clipSource[pageId]?.[layerIndex]?.[colIndex];
                if (!clip) return;

                let workerId = clip.type === 'ilda' ? clip.workerId : (clip.type === 'generator' ? `generator-${pageId}-${layerIndex}-${colIndex}` : null);
                if (!workerId) return;

                processClip(clip, layerIndex, colIndex, workerId);
            });

            // 2. Process selected clip (for preview) if it's not already handled as active
            const selWorkerId = selectedIldaWorkerIdRef.current;
            if (selWorkerId && !activeClipsDataRef.current.some(c => c.workerId === selWorkerId)) {
                const lIdx = selectedLayerIndexRef.current;
                const cIdx = selectedColIndexRef.current;
                const pIdx = stateRef.current.activePageId;

                if (lIdx !== null && cIdx !== null) {
                    const clipSource = liveClipContentsRef.current || clipContentsRef.current;
                    const clip = clipSource[pIdx]?.[lIdx]?.[cIdx];
                    if (clip) {
                        processClip(clip, lIdx, cIdx, selWorkerId, clip.type === 'generator');
                    }
                }
            }

            // 3. Process hovered clip (for hover preview). Only needed in live thumbnail
            // render mode — in still mode the hovered thumbnail shows a static frame, so
            // generating per-frame preview frames nobody renders is pure waste.
            if (stateRef.current.thumbnailRenderMode === 'active' && hoveredClipRef.current) {
                const { layerIndex, colIndex } = hoveredClipRef.current;
                const pIdx = stateRef.current.activePageId;

                // Avoid double processing if it's already active or selected. Also skip the
                // hover preview while ANY clip is selected for preview: clicking a
                // new clip's preview should become the sole running preview instead of
                // leaving a previously hovered/selected preview animating too.
                const activeInfo = activeClipIndexesRef.current[layerIndex];
                const isActive = activeInfo && activeInfo.pageId === pIdx && activeInfo.colIndex === colIndex;
                const selWorkerId = selectedIldaWorkerIdRef.current;
                const anySelectedPreview = selectedLayerIndexRef.current !== null && selectedColIndexRef.current !== null;

                if (!isActive && !anySelectedPreview) {
                    const clipSource = liveClipContentsRef.current || clipContentsRef.current;
                    const clip = clipSource[pIdx]?.[layerIndex]?.[colIndex];
                    if (clip) {
                        let workerId = clip.type === 'ilda' ? clip.workerId : (clip.type === 'generator' ? `generator-${pIdx}-${layerIndex}-${colIndex}` : null);
                        if (workerId && workerId !== selWorkerId) {
                            processClip(clip, layerIndex, colIndex, workerId, clip.type === 'generator');
                        }
                    }
                }
            }

            } catch (err) {
                console.error('[frameFetcherLoop] preview-loop error (kept alive):', err);
            }

            animationFrameId = requestAnimationFrame(frameFetcherLoop);
        };

        // Generator preview regeneration scheduler — lives in the EFFECT scope (created
        // once per effect run), NOT inside frameFetcherLoop: being inside the per-frame
        // loop made it rebuild its closures and spawn cascading timer chains 60x/s (the
        // "most active loop" in the debugger) and put its rAF/timer vars out of scope for
        // the effect cleanup (ReferenceError on toggling laser output). Single-frame
        // generators animate ONLY by regenerating (the worker produces frames from the
        // current params/sync); actively-outputting, hovered, selected and
        // background-flash clips are driven live elsewhere, so this self-scheduled loop
        // regenerates every OTHER generator clip that actually changes over time
        // (timer/waveform, NDI/Spout sources, clips with parameter animation) at its own
        // clip fps, and stays dormant (a slow timeout) when nothing time-varying is on
        // the page.
        const TIME_VARYING_GEN = new Set(['timer', 'waveform', 'ndi-source', 'spout-receiver']);
        const THUMB_PREVIEW_MIN_MS = 50; // never regenerate a single clip faster than 20x/s
        let genThumbnailTimer = 0;
        let genThumbnailRaf = 0; // legacy cleanup compatibility (scheduler uses timers only)
        const lastPreviewRegen = new Map(); // generator workerId -> last regeneration time
        const genThumbnailLoop = () => {
            // Declared OUTSIDE the try block: it is read after the catch closes
            // (when scheduling the next tick), so a let inside try would be out of
            // scope and throw "soonest is not defined" whenever this loop completes.
            let soonest = 500;
            try {
                const pageIdx = stateRef.current.activePageId;
            const clipSource = liveClipContentsRef.current || clipContentsRef.current;
            const pageClips = clipSource?.[pageIdx] || [];
            const mode = stateRef.current.thumbnailRenderMode;

            if (mode !== 'active') {
                genThumbnailTimer = setTimeout(genThumbnailLoop, 500);
                return;
            }

            const now = performance.now();
            const due = [];

            for (let li = 0; li < pageClips.length; li++) {
                const row = pageClips[li] || [];
                for (let ci = 0; ci < row.length; ci++) {
                    const clip = row[ci];
                    if (!clip || clip.type !== 'generator') continue;
                    // Skip clips already being driven live elsewhere.
                    const activeInfo = activeClipIndexesRef.current[li];
                    if (activeInfo && activeInfo.pageId === pageIdx && activeInfo.colIndex === ci) continue;
                    if (selectedLayerIndexRef.current === li && selectedColIndexRef.current === ci) continue;
                    const hovered = hoveredClipRef.current;
                    if (hovered && hovered.layerIndex === li && hovered.colIndex === ci) continue;
                    const genWorkerId = `generator-${pageIdx}-${li}-${ci}`;
                    if ([...backgroundRunningClipsRef.current].some(entry => entry.workerId === genWorkerId)) continue;

                    const gid = clip.generatorDefinition?.id;
                    const hasParamAnim = clip.syncSettings && Object.keys(clip.syncSettings).some(k => k.startsWith(`${gid}.`));
                    const isTimeVarying = TIME_VARYING_GEN.has(gid) || hasParamAnim;
                    // Static generators change only when their params change (that path
                    // regenerates on its own), so skip them unless no frame exists yet —
                    // a fresh clip still needs one bootstrap preview regeneration.
                    if (!isTimeVarying && liveFramesRef.current[genWorkerId]) continue;

                    const fps = clip.playbackSettings?.fps || 30;
                    const interval = Math.max(THUMB_PREVIEW_MIN_MS, 1000 / Math.max(1, fps));
                    const last = lastPreviewRegen.get(genWorkerId) || 0;
                    const wait = last + interval - now;
                    if (wait <= 0) {
                        // Time-varying clips repeat at their interval; static clips are
                        // only bootstrapped once (retrying slowly if no frame arrived).
                        lastPreviewRegen.set(genWorkerId, isTimeVarying ? now : now + 5000);
                        due.push([li, ci, genWorkerId]);
                    } else {
                        soonest = Math.min(soonest, wait);
                    }
                }
            }

            for (const [li, ci, genWorkerId] of due) {
                const clip = pageClips[li]?.[ci];
                if (clip && clip.currentParams) {
                    processClipRef.current(clip, li, ci, genWorkerId, true, now);
                }
            }

            } catch (err) {
                console.error('[genThumbnailLoop] thumbnail-loop error (kept alive):', err);
            }

            genThumbnailTimer = setTimeout(genThumbnailLoop, Math.max(10, Math.min(soonest, 500)));
        };
        genThumbnailTimer = setTimeout(genThumbnailLoop, 500);

        animationFrameId = requestAnimationFrame(frameFetcherLoop);

        // Start DAC processing (renderer) and send loop (main process)
        if (isWorldOutputActive) {
            dacProcessTimeoutId = setTimeout(animate, dacFrameInterval);
            if (window.electronAPI) window.electronAPI.send('start-dac-send-loop');
        } else {
            clearTimeout(dacProcessTimeoutId);
            if (window.electronAPI) window.electronAPI.send('stop-dac-send-loop');
        }


        // Cleanup on unmount
        return () => {
            ildaParserWorker.removeEventListener('message', handleMessage);
            cancelAnimationFrame(animationFrameId);
            cancelAnimationFrame(genThumbnailRaf);
            clearTimeout(genThumbnailTimer);
            clearTimeout(dacProcessTimeoutId);
            if (window.electronAPI) window.electronAPI.send('stop-dac-send-loop');
        };
    }, [ildaParserWorker, isWorldOutputActive]); // Minimal dependencies

    // Listen for context menu commands
    useEffect(() => {
        let unsubClip, unsubLayer, unsubCtx, unsubPage;

        if (window.electronAPI) {
            unsubClip = window.electronAPI.onClipContextMenuCommand((command, layerIndex, colIndex) => {
                console.log(`Clip context menu command received: ${command} for ${layerIndex}-${colIndex}`);
                if (command === 'export-ilda') {
                    const pageIdx = stateRef.current.activePageId;
                    const clipToExport = clipContentsRef.current?.[pageIdx]?.[layerIndex]?.[colIndex];
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
                        } else if (clipToExport.type === 'generator') {
                            console.log('Exporting generator frames with parameter animation...');

                            const pb = clipToExport.playbackSettings || {};
                            const clipSyncMode = pb.mode || 'fps';

                            const exportGenerator = async (correctTiming = false) => {
                                const { framesToIlda } = await import('./utils/ilda-writer.js');
                                const fps = playbackFps || 30;
                                let duration = 2.0;

                                if (pb.mode === 'timeline') duration = pb.duration || 2.0;
                                else if (pb.mode === 'bpm') duration = ((pb.beats || 8) * 60) / (state.bpm || 120);
                                else if (clipToExport.frames?.length > 1) duration = clipToExport.frames.length / fps;

                                // On correction, re-target any parameter synced to a different time
                                // source to the clip's own playback mode (export only; clip untouched).
                                const rawSync = clipToExport.syncSettings || {};
                                let effectiveSync = rawSync;
                                if (correctTiming) {
                                    effectiveSync = {};
                                    for (const [key, setting] of Object.entries(rawSync)) {
                                        const s = (setting && typeof setting === 'object') ? setting : { syncMode: setting };
                                        if (s.syncMode && ['fps', 'timeline', 'bpm'].includes(s.syncMode) && s.syncMode !== clipSyncMode) {
                                            effectiveSync[key] = { ...s, syncMode: clipSyncMode };
                                        } else {
                                            effectiveSync[key] = setting;
                                        }
                                    }
                                }

                                const totalExportFrames = Math.ceil(duration * fps);
                                const bakedFrames = [];
                                const exportEffectStates = new Map();
                                const generatorId = clipToExport.generatorDefinition?.id;

                                // Load font buffer once if needed
                                let fontBuffer = null;
                                if (['text', 'spout-receiver'].includes(generatorId)) {
                                    const fontUrl = clipToExport.currentParams?.fontUrl || 'src/fonts/Geometr415 Blk BT Black.ttf';
                                    try {
                                        if (fontUrl.startsWith('http')) fontBuffer = await window.electronAPI.fetchUrlAsArrayBuffer(fontUrl);
                                        else fontBuffer = await window.electronAPI.readFileForWorker(fontUrl);
                                    } catch (e) { console.error("Failed to load font for export:", e); }
                                }

                                for (let i = 0; i < totalExportFrames; i++) {
                                    const time = i * (1000 / fps);
                                    const progress = i / totalExportFrames;

                                    // 1. Resolve Parameters for this frame
                                    const syncSettings = effectiveSync;
                                    const genDef = clipToExport.generatorDefinition;
                                    const currentParams = clipToExport.currentParams || {};
                                    const resolvedParams = { ...currentParams };

                                    const context = {
                                        time: time,
                                        progress: progress,
                                        bpm: state.bpm,
                                        clipDuration: duration,
                                        fftLevels: { low: 0, mid: 0, high: 0 },
                                        activationTime: 0
                                    };

                                    for (const key in syncSettings) {
                                        if (key.startsWith(`${generatorId}.`)) {
                                            const paramId = key.split('.')[1];
                                            const control = genDef?.paramControls?.find(c => c.id === paramId);
                                            const baseValue = currentParams[paramId] !== undefined ? currentParams[paramId] : genDef.defaultParams[paramId];
                                            resolvedParams[paramId] = resolveParam(paramId, baseValue, syncSettings[key], context, control?.min, control?.max);
                                        }
                                    }

                                    // 2. Generate Base Geometry
                                    let baseFrame = null;
                                    try {
                                        if (generatorId === 'circle') baseFrame = generateCircle(resolvedParams);
                                        else if (generatorId === 'square') baseFrame = generateSquare(resolvedParams);
                                        else if (generatorId === 'line') baseFrame = generateLine(resolvedParams);
                                        else if (generatorId === 'star') baseFrame = generateStar(resolvedParams);
                                        else if (generatorId === 'text') baseFrame = await generateText(resolvedParams, fontBuffer);
                                        else if (generatorId === 'spout-receiver') baseFrame = await generateText({ ...resolvedParams, text: resolvedParams.sourceName }, fontBuffer);
                                        else if (clipToExport.frames) {
                                            // Fallback to cycling original frames (e.g. NDI)
                                            const idx = Math.floor(progress * clipToExport.frames.length) % clipToExport.frames.length;
                                            baseFrame = clipToExport.frames[idx];
                                        }
                                    } catch (e) { console.error("Generation failed during export:", e); }

                                    if (baseFrame) {
                                        // 3. Apply Effects
                                        const effectsToApply = (clipToExport.effects || []).filter(eff => {
                                            if ((eff.id === 'delay' || eff.id === 'chase') && eff.params?.mode === 'channel') return false;
                                            return true;
                                        });

                                        const processedFrame = applyEffects(baseFrame, effectsToApply, {
                                            time: time,
                                            progress: progress,
                                            effectStates: exportEffectStates,
                                            syncSettings: effectiveSync,
                                            bpm: state.bpm,
                                            clipDuration: duration,
                                            assignedDacs: clipToExport.assignedDacs || []
                                        });

                                        // 4. Convert to Object Points for writer
                                        const pts = processedFrame.points;
                                        const numPts = pts.length / 8;
                                        const objectPoints = [];
                                        for (let k = 0; k < numPts; k++) {
                                            objectPoints.push({
                                                x: pts[k * 8], y: pts[k * 8 + 1], z: pts[k * 8 + 2],
                                                r: pts[k * 8 + 3], g: pts[k * 8 + 4], b: pts[k * 8 + 5],
                                                blanking: pts[k * 8 + 6] > 0.5,
                                                lastPoint: pts[k * 8 + 7] > 0.5
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
                                    const res = await window.electronAPI.saveIldaFile(buffer, defaultName);
                                    if (res.success) showNotification(`Exported to ${res.filePath}`);
                                    else if (res.error) showNotification(`Export failed: ${res.error}`);
                                }
                            };

                            let mismatchCount = 0;
                            if (clipToExport.syncSettings) {
                                for (const setting of Object.values(clipToExport.syncSettings)) {
                                    const s = (setting && typeof setting === 'object') ? setting : { syncMode: setting };
                                    if (s.syncMode && ['fps', 'timeline', 'bpm'].includes(s.syncMode) && s.syncMode !== clipSyncMode) mismatchCount += 1;
                                }
                            }

                            const runExport = (correctTiming) => {
                                exportGenerator(correctTiming).catch(err => console.error('Failed to export generator:', err));
                            };

                            if (mismatchCount > 0) {
                                setExportTimingWarning({
                                    mismatchCount,
                                    clipSyncMode,
                                    onCancel: () => setExportTimingWarning(null),
                                    onExportAnyway: () => { setExportTimingWarning(null); runExport(false); },
                                    onAutoCorrect: () => { setExportTimingWarning(null); runExport(true); }
                                });
                            } else {
                                runExport(false);
                            }
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
                    const pageIdx = stateRef.current.activePageId;
                    const clipToUpdate = clipContents[pageIdx]?.[layerIndex]?.[colIndex];
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
                                pageId: pageIdx
                            });
                        } else if (clipToUpdate.type === 'generator' && clipToUpdate.generatorDefinition) {
                            const currentIdx = frameIndexesRef.current[`generator-${pageIdx}-${layerIndex}-${colIndex}`] || 0;
                            const currentFrame = clipToUpdate.frames?.[currentIdx % clipToUpdate.frames.length];
                            if (currentFrame) {
                                const effects = clipToUpdate.effects || [];
                                generateThumbnail(currentFrame, effects, layerIndex, colIndex, optimizationEnabled, pageIdx).then(thumbnailPath => {
                                    dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { stillFrame: currentFrame, thumbnailPath, thumbnailVersion: Date.now() } } });
                                });
                            }
                        }
                    }
                } else if (command === 'clear-clip') {
                    dispatch({ type: 'CLEAR_CLIP', payload: { layerIndex, colIndex } });
                } else if (command === 'rename-clip') {
                    const pageIdx = stateRef.current.activePageId;
                    const oldName = clipNamesRef.current[pageIdx][layerIndex][colIndex];
                    setRenameModalConfig({
                        title: 'Rename Clip',
                        initialValue: oldName,
                        onSave: (newName) => dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: newName } })
                    });
                    setShowRenameModal(true);
                } else if (command === 'copy-clip') {
                    const pageIdx = stateRef.current.activePageId;
                    const clipToCopy = {
                        content: clipContentsRef.current[pageIdx][layerIndex][colIndex],
                        name: clipNamesRef.current[pageIdx][layerIndex][colIndex],
                    };
                    dispatch({ type: 'SET_CLIPBOARD', payload: clipToCopy });
                    showNotification('Clip copied.');
                } else if (command === 'cut-clip') {
                    const pageIdx = stateRef.current.activePageId;
                    const clipToCut = {
                        content: clipContentsRef.current[pageIdx][layerIndex][colIndex],
                        name: clipNamesRef.current[pageIdx][layerIndex][colIndex],
                    };
                    dispatch({ type: 'SET_CLIPBOARD', payload: clipToCut });
                    dispatch({ type: 'CLEAR_CLIP', payload: { layerIndex, colIndex } });
                    showNotification('Clip cut.');
                } else if (command === 'paste-clip') {
                    if (state.clipClipboard) {
                        const { content, name } = state.clipClipboard;

                        // Deep clone the content to ensure complete independence
                        // Using JSON parse/stringify for a quick deep clone of the plain data
                        let contentToPaste = JSON.parse(JSON.stringify(content));

                        if (contentToPaste.type === 'ilda') {
                            contentToPaste.workerId = null;
                            // Give the pasted clip a fresh parse: clear any stale
                            // parsingFailed flag so the re-parse effect fires.
                            contentToPaste.parsingFailed = false;
                            contentToPaste.parsing = false;
                        }

                        // Regenerate effect instance IDs to ensure they are unique in the new clip
                        // and update the corresponding syncSettings keys.
                        if (contentToPaste.effects && contentToPaste.effects.length > 0) {
                            const oldSyncSettings = contentToPaste.syncSettings || {};
                            const newSyncSettings = { ...oldSyncSettings };

                            contentToPaste.effects = contentToPaste.effects.map(effect => {
                                const oldInstanceId = effect.instanceId;
                                const newInstanceId = generateId();

                                // If this effect had synced parameters, update their keys to the new instance ID
                                Object.keys(newSyncSettings).forEach(key => {
                                    if (oldInstanceId && key.startsWith(`${oldInstanceId}.`)) {
                                        const paramPart = key.substring(oldInstanceId.length); // includes the dot
                                        newSyncSettings[`${newInstanceId}${paramPart}`] = newSyncSettings[key];
                                        delete newSyncSettings[key];
                                    }
                                });

                                return { ...effect, instanceId: newInstanceId };
                            });

                            contentToPaste.syncSettings = newSyncSettings;
                        }

                        dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: contentToPaste } });
                        dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name } });
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
                } else if (command === 'set-trigger-style-temp') {
                    dispatch({ type: 'SET_CLIP_TRIGGER_STYLE', payload: { layerIndex, colIndex, style: 'temp' } });
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
                    columns.forEach((_, colIndex) => {
                        dispatch({ type: 'CLEAR_CLIP', payload: { layerIndex, colIndex } });
                    });
                    if (typeof stopAudio === 'function') stopAudio(layerIndex);
                }
            });

            unsubPage = window.electronAPI.onPageContextMenuCommand((command, pageIndex) => {
                console.log(`Page context menu command received: ${command} for ${pageIndex}`);
                if (command === 'page-rename') {
                    const oldName = pageNames[pageIndex] || `Page ${pageIndex + 1}`;
                    setRenameModalConfig({
                        title: 'Rename Page',
                        initialValue: oldName,
                        onSave: (newName) => dispatch({ type: 'SET_PAGE_NAME', payload: { index: pageIndex, name: newName } })
                    });
                    setShowRenameModal(true);
                } else if (command === 'page-clear-clips') {
                    dispatch({ type: 'CLEAR_PAGE_CLIPS', payload: { pageIndex } });
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
                } else if (action.type === 'reset-quick-assign') {
                    const defaultValue = action.controlType === 'knob' ? 0 : false;
                    dispatch({ type: 'UPDATE_QUICK_CONTROL', payload: { type: action.controlType, index: action.index, value: defaultValue } });
                } else if (action.type === 'clear-quick-assign') {
                    dispatch({ type: 'CLEAR_QUICK_CONTROL', payload: { type: action.controlType, index: action.index } });
                } else if (action.type === 'remove-quick-assign-link') {
                    dispatch({ type: 'REMOVE_QUICK_ASSIGN_LINK', payload: { type: action.controlType, index: action.index, linkIndex: action.linkIndex } });
                }
            });
        }

        return () => {
            if (unsubClip) unsubClip();
            if (unsubLayer) unsubLayer();
            if (unsubCtx) unsubCtx();
            if (unsubPage) unsubPage();
        };
    }, [clipContents, clipNames, layers, columns, ildaParserWorker, generatorWorker, state.clipClipboard, pageNames]);

    const prevThumbnailFrameIndexesRef = useRef(thumbnailFrameIndexes);



    useEffect(() => {
        // Find which thumbnails have changed or where workerId became valid across ALL pages
        for (let p = 0; p < (state.numPages || 8); p++) {
            for (let i = 0; i < layers.length; i++) {
                for (let j = 0; j < columns.length; j++) {
                    const currentIndex = thumbnailFrameIndexes[p]?.[i]?.[j] || 0;
                    const prevIndex = prevThumbnailFrameIndexesRef.current[p]?.[i]?.[j] || 0;
                    const clip = clipContents[p]?.[i]?.[j];
                    const currentWorkerId = clip?.workerId;
                    const prevWorkerId = prevWorkerIdsRef.current.get(`${p}-${i}-${j}`);

                    const indexChanged = currentIndex !== prevIndex;
                    const workerBecameValid = currentWorkerId && !prevWorkerId;

                    if ((indexChanged || workerBecameValid) && clip && clip.type === 'ilda' && currentWorkerId) {
                        console.log(`[App.jsx] Fetching still frame for ${p}-${i}-${j} at index ${currentIndex}. Reason: ${indexChanged ? 'index change' : 'worker ready'}`);
                        ildaParserWorker.postMessage({
                            type: 'get-frame',
                            workerId: currentWorkerId,
                            frameIndex: currentIndex,
                            isStillFrame: true,
                            layerIndex: i,
                            colIndex: j,
                            pageId: p // Pass pageId
                        });
                    }

                    // Update workerId ref
                    if (currentWorkerId) prevWorkerIdsRef.current.set(`${p}-${i}-${j}`, currentWorkerId);
                    else prevWorkerIdsRef.current.delete(`${p}-${i}-${j}`);
                }
            }
        }

        // Update the ref for the next render
        prevThumbnailFrameIndexesRef.current = thumbnailFrameIndexes;
    }, [thumbnailFrameIndexes, clipContents, layers.length, columns.length, ildaParserWorker, state.numPages]);

    // Sync generator frames whenever their parameters change
    useEffect(() => {
        if (!generatorWorker) return;

        clipContents.forEach((page, pageIndex) => {
            page.forEach((layer, layerIndex) => {
                layer.forEach((clip, colIndex) => {
                    if (clip && clip.type === 'generator' && clip.generatorDefinition) {
                        // Skip NDI source here as it's handled by the NDI frame loop
                        if (clip.generatorDefinition.id === 'ndi-source') return;

                        const key = `${pageIndex}-${layerIndex}-${colIndex}`;
                        // Merge defaults for a stable comparison
                        const completeParams = { ...clip.generatorDefinition.defaultParams, ...(clip.currentParams || {}) };
                        const currentParamsJson = JSON.stringify(completeParams);

                        if (prevGeneratorParamsRef.current.get(key) !== currentParamsJson) {
                            // Parameters changed (via MIDI, Quick Assign, or UI)
                            console.log(`[App.jsx] Generator ${key} params changed, regenerating...`);
                            const seq = ++generatorRequestSeqRef.current;
                            regenerateGeneratorClip(layerIndex, colIndex, clip.generatorDefinition, clip.currentParams, seq, false, false, null, null, pageIndex);
                            prevGeneratorParamsRef.current.set(key, currentParamsJson);
                        }
                    }
                });
            });
        });
    }, [clipContents, generatorWorker]);

    // Re-parse ILDA files and re-generate generator frames on project load
    useEffect(() => {
        if (!state.projectLoadTimestamp || !ildaParserWorker || !generatorWorker) return;

        console.log("Project loaded, regenerating content...");

        const audioChecks = [];

        clipContents.forEach((page, pageIndex) => {
            page.forEach((layer, layerIndex) => {
                layer.forEach((clip, colIndex) => {
                    if (clip) {
                        if (clip.type === 'ilda' && clip.filePath && !clip.workerId) {
                            console.log(`Reparsing ILDA file for clip ${pageIndex}-${layerIndex}-${colIndex}: ${clip.filePath}`);
                            ildaParserWorker.postMessage({
                                type: 'load-and-parse-ilda',
                                fileName: clip.fileName,
                                filePath: clip.filePath,
                                layerIndex,
                                colIndex,
                                pageId: pageIndex // Pass pageIndex
                            });
                        } else if (clip.type === 'generator' && clip.generatorDefinition) {
                            console.log(`Regenerating generator clip ${pageIndex}-${layerIndex}-${colIndex} on project load`);
                            const seq = ++generatorRequestSeqRef.current;
                            regenerateGeneratorClip(layerIndex, colIndex, clip.generatorDefinition, clip.currentParams, seq, false, false, null, null, pageIndex);
                        }

                        // Check for missing audio files
                        if (clip.audioFile && clip.audioFile.path && window.electronAPI && window.electronAPI.checkFileExists) {
                            audioChecks.push(
                                window.electronAPI.checkFileExists(clip.audioFile.path).then(exists => {
                                    if (!exists) {
                                        setMissingFiles(prev => {
                                            const reqId = `audio-${pageIndex}-${layerIndex}-${colIndex}`;
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
                } else if (action === 'shapeBuilder') {
                    setCurrentPage('shapeBuilder');
                    dispatch({ type: 'SET_WORLD_OUTPUT_ACTIVE', payload: false });
                } else if (action === 'timeline') {
                    setCurrentPage('timeline');
                    dispatch({ type: 'SET_WORLD_OUTPUT_ACTIVE', payload: false });
                } else if (action === 'about') {
                    setShowAboutWindow(true);
                } else if (action === 'settings-audio-output') {
                    setShowAudioSettingsWindow(true);
                } else if (action === 'settings-audio-fft') {
                    setShowFftSettingsWindow(true);
                } else if (action === 'settings-general') {
                    setShowGeneralSettingsWindow(true);
                } else if (action === 'output-processing') {
                    setShowOutputProcessingWindow(true);
                } else if (action.startsWith('set-theme-')) {
                    const themeColor = action.split('set-theme-')[1];
                    dispatch({ type: 'SET_THEME', payload: themeColor });
                } else if (action === 'shortcuts-window' || (action.startsWith('open-') && action.endsWith('-settings'))) {
                    setShowShortcutsWindow(true);
                } else if (action === 'column-duplicate') {
                    if (selectedColIndex !== null) {
                        dispatch({ type: 'DUPLICATE_COLUMN', payload: { index: selectedColIndex } });
                        showNotification('Column duplicated.');
                    }
                } else if (action === 'column-clear-clips') {
                    if (selectedColIndex !== null) {
                        layers.forEach((_, lIdx) => {
                            dispatch({ type: 'CLEAR_CLIP', payload: { layerIndex: lIdx, colIndex: selectedColIndex } });
                        });
                    }
                } else if (action.startsWith('toggle-')) {
                    // action format: toggle-midi-true
                    const parts = action.split('-');
                    if (parts.length === 3) {
                        const protocol = parts[1]; // midi, artnet, osc, keyboard
                        const isEnabled = parts[2] === 'true';
                        setEnabledShortcuts(prev => ({ ...prev, [protocol]: isEnabled }));
                    }
                } else if (action === 'clear-thumbnail-cache') {
                    window.electronAPI.clearThumbnailCache().then(result => {
                        if (result.success) {
                            console.log(`Cleared ${result.count} cached thumbnails`);
                        } else {
                            console.error('Failed to clear thumbnail cache:', result.error);
                        }
                    });
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
                const { filePath, requestId, maxBytes } = e.data;
                try {
                    if (window.electronAPI && window.electronAPI.checkFileExists) {
                        const exists = await window.electronAPI.checkFileExists(filePath);
                        if (!exists) {
                            throw new Error(`File not found: ${filePath}`);
                        }
                    }

                    const arrayBuffer = await window.electronAPI.readFileForWorker(filePath, maxBytes);
                    ildaParserWorker.postMessage({
                        type: 'file-content-response',
                        requestId,
                        arrayBuffer,
                    }, [arrayBuffer]); // Transferrable
                } catch (error) {
                    console.warn(`File missing or read error: ${filePath}`, error.message);

                    // Tell the worker the read failed so its pending request is
                    // cleaned up and the parse attempt fails fast instead of
                    // hanging forever (a dangling request silently leaves the
                    // timeline clip dead until the view is reopened).
                    try {
                        ildaParserWorker.postMessage({
                            type: 'file-content-response',
                            requestId,
                            error: `File read failed: ${error.message}`,
                        });
                    } catch (err) { /* ignore */ }

                    // Instead of immediate prompt, add to missing files list
                    const fileName = filePath.split(/[/\\]/).pop();
                    setMissingFiles(prev => {
                        // Avoid duplicates
                        if (prev.some(f => f.requestId === requestId)) return prev;
                        return [...prev, { filePath, fileName, requestId }];
                    });
                }
            } else if (e.data.type === 'parsing-status') {
                const { layerIndex, colIndex, status, pageId } = e.data;
                if (layerIndex !== undefined && colIndex !== undefined) {
                    // Only update the parsing spinner flag. The worker posts
                    // status:false after SUCCESS too, so it must not be treated
                    // as a failure — parsingFailed is set via the 'error' branch.
                    dispatch({ type: 'SET_CLIP_PARSING_STATUS', payload: { layerIndex, colIndex, status, pageId } });
                }
            } else if (e.data.type === 'error') {
                const { layerIndex, colIndex, originalType, pageId } = e.data;
                console.warn('ILDA parser worker error:', e.data.message, e.data);
                if (originalType === 'parse-ilda' && layerIndex !== undefined && colIndex !== undefined) {
                    // Genuine parse failure: stop the spinner and mark the clip
                    // failed so we don't retry endlessly (e.g. missing file).
                    dispatch({ type: 'SET_CLIP_PARSING_STATUS', payload: { layerIndex, colIndex, status: false, pageId } });
                    dispatch({ type: 'SET_CLIP_PARSING_FAILED', payload: { layerIndex, colIndex, failed: true, pageId } });
                }
            }
        };

        ildaParserWorker.addEventListener('message', handleWorkerRequest);
        return () => {
            ildaParserWorker.removeEventListener('message', handleWorkerRequest);
        };
    }, [ildaParserWorker]);

    // Handles requests from thumbnailWorker
    useEffect(() => {
        if (!thumbnailWorker) return;

        const handleThumbnailRequest = async (e) => {
            if (e.data.type === 'request-file-content') {
                const { filePath, requestId, maxBytes } = e.data;
                try {
                    const arrayBuffer = await window.electronAPI.readFileForWorker(filePath, maxBytes);
                    thumbnailWorker.postMessage({
                        type: 'file-content-response',
                        requestId,
                        arrayBuffer,
                    }, [arrayBuffer]);
                } catch (error) {
                    console.error(`Thumbnail Worker: Error reading file: ${filePath}`, error);
                    thumbnailWorker.postMessage({ type: 'file-content-response', requestId, error: error.message });
                }
            }
        };

        thumbnailWorker.addEventListener('message', handleThumbnailRequest);
        return () => {
            thumbnailWorker.removeEventListener('message', handleThumbnailRequest);
        };
    }, [thumbnailWorker]);

    // Effect to trigger re-parsing of ILDA clips when workerId is missing (e.g. after load)
    useEffect(() => {
        if (!ildaParserWorker) return;

        const clipsToParse = [];
        clipContents.forEach((page, pageIndex) => {
            page.forEach((layer, layerIndex) => {
                layer.forEach((clip, colIndex) => {
                    if (clip && clip.type === 'ilda' && clip.filePath && !clip.workerId && !clip.parsing && !clip.parsingFailed) {
                        clipsToParse.push({ pageId: pageIndex, layerIndex, colIndex, fileName: clip.fileName, filePath: clip.filePath });
                    }
                });
            });
        });

        if (clipsToParse.length > 0) {
            console.log(`Triggering re-parse for ${clipsToParse.length} clips across all pages.`);
            // Bulk update status to parsing
            dispatch({
                type: 'SET_BULK_PARSING_STATUS',
                payload: clipsToParse.map(c => ({ pageId: c.pageId, layerIndex: c.layerIndex, colIndex: c.colIndex, status: true }))
            });

            // Send requests
            clipsToParse.forEach(clip => {
                ildaParserWorker.postMessage({
                    type: 'load-and-parse-ilda',
                    fileName: clip.fileName,
                    filePath: clip.filePath,
                    layerIndex: clip.layerIndex,
                    colIndex: clip.colIndex,
                    pageId: clip.pageId
                });
            });
        }
    }, [clipContents, ildaParserWorker]);

    // Calculate directly on render to ensure live params are used
    const source = liveClipContentsRef.current || clipContents;
    let selectedClipEffects = [];
    const pageIdx = state.activePageId;

    if (selectedLayerIndex !== null) {
        const lEffects = layerEffects[selectedLayerIndex] || [];

        if (selectedColIndex !== null) {
            const clipEffects = source[pageIdx]?.[selectedLayerIndex]?.[selectedColIndex]?.effects || [];
            selectedClipEffects = [...clipEffects, ...lEffects];
        } else {
            // Layer Mode: Use active clip effects
            const activeInfo = activeClipIndexes[selectedLayerIndex];
            if (activeInfo && activeInfo.colIndex !== null) {
                const clipEffects = source[activeInfo.pageId]?.[selectedLayerIndex]?.[activeInfo.colIndex]?.effects || [];
                selectedClipEffects = [...clipEffects, ...lEffects];
            } else {
                selectedClipEffects = lEffects;
            }
        }
    }

    const handleEffectParameterChange = useCallback((layerIndex, colIndex, effectIndex, paramName, newValue) => {
        const pageIdx = state.activePageId;
        // 1. Direct Live-update for Instant Preview: replace the clip/effect with a NEW
        // identity so the memo'd ClipSettingsPanel re-renders NOW (in-place mutation
        // would keep the old identity and the panel would skip the update, leaving the
        // slider visually stuck on its previous value until the next interaction).
        if (liveClipContentsRef.current && liveClipContentsRef.current[pageIdx] && liveClipContentsRef.current[pageIdx][layerIndex] && liveClipContentsRef.current[pageIdx][layerIndex][colIndex]) {
            const clip = liveClipContentsRef.current[pageIdx][layerIndex][colIndex];
            if (clip && clip.effects && clip.effects[effectIndex]) {
                const newEffects = [...clip.effects];
                newEffects[effectIndex] = {
                    ...clip.effects[effectIndex],
                    params: { ...clip.effects[effectIndex].params, [paramName]: newValue },
                };
                const newLayer = [...liveClipContentsRef.current[pageIdx][layerIndex]];
                newLayer[colIndex] = { ...clip, effects: newEffects };
                const next = [...liveClipContentsRef.current];
                next[pageIdx] = [...liveClipContentsRef.current[pageIdx].slice(0, layerIndex), newLayer, ...liveClipContentsRef.current[pageIdx].slice(layerIndex + 1)];
                liveClipContentsRef.current = next;
                hasPendingClipUpdate.current = true; // Signal that we have a local update
            }
        }
        // 2. Dispatch for State Persistence - DEBOUNCED (leading fires instantly
        // for discrete clicks; a continuous drag only triggers the trailing
        // commit once it rests, keeping re-renders off the DAC loop's thread)
        debouncedDispatch(
            `effect-${layerIndex}-${colIndex}-${effectIndex}-${paramName}`,
            { type: 'UPDATE_EFFECT_PARAMETER', payload: { layerIndex, colIndex, effectIndex, paramName, newValue } }
        );
    }, [debouncedDispatch, state.activePageId]);

    const handleLayerEffectParameterChange = useCallback((layerIndex, effectIndex, paramName, newValue) => {
        // 1. Direct Live-update for Instant Preview/Output: new identities so the
        // memo'd LayerSettingsPanel (which reads layerEffectsRef) re-renders NOW.
        if (layerEffectsRef.current && layerEffectsRef.current[layerIndex] && layerEffectsRef.current[layerIndex][effectIndex]) {
            const next = [...layerEffectsRef.current];
            const newEffects = [...next[layerIndex]];
            newEffects[effectIndex] = {
                ...next[layerIndex][effectIndex],
                params: { ...next[layerIndex][effectIndex].params, [paramName]: newValue },
            };
            next[layerIndex] = newEffects;
            layerEffectsRef.current = next;
        }
        // 2. Dispatch for State Persistence - DEBOUNCED (leading + trailing)
        debouncedDispatch(
            `layer-effect-${layerIndex}-${effectIndex}-${paramName}`,
            { type: 'UPDATE_LAYER_EFFECT_PARAMETER', payload: { layerIndex, effectIndex, paramName, newValue } }
        );
    }, [debouncedDispatch]);


    // Re-render a generator clip's persisted thumbnail so it reflects the clip's
    // CURRENT effects (structural effect changes like add/remove/reorder do not
    // trigger a generator re-run, so the cached PNG would otherwise stay stale).
    const regenerateClipThumbnail = useCallback((layerIndex, colIndex) => {
        const pageIdx = state.activePageId;
        const clip = liveClipContentsRef.current?.[pageIdx]?.[layerIndex]?.[colIndex];
        if (!clip) return;
        if (clip.type === 'generator' && clip.generatorDefinition && clip.frames && clip.frames.length > 0) {
            const currentIdx = frameIndexesRef.current[`generator-${pageIdx}-${layerIndex}-${colIndex}`] || 0;
            const currentFrame = clip.frames[currentIdx % clip.frames.length];
            if (currentFrame && currentFrame.points) {
                const effects = clip.effects || [];
                generateThumbnail(currentFrame, effects, layerIndex, colIndex, optimizationEnabled, pageIdx).then(thumbnailPath => {
                    if (thumbnailPath) {
                        dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { thumbnailPath, thumbnailVersion: Date.now() }, pageId: pageIdx } });
                    }
                });
            }
        }
    }, [state.activePageId, optimizationEnabled, dispatch]);

    const handleAddEffect = useCallback((effect) => {
        const pageIdx = state.activePageId;
        const { layerIndex, colIndex } = { layerIndex: selectedLayerIndex, colIndex: selectedColIndex };

        // Dedupe: bail if the same effect was just added to this clip (double drop).
        const nowAdd = Date.now();
        const addKey = `clip:${pageIdx}:${layerIndex}:${colIndex}`;
        const effKey = effect.id || effect.name;
        const lastAdd = lastEffectAddRef.current[addKey];
        if (lastAdd && lastAdd.id === effKey && nowAdd - lastAdd.time < 350) return;
        lastEffectAddRef.current[addKey] = { id: effKey, time: nowAdd };

        const effectInstance = {
            ...effect,
            instanceId: generateId(),
            params: { ...effect.defaultParams }
        };

        // 1. Direct live-ref mutation: replace the clip object with a NEW identity
        // so the memo'd ClipSettingsPanel (which reads live refs) re-renders NOW,
        // instead of waiting for the post-render ref sync (which never triggers a render).
        // Copy the page+layer arrays so we never mutate arrays aliased by state.
        if (liveClipContentsRef.current && liveClipContentsRef.current[pageIdx]) {
            const page = liveClipContentsRef.current[pageIdx];
            const oldLayer = page[layerIndex];
            if (oldLayer && oldLayer[colIndex]) {
                const clip = oldLayer[colIndex];
                const newLayer = [...oldLayer];
                newLayer[colIndex] = {
                    ...clip,
                    effects: [...(clip.effects || []), effectInstance],
                };
                const next = [...liveClipContentsRef.current];
                next[pageIdx] = [...page.slice(0, layerIndex), newLayer, ...page.slice(layerIndex + 1)];
                liveClipContentsRef.current = next;
                hasPendingClipUpdate.current = true;
            }
        }

        // 2. Dispatch for State Persistence (reuses the instanceId generated above)
        dispatch({ type: 'ADD_CLIP_EFFECT', payload: { layerIndex, colIndex, effect: effectInstance } });
        regenerateClipThumbnail(layerIndex, colIndex);
    }, [dispatch, state.activePageId, selectedLayerIndex, selectedColIndex, regenerateClipThumbnail]);

    const handleRemoveEffect = useCallback((layerIndex, colIndex, effectIndex) => {
        const pageIdx = state.activePageId;
        if (liveClipContentsRef.current && liveClipContentsRef.current[pageIdx]) {
            const page = liveClipContentsRef.current[pageIdx];
            const oldLayer = page[layerIndex];
            if (oldLayer && oldLayer[colIndex]) {
                const clip = oldLayer[colIndex];
                if (clip && clip.effects && clip.effects[effectIndex]) {
                    const newEffects = [...clip.effects];
                    newEffects.splice(effectIndex, 1);
                    const newLayer = [...oldLayer];
                    newLayer[colIndex] = { ...clip, effects: newEffects };
                    const next = [...liveClipContentsRef.current];
                    next[pageIdx] = [...page.slice(0, layerIndex), newLayer, ...page.slice(layerIndex + 1)];
                    liveClipContentsRef.current = next;
                    hasPendingClipUpdate.current = true;
                }
            }
        }
        dispatch({ type: 'REMOVE_CLIP_EFFECT', payload: { layerIndex, colIndex, effectIndex } });
        regenerateClipThumbnail(layerIndex, colIndex);
    }, [dispatch, state.activePageId, regenerateClipThumbnail]);

    const handleReorderEffects = useCallback((layerIndex, colIndex, oldIndex, newIndex) => {
        const pageIdx = state.activePageId;
        if (liveClipContentsRef.current && liveClipContentsRef.current[pageIdx]) {
            const page = liveClipContentsRef.current[pageIdx];
            const oldLayer = page[layerIndex];
            if (oldLayer && oldLayer[colIndex]) {
                const clip = oldLayer[colIndex];
                if (clip && clip.effects) {
                    const newEffects = [...clip.effects];
                    const [movedEffect] = newEffects.splice(oldIndex, 1);
                    newEffects.splice(newIndex, 0, movedEffect);
                    const newLayer = [...oldLayer];
                    newLayer[colIndex] = { ...clip, effects: newEffects };
                    const next = [...liveClipContentsRef.current];
                    next[pageIdx] = [...page.slice(0, layerIndex), newLayer, ...page.slice(layerIndex + 1)];
                    liveClipContentsRef.current = next;
                    hasPendingClipUpdate.current = true;
                }
            }
        }
        dispatch({ type: 'REORDER_CLIP_EFFECTS', payload: { layerIndex, colIndex, oldIndex, newIndex } });
        regenerateClipThumbnail(layerIndex, colIndex);
    }, [dispatch, state.activePageId, regenerateClipThumbnail]);

    const handleAddLayerEffect = useCallback((effect) => {
        if (selectedLayerIndex === null) return;

        // Dedupe: bail if the same effect was just added to this layer (double drop).
        const nowAdd = Date.now();
        const addKey = `layer:${selectedLayerIndex}`;
        const effKey = effect.id || effect.name;
        const lastAdd = lastEffectAddRef.current[addKey];
        const deduped = !!(lastAdd && lastAdd.id === effKey && nowAdd - lastAdd.time < 350);
        if (deduped) return;
        lastEffectAddRef.current[addKey] = { id: effKey, time: nowAdd };
        console.debug('[fx-debug] panel-add', Date.now(), addKey, effKey, 'deduped=', deduped);

        const effectInstance = {
            ...effect,
            instanceId: generateId(),
            params: { ...effect.defaultParams }
        };

        // 1. Direct live-ref mutation with a NEW array identity so the memo'd
        // LayerSettingsPanel (which reads layerEffectsRef) re-renders NOW.
        if (layerEffectsRef.current) {
            const next = [...layerEffectsRef.current];
            next[selectedLayerIndex] = [...(next[selectedLayerIndex] || []), effectInstance];
            layerEffectsRef.current = next;
        }

        // 2. Dispatch for State Persistence
        dispatch({ type: 'ADD_LAYER_EFFECT', payload: { layerIndex: selectedLayerIndex, effect: effectInstance } });
    }, [dispatch, selectedLayerIndex]);

    const handleRemoveLayerEffect = useCallback((effectIndex) => {
        if (selectedLayerIndex !== null && layerEffectsRef.current && layerEffectsRef.current[selectedLayerIndex]) {
            const next = [...layerEffectsRef.current];
            const newEffects = [...next[selectedLayerIndex]];
            newEffects.splice(effectIndex, 1);
            next[selectedLayerIndex] = newEffects;
            layerEffectsRef.current = next;
        }
        dispatch({ type: 'REMOVE_LAYER_EFFECT', payload: { layerIndex: selectedLayerIndex, effectIndex } });
    }, [dispatch, selectedLayerIndex]);

    // Shared live-ref mutation helper for clip edits that are dispatched to the
    // reducer. The ClipSettingsPanel renders from liveClipContentsRef (the same
    // object the DAC loop reads), which is only re-synced from committed state
    // on the NEXT render — and ref mutations don't trigger renders. So any edit
    // that skips this helper shows stale UI on the first interaction ("needs a
    // second click / collapse launch") and lags in the live output too. The
    // mutation must return the next clip (or the same reference to no-op).
    const applyLiveClipMutation = useCallback((layerIndex, colIndex, mutateClip) => {
        const pageIdx = state.activePageId;
        if (liveClipContentsRef.current && liveClipContentsRef.current[pageIdx]
            && liveClipContentsRef.current[pageIdx][layerIndex]
            && liveClipContentsRef.current[pageIdx][layerIndex][colIndex]) {
            const clip = liveClipContentsRef.current[pageIdx][layerIndex][colIndex];
            const nextClip = mutateClip(clip);
            if (nextClip && nextClip !== clip) {
                const newLayer = [...liveClipContentsRef.current[pageIdx][layerIndex]];
                newLayer[colIndex] = nextClip;
                const next = [...liveClipContentsRef.current];
                next[pageIdx] = [...liveClipContentsRef.current[pageIdx].slice(0, layerIndex), newLayer, ...liveClipContentsRef.current[pageIdx].slice(layerIndex + 1)];
                liveClipContentsRef.current = next;
                hasPendingClipUpdate.current = true; // Signal that we have a local update
            }
        }
    }, [state.activePageId]);

    // Assigned-DAC edits: same first-click staleness fix — apply to the live ref
    // immediately (so the DAC list and the delay/chase channel order update on the
    // first interaction), then persist to committed state via the reducer.
    const handleToggleDacMirror = useCallback((lIdx, cIdx, dacIndex, axis) => {
        applyLiveClipMutation(lIdx, cIdx, (clip) => {
            if (!clip || !clip.assignedDacs || !clip.assignedDacs[dacIndex]) return clip;
            const newAssignedDacs = [...clip.assignedDacs];
            const targetDac = { ...newAssignedDacs[dacIndex] };
            if (axis === 'x') targetDac.mirrorX = !targetDac.mirrorX;
            if (axis === 'y') targetDac.mirrorY = !targetDac.mirrorY;
            newAssignedDacs[dacIndex] = targetDac;
            return { ...clip, assignedDacs: newAssignedDacs };
        });
        dispatch({ type: 'TOGGLE_CLIP_DAC_MIRROR', payload: { layerIndex: lIdx, colIndex: cIdx, dacIndex, axis } });
    }, [applyLiveClipMutation, dispatch]);

    const handleRemoveDac = useCallback((dacIndex) => {
        applyLiveClipMutation(selectedLayerIndex, selectedColIndex, (clip) => {
            if (!clip || !clip.assignedDacs || dacIndex >= clip.assignedDacs.length) return clip;
            const newAssignedDacs = [...clip.assignedDacs];
            newAssignedDacs.splice(dacIndex, 1);
            return { ...clip, assignedDacs: newAssignedDacs };
        });
        dispatch({ type: 'REMOVE_CLIP_DAC', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, dacIndex } });
    }, [applyLiveClipMutation, dispatch, selectedLayerIndex, selectedColIndex]);

    const handleReorderDacs = useCallback((lIdx, cIdx, oldIndex, newIndex) => {
        applyLiveClipMutation(lIdx, cIdx, (clip) => {
            if (!clip || !clip.assignedDacs || clip.assignedDacs.length <= 1) return clip;
            const newAssignedDacs = [...clip.assignedDacs];
            if (oldIndex < 0 || oldIndex >= newAssignedDacs.length) return clip;
            const [movedDac] = newAssignedDacs.splice(oldIndex, 1);
            const clampedNew = Math.max(0, Math.min(newIndex, newAssignedDacs.length));
            newAssignedDacs.splice(clampedNew, 0, movedDac);
            return { ...clip, assignedDacs: newAssignedDacs };
        });
        dispatch({ type: 'REORDER_CLIP_DACS', payload: { layerIndex: lIdx, colIndex: cIdx, oldIndex, newIndex } });
    }, [applyLiveClipMutation, dispatch]);

    const handleSetParamSync = useCallback((paramId, syncMode) => {
        const pageIdx = state.activePageId;
        // 1. Direct Live-update for Instant Preview — mirrors handleEffectParameterChange.
        // Without this, the first click would only reach the committed state; the
        // [clipContents] effect syncs the live ref on the NEXT render, but ref mutations
        // never trigger a render, so the EffectEditor keeps showing the stale syncSettings
        // until some other interaction (a second click, or collapsing/toggling the panel)
        // forces a render — the "playback sliders don't start until clicked twice" bug.
        // Update both the ref AND the individual clip object identity immediately. The
        // string/object semantics are mirrored from the SET_CLIP_PARAM_SYNC reducer.
        if (liveClipContentsRef.current && liveClipContentsRef.current[pageIdx]
            && liveClipContentsRef.current[pageIdx][selectedLayerIndex]
            && liveClipContentsRef.current[pageIdx][selectedLayerIndex][selectedColIndex]) {
            const clip = liveClipContentsRef.current[pageIdx][selectedLayerIndex][selectedColIndex];
            if (clip) {
                const currentSync = clip.syncSettings || {};
                let nextSyncValue;
                if (typeof syncMode === 'string') {
                    nextSyncValue = currentSync[paramId] === syncMode ? null : syncMode;
                } else {
                    nextSyncValue = syncMode;
                }
                const newClip = { ...clip, syncSettings: { ...currentSync, [paramId]: nextSyncValue } };
                const newLayer = [...liveClipContentsRef.current[pageIdx][selectedLayerIndex]];
                newLayer[selectedColIndex] = newClip;
                const next = [...liveClipContentsRef.current];
                next[pageIdx] = [...liveClipContentsRef.current[pageIdx].slice(0, selectedLayerIndex), newLayer, ...liveClipContentsRef.current[pageIdx].slice(selectedLayerIndex + 1)];
                liveClipContentsRef.current = next;
                hasPendingClipUpdate.current = true; // Signal that we have a local update
            }
        }
        // 2. Dispatch for State Persistence - DEBOUNCED (leading fires instantly
        // for discrete clicks; a continuous stream only triggers the trailing
        // commit once it rests, keeping re-renders off the DAC loop's thread)
        debouncedDispatch(
            `clip-param-sync-${selectedLayerIndex}-${selectedColIndex}-${paramId}`,
            { type: 'SET_CLIP_PARAM_SYNC', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, paramId, syncMode } }
        );
    }, [debouncedDispatch, selectedLayerIndex, selectedColIndex, state.activePageId]);

    const handleSetLayerParamSync = useCallback((paramId, syncMode) => {
        if (selectedLayerIndex === null) return;
        debouncedDispatch(
            `layer-param-sync-${selectedLayerIndex}-${paramId}`,
            { type: 'SET_LAYER_PARAM_SYNC', payload: { layerIndex: selectedLayerIndex, paramId, syncMode } }
        );
    }, [debouncedDispatch, selectedLayerIndex]);


    // Re-run generator when parameters of the selected clip change - REMOVED TO PREVENT LOOP

    useEffect(() => {
        if (!generatorWorker) return;

        const handleMessage = (e) => {
            if (e.data.browserFile) return;

            const { pageId, layerIndex, colIndex, success, frames, generatorDefinition, currentParams, isLive, isAutoUpdate, seq, isNdi } = e.data;

            // 1. Mark as free and check for pending tasks FIRST
            if (layerIndex !== undefined && colIndex !== undefined) {
                const pId = pageId !== undefined ? pageId : stateRef.current.activePageId;
                const clipKey = `${pId}-${layerIndex}-${colIndex}`;
                generatorProcessingMap.current.set(clipKey, false);

                if (generatorPendingMap.current.has(clipKey)) {
                    const { message, transferables } = generatorPendingMap.current.get(clipKey);
                    generatorPendingMap.current.delete(clipKey);
                    generatorProcessingMap.current.set(clipKey, true);
                    generatorWorker.postMessage(message, transferables);
                }
            }

            if (success) {
                if (layerIndex === undefined || colIndex === undefined) return;
                const pId = pageId !== undefined ? pageId : stateRef.current.activePageId;

                // 2. DISCARD stale responses
                if (seq !== undefined) {
                    const key = `${pId}-${layerIndex}-${colIndex}`;
                    const lastProcessed = latestProcessedSeqRef.current.get(key) || 0;
                    if (seq < lastProcessed) {
                        return;
                    }
                    latestProcessedSeqRef.current.set(key, seq);
                }

                // Update liveFrames ref - MUST be page-aware
                const generatorWorkerId = `generator-${pId}-${layerIndex}-${colIndex}`;
                liveFramesRef.current[generatorWorkerId] = frames[0];

                // 3. Update State only for relevant parameter changes.
                // Commit the LATEST response per clip so a project-load sweep (which bumps
                // the global seq once per clip) can persist frames+thumbnails for EVERY
                // generator clip, while rapid subsequent edits still only commit the last one.
                const commitKey = `${pId}-${layerIndex}-${colIndex}`;
                const lastRequestedSeq = generatorLastRequestedSeqRef.current.get(commitKey);
                if (!isLive && !isAutoUpdate && (lastRequestedSeq === undefined || seq === lastRequestedSeq)) {
                    const clipSource = clipContentsRef.current;
                    const existingClip = clipSource?.[pId]?.[layerIndex]?.[colIndex] || {};

                    const newClipContent = {
                        ...existingClip, // Preserve existing settings (syncSettings, audio, dacs, etc)
                        type: 'generator',
                        generatorDefinition,
                        frames,
                        stillFrame: frames && frames[0] ? frames[0] : existingClip.stillFrame, // Keep existing still if regen is empty
                        currentParams,
                        // Preserve playbackSettings if they exist, otherwise use defaults
                        playbackSettings: existingClip.playbackSettings || {
                            mode: 'fps',
                            duration: frames.length / 60,
                            beats: 8,
                            speedMultiplier: 1
                        },
                    };

                    dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: newClipContent, pageId: pId } });

                    // Create a persistent thumbnail for the generator clip so the grid
                    // has a fast-rendering image that survives project saves/loads.
                    const generatedFrame = frames[0];
                    if (generatedFrame && generatedFrame.points) {
                        generateThumbnail(generatedFrame, existingClip.effects || [], layerIndex, colIndex, optimizationEnabled, pId).then(thumbnailPath => {
                            if (thumbnailPath) {
                                dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { thumbnailPath, thumbnailVersion: Date.now() }, pageId: pId } });
                            }
                        });
                    }

                    // Only update the clip name if it's currently the default name
                    const currentName = clipNamesRef.current[pId]?.[layerIndex]?.[colIndex];
                    const defaultPattern = `Clip ${layerIndex + 1}-${colIndex + 1}`;
                    if (currentName === defaultPattern) {
                        dispatch({ type: 'SET_CLIP_NAME', payload: { layerIndex, colIndex, name: generatorDefinition.name, pageId: pId } });
                    }
                } else if (isNdi) {
                    // If it's a live NDI frame update, signal ready for the next one
                    if (window.electronAPI && window.electronAPI.ndiRendererReady) {
                        window.electronAPI.ndiRendererReady();
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
            const pageIdx = state.activePageId;
            // Initialize prev params to avoid immediate double-regen or diff issues
            const key = `${pageIdx}-${layerIndex}-${colIndex}`;
            const completeParams = { ...generatorDefinition.defaultParams };
            prevGeneratorParamsRef.current.set(key, JSON.stringify(completeParams));

            const seq = ++generatorRequestSeqRef.current;
            regenerateGeneratorClip(layerIndex, colIndex, generatorDefinition, generatorDefinition.defaultParams, seq, false, false, null, null, pageIdx);
        }
    }, [generatorWorker, state.activePageId]);

    const generateLiveFrame = (generatorId, params) => {
        try {
            switch (generatorId) {
                case 'circle': return generateCircle(params);
                case 'square': return generateSquare(params);
                case 'line': return generateLine(params);
                case 'star': return generateStar(params);
                case 'sinewave': return generateSinewave(params);
                default: return null;
            }
        } catch (e) {
            console.error(`Error in synchronous live generation for ${generatorId}:`, e);
            return null;
        }
    };

    const regenerateGeneratorClip = async (layerIndex, colIndex, generatorDefinition, params, seq, isAutoUpdate = false, isLive = false, audioData = null, context = null, pageId = state.activePageId) => {
        // Create a complete params object to ensure stability
        const completeParams = { ...generatorDefinition.defaultParams, ...params };
        const clipKey = `${pageId}-${layerIndex}-${colIndex}`;
        generatorLastRequestedSeqRef.current.set(clipKey, seq);

        let fontBuffer = null;
        let fontUrl = null;
        if (['text', 'ndi-source', 'spout-receiver', 'timer'].includes(generatorDefinition.id)) {
            const defaultFontUrl = 'src/fonts/Geometr415 Blk BT Black.ttf';
            fontUrl = completeParams.fontUrl || defaultFontUrl;

            // Migration for old projects with dead URLs
            const deadUrls = [
                'https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto-Regular.ttf',
                'https://raw.githubusercontent.com/googlefonts/roboto-2/main/src/hinted/Roboto-Regular.ttf'
            ];
            if (deadUrls.includes(fontUrl)) {
                fontUrl = defaultFontUrl;
            }

            // Check cache first
            if (fontBufferCacheRef.current.has(fontUrl)) {
                fontBuffer = fontBufferCacheRef.current.get(fontUrl);
            } else {
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
                    if (fontBuffer) {
                        fontBufferCacheRef.current.set(fontUrl, fontBuffer);
                    }
                } catch (error) {
                    console.error(`Failed to load font for text generator at ${layerIndex}-${colIndex}:`, error);
                    showNotification(`Font error: ${error.message}`);
                    return;
                }
            }
        }

        const message = {
            type: 'generate',
            pageId, // Add pageId
            layerIndex,
            colIndex,
            generator: generatorDefinition,
            params: completeParams, // Pass the complete params
            fontBuffer: (fontUrl && !workerLoadedFontsRef.current.has(fontUrl)) ? fontBuffer : null,
            audioData,
            context,
            seq, // Pass sequence number
            isAutoUpdate,
            isLive
        };

        if (fontUrl && fontBuffer) {
            workerLoadedFontsRef.current.add(fontUrl);
        }

        // We only transfer the buffer if we just loaded it (it's not cached yet)
        // Actually, simpler to never transfer the font buffer as it's small and reusable.
        const transferables = [];

        // Throttling Logic
        if (generatorProcessingMap.current.get(clipKey)) {
            // Worker is busy for this clip, queue this request (replacing any previous pending)
            generatorPendingMap.current.set(clipKey, { message, transferables });
        } else {
            // Worker is free, send immediately
            generatorProcessingMap.current.set(clipKey, true);
            if (generatorWorker) {
                generatorWorker.postMessage(message, transferables);
            }
        }
    };

    const handleDeactivateLayerClips = useCallback((layerIndex) => {
        stopAudio(layerIndex); // Stop audio for this layer
        if (activeClipIndexesRef.current) activeClipIndexesRef.current[layerIndex] = null;
        // Deferred render: the output loop reads the ref (updated above) synchronously,
        // so deferring the UI update keeps keyboard/midi trigger latency low.
        startTransition(() => dispatch({ type: 'DEACTIVATE_LAYER_CLIPS', payload: { layerIndex } }));
    }, [stopAudio]);

    const handleClearAllActive = useCallback(() => {
        stopAllAudio(); // Stop all audio
        if (activeClipIndexesRef.current) activeClipIndexesRef.current.fill(null);
        dispatch({ type: 'CLEAR_ALL_ACTIVE_CLIPS' });
    }, [stopAllAudio]);

    const handlePlay = useCallback(() => {
        // 1. Resume any audio that was already loaded/paused
        resumeAllAudio();

        // 2. Start audio for any active clips that might have been "cued" while transport was stopped
        layers.forEach((_, layerIndex) => {
            const activeInfo = activeClipIndexes[layerIndex];
            if (activeInfo && activeInfo.colIndex !== null) {
                const clip = clipContents[activeInfo.pageId]?.[layerIndex]?.[activeInfo.colIndex];
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
        // Clear delay/chase history so the next play activates cleanly per-channel
        // instead of instantly replaying stale echoes on every DAC.
        effectStatesRef.current.clear();
        if (previewEffectStatesRef.current) previewEffectStatesRef.current.clear();
        dispatch({ type: 'SET_IS_PLAYING', payload: false });
        dispatch({ type: 'SET_IS_STOPPED', payload: true });
        frameIndexesRef.current = {};
        // Stop background render loop
        if (backgroundRafRef.current) {
            cancelAnimationFrame(backgroundRafRef.current);
            backgroundRafRef.current = null;
        }
        backgroundRunningClipsRef.current.clear();
    }, [resetAllAudio, pauseAllAudio]);

    const startBackgroundRenderLoop = useCallback(() => {
        if (backgroundRafRef.current) return; // Already running

        const loop = () => {
            try {
                if (!isPlayingRef.current) {
                // Global playback stopped/paused - clear all background clips
                backgroundRunningClipsRef.current.clear();
                backgroundRafRef.current = null;
                return;
            }

            const clipsToRemove = [];

            for (const bgClip of backgroundRunningClipsRef.current) {
                const { pageIdx, layerIndex, colIndex, workerId } = bgClip;

                // Verify clip still exists and is flash trigger
                const clip = clipContentsRef.current[pageIdx]?.[layerIndex]?.[colIndex];

                if (!clip || clip.triggerStyle !== 'flash' || !clip.frames || clip.frames.length === 0) {
                    clipsToRemove.push(bgClip);
                    continue;
                }

                // Advance released flash clips through the SAME driver the active loop
                // uses so frame indexes, accumulated progress and sync parameter
                // animation stay continuous between flash press/release (matches ILDA).
                // The warm-up only needs the main-thread timing state to keep advancing —
                // skipRegen skips the worker regen + liveFramesRef writes entirely, so a
                // released flash clip stops triggering regens and grid-thumbnail updates
                // for a track that isn't visible on screen.
                if (processClipRef.current) {
                    processClipRef.current(clip, layerIndex, colIndex, workerId, false, performance.now(), true);
                }
            }

            // Remove invalid clips
            clipsToRemove.forEach(clip => {
                backgroundRunningClipsRef.current.delete(clip);
            });

            } catch (err) {
                // Swallow and continue: a single bad background clip must never
                // freeze the released-flash preview render chain.
                console.error('[backgroundFlashLoop] error (kept alive):', err);
            }

            // Continue loop if there are still clips
            if (backgroundRunningClipsRef.current.size > 0) {
                backgroundRafRef.current = requestAnimationFrame(loop);
            } else {
                backgroundRafRef.current = null;
            }
        };

        backgroundRafRef.current = requestAnimationFrame(loop);
    }, []);

    const handleToggleWorldOutput = useCallback(() => {
        const nextActive = !isWorldOutputActive;
        dispatch({ type: 'SET_WORLD_OUTPUT_ACTIVE', payload: nextActive });

        if (nextActive) {
            // A fresh laser-on should ramp the delay/chase channels through their
            // delay order instead of instantly replaying whatever history remains.
            effectStatesRef.current.clear();
            if (previewEffectStatesRef.current) previewEffectStatesRef.current.clear();
        }

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

    const handleClipPreview = useCallback((layerIndex, colIndex) => {
        const pageIdx = stateRef.current.activePageId;
        const clip = clipContentsRef.current[pageIdx]?.[layerIndex]?.[colIndex];
        const hasActualContent = clip && (clip.type === 'ilda' || clip.type === 'generator');

        if (!hasActualContent) return;

        // Remember this clip as the sticky selection for this page:layer so the
        // Clip-Settings panel stays intact when the user later clicks the layer.
        if (!stickyClipColsRef.current[pageIdx]) stickyClipColsRef.current[pageIdx] = {};
        stickyClipColsRef.current[pageIdx][layerIndex] = colIndex;

        startTransition(() => {
            dispatch({ type: 'SET_SELECTED_CLIP', payload: { layerIndex, colIndex } });
            if (clip.type === 'ilda') {
                dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: clip.workerId, totalFrames: clip.totalFrames, generatorId: null, generatorParams: {} } });
            } else if (clip.type === 'generator') {
                const generatorWorkerId = `generator-${pageIdx}-${layerIndex}-${colIndex}`;
                dispatch({ type: 'SET_SELECTED_ILDA_DATA', payload: { workerId: generatorWorkerId, generatorId: clip.generatorDefinition.id, generatorParams: clip.currentParams, totalFrames: clip.frames.length } });
            }
        });
    }, [dispatch]);
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

    const handleLayerIntensityChange = useCallback((layerIndex, intensity) => {
        dispatch({ type: 'SET_LAYER_INTENSITY', payload: { layerIndex, intensity } });
    }, [dispatch]);

    const handleToggleLayerBlackout = useCallback((layerIndex) => {
        dispatch({ type: 'TOGGLE_LAYER_BLACKOUT', payload: { layerIndex } });
    }, [dispatch]);

    const handleToggleLayerSolo = useCallback((layerIndex) => {
        dispatch({ type: 'TOGGLE_LAYER_SOLO', payload: { layerIndex } });
    }, [dispatch]);

    const handleLayerSelect = useCallback((layerIndex) => {
        // Sticky clip selection: selecting a layer highlights the layer for the
        // Layer-Settings tab but keeps the last-selected clip on that layer (if it
        // still has content) so the Clip-Settings panel does not go blank.
        const pageIdx = stateRef.current.activePageId;
        const stickyCol = stickyClipColsRef.current[pageIdx]?.[layerIndex];
        const stickyClip = stickyCol !== undefined ? clipContentsRef.current?.[pageIdx]?.[layerIndex]?.[stickyCol] : null;
        const hasContent = stickyClip && (stickyClip.type === 'ilda' || stickyClip.type === 'generator');
        dispatch({ type: 'SET_SELECTED_CLIP', payload: { layerIndex, colIndex: hasContent ? stickyCol : null } });
    }, [dispatch]);

    const handleActivateClick = useCallback((layerIndex, colIndex, isPress = true) => {
        const pageIdx = stateRef.current.activePageId;
        const clip = clipContentsRef.current[pageIdx]?.[layerIndex]?.[colIndex];
        const hasActualContent = clip && (clip.type === 'ilda' || clip.type === 'generator');

        if (!hasActualContent) {
            if (isPress) {
                handleDeactivateLayerClips(layerIndex);
            }
            return;
        }
        const style = clip.triggerStyle || 'normal';
        const activeInfo = activeClipIndexesRef.current[layerIndex];
        const isCurrentActive = activeInfo && activeInfo.pageId === pageIdx && activeInfo.colIndex === colIndex;
        const clipWorkerId = clip.workerId || (clip.type === 'generator' ? `generator-${pageIdx}-${layerIndex}-${colIndex}` : null);

        // Handle keyboard auto-repeat: don't retrigger if already active and receiving another press.
        // NOTE: 'toggle' is intentionally excluded so a second press on an active toggle clip reaches
        // the deactivate branch below (otherwise the toggle can never be turned off).
        if (isPress && isCurrentActive && (style === 'flash' || style === 'normal' || style === 'temp')) {
            return; // Already active, ignore auto-repeat
        }

        if (style === 'normal') {
            if (!isPress) return;
            // Proceed to activate - reset frame index only on NEW activation
            if (clipWorkerId) frameIndexesRef.current[clipWorkerId] = 0;
        } else if (style === 'toggle') {
            if (!isPress) return;
            if (isCurrentActive) {
                handleDeactivateLayerClips(layerIndex);
                return;
            }
            // Proceed to activate - reset frame index only on NEW activation
            if (clipWorkerId) frameIndexesRef.current[clipWorkerId] = 0;
        } else if (style === 'flash') {
            if (isPress) {
                // Proceed to activate
                // If clip was running in background, remove from background set (match by
                // workerId — entries are object refs, so a fresh object can't Set.delete it).
                if (clipWorkerId) {
                    backgroundRunningClipsRef.current.forEach(entry => {
                        if (entry.workerId === clipWorkerId && entry.pageIdx === pageIdx && entry.layerIndex === layerIndex) {
                            backgroundRunningClipsRef.current.delete(entry);
                        }
                    });
                }
                // Add to active clips (output enabled) - PRESERVE frame index
            } else {
                if (isCurrentActive) {
                    // Option B: Remove from activeClipIndexesRef (stops DAC output), keep frame index running in background
                    if (activeClipIndexesRef.current) activeClipIndexesRef.current[layerIndex] = null;
                    startTransition(() => dispatch({ type: 'SET_ACTIVE_CLIP', payload: { layerIndex, colIndex: null } }));
                    // Add to background running clips if it's an ILDA or generator clip with frames
                    if (clipWorkerId && clip.frames && clip.frames.length > 0) {
                        // Drop any stale entry for this clip first so it can't be advanced
                        // in parallel by the background loop while it is back in the active loop.
                        backgroundRunningClipsRef.current.forEach(entry => {
                            if (entry.workerId === clipWorkerId) backgroundRunningClipsRef.current.delete(entry);
                        });
                        const bgClip = { pageIdx, layerIndex, colIndex, workerId: clipWorkerId };
                        backgroundRunningClipsRef.current.add(bgClip);
                        // Start background render loop if not running
                        if (!backgroundRafRef.current && isPlayingRef.current) {
                            startBackgroundRenderLoop();
                        }
                    }
                }
                return; // CRITICAL: Stop here on release
            }
        } else if (style === 'temp') {
            if (isPress) {
                // Reset frame index to 0 for restart (intended behavior for temp)
                if (clipWorkerId) frameIndexesRef.current[clipWorkerId] = 0;
                // Proceed to activate
            } else {
                if (isCurrentActive) {
                    handleDeactivateLayerClips(layerIndex);
                }
                return;
            }
        }

        // New activation for this layer: reset the delay/chase frame history for this
        // clip's effects (and the layer effects that ride along). Without this, a
        // freshly re-activated clip instantly lights every channel from stale echoes
        // instead of ramping through the channels in delay order.
        if (!isCurrentActive) {
            const delayInstanceIds = new Set();
            const collectDelayIds = (effs) => {
                (effs || []).forEach(eff => {
                    if ((eff.id === 'delay' || eff.id === 'chase') && eff.instanceId) delayInstanceIds.add(eff.instanceId);
                });
            };
            collectDelayIds(clip.effects);
            collectDelayIds(layerEffectsRef.current[layerIndex]);
            delayInstanceIds.forEach(id => {
                effectStatesRef.current.delete(id);
                previewEffectStatesRef.current.delete(id);
            });
        }

        // Common activation logic for all trigger styles (frame index already handled above)
        if (clip && clip.type === 'generator' && clip.frames && clip.frames.length > 0) {
            const generatorWorkerId = `generator-${pageIdx}-${layerIndex}-${colIndex}`;
            // Ensure the frame is in liveFrames so WorldPreview can render it.
            // NOTE: Only seed it if nothing is live yet. The generator worker updates
            // liveFramesRef on EVERY response (even ones whose state commit is dropped by
            // the seq guard / waveform & timer per-frame regens), so an existing entry is
            // always at least as fresh as clip.frames[0]. Overwriting it here would regress
            // the frame to stale STATE data and visually "reset" the beam style mid-delay.
            if (!liveFramesRef.current[generatorWorkerId]) {
                liveFramesRef.current[generatorWorkerId] = clip.frames[0];
            }
            lastFrameFetchTimeRef.current[generatorWorkerId] = performance.now();
            // frameIndexesRef already set above per trigger style
        } else if (clip && clip.type === 'ilda' && clip.workerId) {
            lastFrameFetchTimeRef.current[clip.workerId] = performance.now();
            // frameIndexesRef already set above per trigger style
        }

        // Manage associated audio
        if (clip && clip.audioFile) {
            playAudio(layerIndex, clip.audioFile.path, clip.audioVolume ?? 1.0, isPlayingRef.current).catch(err => {
                console.warn(`Failed to play audio for clip ${pageIdx}-${layerIndex}-${colIndex}:`, err);
                setMissingFiles(prev => {
                    const reqId = `audio-${pageIdx}-${layerIndex}-${colIndex}`;
                    if (prev.some(f => f.requestId === reqId)) return prev;
                    return [...prev, {
                        filePath: clip.audioFile.path,
                        fileName: clip.audioFile.name || clip.audioFile.path.split(/[/\\]/).pop(),
                        requestId: reqId,
                        type: 'audio',
                        pageId: pageIdx
                    }];
                });
            });
        } else {
            stopAudio(layerIndex);
        }

        // Record activation time
        clipActivationTimesRef.current[layerIndex] = performance.now();

        if (activeClipIndexesRef.current) activeClipIndexesRef.current[layerIndex] = { pageId: pageIdx, colIndex };
        // Deferred render: output/audio start from the refs above on the next rAF, so
        // wrapping the UI update in a transition keeps key/midi trigger latency low.
        startTransition(() => dispatch({ type: 'SET_ACTIVE_CLIP', payload: { layerIndex, colIndex } }));

        // Capture still frame for thumbnail
        // NOTE: skipped for FLASH triggers — flash is a momentary action that repeats
        // on every trigger (MIDI pads, repeated clicks), and each press would write a
        // fresh still frame (a full generator frame, up to ~512KB of Float32Array) into
        // Redux state and re-render the whole grid for zero visible benefit.
        if (clip && style !== 'flash') {
            if (clip.type === 'ilda' && clip.workerId) {
                const currentIndex = frameIndexesRef.current[clip.workerId] || 0;
                startTransition(() => dispatch({ type: 'UPDATE_THUMBNAIL', payload: { layerIndex, colIndex, frameIndex: currentIndex } }));
            } else if (clip.type === 'generator' && clip.frames) {
                const currentIdx = frameIndexesRef.current[`generator-${pageIdx}-${layerIndex}-${colIndex}`] || 0;
                const currentFrame = clip.frames[currentIdx % clip.frames.length];
                if (currentFrame) {
                    startTransition(() => dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { stillFrame: currentFrame } } }));
                }
            }
        }
    }, [handleDeactivateLayerClips, playAudio, stopAudio, handleClipPreview]);

    const handleDropEffectOnClip = useCallback((layerIndex, colIndex, effectData) => {
        const pageIdx = state.activePageId;

        // Dedupe: bail if the same effect was just added to this clip (double drop,
        // shared key with the Clip-Settings panel path).
        const nowAdd = Date.now();
        const addKey = `clip:${pageIdx}:${layerIndex}:${colIndex}`;
        const effKey = effectData.id || effectData.name;
        const lastAdd = lastEffectAddRef.current[addKey];
        if (lastAdd && lastAdd.id === effKey && nowAdd - lastAdd.time < 350) return;
        lastEffectAddRef.current[addKey] = { id: effKey, time: nowAdd };

        const newEffectInstance = {
            ...effectData,
            instanceId: generateId(),
            params: { ...effectData.defaultParams }
        };

        // 1. Direct Mutation for Instant Preview (copy arrays, never mutate state aliases)
        if (liveClipContentsRef.current && liveClipContentsRef.current[pageIdx]) {
            const page = liveClipContentsRef.current[pageIdx];
            const oldLayer = page[layerIndex];
            if (oldLayer && oldLayer[colIndex]) {
                const clip = oldLayer[colIndex];
                const newLayer = [...oldLayer];
                newLayer[colIndex] = {
                    ...clip,
                    effects: [...(clip.effects || []), newEffectInstance]
                };
                const next = [...liveClipContentsRef.current];
                next[pageIdx] = [...page.slice(0, layerIndex), newLayer, ...page.slice(layerIndex + 1)];
                liveClipContentsRef.current = next;
                hasPendingClipUpdate.current = true;
            }
        }

        // 2. Dispatch for State Persistence (reuses the instanceId generated above)
        dispatch({ type: 'ADD_CLIP_EFFECT', payload: { layerIndex, colIndex, effect: newEffectInstance } });
    }, [state.activePageId]);

    const handleDropEffectOnLayer = useCallback((layerIndex, effectId) => {
        // Find effect definition
        const effectData = effectDefinitions.find(e => (e.id || e.name) === effectId);
        if (!effectData) return;

        // Dedupe: bail if the same effect was just added to this layer (double drop,
        // shared key with the Layer-Settings panel path).
        const nowAdd = Date.now();
        const addKey = `layer:${layerIndex}`;
        const effKey = effectData.id || effectData.name;
        const lastAdd = lastEffectAddRef.current[addKey];
        const deduped = !!(lastAdd && lastAdd.id === effKey && nowAdd - lastAdd.time < 350);
        if (deduped) return;
        lastEffectAddRef.current[addKey] = { id: effKey, time: nowAdd };
        console.debug('[fx-debug] grid-row-add', Date.now(), addKey, effKey, 'deduped=', deduped);

        const effectInstance = {
            ...effectData,
            instanceId: generateId(),
            params: { ...effectData.defaultParams }
        };

        // 1. Direct live-ref mutation with a NEW array identity so the memo'd
        // LayerSettingsPanel (which reads layerEffectsRef) re-renders NOW.
        if (layerEffectsRef.current) {
            const next = [...layerEffectsRef.current];
            next[layerIndex] = [...(next[layerIndex] || []), effectInstance];
            layerEffectsRef.current = next;
        }

        // 2. Dispatch for State Persistence (reuses the instanceId generated above)
        dispatch({ type: 'ADD_LAYER_EFFECT', payload: { layerIndex, effect: effectInstance } });
    }, [dispatch]);

    const handleDropDac = useCallback((layerIndex, colIndex, dacData) => {
        hasPendingClipUpdate.current = true;
        if (dacData.isGroup) {
            dispatch({ type: 'SET_CLIP_DAC_GROUP', payload: { layerIndex, colIndex, groupDacs: dacData.channels } });
        } else {
            dispatch({ type: 'SET_CLIP_DAC', payload: { layerIndex, colIndex, dac: dacData } });
        }
    }, []);

    const handleDropDacOnLayer = useCallback((layerIndex, dacData) => {
        if (dacData.isGroup) {
            dispatch({ type: 'SET_LAYER_DAC_GROUP', payload: { layerIndex, groupDacs: dacData.channels } });
        } else {
            dispatch({ type: 'SET_LAYER_DAC', payload: { layerIndex, dac: dacData } });
        }
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

    const handleColumnTrigger = useCallback((colIndex) => {
        const pageIdx = stateRef.current.activePageId;
        const clipSource = clipContentsRef.current;
        layers.forEach((_, layerIndex) => {
            const clip = clipSource[pageIdx]?.[layerIndex]?.[colIndex];
            if (!clip || (clip.type !== 'ilda' && clip.type !== 'generator')) {
                handleDeactivateLayerClips(layerIndex);
                return;
            }
            const triggerStyle = clip.triggerStyle || 'normal';
            if (triggerStyle === 'toggle') {
                handleActivateClick(layerIndex, colIndex, true);
            } else if (triggerStyle === 'normal') {
                handleActivateClick(layerIndex, colIndex, true);
            } else if (triggerStyle === 'flash' || triggerStyle === 'temp') {
                handleActivateClick(layerIndex, colIndex, true);
                setTimeout(() => {
                    handleActivateClick(layerIndex, colIndex, false);
                }, 200);
            }
        });
    }, [layers, handleActivateClick, handleDeactivateLayerClips]);

    const handleDacSelected = useCallback((dac) => {
        dispatch({ type: 'SET_SELECTED_DAC', payload: dac });
    }, []);

    const handleDacsDiscovered = useCallback((dacs) => {
        dispatch({ type: 'SET_DACS', payload: dacs });
    }, []);

    const handleApplyDacGroup = useCallback((groupDacs) => {
        if (selectedLayerIndex !== null && selectedColIndex !== null) {
            dispatch({ type: 'SET_CLIP_DAC_GROUP', payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, groupDacs } });
        } else if (selectedLayerIndex !== null) {
            dispatch({ type: 'SET_LAYER_DAC_GROUP', payload: { layerIndex: selectedLayerIndex, groupDacs } });
        } else {
            showNotification("Please select a layer or clip first to apply a DAC group.");
        }
    }, [selectedLayerIndex, selectedColIndex]);

    const handleRegisterPreset = useCallback((type, subType, preset) => {
        dispatch({ type: 'REGISTER_PROJECT_PRESET', payload: { type, subType, preset } });
    }, []);

    const handleGeneratorParameterChange = (paramName, newValue) => {
        const pageIdx = state.activePageId;
        if (selectedLayerIndex !== null && selectedColIndex !== null) {
            let currentClip = null;
            let paramsSource = {};

            // 1. Direct Mutation for Instant Preview & Source of Truth
            if (liveClipContentsRef.current && liveClipContentsRef.current[pageIdx] && liveClipContentsRef.current[pageIdx][selectedLayerIndex] && liveClipContentsRef.current[pageIdx][selectedLayerIndex][selectedColIndex]) {
                const liveClip = liveClipContentsRef.current[pageIdx][selectedLayerIndex][selectedColIndex];
                if (liveClip && liveClip.currentParams) {
                    liveClip.currentParams[paramName] = newValue;
                    hasPendingClipUpdate.current = true;
                    currentClip = liveClip;
                    paramsSource = liveClip.currentParams;
                }
            }

            // Fallback to state if live ref failed (unlikely)
            if (!currentClip) {
                currentClip = clipContents[pageIdx]?.[selectedLayerIndex]?.[selectedColIndex];
                if (currentClip && currentClip.currentParams) {
                    paramsSource = { ...currentClip.currentParams, [paramName]: newValue };
                }
            }

            if (!currentClip || !currentClip.generatorDefinition) return;

            const generatorId = currentClip.generatorDefinition.id;
            const generatorWorkerId = `generator-${pageIdx}-${selectedLayerIndex}-${selectedColIndex}`;

            // 2. Synchronous Live Generation for instant feedback (Only for simple shapes)
            const liveFrame = generateLiveFrame(generatorId, paramsSource);
            if (liveFrame) {
                liveFramesRef.current[generatorWorkerId] = liveFrame;
            }

            // Dispatch the state update (Persistence) - DEBOUNCED
            throttledDispatch(
                `generator-${pageIdx}-${selectedLayerIndex}-${selectedColIndex}-${paramName}`,
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

            // Do NOT pre-seed prevGeneratorParamsRef here: the debounced UPDATE_GENERATOR_PARAM
            // below only writes currentParams into state, not frames. Letting the param-sync
            // effect see the "change" makes it regenerate the clip so state.frames stays in
            // sync with the params (otherwise activation would publish stale frames).

            // Trigger full regeneration in worker
            const seq = ++generatorRequestSeqRef.current;
            regenerateGeneratorClip(selectedLayerIndex, selectedColIndex, currentClip.generatorDefinition, paramsSource, seq, false, true, null, null, pageIdx);
        }
    };
    const handleGeneratorParameterChangeRef = useRef(handleGeneratorParameterChange);
    handleGeneratorParameterChangeRef.current = handleGeneratorParameterChange;

    const selectedClip = selectedLayerIndex !== null && selectedColIndex !== null
        ? clipContents[state.activePageId]?.[selectedLayerIndex]?.[selectedColIndex]
        : null;

    // Live variant for the clip-effects editor: shares the same object the DAC
    // loop and previews read (live ref is mutated in place during param drags),
    // so the editor never lags behind output or snaps back mid-drag.
    const liveSelectedClip = selectedLayerIndex !== null && selectedColIndex !== null
        ? (liveClipContentsRef?.current?.[state.activePageId]?.[selectedLayerIndex]?.[selectedColIndex] || selectedClip)
        : null;

    // Committed-state variant of the selected clip's playback settings, so the
    // Clip Playback UI reflects a change on the FIRST interaction (state updates
    // synchronously with the dispatch render; the live ref only syncs post-commit).
    const committedPlaybackSettings = selectedLayerIndex !== null && selectedColIndex !== null
        ? (state.clipContents?.[state.activePageId]?.[selectedLayerIndex]?.[selectedColIndex]?.playbackSettings)
        : undefined;

    // NDI Lifecycle Management
    useEffect(() => {
        if (!window.electronAPI || !generatorWorker) return;

        const checkNdiClips = async () => {
            // Find any active NDI clip
            let activeNdiClip = null;
            layers.forEach((_, layerIndex) => {
                const activeInfo = activeClipIndexes[layerIndex];
                if (activeInfo && activeInfo.colIndex !== null) {
                    const clip = clipContents[activeInfo.pageId]?.[layerIndex]?.[activeInfo.colIndex];
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
    // Dedicated high-frequency NDI frame handler
    useEffect(() => {
        if (!window.electronAPI || !generatorWorker) return;

        const handleNdiFrame = (frame) => {
            let hasProcessed = false;

            // Forward frame to generator worker for processing
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
                        ndiFrame: frame,
                        isLive: true,
                        isNdi: true // Mark as NDI task
                    });
                    hasProcessed = true;
                }
            });

            // Handle selected clip preview
            if (selectedClipRef.current?.type === 'generator' && selectedClipRef.current?.generatorDefinition?.id === 'ndi-source') {
                generatorWorker.postMessage({
                    type: 'generate',
                    layerIndex: selectedLayerIndexRef.current,
                    colIndex: selectedColIndexRef.current,
                    generator: selectedClipRef.current.generatorDefinition,
                    params: { ...selectedClipRef.current.generatorDefinition.defaultParams, ...selectedClipRef.current.currentParams },
                    ndiFrame: frame,
                    isLive: true,
                    isNdi: true // Mark as NDI task
                });
                hasProcessed = true;
            }

            // CRITICAL: Signal that we are ready for the next frame
            // If we processed any NDI clips, the worker's 'onmessage' listener will call ndiRendererReady
            // once it finishes generating the frame. This provides true back-pressure.
            if (!hasProcessed) {
                window.electronAPI.ndiRendererReady();
            }
        };

        const unsubscribe = window.electronAPI.onNdiFrame(handleNdiFrame);
        return () => unsubscribe();
    }, [generatorWorker]);

    const handleUpdateQuickControl = useCallback((type, index, value) => {
        const collection = type === 'knob' ? 'knobs' : 'buttons';
        const control = state.quickAssigns[collection][index];

        for (const link of getQuickControlLinks(control)) {
            const { layerIndex, colIndex, effectIndex, targetType } = link;
            const paramName = link.paramName || link.paramId;

            let targetValue = value;
            if (type === 'knob' && link.min !== undefined && link.max !== undefined) {
                targetValue = link.min + (value * (link.max - link.min));
                if (link.step) targetValue = Math.round(targetValue / link.step) * link.step;
                targetValue = parseFloat(targetValue.toFixed(5));
            }

            // 1. IMMEDIATE LIVE UPDATES (Non-destructive mutation of refs)
            if (targetType === 'global') {
                if (paramName === 'master_intensity') masterIntensityRef.current = targetValue;
                else if (paramName === 'master_speed') playbackFpsRef.current = targetValue;
            } else if (targetType === 'dac') {
                const dacId = link.dacId;
                if (dacId && liveDacOutputSettingsRef.current) {
                    const cur = liveDacOutputSettingsRef.current[dacId] || (liveDacOutputSettingsRef.current[dacId] = {});
                    cur[paramName] = targetValue;
                    hasPendingDacUpdate.current = true;
                }
            } else if (targetType === 'layerEffect') {
                if (layerEffectsRef.current[layerIndex] && layerEffectsRef.current[layerIndex][effectIndex]) {
                    layerEffectsRef.current[layerIndex][effectIndex].params[paramName] = targetValue;
                    const partner = getLinkedPartnerParam(link.effectId, paramName, layerEffectsRef.current[layerIndex][effectIndex].params);
                    if (partner) layerEffectsRef.current[layerIndex][effectIndex].params[partner] = targetValue;
                }
            } else if (targetType === 'effect' || targetType === 'generator') {
                const pageIdx = link.pageId ?? state.activePageId;
                if (liveClipContentsRef.current && liveClipContentsRef.current[pageIdx] && liveClipContentsRef.current[pageIdx][layerIndex] && liveClipContentsRef.current[pageIdx][layerIndex][colIndex]) {
                    const clip = liveClipContentsRef.current[pageIdx][layerIndex][colIndex];
                    if (targetType === 'effect' && clip.effects && clip.effects[effectIndex]) {
                        clip.effects[effectIndex].params[paramName] = targetValue;
                        const partner = getLinkedPartnerParam(link.effectId, paramName, clip.effects[effectIndex].params);
                        if (partner) clip.effects[effectIndex].params[partner] = targetValue;
                    } else if (targetType === 'generator' && clip.currentParams) {
                        clip.currentParams[paramName] = targetValue;
                    }
                    hasPendingClipUpdate.current = true;
                }
            }
        }

        // 2. DEBOUNCED STATE UPDATE (For UI and persistence)
        // Leading edge fires instantly for a discrete wheel tick; a continuous
        // knob drag only triggers the trailing commit once it rests, keeping
        // re-renders off the main thread (the knob UI itself is ref-driven).
        debouncedDispatch(
            `quick-${type}-${index}`,
            { type: 'UPDATE_QUICK_CONTROL', payload: { type, index, value } }
        );
    }, [state.quickAssigns, debouncedDispatch]);

    const handleToggleQuickButton = useCallback((index) => {
        const btn = state.quickAssigns.buttons[index];
        const links = getQuickControlLinks(btn);
        const newValue = !btn.value;
        const isSingle = links.length === 1;

        for (const link of links) {
            const { layerIndex, colIndex, effectIndex, targetType } = link;
            const paramName = link.paramName || link.paramId;

            if (targetType === 'transport') {
                if (paramName === 'play') handlePlay();
                else if (paramName === 'pause') handlePause();
                else if (paramName === 'stop') handleStop();
                // These functions handle their own dispatch
                if (isSingle) return;
                continue;
            }

            if (targetType === 'global') {
                if (paramName === 'blackout') globalBlackoutRef.current = newValue;
                else if (paramName === 'laser_output') {
                    handleToggleWorldOutput();
                    if (isSingle) return;
                    continue;
                } else if (paramName === 'clear') {
                    handleClearAllActive();
                    if (isSingle) return;
                    continue;
                }
            } else if (targetType === 'layer') {
                if (paramName === 'blackout') layerBlackoutsRef.current[layerIndex] = newValue;
                else if (paramName === 'solo') {
                    layerSolosRef.current.fill(false);
                    layerSolosRef.current[layerIndex] = newValue;
                } else if (paramName === 'autopilot') {
                    layerAutopilotsRef.current[layerIndex] = newValue ? 'forward' : 'off';
                }
            } else if (targetType === 'layerEffect') {
                if (layerEffectsRef.current[layerIndex] && layerEffectsRef.current[layerIndex][effectIndex]) {
                    layerEffectsRef.current[layerIndex][effectIndex].params[paramName] = newValue;
                }
            } else if (targetType === 'effect' || targetType === 'generator') {
                const pageIdx = link.pageId ?? state.activePageId;
                if (liveClipContentsRef.current && liveClipContentsRef.current[pageIdx] && liveClipContentsRef.current[pageIdx][layerIndex] && liveClipContentsRef.current[pageIdx][layerIndex][colIndex]) {
                    const clip = liveClipContentsRef.current[pageIdx][layerIndex][colIndex];
                    if (targetType === 'effect' && clip.effects && clip.effects[effectIndex]) {
                        clip.effects[effectIndex].params[paramName] = newValue;
                    } else if (targetType === 'generator' && clip.currentParams) {
                        clip.currentParams[paramName] = newValue;
                    }
                    hasPendingClipUpdate.current = true;
                }
            }
        }

        dispatch({ type: 'TOGGLE_QUICK_BUTTON', payload: { index } });
    }, [state.quickAssigns, handlePlay, handlePause, handleStop, handleToggleWorldOutput, handleClearAllActive, state.activePageId]);

    const handleTapTempo = useCallback(() => {
        const now = Date.now();
        const times = [...tapTempoTimesRef.current, now].slice(-4);
        tapTempoTimesRef.current = times;

        if (times.length >= 2) {
            let sum = 0;
            for (let i = 1; i < times.length; i++) {
                sum += times[i] - times[i - 1];
            }
            const avgInterval = sum / (times.length - 1);
            const tappedBpm = Math.round(60000 / (avgInterval || 500));
            dispatch({ type: 'SET_BPM', payload: Math.max(1, Math.min(999, tappedBpm)) });
        }
    }, [dispatch]);

    const handleMidiCommand = useCallback((id, value, maxValue = 127, type = 'noteon', assignment = null) => {
        // Basic threshold for button triggers to avoid noise or NoteOff (velocity 0)
        // ALLOW value 0 if it's a clip trigger (to support Flash mode release)
        if (value === 0 && !id.endsWith('_intensity') && id !== 'master_intensity' && id !== 'master_speed' && !id.startsWith('clip_') && id !== 'bpm_value' && id !== 'bpm_fine_up' && id !== 'bpm_fine_down' && id !== 'bpm_tap' && !id.startsWith('quick_') && !id.startsWith('dimmer_') && !id.includes('_item_')) return;

        let normalizedValue = value / maxValue;
        const controlMode = assignment?.controlMode || 'absolute';

        // Process Control Mode (Absolute vs Relative vs Fake Relative)
        if (type === 'controlchange') {
            if (controlMode === 'relative') {
                // APC40 Style Relative (1-10 positive, 127-118 negative)
                let delta = 0;
                if (value <= 10) delta = value * 0.01;
                else if (value >= 118) delta = (value - 128) * 0.01;
                normalizedValue = delta;
            } else if (controlMode === 'fake_relative') {
                const hwKey = assignment?.key || id;
                const lastVal = lastMidiValuesRef.current[hwKey] ?? value;
                lastMidiValuesRef.current[hwKey] = value;
                normalizedValue = (value - lastVal) / maxValue;
            }
        }

        const targetType = assignment?.targetType || 'position';

        // Helper to resolve the final target context (layer/clip)
        const getTargetContext = () => {
            if (targetType === 'selectedLayer') {
                return { layerIndex: selectedLayerIndexRef.current, colIndex: null };
            } else if (targetType === 'thisClip') {
                const parts = id.split('_');
                if (parts[0] === 'clip' && parts.length >= 3) {
                    return { layerIndex: parseInt(parts[1]), colIndex: parseInt(parts[2]) };
                }
            }
            return null;
        };

        const targetContext = getTargetContext();

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
                if (controlMode === 'absolute') masterIntensityRef.current = normalizedValue;
                else masterIntensityRef.current = Math.max(0, Math.min(1, masterIntensityRef.current + normalizedValue));
                throttledDispatch('master_intensity', { type: 'SET_MASTER_INTENSITY', payload: masterIntensityRef.current });
                break;
            case 'blackout_on':
                if (!globalBlackoutRef.current) dispatch({ type: 'TOGGLE_GLOBAL_BLACKOUT' });
                break;
            case 'blackout_off':
                if (globalBlackoutRef.current) dispatch({ type: 'TOGGLE_GLOBAL_BLACKOUT' });
                break;
            case 'master_speed':
                const currentSpeedNorm = (playbackFpsRef.current - 1) / 119;
                let newSpeedNorm = normalizedValue;
                if (controlMode !== 'absolute') newSpeedNorm = Math.max(0, Math.min(1, currentSpeedNorm + normalizedValue));
                const newFps = Math.max(1, Math.round(newSpeedNorm * 119 + 1));
                throttledDispatch('master_speed', { type: 'SET_RENDER_SETTING', payload: { setting: 'playbackFps', value: newFps } });
                break;
            case 'laser_output':
                if (value > 0) dispatch({ type: 'TOGGLE_WORLD_OUTPUT_ACTIVE' });
                break;
            case 'bpm_value':
                if (type === 'controlchange') {
                    let delta = 0;
                    if (controlMode === 'absolute') {
                        // Legacy hardcoded relative behavior for BPM (backward compatibility)
                        if (value <= 10) delta = value;
                        else if (value >= 118) delta = value - 128;
                    } else {
                        delta = Math.round(normalizedValue * 100);
                    }
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
                // Rising edge only: a held button or key auto-repeat must not re-tap.
                if (value > 0 && lastTapMidiValueRef.current <= 0) handleTapTempo();
                lastTapMidiValueRef.current = value;
                break;
            default:
                // Page Selection
                if (id.startsWith('middle_bar_page_')) {
                    if (value > 0) {
                        const pageIdx = parseInt(id.split('_')[3]);
                        dispatch({ type: 'SET_ACTIVE_PAGE', payload: pageIdx });
                    }
                    return;
                }

                // Resolve target based on context if dynamic targeting is active
                let finalId = id;
                let finalLayerIndex = null;
                let finalColIndex = null;

                if (targetContext) {
                    finalLayerIndex = targetContext.layerIndex;
                    finalColIndex = targetContext.colIndex;

                    // Rewrite ID to match the actual target position for the shared logic below
                    if (id.startsWith('layer_') || id.startsWith('clip_')) {
                        const parts = id.split('_');
                        const action = parts[parts.length - 1]; // blackout, solo, intensity, etc
                        if (finalColIndex !== null) {
                            finalId = `clip_${finalLayerIndex}_${finalColIndex}_${action}`;
                        } else {
                            finalId = `layer_${finalLayerIndex}_${action}`;
                        }
                    }
                }

                // 2. Handle Individual Dropdown Item Mapping
                if (finalId.includes('_item_')) {
                    if (value === 0) return;
                    const [baseId, itemValue] = finalId.split('_item_');
                    const parts = baseId.split('_');
                    if (parts.length >= 2 && selectedLayerIndex !== null && selectedColIndex !== null) {
                        const effId = parts[0];
                        const paramId = parts.slice(1).join('_');
                        const clip = clipContents[stateRef.current.activePageId]?.[selectedLayerIndex]?.[selectedColIndex];
                        const effectIndex = clip?.effects?.findIndex(e => e.id === effId);
                        if (effectIndex !== -1) {
                            dispatch({
                                type: 'UPDATE_EFFECT_PARAMETER',
                                payload: { layerIndex: selectedLayerIndex, colIndex: selectedColIndex, effectIndex, paramName: paramId, newValue: itemValue }
                            });
                        }
                    }
                    return;
                }

                // 3. Handle the command using the resolved ID
                if (finalId.startsWith('layer_')) {
                    const parts = finalId.split('_');
                    const layerIdx = parseInt(parts[1]);
                    const action = parts[2]; // 'blackout', 'solo', 'intensity', 'clear'

                    if (action === 'blackout' && value > 0) {
                        dispatch({ type: 'TOGGLE_LAYER_BLACKOUT', payload: { layerIndex: layerIdx } });
                    } else if (action === 'blackout' && parts[3] === 'toggle' && value > 0) {
                        dispatch({ type: 'TOGGLE_LAYER_BLACKOUT', payload: { layerIndex: layerIdx } });
                    } else if (action === 'solo' && value > 0) {
                        dispatch({ type: 'TOGGLE_LAYER_SOLO', payload: { layerIndex: layerIdx } });
                    } else if (action === 'solo' && parts[3] === 'toggle' && value > 0) {
                        dispatch({ type: 'TOGGLE_LAYER_SOLO', payload: { layerIndex: layerIdx } });
                    } else if (action === 'autopilot') {
                        const mode = parts[3];
                        if (mode === 'forward' && value > 0) dispatch({ type: 'SET_LAYER_AUTOPILOT', payload: { layerIndex: layerIdx, mode: 'forward' } });
                        else if (mode === 'off' && value > 0) dispatch({ type: 'SET_LAYER_AUTOPILOT', payload: { layerIndex: layerIdx, mode: 'off' } });
                    } else if (action === 'intensity') {
                        let targetVal = normalizedValue;
                        if (controlMode !== 'absolute') targetVal = Math.max(0, Math.min(1, (layerIntensitiesRef.current[layerIdx] || 0) + normalizedValue));
                        layerIntensitiesRef.current[layerIdx] = targetVal;
                        throttledDispatch(`layer_${layerIdx}_intensity`, { type: 'SET_LAYER_INTENSITY', payload: { layerIndex: layerIdx, intensity: targetVal } });
                    } else if (action === 'clear' && value > 0) {
                        handleDeactivateLayerClips(layerIdx);
                    }
                } else if (finalId.startsWith('clip_')) {
                    const parts = finalId.split('_');
                    const layerIdx = parseInt(parts[1]);
                    const colIdx = parseInt(parts[2]);
                    const action = parts[3]; // 'preview' or undefined (trigger)

                    if (action === 'preview') {
                        if (value > 0) handleClipPreview(layerIdx, colIdx);
                    } else if (action === 'intensity') {
                        dispatch({ type: 'SET_CLIP_INTENSITY', payload: { layerIndex: layerIdx, colIndex: colIdx, intensity: normalizedValue } });
                    } else {
                        handleActivateClick(layerIdx, colIdx, value > 0);
                    }
                } else if (finalId.startsWith('column_')) {
                    const parts = finalId.split('_');
                    const colIdx = parseInt(parts[1]);
                    if (value > 0) {
                        handleColumnTrigger(colIdx);
                    }
                } else if (finalId.startsWith('quick_knob_')) {
                    const index = parseInt(finalId.split('_')[2]);
                    handleUpdateQuickControl('knob', index, normalizedValue);
                } else if (finalId.startsWith('quick_btn_')) {
                    const index = parseInt(finalId.split('_')[2]);
                    if (value > 0) { // Toggle on press
                        handleToggleQuickButton(index);
                    }
                } else if (finalId.startsWith('dimmer_')) {
                    // Reconstruct the key: dimmer_192_168_1_50:1 -> 192.168.1.50:1
                    const cleanId = finalId.replace('dimmer_', '').replace(/_/g, '.');
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
                    const parts = finalId.split('_');
                    if (parts.length >= 2) {
                        if (selectedLayerIndex !== null && selectedColIndex !== null) {
                            const pageIdx = stateRef.current.activePageId;
                            const clip = clipContents[pageIdx]?.[selectedLayerIndex]?.[selectedColIndex];
                            if (clip && clip.effects) {
                                const effId = parts[0];
                                const paramId = parts.slice(1).join('_');

                                const effectIndex = clip.effects.findIndex(e => e.id === effId);
                                if (effectIndex !== -1) {
                                    const def = effectDefinitions.find(d => d.id === effId);
                                    const ctrl = def?.paramControls.find(c => c.id === paramId);

                                    if (ctrl) {
                                        let newValue = normalizedValue;
                                        if (ctrl.type === 'range' || ctrl.type === 'number') {
                                            const currentVal = clip.effects[effectIndex].params[paramId] ?? ctrl.min;
                                            if (controlMode === 'absolute') {
                                                newValue = ctrl.min + (normalizedValue * (ctrl.max - ctrl.min));
                                            } else {
                                                const deltaActual = normalizedValue * (ctrl.max - ctrl.min);
                                                newValue = currentVal + deltaActual;
                                            }
                                            newValue = Math.max(ctrl.min, Math.min(ctrl.max, newValue));
                                            if (ctrl.step) newValue = Math.round(newValue / ctrl.step) * ctrl.step;
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
    }, [handlePlay, handlePause, handleStop, handleClearAllActive, handleDeactivateLayerClips, handlePlaybackFpsChange, state.bpm, state.activePageId, handleClipPreview, handleActivateClick, handleColumnTrigger, clipContents, selectedLayerIndex, selectedColIndex, dacOutputSettings, handleTapTempo]);

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
                            // The worker echoes `filePath` from its request context in the
                            // parse-ilda success message. Passing the relocated path here
                            // lets it update that context, so the clip is NOT reverted to
                            // the old missing path when SET_CLIP_CONTENT runs (which
                            // previously made the RelocateModal reappear every load).
                            filePath: newPath,
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

                // Flatten all clips to iterate easily across all pages
                const allClips = stateRef.current.clipContents.flat(2).filter(c => c);
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

                                    // If it was already missing, we should remove it from missingFiles
                                    setMissingFiles(prev => prev.filter(f => f.filePath !== clip.filePath));
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

                // 3. Timeline project: rewrite ILDA cue + audio paths in the old directory
                const bridge = timelineBridge;
                const tlState = bridge?.stateRef?.current;
                const tlActions = bridge?.actionsRef?.current;
                if (tlState && tlActions) {
                    const channelOrder = tlState.channelOrder || [];
                    for (const chId of channelOrder) {
                        const channel = tlState.channels[chId];
                        for (const cueId of (channel?.cues || [])) {
                            const cue = tlState.cues[cueId];
                            if (!cue || cue.type !== 'ILDA' || !cue.filePath) continue;

                            // The timeline is a SEPARATE store from the main grid, so
                            // the main-grid `processedOldPaths` set must NOT suppress
                            // rewrites here — a file referenced by BOTH the grid and
                            // the timeline used to keep its broken path (skipped by
                            // the old guard), making the RelocateModal reappear for it
                            // on every reload.

                            // The specifically located file itself: bind regardless of name
                            if (cue.filePath === fileEntry.filePath) {
                                const newFileName = getFile(newPath);
                                tlActions.updateCue(cueId, { filePath: newPath, fileName: newFileName });
                                setMissingFiles(prev => prev.filter(f => f.filePath !== cue.filePath));
                                continue;
                            }

                            // Other same-directory timeline ILDA cues
                            if (getDir(cue.filePath) === oldDirectory) {
                                const fileName = getFile(cue.filePath);
                                const potentialPath = `${newDirectory}${sep}${fileName}`;
                                if (cue.filePath !== potentialPath) {
                                    const exists = await window.electronAPI.checkFileExists(potentialPath);
                                    if (exists) {
                                        console.log(`[Relocate] Auto-resolving timeline ILDA: ${fileName}`);
                                        tlActions.updateCue(cueId, { filePath: potentialPath, fileName });
                                        setMissingFiles(prev => prev.filter(f => f.filePath !== cue.filePath));
                                    }
                                }
                            }
                        }
                    }

                    // Timeline audio file in the same directory
                    const tlAudio = tlState.audio;
                    if (tlAudio?.path && getDir(tlAudio.path) === oldDirectory) {
                        const fileName = getFile(tlAudio.path);
                        const potentialPath = `${newDirectory}${sep}${fileName}`;
                        if (tlAudio.path !== potentialPath) {
                            const exists = await window.electronAPI.checkFileExists(potentialPath);
                            if (exists) {
                                console.log(`[Relocate] Auto-resolving timeline audio: ${fileName}`);
                                tlActions.setAudio({ ...tlAudio, path: potentialPath });
                                processedOldPaths.add(tlAudio.path);
                                setMissingFiles(prev => prev.filter(f => f.filePath !== tlAudio.path));
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
        const pageIdx = stateRef.current.activePageId;
        try {
            // Use live ref to get latest clip data if possible
            const clip = clipContentsRef.current[pageIdx]?.[layerIndex]?.[colIndex];
            const thumbPath = clip?.thumbnailPath || 'unknown';
            console.warn(`Thumbnail not found for clip ${pageIdx}-${layerIndex}-${colIndex} (${thumbPath}), requesting regeneration...`);

            if (clip) {
                if (clip.type === 'ilda' && clip.workerId && ildaParserWorker) {
                    const frameIndex = (thumbnailFrameIndexes[pageIdx]?.[layerIndex]?.[colIndex]) || 0;
                    ildaParserWorker.postMessage({
                        type: 'get-frame',
                        workerId: clip.workerId,
                        frameIndex: frameIndex,
                        isStillFrame: true,
                        layerIndex,
                        colIndex,
                        pageId: pageIdx
                    });
                } else if (clip.type === 'ilda' && clip.filePath && ildaParserWorker) {
                    // Older projects load with a stale thumbnailPath but no workerId yet
                    // (LOAD_PROJECT invalidates workerIds and re-parse is scheduled).
                    // Re-queue the parse so the workerBecameValid effect can regenerate
                    // the thumbnail from actual frame data.
                    console.warn(`Thumbnail regeneration: clip ${pageIdx}-${layerIndex}-${colIndex} has no workerId, re-parsing ${clip.filePath} to recreate the thumbnail`);
                    ildaParserWorker.postMessage({
                        type: 'load-and-parse-ilda',
                        fileName: clip.fileName,
                        filePath: clip.filePath,
                        layerIndex,
                        colIndex,
                        pageId: pageIdx
                    });
                } else if (clip.type === 'generator') {
                    const frameForThumbnail = clip.stillFrame || (clip.frames && clip.frames[0]);
                    if (frameForThumbnail && frameForThumbnail.points) {
                        generateThumbnail(frameForThumbnail, clip.effects, layerIndex, colIndex, optimizationEnabled, pageIdx).then(path => {
                            if (path) {
                                dispatch({ type: 'SET_CLIP_CONTENT', payload: { layerIndex, colIndex, content: { thumbnailPath: path, thumbnailVersion: Date.now() }, pageId: pageIdx } });
                            }
                        }).catch(err => console.error(`Thumbnail regeneration failed for generator ${pageIdx}-${layerIndex}-${colIndex}:`, err));
                    } else if (clip.generatorDefinition) {
                        // No still frame available (e.g. right after a project load before
                        // regeneration finished) - rebuild the clip so a thumbnail can exist.
                        console.log(`Regenerating generator clip ${pageIdx}-${layerIndex}-${colIndex} to restore its thumbnail`);
                        const seq = ++generatorRequestSeqRef.current;
                        regenerateGeneratorClip(layerIndex, colIndex, clip.generatorDefinition, clip.currentParams, seq, false, false, null, null, pageIdx);
                    }
                }
            }
        } catch (error) {
            console.error(`Thumbnail regeneration failed for ${pageIdx}-${layerIndex}-${colIndex}:`, error);
        }
    }, [clipContentsRef, thumbnailFrameIndexes, ildaParserWorker, optimizationEnabled, regenerateGeneratorClip]);

    const handleAudioError = useCallback((layerIndex, colIndex) => {
        const pageIdx = stateRef.current.activePageId;
        // Use live ref to get latest clip data if possible
        const clip = clipContentsRef.current[pageIdx]?.[layerIndex]?.[colIndex];

        if (clip && clip.audioFile) {
            setMissingFiles(prev => {
                const reqId = `audio-${pageIdx}-${layerIndex}-${colIndex}`;
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

    const MidiFeedbackHandler = React.memo(({ isPlaying, globalBlackout, layerBlackouts, layerSolos, isWorldOutputActive, clipContents, activeClipIndexes, selectedLayerIndex, selectedColIndex, quickAssigns, activePageId, theme }) => {
        const { sendFeedback } = useMidi();

        useEffect(() => {
            if (!sendFeedback) return;

            const colors = THEME_COLORS[theme] || THEME_COLORS['orange'];

            // 1. Update Clip Feedbacks
            const pageIdx = activePageId;
            layers.forEach((_, layerIndex) => {
                columns.forEach((_, colIndex) => {
                    const controlId = `clip_${layerIndex}_${colIndex}`;
                    const activeInfo = activeClipIndexes[layerIndex];
                    const isActive = activeInfo && activeInfo.pageId === pageIdx && activeInfo.colIndex === colIndex;
                    const isPreviewing = selectedLayerIndex === layerIndex && selectedColIndex === colIndex;
                    const clip = clipContents[pageIdx]?.[layerIndex]?.[colIndex];
                    const hasContent = clip && (clip.type === 'ilda' || clip.type === 'generator');

                    let status = 'empty';
                    if (isActive) status = 'active';
                    else if (isPreviewing) status = 'previewing';
                    else if (hasContent) status = 'inactive';

                    sendFeedback(controlId, isActive, status);
                });
            });

            // 2. Update Transport Feedbacks
            sendFeedback('transport_play', isPlaying ? colors.full : colors.dim);
            sendFeedback('transport_stop', !isPlaying ? colors.full : colors.dim);

            // 3. Update Global Feedbacks
            sendFeedback('blackout', globalBlackout);
            sendFeedback('laser_output', isWorldOutputActive);

            // 4. Update Layer Feedbacks
            layers.forEach((_, layerIndex) => {
                sendFeedback(`layer_${layerIndex}_blackout`, layerBlackouts[layerIndex]);
                sendFeedback(`layer_${layerIndex}_solo`, layerSolos[layerIndex]);
            });

            // 5. Quick Assigns
            if (quickAssigns && quickAssigns.buttons) {
                quickAssigns.buttons.forEach((btn, i) => {
                    sendFeedback(`quick_btn_${i}`, btn.value ? colors.full : 0);
                });
            }

        }, [activeClipIndexes, selectedLayerIndex, selectedColIndex, clipContents, isPlaying, globalBlackout, isWorldOutputActive, layerBlackouts, layerSolos, sendFeedback, quickAssigns, theme]);

        return null;
    });

    // Stable SettingsPanel props: inline handlers/objects here would recreate on
    // every bottomPanelMemo recompute (e.g. a clip uiState collapse), forcing the
    // memoized SettingsPanel to re-render even when its own inputs are unchanged.
    const handleOpenOutputSettings = useCallback(() => setShowOutputSettingsWindow(true), [setShowOutputSettingsWindow]);
    const handleOpenShortcutsSettings = useCallback(() => setShowShortcutsWindow(true), [setShowShortcutsWindow]);
    const handleSetRenderSetting = useCallback((setting, value) => {
        if (setting === 'optimizationEnabled' || setting === 'optimizationMaxDist' || setting === 'optimizationPathDwell') {
            const actionType = `SET_${setting.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
            dispatch({ type: actionType, payload: Number(value) });
        } else {
            dispatch({ type: 'SET_RENDER_SETTING', payload: { setting, value } });
        }
    }, [dispatch]);
    const handleAssignQuickControl = useCallback((type, index, link) => dispatch({ type: 'ASSIGN_QUICK_CONTROL', payload: { type, index, link } }), [dispatch]);
    const handleClearThumbnailCache = useCallback(async () => {
        try {
            const result = await window.electronAPI.clearThumbnailCache();
            if (result.success) {
                console.log(`Cleared ${result.count} cached thumbnails`);
            } else {
                console.error('Failed to clear thumbnail cache:', result.error);
            }
        } catch (e) {
            console.error('Failed to clear thumbnail cache:', e);
        }
    }, []);
    const settingsPanelRenderSettings = useMemo(() => ({
        showBeamEffect,
        beamAlpha,
        fadeAlpha,
        previewScanRate,
        beamRenderMode,
        worldShowBeamEffect,
        worldBeamRenderMode,
        settingsPanelCollapsed: state.settingsPanelCollapsed,
        optimizationEnabled,
        optimizationMaxDist,
        optimizationPathDwell,
        optimizationSettings
    }), [showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, worldShowBeamEffect, worldBeamRenderMode, state.settingsPanelCollapsed, optimizationEnabled, optimizationMaxDist, optimizationPathDwell, optimizationSettings]);

    // Memoized bottom-panel subtree: none of its inputs change on a clip trigger
    // (activation only changes activeClipIndexes), so React reuses this element and
    // skips diffing the entire panel, avoiding a large per-trigger reconcilation.
    const bottomPanelMemo = useMemo(() => (
        <>
            <div className="bottom-panel">
                <div className="bottom-panel-tabs-container-1">
                    <div className="bottom-panel-tabs-1">
                        <button className={`tab-button-1 ${activeBottomTab_1 === 'files' ? 'active' : ''}`} onClick={() => setActiveBottomTab_1('files')}>Files</button>
                        <button className={`tab-button-1 ${activeBottomTab_1 === 'generators' ? 'active' : ''}`} onClick={() => setActiveBottomTab_1('generators')}>Generators</button>
                        <button className={`tab-button-1 ${activeBottomTab_1 === 'effects' ? 'active' : ''}`} onClick={() => setActiveBottomTab_1('effects')}>Effects</button>
                    </div>
                    <div className="bottom-panel-tab-content-1">
                        {activeBottomTab_1 === 'files' && <FileBrowser
                            viewMode={fileBrowserViewMode}
                            onViewModeChange={(mode) => dispatch({ type: 'SET_FILE_BROWSER_VIEW_MODE', payload: mode })}
                            path={fileBrowserPath}
                            onPathChange={(newPath) => dispatch({ type: 'SET_FILE_BROWSER_PATH', payload: newPath })}
                            onDropIld={(layerIndex, colIndex, file) => ildaParserWorker.postMessage({ type: 'parse-ilda', file, layerIndex, colIndex, pageId: activePageId })}
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
                            clip={liveSelectedClip}
                            playbackSettingsOverride={committedPlaybackSettings}
                            uiState={selectedClip?.uiState || {}}
                            audioInfo={getAudioInfo(selectedLayerIndex)}
                            bpm={bpm}
                            getFftLevels={getFftLevels}
                            dacSettings={dacOutputSettings}
                            layerDacs={selectedLayerIndex !== null && layerAssignedDacs ? layerAssignedDacs[selectedLayerIndex] : []}
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
                            onSetParamSync={handleSetParamSync}
                            onToggleDacMirror={handleToggleDacMirror}
                            onRemoveDac={handleRemoveDac}
                            onReorderDacs={handleReorderDacs}
                            onRemoveEffect={handleRemoveEffect}
                            onReorderEffects={handleReorderEffects}
                            onAddEffect={handleAddEffect}
                            onUpdateClipUiState={(layerIndex, colIndex, uiState) => dispatch({ type: 'UPDATE_CLIP_UI_STATE', payload: { layerIndex, colIndex, uiState } })}
                            onParameterChange={handleEffectParameterChange}
                            onGeneratorParameterChange={handleGeneratorParameterChangeRef.current}
                            progressRef={progressRef}
                            onAudioError={handleAudioError}
                            onRegisterPreset={handleRegisterPreset}
                            liveFramesRef={liveFramesRef}
                            activePageId={activePageId}
                        />}
                        {activeBottomTab_2 === 'layer' && <LayerSettingsPanel
                            selectedLayerIndex={selectedLayerIndex}
                            autopilotMode={selectedLayerIndex !== null ? layerAutopilots[selectedLayerIndex] : 'off'}
                            onAutopilotChange={(mode) => dispatch({ type: 'SET_LAYER_AUTOPILOT', payload: { layerIndex: selectedLayerIndex, mode } })}
                            layerEffects={selectedLayerIndex !== null ? (layerEffectsRef.current[selectedLayerIndex] || []) : []}
                            assignedDacs={selectedLayerIndex !== null && layerAssignedDacs ? layerAssignedDacs[selectedLayerIndex] : []}
                            dacSettings={dacOutputSettings}
                            onToggleDacMirror={(layerIndex, dacIndex, axis) => dispatch({ type: 'TOGGLE_LAYER_DAC_MIRROR', payload: { layerIndex, dacIndex, axis } })}
                            onRemoveDac={(layerIndex, dacIndex) => dispatch({ type: 'REMOVE_LAYER_DAC', payload: { layerIndex, dacIndex } })}
                            onReorderDacs={(layerIndex, oldIdx, newIdx) => dispatch({ type: 'REORDER_LAYER_DACS', payload: { layerIndex, oldIndex: oldIdx, newIndex: newIdx } })}
                            onAddEffect={handleAddLayerEffect}
                            onRemoveEffect={handleRemoveLayerEffect}
                            onParamChange={(effectIndex, paramName, val) => selectedLayerIndex !== null && handleLayerEffectParameterChange(selectedLayerIndex, effectIndex, paramName, val)}
                            uiState={selectedLayerIndex !== null ? layerUiStates[selectedLayerIndex] : {}}
                            onUpdateUiState={(uiState) => dispatch({ type: 'UPDATE_LAYER_UI_STATE', payload: { layerIndex: selectedLayerIndex, uiState } })}
                            onRegisterPreset={handleRegisterPreset}
                            effectSpeed={selectedLayerIndex !== null && layerEffectSpeeds ? layerEffectSpeeds[selectedLayerIndex] : null}
                            onEffectSpeedChange={(settings) => selectedLayerIndex !== null && dispatch({ type: 'SET_LAYER_EFFECT_SPEED', payload: { layerIndex: selectedLayerIndex, settings } })}
                            globalBpm={bpm}
                            globalFps={playbackFps}
                            layerSyncSettings={selectedLayerIndex !== null && layerSyncSettings ? layerSyncSettings[selectedLayerIndex] : {}}
                            onSetParamSync={handleSetLayerParamSync}
                            activeClip={selectedLayerActiveClip}
                            activeWorkerId={selectedLayerActiveWorkerId}
                            progressRef={progressRef}
                            getFftLevels={getFftLevels}
                        />}
                    </div>
                </div>

                <DacPanel
                    dacs={dacs}
                    onDacSelected={handleDacSelected}
                    onDacsDiscovered={handleDacsDiscovered}
                    dacSettings={dacOutputSettings}
                    onUpdateDacSettings={handleUpdateDacSettings}
                    onApplyGroup={handleApplyDacGroup}
                />

                <SettingsPanel
                    enabledShortcuts={enabledShortcuts}
                    onOpenOutputSettings={handleOpenOutputSettings}
                    onOpenShortcutsSettings={handleOpenShortcutsSettings}
                    quickAssigns={quickAssigns}
                    renderSettings={settingsPanelRenderSettings}
                    onSetRenderSetting={handleSetRenderSetting}
                    onUpdateKnob={(i, v) => {
                        handleUpdateQuickControl('knob', i, v);
                    }}
                    onToggleButton={(i) => {
                        handleToggleQuickButton(i);
                    }}
                    onAssign={handleAssignQuickControl}
                    onClearThumbnailCache={handleClearThumbnailCache}
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
                    channelPointCountsRef={channelPointCountsRef}
                    dacOutputSettingsRef={dacOutputSettingsRef}
                    liveDacOutputSettingsRef={liveDacOutputSettingsRef}
                    dacs={dacs}
                />
            </div>
        </>
    ), [activeBottomTab_1, activeBottomTab_2, fileBrowserViewMode, fileBrowserPath, ildaParserWorker, activePageId, setActiveBottomTab_1, setActiveBottomTab_2, dispatch, selectedLayerIndex, selectedColIndex, selectedClip, getAudioInfo, bpm, getFftLevels, stopAudio, setClipVolume, handleEffectParameterChange, handleAddEffect, handleRemoveEffect, handleReorderEffects, handleAddLayerEffect, handleRemoveLayerEffect, handleSetParamSync, handleSetLayerParamSync, handleToggleDacMirror, handleRemoveDac, handleReorderDacs, handleAudioError, handleRegisterPreset, liveFramesRef, layerAutopilots, layerEffects, layerUiStates, layerEffectSpeeds, layerSyncSettings, layerAssignedDacs, dacs, dacOutputSettings, handleDacSelected, handleDacsDiscovered, handleUpdateDacSettings, handleApplyDacGroup, enabledShortcuts, quickAssigns, setShowOutputSettingsWindow, setShowShortcutsWindow, showBeamEffect, beamAlpha, fadeAlpha, previewScanRate, beamRenderMode, worldShowBeamEffect, worldBeamRenderMode, state.settingsPanelCollapsed, optimizationEnabled, optimizationMaxDist, optimizationPathDwell, optimizationSettings, handleUpdateQuickControl, handleToggleQuickButton, handleOpenOutputSettings, handleOpenShortcutsSettings, handleSetRenderSetting, handleAssignQuickControl, handleClearThumbnailCache, settingsPanelRenderSettings, playbackFps, progressRef, selectedLayerActiveClip, committedPlaybackSettings, previewFrameCountRef, totalPointsSentRef, activeChannelsCountRef, lastStatUpdateTimeRef]);

    // Memoized middle-bar subtree: none of its inputs change on a clip trigger, so
    // React reuses this element and skips diffing it, reducing per-trigger work.
    const middleBarMemo = useMemo(() => (
        <div className="middle-bar">
            <div className="middle-bar-left-area">
                <BPMControls
                    bpm={bpm}
                    onBpmChange={(newBpm) => dispatch({ type: 'SET_BPM', payload: newBpm })}
                    onTap={handleTapTempo}
                />
            </div>
            <div className="middle-bar-mid-area">
                <div className="page-navigation">
                    {Array.from({ length: numPages || 8 }).map((_, i) => (
                        <Mappable key={i} id={`middle_bar_page_${i}`}>
                            <button
                                className={`page-btn ${activePageId === i ? 'active' : ''}`}
                                onClick={() => dispatch({ type: 'SET_ACTIVE_PAGE', payload: i })}
                                onContextMenu={(e) => { e.preventDefault(); if (window.electronAPI && window.electronAPI.showPageContextMenu) window.electronAPI.showPageContextMenu(i); }}
                                title={pageNames && pageNames[i] ? pageNames[i] : `Page ${i + 1}`}
                                style={{
                                    background: activePageId === i ? 'var(--theme-color)' : '#333',
                                    color: activePageId === i ? '#000' : '#ccc',
                                    border: 'none',
                                    padding: '2px 8px',
                                    margin: '0 2px',
                                    borderRadius: '3px',
                                    fontSize: '11px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    maxWidth: '100%',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                {pageNames && pageNames[i] ? pageNames[i] : i + 1}
                            </button>
                        </Mappable>
                    ))}
                </div>
            </div>
            <div className="middle-bar-right-area">
                <TransportControls
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onStop={handleStop}
                    isPlaying={isPlaying}
                    isStopped={isStopped}
                />
                <MasterSpeedSlider playbackFps={playbackFps} onSpeedChange={handlePlaybackFpsChange} />
            </div>
        </div>
    ), [bpm, dispatch, numPages, activePageId, pageNames, isPlaying, isStopped, playbackFps, handlePlay, handlePause, handleStop, handlePlaybackFpsChange]);

    return (
        <MidiProvider onMidiCommand={handleMidiCommand} theme={theme} enabledShortcuts={enabledShortcuts}>
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
                        selectedLayerIndex={selectedLayerIndex}
                        selectedColIndex={selectedColIndex}
                        quickAssigns={quickAssigns}
                        activePageId={activePageId}
                        theme={theme}
                    />    <MidiMappingOverlay />
                    {currentPage === 'main' ? (
                        <div className="app">
                            <ErrorBoundary>
                                <NotificationPopup message={notification.message} visible={notification.visible} />
                                <AboutWindow
                                    show={showAboutWindow}
                                    onClose={() => setShowAboutWindow(false)}
                                />
                                <OutputSettingsWindow
                                    show={showOutputSettingsWindow}
                                    onClose={() => setShowOutputSettingsWindow(false)}
                                    dacs={dacs}
                                    dacSettings={dacOutputSettings}
                                    onUpdateDacSettings={handleUpdateDacSettings}
                                    sentFramesRef={dacSentFramesRef}
                                />
                                <AudioSettingsWindow
                                    show={showAudioSettingsWindow || showFftSettingsWindow}
                                    onClose={() => { setShowAudioSettingsWindow(false); setShowFftSettingsWindow(false); }}
                                    initialTab={showFftSettingsWindow ? 'fft' : 'output'}
                                />
                                <GeneralSettingsWindow
                                    show={showGeneralSettingsWindow}
                                    onClose={() => setShowGeneralSettingsWindow(false)}
                                />
                                <OutputProcessingWindow
                                    show={showOutputProcessingWindow}
                                    onClose={() => setShowOutputProcessingWindow(false)}
                                    renderSettings={{
                                        optimizationEnabled: optimizationEnabled,
                                        optimizationSettings: optimizationSettings,
                                        layerMergeMode: layerMergeMode
                                    }}
                                    onSetRenderSetting={(setting, value) => {
                                        if (setting === 'optimizationEnabled' || setting === 'optimizationMaxDist' || setting === 'optimizationPathDwell') {
                                            const actionType = `SET_${setting.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
                                            dispatch({ type: actionType, payload: Number(value) });
                                        } else {
                                            dispatch({ type: 'SET_RENDER_SETTING', payload: { setting, value } });
                                        }
                                    }}
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
                                <ClipExportWarningModal
                                    show={!!exportTimingWarning}
                                    mismatchCount={exportTimingWarning?.mismatchCount || 0}
                                    clipSyncMode={exportTimingWarning?.clipSyncMode || 'fps'}
                                    onCancel={exportTimingWarning?.onCancel || (() => {})}
                                    onExportAnyway={exportTimingWarning?.onExportAnyway || (() => {})}
                                    onAutoCorrect={exportTimingWarning?.onAutoCorrect || (() => {})}
                                />
                                <ShortcutsWindow
                                    show={showShortcutsWindow}
                                    onClose={() => setShowShortcutsWindow(false)}
                                    enabledShortcuts={enabledShortcuts}
                                />
                                <div className="main-content">
                                    <div className="top-bar-left-area">
                                        <CompositionControls
                                            masterIntensity={masterIntensity}
                                            onMasterIntensityChange={(value) => { masterIntensityRef.current = value; throttledDispatch('master_intensity', { type: 'SET_MASTER_INTENSITY', payload: value }); }}
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
                                            const activeClipDataForLayer = activeClipsData.find(clip => clip.layerIndex === layerIndex);
                                            const liveFrameForLayer = activeClipDataForLayer ? liveFramesRef.current[activeClipDataForLayer.workerId] : null;
                                            const liveProgressForLayer = (activeClipDataForLayer && activeClipDataForLayer.type === 'generator') ? (progressRef.current[activeClipDataForLayer.workerId] || 0) : 0;

                                            // Layer thumbnail effect timing mirrors the output loop: layer Effect Speed
                                            // duration when configured, otherwise the active clip's playback duration
                                            // (speedMultiplier-adjusted), so sync'd layer/clip effects resolve like output.
                                            const layerClipContent = activeClipDataForLayer ? (clipContents[activeClipDataForLayer.pageId]?.[activeClipDataForLayer.layerIndex]?.[activeClipDataForLayer.colIndex]) : null;
                                            const layerThumbPb = layerClipContent?.playbackSettings || {};
                                            let layerThumbDuration = resolveLayerEffectDuration(
                                                layerEffectSpeeds[layerIndex], bpm, playbackFps, activeClipDataForLayer?.totalFrames
                                            );
                                            if (layerThumbDuration === null) {
                                                if (layerThumbPb.mode === 'timeline') layerThumbDuration = layerThumbPb.duration || 1;
                                                else if (layerThumbPb.mode === 'bpm') layerThumbDuration = ((layerThumbPb.beats || 8) * 60) / (bpm || 120);
                                                else layerThumbDuration = (activeClipDataForLayer?.totalFrames || 30) / (layerThumbPb.fps || activeClipDataForLayer?.fps || playbackFps || 30);
                                                const layerSpeedMult = layerThumbPb.speedMultiplier || 1;
                                                if (layerSpeedMult !== 0) layerThumbDuration /= layerSpeedMult;
                                            }

                                            // Layer thumbnail preview cycle for inactive clips in live render mode,
                                            // timed to the layer's active clip playback speed (same as its thumbnail duration).
                                            const layerCycleFrames = activeClipDataForLayer?.frames || [];
                                            const layerCycleInterval = (layerThumbDuration > 0 && (activeClipDataForLayer?.totalFrames || 30) > 0)
                                                ? (layerThumbDuration * 1000) / (activeClipDataForLayer?.totalFrames || 30)
                                                : 0;

                                            return (
                                                <LayerControls
                                                    key={layerIndex}
                                                    layerName={layerName}
                                                    index={layerIndex}
                                                    onDropEffect={handleDropEffectOnLayer}
                                                    onDropDac={handleDropDacOnLayer}
                                                    layerEffects={layerEffects[layerIndex]}
                                                    layerSyncSettings={layerSyncSettings}
                                                    activeClipData={activeClipDataForLayer}
                                                    liveFrame={liveFrameForLayer}
                                                    liveProgress={liveProgressForLayer}
                                                    thumbnailRenderMode={thumbnailRenderMode} // Add this prop
                                                    thumbBpm={bpm}
                                                    thumbClipDuration={layerThumbDuration}
                                                    fftLevels={fftLevels}
                                                    liveFramesRef={liveFramesRef}
                                                    progressRef={progressRef}
                                                    cycleFrames={layerCycleFrames}
                                                    cycleInterval={layerCycleInterval}
                                                    cycleEnabled={thumbnailRenderMode === 'active' && isPlaying}
                                                    intensity={layerIntensities[layerIndex]}
                                                    onIntensityChange={handleLayerIntensityChange}
                                                    onDeactivateLayerClips={handleDeactivateLayerClips}
                                                    onShowLayerFullContextMenu={handleShowLayerFullContextMenu}
                                                    isBlackout={layerBlackouts[layerIndex]}
                                                    isSolo={layerSolos[layerIndex]}
                                                    onToggleBlackout={handleToggleLayerBlackout}
                                                    onToggleSolo={handleToggleLayerSolo}
                                                    onLayerSelect={handleLayerSelect}
                                                    ildaParserWorker={ildaParserWorker}
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
                                                        const pageIdx = activePageId;
                                                        const currentClipContent = clipContents?.[pageIdx]?.[layerIndex]?.[colIndex];

                                                        // Determine workerId for this clip to fetch frames
                                                        let clipWorkerId = null;
                                                        if (currentClipContent && currentClipContent.type === 'ilda') {
                                                            clipWorkerId = currentClipContent.workerId;
                                                        } else if (currentClipContent && currentClipContent.type === 'generator') {
                                                            clipWorkerId = `generator-${pageIdx}-${layerIndex}-${colIndex}`;
                                                        }

                                                        const clipLiveFrame = clipWorkerId ? liveFramesRef.current[clipWorkerId] : null;
                                                        const clipLiveProgress = (clipWorkerId && currentClipContent?.type === 'generator') ? (progressRef.current[clipWorkerId] || 0) : 0;
                                                        const clipStillFrame = currentClipContent?.stillFrame || (currentClipContent?.type === 'generator' ? currentClipContent.frames?.[0] : null);

                                                        // Clip thumbnail effect timing mirrors the output loop's clip duration so
                                                        // timeline/bpm sync'd effects animate at the same speed as the laser output.
                                                        const clipThumbPb = currentClipContent?.playbackSettings || {};
                                                        let thumbClipDuration = 1;
                                                        if (clipThumbPb.mode === 'timeline') thumbClipDuration = clipThumbPb.duration || 1;
                                                        else if (clipThumbPb.mode === 'bpm') thumbClipDuration = ((clipThumbPb.beats || 8) * 60) / (bpm || 120);
                                                        else thumbClipDuration = (currentClipContent?.totalFrames || currentClipContent?.frames?.length || 30) / (clipThumbPb.fps || currentClipContent?.fps || playbackFps || 30);
                                                        const thumbSpeedMult = clipThumbPb.speedMultiplier || 1;
                                                        if (thumbSpeedMult !== 0) thumbClipDuration /= thumbSpeedMult;

                                                        // Local preview cycle for this clip's thumbnail in live render mode: every clip
                                                        // animates through its own frames at its own playback speed when not actively
                                                        // outputting (live frames take priority over the local cycle).
                                                        const thumbCycleFrames = currentClipContent?.frames || [];
                                                        const thumbCycleInterval = (thumbClipDuration > 0 && (currentClipContent?.totalFrames || thumbCycleFrames.length || 30) > 0)
                                                            ? (thumbClipDuration * 1000) / (currentClipContent?.totalFrames || thumbCycleFrames.length || 30)
                                                            : 0;
                                                        const thumbCycleEnabled = thumbnailRenderMode === 'active' && isPlaying && currentClipContent?.triggerStyle !== 'temp';

                                                        const activeInfo = activeClipIndexes[layerIndex];
                                                        const isActive = activeInfo && activeInfo.pageId === pageIdx && activeInfo.colIndex === colIndex;

                                                        return (
                                                            <Clip
                                                                key={colIndex}
                                                                layerIndex={layerIndex}
                                                                colIndex={colIndex}
                                                                pageId={pageIdx}
                                                                clipName={clipNames?.[pageIdx]?.[layerIndex]?.[colIndex] || `Clip ${layerIndex + 1}-${colIndex + 1}`}
                                                                clipContent={currentClipContent}
                                                                thumbnailFrameIndex={thumbnailFrameIndexes[pageIdx]?.[layerIndex]?.[colIndex] || 0}
                                                                thumbnailRenderMode={thumbnailRenderMode} // Add this prop
                                                                liveFrame={clipLiveFrame} // Add this prop
                                                                liveProgress={clipLiveProgress}
                                                                stillFrame={clipStillFrame} // Add this prop
                                                                liveWorkerId={clipWorkerId}
                                                                liveFramesRef={liveFramesRef}
                                                                progressRef={progressRef}
                                                                thumbBpm={bpm}
                                                                thumbClipDuration={thumbClipDuration}
                                                                fftLevels={fftLevels}
                                                                cycleFrames={thumbCycleFrames}
                                                                cycleInterval={thumbCycleInterval}
                                                                cycleEnabled={thumbCycleEnabled}
                                                                onActivateClick={handleActivateClick}
                                                                isActive={isActive}
                                                                onUnsupportedFile={showNotification}
                                                                onDropEffect={handleDropEffectOnClip}
                                                                onDropGenerator={handleDropGenerator}
                                                                onDropDac={handleDropDac}
                                                                onLabelClick={handleClipPreview}
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
                                        selectedLayerIndex={selectedLayerIndex}
                                        selectedColIndex={selectedColIndex}
                                        liveFramesRef={liveFramesRef}
                                        progressRef={progressRef}
                                        selectedDac={selectedDac}
                                        liveDacOutputSettingsRef={liveDacOutputSettingsRef}
                                        dacOutputSettings={dacOutputSettings}
                                        getAudioInfo={getAudioInfo}
                                        getFftLevels={getFftLevels}
                                        effectStatesRef={effectStatesRef}
                                        previewEffectStatesRef={previewEffectStatesRef}
                                        clipActivationTimesRef={clipActivationTimesRef}
                                        showBeamEffect={showBeamEffect}
                                        beamAlpha={beamAlpha}
                                        fadeAlpha={fadeAlpha}
                                        previewScanRate={previewScanRate}
                                        beamRenderMode={beamRenderMode}
                                        worldShowBeamEffect={worldShowBeamEffect}
                                        worldBeamRenderMode={worldBeamRenderMode}
                                        handleToggleBeamEffect={handleToggleBeamEffect}
                                        handleCycleDisplayMode={handleCycleDisplayMode}
                                        previewFrameCountRef={previewFrameCountRef}
                                        liveClipContentsRef={liveClipContentsRef}
                                        activeClipIndexesRef={activeClipIndexesRef}
                                        layerEffectsRef={layerEffectsRef}
                                        layerEffectSpeedsRef={layerEffectSpeedsRef}
                                        layerSyncSettingsRef={layerSyncSettingsRef}
                                        bpmRef={bpmRef}
                                        playbackFpsRef={playbackFpsRef}
                                        masterIntensityRef={masterIntensityRef}
                                        layerIntensitiesRef={layerIntensitiesRef}
                                        globalBlackoutRef={globalBlackoutRef}
                                        layerSolosRef={layerSolosRef}
                                        layerBlackoutsRef={layerBlackoutsRef}
                                        optimizationEnabled={optimizationEnabled}
                                        activePageId={activePageId}
                                    />
                                    {middleBarMemo}
                                    {bottomPanelMemo}
                                </div>
                            </ErrorBoundary>
                        </div>
                    ) : currentPage === 'shapeBuilder' ? (
                        <>
                            <ShapeBuilder onBack={() => setCurrentPage('main')} />
                            <RelocateModal missingFiles={missingFiles} onRelocate={handleRelocate} onClose={() => setMissingFiles([])} />
                        </>
                    ) : (
                        <>
                            <TimelineEditor onBack={() => setCurrentPage('main')} />
                            <RelocateModal missingFiles={missingFiles} onRelocate={handleRelocate} onClose={() => setMissingFiles([])} />
                        </>
                    )}
                </KeyboardProvider>
            </ArtnetProvider>
        </MidiProvider>
    );
}

export default App;
