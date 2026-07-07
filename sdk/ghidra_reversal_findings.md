# Ghidra Reverse Engineering Findings — Truwave.exe Protocol

## ⚠️ CRITICAL CORRECTION (2026-07-02): The "metadata point[0]" theory is WRONG

The decompiled `memmove(buffer+4, point_src + chunk*0x1200, 0x1200)` copies 0x1200 bytes starting from `point_src`, where the FIRST 4 BYTES are control bytes (`00 00 00 <PPS>`), NOT a metadata point. The debugger rename/comment suggesting "point[0].X = laser flag" and "point[0].Y = PPS<<8" was a misinterpretation.

**Correct interpretation:**
- `point_src[0..3]` = 4 control bytes (byte 3 = PPS)
- `point_src[4..0x11FB]` = 575 × 8-byte points (4600 bytes)
- `point_src[0x11FC..0x11FF]` = 4 padding bytes (zeros)

The DAC's DMA command has `offset 19 = 4` (buffer start offset), so it reads from `frame_buffer + 4`, skipping the control bytes. The `MOV word [src_buf], 0` at 0x00490939 writes to the control bytes (not point[0].X), setting them to 0.

See `session_summary.md` for the full corrected analysis.

---

## Status
GhidraMCP is **live and working** — connected to Ghidra running `TruWave.gpr` (Truwave.exe analyzed binary) on `javaw @ port 8080`.

---

## Key Classes & Symbols Identified

| Symbol | Address | Description |
|---|---|---|
| `@@Udpsendtask@Initialize` | `0x00491768` | Unit init for UDP send task module |
| `@@Udpsendtask@Finalize` | `0x00491780` | Unit cleanup |
| `@@Dameidactask@Initialize` | `0x0046f2ac` | Unit init for DAC task module |
| `FUN_004907f0` | `0x004907f0` | **UdpSendTask main loop** (thread proc) |
| `FUN_004908c0` | `0x004908c0` | **Frame sender** — iterates shows, builds & sends packets |
| `FUN_0042ec68` | `0x0042ec68` | **Direct frame send** (SDK-path, no pipelining) |
| `FUN_00659670` | `0x00659670` | **`sendto()` wrapper** — builds sockaddr and calls sendto |
| `FUN_006591d8` | `0x006591d8` | **Destination resolver** — resolves IP from show config |
| `CDameiDacDriver` | `0x0042c244` | DAC driver class (string RTTI) |
| `DameiDACThread` | `0x0046ea94` | Per-channel DAC thread class |
| `DameiDACTaskManager` | `0x0046e5e4` | Multi-channel task manager |
| `@lzr@Point` | `0x0041e5f0` | LiDARZ-style point class with blanking/color |
| `@lzr@Optimizer@run` | `0x0047bc44` | Point optimizer (adds anchor/blanking points) |

---

## Packet Structure Confirmed from Decompilation

### Packet Buffer Layout — RE-CORRECTED 2026-07-01 (4-byte header)

**GhidraMCP re-verification confirms: the header is 4 bytes.** The memmove destination is `buffer+4`, not `buffer+8`. Disassembly trace:

```
; 4 header bytes written individually:
byte [EBP-0x1268] = total_chunks         ; byte 0
byte [EBP-0x1267] = chunk_index          ; byte 1
byte [EBP-0x1266] = seq_counter          ; byte 2
byte [EBP-0x1265] = channel_const        ; byte 3

; memmove copies point data to buffer+4:
CALL memmove(dest=[EBP-0x1264]=buffer+4, src=point_buffer, size=variable ≤ 0x1200)

; sendto sends 0x1204 bytes from buffer start:
CALL sendto(buffer=[EBP-0x1268], length=0x1204)
```

**No overwrite hack.** No extended header writes after memmove. The architecture is straightforward:
1. Write 4 header bytes
2. Copy point data to byte 4+ (up to 0x1200 = 4608 bytes)
3. Send 0x1204 bytes total

**Bytes 4-7 ARE the first point's x,y** — but the first point is special:
- Its Y coordinate encodes PPS as `PPS << 8` (LE int16 = `0xPP00`), which is OUTSIDE the 12-bit DAC range (0-4095), signaling metadata to the DAC
- Its X coordinate doubles as the laser control: zeroed when OFF (`MOV word [src_buf], 0` at 0x00490939), normal anchor value when ON

**Layout** (4612 bytes = 0x1204):
```
[0..3]      4 bytes : header (chunks, index, seq, channel)
[4..11]     8 bytes : point[0] = METADATA point (Y=PPS<<8, X=laser ctrl)
[12..19]    8 bytes : point[1] = first real galvo point
...
[4604..4611] 8 bytes : point[574] = last point in chunk
```

**576 points per chunk** (0x1200 / 8 = 576, exact). No partial points. The "last 4 bytes" are simply the x,y of the last (574th) point in the chunk.

**Why the 8-byte-header theory was wrong:**
The first point's Y = 0x1E00 (7680 for PPS=30) is outside 12-bit DAC range while subsequent points have normal coordinates (e.g. y=2743). This made it look like bytes 4-7 couldn't be point data. Actually they ARE point data — the first point is just a metadata carrier with Y > 4095.

### Header Byte Encoding (VERIFIED from GhidraMCP disassembly 2026-07-01)
- **Byte 0** (`total_chunks`): `ceil(total_point_bytes / 0x1200)` — typically `0x03`
- **Byte 1** (`chunk_index`): show entry's chunk progress counter at `+0x08` field (0, 1, 2)
- **Byte 2** (`sender_ctx_field`): from `sender_context->0x88` — **per-channel frame sequence counter**. Incremented by 1 every 3 chunks (one full frame) per channel.
- **Byte 3** (`show_config_constant`): from `show_config->0x0c` — fixed per channel:
  - CH1 always `0x00`, CH2 always `0x01`

Following bytes 4-4607 are point data (0x1200 = 4608 bytes = 576 points). First point is metadata carrier:
- **Bytes 4-5** = point[0].X (LE int16): anchor point X, zeroed when laser OFF (`*local_44=0`). Byte 5 coincidentally = 0x00=OFF, non-zero=ON.
- **Bytes 6-7** = point[0].Y (LE int16): `PPS << 8` — always > 4095, signals metadata to DAC. LE bytes: `00 <PPS>`.
- **Bytes 8-11** = point[0].blanking/r/g/b

### Frame Sequence Counter (`DAT_0086a668`)
- Located at `0x0086a668`, initialized to `0` in PE
- Only used in `FUN_0042ec68` (SDK direct send path), NOT in the main pipeline
- Incremented by 1 after every complete frame: `DAT_0086a668 = DAT_0086a668 + 1`
- Wraps freely (u8 overflow)
- Placed in **byte 2** of the SDK path header: `[total][idx][seq_counter][config_0x0c]`

### Header Layout: Two Paths (clarified)

The binary has **two different frame-sending code paths** with different byte 2 semantics:

**Both paths** use the same wire format: 4-byte header + 4608 bytes point data.

**SDK Path (`FUN_0042ec68`)**:
```
Byte 0: total_chunks
Byte 1: chunk_index
Byte 2: frame_seq_counter     (= DAT_0086a668, global byte +1 per frame)
Byte 3: show_config_constant  (= *(param_4 + 0x0c), per-channel fixed value)
```
(Followed by 576 points, first is metadata with PPS/laser)

**Main Pipeline (`FUN_004908c0`)**:
```
Byte 0: total_chunks
Byte 1: chunk_index           (= show entry's internal chunk progress at +0x8)
Byte 2: sender_ctx_field      (= *(sender_context + 0x88): per-channel frame seq counter)
Byte 3: show_config_constant  (= *(show_config + 0x0c), per-channel fixed value)
```
(Followed by same 576-point layout)

**Both paths agree on byte 3**: it's `show_config->0x0c`, a static per-channel constant set at configuration time (CH1=0x00, CH2=0x01). It does NOT change with real-time laser toggle.

**Byte 2 differs**:
- SDK path: global frame sequence counter (`DAT_0086a668`, +1 per frame)
- Main pipeline: per-channel frame seq counter (`sender_context+0x88`, +1 per frame per channel)

The `0x1b`/`0x1c` values in earlier captures (DataPacketSendTW.txt) are **frame sequence counters** from the SDK path. Both paths use byte 2 as a sequence counter (just different sources).

### Why DataPacketSendTW Shows Byte 3 Differing Per Channel
- CH1: `byte 3 = 0x01`, CH2: `byte 3 = 0x00`
- This is NOT real-time laser toggle — it's the **static config constant** set when each channel's show was configured

---

## Bytes 4-7 = First Point (Metadata) — RE-CORRECTED 2026-07-01

**GhidraMCP re-verification confirms: bytes 4-7 ARE the first point's x,y.** The first point is a **special metadata point** whose coordinates carry control information outside the normal DAC range.

- **Bytes 4-5** = point[0].X (LE int16, 0-4095):
  - Zeroed by `*local_44 = 0` when laser OFF (`DAT_008adaf8 + 0x799` flag is zero)
  - Normal anchor coordinate when laser ON (varies per show/frame)
  - Byte 5 (X high byte) coincidentally = 0x00 OFF, non-zero ON
- **Bytes 6-7** = point[0].Y (LE int16):
  - Encoded as `PPS << 8` → LE bytes always `00 <PPS>`
  - PPS=30 → `00 1e` (0x1E00 = 7680, >4095 → metadata signal)
  - PPS=60 → `00 3c` (0x3C00 = 15360, >4095 → metadata signal)

**Evidence**: The Y coordinate is always > 4095 (outside DAC range), which is how the DAC identifies this as metadata. All subsequent points have Y≤4095 (valid galvo positions). The code explicitly zeroes the first 2 bytes of the source buffer to turn laser OFF, confirming the first point's X is the laser control mechanism.

---

## Chunk 1 & 2 Data Structure — RESOLVED

**Chunks 1 and 2 are NOT different in type from chunk 0.** They are contiguous slices of the **same point buffer**. The Truwave show buffer holds all points for a frame sequentially. The source buffer copy is 0x1200 bytes, but bytes 4-7 of the output packet are overwritten with the extended header, so the first point in the source is lost in the output.

With 8-byte header, the effective point count per chunk is ~575 (4604 / 8 = 575.5, with 4 extra bytes at the end):

- Chunk 0: points[0..574]    (source bytes 0..4607, output bytes 8..4611)
- Chunk 1: points[575..1149] (source bytes 4608..9215)
- Chunk 2: points[1150..]    (source bytes 9216..13823)

The "table-like data with `ee ee` padding and counters" observed in captures for chunks 1 and 2 is simply the optimizer's **anchor point data** and **blank-jump padding points** that fill the buffer beyond the actual laser-drawing points. The `ee ee` bytes are garbage/padding from uninitialized buffer regions that happen to be below actual point data.

---

## Chunk Count Determination
```c
local_126c = (int)(local_48 / 0x1200) + (local_48 % 0x1200 != 0 ? 1 : 0)
```
Where `local_48` = total byte count of show point data.

For a frame with 1725 points (= 575 × 3):
- Total bytes = 1725 × 8 = 13800
- 13800 / 4608 = 2.996... → ceiling = 3 chunks ✅

---

## DAC Behavior Answers

| Question | Answer Found |
|---|---|---|---|
| Separate laser enable command? | NO — laser control is through **first point's word 0** (packet bytes 4-5 LE uint16), set `0x0000`=OFF, non-zero=ON. Byte 5 of packet `0x00`=OFF, `0x01`/`0x02`=ON |
| Laser disable how? | Set first point's word 0 = `0x0000` (packet bytes 4-5 = `00 00`). No byte 2 manipulation. |
| Frame sequence start value? | Whatever `DAT_0086a668` is at startup (not reset to 0) — only relevant in SDK path |
| Frame seq increment? | +1 per complete frame sent (SDK path only) |
| Keepalive needed? | Unknown — thread sleeps 30ms (`Sleep(0x1e)`) between frames, no explicit keepalive |
| Min refresh rate? | ~33fps implied by 30ms sleep |
| ACK mechanism? | None visible — fire and forget UDP |
| Buffer frames? | Unknown at this level |
| Source port? | OS-assigned per socket object; differs per channel due to separate socket instances |

---

## Architecture: How UdpSendTask Works

```
UdpSendTask thread (FUN_004907f0):
  loop:
    WaitForSingleObject(event_handle)    // wait for data ready signal
    if (show_queue_count > 0):
      FUN_004908c0()                      // send all pending shows
    if (*(DAT_008adaf8 + 0x740) != 0):    // output active flag
      FUN_0043633c()                      // process frames, update preview, CLEAR flag
    Sleep(30ms)                           // ~33fps max rate

FUN_004908c0():
  for each show in queue:
    show_entry = queue_ptr[show_idx]          // each entry: +0x0=buffer_ptr, +0x4=byte_count, +0x8=chunk_progress, +0xc=show_config
    point_buffer = show_entry + 0x10          // wire-format point data (8-byte points)
    total_bytes = *(show_entry + 4)
    num_chunks = ceil(total_bytes / 0x1200)
    for chunk_index in show_entry.chunk_progress .. num_chunks-1:
      // Laser OFF check: zero first word of source buffer when laser disabled
      if (*(DAT_008adaf8 + 0x799) == 0):
        *(uint16*)(point_buffer) = 0           // zero point[0].X (laser OFF signal)
      
      // Build 4-byte header at buffer[0..3]
      buffer[0] = num_chunks
      buffer[1] = chunk_index                  // from show_entry.chunk_progress
      buffer[2] = *(sender_context + 0x88)     // per-channel frame seq counter
      buffer[3] = *(show_config + 0x0c)        // per-channel config constant
      
      // Copy 0x1200 bytes point data to buffer+4 (576 points × 8 bytes)
      // point[0] is metadata: X=laser_flag/anchor, Y=PPS<<8, rest=blanking/r/g/b
      payload_size = min(0x1200, remaining_bytes)
      memmove(buffer + 4, point_buffer + chunk_index * 0x1200, payload_size)
      
      // Send 4612-byte packet: 4 header + 4608 point data
      sendto(socket, buffer, 0x1204, 0, dest_sockaddr)
      show_entry.chunk_progress++
    mark show as sent (set entry+0x4 field to -1 when all chunks done)
```

---

## Point Format (from @lzr@Point class)
- `x`: int16 LE (0..4095 range, 12-bit DAC; center ~2048) ← confirmed by POSITION_MIN/MAX constants
- `y`: int16 LE (same range)
- `blanking`: u8 — 0 = LIT, 1 = DARK (opposite of what notes said originally - confirmed: `blank$qv` sets to 0, `unblank$qv` is separate)

Wait — from @lzr::Point::blank source found: the method is `blank$qv` and `unblank$qv`. The SDK says `blanking: 0=dark, 1=light`. The notes said `0=LIT, 1=DARK`. Need to verify which is correct from actual sendto path.

- `r`, `g`, `b`: u8 each — direct 0-255 RGB

---

## Updated: Resolved Unknowns (from GhidraMCP session 2026-07-01)

### 1. Blanking Polarity — RESOLVED ✅
Decompiled `@lzr@Point` methods (Ghidra addresses):
- `blank$qv` (0x0041e6e4): sets `param_1+0xb = 0`
- `unblank$qv` (0x0041e6f0): sets `param_1+0xb = 0xFF`
- `is_blanked$xqv` (0x0041e750): returns true when `param_1+0xb == 0` OR `(r+g+b == 0)`
- `is_lit$xqv` (0x0041e78c): returns true when `param_1+0xb != 0` AND `(r+g+b != 0)`

**Conclusion:** `blanking=0` → DARK, `blanking=non-zero` → LIT.
The SDK description "0=dark, 1=light" is **correct**. The earlier note "0=LIT, 1=DARK" was **wrong**.

### 2. POSITION_MIN / POSITION_MAX — PARTIALLY RESOLVED
- LAB_008673e0 = POSITION_MIN (4-byte float)
- LAB_008673e4 = POSITION_MAX (4-byte float)
- PE file initial values: `MIN=1.0`, `MAX=-1.0` (range = -2.0)
- These may be overwritten at runtime by C++ global init (Entry Point xref)
- Referenced in ~40 functions for coordinate scaling:
  ```c
  _DAT_0087e524 = (float)(_DAT_004903cc * (POSITION_MAX - POSITION_MIN));
  ```
- The runtime values might differ from PE file; GhidraMCP cannot read runtime memory directly

### 3. Frame Sequence Counter (DAT_0086a668) — RESOLVED ✅
- Located at `0x0086a668` in .data section
- Initial PE value: `0`
- **Only used in `FUN_0042ec68`** (direct SDK send path), NOT in the main pipeline send (`FUN_004908c0`)
- Incremented by 1 after each complete frame: `DAT_0086a668 = DAT_0086a668 + '\x01'`
- In the main `FUN_004908c0` pipeline path, **byte 2** is also a sequence counter (`sender_context+0x88`), per-channel, +1 per 3 chunks

### 4. Startup Sequence — RESOLVED ✅
No handshake or setup packets needed. The UDP send task thread (`FUN_004907f0` at 0x004907f0):
```
while (active) {
    WaitForSingleObject(event, INFINITE);   // block until data ready
    if (queue_count > 0) FUN_004908c0();    // send all pending
    if (*(DAT_008adaf8 + 0x740) != 0)       // output active flag?
        FUN_0043633c();                     // process frames, update preview, clear flag
    Sleep(30ms);                            // ~33fps cap
}
```

### 4b. Start/Stop Output — RESOLVED ✅

The "Start Output" button triggers `FUN_0043730c`:
1. Gets/creates the player object via `FUN_00436754()`
2. Calls `FUN_00436ab0()` to configure channel settings in the UI tree
3. Calls `FUN_004365b4()` which:
   - Sets `DAT_008adaf8 + 0x740 = 1` (output active flag)
   - Calls `SetEvent(sender_context->+0x84)` to wake the sender thread
4. Sets `param_1 + 0x640 = 1` (UI state indicator)

The sender thread wakes on the event, sends frames, then checks `+0x740`. If set, calls `FUN_0043633c` which:
- Processes completed frames via `FUN_004697ac`
- Updates the preview window
- **Clears** `+0x740 = 0` (acts as a per-frame gate)

The thread also checks `sender_context->+0x80` (active flag, initialized to 1) for long-lived thread control.

"Stop Output" likely clears `+0x740` or `+0x80` to halt sending (exact function not yet pinpointed).

### 5. Max Point Count — UPDATED 2026-07-01
- SDK header: `MAX_POINT_COUNT_BIG = 2500`
- Per chunk output: `4604 / 8 = 575.5` → **575** full points + 4 extra bytes (footer or partial point)
- 3 chunks max = **1725 points per frame** in native protocol
- Frame buffer at show_data_buffer[0x40]; memcpy'd in 0x1200-byte slices from source, but bytes 4-7 overwritten with extended header fields after copy

### 6. Queue/Buffer Depth — RESOLVED ✅
Circular queue with **3 slots** (4-byte entries, wraps at count=3):
- Queue count = `(param_1->0x54 - param_1->0x50) >> 2`
- When subtraction goes negative, adds 3 to get actual count
- All pending items sent in one batch per 30ms cycle
- No frame buffering at the DAC level — fire-and-forget UDP

### 7. Keepalive — RESOLVED ✅
No explicit keepalive. Thread sleeps 30ms between cycles. The DAC must handle idle gaps itself.

### 8. ACK Mechanism — CONFIRMED ✅ (already known)
None. Pure fire-and-forget UDP.

### 9. Color Encoding — CONFIRMED ✅
Direct 8-bit RGB (0-255 per channel). Stored in point struct at offsets +0x08 (R), +0x09 (G), +0x0a (B).

### 10. Multi-Channel Source Ports — CONFIRMED ✅
OS-assigned ephemeral ports per socket instance. No application-level source port selection.

### 11. Channel Config (Byte 3) — RESOLVED ✅

Byte 3 is `show_config->0x0c`, a **static per-channel constant** set at config time:
- CH1 = `0x00`, CH2 = `0x01`
- Set from the `TWndProjectorSetting` dialog (`FUN_004373bc` is the dialog OK handler)
- The dialog handler reads channel 1 or 2 config from `TWndProjectorSetting + 0x1778` and saves it
- Does NOT change with real-time laser toggle (confirmed by captures)

### 12. Laser Control — RE-RE-CORRECTED 2026-07-01 (Back to point data word 0)

Laser control is through **point[0].X** (bytes 4-5 of packet = first word of point data):
- At 0x00490939: `MOV word [src_buf], 0` — zeroes point[0].X when `DAT_008adaf8 + 0x799` flag is 0
- Laser OFF → X = 0 → byte 5 (X high) = 0x00
- Laser ON → X = anchor coordinate (~466-667) → byte 5 (X high) = non-zero (0x01 or 0x02)
- The DAC interprets X=0 as "turn laser OFF" and X>0 as "laser ON, position at X"

This IS in the point data — specifically the first point's X coordinate, which the code explicitly zeroes to signal laser OFF. Byte 5's value is simply coincidental (high byte of whatever X value the anchor point has).

### 13. Thread and Queue Architecture — RESOLVED ✅

The sender context structure:
```
+0x10:  circular queue buffer start (pointer array, 3 entries × 4 bytes)
+0x14:  queue write position
+0x18:  queue end
+0x50:  queue read start index
+0x54:  queue write end index
+0x80:  thread active flag (1 = running, set in constructor)
+0x84:  event handle (CreateEventA, auto-reset, initially unsignaled)
+0x88:  byte 2 field (per-channel frame sequence counter, +1 per 3 chunks)
```

Signal chain:
- Frame producer calls `FUN_004365b4` → sets `+0x740=1` + `SetEvent(+0x84)`
- Thread wakes → sends frames → clears `+0x740=0` via `FUN_0043633c`
- Frame producer can also call `FUN_00491014(sender_context)` which is just `SetEvent(sender_context->+0x84)`

---

## Point Structure (from @lzr@Point class, Ghidra-confirmed)
```
Offset  Size  Field
0       4     x (int32/float — stored as float internally, sent as int16 LE on wire)
4       4     y (same)
8       1     r (u8, 0-255)
9       1     g (u8, 0-255)
10      1     b (u8, 0-255)
11      1     blanking (u8, 0=DARK, 0xFF=LIT)
```
Total: 12 bytes internal; 8 bytes on wire (int16 x, int16 y, blanking, r, g, b).

---

## Header Layout Difference: Two Code Paths

### Path 1: FUN_0042ec68 (SDK direct send — non-pipelined)
```
Byte 0: total_chunks
Byte 1: chunk_index
Byte 2: frame_seq_counter      (= DAT_0086a668, global byte, +1 per frame)
Byte 3: show_config_constant   (= *(param_4 + 0x0c), per-channel)
Byte 4-7: (unknown — may or may not have extended header)
```

### Path 2: FUN_004908c0 (main pipeline — normal operation)
```
Byte 0: total_chunks
Byte 1: chunk_index            (= show entry's chunk progress at +0x8)
Byte 2: sender_ctx_field       (= *(sender_context + 0x88): per-channel frame seq counter)
Byte 3: show_config_constant   (= *(show_config + 0x0c), per-channel)
--- point data starts at byte 4 ---
[4..11]   point[0]: X=anchor_coord, Y=PPS<<8, blanking, r, g, b
[12..19]  point[1]: first real galvo point
...
[4604..4611] point[574]: last point
```

**Both paths** use the same 4-byte header + 4608 bytes (576 points) wire format.

**Byte 2** in both paths is a sequence counter — SDK path uses global `DAT_0086a668`, main pipeline uses per-channel `sender_context+0x88`.

**Byte 3** is the same in both paths: `show_config->0x0c` — a static per-channel constant set at config time. CH1=0x00, CH2=0x01.

**Laser control** is through point[0].X: code zeroes it (`*local_44 = 0` at 0x00490939) when laser OFF. Byte 5 (X high byte) coincidentally = 0x00 OFF, non-zero ON. Not a separate header field.

---

## Still Remaining
1. **Point conversion function** — the exact function that converts internal 12-byte float Points to 8-byte int16 wire format hasn't been pinpointed, but the scaling formula uses `POSITION_MAX - POSITION_MIN` and global scales `DAT_0087e524/8`.
2. **DAC coordinate range at runtime** — POSITION_MIN/MAX values in PE are 1.0/-1.0; runtime values may differ. Need runtime memory read or further tracing.
3. **DAC-side idle timeout** — how long before DAC turns off lasers after last packet?
4. **Exact Stop Output handler** — the function that reverses `FUN_0043730c` (clears flags, stops thread) hasn't been pinpointed.
5. **Laser toggle UI handler** — `DAT_008adaf8` stores a pointer to what is likely a `CDACPlayer` instance. The write to `+0x799` is in a class method using `this` (not referencing `DAT_008adaf8` directly). Candidate: `CDACPlayer::SetLaserEnable(bool)`. Unable to locate via GhidraMCP xrefs alone.
6. **SDK SendPointsToShow** sends the **full frame_buffer struct** (30002 bytes with 12-byte float points), NOT the 8-byte wire format. The DAC likely doesn't understand this format — it's for Truwave software interop.
7. ~~**Ghidra decompilation re-verification**~~ — **RESOLVED**: memmove target = `buffer+4` (EBP-0x1264), payload size = 0x1200 (4608 bytes = 576 points). Confirmed by disassembly.
8. ~~**Bytes 4-5 encoding**~~ — **RESOLVED**: They are point[0].X (LE int16). Zeroed when laser OFF, normal anchor coordinate when ON. Byte 5 coincidentally = 0x00 OFF, non-zero ON.
9. ~~**Bytes 6-7 meaning**~~ — **RESOLVED**: point[0].Y = `PPS << 8`. LE int16, always >4095 → metadata signal.
10. ~~**Last 4 bytes (4608-4611)**~~ — **RESOLVED**: Last 4 bytes of point[574].x,y (576th point). 0x1200 bytes / 8 = exactly 576 points per chunk. No partial point.
11. **SDK path check** — **RESOLVED**: `FUN_0042ec68` uses identical wire format (4-byte header + 4608 bytes, first point metadata). Only byte 2 differs (global vs per-channel seq counter).

---

## `DAT_008adaf8` Pointed-to Struct Layout (Partial)

`DAT_008adaf8` at address `0x008adaf8` stores a **pointer** (initialized in PE data section, never written at runtime). The target appears to be a `CDACPlayer` instance.

```
Offset  Size  Likely Field
0x394   4     Handle/pointer (form handle?)
0x528   4     Object pointer (used with FUN_005f3414)
0x5c4   4     Object pointer (used with virtual calls)
0x5e0   4     Object pointer (used with FUN_00436ab0)
0x600   4     Object pointer (used with virtual calls)
0x614   4     Object pointer (DAC driver?)
0x730   4     Queue buffer start
0x734   4     Queue buffer end
0x740   1     Output active flag (set/cleared by Start/Stop Output)
0x760   4     Preview panel ptr
0x798   1     Render enable flag
0x799   1     Laser ON/OFF flag (0=OFF, non-zero=ON)
0x79c   4     String pointer (device name / config path)
0x7a0   4     Misc data (copied from config, possibly IP addr)
0x7a4   2     Window message ID
0x7a8   ?     Data (used with FUN_0042ea94/FUN_0042eabc)
0x7bc   4     Pointer (used with FUN_0042eae4)
```

## Files Referenced
- `c:/Truwave/TruWave.gpr` — Ghidra project (Truwave.exe analyzed)
- `c:/Truwave/sdk/SDKSocket.h` — Data structures (show_list, frame_buffer, etc.)
- `c:/Truwave/sdk/DameiSDK.cpp` — SDK implementation
