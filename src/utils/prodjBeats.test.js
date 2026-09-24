import { describe, it, expect } from 'vitest';
import {
    decodeProlinkPacket,
    PROLINK_BEAT_PACKET,
    PROLINK_ABS_POS_PACKET,
    PROLINK_PACKET_HEADER,
    END_TIMING,
} from './prodjBeats';

// Build a synthetic UDP 50001 packet of the requested length with the Pro DJ
// Link header + type placed as documented for port 50001.
const makePacket = ({ type, length = 96, deviceId = 1 }) => {
    const buf = Buffer.alloc(length);
    PROLINK_PACKET_HEADER.copy(buf, 0);
    buf[0x0a] = type;
    buf[0x21] = deviceId;
    return buf;
};

describe('decodeProlinkPacket', () => {
    it('decodes a beat packet (0x28) with next-beat countdown and BPM', () => {
        const buf = makePacket({ type: PROLINK_BEAT_PACKET, deviceId: 2 });
        buf.writeUInt32BE(500, 0x24); // nextBeat: 500 ms at 0% pitch
        buf.writeUInt16BE(12800, 0x5a); // BPM field is bpm × 100
        expect(decodeProlinkPacket(buf)).toEqual({
            kind: 'beat',
            deviceId: 2,
            nextBeatMs0: 500,
            bpm: 128,
        });
    });

    it('maps the end-of-track timing marker to null', () => {
        const buf = makePacket({ type: PROLINK_BEAT_PACKET });
        buf.writeUInt32BE(END_TIMING, 0x24);
        expect(decodeProlinkPacket(buf).nextBeatMs0).toBeNull();
    });

    it('decodes an absolute position packet (0x0b) with real playhead ms', () => {
        // The abs packet is short (~0x38) — it must not be gated on the
        // 96-byte beat-packet length.
        const buf = makePacket({ type: PROLINK_ABS_POS_PACKET, length: 0x38, deviceId: 3 });
        buf.writeUInt32BE(300, 0x24); // track length: 300 s
        buf.writeUInt32BE(137200, 0x28); // playhead: 137.2 s
        expect(decodeProlinkPacket(buf)).toEqual({
            kind: 'abs',
            deviceId: 3,
            trackLenSec: 300,
            playheadMs: 137200,
        });
    });

    it('returns null for unrelated packet kinds (on-air 0x03)', () => {
        expect(decodeProlinkPacket(makePacket({ type: 0x03 }))).toBeNull();
    });

    it('returns null for a bad header or short buffer', () => {
        const bad = Buffer.alloc(96);
        expect(decodeProlinkPacket(bad)).toBeNull();
        expect(decodeProlinkPacket(makePacket({ type: PROLINK_BEAT_PACKET, length: 40 }))).toBeNull();
        expect(decodeProlinkPacket(makePacket({ type: PROLINK_ABS_POS_PACKET, length: 0x20 }))).toBeNull();
        expect(decodeProlinkPacket(null)).toBeNull();
    });
});