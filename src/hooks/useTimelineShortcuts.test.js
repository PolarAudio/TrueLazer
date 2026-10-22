import { describe, it, expect, vi } from 'vitest';
import { pickPasteChannel, computeArrowSeek, pressSpacePlayPause, spaceReplayFromAnchor, cuePastePayload, deepCopy, freshKeyframes } from './useTimelineShortcuts';

const channels = {
    ch1: { id: 'ch1', name: 'A' },
    ch2: { id: 'ch2', name: 'B' },
    ch3: { id: 'ch3', name: 'C' },
};

describe('pressSpacePlayPause', () => {
    const makePb = (anchor = 2.5) => ({
        isPlaying: false,
        pause: vi.fn(),
        play: vi.fn(),
        seek: vi.fn(),
        anchor,
    });

    it('pauses when playing (no seek)', () => {
        const pb = makePb();
        pb.isPlaying = true;
        pressSpacePlayPause(pb);
        expect(pb.pause).toHaveBeenCalledTimes(1);
        expect(pb.seek).not.toHaveBeenCalled();
        expect(pb.play).not.toHaveBeenCalled();
    });

    it('snaps to the replay anchor then plays when stopped', () => {
        const pb = makePb(2.5);
        pressSpacePlayPause(pb);
        expect(pb.seek).toHaveBeenCalledWith(2.5);
        expect(pb.play).toHaveBeenCalledTimes(1);
        expect(pb.pause).not.toHaveBeenCalled();
    });

    it('defaults to the timeline start when no anchor is set', () => {
        const pb = makePb();
        delete pb.anchor;
        pressSpacePlayPause(pb);
        expect(pb.seek).toHaveBeenCalledWith(0);
        expect(pb.play).toHaveBeenCalledTimes(1);
    });

    it('honors replayFromAnchor=false (external clock keeps its own position)', () => {
        const pb = makePb();
        pressSpacePlayPause(pb, { replayFromAnchor: false });
        expect(pb.seek).not.toHaveBeenCalled();
        expect(pb.play).toHaveBeenCalledTimes(1);
    });
});

describe('spaceReplayFromAnchor', () => {
    it('snaps back for the internal transport', () => {
        expect(spaceReplayFromAnchor('internal', false)).toBe(true);
        expect(spaceReplayFromAnchor(undefined, false)).toBe(true);
    });

    it('does not snap back a live external show clock', () => {
        expect(spaceReplayFromAnchor('artnet', true)).toBe(false);
        expect(spaceReplayFromAnchor('mtc', true)).toBe(false);
    });

    it('snaps back for an external source with no live signal (wall-clock fallback)', () => {
        expect(spaceReplayFromAnchor('artnet', false)).toBe(true);
        expect(spaceReplayFromAnchor('artnet', undefined)).toBe(true);
    });
});

describe('computeArrowSeek', () => {
    const base = { fps: 30, playhead: 1.0 };

    it('moves left/right by exactly one frame', () => {
        expect(computeArrowSeek('arrowright', base)).toBeCloseTo(1 + 1 / 30);
        expect(computeArrowSeek('arrowleft', base)).toBeCloseTo(1 - 1 / 30);
    });

    it('mirrors up/down to left/right rows (no row change)', () => {
        expect(computeArrowSeek('arrowup', base)).toBeCloseTo(1 - 1 / 30);
        expect(computeArrowSeek('arrowdown', base)).toBeCloseTo(1 + 1 / 30);
    });

    it('clamps at 0', () => {
        expect(computeArrowSeek('arrowleft', { ...base, playhead: 0.01 })).toBe(0);
    });

    it('defaults fps to 30', () => {
        const opts = { ...base };
        delete opts.fps;
        expect(computeArrowSeek('arrowright', opts)).toBeCloseTo(1 + 1 / 30);
    });
});

describe('pickPasteChannel', () => {
    it('prefers the currently selected track over the clip origin', () => {
        expect(pickPasteChannel(channels, ['ch1', 'ch2', 'ch3'], 'ch2', { channelId: 'ch1' })).toBe('ch2');
    });

    it('falls back to the clip origin when nothing is selected', () => {
        expect(pickPasteChannel(channels, ['ch1', 'ch2', 'ch3'], null, { channelId: 'ch3' })).toBe('ch3');
    });

    it('falls back to the first track when the origin is gone', () => {
        expect(pickPasteChannel(channels, ['ch1', 'ch2', 'ch3'], null, { channelId: 'gone' })).toBe('ch1');
    });

    it('returns null when there are no tracks', () => {
        expect(pickPasteChannel({}, [], 'ch1', { channelId: 'gone' })).toBeNull();
    });

    it('ignores a selected id that does not exist', () => {
        expect(pickPasteChannel(channels, ['ch1'], 'ghost', { channelId: null })).toBe('ch1');
    });
});

/**
 * Copying a clip or an effect has to produce an INDEPENDENT copy. It used to
 * produce something that behaved like the original: the pasted cue shared the
 * original's generator parameters and effect overrides by reference, and the
 * pasted effect clip kept the original's KEYFRAME ids - and the keyframe id is
 * how a lane decides which clip owns a point, so every edit on the pasted
 * curve landed on the original.
 */
describe('copy/paste independence', () => {
    const cue = {
        id: 'cue-1',
        type: 'GENERATOR',
        name: 'Circle',
        generatorId: 'circle',
        generatorParams: { radius: 10, speed: 2 },
        effectOverrides: { invert: { invertX: true } },
        effects: [{ id: 'invert', instanceId: 'inst-1', params: { invertX: true } }],
        color: '#ff0000',
        layerPriority: 3,
        isLooping: true,
        duration: 8,
        totalFrames: 240,
        frameStart: 0,
        frameCount: null,
        playbackSettings: { mode: 'bpm', bpm: 128, duration: 2, beats: 4, speedMultiplier: 1 },
        startTime: 4,
    };

    it('copies the nested objects instead of sharing them', () => {
        const copy = deepCopy(cue);
        expect(copy.generatorParams).toEqual(cue.generatorParams);
        expect(copy.generatorParams).not.toBe(cue.generatorParams);
        expect(copy.effectOverrides.invert).not.toBe(cue.effectOverrides.invert);
        expect(copy.effects[0]).not.toBe(cue.effects[0]);
        expect(copy.playbackSettings).not.toBe(cue.playbackSettings);
        copy.generatorParams.radius = 99;
        expect(cue.generatorParams.radius).toBe(10);
    });

    it('gives the pasted cue a fresh id and its own copy of the payload', () => {
        const payload = cuePastePayload(cue, 'cue-2', 12);
        expect(payload.id).toBe('cue-2');
        expect(payload.startTime).toBe(12);
        expect(payload.generatorParams).not.toBe(cue.generatorParams);
        expect(payload.effectOverrides).not.toBe(cue.effectOverrides);
        expect(payload.effects).not.toBe(cue.effects);
        expect(payload.playbackSettings).not.toBe(cue.playbackSettings);
    });

    it('carries every field the cue had', () => {
        // The paste used to drop the colour, the priority, the playback
        // settings and the cue's own effects, so the copy was not the same
        // clip.
        const payload = cuePastePayload(cue, 'cue-2', 12);
        expect(payload.type).toBe(cue.type);
        expect(payload.name).toBe(cue.name);
        expect(payload.generatorId).toBe(cue.generatorId);
        expect(payload.color).toBe(cue.color);
        expect(payload.layerPriority).toBe(cue.layerPriority);
        expect(payload.isLooping).toBe(cue.isLooping);
        expect(payload.duration).toBe(cue.duration);
        expect(payload.totalFrames).toBe(cue.totalFrames);
        expect(payload.frameStart).toBe(cue.frameStart);
        expect(payload.frameCount).toBe(cue.frameCount);
        expect(payload.playbackSettings).toEqual(cue.playbackSettings);
        expect(payload.effects).toEqual(cue.effects);
    });

    it('does not carry the stale ILDA parse handle over', () => {
        const payload = cuePastePayload({ ...cue, workerId: 'worker-7' }, 'cue-2', 0);
        expect(payload.workerId).toBeNull();
    });

    it('gives every pasted keyframe its own id', () => {
        const keyframes = [
            { id: 'kf-1', time: 0, value: 1 },
            { id: 'kf-2', time: 1, value: 2 },
        ];
        const fresh = freshKeyframes(keyframes);
        expect(fresh.map((k) => k.id)).not.toContain('kf-1');
        expect(fresh.map((k) => k.id)).not.toContain('kf-2');
        expect(new Set(fresh.map((k) => k.id)).size).toBe(2);
        expect(fresh.map((k) => k.time)).toEqual([0, 1]);
        expect(fresh.map((k) => k.value)).toEqual([1, 2]);
    });

    it('leaves the original keyframes untouched', () => {
        const keyframes = [{ id: 'kf-1', time: 0, value: 1 }];
        freshKeyframes(keyframes);
        expect(keyframes[0].id).toBe('kf-1');
    });
});
