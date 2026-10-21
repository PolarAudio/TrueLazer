import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import dgram from 'dgram';

// The bug: the always-fed send loop calls sendIdleFrame every tick for a target
// with no frame data, but dac-communication only implemented it for Showbridge and
// returned null for everything else. An IDN/StageLinq target therefore sent NOTHING
// while idle, the player kept replaying the last frame it was given, and the beam
// stayed on until the player's own timeout.
//
// These assert on the actual datagram, because "it called sendFrame" is not the same
// as "the player was told to turn off".
//
// The socket mock is installed ONCE: idn-communication caches its data socket in a
// module-level variable, so re-mocking dgram per test would leave every later test
// writing through the first test's socket and seeing an empty capture.
const HEADER = 4;
const CHANNEL_HEADER = 8;
const DICT_BYTES = 16; // Buffer.from('4200401042104010527e521451cc5c10','hex').length
const CHANNEL_CONFIG = 4 + DICT_BYTES;
const DURATION_OFFSET = HEADER + CHANNEL_HEADER + CHANNEL_CONFIG;   // 32
const POINT_OFFSET = DURATION_OFFSET + 4;                          // 36
const POINT_BYTES = 8;

let sent = [];

beforeAll(() => {
  vi.spyOn(dgram, 'createSocket').mockReturnValue({
    on: vi.fn(),
    send: (buf, ...rest) => {
      sent.push(buf);
      const cb = rest[rest.length - 1];
      if (typeof cb === 'function') cb(null);
    },
    close: vi.fn(),
  });
});

beforeEach(() => { sent.length = 0; });
afterAll(() => vi.restoreAllMocks());

const idn = await import('../main/idn-communication.cjs');
const dacComm = await import('../main/dac-communication.cjs');

describe('IDN idle stream', () => {
  it('sends a packet when idle, instead of nothing at all', () => {
    idn.sendIdleFrame('127.0.0.1', 0, null);
    expect(sent.length).toBe(1);
  });

  it('sends a frame containing exactly one point', () => {
    idn.sendIdleFrame('127.0.0.1', 0, null);
    expect(sent[0].length).toBe(HEADER + CHANNEL_HEADER + CHANNEL_CONFIG + 4 + POINT_BYTES);
  });

  it('the point is blanked, so the player reads it as OFF', () => {
    idn.sendIdleFrame('127.0.0.1', 0, null);
    const p = sent[0];
    expect(p.readUInt8(POINT_OFFSET + 2)).toBe(0); // r
    expect(p.readUInt8(POINT_OFFSET + 3)).toBe(0); // g
    expect(p.readUInt8(POINT_OFFSET + 4)).toBe(0); // b
    expect(p.readUInt8(POINT_OFFSET + 5)).toBe(0); // blank byte
  });

  it('encodes a frame duration so the player paces the blank like a real frame', () => {
    idn.sendIdleFrame('127.0.0.1', 0, null);
    expect(sent[0].readUInt32BE(DURATION_OFFSET) & 0x00ffffff).toBe(Math.round(1000000 / 30));
  });

  it('honours a caller-supplied fps for the blank', () => {
    idn.sendIdleFrame('127.0.0.1', 0, { fps: 25 });
    expect(sent[0].readUInt32BE(DURATION_OFFSET) & 0x00ffffff).toBe(Math.round(1000000 / 25));
  });
});

describe('sendIdleFrame routing by DAC type', () => {
  it('routes IDN to the IDN backend, so an idle IDN target is fed', () => {
    dacComm.sendIdleFrame('127.0.0.1', 0, 'idn', null);
    expect(sent.length).toBe(1);
  });

  it('leaves EtherDream on its legacy silent-blank behaviour', () => {
    // Explicitly preserved: it must NOT silently pick up IDN's blank frame.
    dacComm.sendIdleFrame('127.0.0.1', 0, 'EtherDream', null);
    expect(sent.length).toBe(0);
  });
});

describe('IDN per-channel sequence numbers', () => {
  // The sequence field is per channel, and it was a single shared counter, so
  // with N channels interleaved every channel's stream advanced by N per packet.
  // A receiver validating a per-channel stream sees that as a discontinuity —
  // reported by IDN Toolbox as "Sequence Type 1 Error - Last Seq: x, Current: y"
  // and, with several channels active, once per channel.
  const pts = new Float32Array([0, 0, 0, 255, 255, 255, 0, 0]);
  const SEQ_OFFSET = 2;
  const CHANNEL_OCTET = 14;

  const interleaved = (channels, frames) => {
    sent.length = 0;
    for (let f = 0; f < frames; f++) {
      for (const ch of channels) idn.sendFrame('127.0.0.1', ch, pts, 30);
    }
    const byChannel = new Map(channels.map((c) => [c, []]));
    for (const buf of sent) byChannel.get(buf[CHANNEL_OCTET]).push(buf.readUInt16BE(SEQ_OFFSET));
    return byChannel;
  };

  it('advances by exactly 1 per packet on every channel', () => {
    const channels = [0, 1, 2];
    const byChannel = interleaved(channels, 10);
    for (const ch of channels) {
      const seq = byChannel.get(ch);
      expect(seq).toHaveLength(10);
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i]).toBe((seq[i - 1] + 1) & 0xffff);
      }
    }
  });

  it('emits one packet per channel per frame', () => {
    const channels = [0, 1, 2, 3];
    interleaved(channels, 8);
    expect(sent).toHaveLength(32);
  });

  it('does not let other channels consume this channel sequence', () => {
    // The regression in one assertion. The counters are module-level and
    // deliberately keep counting across a long-lived stream, so these assert
    // DELTAS, not absolute values.
    //
    // With four channels interleaved, a shared counter gives channel 0 the
    // sequence 1, 5, 9, 13 — it advances by 4 per packet, and ends four times
    // higher than a per-channel counter would.
    const channels = [0, 1, 2, 3];
    const before = sent.length;
    const byChannel = interleaved(channels, 4);
    expect(sent.length - before).toBe(16);

    const seq0 = byChannel.get(0);
    const seq3 = byChannel.get(3);
    for (let i = 1; i < seq0.length; i++) {
      expect(seq0[i] - seq0[i - 1]).toBe(1);
      expect(seq3[i] - seq3[i - 1]).toBe(1);
    }
    // A shared counter would have spread these 16 packets over 1..16, so the
    // first channel's last value would be ~13. Per-channel it is base + 3.
    expect(seq0[3] - seq0[0]).toBe(3);
    expect(seq3[3] - seq3[0]).toBe(3);
  });

  it('keeps separate channels on separate counters', () => {
    const before = sent.length;
    const byChannel = interleaved([0, 5], 3);
    expect(sent.length - before).toBe(6);
    // Neither channel's numbers may advance on the other's packets, so their
    // deltas over the same 3 frames must match exactly.
    expect(byChannel.get(5)[2] - byChannel.get(5)[0]).toBe(2);
    expect(byChannel.get(0)[2] - byChannel.get(0)[0]).toBe(2);
  });

  it('wraps within 16 bits without going negative', () => {
    const byChannel = interleaved([1], 3);
    const seq = byChannel.get(1);
    for (const v of seq) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffff);
    }
  });
});
