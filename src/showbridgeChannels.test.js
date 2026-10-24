import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import dgram from 'dgram';

// The Showbridge firmware picks the target channel from header byte 3
// (0x00 -> CH1, 0x01 -> CH2) and reads the laser enable from the first two
// bytes of the frame payload: the high byte 0x00 means "laser off".
//
// Two bugs lived here:
//   - the channel constant was derived from the channel NUMBER ("channel 2 is
//     0x01, everything else is 0x00"), so a unit numbering its channels 0/1
//     put BOTH of them in the CH1 buffer and its second channel stayed dark.
//     It now follows the channel's POSITION in the unit.
//   - the POINT COUNT occupied the laser-enable word. A full 575-point frame
//     encodes as 0x023f, whose high byte is non-zero, so it read as "on" - but
//     any frame with fewer than 256 points encoded as 0x00xx and the DAC
//     switched the laser off.

const IP = '127.0.0.1';
const UDP_PACKET_SIZE = 0x1204;

let sent = [];
let showbridge;

beforeAll(async () => {
    vi.spyOn(dgram, 'createSocket').mockReturnValue({
        on: vi.fn(),
        send: (buf, ...rest) => {
            sent.push(buf);
            return true;
        },
        close: vi.fn(),
        setBroadcast: vi.fn(),
        bind: (port, addr, cb) => { if (cb) cb(); },
    });
    showbridge = await import('../main/showbridge-communication.cjs');
});

beforeEach(() => {
    sent = [];
});

afterAll(() => {
    vi.restoreAllMocks();
});

const frames = () => sent.filter((b) => b.length === UDP_PACKET_SIZE);

function sendFrame(channel, points) {
    showbridge.sendFrame(IP, channel, points, 30, null, {
        pps: 30000, targetPps: 30000, targetFps: 30, targetMode: 'varFpsFixedPps',
    });
}

describe('showbridge channel mapping', () => {
    it('puts the first channel of a 1/2-numbered unit in CH1 and the second in CH2', () => {
        showbridge.__setDiscoveryOrder(IP, [1, 2]);
        sendFrame(1, new Float32Array(8 * 4));
        sendFrame(2, new Float32Array(8 * 4));
        const types = frames().map((b) => b[3]);
        expect(types).toContain(0x00);
        expect(types).toContain(0x01);
    });

    it('puts the first channel of a 0/1-numbered unit in CH1 and the second in CH2', () => {
        // The old mapping sent 0x00 for BOTH of these, so the unit's second
        // channel never received a frame.
        showbridge.__setDiscoveryOrder(IP, [0, 1]);
        sendFrame(0, new Float32Array(8 * 4));
        sendFrame(1, new Float32Array(8 * 4));
        const types = frames().map((b) => b[3]);
        expect(types).toContain(0x00);
        expect(types).toContain(0x01);
    });

    it('does not swap the channels of a 2/3-numbered unit', () => {
        showbridge.__setDiscoveryOrder(IP, [2, 3]);
        sendFrame(2, new Float32Array(8 * 4));
        sendFrame(3, new Float32Array(8 * 4));
        const types = frames().map((b) => b[3]);
        expect(types).toContain(0x00);
        expect(types).toContain(0x01);
    });

    it('never sends a byte 3 that the firmware reads as another packet type', () => {
        // Only 0x00 (CH1) and 0x01 (CH2) are frame data. 0x02 is a settings
        // block and 0x03 a heartbeat - feeding a frame to those parsers would
        // write the unit's configuration.
        showbridge.__setDiscoveryOrder(IP, [1, 2, 3, 4, 5, 6]);
        for (const channel of [1, 2, 3, 4, 5, 6]) sendFrame(channel, new Float32Array(8 * 4));
        for (const f of frames()) {
            expect(f[3]).toBeLessThanOrEqual(0x01);
        }
    });
});

describe('showbridge laser enable word', () => {
    it('is on for a full frame', () => {
        showbridge.__setDiscoveryOrder(IP, [1, 2]);
        sendFrame(1, new Float32Array(8 * 4));
        const f = frames()[0];
        expect(f.readUInt8(5)).not.toBe(0);
    });

    it('is on for a small plain-array frame', () => {
        // The Show Control grid path sends plain point objects. 30 points used
        // to encode as 0x001e in the enable word, whose high byte is 0x00 ->
        // the DAC switched the laser off and the output stayed dark.
        showbridge.__setDiscoveryOrder(IP, [1, 2]);
        const plain = [];
        for (let i = 0; i < 30; i++) plain.push({ x: 0.1, y: 0.1, r: 1, g: 1, b: 1, blanking: 1 });
        sendFrame(1, plain);
        const f = frames()[0];
        expect(f.readUInt8(5)).not.toBe(0);
    });

    it('pads a plain-array frame out to a full chunk', () => {
        showbridge.__setDiscoveryOrder(IP, [1, 2]);
        const plain = [];
        for (let i = 0; i < 30; i++) plain.push({ x: 0.1, y: 0.1, r: 1, g: 1, b: 1, blanking: 1 });
        sendFrame(1, plain);
        const f = frames()[0];
        // The last point slot of a full chunk (575 points) is a padded,
        // blanked point at the first source position. Without the fill the
        // slot would still be zero. Point slot N sits at chunk byte 8 + N*8
        // (4 bytes of chunk header + 4 bytes of frame control).
        const lastSlot = 8 + 574 * 8;
        expect(f.readInt16LE(lastSlot)).toBe(2252);   // x = (0.1 + 1) * 2047.5
        expect(f.readUInt8(lastSlot + 4)).toBe(0);     // blanked (0 = dark on the wire)
        expect(f.readUInt8(lastSlot + 5)).toBe(0);     // no colour on a dark point
    });
});
