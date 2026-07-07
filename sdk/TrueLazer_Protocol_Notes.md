# TrueLazer — Showbridge/Showtower DAC Protocol Notes

## ⚠️ CRITICAL CORRECTION (2026-07-02): The "metadata point[0]" theory is WRONG

**Truwave packet captures and firmware analysis reveal a 4-byte control block (not a metadata point) before the points.**

Previous docs described payload bytes 4-11 as point[0] with X=laser flag, Y=PPS<<8. The actual structure is:

```
Byte  4-7:  4 control bytes: 00 00 00 <PPS>  (byte 3 = PPS, e.g. 0x1E = 30)
Byte  8-15:  point[0].x,y,blanking,r,g,b      → first real point
Byte 16-23:  point[1]                          → second real point
```

**Per chunk: 575 real points** (not 576), with 4 trailing padding bytes to reach 0x1200.
**DAC reads from buffer+4** (DMA command offset 19 = 4), skipping the control bytes entirely.
**No metadata point** — the laser and PPS are encoded in the control bytes, not in point data.

See `session_summary.md` for the full corrected analysis and `test_showbridge.py` for the working implementation.

---

## Overview
Reverse-engineering the native Damei Showbridge/Showtower DAC protocol. The DAC is a dual-channel laser controller reachable at `169.254.25.118:8089` (link-local network).

---

## ✅ What We Know

### Discovery
- **Broadcast**: 6 bytes `[our_ip_4B][0xa3][0x1f]` to `255.255.255.255:8089` from port `8099`
- **Response** (16 bytes): `[vendor_2][type_1][channel_1][hw_id_4][reserved_8]`
  - Example: `17 32 01 01 00 48 00 2e 00 00 00 00 00 00 00 00`
  - vendor=0x1732, type=1, channel=1, hw_id=0x0048002e (MAC-derived)
- Two channels detected in discovery (channel=1, channel=2) both at same IP
- SDK queries to port 8099 are handled by **Truwave software, not DAC firmware**

### Frame Data (UDP to Port 8089)
- **Port**: 8089 (confirmed by working Truwave capture)
- **Frame composition**: 3 UDP packets ("chunks") per complete frame
- **Each chunk**: 4612 bytes total = **4-byte header** + 4608 bytes of point data
- **Architecture**: Simple — write 4 header bytes to buffer[0..3], then `memmove(buffer+4, source, 0x1200)` to copy 576 points. No overwrite hack.
- **Header structure** (4 bytes):
  - `[u8 total_chunks][u8 chunk_index][u8 seq_counter][u8 channel_const]`
- **Points are packed contiguously from byte 4** — eight 8-byte points per 8-byte boundary, no gaps, no sub-header:
  ```
  Byte  0: header[0]
  Byte  1: header[1]
  Byte  2: header[2]
  Byte  3: header[3]
  Byte  4: point[0].X low        ┐
  Byte  5: point[0].X high       │ point[0] = METADATA carrier
  Byte  6: point[0].Y low        │ (Y = PPS<<8 > 4095 → metadata signal)
  Byte  7: point[0].Y high       │ X = 0 → laser OFF, X = anchor → ON
  Byte  8: point[0].blanking     │ blanking=0, r=g=b=0
  Byte  9: point[0].r            │
  Byte 10: point[0].g            │
  Byte 11: point[0].b            ┘
  Byte 12: point[1].x low        ┐
  Byte 13: point[1].x high       │ point[1] = first real galvo point
  ...                            ┘
  Byte 4604: point[574].x low    ┐
  Byte 4605: point[574].x high   │ point[574] = last point in chunk
  Byte 4606: point[574].y low    │
  Byte 4607: point[574].y high   ┘
  ```
- **Point[0] details** (bytes 4-11):
  - Bytes 4-5: X (LE int16). Laser control: zeroed when OFF (`MOV word [src], 0` at 0x00490939), normal anchor coordinate when ON.
  - Bytes 6-7: Y (LE int16) = **PPS << 8**. Always > 4095 → metadata signal to DAC. PPS=30 → `0x1E00` (bytes `00 1e`), PPS=60 → `0x3C00` (bytes `00 3c`).
  - Bytes 8-11: blanking=0 (DARK), r=0, g=0, b=0
- **Point format** (8 bytes on wire): `[int16 LE x][int16 LE y][u8 blanking][u8 r][u8 g][u8 b]`
- **Blanking**: 0 = DARK, non-zero = LIT (SDK: `blanking: 0=dark, 1=light` is correct)
- **Point count per chunk**: 0x1200 / 8 = **exactly 576 points** (point[0]=metadata + points[1..575]=real). No partial points, no extra bytes after the last point.
- **All 3 chunks are contiguous slices of the same point buffer** — they are NOT different in type:
  - Chunk 0: buffer bytes 0..4607 → points[0..575]
  - Chunk 1: buffer bytes 4608..9215 → points[576..1151]
  - Chunk 2: buffer bytes 9216..13823 → points[1152..1727]
  - "Table data with `ee ee` padding" is just anchor/blanking fill points followed by uninitialized buffer
- **Coordinates**: int16 LE, mapped from float range [-1.0..1.0] using `POSITION_MIN/POSITION_MAX` constants
- **Frame pacing**: Truwave sends at ~45fps (22ms gap between frames, 3 chunks within ~4ms)

### Known Limitations
- **No EtherDream TCP** — port 7765 timed out, DAC doesn't accept EtherDream connections
- **No SDK query on DAC** — port 8099 SDK queries get "port unreachable" from DAC (handled by Truwave software)
- **IP Fragmentation**: 4612-byte UDP packets exceed Ethernet MTU (1500), causing IP fragmentation (4 packets per chunk). The DAC handles this at normal frame rates but reassembly buffer overflows at flood rates.
- **Wire length**: Wireshark shows 214 bytes on wire for 4612-byte payload (first IP fragment only)

---

## ❓ What We Still Need to Know

### Header Structure (RESOLVED)
1. ~~What does **byte 2** of main header encode exactly?~~ → **RESOLVED**: Per-channel frame sequence counter. Increments by 1 every 3 chunks (one full frame). Each channel maintains its own counter.
2. ~~What is the **sub-header** (bytes 4-7) exactly?~~ → **RESOLVED**: They ARE point data — point[0].X (laser control), point[0].Y (PPS<<8), point[0].blanking/r/g/b. The first point is special metadata with Y > 4095.
3. ~~What do byte 3 bits mean?~~ → **RESOLVED**: Fixed per-channel constant from `show_config->0x0c`: CH1 always `0x00`, CH2 always `0x01`.
4. ~~Is there a separate "laser enable" command?~~ → **RESOLVED**: No. Laser control is through point[0].X: zeroed when OFF (`MOV word [src], 0`), normal anchor value when ON.

### Chunk Data Structure (RESOLVED)
5. ~~What is the actual data structure of chunks 1 and 2?~~ → **RESOLVED**: They are contiguous slices of the same point buffer. "Table data with `ee ee` padding" is just anchor/blanking points followed by uninitialized buffer bytes.
6. ~~Is there a minimum/maximum point count per chunk?~~ → **RESOLVED**: Max 575 per chunk, 1725 per frame (3 chunks). Min is 1+anchor points.
7. ~~Do all 3 chunks serve different purposes?~~ → **RESOLVED**: No — all are identical format. Send contiguous slices.

### DAC Behaviour
8. ~~Does the DAC require a specific startup sequence?~~ → **RESOLVED**: No — thread waits on event then sends immediately.
9. Does it need a **keepalive** or will it stay active indefinitely with continuous frame data?
10. What is the **refresh rate range**? (Truwave ~45fps, but min/max?)
11. Is there an **acknowledgement/flow control** mechanism?
12. Does the DAC buffer multiple frames or only process the latest one?

### Protocol Details
13. Are there additional **control commands** (stop, reset, configure)? → **RESOLVED**: No separate commands. All control (laser on/off via point data control word, channel select via header byte 3) is embedded in the data. Start/Stop output controls the sender thread, not special packets.
14. What is the **IP/port negotiation** — is 8089 always the data port?
15. **Multi-channel**: OS-assigned ephemeral source ports per socket instance. Channel identity in header byte 2 (base ID + laser flags).
16. **DAC coordinate range**: int16 on wire, 12-bit DAC (0-4095, center ~2048). Float points are scaled to this range.

### Truwave Internal Architecture
- [x] **Start Output**: `FUN_0043730c` → `FUN_004365b4` sets `+0x740=1` + signals event → thread wakes and sends
- [x] **Stop Output**: (handler not yet pinpointed) clears flags to halt sending
- [x] **Channel config (byte 3)**: static per-channel constant from `show_config->0x0c`, set in `TWndProjectorSetting` dialog
- [x] **Laser control**: point[0].X (first 2 bytes of point data). Zeroed at 0x00490939 when `DAT_008adaf8+0x799` flag is 0. Byte 5 (X high byte) coincidentally = 0x00=OFF, non-zero=ON.

### Reverse-Engineering Targets (Truwave)
- [x] **Chunk 1 & 2 data structures** — contiguous buffer slices
- [x] **Frame sequence counter** — `DAT_0086a668` (SDK path) / `sender_context+0x88` (main pipeline)
- [x] **Channel config (byte 3)** — static per-channel constant from `show_config->0x0c` (CH1=0x00, CH2=0x01)
- [x] **Color encoding** — direct 8-bit RGB mapped to DAC output
- [x] **Source port selection** — OS-assigned per socket instance
- [x] **Start/Stop output** — `FUN_004365b4` sets flag + signals event; thread processes and clears
- [x] **SDK path wire format** — confirmed identical to main pipeline (4-byte header + 4608 bytes, first point metadata)
- [x] **Bytes 4-7 (metadata point)** — point[0].X = laser control (zeroed when OFF), point[0].Y = PPS<<8 (>4095, metadata signal). Confirmed by Ghidra disassembly: memmove to buffer+4, payload=0x1200.

  **Byte 4-5 details:**
  - Byte 5: `0x00`=OFF, `0x01`/`0x02`=ON. NOT a flag — it's the high byte of point[0].X. Different anchor X values for different shows/frames produce different high bytes.
  - Byte 4: Low byte of point[0].X, varies per frame with anchor point position.
  - 16-bit LE: OFF=0x0000, ON~0x01D2-0x02A7.
- [x] **Laser disable** — code zeroes `*(uint16*)(src_buffer)=0` when flag at `DAT_008adaf8+0x799` is 0
- [x] **Footer / last 4 bytes** — RESOLVED: last 4 bytes of point[574].x,y. 0x1200/8 = exactly 576 points per chunk. No footer.
- [x] **Ghidra decompilation** — RESOLVED (2026-07-01): memmove target = buffer+4 (EBP-0x1264), size = 0x1200 (4608). Confirmed by disassembly.

---

## Reference: Truwave Capture (DataPacketSendTW.txt)

These captures may use the **SDK path** (`FUN_0042ec68`) where byte 2 = frame sequence counter, not channel ID. See the LaOff/LaOn captures for main pipeline behavior.

### Channel 1 (port 58202):
```
Chunk 0: 03 00 1b 01 | 00 00 00 1e | [576 × 8-byte points]
Chunk 1: 03 01 1b 01 | 00 00 64 00 | [576 × 8-byte points]
Chunk 2: 03 02 1b 01 | 00 00 00 00 | [576 × 8-byte points]
```

### Channel 2 (port 58201):
```
Chunk 0: 03 00 1c 00 | 00 00 00 1e | [576 × 8-byte points]
Chunk 1: 03 01 1c 00 | 00 00 00 64 | [576 × 8-byte points]
Chunk 2: 03 02 1c 00 | ee ee ee ee | [576 × 8-byte points]
```

Note: Channel 2 has byte 3 = `00` (static config constant shows laser configured OFF for this channel's show setup, NOT real-time toggle).

### Interpretation (RE-CORRECTED — 4-byte header):
- Header bytes 0-3: `03 00 1b 01` → 3 chunks, index 0, byte2=0x1b (seq counter), byte3=0x01 (channel const for CH1)
- Bytes 4-5 (point[0].X): `00 00` → X=0 (laser OFF — zeroed by code at 0x00490939)
- Bytes 6-7 (point[0].Y): `00 1e` → Y=0x1E00=7680 (= PPS=30 << 8). Outside DAC range → metadata.
- Bytes 8-11 (point[0].blanking/r/g/b): `00 00 00 00` → blanking=0 (DARK)
- Bytes 12-19 (point[1], first real point): `05 0b b7 0a 01 00 00 00` → at (2821, 2743), blanking=1, black

The "8-byte header" theory was wrong. Bytes 4-7 ARE the first point's x,y — the first point just happens to be a metadata carrier (Y > 4095 signals metadata to DAC).

---

## Two Code Paths in Truwave.exe

The binary contains **two different frame-sending code paths**. Both use **identical wire format**: 4-byte header + 4608 bytes (576 points), first point is metadata.

| Aspect | SDK Path (`FUN_0042ec68`) | Main Pipeline (`FUN_004908c0`) |
|---|---|---|---|---|---|---|
| Header layout | Same 4 bytes | Same 4 bytes |
| Byte 2 source | `DAT_0086a668` (global seq, +1/frame) | `sender_context+0x88` (per-channel seq, +1/3 chunks) |
| Byte 3 source | `show_config->0x0c` (static channel const) | `show_config->0x0c` (same) |
| Point format | Same — first point metadata (X=laser_ctrl, Y=PPS<<8) | Same |
| Send size | 0x1204 (same 4+4608) | 0x1204 |
| Laser flag check | Yes — `DAT_008adaf8+0x799` | Yes — `DAT_008adaf8+0x799` |
| Buffer setup | `FUN_0084cd7c()` then send via `FUN_00658e8c` | `FUN_0084cd7c()` then send via `FUN_00659670` |

**Both paths confirmed identical wire format** (2026-07-01 session).

**Verified from captures**:
- Byte 2 is a **per-channel frame sequence counter** — identical value across all chunks of a frame.
- Byte 3 is a **fixed per-channel constant** from `show_config->0x0c`: CH1=0x00, CH2=0x01.
- **Laser control** is through point[0].X (bytes 4-5). Zeroed by `MOV word [src], 0` when laser OFF. Byte 5 (X high byte) coincidentally = 0x00 OFF, non-zero ON.
- **Bytes 6-7** = point[0].Y = PPS << 8 (LE int16). PPS=30 → 0x1E00 = bytes `00 1e`. PPS=60 → 0x3C00 = bytes `00 3c`. **Confirmed empirically.**

## Files
- `main/showbridge-probe.cjs` — probe script (discovery + frame streaming)
- `main/showbridge-communication.cjs` — DAC communication module (needs update)
- `sdk/Packet Capture/DataPacketSendTW.txt` — Key Truwave capture with working frame data
- `sdk/Packet Capture/Start Sending.txt` — Additional Truwave frame capture
- `sdk/Packet Capture/Our_Application TCP Full.txt` — Our probe traffic capture
- `sdk/Truwave SDK Files/DameiSDK.cpp` — SDK source (uses float point format for Truwave software)
