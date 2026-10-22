import { describe, it, expect } from 'vitest';
import { AUDIO_STALL_THRESHOLD, resolveTransportTime } from './timelineTransport';

/**
 * The Timeline's playhead used to run on the wall clock and the audio element
 * was only dragged into agreement once it was already 200 ms out, so the sound
 * could sit a fifth of a second behind the waveform. These tests pin the new
 * behaviour: the element is the master while it runs, and a stalled element
 * must never freeze the show.
 */
describe('resolveTransportTime', () => {
    const base = {
        wallTime: 10,
        lastAudioTime: 9.9,
        stallSeconds: 0,
        outputLatency: 0,
        duration: 120,
        dt: 0.016,
    };

    it('follows the audio element while it advances', () => {
        const r = resolveTransportTime({ ...base, audioTime: 10.05 });
        expect(r.time).toBeCloseTo(10.05);
        expect(r.advanced).toBe(true);
        expect(r.stalled).toBe(false);
        expect(r.reseekTo).toBeNull();
    });

    it('sits the output latency behind the element, so picture matches sound', () => {
        // What is HEARD now is what the element was playing a moment ago.
        const r = resolveTransportTime({ ...base, audioTime: 10.05, outputLatency: 0.02 });
        expect(r.time).toBeCloseTo(10.03);
    });

    it('never goes behind the start of the timeline', () => {
        const r = resolveTransportTime({ ...base, audioTime: 0.005, lastAudioTime: 0, outputLatency: 0.02 });
        expect(r.time).toBe(0);
    });

    it('keeps the show running on the wall clock when the element is stuck', () => {
        const r = resolveTransportTime({ ...base, audioTime: 9.9, stallSeconds: 0.05 });
        // The transport does not freeze: it keeps the wall-clock position.
        expect(r.time).toBe(10);
        expect(r.advanced).toBe(false);
        expect(r.stalled).toBe(false);
        expect(r.stallSeconds).toBeGreaterThan(0);
    });

    it('re-seeks a stuck element to the wall clock once it has been stuck long enough', () => {
        const r = resolveTransportTime({
            ...base, audioTime: 9.9, stallSeconds: AUDIO_STALL_THRESHOLD,
        });
        expect(r.stalled).toBe(true);
        expect(r.reseekTo).toBe(10);
        expect(r.stallSeconds).toBe(0);
    });

    it('clamps the re-seek to the element duration', () => {
        const r = resolveTransportTime({
            ...base, wallTime: 500, audioTime: 9.9, stallSeconds: AUDIO_STALL_THRESHOLD, duration: 120,
        });
        expect(r.reseekTo).toBe(120);
    });

    it('uses the wall clock when there is no element at all', () => {
        const r = resolveTransportTime({ ...base, audioTime: null });
        expect(r.time).toBe(10);
        expect(r.advanced).toBe(false);
        expect(r.reseekTo).toBeNull();
    });

    it('treats the moment playback starts as a stall only briefly', () => {
        // The element is seeked to the playhead and then starts, so on the
        // first frame it has not moved yet. That must not be mistaken for a
        // long stall, or the element would be yanked around at the start.
        const r = resolveTransportTime({ ...base, audioTime: 10, lastAudioTime: 10, stallSeconds: 0 });
        expect(r.stalled).toBe(false);
        expect(r.reseekTo).toBeNull();
    });
});
