import { describe, it, expect, vi } from 'vitest';
import { pickPasteChannel, computeArrowSeek, pressSpacePlayPause, spaceReplayFromAnchor } from './useTimelineShortcuts';

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