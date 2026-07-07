# ShowBridge DAC Firmware Protocol

## Target
STM32H750/F750 (Cortex-M7) running uC/OS-II RTOS + LWIP netconn UDP.
Firmware string: `"POLARIS H750/F750 NETCONN UDP demo"`
**530 functions** identified in Ghidra.

---

## Architecture

### Task Layout (uC/OS-II)
```
Main init (FUN_0800f284)
  └─ App task entry (FUN_08010174, pri 11)
       ├─ Task pri 10: 0x0800E2AC — Status/console display
       ├─ Task pri  8: 0x0800F9E8 — DAC SPI output   ← critical
       └─ Task pri  9: 0x0800A6E4 — Config/file stub (idle loop)

LWIP callback (interrupt/tcpip context):
  FUN_08012310 — UDP packet receive + type dispatch  ← critical
```

### Hardware Interfaces
- **SPI2** (CH1) and **SPI3** (CH2) initialized for DAC output
- **SPI1** initialized conditionally (optional 3rd DAC)
- Ethernet PHY (LAN8742A) via RMII
- Frame buffers: 4 × 0x4E24 bytes + 1 × 0x1204 bytes packet reassembly buffer
- UART console output via `FUN_08009cb4` (printf-like)

### Buffer Allocation (FUN_08005d88)
```c
buffers[0] = malloc(0x4E24);  // CH1 frame buffer (DAT_080127e0)
buffers[1] = malloc(0x4E24);  // CH2 frame buffer (DAT_08012804)
buffers[2] = malloc(0x4E24);  // spare buffer
buffers[3] = malloc(0x4E24);  // spare buffer
packet_buf = malloc(0x1204);  // UDP reassembly buffer
```

After allocation, **buffer byte[3]** is pre-initialized with the channel ID from config (0x00 for CH1, 0x01 for CH2).

---

## UDP Protocol — Port 8089

### Packet Format
```
[0] total_chunks  — number of chunks per frame (max 5 for math, see notes)
[1] chunk_index   — zero-based index of this chunk (0..total_chunks-1)
[2] seq_counter   — frame sequence counter (used for duplicate detection)
[3] type          — packet type (see below)
[4..]             — payload
```

### Packet Types
| byte[3] | Total size | Action | Description |
|---------|-----------|--------|-------------|
| 0x00 | 0x1204 (4612) | Store → CH1 frame buffer | **CH1 frame data** |
| 0x01 | 0x1204 (4612) | Store → CH2 frame buffer | **CH2 frame data** |
| 0x02 | 0x9A8  (2472) | Apply new config | **Settings/IP config** block |
| 0x03 | 6             | Update sender IP, send reply | **Heartbeat** |
| 0x04 | 0x10  (16)    | Check against local IP | **IP conflict detection** |
| 0x06 | varies        | Write GPIO port/pin/level | **GPIO** |
| 0xFD | varies        | Write to internal storage | **File write** |
| 0xFE | varies        | No action | **Reserved/ignored** |

### Receive Entry Point
The LWIP stack calls `FUN_08012310` directly as a registered callback (set during `FUN_080122dc` with `udp_recv(pcb, FUN_08012310, arg=0)`).

#### Receive Flow
1. pbuf chain is linearized into the 0x1204-byte reassembly buffer
2. `uVar20` = total reassembled bytes (checked against expected sizes)
3. byte[3] of reassembled data selects the dispatch branch
4. For data types (0x00, 0x01): chunks are copied into the frame buffer

---

## Frame Data Packets (type 0x00 / 0x01)

### Point Format (8 bytes each)
```
[0-1] int16 LE X coordinate
[2-3] int16 LE Y coordinate
[4]   u8 blanking   (0=DARK/visible, 1=BRIGHT/blanked)
[5]   u8 red
[6]   u8 green
[7]   u8 blue
```

### Payload Structure (CRITICAL — Revised 2026-07-02)

Each data packet carries **0x1200 bytes** (4608) of frame data with this layout:

```
[0-3]   4 bytes control      (00 00 00 <PPS>)
[4..]   point data           (575 × 8 = 4600 bytes for full chunks)
[...]   trailing padding     (4 bytes zero pad to reach 0x1200)
```

Total: `4 + 4600 + 4 = 4608 = 0x1200` (non-last chunks)

**Control bytes** (byte 3 = PPS value):
| Byte | Value | Meaning |
|------|-------|---------|
| 0    | 0x00  | Reserved (overwritten by seq in some modes) |
| 1    | 0x00  | Reserved |
| 2    | 0x00  | **Overwritten with 0xFA** in frame buffer (frame ready) |
| 3    | PPS   | Points Per Second ÷ 1000 (e.g. 0x1E = 30 PPS) |

**Real point count per non-last chunk**: 575 (NOT 576)

### Chunk Boundary Virtual Points

The last 4 bytes of each non-last chunk (padding) + first 4 bytes of the next chunk (control) form a naturally **blanked 8-byte point** at chunk boundaries:
- X, Y = from padding (zeros if padded with 0x00)
- blanking = control byte 0 = 0x00 → **invisible**
- color = control bytes 1-3 = 0x00, 0x00, PPS

This is by design — the 4 virtual boundary points allow the DAC to read 2500 continuous slots from the frame buffer.

### Frame Buffer Layout
- **Size**: 0x4E24 (20004) bytes per channel
- **Capacity**: 4 bytes control header + 2500 point slots × 8
- **Real vs virtual points**:
  - 2496 real points (loaded from chunks)
  - 4 virtual blanked points (at chunk 0→1, 1→2, 2→3, 3→4 boundaries)
  - = 2500 total DAC output slots
- **CH1**: pointer at `DAT_080127e0` → buffer from allocation slot 0
- **CH2**: pointer at `DAT_08012804` → buffer from allocation slot 1

### Chunk Assembly
```
packet byte[0] = total_chunks   (read from each packet, NOT stored in frame buffer)
packet byte[1] = chunk_index

if chunk_index < total_chunks - 1:
    copy_size = 0x1200                     // full chunk (4 ctrl + 575×8 pts + 4 pad)
else:
    copy_size = 0x4E24 - chunk_index * 0x1200   // last chunk (4 ctrl + remaining pts)

memcpy(frame_buffer + chunk_index * 0x1200,
       packet_buffer + 4,          // skip 4-byte header
       copy_size)

chunks_received++
if chunks_received >= total_chunks:
    frame_buffer[2] = 0xFA          // frame ready signal (overwrites control byte 2)
    reset tracking vars
```

**Frame ready signal**: When all chunks arrive, byte[2] of the frame buffer is set to 0xFA. This overwrites **control byte 2** (was 0x00). The DAC output task (pri 8) polls this byte before starting DMA.

**Byte[2] / control byte 2**: This is within the 4-byte control header at the start of the frame buffer. The DAC's SPI DMA command has **offset 19 = 4** in its configuration, meaning it reads point data starting from `buffer + 4`, skipping the first 4 bytes entirely. So overwriting byte[2] with 0xFA does NOT affect point data.

### Chunk Count: Must Be 5
The last-chunk copy size formula: `0x4E24 - (total_chunks-1) * 0x1200`

For the copy to not read past the 0x1200-byte packet payload:
```
0x4E24 - (total_chunks-1) * 0x1200 <= 0x1200
→ total_chunks >= ceil(0x4E24 / 0x1200) = 5
```

**You must send exactly 5 chunks per frame.** With fewer chunks, the firmware copies garbage beyond the packet buffer into the frame buffer.

**5 chunks breakdown:**
| Chunk | Copy size | Control | Real points | Pad | Total bytes |
|-------|-----------|---------|-------------|-----|-------------|
| 0-3   | 0x1200    | 4       | 575×8=4600  | 4   | 4608 |
| 4     | 0x624     | 4       | 196×8=1568  | 0   | 1572 |

- **Real points**: 4 × 575 + 196 = **2496**
- **Virtual boundary points**: 4 (blanked, invisible)
- **DAC output**: 2500 slots (2496 real + 4 virtual)

### DAC Output: Reads from buffer + 4

The DAC SPI DMA command structure (configured in `FUN_0800f8fe`) has:
- **offset +16**: point size = 8 bytes
- **offset +19 (0x13)**: buffer start offset = 4

The value 4 at offset 0x13 tells the DMA to skip the first 4 bytes of the frame buffer. The DMA reads point data starting from `frame_buffer + 4`, directly into the SPI TX buffer (one 8-byte point at a time). This is why the 4 control bytes exist at the start — they keep the frame ready flag and PPS info but are never sent to the DAC as point data.

### Duplicate Detection
The last 5 received sequence IDs are tracked per channel in a rolling ring buffer:
- CH1 history: `DAT_080127c0 + 0x24` (5 bytes)
- CH2 history: `DAT_080127c0 + 0x29` (5 bytes)

Duplicate seq values cause the packet to be silently dropped. Lost frame counters at `DAT_080127c0 + 0x10` (CH1) and `DAT_080127c0 + 0x14` (CH2) are incremented when a seq gap is detected.

---

## Settings Packet (type 0x02, 0x9A8 bytes)

The settings block is 2472 bytes. The handler copies bytes[4..7] as IP address. All-0xFF triggers DHCP mode.

```
byte[0]: destination channel (0x00=invalid, 0x01=save CH1 cfg, 0x02=save AND apply)
byte[4..7]: IP address (0xFF.0xFF.0xFF.0xFF = DHCP)
byte[11]: flag byte
```

When saved, a UDP response is sent back to the host with result code.

---

## Heartbeat (type 0x03, 6 bytes)

Payload is 4 bytes of sender IP address. The firmware:
1. Stores the sender IP as the remote target for UDP responses
2. Responds on the same connection with firmware status

### Response Format (FUN_0800aeb8)
The firmware builds a response packet using command byte **0x43** ('C' in ASCII). The response contains:
```
[0]  0x43    — response type byte 'C'
[1]  status/version byte
[2-3] seq number
[4-5] value 0x240 = 576 (points per chunk, echo)
[6-7] register 0x32 = 4 (status field)
[8+]  extended status data
```

The 0x240 (576) value is the firmware's expected points-per-chunk, echoed back to the host.

---

## DAC Output Task (pri 8, FUN_0800F9E8)

### Task Loop
```c
void FUN_0800f9e8(void) {
    int state;
    while (true) {
        state_tick = FUN_08005f3c();          // read hardware status
        *(DAT_0800fa08 + 0xC) = state_tick;
        FUN_0800c99c(DAT_0800fa0c);           // DAC output logic
        OSTimeDly(0, 0, 0, 1000);            // delay 1000 ticks
    }
}
```

`FUN_0800c99c` performs the actual DAC work:
1. Reads hardware status (buttons/GPIO via `FUN_08005f3c`)
2. Based on state_tick value (1-6), either:
   - **Short path** (state_tick < 2): calls `FUN_0800f8e8` (idle/stop output) + `FUN_0800f974` (clear flags)
   - **Full path** (state_tick > 1): calls `FUN_08002b0a`, `FUN_080031aa`, `FUN_0800323c` (SPI/DMA setup), then `FUN_0800f9c6` + `FUN_0800f986` (frame readout)

### Status Reporting (FUN_0800aeb8)
When a frame is consumed, the task sends a status response back to the host (via UDP, command byte 0x43 'C') containing:
- Register 0x39 = 2 (status)
- Value 0x240 = 576 (point count echo)
- Register 0x32 = 4 (config status)
- Calculated checksum/status value

### SPI Output
The actual SPI commands to the DAC chips are in the functions called by the full path:
- `FUN_08002b0a` — prepare SPI transfer
- `FUN_080031aa` — start SPI DMA
- `FUN_0800323c` — wait for completion
- `FUN_0800aeb8` — build and send status response

SPI peripherals: SPI2 (CH1) and SPI3 (CH2), initialized at `FUN_08008644` and `FUN_080086c4`.

---

## Data Structures

### Global State (`DAT_080127c0`)
```
+0x00: byte    ring buffer write index (CH1 seq history)
+0x01: byte    ring buffer write index (CH2 seq history)
+0x08: uint32  last received seq (CH1)
+0x0C: uint32  last received seq (CH2)
+0x10: int32   lost frame counter (CH1)
+0x14: int32   lost frame counter (CH2)
+0x24: byte[5] seq history ring (CH1)
+0x29: byte[5] seq history ring (CH2)
```

### Config Block (`DAT_08012780`)
Size 0x9B0 (2480) bytes. Contains:
- IP configuration (stored at +0x04, applied at +0x9AC)
- Flags byte at +0x9A9 (bit 0 = IP conflict detected)
- Channel-specific settings

### DAC State (`DAT_0800fa08`)
```
+0x0C: uint32  last status tick
```

`DAT_0800fa0c` is passed to `FUN_0800c99c` — likely points to DAC channel state.

---

## Practical Sending Guide

### Minimal frame (CH1, 2496 real points)
Send **5 UDP packets** to port 8089. Each packet is 0x1204 bytes.

**Packet format per chunk:**
```
[0]  total_chunks = 5
[1]  chunk_index = 0..4
[2]  seq = 0..4 (incrementing)
[3]  type = 0x00 (CH1) or 0x01 (CH2)
[4]  control byte 0 = 0x00
[5]  control byte 1 = 0x00
[6]  control byte 2 = 0x00 (overwritten to 0xFA in frame buffer)
[7]  control byte 3 = PPS (e.g. 0x1E = 30 PPS)
[8..]  575 × 8-byte points (chunks 0-3)
        OR 196 × 8-byte points (chunk 4)
[...] 4 zero padding bytes (chunks 0-3 only)
```

| Chunk | Header `BBBB` | Control | Real pts | Pad | Payload | Description |
|-------|---------------|---------|----------|-----|---------|-------------|
| 0 | `05 00 00 00` | 4 bytes | 575 | 4 | 0x1200 | Pts 0-574 |
| 1 | `05 01 01 00` | 4 bytes | 575 | 4 | 0x1200 | Pts 575-1149 |
| 2 | `05 02 02 00` | 4 bytes | 575 | 4 | 0x1200 | Pts 1150-1724 |
| 3 | `05 03 03 00` | 4 bytes | 575 | 4 | 0x1200 | Pts 1725-2299 |
| 4 | `05 04 04 00` | 4 bytes | 196 | 0 | 0x624 | Pts 2300-2495 |

### Frame Buffer After Copy (what DAC reads)
```
Offset  Content               Points
------  ------                ------
0000    4 ctrl bytes (CH0)    [frame header, byte[2]=0xFA when ready]
0004    575 × 8 = 4600 bytes  Real points 0-574
11FC    4 pad + 4 ctrl (CH1)  Virtual point (blanked)
1204    575 × 8 = 4600 bytes  Real points 575-1149
23FC    4 pad + 4 ctrl (CH2)  Virtual point (blanked)
2404    575 × 8 = 4600 bytes  Real points 1150-1724
35FC    4 pad + 4 ctrl (CH3)  Virtual point (blanked)
3604    575 × 8 = 4600 bytes  Real points 1725-2299
47FC    4 pad + 4 ctrl (CH4)  Virtual point (blanked)
4804    196 × 8 = 1568 bytes  Real points 2300-2495
4E1C    (zeros, unused)       Points 2496-2499 (blanked)
```

DAC reads 2500 × 8-byte slots from `buffer + 4`: 2496 real + 4 virtual blanked.

### Notes
- **Control bytes**: `00 00 00 <PPS>` — byte 3 must match your frame rate (30 fps → 0x1E)
- **Last chunk size**: exactly 0x624 bytes (4 + 196×8) — firmware copies this many
- **Seq counter**: must increment per chunk, no duplicates within last 5 frames
- **Frame pacing**: DAC task delays 1000 OS ticks between frames (~10-100ms)
- **Heartbeat**: send type 0x03 (6 bytes) to register as controlling host
- **Channel**: byte[3] = 0x00 CH1, 0x01 CH2

---

## Questions for Further Analysis

1. **SPI command format** — the exact register writes to DAC80501 or equivalent chips (in FUN_0800c99c sub-functions)
2. **X/Y value scaling** — 16-bit values, but what voltage range / DAC resolution?
3. **Blanking GPIO vs point data** — is blanking control on a separate GPIO line?
4. **Tick rate** — what is the uC/OS-II tick rate? Determines frame timing.
5. **Status response format** — full parse of the 0x43 status response packet
