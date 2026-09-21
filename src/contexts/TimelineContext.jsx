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

// Module-level bridge: lets the App shell (which must NOT subscribe to the whole
// timeline state — that would re-render the entire grid on every timeline edit)
// reach the timeline project state/actions inside the shared RelocateModal
// handler. The provider refreshes these refs whenever state/actions change.
export const timelineBridge = { stateRef: null, actionsRef: null };

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
    // Multi-clip selection; `selectedCueId` is kept as the anchor (last
    // toggled) for the inspector/preview. Both are patched together by
    // SELECT so they never disagree.
    selectedCueIds: [],
    // Selected automation keyframe: { laneId, keyframeId } | null. Mirrors cue
    // selection so the Delete key and right-click menu know what to remove.
    selectedKeyframe: null,
    // Selected automation track (lane) itself — set by clicking a lane header,
    // or implicitly when a keyframe on the lane is selected. Lets the Inspector
    // show which of the linked effect's settings can NOT be automated.
    selectedLaneId: null,
    // Selected automation CLIP: { laneId, clipId } | null. Mirrors keyframe
    // selection so the Delete key and clip copy/paste know what to act on.
    selectedAutoClip: null,
    // Multi automation CLIP selection from a drag-select marquee. Each entry is
    // { laneId, clipId }. `selectedAutoClip` is kept as the anchor (last
    // picked) so the Inspector/panel continue to work unchanged.
    selectedAutoClipIds: [],
    selectedChannelId: null,
    masterIntensity: 1,
    blackout: false,
    audio: null, // { path, peaks: [{min,max}], duration }
    // Vertical zoom: row heights in px (see timeline/layout.js defaults).
    blockRowH: 46,
    autoRowH: 64,
    // External timecode sync (MTC / MIDI Clock / LTC / ArtNet Timecode).
    sync: { source: 'internal', fps: 30, artnetUniverse: 0, inputDeviceId: '' },
    // Clip resize behaviour: false = "Stretch" (current, overlaps allowed),
    // true = "Trim" (resizing clamps to the neighbouring cue so clips can
    // never be dragged over one another).
    clipEditTrim: false,
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
    // deduplicate by ip:channel, keep first occurrence
    const seen = new Set();
    return list.filter((d) => {
        if (!d || d.ip == null || d.channel == null) return false;
        const key = `${d.ip}:${d.channel}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Look up the first DAC output key (ip:channel), or null if unrouted. */
export function getChannelOutputKey(channel) {
    const out = getChannelOutputs(channel)[0];
    return out ? `${out.ip}:${out.channel}` : null;
}

/**
 * Channel name shown in the timeline, honoring the name the user set for the
 * DAC output in the main app (Output Settings). A single-output channel that
 * still carries its auto-seeded default name (e.g. "Channel 1: …") shows the
 * main-app name; manually renamed channels keep their timeline name, and
 * unrouted or multi-output (zone) channels keep their own label.
 */
export function getChannelDisplayName(channel, dacOutputSettings) {
    if (!channel) return '';
    const outputs = getChannelOutputs(channel);
    const custom =
        outputs.length === 1 && dacOutputSettings
            ? dacOutputSettings[`${outputs[0].ip}:${outputs[0].channel}`]?.name
            : null;
    const isAutoSeeded = /^Channel \d+:/.test(channel.name || '');
    if (custom && String(custom).trim() && isAutoSeeded) return String(custom).trim();
    return channel.name || 'Channel';
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

/**
 * Ids of every cue that overlaps ANOTHER cue on the same channel. A cue
 * "overlaps" when a neighbour starts strictly before its end; a looping cue
 * never ends, so it overlaps every cue that starts after it. The frontend uses
 * this to paint overlapping clips red (they silently shadow one another: the
 * frame compiler picks a single deterministic winner per channel — see
 * selectActiveCue).
 */
export function getOverlappingCueIds(state) {
    const ids = new Set();
    const groups = new Map();
    for (const id of Object.keys(state.cues || {})) {
        const c = state.cues[id];
        if (!c || !c.channelId) continue;
        if (!groups.has(c.channelId)) groups.set(c.channelId, []);
        groups.get(c.channelId).push(c);
    }
    for (const list of groups.values()) {
        const sorted = [...list].sort((a, b) => (a.startTime - b.startTime) || (a.id < b.id ? -1 : 1));
        for (let i = 0; i < sorted.length; i++) {
            const a = sorted[i];
            const aEnd = a.isLooping ? Infinity : a.startTime + (a.duration || 0);
            for (let j = i + 1; j < sorted.length; j++) {
                const b = sorted[j];
                if (b.startTime >= aEnd - 1e-6) break;
                ids.add(a.id);
                ids.add(b.id);
            }
        }
    }
    return ids;
}

/**
 * Closest neighbours of `cueId` on its channel: the maximum end time of any
 * sibling starting at-or-before this cue (`prevEnd`) and the FIRST start time
 * strictly after it (`nextStart`). Either may be null. These are the hard
 * edges a "Trim" resize must not cross.
 */
export function getAdjacentCues(state, cueId) {
    const cue = state.cues[cueId];
    if (!cue || !cue.channelId) return { prevEnd: null, nextStart: null };
    let prevEnd = null;
    let nextStart = null;
    for (const id of Object.keys(state.cues || {})) {
        const c = state.cues[id];
        if (!c || c.id === cueId || c.channelId !== cue.channelId) continue;
        if (c.startTime <= cue.startTime + 1e-9) {
            const end = c.startTime + (c.duration || 0);
            if (prevEnd === null || end > prevEnd) prevEnd = end;
        } else if (nextStart === null || c.startTime < nextStart) {
            nextStart = c.startTime;
        }
    }
    return { prevEnd, nextStart };
}

/**
 * Compute the minimal cuts that remove every overlap among the given cues (or
 * ALL cues when `ids` is null). For each overlapping pair on a channel the
 * EARLIER cue is trimmed so it ends exactly where the next cue starts, and a
 * looping cue is un-looped (an endless loop would otherwise outlive its cut).
 * Returns a Map cueId -> { duration, isLooping? }. Pure; the caller dispatches.
 */
export function computeOverlapTrims(state, ids) {
    const trims = new Map();
    const wanted = ids ? new Set(ids) : null;
    const groups = new Map();
    for (const cueId of Object.keys(state.cues || {})) {
        const c = state.cues[cueId];
        if (!c || !c.channelId) continue;
        if (!groups.has(c.channelId)) groups.set(c.channelId, []);
        groups.get(c.channelId).push(c);
    }
    const MIN_DUR = 0.1;
    for (const list of groups.values()) {
        const sorted = [...list].sort((a, b) => (a.startTime - b.startTime) || (a.id < b.id ? -1 : 1));
        for (let i = 0; i < sorted.length - 1; i++) {
            const cur = sorted[i];
            // Same-start siblings fully coincide; layerPriority resolves them
            // and trimming one to a zero-width sliver would be destructive.
            const next = sorted[i + 1];
            if (next.startTime <= cur.startTime + 1e-9) continue;
            if (wanted && !wanted.has(cur.id)) continue;
            const boundary = next.startTime;
            // A looping cue never ends on its own — it shadows EVERY later cue,
            // even when its recorded duration would end before the next one. So
            // it is treated as overlapping for the cut (trimmed + un-looped),
            // matching getOverlappingCueIds which paints it red for the same
            // reason. Without this Cut Overlaps left looping clips highlighted.
            const curEnd = cur.isLooping ? Infinity : cur.startTime + (cur.duration || 0);
            if (curEnd <= boundary + 1e-6) continue;
            const patch = {};
            const newDur = Math.round((boundary - cur.startTime) * 1000) / 1000;
            if (cur.isLooping) patch.isLooping = false;
            if (newDur < (cur.duration || 0) - 1e-9) patch.duration = Math.max(MIN_DUR, newDur);
            if (Object.keys(patch).length > 0) trims.set(cur.id, patch);
        }
    }
    return trims;
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
        // Per-clip overrides for the channel's effect-lane toggle settings that
        // curves can't drive (selects / checkboxes / color / text). Keyed by
        // effect id → param id → value; only non-range params are honored at
        // compile time.
        effectOverrides: patch.effectOverrides || {},
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
    const laneTarget = {
        effectId: patch.effectId || null,
        paramId: patch.paramId || null,
        genId: patch.genId || null,
        genParamId: patch.genParamId || null,
        targetProperty: patch.targetProperty || null,
    };
    // FL-style automation clips: short curve segments on the lane that can be
    // moved/trimmed/copied independently. Keyframe `time` values are RELATIVE
    // to the clip's start. Each clip targets its OWN effect param / generator
    // param / legacy scalar and carries per-clip static settings (`values`).
    // Clips that predate the per-clip model inherit the lane's target fields.
    const { clips: rawClips, ...rest } = patch;
    const clips = (Array.isArray(rawClips) ? rawClips : []).map((c) => ({
        ...c,
        startTime: c.startTime ?? 0,
        duration: c.duration ?? 4,
        keyframes: Array.isArray(c.keyframes) ? c.keyframes : [],
        values: c.values || {},
        effectId: c.effectId ?? laneTarget.effectId,
        paramId: c.paramId ?? laneTarget.paramId,
        genId: c.genId ?? laneTarget.genId,
        genParamId: c.genParamId ?? laneTarget.genParamId,
        targetProperty: c.targetProperty ?? laneTarget.targetProperty,
    }));
    return {
        id,
        channelId: patch.channelId || null,
        ...laneTarget,
        keyframes: patch.keyframes || [],
        clips,
        ...rest,
    };
}

/** Lazily resolve the automation clip that owns a keyframe id (or null). */
function clipOwningKeyframe(lane, keyframeId) {
    if (!lane || !Array.isArray(lane.clips)) return null;
    return lane.clips.find((c) => (c.keyframes || []).some((k) => k.id === keyframeId)) || null;
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
            clips: Array.isArray(lane.clips) ? lane.clips : [],
            keyframes: Array.isArray(lane.keyframes) ? lane.keyframes : [],
        });
    }

    // Legacy lanes stored their whole curve under a top-level `keyframes` array.
    // Migrate them into one automation clip spanning the timeline so the
    // multi-clip model is the only shape evaluation/rendering needs to handle.
    const timelineEnd = Object.keys(cues).reduce(
        (m, id) => Math.max(m, (cues[id]?.startTime || 0) + (cues[id]?.duration || 0)),
        0
    );
    for (const id of Object.keys(lanes)) {
        const lane = lanes[id];
        const hasClips = Array.isArray(lane.clips) && lane.clips.length > 0;
        const legacyKeys = Array.isArray(lane.keyframes) ? lane.keyframes : [];
        // Clips saved before the per-clip target model may not carry their own
        // effect/gen/legacy link yet. Backfill each clip from the lane's target
        // fields so evaluation/rendering always see a normalized clip shape.
        const stampClip = (c) => ({
            ...c,
            startTime: c.startTime ?? 0,
            duration: c.duration ?? Math.max(8, timelineEnd + 4),
            keyframes: Array.isArray(c.keyframes) ? c.keyframes : [],
            values: c.values || {},
            effectId: c.effectId ?? lane.effectId ?? null,
            paramId: c.paramId ?? lane.paramId ?? null,
            genId: c.genId ?? lane.genId ?? null,
            genParamId: c.genParamId ?? lane.genParamId ?? null,
            targetProperty: c.targetProperty ?? lane.targetProperty ?? null,
        });
        if (!hasClips && legacyKeys.length > 0) {
            lanes[id] = {
                ...lane,
                clips: [stampClip({
                    id: generateId('acp'),
                    startTime: 0,
                    duration: Math.max(8, timelineEnd + 4),
                    keyframes: legacyKeys,
                })],
            };
        } else if (hasClips) {
            lanes[id] = { ...lane, clips: lane.clips.map(stampClip) };
        }
    }

    const rawSettings = raw.settings || {};
    const settings = { ...DEFAULT_TIMELINE_SETTINGS, ...rawSettings };
    // Legacy persistence: only a single selectedCueId exists. Adopt it as the
    // sole member of the new selection array (otherwise the default empty
    // array would silently shadow a real selection).
    if (!Array.isArray(rawSettings.selectedCueIds)) {
        settings.selectedCueIds = rawSettings.selectedCueId != null ? [rawSettings.selectedCueId] : [];
    }
    if (!Array.isArray(settings.selectedCueIds)) settings.selectedCueIds = [];

    // Keyframe selection is transient UI state; never trust a persisted shape.
    if (!settings.selectedKeyframe || typeof settings.selectedKeyframe !== 'object') {
        settings.selectedKeyframe = null;
    }
    // Same for the lane (track) selection: transient, derived from lane ids.
    if (typeof settings.selectedLaneId !== 'string' || !settings.selectedLaneId) {
        settings.selectedLaneId = null;
    }
    // Automation-clip selection is transient UI state; never trust a persisted shape.
    settings.selectedAutoClip = null;
    settings.selectedAutoClipIds = [];

    return {
        channels,
        cues,
        lanes,
        channelOrder,
        settings,
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
                    selectedCueIds: [id],
                    selectedChannelId: channelId,
                    // Picking a clip moves the Inspector focus back to the clip.
                    selectedKeyframe: null,
                    selectedLaneId: null,
                    selectedAutoClip: null,
                    selectedAutoClipIds: [],
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
            // Drop the removed cue from the selection; the anchor becomes the
            // last remaining sibling (or null when the selection emptied).
            const cur = Array.isArray(state.settings.selectedCueIds) ? state.settings.selectedCueIds : [];
            const next = cur.filter((x) => x !== id);
            const selectedCueId = next.length > 0
                ? (state.settings.selectedCueId === id ? next[next.length - 1] : state.settings.selectedCueId)
                : null;
            return {
                ...state,
                cues,
                channels: nextChannels,
                settings: {
                    ...state.settings,
                    selectedCueIds: next,
                    selectedCueId,
                },
            };
        }

        case 'SELECT': {
            const { cueId, channelId, additive } = action.payload;
            const settings = { ...state.settings };
            // Selecting a clip/canvas moves Inspector focus off the automation
            // track (a keyframe selection, being more specific, is preserved).
            settings.selectedLaneId = null;
            settings.selectedAutoClip = null;
            settings.selectedAutoClipIds = [];
            const cur = Array.isArray(settings.selectedCueIds)
                ? settings.selectedCueIds
                : (settings.selectedCueId != null ? [settings.selectedCueId] : []);

            if (additive) {
                // Toggle membership (Shift/Ctrl + click); a null cue clears the
                // whole selection (clicking an empty lane / the canvas).
                if (!cueId) {
                    settings.selectedCueIds = [];
                    settings.selectedCueId = null;
                    settings.selectedChannelId = channelId ?? settings.selectedChannelId ?? null;
                } else if (cur.includes(cueId)) {
                    const next = cur.filter((x) => x !== cueId);
                    settings.selectedCueIds = next;
                    settings.selectedCueId = next.length ? next[next.length - 1] : null;
                    settings.selectedChannelId = state.cues[cueId]?.channelId ?? settings.selectedChannelId ?? null;
                } else {
                    settings.selectedCueIds = [...cur, cueId];
                    settings.selectedCueId = cueId;
                    settings.selectedChannelId = state.cues[cueId]?.channelId ?? settings.selectedChannelId ?? null;
                }
            } else if (cueId && state.cues[cueId]) {
                settings.selectedCueIds = [cueId];
                settings.selectedCueId = cueId;
                settings.selectedChannelId = state.cues[cueId].channelId;
            } else {
                settings.selectedCueIds = [];
                settings.selectedCueId = null;
                settings.selectedChannelId = channelId ?? settings.selectedChannelId ?? null;
            }
            return { ...state, settings };
        }

        // Bulk marquee selection: set the selection to the given cue ids (or
        // merge with the current one when additive). Channel focus follows the
        // marquee's lane; a valid selection's anchor is its last id.
        case 'SELECT_CUES': {
            const { cueIds, channelId, additive } = action.payload || {};
            const valid = (cueIds || []).filter((id) => state.cues[id]);
            const settings = { ...state.settings };
            settings.selectedLaneId = null;
            settings.selectedAutoClip = null;
            settings.selectedAutoClipIds = [];
            const cur = Array.isArray(settings.selectedCueIds)
                ? settings.selectedCueIds
                : (settings.selectedCueId != null ? [settings.selectedCueId] : []);
            settings.selectedCueIds = additive ? [...new Set([...cur, ...valid])] : valid;
            settings.selectedCueId = settings.selectedCueIds.length
                ? settings.selectedCueIds[settings.selectedCueIds.length - 1]
                : null;
            if (channelId && state.channels[channelId]) settings.selectedChannelId = channelId;
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
            const clipId = action.payload.clipId;
            if (clipId && Array.isArray(lane.clips)) {
                const clips = lane.clips.map((c) =>
                    c.id === clipId
                        ? { ...c, keyframes: [...(c.keyframes || []), kf] }
                        : c
                );
                return { ...state, lanes: { ...state.lanes, [lane.id]: { ...lane, clips } } };
            }
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
            const patch = action.payload.patch || {};
            const clip = clipOwningKeyframe(lane, kfId);
            if (clip) {
                const clips = lane.clips.map((c) =>
                    c.id === clip.id
                        ? { ...c, keyframes: (c.keyframes || []).map((k) => (k.id === kfId ? { ...k, ...patch } : k)) }
                        : c
                );
                return { ...state, lanes: { ...state.lanes, [lane.id]: { ...lane, clips } } };
            }
            const keyframes = (lane.keyframes || []).map((k) =>
                k.id === kfId ? { ...k, ...patch } : k
            );
            return { ...state, lanes: { ...state.lanes, [lane.id]: { ...lane, keyframes } } };
        }

        case 'SELECT_KEYFRAME': {
            const { laneId, keyframeId, additive } = action.payload || {};
            const cur = state.settings.selectedKeyframe;
            if (!laneId || !keyframeId) {
                // Clicking empty automation space / the canvas clears selection.
                return { ...state, settings: { ...state.settings, selectedKeyframe: null, selectedLaneId: null, selectedAutoClip: null, selectedAutoClipIds: [] } };
            }
            if (additive && cur && cur.laneId === laneId && cur.keyframeId === keyframeId) {
                // Shift/Ctrl+click on the selected keyframe toggles it OFF.
                return { ...state, settings: { ...state.settings, selectedKeyframe: null, selectedLaneId: null, selectedAutoClip: null, selectedAutoClipIds: [] } };
            }
            return {
                ...state,
                settings: {
                    ...state.settings,
                    selectedKeyframe: { laneId, keyframeId },
                    // Selecting a point on a track selects the track too, so the
                    // Inspector surfaces the track's automatable/toggle settings.
                    selectedLaneId: laneId,
                    selectedAutoClip: null,
                    selectedAutoClipIds: [],
                },
            };
        }

        case 'SELECT_LANE': {
            const laneId = action.payload?.laneId;
            const lane = state.lanes[laneId];
            if (!lane) return state;
            return {
                ...state,
                settings: {
                    ...state.settings,
                    selectedLaneId: laneId,
                    selectedKeyframe: null,
                    selectedAutoClip: null,
                    selectedAutoClipIds: [],
                    selectedCueIds: [],
                    selectedCueId: null,
                },
            };
        }

        case 'REMOVE_KEYFRAME': {
            const lane = state.lanes[action.payload.laneId];
            if (!lane) return state;
            const kfId = action.payload.keyframeId;
            const clip = clipOwningKeyframe(lane, kfId);
            let lanes;
            if (clip) {
                const clips = lane.clips.map((c) =>
                    c.id === clip.id
                        ? { ...c, keyframes: (c.keyframes || []).filter((k) => k.id !== kfId) }
                        : c
                );
                lanes = { ...state.lanes, [lane.id]: { ...lane, clips } };
            } else {
                const keyframes = (lane.keyframes || []).filter((k) => k.id !== kfId);
                lanes = { ...state.lanes, [lane.id]: { ...lane, keyframes } };
            }
            const sel = state.settings.selectedKeyframe;
            const settings = sel && sel.laneId === lane.id && sel.keyframeId === kfId
                ? { ...state.settings, selectedKeyframe: null }
                : state.settings;
            return { ...state, lanes, settings };
        }

        case 'REMOVE_KEYFRAMES': {
            const lane = state.lanes[action.payload.laneId];
            if (!lane) return state;
            const ids = new Set(action.payload.keyframeIds || []);
            const clip = (Array.isArray(lane.clips) ? lane.clips : [])
                .find((c) => (c.keyframes || []).some((k) => ids.has(k.id)));
            let lanes;
            if (clip) {
                const clips = lane.clips.map((c) =>
                    c.id === clip.id
                        ? { ...c, keyframes: (c.keyframes || []).filter((k) => !ids.has(k.id)) }
                        : c
                );
                lanes = { ...state.lanes, [lane.id]: { ...lane, clips } };
            } else {
                const keyframes = (lane.keyframes || []).filter((k) => !ids.has(k.id));
                lanes = { ...state.lanes, [lane.id]: { ...lane, keyframes } };
            }
            const sel = state.settings.selectedKeyframe;
            const settings = sel && ids.has(sel.keyframeId)
                ? { ...state.settings, selectedKeyframe: null }
                : state.settings;
            return { ...state, lanes, settings };
        }

        case 'ADD_AUTO_CLIP': {
            const lane = state.lanes[action.payload.laneId];
            if (!lane) return state;
            const id = action.payload.clip?.id || generateId('acp');
            const clip = { id, startTime: 0, duration: 4, keyframes: [], values: {}, ...action.payload.clip };
            const clips = [...(Array.isArray(lane.clips) ? lane.clips : []), clip];
            return {
                ...state,
                lanes: { ...state.lanes, [lane.id]: { ...lane, clips } },
                settings: {
                    ...state.settings,
                    // A new clip is always selected so an immediate Delete or
                    // move acts on what was just created.
                    selectedAutoClip: { laneId: lane.id, clipId: id },
                    selectedAutoClipIds: [{ laneId: lane.id, clipId: id }],
                },
            };
        }

        case 'UPDATE_AUTO_CLIP': {
            const lane = state.lanes[action.payload.laneId];
            if (!lane || !Array.isArray(lane.clips)) return state;
            const { clipId, patch } = action.payload;
            if (!clipId || typeof patch !== 'object' || patch === null) return state;
            const clips = lane.clips.map((c) => {
                if (c.id !== clipId) return c;
                const startTime = patch.startTime != null ? Math.max(0, patch.startTime) : c.startTime;
                const duration = patch.duration != null ? Math.max(0.05, patch.duration) : c.duration;
                return { ...c, ...patch, startTime, duration };
            });
            return { ...state, lanes: { ...state.lanes, [lane.id]: { ...lane, clips } } };
        }

        case 'REMOVE_AUTO_CLIP': {
            const lane = state.lanes[action.payload.laneId];
            if (!lane || !Array.isArray(lane.clips)) return state;
            const clips = lane.clips.filter((c) => c.id !== action.payload.clipId);
            const sel = state.settings.selectedAutoClip;
            const removedIsSel = sel && sel.laneId === lane.id && sel.clipId === action.payload.clipId;
            const selIds = Array.isArray(state.settings.selectedAutoClipIds) ? state.settings.selectedAutoClipIds : [];
            const nextSelIds = selIds.filter((sc) => !(sc.laneId === lane.id && sc.clipId === action.payload.clipId));
            let settings = state.settings;
            if (removedIsSel || nextSelIds.length !== selIds.length) {
                settings = { ...state.settings, selectedAutoClipIds: nextSelIds };
                if (removedIsSel) {
                    settings.selectedAutoClip = nextSelIds.length ? nextSelIds[nextSelIds.length - 1] : null;
                }
            }
            return { ...state, lanes: { ...state.lanes, [lane.id]: { ...lane, clips } }, settings };
        }

        case 'SELECT_AUTO_CLIP': {
            const { laneId, clipId } = action.payload || {};
            const lane = laneId ? state.lanes[laneId] : null;
            const hasClip = !!lane && clipId && (lane.clips || []).some((c) => c.id === clipId);
            if (!hasClip) {
                // Clicking the empty automation body clears the clip selection.
                return {
                    ...state,
                    settings: { ...state.settings, selectedAutoClip: null, selectedLaneId: null, selectedAutoClipIds: [] },
                };
            }
            return {
                ...state,
                settings: {
                    ...state.settings,
                    selectedAutoClip: { laneId, clipId },
                    selectedAutoClipIds: [{ laneId, clipId }],
                    // Selecting a clip focuses the linked track in the Inspector,
                    // mirroring what keyframe/lane selection already do.
                    selectedLaneId: laneId,
                    selectedKeyframe: null,
                    selectedCueIds: [],
                    selectedCueId: null,
                },
            };
        }

        // Bulk marquee selection of automation clips. Marquees that intersect
        // automation clips take precedence over cue selection; `additive`
        // (Shift/Ctrl) merges into the current clip list instead of replacing.
        case 'SELECT_AUTO_CLIPS': {
            const { clips, additive } = action.payload || {};
            const valid = (clips || []).filter(
                (sc) =>
                    sc && sc.clipId && state.lanes?.[sc.laneId] &&
                    (state.lanes[sc.laneId].clips || []).some((c) => c.id === sc.clipId)
            );
            const cur = Array.isArray(state.settings.selectedAutoClipIds) ? state.settings.selectedAutoClipIds : [];
            const next = additive ? cur.filter((sc) => sc && sc.clipId) : [];
            for (const sc of valid) {
                if (!next.some((x) => x.laneId === sc.laneId && x.clipId === sc.clipId)) next.push(sc);
            }
            return {
                ...state,
                settings: {
                    ...state.settings,
                    selectedAutoClipIds: next,
                    selectedAutoClip: next.length ? next[next.length - 1] : null,
                    selectedLaneId: next.length ? next[next.length - 1].laneId : null,
                    selectedKeyframe: null,
                    selectedCueIds: [],
                    selectedCueId: null,
                },
            };
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
            const sel = state.settings.selectedKeyframe;
            const selIds = Array.isArray(state.settings.selectedAutoClipIds) ? state.settings.selectedAutoClipIds : [];
            const nextSelIds = selIds.filter((sc) => sc.laneId !== lane.id);
            const settings = {
                ...state.settings,
                selectedKeyframe:
                    sel && sel.laneId === lane.id
                        ? null
                        : state.settings.selectedKeyframe,
                selectedLaneId:
                    state.settings.selectedLaneId === lane.id
                        ? null
                        : state.settings.selectedLaneId,
                selectedAutoClip:
                    state.settings.selectedAutoClip?.laneId === lane.id
                        ? null
                        : state.settings.selectedAutoClip,
                selectedAutoClipIds: nextSelIds,
            };
            return { ...state, lanes, channels, settings };
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
export function extractAudioPeaks(buffer, barCount = 16000) {
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
    const hasStoredData = useRef(false);
    const [histTick, setHistTick] = useState(0);
    const stateRef = useRef(state);
    stateRef.current = state;
    const historyRef = useRef({ past: [], future: [] });

    // Actions that jump the timeline (not real "edit steps"): transient UI
    // choices (selection, zoom/snap/sync settings) and load-related actions.
    const NON_EDIT_ACTIONS = new Set([
        'SELECT', 'SELECT_CUES', 'SELECT_KEYFRAME', 'SELECT_LANE', 'SELECT_AUTO_CLIP',
        'SET_SETTINGS', 'HYDRATE', 'RESET', 'SEED_CHANNELS', 'SET_STATE',
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

    const saveProject = useCallback(async (filename = null, forceDialog = false) => {
        if (!window.electronAPI?.saveTimelineProject) return { success: false };
        return window.electronAPI.saveTimelineProject({
            channels: stateRef.current.channels,
            cues: stateRef.current.cues,
            lanes: stateRef.current.lanes,
            channelOrder: stateRef.current.channelOrder,
            settings: stateRef.current.settings,
        }, filename, forceDialog);
    }, []);

    // Save-as always prompts for a path. Ctrl+S (saveProject) instead uses the
    // current file when one is known, and automatically drops into Save As the
    // first time a never-saved project is saved — no more null-path crash.
    const saveProjectAs = useCallback(() => saveProject(null, true), [saveProject]);

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
                hasStoredData.current = true;
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

    // Synchronous flush on window teardown. A blind 400ms debounce losses edits
    // made right before the window closes — most notably path rewrites from the
    // shared RelocateModal. Without this the relocated ILDA path was written to
    // state, logged by the reducer, then discarded on fast close, so re-opening
    // the project flagged the very files that had just been fixed.
    const flushToStorage = useCallback(() => {
        if (!hydratedRef.current) return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stateRef.current));
        } catch (e) {
            console.warn('Timeline: failed to flush to storage', e);
        }
    }, []);
    const hydratedRef = useRef(hydrated);
    hydratedRef.current = hydrated;
    const flushToStorageRef = useRef(null);
    flushToStorageRef.current = flushToStorage;
    useEffect(() => {
        const onHide = () => {
            if (document.visibilityState === 'hidden') flushToStorageRef.current?.();
        };
        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('pagehide', onHide);
        window.addEventListener('beforeunload', onHide);
        return () => {
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('pagehide', onHide);
            window.removeEventListener('beforeunload', onHide);
        };
    }, []);

    const discoverChannels = useCallback(async () => {
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
            // A multi-channel DAC is discovered once PER response, and
            // getDacServices then lists ALL of its channels for every response —
            // so a 6-channel device yields 6×6 = 36 descriptors here. Collapse
            // them to one row per unique ip:channel before anything downstream
            // (dock chips, channel seeding) can duplicate an output.
            const unique = [];
            const seenKeys = new Set();
            for (const row of withServices.flat()) {
                const key = `${row.ip}:${row.channel}`;
                if (seenKeys.has(key)) continue;
                seenKeys.add(key);
                unique.push(row);
            }
            return unique;
        } catch (e) {
            console.warn('Timeline: DAC discovery failed', e);
            return [];
        }
    }, []);

    const discoverAndSeedChannels = useCallback(async () => {
        const channels = await discoverChannels();
        if (channels.length > 0) {
            dispatch({ type: 'SEED_CHANNELS', payload: channels });
        }
        return channels;
    }, [discoverChannels]);

    // Auto-seed on first open when there is nothing saved yet
    useEffect(() => {
        if (!hydrated) return;
        if (hasStoredData.current) return;
        if (Object.keys(state.channels).length === 0) {
            discoverAndSeedChannels();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hydrated, discoverAndSeedChannels]);

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

    // DAC output names (and settings) the user edits in the main app, mirrored
    // here so the track headers can display "Channel names made/adjusted in the
    // main app". Kept OUT of the reducer/persistence: it is transient, keyed by
    // `${ip}:${channel}`, fetched from electron-store and refreshed whenever the
    // timeline is opened (the editor mounts fresh on each page switch).
    const [dacOutputSettings, setDacOutputSettings] = useState({});
    const dacOutputSettingsRef = useRef({});
    const refreshDacOutputSettings = useCallback(async () => {
        try {
            if (!window.electronAPI?.getAllSettings) return;
            const all = await window.electronAPI.getAllSettings();
            if (all && all.dacOutputSettings) {
                dacOutputSettingsRef.current = all.dacOutputSettings;
                setDacOutputSettings(all.dacOutputSettings);
            }
        } catch (e) {
            console.warn('Timeline: failed to read DAC output settings', e);
        }
    }, []);
    useEffect(() => {
        refreshDacOutputSettings();
    }, [refreshDacOutputSettings]);

    // Patch one output's settings (e.g. the dimmer / zoom edited in the timeline
    // Inspector "Output" panel). Kept in the transient map; persisted to the same
    // electron-store key the main app uses so the two UIs share one source of
    // truth for channel names / dimmer / output area / zones.
    const updateDacOutputSetting = useCallback((key, patch) => {
        if (!key || !patch) return;
        const prev = dacOutputSettingsRef.current || {};
        const next = { ...prev, [key]: { ...(prev[key] || {}), ...patch } };
        dacOutputSettingsRef.current = next;
        setDacOutputSettings(next);
        try {
            if (window.electronAPI?.saveDacOutputSettings) window.electronAPI.saveDacOutputSettings(next);
        } catch (e) {
            console.warn('Timeline: failed to persist DAC output settings', e);
        }
    }, []);

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
            // Cut selected cues (or all when `ids` is null/empty) so none
            // overlaps its next neighbour on the channel. Returns how many
            // cues were trimmed.
            trimOverlaps: (ids) => {
                const trims = computeOverlapTrims(stateRef.current, ids);
                for (const [id, patch] of trims) dispatch({ type: 'UPDATE_CUE', payload: { id, patch } });
                return trims.size;
            },
            select: (cueId, channelId, additive) => dispatch({ type: 'SELECT', payload: { cueId, channelId, additive } }),
            selectCues: (cueIds, channelId, additive) => dispatch({ type: 'SELECT_CUES', payload: { cueIds, channelId, additive } }),
            addLane: (channelId, lane) => dispatch({ type: 'ADD_LANE', payload: { channelId, lane } }),
            updateLane: (laneId, patch) => dispatch({ type: 'UPDATE_LANE', payload: { laneId, patch } }),
            addKeyframe: (laneId, keyframe, clipId) => dispatch({ type: 'ADD_KEYFRAME', payload: { laneId, keyframe, clipId } }),
            updateKeyframe: (laneId, keyframeId, patch) => dispatch({ type: 'UPDATE_KEYFRAME', payload: { laneId, keyframeId, patch } }),
            removeKeyframe: (laneId, keyframeId) => dispatch({ type: 'REMOVE_KEYFRAME', payload: { laneId, keyframeId } }),
            removeKeyframes: (laneId, keyframeIds) => dispatch({ type: 'REMOVE_KEYFRAMES', payload: { laneId, keyframeIds } }),
            selectKeyframe: (laneId, keyframeId, additive) => dispatch({ type: 'SELECT_KEYFRAME', payload: { laneId, keyframeId, additive } }),
            selectLane: (laneId) => dispatch({ type: 'SELECT_LANE', payload: { laneId } }),
            addAutoClip: (laneId, clip) => dispatch({ type: 'ADD_AUTO_CLIP', payload: { laneId, clip } }),
            updateAutoClip: (laneId, clipId, patch) => dispatch({ type: 'UPDATE_AUTO_CLIP', payload: { laneId, clipId, patch } }),
            removeAutoClip: (laneId, clipId) => dispatch({ type: 'REMOVE_AUTO_CLIP', payload: { laneId, clipId } }),
            selectAutoClip: (laneId, clipId) => dispatch({ type: 'SELECT_AUTO_CLIP', payload: { laneId, clipId } }),
            selectAutoClips: (clips, additive) => dispatch({ type: 'SELECT_AUTO_CLIPS', payload: { clips, additive } }),
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
            refreshDacOutputSettings,
            updateDacOutputSetting,
        }),
        [clearTimelineAudio, undo, redo, saveProject, saveProjectAs, openProject, requestNewProject, refreshDacOutputSettings, updateDacOutputSetting]
    );

    // Keep the module-level bridge pointed at the live timeline state/actions so
    // the App shell (shared RelocateModal handler) can rewrite timeline file paths
    // without subscribing to this context. `actionsRef.current` is refreshed on
    // every render above, so a one-time effect is enough to wire the bridge.
    const actionsRef = useRef(actions);
    actionsRef.current = actions;
    useEffect(() => {
        timelineBridge.stateRef = stateRef;
        timelineBridge.actionsRef = actionsRef;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const value = useMemo(
        () => ({
            state,
            dispatch,
            actions,
            canUndo: historyRef.current.past.length > 0,
            canRedo: historyRef.current.future.length > 0,
            histTick,
            dacOutputSettings,
            refreshDacOutputSettings,
            updateDacOutputSetting,
            discoverChannels,
            discoverAndSeedChannels,
            loadTimelineAudio,
        }),
        [state, actions, histTick, dacOutputSettings, refreshDacOutputSettings, updateDacOutputSetting, discoverChannels, discoverAndSeedChannels, loadTimelineAudio]
    );

    return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>;
};

export default TimelineContext;