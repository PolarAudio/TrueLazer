# Session Summary — Full Protocol Reversal

## Core Payload Structure (Per Chunk)

```
[4 byte UDP header] [4 control bytes] [575 × 8-byte points] [4 byte padding]
```

Total: `4 + 4 + 4600 + 4 = 4612 = 0x1204` bytes per UDP datagram.

**The 4 control bytes** (`00 00 00 1e` in all captures):
| Byte | Value | Meaning |
|------|-------|---------|
| 0    | total_chunks | Number of chunks in this frame (e.g., 5) |
| 1    | chunk_index | Zero-based index of this chunk |
| 2    | frame_seq | Frame sequence number (incrementing per frame) |
| 3    | PPS | Pulses per second (e.g., 0x1E = 30) |

## 0xFA Frame Ready Flag — Clarified

**`frame_buffer[2] = 0xFA` is metadata only** — written by the UDP dispatch function when all chunks of a frame are received. It is NOT polled by the DAC output task. The DAC output is controlled entirely by:
- System mode from `FUN_08005f3c()` (mode < 2 = idle/stop, mode > 1 = active/run)
- State flags at `state + 0x2d`: bit 4 = output enable, bit 0 = DMA active

The 0xFA flag exists for the Truwave software's benefit (reads it back via status response).

## Frame Buffer Layout (0x4E24 bytes per channel)

```
offset  content                          source
------  -------                          ------
+0x0000 control bytes[4]                 chunk 0 ctrl (byte[2] → 0xFA when frame complete)
+0x0004 575 points × 8 = 4600 bytes      chunk 0 payload
+0x11FC 4 padding bytes                  chunk 0 pad
+0x1200 control bytes[4]                 chunk 1 ctrl
+0x1204 575 points × 8 = 4600 bytes      chunk 1 payload
+0x23FC 4 padding bytes                  chunk 1 pad
+0x2400 ...                              chunks 2-3 same pattern
+0x4800 control bytes[4]                 chunk 4 ctrl
+0x4804 196 points × 8 = 1568 bytes      chunk 4 payload (no padding needed)
+0x4E24 end of buffer
```

Total DMA capacity: `(0x4E24 - 4) / 8 = 2500` 8-byte blocks.
Valid points: `4×575 + 196 = 2496`. Remaining 4 slots = inter-chunk boundary straddles.

## UDP Dispatch Function (FUN_08012310)

This is the LWIP `udp_recv()` callback. Key flow:

### Packet Reception
1. Linearizes the LWIP pbuf chain into a reassembly buffer at `DAT_0801277c`
2. Determines packet type from total size:
   - `0x1204` bytes → type from header byte[3]
   - `0x9a8` bytes → type 2 (settings)
   - `6` bytes → type 3 (heartbeat)
   - `0x10` bytes → type 4 (IP conflict)

### Type Dispatch
- **type 0x00** (CH1 data): Routes to CH1 frame buffer at `*DAT_080127e0`
- **type 0x01** (CH2 data): Routes to CH2 frame buffer at `*DAT_08012804`
- **type 0x02** (settings): Handles IP configuration, saves to flash
- **type 0x03** (heartbeat): Records sender IP, sends response
- **type 0x06** (GPIO): Sets GPIO port/pin/level
- **type 0xFD** (file write): Writes arbitrary data to filesystem
- **type 0xFE** (reserved): No action

### CH1/CH2 Frame Processing

**Copy size determination** (using packet's chunk_index):
```
if chunk_index < total_chunks - 1:
    size = 0x1200        # non-last chunk
else:
    size = 0x4E24 - chunk_index * 0x1200   # last chunk
```

**Frame completion** (using chunks_received counter at `state+0x10`):
1. Increment `chunks_received`
2. If `total_chunks <= chunks_received`: write `frame_buffer[2] = 0xFA`, increment frame counter, reset `chunks_received = 0`

### Sequence Number Tracking
- Byte[2] = frame sequence number (all chunks in a frame share the same seq)
- 5-entry ring buffer at `state+0x24` (CH1) / `state+0x29` (CH2) for duplicate detection
- When new seq arrives and `chunks_received > 0` → a lost frame is counted (incomplete previous frame)
- `chunks_received` reset to 0 at start of each new frame

### 🚨 Last Chunk Copy Overflow Bug
For total_chunks < 5, the last chunk's copy formula `0x4E24 - chunk_idx × 0x1200` reads **far past** the 0x1200-byte packet payload:
- total_chunks=4: copies 0x1824 bytes from 0x1200 buffer → overrun by 0x624 bytes
- total_chunks=3: copies 0x2A24 bytes from 0x1200 buffer → overrun by 0x1824 bytes

This garbage is written to the trailing frame buffer slots. Combined with stale data from previous frames (frame buffer is NEVER cleared), the DMA outputs junk points for the unfilled slots.

## DMA Command Structure (`FUN_0800c764`)

Allocates a 42-byte command slot (`FUN_0800fa10(3, 0x2a, 0)`). Layout:

| Offset | Size | Value | Meaning |
|--------|------|-------|---------|
| 0x00 | 4 | param_3 | Buffer base address (lower 32 bits) |
| 0x04 | 2 | param_3[1] | Buffer base (upper bits) |
| 0x06 | 4 | param_2 | Channel DMA address? |
| 0x0A | 2 | param_2[1] | Cont'd |
| **0x0C** | **2** | **0x608** | **Point count / transfer size** |
| **0x0E** | **2** | **0x100** | **Flags (start trigger)** |
| **0x10** | **2** | **8** | **Point size (bytes per point)** |
| **0x12** | **1** | **6** | **DMA config byte** |
| **0x13** | **1** | **4** | **Buffer offset (DMA reads from buffer+4)** |
| 0x14 | 2 | param_8 | Type: 0x100=first buf, 0x200=second/commit |
| 0x16 | 4 | param_4 | Ping-pong swap address (next buffer base) |
| 0x1A | 2 | param_4[1] | Ping-pong swap (next buffer upper bits) |
| 0x20 | 4 | param_6 | Buffer-related address |
| 0x22 | 2 | param_6[1] | Cont'd |
| **0x24** | **4** | **param_5** | **Frame buffer handle / owner context** |
| 0x26 | 4 | param_7 | Completion callback context |

**Per-point format** (DMA reads 8 bytes from buffer+4):
- bytes 0-1: X coordinate (LE int16)
- bytes 2-3: Y coordinate (LE int16)
- byte 4: blanking (0 = invisible, 1 = visible)
- bytes 5-7: R/G/B intensity

## DMA Pipeline (`FUN_0800c890`)

Manages 10 command slots at `DAT_0800c908` (each 0x14 bytes):
- +0x00: callback pointer (freed after use)
- +0x08: owner (channel state pointer)
- +0x0C: buffer pointer
- +0x12: state (2 = active/ready)

On buffer setup: allocates slot, marks active, stores channel pointer + buffer address.

## DMA Completion / Double Buffering (`FUN_0800c300`)

The DMA uses **ping-pong double buffering**:

1. **First buffer (type 0x100) completes**:
   - Validates command signature (0x0E=0x100, 0x12=6, 0x13=4, point_size=8)
   - Extracts buffer handle from offset 0x24
   - Calls `FUN_0800c890` to update pipeline
   - **Swaps buffers**: saves current handle, loads next buffer from `state+4`, rotates address fields
   - **Resubmits** command for second buffer

2. **Second buffer (type 0x200) completes**:
   - Calls `FUN_0800aa48` to send completion notification via UDP (command byte 0x43)
   - Writes register 0x0C, sends status, increments completion counter

This creates seamless output: while buffer A is DMA'd, buffer B can be written by UDP dispatcher.

## System Mode (from `FUN_08005f3c`)

Read from external SPI device registers (CPLD/FPGA or GPIO expander). 6 modes:

| Mode | Name | Register pattern | DAC params |
|------|------|-----------------|------------|
| 1 | IDLE/STOP | Reg1 bit 2 set | Output stops, DMA disabled |
| 2 | RUN-0 | Reg0 bits 8+12, or Reg0x1f bits[7:5]=6 | (0x4000, 0x2000) |
| 3 | RUN-1 | Reg0 bit 13, or Reg0x1f bits[7:5]=2 | (0x4000, 0) |
| 4 | RUN-2 | Reg0 bit 8, or Reg0x1f bits[7:5]=5 | (0, 0x2000) |
| 5 | RUN-3 | Default fallback | (0, 0) |
| 6 | SPECIAL | Reg0 bit 12 set, Reg0x1f bit 12 clear | No output action |

Mode-specific params override bits in the SPI peripheral config to select which TIM/DMA channels drive which DAC axes.

## State Flags (`state + 0x2d`)

| Bit | Mask | Name | Set by | Cleared by |
|-----|------|------|--------|------------|
| 0 | 0x01 | DMA_BUSY | `f9c6` after DMA start | `f8e8` on stop (if bit 5 also set) |
| 4 | 0x10 | OUTPUT_ENABLED | `f986` after DMA start | `f974` on stop |
| 5 | 0x20 | BUF_READY | (external signal?) | (completion handler?) |

**Buffer setup trigger** (`FUN_0800f9c6`): When bit 0 (DMA_BUSY) AND bit 5 (BUF_READY) both set → calls `FUN_0800c804` which builds the DMA command and queues the frame buffer.

## Output Control Logic (`FUN_0800c99c`)

```
OUTPUT_ENABLED && mode < 2   → STOP  (SPI/DMA stop, clear flags, free command slots)
!OUTPUT_ENABLED && mode > 1  → START (SPI config → DMA config → DMA start → set flags)
OUTPUT_ENABLED && mode > 1   → no-op (already running)
!OUTPUT_ENABLED && mode < 2  → no-op (idle)
```

## Full Data Flow

```
UDP packet arrives (0x1204 bytes)
  → LWIP callback FUN_08012310
    → linearize pbuf → reassembly buffer
    → type dispatch (0x00=CH1, 0x01=CH2)
    → copy payload to frame_buffer + chunk_idx * 0x1200
    → chunks_received++
    → total_chunks <= chunks_received → frame_buffer[2] = 0xFA, frame_counter++

Main loop (1000ms): FUN_0800f9e8
  → read system mode from SPI device: FUN_08005f3c
  → if mode >= 2 && !output_enabled:
      → SPI config: FUN_08002b0a (→ FUN_08002298 writes peripheral regs)
      → DMA config: FUN_080031aa
      → DMA start: FUN_0800323c
      → set bit 0 (DMA_BUSY): FUN_0800f9c6
      → set bit 4 (OUTPUT_ENABLED): FUN_0800f986

Buffer pipeline trigger (bits 0 & 5 set):
  → FUN_0800c804 → FUN_0800c764 builds 42-byte command struct
    → stores buffer base, point_size=8, offset=4, count=0x608
    → submits via state callback

DMA reads 2500 × 8-byte blocks from frame_buffer+4
  → outputs to DAC hardware via SPI

DMA complete → FUN_0800c300:
  → type 0x100: swap buffer, resubmit for second half
  → type 0x200: notify host via UDP response
```

## Frame Buffer Initialization

Buffers are dynamically allocated at runtime:
- `DAT_080127e0` (flash 0x080127e0) → initial value `0x2400004C` (ptr to ptr in SRAM)
- `DAT_08012804` (flash 0x08012804) → initial value `0x24000054` (ptr to ptr in SRAM)
- Each SRAM slot holds the actual buffer address, allocated by `FUN_0800f82c(0, 0x4E24)`

Channel init (`FUN_0800f284`): calls `FUN_0800f724(channel)` for channels 0, 2, 3, 4, 5:
- Buffer ptr from table `DAT_0800f74c + channel*4 + 0x20`
- Size from `DAT_0800f748 + channel*4` (in 32-bit words)
- memset(ptr, 0, size)
- Sets init flag at `DAT_0800f74c + channel + 0x38` = 1

Channel 0 → CH1 (type 0x00). Channel 2 → CH2 (type 0x01). Channels 3-5 are spare.

## Inter-Chunk Boundary Straddle

At each chunk boundary, the DMA reads 8 bytes spanning `padding[4] + next_ctrl[4]`:
```
frame_buffer[0x11FC..0x11FF] = 4 padding bytes (chunk N tail)
frame_buffer[0x1200..0x1203] = 4 control bytes (chunk N+1 head)
```

The padding bytes are don't-care. The control byte[0] becomes this "virtual point's" blanking field — must be `0x00` (invisible) to avoid a visible glitch point.

## Sender-Side Behavior (Truwave.exe)

- Uses a stack buffer `char buf[0x1204]`, NEVER zeroed
- Only `payload_size` bytes written via `memmove`
- Tail of last chunk in first frame = uninitialized stack garbage
- Subsequent frames: tail = previous frame's last chunk bytes (stale remnants)
- These stale bytes are faithfully copied into the frame buffer and output by the DMA

## Point Counts Summary

| Property | Value |
|----------|-------|
| Points per non-last chunk | 575 |
| Non-last chunk payload | `4 + 575×8 + 4 = 4608 = 0x1200` |
| Last chunk (5 total) | `0x4E24 - 4×0x1200 = 0x624` = `4 + 196×8` |
| Total points per frame | `4×575 + 196 = 2496` |
| Frame buffer capacity | 2500 DMA slots (2496 + 4 boundaries) |
| Truwave chunks/capture | 3 (1725 pts — missing 2 chunks from capture) |

## Key Functions in Ghidra

| Function | Purpose |
|----------|---------|
| `FUN_08012310` | LWIP UDP receive callback — main dispatch |
| `FUN_0800f856` | Byte-by-byte memcpy (no bounds check) |
| `FUN_0800c99c` | Check DAC state, trigger/stop output by mode |
| `FUN_0800f9e8` | Main loop (1000ms), calls DAC check |
| `FUN_0800c764` | Build 42-byte DMA command struct |
| `FUN_0800c890` | Buffer update / command slot alloc in DMA pipeline |
| `FUN_0800c300` | DMA completion callback (double-buffering) |
| `FUN_0800c804` | Buffer pipeline trigger (calls c764) |
| `FUN_0800f724` | Channel frame buffer clear (memset zero) |
| `FUN_0800f86c` | Channel state constructor (init struct, linked list) |
| `FUN_0800f284` | Main init — calls f724 for channels 0,2,3,4,5 |
| `FUN_0800e2ac` | Console/status display task |
| `FUN_0800aeb8` | Status response builder |
| `FUN_0800abbc` | UDP response sender |
| `FUN_0800aa48` | DMA completion handler (sends UDP response, type 8) |
| `FUN_08012cc0` | UDP packet send wrapper (LWIP) |
| `FUN_0800f9c6` | Set flags (DMA_BUSY, trigger buffer setup) |
| `FUN_0800f986` | Set flag (OUTPUT_ENABLED) |
| `FUN_0800f8e8` | Clear DMA_BUSY, cleanup command slots |
| `FUN_0800f974` | Clear OUTPUT_ENABLED |
| `FUN_08005f3c` | Read system mode from SPI device (modes 1-6) |
| `FUN_080060a4` | SPI register read wrapper |
| `FUN_08002b0a` | Read SPI device config into struct |
| `FUN_080031aa` | DMA config (calls FUN_08002298 to write peripheral regs) |
| `FUN_0800323c` | DMA start (enable interrupts, start transfer) |
| `FUN_080032f2` | DMA stop (disable everything) |
| `FUN_08002298` | Write SPI peripheral registers from config struct |
| `FUN_0800f8ba` | UDP port configuration |
| `FUN_0800f82c` | Frame buffer allocator (calls FUN_0800f750) |
| `thunk_FUN_0800f856` | memcpy to frame buffer |
| `thunk_FUN_0800f862` | memset (used by f724 to clear frame buffers) |

## Key Global Variables

| Symbol | Type | Address | Purpose |
|--------|------|---------|---------|
| `DAT_0801277c` | `byte**` | flash 0x0801277c | Reassembly buffer pointer (pbuf linearization target) |
| `DAT_080127c0` | `byte*` | flash 0x080127c0 | Channel state struct (seq history, counters) |
| `DAT_080127e0` | `int*` | flash 0x080127e0 | CH1 frame buffer handle → SRAM 0x2400004C (pointer to 0x4E24-byte buffer) |
| `DAT_080127e4` | `int*` | flash 0x080127e4 | CH1 frame counter (increments per complete frame) |
| `DAT_08012804` | `int*` | flash 0x08012804 | CH2 frame buffer handle → SRAM 0x24000054 |
| `DAT_08012808` | `int*` | flash 0x08012808 | CH2 frame counter |
| `DAT_080127dc` | `int*` | flash 0x080127dc | CH1 lost frame counter |
| `DAT_08012800` | `int*` | flash 0x08012800 | CH2 lost frame counter |
| `DAT_0800f74c` | struct* | flash 0x0800f74c | → SRAM 0x24000120 (channel buffer control struct) |
| `DAT_0800f748` | int** | flash 0x0800f748 | → flash 0x08012DFC (channel buffer size table, 6 entries) |
| `DAT_0800ca18` | int* | flash 0x0800ca18 | SPI device handle (used by DAC output) |
| `DAT_0800c908` | int* | flash 0x0800c908 | DMA command slot array base (10 slots × 0x14 bytes) |

## State Structure Layout (DAT_080127c0)

| Offset | Field |
|--------|-------|
| +0x00 | CH1 seq_history_write_idx (byte) |
| +0x01 | CH2 seq_history_write_idx (byte) |
| +0x08 | CH1 last_seq (4 bytes) |
| +0x0C | CH2 last_seq (4 bytes) |
| +0x10 | CH1 chunks_received (4 bytes) |
| +0x14 | CH2 chunks_received (4 bytes) |
| +0x24..0x28 | CH1 seq history ring buffer (5 bytes) |
| +0x29..0x2D | CH2 seq history ring buffer (5 bytes) |

## How to Correctly Send Frame Data

1. **5 chunks per frame** (avoid the overflow bug)
2. **Each chunk**: `[4 header][575 × 8-byte points][4 zero pad]` = 0x1200 payload
3. **Header bytes**: [total_chunks=5] [chunk_index 0-4] [frame_seq] [PPS]
4. **Last chunk** (index 4): `4 header + 196 × 8-byte points` = 0x624 payload (no padding)
5. **UDP packet**: 4-byte LWIP header + 0x1200-byte payload = 0x1204 total
6. **First byte of each non-zero chunk**: MUST be 0x00 (boundary point blanking)
7. **DMA reads from buffer+4**: points start at offset 4 in frame buffer
8. **No need to set 0xFA**: firmware does this automatically when all chunks received
9. **Laser ON/OFF**: NOT in control bytes. Likely sent as blanking=1 in individual points, or via separate command (type 0x06 GPIO?)

## Session 2026-07-07 — UART Console, Boot Sequence, Port Confirmation

### Console Output Decoded
```
sd_status=%d, mount_status=%d, lwip_comm_init_status=%d, udp_demo_init_status=%d,
linkState=%d, bt_work=%d, status spi_test=%d, wgCount=%d, selfMode=%d

IP filter status = %d, Skiped %d pcakges. Ch1 got %d lost %d, Ch2 got %d lost %d frames.
```

**Status struct** at `DAT_0800e6b4` (pointer via `pcVar4`):
| Offset | Field | Typical |
|--------|-------|---------|
| byte[0] | sd_status | 0=OK/no card |
| byte[1] | mount_status | 3=error (no SD) |
| byte[2] | lwip_comm_init_status | 0=OK |
| byte[3] | udp_demo_init_status | 0=OK |
| byte[4] | bt_work | 0=inactive |
| byte[5] | status spi_test | 0=OK |
| bytes[6-7] | short (waveform data) | — |
| bytes[8-9] | short (waveform data) | — |
| uint[3] (offset 0x0c) | linkState | 2=link up |

Other fields:
- **wgCount**: from `FUN_08009384()` — increments `*(DAT_08009390 + 8)` each display cycle
- **selfMode**: from `FUN_08005f24(0)` — reads byte at `DAT_08005f38 + 0x15` (NOT the system mode from SPI)
- **IP filter status**: from `FUN_08005a58()` — reads `*DAT_08005a60`. 0 = filter disabled (all senders allowed)

### Boot Sequence (Chinese firmware UART via COM3, 115200 baud)
Terminal capture in `terminal_capture.txt` (236 lines).

1. `Firmware 0:/damei/ShowBridge.bin not existed.` — SD card bootloader path not found
2. Repeated Chinese: `"正在获取地址..."` ("Getting address...") — DHCP client runs for ~54 iterations
3. `linkState` transitions 1→2 when Ethernet link comes up
4. **DHCP timeout** → fallback to static IP:
   - **MAC**: `02:00:00:48:00:2E`
   - **IP**: `192.168.1.118`
   - **Subnet**: `255.255.255.0`
   - **Gateway**: `192.168.1.1`
5. After fallback, periodic status lines print every ~500ms

**Note**: If user reports different IP (e.g., `169.254.25.118`), IP may have been changed via heartbeat command.

### UDP Port Confirmation
Raw disassembly at `FUN_080122dc` (`0x080122ec`):
```asm
ldr r1, [pc, #28]   ; r1 = DWORD_08012308 = 0x08012F50 (callback ref)
movw r2, #0x1f99    ; r2 = 0x1F99 = 8089 (UDP port)
bl FUN_080121f8      ; register connection with port
```

Port stored at `conn + 0x12`. Checked for uniqueness. **Port 8089 is the only UDP listener** — all packet types arrive on this port, distinguished by total size:
| Size | Type | Byte[3] |
|------|------|---------|
| 0x1204 (4612) | Data | 0x00=CH1, 0x01=CH2 |
| 0x9A8 (2472) | Setting | — |
| 6 | Heartbeat | — |
| 0x10 (16) | IP conflict | — |

### Heartbeat Packet (Type 3, 6 bytes)
- Changes DAC's IP to match **sender's IP** (from UDP header)
- `FUN_08005e78()` validates before applying
- Always sends a response packet back

### test_showbridge.py Fixes
- `struct.pack("<hBBB"` → `"<hBB"` (3 args: total_points, reserved, PPS)
- Removed heartbeat prefix (would change DAC's IP)
- Target IP: `169.254.25.118` (user's working link-local)
- Port: `8089`
