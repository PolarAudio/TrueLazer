import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useCallback, useState } from 'react';
import { useAudio } from './AudioContext.jsx';

/**
 * Timeline state + actions for the Timeline Window.
 *
 * Normalized store (no deep nesting — mirrors the spec's "Nested but
 * Normalized" architecture):
 *   channels  { [id]: master channel (route to one DAC channel) }
 *   cues      { [id]: cue block placed on a channel }
 *   lanes     { [id]: automation lane (bezier keyframes) under a channel }
 *   settings  global timeline preferences + UI state
 *
 * Persisted (debounced) to localStorage; hydrated on mount. DAC channels are
 * auto-seeded from discovery on the first open.
 */
const TimelineContext = createContext(null);

export const useTimeline = () => useContext(TimelineContext);

const STORAGE_KEY = 'truelazer:timeline:v1';

const generateId = (prefix = 'tl') =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const DEFAULT_TIMELINE_SETTINGS = Object.freeze({
    bpm: 120,
    timeSignature: { beats: 4, unit: 4 },
    snapMode: 'beat',
    zoom: 50, // px per second
    fps: 30,
    loop: null, // { start, end } | null
    loopEnabled: false,
    selectedCueId: null,
    selectedChannelId: null,
    masterIntensity: 1,
    blackout: false,
    audio: null, // { path, peaks: [{min,max}], duration }
    // Vertical zoom: row heights in px (see timeline/layout.js defaults).
    blockRowH: 46,
    autoRowH: 64,
    // External timecode sync (MTC / MIDI Clock / LTC / ArtNet Timecode).
    sync: { source: 'internal', fps: 30, artnetUniverse: 0, inputDeviceId: '' },
});

export function createInitialTimelineState() {
    return {
        channels: {},
        cues: {},
        lanes: {},
        channelOrder: [],
        settings: { ...DEFAULT_TIMELINE_SETTINGS },
    };
}

/** Current last-end time across all cues (min `floor`). */
export function getTimelineDuration(state, floor = 60) {
    let end = 0;
    for (const id of Object.keys(state.cues || {})) {
        const cue = state.cues[id];
        end = Math.max(end, (cue.startTime || 0) + (cue.duration || 0));
    }
    const audioDur = state.settings?.audio?.duration || 0;
    end = Math.max(end, audioDur);
    return Math.max(floor, end);
}

/**
 * All DAC outputs a channel drives. Zone channels carry a list (`dacs`);
 * legacy single routing is migrated to a one-element list on load.
 */
export function getChannelOutputs(channel) {
    if (!channel) return [];
    const list = Array.isArray(channel.dacs)
        ? channel.dacs
        : channel.dac
            ? [channel.dac]
            : [];
    return list.filter((d) => d && d.ip != null && d.channel != null);
}

/** Look up the first DAC output key (ip:channel), or null if unrouted. */
export function getChannelOutputKey(channel) {
    const out = getChannelOutputs(channel)[0];
    return out ? `${out.ip}:${out.channel}` : null;
}

/** All cues of a channel, sorted by start time. */
export function getSortedCues(state, channelId) {
    const channel = state.channels[channelId];
    if (!channel) return [];
    return channel.cues
        .map((id) => state.cues[id])
        .filter(Boolean)
        .sort((a, b) => a.startTime - b.startTime);
}

/** True when every channel is muted, or at least one solo is active and this channel isn't it. */
export function isChannelAudible(state, channel) {
    if (channel.muted) return false;
    const solos = state.channelOrder.filter((id) => state.channels[id]?.soloed);
    if (solos.length > 0 && !channel.soloed) return false;
    return true;
}

function upsertOrder(order, id) {
    if (order.includes(id)) return order;
    return [...order, id];
}

function removeOrder(order, id) {
    return order.filter((x) => x !== id);
}

function newChannel(id, patch = {}) {
    const entry = Array.isArray(patch.dacs)
        ? patch.dacs
        : patch.dac
            ? [patch.dac]
            : [];
    const dacs = entry
        .filter((d) => d && d.ip != null && d.channel != null)
        .map((d) => ({ ...d, flipX: !!d.flipX, flipY: !!d.flipY }));
    return {
        id,
        name: patch.name || 'New Channel',
        dac: dacs[0] || null,
        dacs,
        cues: [],
        automationLanes: [],
        intensity: 1,
        muted: false,
        soloed: false,
        expanded: true,
        ...patch,
        // `dac` always mirrors the first zone output so legacy readers stay valid.
        dac: dacs[0] || null,
        dacs,
    };
}

function newCue(id, patch = {}) {
    return {
        id,
        channelId: patch.channelId || null,
        type: patch.type || 'GENERATOR',
        name: patch.name || 'New Cue',
        workerId: patch.workerId ?? null,
        totalFrames: patch.totalFrames ?? 0,
        filePath: patch.filePath ?? null,
        fileName: patch.fileName ?? null,
        generatorId: patch.generatorId ?? (patch.type === 'GENERATOR' ? 'circle' : null),
        generatorParams: patch.generatorParams || {},
        startTime: patch.startTime ?? 0,
        duration: patch.duration ?? 5,
        isLooping: patch.isLooping ?? false,
        layerPriority: patch.layerPriority ?? 0,
        effects: patch.effects || [],
        playbackSettings: {
            mode: 'fps',
            duration: 1,
            beats: 8,
            speedMultiplier: 1,
            ...(patch.playbackSettings || {}),
        },
    };
}

function newLane(id, patch = {}) {
    return {
        id,
        channelId: patch.channelId || null,
        targetProperty: patch.targetProperty || 'GEOMETRY_SCALE',
        keyframes: patch.keyframes || [],
        ...patch,
    };
}

/** Merge persisted raw state over the defaults, ignoring unknown shapes. */
export function normalizeHydratedState(raw) {
    const base = createInitialTimelineState();
    if (!raw || typeof raw !== 'object') return base;

    const channels = {};
    const channelOrder = [];
    for (const id of Object.keys(raw.channels || {})) {
        const ch = raw.channels[id];
        if (!ch || !ch.id) continue;
        channels[id] = newChannel(id, {
            ...ch,
            cues: Array.isArray(ch.cues) ? ch.cues.filter((c) => c) : [],
            automationLanes: Array.isArray(ch.automationLanes) ? ch.automationLanes.filter((l) => l) : [],
        });
        channelOrder.push(id);
    }

    const cues = {};
    for (const id of Object.keys(raw.cues || {})) {
        const cue = raw.cues[id];
        if (!cue || !cue.id) continue;
        // workerId is a runtime cache handle owned by the parse worker of the
        // CURRENT session — persisted values are stale after a reload and would
        // make get-frame requests hit missing data. The playback hook re-parses
        // and rebinds fresh handles on load.
        cues[id] = newCue(id, {
            ...cue,
            workerId: cue.type === 'ILDA' ? null : cue.workerId,
        });
    }

    const lanes = {};
    for (const id of Object.keys(raw.lanes || {})) {
        const lane = raw.lanes[id];
        if (!lane || !lane.id) continue;
        lanes[id] = newLane(id, {
            ...lane,
            keyframes: Array.isArray(lane.keyframes) ? lane.keyframes : [],
        });
    }

    return {
        channels,
        cues,
        lanes,
        channelOrder,
        settings: { ...DEFAULT_TIMELINE_SETTINGS, ...(raw.settings || {}) },
    };
}

export function reducer(state, action) {
    switch (action.type) {
        case 'HYDRATE':
            return normalizeHydratedState(action.payload);

        case 'SET_STATE':
            return action.payload || createInitialTimelineState();

        case 'RESET':
            return createInitialTimelineState();

        case 'SEED_CHANNELS': {
            const batch = Array.isArray(action.payload) ? action.payload : [];
            if (batch.length === 0) return state;
            const channels = { ...state.channels };
            let order = [...state.channelOrder];
            let added = 0;
            for (const desc of batch) {
                if (desc.ip == null) continue;
                const key = `${desc.ip}:${desc.channel}`;
                const existing = Object.values(channels).find(
                    (c) => getChannelOutputs(c).some((o) => `${o.ip}:${o.channel}` === key)
                );
                if (existing) continue;
                const id = generateId('ch');
                added++;
                const name = desc.label
                    ? `Channel ${order.length + 1}: ${desc.label}`
                    : `Channel ${order.length + 1}: ${desc.ip} [${desc.channel}]`;
                channels[id] = newChannel(id, {
                    name,
                    dac: {
                        ip: desc.ip,
                        channel: desc.channel,
                        type: desc.type || 'etherdream',
                        label: desc.label || null,
                    },
                });
                order = upsertOrder(order, id);
            }
            if (added === 0) return state;
            return { ...state, channels, channelOrder: order };
        }

        case 'ADD_CHANNEL': {
            const id = action.payload?.id || generateId('ch');
            const channel = newChannel(id, action.payload || {});
            return {
                ...state,
                channels: { ...state.channels, [id]: channel },
                channelOrder: upsertOrder(state.channelOrder, id),
            };
        }

        case 'REMOVE_CHANNEL': {
            const id = action.payload.channelId;
            if (!state.channels[id]) return state;
            const channels = { ...state.channels };
            const cues = { ...state.cues };
            const lanes = { ...state.lanes };
            delete channels[id];
            for (const cueId of state.channels[id].cues || []) delete cues[cueId];
            for (const laneId of state.channels[id].automationLanes || []) delete lanes[laneId];
            return {
                ...state,
                channels,
                cues,
                lanes,
                channelOrder: removeOrder(state.channelOrder, id),
                settings: {
                    ...state.settings,
                    selectedChannelId:
                        state.settings.selectedChannelId === id ? null : state.settings.selectedChannelId,
                },
            };
        }

        case 'RENAME_CHANNEL': {
            const { channelId, name } = action.payload;
            const channel = state.channels[channelId];
            if (!channel) return state;
            return {
                ...state,
                channels: { ...state.channels, [channelId]: { ...channel, name } },
            };
        }

        case 'SET_CHANNEL_DAC': {
            const { channelId, dac } = action.payload;
            const channel = state.channels[channelId];
            if (!channel) return state;
            const dacs = dac
                ? [{ ...dac, flipX: !!dac.flipX, flipY: !!dac.flipY }]
                : [];
            return {
                ...state,
                channels: {
                    ...state.channels,
                    [channelId]: { ...channel, dac: dacs[0] || null, dacs },
                },
            };
        }

        case 'SET_CHANNEL_DACS': {
            const { channelId, dacs } = action.payload;
            const channel = state.channels[channelId];
            if (!channel) return state;
            const list = Array.isArray(dacs)
                ? dacs
                      .filter((d) => d && d.ip != null && d.channel != null)
                      .map((d) => ({ ...d, flipX: !!d.flipX, flipY: !!d.flipY }))
                : [];
            return {
                ...state,
                channels: {
                    ...state.channels,
                    [channelId]: { ...channel, dacs: list, dac: list[0] || null },
                },
            };
        }

        case 'SET_OUTPUT_FLIP': {
            const { channelId, ip, channel, axis } = action.payload;
            const ch = state.channels[channelId];
            if (!ch) return state;
            const field = axis === 'y' ? 'flipY' : 'flipX';
            const dacs = (ch.dacs || []).map((d) =>
                d.ip === ip && d.channel === channel ? { ...d, [field]: !d[field] } : d
            );
            return {
                ...state,
                channels: {
                    ...state.channels,
                    [channelId]: { ...ch, dacs, dac: dacs[0] || null },
                },
            };
        }

        case 'TOGGLE_CHANNEL_MUTE': {
            const channel = state.channels[action.payload.channelId];
            if (!channel) return state;
            return {
                ...state,
                channels: {
                    ...state.channels,
                    [channel.id]: { ...channel, muted: !channel.muted },
                },
            };
        }

        case 'TOGGLE_CHANNEL_SOLO': {
            const channel = state.channels[action.payload.channelId];
            if (!channel) return state;
            return {
                ...state,
                channels: {
                    ...state.channels,
                    [channel.id]: { ...channel, soloed: !channel.soloed },
                },
            };
        }

        case 'SET_CHANNEL_INTENSITY': {
            const channel = state.channels[action.payload.channelId];
            if (!channel) return state;
            return {
                ...state,
                channels: {
                    ...state.channels,
                    [channel.id]: { ...channel, intensity: action.payload.intensity },
                },
            };
        }

        case 'SET_CHANNEL_EXPANDED': {
            const channel = state.channels[action.payload.channelId];
            if (!channel) return state;
            return {
                ...state,
                channels: {
                    ...state.channels,
                    [channel.id]: { ...channel, expanded: action.payload.expanded },
                },
            };
        }

        case 'MOVE_CHANNEL': {
            const { channelId, direction } = action.payload;
            const order = [...state.channelOrder];
            const i = order.indexOf(channelId);
            if (i === -1) return state;
            const j = i + (direction > 0 ? 1 : -1);
            if (j < 0 || j >= order.length) return state;
            [order[i], order[j]] = [order[j], order[i]];
            return { ...state, channelOrder: order };
        }

        case 'ADD_CUE': {
            const channelId = action.payload.channelId;
            const channel = state.channels[channelId];
            if (!channel) return state;
            const id = action.payload.cue?.id || generateId('cue');
            const cue = newCue(id, { ...action.payload.cue, channelId });
            return {
                ...state,
                cues: { ...state.cues, [id]: cue },
                channels: {
                    ...state.channels,
                    [channelId]: { ...channel, cues: upsertOrder(channel.cues, id) },
                },
                settings: {
                    ...state.settings,
                    selectedCueId: id,
                    selectedChannelId: channelId,
                },
            };
        }

        case 'UPDATE_CUE': {
            const cue = state.cues[action.payload.id];
            if (!cue) return state;
            return {
                ...state,
                cues: {
                    ...state.cues,
                    [cue.id]: { ...cue, ...(action.payload.patch || {}) },
                },
            };
        }

        case 'MOVE_CUE': {
            const { id, startTime, channelId } = action.payload;
            const cue = state.cues[id];
            if (!cue) return state;
            const patch = { ...cue, startTime: startTime ?? cue.startTime };

            if (channelId && channelId !== cue.channelId) {
                const from = state.channels[cue.channelId];
                const to = state.channels[channelId];
                if (!from || !to) break;
                const channels = { ...state.channels };
                if (from) {
                    channels[from.id] = {
                        ...from,
                        cues: removeOrder(from.cues, id),
                    };
                }
                if (to) {
                    channels[to.id] = {
                        ...to,
                        cues: upsertOrder(to.cues, id),
                    };
                }
                const next = { ...patch, channelId };
                return {
                    ...state,
                    cues: { ...state.cues, [id]: next },
                    channels,
                };
            }
            return { ...state, cues: { ...state.cues, [id]: patch } };
        }

        case 'RESIZE_CUE': {
            const cue = state.cues[action.payload.id];
            if (!cue) return state;
            const patch = {};
            if (action.payload.startTime != null) patch.startTime = action.payload.startTime;
            if (action.payload.duration != null) patch.duration = Math.max(0.1, action.payload.duration);
            return { ...state, cues: { ...state.cues, [cue.id]: { ...cue, ...patch } } };
        }

        case 'REMOVE_CUE': {
            const id = action.payload.id;
            const cue = state.cues[id];
            if (!cue) return state;
            const cues = { ...state.cues };
            delete cues[id];
            const channel = state.channels[cue.channelId];
            const channels = state.channels;
            const nextChannels = channel
                ? { ...channels, [channel.id]: { ...channel, cues: removeOrder(channel.cues, id) } }
                : channels;
            return {
                ...state,
                cues,
                channels: nextChannels,
                settings: {
                    ...state.settings,
                    selectedCueId: state.settings.selectedCueId === id ? null : state.settings.selectedCueId,
                },
            };
        }

        case 'SELECT': {
            const { cueId, channelId } = action.payload;
            const settings = {
                ...state.settings,
                selectedCueId: cueId ?? null,
                selectedChannelId: channelId ?? state.settings.selectedChannelId ?? null,
            };
            if (cueId && state.cues[cueId]) {
                settings.selectedChannelId = state.cues[cueId].channelId;
            }
            return { ...state, settings };
        }

        case 'ADD_LANE': {
            const channelId = action.payload.channelId;
            const channel = state.channels[channelId];
            if (!channel) return state;
            const id = action.payload.lane?.id || generateId('lane');
            const lane = newLane(id, { ...action.payload.lane, channelId });
            return {
                ...state,
                lanes: { ...state.lanes, [id]: lane },
                channels: {
                    ...state.channels,
                    [channelId]: { ...channel, automationLanes: upsertOrder(channel.automationLanes, id) },
                },
            };
        }

        case 'UPDATE_LANE': {
            const lane = state.lanes[action.payload.laneId];
            if (!lane) return state;
            return {
                ...state,
                lanes: { ...state.lanes, [lane.id]: { ...lane, ...(action.payload.patch || {}) } },
            };
        }

        case 'ADD_KEYFRAME': {
            const lane = state.lanes[action.payload.laneId];
            if (!lane) return state;
            const kf = { id: generateId('kf'), ...action.payload.keyframe };
            const keyframes = [...(lane.keyframes || []), kf];
            return {
                ...state,
                lanes: { ...state.lanes, [lane.id]: { ...lane, keyframes } },
            };
        }

        case 'UPDATE_KEYFRAME': {
            const lane = state.lanes[action.payload.laneId];
            if (!lane) return state;
            const kfId = action.payload.keyframeId;
            const keyframes = (lane.keyframes || []).map((k) =>
                k.id === kfId ? { ...k, ...(action.payload.patch || {}) } : k
            );
            return { ...state, lanes: { ...state.lanes, [lane.id]: { ...lane, keyframes } } };
        }

        case 'REMOVE_KEYFRAME': {
            const lane = state.lanes[action.payload.laneId];
            if (!lane) return state;
            const keyframes = (lane.keyframes || []).filter((k) => k.id !== action.payload.keyframeId);
            return { ...state, lanes: { ...state.lanes, [lane.id]: { ...lane, keyframes } } };
        }

        case 'REMOVE_LANE': {
            const lane = state.lanes[action.payload.laneId];
            if (!lane) return state;
            const lanes = { ...state.lanes };
            delete lanes[lane.id];
            const channel = state.channels[lane.channelId];
            const channels = channel
                ? {
                      ...state.channels,
                      [channel.id]: {
                          ...channel,
                          automationLanes: removeOrder(channel.automationLanes, lane.id),
                      },
                  }
                : state.channels;
            return { ...state, lanes, channels };
        }

        case 'SET_SETTINGS': {
            return {
                ...state,
                settings: {
                    ...state.settings,
                    ...(action.payload || {}),
                    timeSignature: {
                        ...state.settings.timeSignature,
                        ...((action.payload?.timeSignature) || {}),
                    },
                },
            };
        }

        case 'SET_AUDIO': {
            return {
                ...state,
                settings: {
                    ...state.settings,
                    audio: action.payload || null,
                },
            };
        }

        case 'CLEAR_AUDIO':
            return {
                ...state,
                settings: { ...state.settings, audio: null },
            };

        default:
            return state;
    }
}

/** Extract min/max peak bars from a decoded AudioBuffer. */
export function extractAudioPeaks(buffer, barCount = 2000) {
    if (!buffer) return { peaks: [], duration: 0 };
    const channel = buffer.getChannelData(0);
    const duration = buffer.duration;
    const barCountClamped = Math.max(1, Math.floor(barCount));
    const peaks = [];
    const samplesPerBar = Math.max(1, Math.floor(channel.length / barCountClamped));
    for (let i = 0; i < channel.length; i += samplesPerBar) {
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < samplesPerBar && i + j < channel.length; j++) {
            const val = channel[i + j];
            if (val < min) min = val;
            if (val > max) max = val;
        }
        peaks.push({ min, max });
    }
    return { peaks, duration };
}

export const TimelineProvider = ({ children }) => {
    const { audioCtx } = useAudio();
    const [state, baseDispatch] = useReducer(reducer, null, () => createInitialTimelineState());
    const [hydrated, setHydrated] = useState(false);
    const hydrateTimer = useRef(null);
    const [histTick, setHistTick] = useState(0);
    const stateRef = useRef(state);
    stateRef.current = state;
    const historyRef = useRef({ past: [], future: [] });

    // Actions that jump the timeline (not real "edit steps"): transient UI
    // choices (selection, zoom/snap/sync settings) and load-related actions.
    const NON_EDIT_ACTIONS = new Set([
        'SELECT', 'SET_SETTINGS', 'HYDRATE', 'RESET', 'SEED_CHANNELS', 'SET_STATE',
    ]);

    // Coalesce fast successive edit actions of the same type (e.g. drag-based
    // MOVE_CUE/RESIZE_CUE floods) into a single undo step, so a whole drag
    // stanza collapses into one history entry.
    const lastEditRef = useRef({ type: null, at: 0 });

    // Wrap the raw reducer dispatch with a one-level undo/redo history. Every
    // edit action snapshots the pre-edit state so Ctrl+Z / Ctrl+Shift+Z can
    // walk back and forth through edit steps.
    const dispatch = useCallback(
        (action) => {
            const type = action?.type;
            if (!type) { baseDispatch(action); return; }
            if (type === 'RESET' || type === 'HYDRATE') {
                historyRef.current = { past: [], future: [] };
                lastEditRef.current = { type: null, at: 0 };
            }
            if (!NON_EDIT_ACTIONS.has(type)) {
                const h = historyRef.current;
                const last = lastEditRef.current;
                const now = Date.now();
                if (last.type === type && now - last.at < 400 && h.past.length > 0) {
                    h.past[h.past.length - 1] = stateRef.current; // replace snapshot
                } else {
                    h.past.push(stateRef.current);
                    if (h.past.length > 100) h.past.shift();
                }
                last.type = type;
                last.at = now;
                h.future = [];
                setHistTick((t) => t + 1);
            }
            baseDispatch(action);
        },
        []
    );

    const undo = useCallback(() => {
        const h = historyRef.current;
        if (h.past.length === 0) return;
        h.future.push(stateRef.current);
        const prev = h.past.pop();
        setHistTick((t) => t + 1);
        baseDispatch({ type: 'SET_STATE', payload: prev });
    }, []);

    const redo = useCallback(() => {
        const h = historyRef.current;
        if (h.future.length === 0) return;
        h.past.push(stateRef.current);
        const next = h.future.pop();
        setHistTick((t) => t + 1);
        baseDispatch({ type: 'SET_STATE', payload: next });
    }, []);

    const saveProject = useCallback(async (filename = null) => {
        if (!window.electronAPI?.saveTimelineProject) return { success: false };
        return window.electronAPI.saveTimelineProject({
            channels: stateRef.current.channels,
            cues: stateRef.current.cues,
            lanes: stateRef.current.lanes,
            channelOrder: stateRef.current.channelOrder,
            settings: stateRef.current.settings,
        }, filename);
    }, []);

    // Save-as with a name; Ctrl+S uses the current file if one is set, else prompts.
    const saveProjectAs = useCallback(() => saveProject(null), [saveProject]);

    const requestNewProject = useCallback(() => {
        dispatch({ type: 'RESET' });
    }, []);

    const openProject = useCallback(async () => {
        if (!window.electronAPI?.openTimelineProject) return null;
        const data = await window.electronAPI.openTimelineProject();
        if (data) {
            historyRef.current = { past: [], future: [] };
            dispatch({ type: 'HYDRATE', payload: data });
        }
        return data;
    }, []);

    // Hydrate once from localStorage
    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                dispatch({ type: 'HYDRATE', payload: JSON.parse(raw) });
            }
        } catch (e) {
            console.warn('Timeline: failed to hydrate from storage', e);
        }
        setHydrated(true);
    }, []);

    // Debounced persistence
    useEffect(() => {
        if (!hydrated) return;
        if (hydrateTimer.current) clearTimeout(hydrateTimer.current);
        hydrateTimer.current = setTimeout(() => {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            } catch (e) {
                console.warn('Timeline: failed to save to storage', e);
            }
        }, 400);
        return () => {
            if (hydrateTimer.current) clearTimeout(hydrateTimer.current);
        };
    }, [state, hydrated]);

    const discoverAndSeedChannels = useCallback(async () => {
        if (!window.electronAPI) return [];
        try {
            const network = await window.electronAPI.getNetworkInterfaces?.();
            const iface = Array.isArray(network) && network.length > 0 ? network[0] : undefined;
            const discovered = await window.electronAPI.discoverDacs(2000, iface?.address);
            const withServices = await Promise.all(
                (discovered || []).map(async (dac) => {
                    try {
                        const services =
                            dac.type && dac.type.toLowerCase() === 'etherdream'
                                ? await window.electronAPI.getDacServices(dac.ip, iface?.address, dac.type)
                                : (await window.electronAPI.getDacServices(dac.ip, iface?.address, dac.type))
                                      .filter((s) => s.serviceID !== 0);
                        const channelList = (services || []).map((s) => ({
                            ip: dac.ip,
                            channel: s.serviceID ?? 0,
                            type: dac.type,
                            label: s.name || s.serviceName || `${dac.hostName || dac.ip}[${s.serviceID}]`,
                        }));
                        return channelList;
                    } catch (e) {
                        return [];
                    }
                })
            );
            const channels = withServices.flat();
            if (channels.length > 0) {
                dispatch({ type: 'SEED_CHANNELS', payload: channels });
            }
            return channels;
        } catch (e) {
            console.warn('Timeline: DAC discovery failed', e);
            return [];
        }
    }, []);

    // Auto-seed on first open when there is nothing saved yet
    useEffect(() => {
        if (!hydrated) return;
        if (Object.keys(state.channels).length === 0) {
            discoverAndSeedChannels();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hydrated]);

    const loadTimelineAudio = useCallback(
        async (filePath) => {
            if (!filePath) return null;
            if (window.electronAPI?.checkFileExists) {
                const exists = await window.electronAPI.checkFileExists(filePath);
                if (!exists) throw new Error(`Audio file not found: ${filePath}`);
            }
            const res = await fetch(`file:///${filePath}`);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const arrayBuffer = await res.arrayBuffer();

            if (audioCtx) {
                const decoded = await audioCtx.decodeAudioData(arrayBuffer);
                const { peaks, duration } = extractAudioPeaks(decoded);
                const payload = { path: filePath, peaks, duration };
                dispatch({ type: 'SET_AUDIO', payload });
                return payload;
            }
            // No AudioContext yet (no user gesture): store metadata only; peaks
            // render empty until the user replays.
            const payload = { path: filePath, peaks: [], duration: 0 };
            dispatch({ type: 'SET_AUDIO', payload });
            return payload;
        },
        [audioCtx]
    );

    const clearTimelineAudio = useCallback(() => dispatch({ type: 'CLEAR_AUDIO' }), []);

    // Convenience action helpers (components dispatch via named functions like
    // the other context providers).
    const actions = useMemo(
        () => ({
            reset: () => dispatch({ type: 'RESET' }),
            seedChannels: (channels) => dispatch({ type: 'SEED_CHANNELS', payload: channels }),
            addChannel: (patch) => dispatch({ type: 'ADD_CHANNEL', payload: patch }),
            removeChannel: (channelId) => dispatch({ type: 'REMOVE_CHANNEL', payload: { channelId } }),
            renameChannel: (channelId, name) => dispatch({ type: 'RENAME_CHANNEL', payload: { channelId, name } }),
            setChannelDac: (channelId, dac) => dispatch({ type: 'SET_CHANNEL_DAC', payload: { channelId, dac } }),
            setChannelDacs: (channelId, dacs) => dispatch({ type: 'SET_CHANNEL_DACS', payload: { channelId, dacs } }),
            toggleMute: (channelId) => dispatch({ type: 'TOGGLE_CHANNEL_MUTE', payload: { channelId } }),
            toggleSolo: (channelId) => dispatch({ type: 'TOGGLE_CHANNEL_SOLO', payload: { channelId } }),
            setChannelIntensity: (channelId, intensity) => dispatch({ type: 'SET_CHANNEL_INTENSITY', payload: { channelId, intensity } }),
            setChannelExpanded: (channelId, expanded) => dispatch({ type: 'SET_CHANNEL_EXPANDED', payload: { channelId, expanded } }),
            setOutputFlip: (channelId, ip, channel, axis) => dispatch({ type: 'SET_OUTPUT_FLIP', payload: { channelId, ip, channel, axis } }),
            addCue: (channelId, cue) => dispatch({ type: 'ADD_CUE', payload: { channelId, cue } }),
            updateCue: (id, patch) => dispatch({ type: 'UPDATE_CUE', payload: { id, patch } }),
            moveCue: (id, channelId, startTime) => dispatch({ type: 'MOVE_CUE', payload: { id, channelId, startTime } }),
            resizeCue: (id, startTime, duration) => dispatch({ type: 'RESIZE_CUE', payload: { id, startTime, duration } }),
            removeCue: (id) => dispatch({ type: 'REMOVE_CUE', payload: { id } }),
            select: (cueId, channelId) => dispatch({ type: 'SELECT', payload: { cueId, channelId } }),
            addLane: (channelId, lane) => dispatch({ type: 'ADD_LANE', payload: { channelId, lane } }),
            updateLane: (laneId, patch) => dispatch({ type: 'UPDATE_LANE', payload: { laneId, patch } }),
            addKeyframe: (laneId, keyframe) => dispatch({ type: 'ADD_KEYFRAME', payload: { laneId, keyframe } }),
            updateKeyframe: (laneId, keyframeId, patch) => dispatch({ type: 'UPDATE_KEYFRAME', payload: { laneId, keyframeId, patch } }),
            removeKeyframe: (laneId, keyframeId) => dispatch({ type: 'REMOVE_KEYFRAME', payload: { laneId, keyframeId } }),
            removeLane: (laneId) => dispatch({ type: 'REMOVE_LANE', payload: { laneId } }),
            setSettings: (patch) => dispatch({ type: 'SET_SETTINGS', payload: patch }),
            setAudio: (payload) => dispatch({ type: 'SET_AUDIO', payload }),
            clearAudio: clearTimelineAudio,
            moveChannel: (channelId, direction) => dispatch({ type: 'MOVE_CHANNEL', payload: { channelId, direction } }),
            undo,
            redo,
            saveProject,
            saveProjectAs,
            openProject,
            newProject: requestNewProject,
        }),
        [clearTimelineAudio, undo, redo, saveProject, saveProjectAs, openProject, requestNewProject]
    );

    const value = useMemo(
        () => ({
            state,
            dispatch,
            actions,
            canUndo: historyRef.current.past.length > 0,
            canRedo: historyRef.current.future.length > 0,
            histTick,
            discoverAndSeedChannels,
            loadTimelineAudio,
        }),
        [state, actions, histTick, discoverAndSeedChannels, loadTimelineAudio]
    );

    return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
};

export default TimelineContext;