/**
 * Timecode sync decoders for the Timeline window.
 *
 * Four external sync sources are supported:
 *   1. MTC  (MIDI Timecode)      — quarter-frame (0xF1) + full-frame SysEx
 *   2. MIDI Clock                — 0xF8 ticks @ 24 PPQN (0xFA/0xFB/0xFC)
 *   3. LTC   (Linear Timecode)   — biphase-mark audio signal decode
 *   4. ArtNet Timecode           — ArtTimeCode (opcode 0x9700) UDP packets
 *
 * Design: one pure module per codec. The decoder objects are stateful but
 * dependency-free (feed them raw bytes / raw floats, poll for decoded frames),
 * so everything is unit-testable without MIDI hardware, audio devices or a
 * network stack. Frame indexing is inherently frame-rate dependant, so the
 * callers supply the expected frame rate where required.
 */

export const MTC_RATE = { '24': 0, '25': 1, '30df': 2, '30': 3 };
export const MTC_RATE_NAMES = ['24', '25', '30df', '30'];

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

/** BCD pack helpers for the field nibbles. */
const bcd = (v) => ({
    units: v % 10,
    tens: Math.floor(v / 10) % 10,
});

export const timecodeToSeconds = ({ hours = 0, minutes = 0, seconds = 0, frames = 0 }, fps = 30) =>
    hours * 3600 + minutes * 60 + seconds + frames / fps;

const pad2 = (n) => String(n).padStart(2, '0');

export const formatTimecode = (tc, fps = 30) =>
    `${pad2(tc.hours)}:${pad2(tc.minutes)}:${pad2(tc.seconds)}:${pad2(tc.frames)}`;

/* ------------------------------------------------------------------ *
 *  MTC — MIDI Timecode
 *
 *  Quarter-frame: status 0xF1, data byte = (piece << 4) | nibble.
 *    piece 0→frames units, 1→frames tens, 2→secs units, 3→secs tens,
 *    4→mins units, 5→mins tens, 6→hours units, 7→hours tens.
 *  8 quarter frames (0..7) reassemble one timecode frame.
 *
 *  Full-frame SysEx: F0 7F <dev> 01 01 <hr> <mn> <sc> <fr> [user...] F7.
 *  Hours byte: bits 5-6 carry the rate code, mask & 0x1F for the BCD value.
 * ------------------------------------------------------------------ */

export class MtcQuarterFrameDecoder {
    constructor() {
        this.nibbles = new Array(8).fill(-1);
        this.expectedPiece = 0;
        this.hasCycle = false;
        this.frames = null;
    }

    /**
     * Feed MIDI message bytes (status + data). Returns the decoded timecode
     * { hours, minutes, seconds, frames } whenever a complete 8-frame cycle
     * has been reassembled, otherwise null.
     */
    push(bytes) {
        if (!bytes) return null;
        const arr = Array.isArray(bytes) ? bytes : Array.from(bytes);
        let timecode = null;
        for (let i = 0; i < arr.length; i++) {
            const b = arr[i];
            if (b === 0xF1 && i + 1 < arr.length) {
                const data = arr[++i];
                const piece = (data >> 4) & 0x07;
                const nibble = data & 0x0F;
                this.nibbles[piece] = nibble;
                if (!this.hasCycle && piece === 0) this.hasCycle = true;
                timecode = this._assemble();
            }
        }
        return timecode;
    }

    _assemble() {
        if (!this.hasCycle || this.nibbles.some((n) => n < 0)) return null;
        const [fu, ft, su, st, mu, mt, hu, ht] = this.nibbles;
        // The hours-ten quarter frame also carries the 2-bit rate code in its
        // upper nibble. Basic sync only needs the BCD value.
        const out = {
            hours: hu + (ht & 0x0F) * 10,
            minutes: mu + mt * 10,
            seconds: su + st * 10,
            frames: fu + ft * 10,
        };
        if (out.frames > 60 || out.seconds > 60 || out.minutes > 60 || out.hours > 23) return null;
        this.nibbles = this.nibbles.map(() => -1);
        return out;
    }
}

/** Decode an MTC full-frame SysEx message into a timecode object. */
export function decodeMtcFullFrame(bytes) {
    if (!bytes || bytes.length < 11) return null;
    const arr = Array.isArray(bytes) ? bytes : Array.from(bytes);
    if (arr[0] !== 0xF0 || arr[1] !== 0x7F) return null;
    // Locate the "01 01" (MT 1.1 full-frame) signature, then read the four
    // timecode bytes that follow it. Device/user bytes between are skipped.
    let i = 2;
    while (i < arr.length - 5) {
        if (arr[i] === 0x01 && arr[i + 1] === 0x01) break;
        i++;
    }
    if (i >= arr.length - 5) return null;
    i += 2;
    if (arr[i] === 0xF7) return null;
    const hr = arr[i] & 0x1F;
    const mn = arr[i + 1];
    const sc = arr[i + 2];
    const fr = arr[i + 3];
    const rate = (arr[i] >> 5) & 0x03;
    return {
        hours: (hr >> 4) * 10 + (hr & 0x0F),
        minutes: (mn >> 4) * 10 + (mn & 0x0F),
        seconds: (sc >> 4) * 10 + (sc & 0x0F),
        frames: (fr >> 4) * 10 + (fr & 0x0F),
        rate,
    };
}

/* ------------------------------------------------------------------ *
 *  MIDI Clock
 *
 *  Real-time messages: 0xF8 = 24 PPQN clock tick, 0xFA = start,
 *  0xFB = continue, 0xFC = stop. Position = ticks / (24 * secondsPerBeat).
 *  Song Position Pointer (0xF2) is used as a position override.
 * ------------------------------------------------------------------ */

export class MidiClockTracker {
    /**
     * @param {number} bpm expected tempo (used to convert ticks → seconds)
     */
    constructor(bpm = 120) {
        this.bpm = bpm;
        this.ticks = 0;
        this.running = false;
        this.frameSeconds = 0;
        this.lastTickAt = null;
    }

    get ppq() {
        return 24;
    }

    get secondsPerTick() {
        return 60 / this.bpm / 24;
    }

    setBpm(bpm) {
        if (bpm && bpm > 0) this.bpm = bpm;
    }

    /**
     * Feed MIDI message bytes. Returns a status snapshot:
     * { running, ticks, seconds }.
     */
    push(bytes) {
        const arr = bytes ? (Array.isArray(bytes) ? bytes : Array.from(bytes)) : [];
        for (let i = 0; i < arr.length; i++) {
            const b = arr[i];
            if (b === 0xF8) {
                this.ticks++;
            } else if (b === 0xF2 && i + 2 < arr.length) {
                const lo = arr[++i];
                const hi = arr[++i];
                this.ticks = (lo | (hi << 7)) * 6; // SPP in 16ths → ticks
            } else if (b === 0xFA || b === 0xFB) {
                if (b === 0xFA) this.ticks = 0;
                this.running = true;
            } else if (b === 0xFC) {
                this.running = false;
            }
        }
        this.frameSeconds = this.ticks * this.secondsPerTick;
        return { running: this.running, ticks: this.ticks, seconds: this.frameSeconds };
    }
}

/* ------------------------------------------------------------------ *
 *  LTC — Linear Timecode (biphase mark audio)
 *
 *  Bit encoding: a transition occurs at every bit boundary. A "0" is a
 *  single pulse spanning the whole bit cell (long). A "1" adds a
 *  transition at the cell midpoint (two short pulses).
 *
 *  Frame (80 bits, transmission order, each data group LSB-first):
 *    0-3   frames units | 4  user0 | 5-7   frames tens
 *    8     drop-frame   | 9  color-frame
 *    10-13 seconds units| 14 user1 | 15-17 seconds tens | 18 clock-run | 19 pad
 *    20-23 minutes units| 24 user2 | 25-27 minutes tens | 28-29 pad
 *    30-33 hours units  | 34 user3 | 35-37 hours tens   | 38-39 pad
 *    40-63 day/user data (ignored for basic framing)
 *    64-79 16-bit sync word 0011 1111 1111 0001
 * ------------------------------------------------------------------ */

// 16-bit sync word, transmission order (bit 0 = first).
export const LTC_SYNC_WORD = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1];

/**
 * Write one 80-bit frame of biphase-mark level into `out` starting at
 * `offset`. Returns the carry-over level so consecutive frames stay phase
 * continuous (real LTC is a single unbroken signal).
 */
function writeLtcFrameBiphase(bits, out, offset, level, cell) {
    const n = out.length;
    for (let k = 0; k < bits.length; k++) {
        const start = Math.round(offset + k * cell);
        const mid = Math.round(start + cell / 2);
        const end = Math.round(offset + (k + 1) * cell);
        level = -level; // boundary transition
        const limit = Math.min(n, Math.max(mid, end));
        for (let i = start; i < limit; i++) out[i] = level;
        if (bits[k] === 1) {
            level = -level; // midpoint transition for a "1"
            for (let i = mid; i < Math.min(n, end); i++) out[i] = level;
        }
    }
    return level;
}

/**
 * Encode a timecode into a biphase-mark Float32Array (LTC encode).
 * Used for decoder validation / tests / signal generation.
 */
export function encodeLtcBlock({ hours = 0, minutes = 0, seconds = 0, frames = 0 }, { fps = 30, sampleRate = 48000 } = {}) {
    const bits = buildLtcBits({ hours, minutes, seconds, frames });
    const cell = sampleRate / (fps * 80); // samples per bit cell
    const n = Math.ceil(80 * cell) + 2; // small tail leaves a final boundary transition
    const out = new Float32Array(n);
    writeLtcFrameBiphase(bits, out, 0, 1, cell);
    // Final boundary transition at the sync-word end.
    for (let i = Math.min(n - 1, Math.round(80 * cell)); i < n; i++) out[i] = -out[i - 1] || -1;
    return out;
}

/**
 * Encode several timecodes as one continuous LTC signal (no padding between
 * frames) — the format a real source produces.
 */
export function encodeLtcFrames(frames, { fps = 30, sampleRate = 48000 } = {}) {
    const cell = sampleRate / (fps * 80);
    const per = Math.ceil(80 * cell);
    const out = new Float32Array(per * frames.length);
    let level = 1;
    for (let i = 0; i < frames.length; i++) {
        level = writeLtcFrameBiphase(buildLtcBits(frames[i]), out, i * per, level, cell);
    }
    return out;
}

export function buildLtcBits({ hours = 0, minutes = 0, seconds = 0, frames = 0 }) {
    const f = bcd(frames);
    const s = bcd(seconds);
    const m = bcd(minutes);
    const h = bcd(hours);
    const bits = new Array(80).fill(0);
    const put = (offset, lowBits, value) => {
        let v = value;
        for (let k = 0; k < lowBits; k++) {
            bits[offset + k] = v & 1;
            v >>= 1;
        }
    };
    put(0, 4, f.units);
    put(5, 3, f.tens);
    bits[8] = 0; // drop frame
    bits[9] = 0; // color frame
    put(10, 4, s.units);
    put(15, 3, s.tens);
    bits[18] = 0; // clock run (0 = valid)
    put(20, 4, m.units);
    put(25, 3, m.tens);
    put(30, 4, h.units);
    put(35, 3, h.tens);
    for (let k = 0; k < 16; k++) bits[64 + k] = LTC_SYNC_WORD[k];
    return bits;
}

export function decodeLtcBits(bits) {
    const fUnits = (bits[0] | (bits[1] << 1) | (bits[2] << 2) | (bits[3] << 3));
    const fTens = (bits[5] | (bits[6] << 1) | (bits[7] << 2));
    const sUnits = (bits[10] | (bits[11] << 1) | (bits[12] << 2) | (bits[13] << 3));
    const sTens = (bits[15] | (bits[16] << 1) | (bits[17] << 2));
    const mUnits = (bits[20] | (bits[21] << 1) | (bits[22] << 2) | (bits[23] << 3));
    const mTens = (bits[25] | (bits[26] << 1) | (bits[27] << 2));
    const hUnits = (bits[30] | (bits[31] << 1) | (bits[32] << 2) | (bits[33] << 3));
    const hTens = (bits[35] | (bits[36] << 1) | (bits[37] << 2));
    return {
        hours: hUnits + hTens * 10,
        minutes: mUnits + mTens * 10,
        seconds: sUnits + sTens * 10,
        frames: fUnits + fTens * 10,
        dropFrame: bits[8] === 1,
    };
}

/**
 * Stateful biphase-mark LTC audio decoder. Feed it raw mono float samples
 * (≈ [-1, 1]); poll `decode()` for a fresh timecode whenever a full valid
 * 80-bit frame has been recovered.
 */
export class LtcBiphaseDecoder {
    /**
     * @param {number} fps expected linear timecode frame rate (24/25/30/30df)
     * @param {number} sampleRate audio sample rate of the feed
     */
    constructor({ fps = 30, sampleRate = 48000 } = {}) {
        this.fps = fps;
        this.sampleRate = sampleRate;
        this.cell = sampleRate / (fps * 80); // samples per bit cell
        this.half = this.cell / 2;
        this._prev = 0;
        this._lastIdx = -1;
        this._sampleIdx = -1;
        this._pulses = []; // pulse sample widths since last boundary
        this._total = 0;
        this._bits = [];
        this._frame = null;
        this._lastFrame = null;
        this.framesDecoded = 0;
    }

    /**
     * Feed a block of mono float samples. Returns the latest decoded
     * timecode after each push (or null while hunting for a sync word).
     */
    push(samples) {
        let prev = this._prev;
        let sampleIdx = this._sampleIdx;
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            // Digital-zero silence (`prev === 0`) counts as the neutral pole,
            // so the very first transition into the signal is a valid pulse.
            const crossing = (prev < 0 && s >= 0.01)
                || (prev >= 0.01 && s < 0)
                || (prev === 0 && Math.abs(s) >= 0.01);
            prev = s;
            sampleIdx++;
            if (crossing) {
                if (this._lastIdx >= 0) {
                    this._pulse(sampleIdx - this._lastIdx);
                }
                this._lastIdx = sampleIdx;
            }
        }
        this._prev = prev;
        this._sampleIdx = sampleIdx;
        return this._frame;
    }

    /** Latest decoded timecode (null until a valid frame locks in). */
    decode() {
        return this._frame;
    }

    _pulse(width) {
        const cell = this.cell;
        const half = this.half;
        const tol = cell * 0.22;
        this._pulses.push(width);
        this._total += width;
        if (Math.abs(this._total - cell) <= tol) {
            // Boundary reached: decode the bit pattern collected this cell.
            const pulses = this._pulses;
            let bit = null;
            if (pulses.length === 1 && Math.abs(pulses[0] - cell) <= tol) bit = 0;
            else if (pulses.length === 2 && Math.abs(pulses[0] - half) <= tol && Math.abs(pulses[1] - half) <= tol) bit = 1;
            this._pulses = [];
            this._total = 0;
            if (bit == null) {
                this._bits = [];
                return;
            }
            this._bits.push(bit);
            if (this._bits.length >= 80) this._checkFrame();
        } else if (this._total > cell + tol) {
            // Overshot the cell window — misaligned; resync from scratch.
            this._pulses = [];
            this._total = 0;
            this._bits = [];
        }
    }

    _checkFrame() {
        const sync = LTC_SYNC_WORD;
        // Search for the sync word at any alignment with full 64 data bits
        // before it. The capture can be off by a bit (the opening transition
        // of a stream is not measurable), so the fixed offset check is not
        // sufficient — hunt for the best (newest) valid frame instead.
        for (let align = this._bits.length - 16; align >= 64; align--) {
            let ok = true;
            for (let k = 0; k < 16; k++) {
                if (this._bits[align + k] !== sync[k]) { ok = false; break; }
            }
            if (!ok) continue;
            const data = this._bits.slice(align - 64, align);
            const tc = decodeLtcBits(data);
            if (tc && tc.frames < 61 && tc.seconds < 61 && tc.minutes < 61 && tc.hours < 25) {
                this._frame = tc;
                this._lastFrame = tc;
                this.framesDecoded++;
                // Keep the bits right after the sync word so the next frame
                // aligns without hunting again from scratch.
                this._bits = this._bits.slice(align + 16);
                return;
            }
        }
        // Keep hunting: drop the oldest bit and re-check on the next boundary.
        this._bits.shift();
    }
}

/* ------------------------------------------------------------------ *
 *  ArtNet TimeCode (ArtTimeCode opcode 0x9700)
 *
 *  Wire format (19 bytes, per Art-Net 4 + common reference impls):
 *    bytes 0-6   "Art-Net"                (byte 7 = null terminator)
 *    bytes 8-9   OpCode 0x9700 (UInt16LE)
 *    bytes 10-11 ProtVer Hi/Lo (= 0x00e)
 *    byte 12     Filler1 = 0
 *    byte 13     StreamId (0x00 = master)
 *    byte 14     Frames | 15 Seconds | 16 Minutes | 17 Hours | 18 Type
 * ------------------------------------------------------------------ */

export function parseArtnetTimecode(buffer) {
    if (!buffer || buffer.length < 19) return null;
    const bytes = buffer instanceof Uint8Array || Buffer.isBuffer(buffer)
        ? buffer
        : new Uint8Array(buffer);
    let s = '';
    for (let i = 0; i < 8; i++) s += String.fromCharCode(bytes[i]);
    if (s.slice(0, 7) !== 'Art-Net') return null;
    const opcode = bytes[8] | (bytes[9] << 8);
    if (opcode !== 0x9700) return null;
    return {
        hours: bytes[17],
        minutes: bytes[16],
        seconds: bytes[15],
        frames: bytes[14],
        type: bytes[18],
    };
}

/** Build a raw ArtTimeCode packet (for tests / generators). */
export function encodeArtnetTimecode({ hours, minutes, seconds, frames, type = 3 } = {}) {
    const buf = new Uint8Array(19);
    'Art-Net\0'.split('').forEach((c, i) => { buf[i] = c.charCodeAt(0); });
    buf[8] = 0x00;
    buf[9] = 0x97;
    buf[10] = 0x00;
    buf[11] = 0x0e;
    buf[12] = 0;
    buf[13] = 0;
    buf[14] = frames;
    buf[15] = seconds;
    buf[16] = minutes;
    buf[17] = hours;
    buf[18] = type;
    return buf;
}