import { describe, it, expect } from 'vitest';
import {
    createInitialTimelineState, normalizeHydratedState, getTimelineDuration,
    getSortedCues, isChannelAudible, extractAudioPeaks, getChannelOutputs,
    getOverlappingCueIds, getAdjacentCues, computeOverlapTrims,
} from './TimelineContext';

// Import the reducer + a mini dispatch runner so we can unit-test the store
// logic without mounting React.
import { reducer } from './TimelineContext';
const run = (state, action) => reducer(state, action);

describe('initial + hydration', () => {
    it('creates a sane empty store', () => {
        const s = createInitialTimelineState();
        expect(s.channels).toEqual({});
        expect(s.channelOrder).toEqual([]);
        expect(s.settings.bpm).toBe(120);
        expect(s.settings.snapMode).toBe('beat');
    });

    it('normalizes persisted state and drops garbage entries', () => {
        const s = normalizeHydratedState({
            channels: { a: { id: 'a', name: 'A', cues: ['c1', null] }, bad: {} },
            cues: { c1: { id: 'c1', type: 'ILDA', startTime: 2, duration: 4 } },
            settings: { bpm: 130 },
        });
        expect(s.channels.a.name).toBe('A');
        expect(s.channels.bad).toBeUndefined();
        expect(s.channels.a.cues).toEqual(['c1']);
        expect(s.cues.c1.startTime).toBe(2);
        expect(s.settings.bpm).toBe(130);
        expect(s.settings.zoom).toBe(50); // default preserved
        expect(s.settings.selectedCueIds).toEqual([]);
    });

    it('migrates a legacy single selectedCueId into the selection array', () => {
        const s = normalizeHydratedState({
            settings: { selectedCueId: 'c1' },
            channels: { a: { id: 'a', name: 'A', cues: ['c1'] } },
            cues: { c1: { id: 'c1', startTime: 2, duration: 4 } },
        });
        expect(s.settings.selectedCueIds).toEqual(['c1']);
        expect(s.settings.selectedCueId).toBe('c1');
    });

    it('migrates a legacy lane curve into one spanning automation clip', () => {
        const s = normalizeHydratedState({
            channels: { ch1: { id: 'ch1', automationLanes: ['l1'] } },
            cues: { c1: { id: 'c1', startTime: 2, duration: 4 } },
            lanes: {
                l1: {
                    id: 'l1',
                    targetProperty: 'GEOMETRY_SCALE',
                    keyframes: [{ id: 'k1', time: 0, value: 1 }, { id: 'k2', time: 3, value: 2 }],
                },
            },
        });
        expect(s.lanes.l1.clips).toHaveLength(1);
        const clip = s.lanes.l1.clips[0];
        expect(clip.startTime).toBe(0);
        expect(clip.keyframes.map((k) => k.id)).toEqual(['k1', 'k2']);
        expect(clip.duration).toBeGreaterThanOrEqual(8);
        // A lane with no curve stays clip-less.
        const s2 = normalizeHydratedState({
            channels: {},
            lanes: { l2: { id: 'l2', effectId: 'translate', paramId: 'x', keyframes: [] } },
        });
        expect(s2.lanes.l2.clips).toEqual([]);
    });

    it('strips stale workerId from ILDA cues on hydration (runtime cache handle)', () => {
        const s = normalizeHydratedState({
            channels: {},
            cues: {
                ild: { id: 'ild', type: 'ILDA', filePath: 'C:/a.ild', workerId: 'ilda-123', totalFrames: 30 },
                gen: { id: 'gen', type: 'GENERATOR', workerId: 'w-1' },
            },
        });
        expect(s.cues.ild.workerId).toBeNull();
        expect(s.cues.ild.totalFrames).toBe(30);
        expect(s.cues.gen.workerId).toBe('w-1');
    });
});

describe('cue lifecycle', () => {
    function seeded() {
        const s = createInitialTimelineState();
        return run(
            run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1', name: 'L' } }),
            { type: 'ADD_CHANNEL', payload: { id: 'ch2', name: 'R' } }
        );
    }

    it('ADD_CUE links cue + channel and selects it', () => {
        let s = seeded();
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'cueA', type: 'GENERATOR', startTime: 1.5, duration: 3 } } });
        expect(s.cues.cueA.channelId).toBe('ch1');
        expect(s.channels.ch1.cues).toContain('cueA');
        expect(s.settings.selectedCueId).toBe('cueA');
        expect(s.settings.selectedCueIds).toEqual(['cueA']);
        expect(s.settings.selectedChannelId).toBe('ch1');
    });

    it('MOVE_CUE transfers the cue between channels with a new start time', () => {
        let s = seeded();
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'cueA', startTime: 0 } } });
        s = run(s, { type: 'MOVE_CUE', payload: { id: 'cueA', channelId: 'ch2', startTime: 5 } });
        expect(s.cues.cueA.channelId).toBe('ch2');
        expect(s.cues.cueA.startTime).toBe(5);
        expect(s.channels.ch1.cues).toEqual([]);
        expect(s.channels.ch2.cues).toEqual(['cueA']);
    });

    it('RESIZE_CUE clamps the duration floor', () => {
        let s = seeded();
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'cueA', duration: 4 } } });
        s = run(s, { type: 'RESIZE_CUE', payload: { id: 'cueA', duration: 0.001 } });
        expect(s.cues.cueA.duration).toBe(0.1);
    });

    it('REMOVE_CUE cleans channel list + selection', () => {
        let s = seeded();
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'cueA' } } });
        s = run(s, { type: 'REMOVE_CUE', payload: { id: 'cueA' } });
        expect(s.cues.cueA).toBeUndefined();
        expect(s.channels.ch1.cues).toEqual([]);
        expect(s.settings.selectedCueId).toBeNull();
        expect(s.settings.selectedCueIds).toEqual([]);
    });

    it('SELECT additive toggles membership and keeps the anchor', () => {
        let s = seeded();
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'a', startTime: 0 } } });
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch2', cue: { id: 'b', startTime: 4 } } });
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'c', startTime: 8 } } });
        expect(s.settings.selectedCueIds).toEqual(['c']);

        s = run(s, { type: 'SELECT', payload: { cueId: 'a', channelId: 'ch1', additive: true } });
        expect(s.settings.selectedCueIds).toEqual(['c', 'a']);
        expect(s.settings.selectedCueId).toBe('a');

        s = run(s, { type: 'SELECT', payload: { cueId: 'b', channelId: 'ch2', additive: true } });
        expect(s.settings.selectedCueIds).toEqual(['c', 'a', 'b']);
        expect(s.settings.selectedCueId).toBe('b');

        // Toggling off the anchor falls back to the last remaining sibling.
        s = run(s, { type: 'SELECT', payload: { cueId: 'b', channelId: 'ch2', additive: true } });
        expect(s.settings.selectedCueIds).toEqual(['c', 'a']);
        expect(s.settings.selectedCueId).toBe('a');
    });

    it('SELECT without additive replaces the whole selection; null clears it', () => {
        let s = seeded();
        for (const id of ['a', 'b', 'c']) {
            s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id, startTime: 0 } } });
        }
        // ADD_CUE leaves the last cue ('c') alone; fold the others in.
        s = run(s, { type: 'SELECT', payload: { cueId: 'a', channelId: 'ch1', additive: true } });
        s = run(s, { type: 'SELECT', payload: { cueId: 'b', channelId: 'ch1', additive: true } });
        expect(s.settings.selectedCueIds).toEqual(['c', 'a', 'b']);

        s = run(s, { type: 'SELECT', payload: { cueId: 'b', channelId: 'ch1' } });
        expect(s.settings.selectedCueIds).toEqual(['b']);
        expect(s.settings.selectedCueId).toBe('b');

        s = run(s, { type: 'SELECT', payload: { cueId: null, channelId: 'ch1' } });
        expect(s.settings.selectedCueIds).toEqual([]);
        expect(s.settings.selectedCueId).toBeNull();
    });

    it('SELECT additive on a null cue clears the selection', () => {
        let s = seeded();
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'a' } } });
        s = run(s, { type: 'SELECT', payload: { cueId: 'a', channelId: 'ch1', additive: true } });
        s = run(s, { type: 'SELECT', payload: { cueId: null, channelId: 'ch2', additive: true } });
        expect(s.settings.selectedCueIds).toEqual([]);
        expect(s.settings.selectedCueId).toBeNull();
    });

    it('ADD_CUE carries per-clip effectOverrides', () => {
        let s = seeded();
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'a', effectOverrides: { delay: { delayDirection: 'right_to_left' } } } } });
        expect(s.cues.a.effectOverrides).toEqual({ delay: { delayDirection: 'right_to_left' } });
        expect(s.cues.a.effectOverrides.delay.delayDirection).toBe('right_to_left');
    });

    it('SELECT_CUES replaces, merges additively, and keeps channel focus', () => {
        let s = seeded();
        for (const id of ['a', 'b', 'c']) {
            s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id, startTime: 0 } } });
        }
        // ADD_CUE leaves 'c' selected; fold a & b in for a multi-selection.
        s = run(s, { type: 'SELECT', payload: { cueId: 'a', channelId: 'ch1', additive: true } });
        s = run(s, { type: 'SELECT', payload: { cueId: 'b', channelId: 'ch1', additive: true } });
        expect(s.settings.selectedCueIds).toEqual(['c', 'a', 'b']);

        // Lane selection (inspector focus) is released by a bulk select.
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'lane1' } } });
        s = run(s, { type: 'SELECT_LANE', payload: { laneId: 'lane1' } });
        expect(s.settings.selectedLaneId).toBe('lane1');

        // Non-additive marquee replaces everything; anchor is the last id.
        s = run(s, { type: 'SELECT_CUES', payload: { cueIds: ['a', 'c'], channelId: 'ch2' } });
        expect(s.settings.selectedCueIds).toEqual(['a', 'c']);
        expect(s.settings.selectedCueId).toBe('c');
        expect(s.settings.selectedChannelId).toBe('ch2');
        expect(s.settings.selectedLaneId).toBeNull();

        // Additive marquee unions with the current selection.
        s = run(s, { type: 'SELECT_CUES', payload: { cueIds: ['b'], channelId: 'ch2', additive: true } });
        expect(s.settings.selectedCueIds).toEqual(['a', 'c', 'b']);
        expect(s.settings.selectedCueId).toBe('b');
    });

    it('SELECT_CUES ignores unknown ids and clears when the marquee is empty', () => {
        let s = seeded();
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'a' } } });
        s = run(s, { type: 'SELECT_CUES', payload: { cueIds: ['a', 'ghost'], channelId: 'ch1' } });
        expect(s.settings.selectedCueIds).toEqual(['a']);
        s = run(s, { type: 'SELECT_CUES', payload: { cueIds: [], channelId: 'ch1' } });
        expect(s.settings.selectedCueIds).toEqual([]);
        expect(s.settings.selectedCueId).toBeNull();
        expect(s.settings.selectedChannelId).toBe('ch1');
    });

    it('REMOVE_CUE prunes a dropped member of a multi-selection', () => {
        let s = seeded();
        for (const id of ['a', 'b']) {
            s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id } } });
        }
        // ADD_CUE leaves 'b' selected; fold 'a' in via an additive select.
        s = run(s, { type: 'SELECT', payload: { cueId: 'a', channelId: 'ch1', additive: true } });
        expect(s.settings.selectedCueIds).toEqual(['b', 'a']);
        expect(s.settings.selectedCueId).toBe('a');
        s = run(s, { type: 'REMOVE_CUE', payload: { id: 'a' } });
        expect(s.settings.selectedCueIds).toEqual(['b']);
        expect(s.settings.selectedCueId).toBe('b');
    });

    it('REMOVE_CHANNEL cascades to its cues and lanes', () => {
        let s = seeded();
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'cueA' } } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'lane1' } } });
        s = run(s, { type: 'REMOVE_CHANNEL', payload: { channelId: 'ch1' } });
        expect(s.channels.ch1).toBeUndefined();
        expect(s.cues.cueA).toBeUndefined();
        expect(s.lanes.lane1).toBeUndefined();
        expect(s.channelOrder).toEqual(['ch2']);
    });
});

describe('tracking / routing', () => {
    it('SEED_CHANNELS does not duplicate an existing ip:channel', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'SEED_CHANNELS', payload: [{ ip: '10.0.0.5', channel: 0, type: 'etherdream', label: 'A' }] });
        const before = s.channelOrder.length;
        s = run(s, { type: 'SEED_CHANNELS', payload: [{ ip: '10.0.0.5', channel: 0, type: 'etherdream', label: 'A' }, { ip: '10.0.0.6', channel: 1, type: 'showbridge', label: 'B' }] });
        expect(s.channelOrder.length).toBe(before + 1);
        const entry = Object.values(s.channels).find((c) => c.dac?.ip === '10.0.0.6');
        expect(entry.dac.channel).toBe(1);
        expect(entry.name).toContain('B');
    });

    it('isChannelAudible respects mute and exclusive solo', () => {
        let s = seeded();
        s = run(s, { type: 'TOGGLE_CHANNEL_SOLO', payload: { channelId: 'ch1' } });
        expect(isChannelAudible(s, s.channels.ch1)).toBe(true);
        expect(isChannelAudible(s, s.channels.ch2)).toBe(false);
        s = run(s, { type: 'TOGGLE_CHANNEL_MUTE', payload: { channelId: 'ch1' } });
        expect(isChannelAudible(s, s.channels.ch1)).toBe(false);
    });
});

describe('zones / multi-DAC routing', () => {
    const outA = { ip: '10.0.0.5', channel: 0, type: 'etherdream', label: 'A' };
    const outB = { ip: '10.0.0.6', channel: 1, type: 'showbridge', label: 'B' };
    const norm = (d) => ({ ...d, flipX: false, flipY: false });

    it('getChannelOutputs reads the legacy dac as a one-element list', () => {
        expect(getChannelOutputs({ id: 'x', dac: outA })).toEqual([outA]);
        expect(getChannelOutputs(null)).toEqual([]);
        expect(getChannelOutputs({ id: 'x' })).toEqual([]);
        expect(getChannelOutputs({ id: 'x', dacs: [outA, outB], dac: outA })).toEqual([outA, outB]);
    });

    it('ADD_CHANNEL with dacs mirrors the first output into dac', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'zone', name: 'Zone', dacs: [outA, outB] } });
        expect(s.channels.zone.dacs).toEqual([norm(outA), norm(outB)]);
        expect(s.channels.zone.dac).toEqual(norm(outA));
        expect(s.channels.zone.dacs.length).toBe(2);
    });

    it('SET_CHANNEL_DACS replaces the list and mirrors dac, dropping bad entries', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'zone', name: 'Zone', dacs: [outA] } });
        s = run(s, { type: 'SET_CHANNEL_DACS', payload: { channelId: 'zone', dacs: [outB, { ip: null }, outA] } });
        expect(s.channels.zone.dacs).toEqual([norm(outB), norm(outA)]);
        expect(s.channels.zone.dac).toEqual(norm(outB));
        s = run(s, { type: 'SET_CHANNEL_DACS', payload: { channelId: 'zone', dacs: [] } });
        expect(s.channels.zone.dacs).toEqual([]);
        expect(s.channels.zone.dac).toBeNull();
    });

    it('SET_CHANNEL_DAC rewrites the zone to a single output', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'zone', name: 'Zone', dacs: [outA, outB] } });
        s = run(s, { type: 'SET_CHANNEL_DAC', payload: { channelId: 'zone', dac: outB } });
        expect(s.channels.zone.dacs).toEqual([norm(outB)]);
        s = run(s, { type: 'SET_CHANNEL_DAC', payload: { channelId: 'zone', dac: null } });
        expect(s.channels.zone.dacs).toEqual([]);
        expect(s.channels.zone.dac).toBeNull();
    });

    it('SEED_CHANNELS does not duplicate an output already in a zone', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'zone', name: 'Zone', dacs: [outA, outB] } });
        const before = s.channelOrder.length;
        s = run(s, { type: 'SEED_CHANNELS', payload: [{ ip: '10.0.0.5', channel: 0, type: 'etherdream', label: 'A' }] });
        expect(s.channelOrder.length).toBe(before);
        expect(s.channels.zone.dacs.length).toBe(2);
    });

    it('normalizeHydratedState migrates a legacy single dac into dacs', () => {
        const s = normalizeHydratedState({
            channels: { old: { id: 'old', name: 'Legacy', dac: outA, cues: [] } },
            channelOrder: ['old'],
        });
        expect(s.channels.old.dacs).toEqual([norm(outA)]);
        expect(s.channels.old.dac).toEqual(norm(outA));
    });

    it('SET_OUTPUT_FLIP inverts only one DAC output of a zone', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'zone', name: 'Zone', dacs: [outA, outB] } });
        expect(s.channels.zone.dacs.map((d) => d.flipX)).toEqual([false, false]);
        s = run(s, { type: 'SET_OUTPUT_FLIP', payload: { channelId: 'zone', ip: '10.0.0.6', channel: 1, axis: 'x' } });
        const x = s.channels.zone.dacs;
        expect(x[0].flipX).toBe(false);
        expect(x[1].flipX).toBe(true);
        expect(x[1].flipY).toBe(false);
        expect(x[1].label).toBe('B'); // untouched otherwise
        s = run(s, { type: 'SET_OUTPUT_FLIP', payload: { channelId: 'zone', ip: '10.0.0.6', channel: 1, axis: 'y' } });
        expect(s.channels.zone.dacs[1].flipY).toBe(true);
        s = run(s, { type: 'SET_OUTPUT_FLIP', payload: { channelId: 'zone', ip: '10.0.0.6', channel: 1, axis: 'x' } });
        expect(s.channels.zone.dacs[1].flipX).toBe(false); // toggled back
    });
});

describe('lanes', () => {
    it('adds, updates and removes keyframes', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'lane1', targetProperty: 'GEOMETRY_SCALE' } } });
        s = run(s, { type: 'ADD_KEYFRAME', payload: { laneId: 'lane1', keyframe: { id: 'k1', time: 0, value: 1 } } });
        s = run(s, { type: 'ADD_KEYFRAME', payload: { laneId: 'lane1', keyframe: { id: 'k2', time: 10, value: 2 } } });
        expect(s.lanes.lane1.keyframes.length).toBe(2);
        s = run(s, { type: 'UPDATE_KEYFRAME', payload: { laneId: 'lane1', keyframeId: 'k2', patch: { value: 3 } } });
        expect(s.lanes.lane1.keyframes.find((k) => k.id === 'k2').value).toBe(3);
        s = run(s, { type: 'REMOVE_KEYFRAME', payload: { laneId: 'lane1', keyframeId: 'k1' } });
        expect(s.lanes.lane1.keyframes.map((k) => k.id)).toEqual(['k2']);
    });

    it('REMOVE_LANE disconnects from the channel', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'lane1' } } });
        s = run(s, { type: 'REMOVE_LANE', payload: { laneId: 'lane1' } });
        expect(s.channels.ch1.automationLanes).toEqual([]);
        expect(s.lanes.lane1).toBeUndefined();
    });

    it('ADD_LANE creates an empty effect lane by default (nothing assigned)', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'lane1' } } });
        expect(s.lanes.lane1.effectId).toBeNull();
        expect(s.lanes.lane1.paramId).toBeNull();
        expect(s.lanes.lane1.genId).toBeNull();
        expect(s.lanes.lane1.genParamId).toBeNull();
        expect(s.lanes.lane1.targetProperty).toBeNull();
        expect(s.channels.ch1.automationLanes).toEqual(['lane1']);
    });

    it('ADD_LANE accepts an effect/param link (parameter linking)', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'lane1', effectId: 'translate', paramId: 'translateX' } } });
        expect(s.lanes.lane1.effectId).toBe('translate');
        expect(s.lanes.lane1.paramId).toBe('translateX');
    });

    it('ADD_LANE accepts a generator-param link (generator parameter automation)', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'lane1', genId: 'circle', genParamId: 'radius' } } });
        expect(s.lanes.lane1.genId).toBe('circle');
        expect(s.lanes.lane1.genParamId).toBe('radius');
        expect(s.lanes.lane1.effectId).toBeNull();
    });

    it('ADD_LANE accepts multiple automation lanes per channel (no cap)', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'l1', genId: 'circle', genParamId: 'radius' } } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'l2', effectId: 'rotate', paramId: 'angle' } } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'l3', targetProperty: 'GEOMETRY_SCALE' } } });
        expect(s.channels.ch1.automationLanes).toEqual(['l1', 'l2', 'l3']);
    });

    it('UPDATE_LANE can assign / relink the target effect and parameter', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'lane1' } } });
        s = run(s, { type: 'UPDATE_LANE', payload: { laneId: 'lane1', patch: { effectId: 'warp', paramId: 'radius' } } });
        expect(s.lanes.lane1.effectId).toBe('warp');
        expect(s.lanes.lane1.paramId).toBe('radius');
        s = run(s, { type: 'UPDATE_LANE', payload: { laneId: 'lane1', patch: { effectId: null, paramId: null } } });
        expect(s.lanes.lane1.effectId).toBeNull();
        expect(s.lanes.lane1.paramId).toBeNull();
    });
});

describe('selectors + audio', () => {
    it('getTimelineDuration spans cue ends and audio duration with a floor', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'cueA', startTime: 2, duration: 4 } } });
        expect(getTimelineDuration(s, 60)).toBe(60);
        expect(getTimelineDuration(s, 0)).toBe(6);
        s = run(s, { type: 'SET_AUDIO', payload: { path: 'x', peaks: [], duration: 120 } });
        expect(getTimelineDuration(s, 0)).toBe(120);
    });

    it('getSortedCues returns cues in start order', () => {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'a', startTime: 5 } } });
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'b', startTime: 1 } } });
        expect(getSortedCues(s, 'ch1').map((c) => c.id)).toEqual(['b', 'a']);
    });

    it('extractAudioPeaks downsamples min/max bars', () => {
        const data = new Float32Array(64);
        for (let i = 0; i < 64; i++) data[i] = i % 2 === 0 ? -0.5 : 0.5;
        const buffer = { getChannelData: () => data, duration: 4 };
        const { peaks, duration } = extractAudioPeaks(buffer, 16);
        expect(duration).toBe(4);
        expect(peaks.length).toBe(16);
        expect(peaks[0].max).toBe(0.5);
        expect(peaks[0].min).toBe(-0.5);
        expect(extractAudioPeaks(null)).toEqual({ peaks: [], duration: 0 });
    });
});

describe('overlap detection + trim', () => {
    function withCues(cues) {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch2' } });
        for (const c of cues) {
            s = run(s, { type: 'ADD_CUE', payload: { channelId: c.channel || 'ch1', cue: c } });
            if (c.isLooping) {
                s = run(s, { type: 'UPDATE_CUE', payload: { id: c.id, patch: { isLooping: true } } });
            }
        }
        return s;
    }

    it('marks only genuinely overlapping cues on the same channel', () => {
        let s = withCues([
            { id: 'a', startTime: 0, duration: 2 },
            { id: 'b', startTime: 2, duration: 2 }, // touches exactly
            { id: 'c', startTime: 5, duration: 1 },
            { id: 'd', startTime: 4, duration: 3, channel: 'ch2' }, // overlaps on another channel
        ]);
        expect(getOverlappingCueIds(s)).toEqual(new Set());
        s = run(s, { type: 'UPDATE_CUE', payload: { id: 'c', patch: { startTime: 1 } } });
        // a: 0–2, c: 1–2 now overlap; b still starts exactly where c ends.
        expect(getOverlappingCueIds(s)).toEqual(new Set(['a', 'c']));
    });

    it('treats a looping cue as never-ending so it overlaps whatever starts after it', () => {
        const s = withCues([
            { id: 'loop', startTime: 0, duration: 2, isLooping: true },
            { id: 'late', startTime: 6, duration: 1 },
        ]);
        expect(getOverlappingCueIds(s)).toEqual(new Set(['loop', 'late']));
    });

    it('getAdjacentCues reports the previous end / next start per clue', () => {
        const s = withCues([
            { id: 'a', startTime: 0, duration: 2 },
            { id: 'b', startTime: 2, duration: 1 },
            { id: 'c', startTime: 5, duration: 1 },
        ]);
        expect(getAdjacentCues(s, 'a')).toEqual({ prevEnd: null, nextStart: 2 });
        expect(getAdjacentCues(s, 'b')).toEqual({ prevEnd: 2, nextStart: 5 });
        expect(getAdjacentCues(s, 'c')).toEqual({ prevEnd: 3, nextStart: null });
        expect(getAdjacentCues(s, 'nope')).toEqual({ prevEnd: null, nextStart: null });
    });

    it('computeOverlapTrims shortens each earlier clip to the next start', () => {
        const s = withCues([
            { id: 'a', startTime: 0, duration: 4 },
            { id: 'b', startTime: 3, duration: 5 },
            { id: 'c', startTime: 7, duration: 1 },
        ]);
        expect(computeOverlapTrims(s)).toEqual(new Map([
            ['a', { duration: 3 }],
            ['b', { duration: 4 }],
        ]));
    });

    it('computeOverlapTrims un-loops a looping clip that must be cut', () => {
        const s = withCues([
            { id: 'a', startTime: 0, duration: 4, isLooping: true },
            { id: 'b', startTime: 3, duration: 1 },
        ]);
        expect(computeOverlapTrims(s)).toEqual(new Map([['a', { duration: 3, isLooping: false }]]));
    });

    it('computeOverlapTrims leaves touching and same-start clips alone', () => {
        const s = withCues([
            { id: 'a', startTime: 0, duration: 2 },
            { id: 'b', startTime: 2, duration: 2 }, // exact touch, no cut
            { id: 'c', startTime: 2, duration: 2 }, // same start as b, never zero-width
        ]);
        expect(computeOverlapTrims(s).size).toBe(0);
    });

    it('computeOverlapTrims respects a selection filter and different channels', () => {
        const s = withCues([
            { id: 'a', startTime: 0, duration: 4 },
            { id: 'b', startTime: 3, duration: 2 },
            { id: 'c', startTime: 3, duration: 2, channel: 'ch2' },
        ]);
        // Only the selected clip is trimmed.
        expect(computeOverlapTrims(s, ['a'])).toEqual(new Map([['a', { duration: 3 }]]));
        // Unknown ids cut nothing.
        expect(computeOverlapTrims(s, ['gone']).size).toBe(0);
    });
});

function seeded() {
    const s = createInitialTimelineState();
    return run(
        run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1', name: 'L' } }),
        { type: 'ADD_CHANNEL', payload: { id: 'ch2', name: 'R' } }
    );
}

describe('keyframe selection', () => {
    function withLane() {
        let s = seeded();
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'l1' } } });
        return s;
    }

    it('selects a keyframe and clears with an empty/primary click', () => {
        let s = withLane();
        s = run(s, { type: 'ADD_KEYFRAME', payload: { laneId: 'l1', keyframe: { id: 'k1', time: 0, value: 1 } } });
        expect(s.settings.selectedKeyframe).toBeNull();
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        expect(s.settings.selectedKeyframe).toEqual({ laneId: 'l1', keyframeId: 'k1' });
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: null, keyframeId: null } });
        expect(s.settings.selectedKeyframe).toBeNull();
    });

    it('additive select toggles the same keyframe off', () => {
        let s = withLane();
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1', additive: true } });
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1', additive: true } });
        expect(s.settings.selectedKeyframe).toBeNull();
    });

    it('REMOVE_KEYFRAME clears the selection when it matches', () => {
        let s = withLane();
        s = run(s, { type: 'ADD_KEYFRAME', payload: { laneId: 'l1', keyframe: { id: 'k1', time: 0, value: 1 } } });
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        s = run(s, { type: 'REMOVE_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        expect(s.lanes.l1.keyframes).toEqual([]);
        expect(s.settings.selectedKeyframe).toBeNull();
    });

    it('REMOVE_KEYFRAME keeps an unrelated selection', () => {
        let s = withLane();
        s = run(s, { type: 'ADD_KEYFRAME', payload: { laneId: 'l1', keyframe: { id: 'k1', time: 0, value: 1 } } });
        s = run(s, { type: 'ADD_KEYFRAME', payload: { laneId: 'l1', keyframe: { id: 'k2', time: 1, value: 2 } } });
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        s = run(s, { type: 'REMOVE_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k2' } });
        expect(s.settings.selectedKeyframe).toEqual({ laneId: 'l1', keyframeId: 'k1' });
    });

    it('REMOVE_KEYFRAMES bulk-deletes and clears a member selection', () => {
        let s = withLane();
        s = run(s, { type: 'ADD_KEYFRAME', payload: { laneId: 'l1', keyframe: { id: 'k1', time: 0, value: 1 } } });
        s = run(s, { type: 'ADD_KEYFRAME', payload: { laneId: 'l1', keyframe: { id: 'k2', time: 1, value: 2 } } });
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        s = run(s, { type: 'REMOVE_KEYFRAMES', payload: { laneId: 'l1', keyframeIds: ['k1', 'k2'] } });
        expect(s.lanes.l1.keyframes).toEqual([]);
        expect(s.settings.selectedKeyframe).toBeNull();
    });

    it('REMOVE_LANE clears a keyframe selection on that lane', () => {
        let s = withLane();
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        s = run(s, { type: 'REMOVE_LANE', payload: { laneId: 'l1' } });
        expect(s.lanes.l1).toBeUndefined();
        expect(s.settings.selectedKeyframe).toBeNull();
    });
});

describe('automation track (lane) selection', () => {
    function withLane() {
        let s = seeded();
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'l1' } } });
        return s;
    }

    it('SELECT_LANE selects the track and clears cue/keyframe focus', () => {
        let s = withLane();
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'c1', type: 'GENERATOR' } } });
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        s = run(s, { type: 'SELECT_LANE', payload: { laneId: 'l1' } });
        expect(s.settings.selectedLaneId).toBe('l1');
        expect(s.settings.selectedKeyframe).toBeNull();
        expect(s.settings.selectedCueId).toBeNull();
    });

    it('SELECT_LANE ignores an unknown lane id', () => {
        let s = withLane();
        s = run(s, { type: 'SELECT_LANE', payload: { laneId: 'nope' } });
        expect(s.settings.selectedLaneId).toBeNull();
    });

    it('selecting a keyframe also selects its track', () => {
        let s = withLane();
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        expect(s.settings.selectedKeyframe).toEqual({ laneId: 'l1', keyframeId: 'k1' });
        expect(s.settings.selectedLaneId).toBe('l1');
    });

    it('selecting a cue clears the track selection', () => {
        let s = withLane();
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        s = run(s, { type: 'SELECT', payload: { cueId: 'c1', channelId: 'ch1' } });
        expect(s.settings.selectedLaneId).toBeNull();
    });

    it('REMOVE_LANE clears a matching selectedLaneId', () => {
        let s = withLane();
        s = run(s, { type: 'SELECT_LANE', payload: { laneId: 'l1' } });
        s = run(s, { type: 'REMOVE_LANE', payload: { laneId: 'l1' } });
        expect(s.settings.selectedLaneId).toBeNull();
    });
});

describe('automation clips (FL-style)', () => {
    function withClipLane() {
        let s = seeded();
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'l1' } } });
        s = run(s, { type: 'ADD_AUTO_CLIP', payload: { laneId: 'l1', clip: { id: 'ac1', startTime: 2, duration: 5 } } });
        return s;
    }

    it('ADD_AUTO_CLIP appends a clip (with defaults) and selects it', () => {
        let s = seeded();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'l1' } } });
        s = run(s, { type: 'ADD_AUTO_CLIP', payload: { laneId: 'l1', clip: { id: 'ac1' } } });
        expect(s.lanes.l1.clips).toHaveLength(1);
        expect(s.lanes.l1.clips[0]).toMatchObject({ id: 'ac1', startTime: 0, duration: 4, keyframes: [] });
        expect(s.settings.selectedAutoClip).toEqual({ laneId: 'l1', clipId: 'ac1' });
    });

    it('ADD_AUTO_CLIP generates an id when none is supplied', () => {
        let s = seeded();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'l1' } } });
        s = run(s, { type: 'ADD_AUTO_CLIP', payload: { laneId: 'l1', clip: { startTime: 1 } } });
        expect(s.lanes.l1.clips[0].id).toMatch(/^acp-/);
        expect(s.lanes.l1.clips[0].startTime).toBe(1);
    });

    it('UPDATE_AUTO_CLIP moves/trims with clamped bounds', () => {
        let s = withClipLane();
        s = run(s, { type: 'UPDATE_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'ac1', patch: { startTime: 3.2 } } });
        expect(s.lanes.l1.clips[0].startTime).toBe(3.2);
        s = run(s, { type: 'UPDATE_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'ac1', patch: { startTime: -4, duration: 0.01 } } });
        expect(s.lanes.l1.clips[0].startTime).toBe(0);
        expect(s.lanes.l1.clips[0].duration).toBe(0.05);
    });

    it('resize-start keeps the end fixed', () => {
        let s = withClipLane(); // ac1: start 2, dur 5 -> end 7
        s = run(s, { type: 'UPDATE_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'ac1', patch: { startTime: 3, duration: 4 } } });
        expect(s.lanes.l1.clips[0]).toMatchObject({ startTime: 3, duration: 4 });
    });

    it('REMOVE_AUTO_CLIP removes the clip and clears a matching selection', () => {
        let s = withClipLane();
        s = run(s, { type: 'REMOVE_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'ac1' } });
        expect(s.lanes.l1.clips).toEqual([]);
        expect(s.settings.selectedAutoClip).toBeNull();
    });

    it('SELECT_AUTO_CLIP selects the clip and clears cue/keyframe focus', () => {
        let s = withClipLane();
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'c1', type: 'GENERATOR' } } });
        s = run(s, { type: 'ADD_KEYFRAME', payload: { laneId: 'l1', clipId: 'ac1', keyframe: { id: 'k1', time: 0, value: 1 } } });
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        s = run(s, { type: 'SELECT_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'ac1' } });
        expect(s.settings.selectedAutoClip).toEqual({ laneId: 'l1', clipId: 'ac1' });
        expect(s.settings.selectedKeyframe).toBeNull();
        expect(s.settings.selectedCueId).toBeNull();
        expect(s.settings.selectedLaneId).toBe('l1');
    });

    it('SELECT_AUTO_CLIP with an empty/unknown target clears selection', () => {
        let s = withClipLane();
        s = run(s, { type: 'SELECT_AUTO_CLIP', payload: { laneId: null, clipId: null } });
        expect(s.settings.selectedAutoClip).toBeNull();
        s = run(s, { type: 'SELECT_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'nope' } });
        expect(s.settings.selectedAutoClip).toBeNull();
    });

    it('SELECT / SELECT_KEYFRAME / SELECT_LANE / ADD_CUE clear the clip selection', () => {
        let s = withClipLane();
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'c1', type: 'GENERATOR' } } });
        s = run(s, { type: 'SELECT', payload: { cueId: 'c1', channelId: 'ch1' } });
        expect(s.settings.selectedAutoClip).toBeNull();
        s = run(s, { type: 'SELECT_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'ac1' } });
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k9' } });
        expect(s.settings.selectedAutoClip).toBeNull();
        s = run(s, { type: 'SELECT_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'ac1' } });
        s = run(s, { type: 'SELECT_LANE', payload: { laneId: 'l1' } });
        expect(s.settings.selectedAutoClip).toBeNull();
        s = run(s, { type: 'SELECT_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'ac1' } });
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'c2', type: 'GENERATOR' } } });
        expect(s.settings.selectedAutoClip).toBeNull();
    });

    it('ADD_KEYFRAME with a clipId lands in the clip (clip-relative times)', () => {
        let s = withClipLane(); // ac1 starts at 2
        s = run(s, { type: 'ADD_KEYFRAME', payload: { laneId: 'l1', clipId: 'ac1', keyframe: { id: 'k1', time: 0.5, value: 1 } } });
        expect(s.lanes.l1.clips[0].keyframes).toEqual([expect.objectContaining({ id: 'k1', time: 0.5, value: 1 })]);
        expect(s.lanes.l1.keyframes).toEqual([]);
    });

    it('UPDATE_KEYFRAME resolves the owning clip by keyframe id', () => {
        let s = withClipLane();
        s = run(s, { type: 'ADD_KEYFRAME', payload: { laneId: 'l1', clipId: 'ac1', keyframe: { id: 'k1', time: 0, value: 1 } } });
        s = run(s, { type: 'UPDATE_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1', patch: { value: 9 } } });
        expect(s.lanes.l1.clips[0].keyframes[0].value).toBe(9);
    });

    it('REMOVE_KEYFRAME removes from the clip and clears a matching selection', () => {
        let s = withClipLane();
        s = run(s, { type: 'ADD_KEYFRAME', payload: { laneId: 'l1', clipId: 'ac1', keyframe: { id: 'k1', time: 0, value: 1 } } });
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        s = run(s, { type: 'REMOVE_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        expect(s.lanes.l1.clips[0].keyframes).toEqual([]);
        expect(s.settings.selectedKeyframe).toBeNull();
    });

    it('REMOVE_LANE clears a matching clip selection', () => {
        let s = withClipLane();
        s = run(s, { type: 'SELECT_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'ac1' } });
        s = run(s, { type: 'REMOVE_LANE', payload: { laneId: 'l1' } });
        expect(s.lanes.l1).toBeUndefined();
        expect(s.settings.selectedAutoClip).toBeNull();
    });

    it('hydrates existing clips as-is and strips the transient clip selection', () => {
        const s = normalizeHydratedState({
            channels: { ch1: { id: 'ch1', automationLanes: ['l1'] } },
            lanes: {
                l1: {
                    id: 'l1',
                    effectId: 'translate',
                    paramId: 'x',
                    clips: [{ id: 'ac9', startTime: 1, duration: 2, keyframes: [{ id: 'k1', time: 0, value: 2 }] }],
                },
            },
            settings: { selectedAutoClip: { laneId: 'l1', clipId: 'ac9' } },
        });
        expect(s.lanes.l1.clips).toHaveLength(1);
        expect(s.lanes.l1.clips[0].keyframes).toHaveLength(1);
        expect(s.settings.selectedAutoClip).toBeNull();
    });
});

describe('automation clip multi-selection (marquee)', () => {
    function seedTwoClips() {
        let s = createInitialTimelineState();
        s = run(s, { type: 'ADD_CHANNEL', payload: { id: 'ch1' } });
        s = run(s, { type: 'ADD_LANE', payload: { channelId: 'ch1', lane: { id: 'l1' } } });
        s = run(s, { type: 'ADD_AUTO_CLIP', payload: { laneId: 'l1', clip: { id: 'ac1' } } });
        s = run(s, { type: 'ADD_AUTO_CLIP', payload: { laneId: 'l1', clip: { id: 'ac2' } } });
        return s;
    }

    it('SELECT_AUTO_CLIPS replaces the selection and anchors the last clip', () => {
        let s = seedTwoClips();
        s = run(s, { type: 'SELECT_AUTO_CLIPS', payload: { clips: [{ laneId: 'l1', clipId: 'ac1' }, { laneId: 'l1', clipId: 'ac2' }] } });
        expect(s.settings.selectedAutoClipIds).toEqual([{ laneId: 'l1', clipId: 'ac1' }, { laneId: 'l1', clipId: 'ac2' }]);
        expect(s.settings.selectedAutoClip).toEqual({ laneId: 'l1', clipId: 'ac2' });
        expect(s.settings.selectedLaneId).toBe('l1');
        expect(s.settings.selectedCueIds).toEqual([]);
    });

    it('SELECT_AUTO_CLIPS additive merges and de-duplicates', () => {
        let s = seedTwoClips();
        s = run(s, { type: 'SELECT_AUTO_CLIPS', payload: { clips: [{ laneId: 'l1', clipId: 'ac1' }] } });
        s = run(s, { type: 'SELECT_AUTO_CLIPS', payload: { clips: [{ laneId: 'l1', clipId: 'ac2' }, { laneId: 'l1', clipId: 'ac1' }], additive: true } });
        expect(s.settings.selectedAutoClipIds).toHaveLength(2);
        expect(s.settings.selectedAutoClipIds[1]).toEqual({ laneId: 'l1', clipId: 'ac2' });
    });

    it('SELECT_AUTO_CLIPS validates ids and clears when none remain', () => {
        let s = seedTwoClips();
        s = run(s, { type: 'SELECT_AUTO_CLIPS', payload: { clips: [{ laneId: 'l1', clipId: 'ac1' }, { laneId: 'l1', clipId: 'ghost' }, { laneId: 'nope', clipId: 'ac1' }] } });
        expect(s.settings.selectedAutoClipIds).toEqual([{ laneId: 'l1', clipId: 'ac1' }]);
        s = run(s, { type: 'SELECT_AUTO_CLIPS', payload: { clips: [] } });
        expect(s.settings.selectedAutoClipIds).toEqual([]);
        expect(s.settings.selectedAutoClip).toBeNull();
    });

    it('SELECT_CUES / SELECT / SELECT_KEYFRAME clear the auto-clip marquee list', () => {
        let s = seedTwoClips();
        s = run(s, { type: 'SELECT_AUTO_CLIPS', payload: { clips: [{ laneId: 'l1', clipId: 'ac1' }, { laneId: 'l1', clipId: 'ac2' }] } });
        s = run(s, { type: 'ADD_CUE', payload: { channelId: 'ch1', cue: { id: 'c1', type: 'GENERATOR' } } });
        expect(s.settings.selectedAutoClipIds).toEqual([]);
        s = run(s, { type: 'SELECT_AUTO_CLIPS', payload: { clips: [{ laneId: 'l1', clipId: 'ac1' }, { laneId: 'l1', clipId: 'ac2' }] } });
        s = run(s, { type: 'SELECT_CUES', payload: { cueIds: ['c1'], channelId: 'ch1' } });
        expect(s.settings.selectedAutoClipIds).toEqual([]);
        s = run(s, { type: 'SELECT_AUTO_CLIPS', payload: { clips: [{ laneId: 'l1', clipId: 'ac1' }, { laneId: 'l1', clipId: 'ac2' }] } });
        s = run(s, { type: 'SELECT_KEYFRAME', payload: { laneId: 'l1', keyframeId: 'k1' } });
        expect(s.settings.selectedAutoClipIds).toEqual([]);
    });

    it('SELECT_AUTO_CLIP (single) collapses the list to one entry', () => {
        let s = seedTwoClips();
        s = run(s, { type: 'SELECT_AUTO_CLIPS', payload: { clips: [{ laneId: 'l1', clipId: 'ac1' }, { laneId: 'l1', clipId: 'ac2' }] } });
        s = run(s, { type: 'SELECT_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'ac1' } });
        expect(s.settings.selectedAutoClipIds).toEqual([{ laneId: 'l1', clipId: 'ac1' }]);
        expect(s.settings.selectedAutoClip).toEqual({ laneId: 'l1', clipId: 'ac1' });
    });

    it('REMOVE_AUTO_CLIP prunes the multi list and falls back to the previous anchor', () => {
        let s = seedTwoClips();
        s = run(s, { type: 'SELECT_AUTO_CLIPS', payload: { clips: [{ laneId: 'l1', clipId: 'ac1' }, { laneId: 'l1', clipId: 'ac2' }] } });
        s = run(s, { type: 'REMOVE_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'ac2' } });
        expect(s.settings.selectedAutoClipIds).toEqual([{ laneId: 'l1', clipId: 'ac1' }]);
        expect(s.settings.selectedAutoClip).toEqual({ laneId: 'l1', clipId: 'ac1' });
        s = run(s, { type: 'REMOVE_AUTO_CLIP', payload: { laneId: 'l1', clipId: 'ac1' } });
        expect(s.settings.selectedAutoClipIds).toEqual([]);
        expect(s.settings.selectedAutoClip).toBeNull();
    });
});