// Which clock drives the Timeline's playhead.
//
// The AUDIO element is the master clock while it is running, so the picture
// shows exactly what is heard. It used to be the other way round: the playhead
// ran on the requestAnimationFrame wall clock and the element was only dragged
// into agreement once it was already 200 ms out. The sound could therefore sit
// a fifth of a second behind the waveform - which is what "the audio is
// delayed" was - and the correction was a hard seek, so it arrived as a jump
// rather than a smooth re-sync.
//
// The wall clock is still the fallback. An element that has stopped advancing
// (buffering, a stalled decoder) must never freeze the show, so the transport
// keeps running and the element is re-seeked to catch up.

// How long the element may refuse to advance before it is re-seeked. Short
// enough to catch a stall quickly, long enough that the moment playback
// starts is not mistaken for one.
export const AUDIO_STALL_THRESHOLD = 0.15;

// Below this, the element has not moved.
const ADVANCE_EPSILON = 1e-4;

/**
 * The playhead for one frame of the internal (non-external) transport.
 *
 * @param {Object} state
 * @param {number} state.wallTime        the wall-clock position for this frame
 * @param {number|null} state.audioTime  the element's currentTime, null when it is not running
 * @param {number} state.lastAudioTime   the element's currentTime the last time it advanced
 * @param {number} state.stallSeconds    how long the element has refused to advance
 * @param {number} state.outputLatency   the graph's output latency, in seconds
 * @param {number|null} state.duration   the element's duration, for clamping the re-seek
 * @param {number} state.dt              the frame's elapsed time
 * @returns {{ time: number, advanced: boolean, stalled: boolean, reseekTo: number|null, stallSeconds: number, lastAudioTime: number }}
 */
export function resolveTransportTime({
    wallTime,
    audioTime,
    lastAudioTime,
    stallSeconds = 0,
    outputLatency = 0,
    duration = null,
    dt = 0,
    stallThreshold = AUDIO_STALL_THRESHOLD,
}) {
    // No element running: the wall clock is the only clock there is.
    if (audioTime === null || audioTime === undefined || !Number.isFinite(audioTime)) {
        return {
            time: wallTime, advanced: false, stalled: false,
            reseekTo: null, stallSeconds: 0, lastAudioTime,
        };
    }

    if (audioTime > lastAudioTime + ADVANCE_EPSILON) {
        // The element is advancing: follow it, less the output latency. What
        // is HEARD now is what the element was playing a moment ago, so the
        // playhead has to sit that far behind the element for the picture to
        // match the sound.
        return {
            time: Math.max(0, audioTime - outputLatency),
            advanced: true,
            stalled: false,
            reseekTo: null,
            stallSeconds: 0,
            lastAudioTime: audioTime,
        };
    }

    // It has not advanced. The show keeps running on the wall clock, and once
    // it has been stuck long enough the element is re-seeked to catch up.
    const stall = stallSeconds + dt;
    if (stall > stallThreshold) {
        // The element is placed AHEAD of the playhead by the output latency:
        // what is heard is the element's position minus that latency, and it
        // has to equal the playhead for the picture and the sound to match.
        const target = wallTime + outputLatency;
        const reseekTo = duration === null || !Number.isFinite(duration)
            ? Math.max(0, target)
            : Math.min(duration, Math.max(0, target));
        return {
            time: wallTime, advanced: false, stalled: true,
            reseekTo, stallSeconds: 0, lastAudioTime,
        };
    }
    return {
        time: wallTime, advanced: false, stalled: false,
        reseekTo: null, stallSeconds: stall, lastAudioTime,
    };
}
