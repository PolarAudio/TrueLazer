/**
 * Pro DJ Link raw packet decoders for the UDP 50001 packets that prolink-connect
 * binds but never parses. Packet layouts are documented at:
 * https://djl-analysis.deepsymmetry.org/djl-analysis/beats.html
 */

// 10-byte Pro DJ Link packet header ("Rspt1WmJOL").
export const PROLINK_PACKET_HEADER = Buffer.from('5173707431576d4a4f4c', 'hex');

// Port-50001 packet kinds.
export const PROLINK_BEAT_PACKET = 0x28; // broadcast once per beat by the tempo master
export const PROLINK_ABS_POS_PACKET = 0x0b; // CDJ-3000+, ~30 Hz, also sent while paused

// Timing marker used when the track ends before the reported beat would occur.
export const END_TIMING = 0xffffffff;

/**
 * Decode the two Pro DJ Link UDP-50001 packets that matter for a precise
 * playhead. Returns null for any other packet (on-air, fader start, sync
 * control, master handoff, keep-alive, ...).
 *
 * Beat packet (0x28, 96 bytes):
 *   0x0a type · 0x0b-0x1e device name · 0x21 device id · 0x22-0x23 length
 *   0x24 nextBeat · 0x28 2ndBeat · 0x2c nextBar · 0x30 4thBeat · 0x34 2ndBar
 *   0x38 8thBeat (ms until each, reported at 0% pitch) · 0x54 pitch · 0x5a bpm
 *   0x5c beat-within-bar · 0x5f device id
 *
 * Absolute Position packet (0x0b): · 0x24 track length (s) · 0x28 playhead (ms)
 *   0x2c pitch (signed percent×100) · 0x38 bpm (×10)
 *
 * @param {Buffer} buf
 * @returns {null|{kind:'beat',deviceId:number,nextBeatMs0:(number|null),bpm:number}
 *                 |{kind:'abs',deviceId:number,trackLenSec:number,playheadMs:number}}
 */
export function decodeProlinkPacket(buf) {
  if (!buf || buf.length < 0x0b || !buf.subarray(0, 10).equals(PROLINK_PACKET_HEADER)) {
    return null;
  }
  const type = buf[0x0a];
  const deviceId = buf[0x21];
  // Note: the Absolute Position packet is much shorter than the Beat packet —
  // never gate the whole entry on the 96-byte beat-packet length.
  if (type === PROLINK_BEAT_PACKET) {
    if (buf.length < 0x60) return null;
    const nextBeatMs0 = buf.readUInt32BE(0x24);
    return {
      kind: 'beat',
      deviceId,
      // ms until the next beat at 0% pitch; 0xffffffff = track ends before it.
      nextBeatMs0: nextBeatMs0 === END_TIMING ? null : nextBeatMs0,
      bpm: buf.readUInt16BE(0x5a) / 100,
    };
  }
  if (type === PROLINK_ABS_POS_PACKET) {
    if (buf.length < 0x2c) return null;
    return {
      kind: 'abs',
      deviceId,
      trackLenSec: buf.readUInt32BE(0x24),
      playheadMs: buf.readUInt32BE(0x28),
    };
  }
  return null;
}