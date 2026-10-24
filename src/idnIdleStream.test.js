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
const POINT_BYTES = 8;

// The config header is only present on the first frame and then periodically,
// so offsets depend on the CCLF bit in the content ID.
const contentIDOf = (buf) => buf.readUInt16BE(HEADER + 2);
const hasConfig = (buf) => (contentIDOf(buf) & 0x4000) !== 0;
const configBytes = (buf) => (hasConfig(buf) ? CHANNEL_CONFIG : 0);
const durationOffset = (buf) => HEADER + CHANNEL_HEADER + configBytes(buf);
const pointOffset = (buf) => durationOffset(buf) + 4;
const channelIdOf = (buf) => (contentIDOf(buf) >> 8) & 0x3f;

let sent = [];
let sentTo = [];

beforeAll(() => {
  vi.spyOn(dgram, 'createSocket').mockReturnValue({
    on: vi.fn(),
    send: (buf, ...rest) => {
      sent.push(buf);
      // dgram signature used here: send(msg, offset, length, port, address)
      sentTo.push(rest[3]);
      const cb = rest[rest.length - 1];
      if (typeof cb === 'function') cb(null);
    },
    close: vi.fn(),
  });
});

beforeEach(() => { sent.length = 0; sentTo.length = 0; });
afterAll(() => vi.restoreAllMocks());

const idn = await import('../main/idn-communication.cjs');
const dacComm = await import('../main/dac-communication.cjs');

describe('IDN idle stream', () => {
  it('sends a packet when idle, instead of nothing at all', () => {
    idn.sendIdleFrame('127.0.0.1', 0, null);
    expect(sent.length).toBe(1);
  });

  it('sends a frame with exactly two valid samples', () => {
    idn.sendIdleFrame('127.0.0.1', 0, null);
    const p = sent[0];
    expect(p.length).toBe(HEADER + CHANNEL_HEADER + configBytes(p) + 4 + 2 * POINT_BYTES);
    expect((p.length - pointOffset(p)) / POINT_BYTES).toBe(2);
  });

  it('both samples are blanked, so the player reads them as OFF', () => {
    idn.sendIdleFrame('127.0.0.1', 0, null);
    const p = sent[0];
    const off = pointOffset(p);
    for (let i = 0; i < 2; i++) {
      const o = off + i * POINT_BYTES;
      expect(p.readUInt8(o + 2)).toBe(0); // r
      expect(p.readUInt8(o + 3)).toBe(0); // g
      expect(p.readUInt8(o + 4)).toBe(0); // b
      expect(p.readUInt8(o + 5)).toBe(0); // blank byte
    }
  });

  it('encodes a frame duration so the player paces the blank like a real frame', () => {
    idn.sendIdleFrame('127.0.0.1', 0, null);
    expect(sent[0].readUInt32BE(durationOffset(sent[0])) & 0x00ffffff).toBe(Math.round(1000000 / 30));
  });

  it('honours a caller-supplied fps for the blank', () => {
    idn.sendIdleFrame('127.0.0.1', 0, { fps: 25 });
    expect(sent[0].readUInt32BE(durationOffset(sent[0])) & 0x00ffffff).toBe(Math.round(1000000 / 25));
  });
});

describe('IDN message total size', () => {
  // The IDN channel-message header's totalSize covers the IDN message only,
  // i.e. everything AFTER the 4-byte packet header (command/flags/sequence),
  // and is big-endian. It used to be written little-endian, so 1728 (0x06C0)
  // was read back by strict players as 49158 (0xC006) and every packet was
  // dropped as a length mismatch.
  it('equals the UDP payload minus the 4-byte packet header', () => {
    idn.sendIdleFrame('127.0.0.1', 0, null);
    expect(sent[0].readUInt16BE(HEADER)).toBe(sent[0].length - HEADER);
  });

  it('is encoded in network byte order (big-endian)', () => {
    idn.sendIdleFrame('127.0.0.1', 0, null);
    expect(sent[0].readUInt16BE(HEADER)).not.toBe(sent[0].readUInt16LE(HEADER));
  });

  it('accounts for the optional channel config, chunk header and every sample', () => {
    const pts = new Float32Array([0, 0, 0, 255, 255, 255, 0, 0]);
    idn.sendFrame('127.0.0.1', 0, pts, 30);
    const p = sent[0];
    expect(p.readUInt16BE(HEADER)).toBe(CHANNEL_HEADER + configBytes(p) + 4 + POINT_BYTES);
  });

  it('sends the config header once, not on every frame', () => {
    const pts = new Float32Array([0, 0, 0, 255, 255, 255, 0, 0]);
    idn.sendFrame('127.0.0.9', 0, pts, 30);
    idn.sendFrame('127.0.0.9', 0, pts, 30);
    expect(hasConfig(sent[0])).toBe(true);
    expect(hasConfig(sent[1])).toBe(false);
  });

  it('puts each service on its own IDN channel ID', () => {
    // The app's `channel` is a service ID. The content-ID channel ID must follow
    // it; hard-coding 0 made every service share one logical channel so the
    // player re-routed (and closed/re-opened) its output on every packet.
    const pts = new Float32Array([0, 0, 0, 255, 255, 255, 0, 0]);
    idn.sendFrame('127.0.0.10', 1, pts, 30);
    idn.sendFrame('127.0.0.10', 2, pts, 30);
    expect(channelIdOf(sent[0])).toBe(1);
    expect(channelIdOf(sent[1])).toBe(2);
    // Routing still addresses the service via the config header.
    expect(sent[0].readUInt8(HEADER + CHANNEL_HEADER + 2)).toBe(1); // serviceID
  });

  it('writes a monotonic big-endian microsecond timestamp', () => {
    const pts = new Float32Array([0, 0, 0, 255, 255, 255, 0, 0]);
    idn.sendFrame('127.0.0.11', 0, pts, 30);
    idn.sendFrame('127.0.0.11', 0, pts, 30);
    const ts0 = sent[0].readUInt32BE(HEADER + 4);
    const ts1 = sent[1].readUInt32BE(HEADER + 4);
    expect(ts1).toBeGreaterThanOrEqual(ts0);
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

describe('IDN link teardown', () => {
  const pts = new Float32Array([0, 0, 0, 255, 255, 255, 0, 0]);

  it('sends a graceful link-close command instead of an empty frame', () => {
    // A zero-point frame on channel 0 does not close anything: when its routing
    // was due it asked the receiver for a second inlet on an already-used service
    // ("Failed to request inlet") and the real channel only died on the ~10 s link
    // inactivity timeout. Empty 0x44 closes the connection immediately.
    idn.sendFrame('127.0.0.20', 1, pts, 30);
    sent.length = 0;
    idn.sendCloseChannel('127.0.0.20');
    expect(sent).toHaveLength(1);
    expect(sent[0].length).toBe(4);
    expect(sent[0].readUInt8(0)).toBe(0x44);
  });

  it('continues the link sequence and re-sends config on the next session', () => {
    idn.sendFrame('127.0.0.21', 1, pts, 30);
    idn.sendFrame('127.0.0.21', 1, pts, 30);
    expect(hasConfig(sent[0])).toBe(true);
    expect(hasConfig(sent[1])).toBe(false);
    const lastSeq = sent[1].readUInt16BE(2);
    idn.sendCloseChannel('127.0.0.21');
    expect(sent[2].readUInt16BE(2)).toBe((lastSeq + 1) & 0xffff);
    idn.sendFrame('127.0.0.21', 1, pts, 30);
    expect(hasConfig(sent[3])).toBe(true);
  });
});

describe('IDN realtime packet sequence numbers', () => {
  // The sequence lives in the IDN-RT packet header and is validated by the
  // receiver once per link/connection: every datagram from this sender must
  // advance one shared counter by exactly 1, no matter which channel it carries.
  // Per-channel counters made interleaved channels report a constant stream of
  // symmetric "Out of sequence (N lost)" / "(N early)" errors in IDN Toolbox.
  const pts = new Float32Array([0, 0, 0, 255, 255, 255, 0, 0]);
  const SEQ_OFFSET = 2;

  const sendInterleaved = (ips, channels, frames) => {
    sent.length = 0;
    sentTo.length = 0;
    for (let f = 0; f < frames; f++) {
      for (const ip of ips) {
        for (const ch of channels) idn.sendFrame(ip, ch, pts, 30);
      }
    }
  };

  const byDestination = () => {
    const map = new Map();
    sent.forEach((buf, i) => {
      const ip = sentTo[i];
      if (!map.has(ip)) map.set(ip, []);
      map.get(ip).push(buf);
    });
    return map;
  };

  it('advances by exactly 1 per datagram across all channels on one link', () => {
    sendInterleaved(['127.0.0.1'], [0, 1, 2], 5);
    const bufs = byDestination().get('127.0.0.1');
    expect(bufs).toHaveLength(15);
    for (let i = 1; i < bufs.length; i++) {
      expect(bufs[i].readUInt16BE(SEQ_OFFSET)).toBe(
        (bufs[i - 1].readUInt16BE(SEQ_OFFSET) + 1) & 0xffff,
      );
    }
  });

  it('emits one datagram per channel per frame', () => {
    sendInterleaved(['127.0.0.1'], [0, 1, 2, 3], 8);
    expect(sent).toHaveLength(32);
    expect(new Set(sent.map(channelIdOf))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('keeps an independent counter per destination DAC', () => {
    sendInterleaved(['127.0.0.1', '127.0.0.2'], [0], 4);
    const byDest = byDestination();
    for (const ip of ['127.0.0.1', '127.0.0.2']) {
      const bufs = byDest.get(ip);
      expect(bufs).toHaveLength(4);
      for (let i = 1; i < bufs.length; i++) {
        expect(bufs[i].readUInt16BE(SEQ_OFFSET)).toBe(
          (bufs[i - 1].readUInt16BE(SEQ_OFFSET) + 1) & 0xffff,
        );
      }
    }
  });

  it('wraps within 16 bits without going negative', () => {
    sendInterleaved(['127.0.0.1'], [1], 3);
    for (const buf of sent) {
      const v = buf.readUInt16BE(SEQ_OFFSET);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffff);
    }
  });
});
