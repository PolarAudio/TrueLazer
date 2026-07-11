# ShowBridge DAC Protocol Reversal — Session Notes

## Objective
Reverse-engineer ShowBridge DAC firmware protocol to implement compatible frame rendering in TrueLazer.

---

## Firmware Analysis

### Hardware
- **MCU**: STM32H750 (M7, 280 MHz, FPv5)
- **DAC**: Internal H7 DAC with DMA + TIM trigger (One-Pulse Mode)
- **DMA destination address**: 0x40007434 (DAC_DHR12LD? or DAC_SR?), 0x40007440 (DAC_SHSR1?)
- **Frame buffers**: SRAM4 at 0x30040200+, 12 channel structs × 0x5F8 bytes

### System Architecture
- Main loop `FUN_0800f9e8` polls `FUN_08005f3c()` every 1000 ms
- Output controller `FUN_0800c99c` runs each cycle, checks system mode
- When mode > 1: configures TIM/DMA, starts output
- When mode < 2: stops output, cleans up

### Chunk / Frame Format
- One chunk = 0x1200 bytes on wire (4 header + 4 control + 575×8 pts + 4 pad)
- Frame = 5 chunks = 2496 real points (+4 boundary = 2500 slots)
- DMA reads from `buffer + 4` (skips first 4 bytes of chunk 0)
- Each point = 8 bytes: X(2) + Y(2) + blank(1) + R(1) + G(1) + B(1)

### DMA Command Struct (0x2A = 42 bytes)
```
Offset  Size  Field              Description
0x00     4     src_addr          0xFFFFFFFF (invalid marker)
0x04     2     src_addr_hi       0xFFFF
0x06     4     dst_addr          Manager field (param_1 + 0x27)
0x0a     2     dst_addr_hi       Manager field high
0x0c     2     count             0x608 (1544) — element count
0x0e     2     type_flag         0x100 (first buffer)
0x10     2     elem_size         0x0008 (8 bytes per element)
0x12     1     src_burst         0x06
0x13     1     dst_burst         0x04
0x14     2     cycle_type        0x100 (first cycle) / 0x200 (second cycle)
0x16     4     src_buf_lo        Manager buffer spec (low)
0x1a     2     src_buf_hi        Manager buffer spec (high)
0x1c     4     frame_handle      Manager handle
0x20     4     dest_buf_lo       0x00000000
0x24     2     dest_buf_hi       0x0000
0x26     4     frame_addr        Frame buffer pointer
```

### Double-Buffering Flow
1. `FUN_0800c764` allocates desc, fills fields, submits via `(param_1+0x18)(param_1, handle)`, frees handle
2. DMA completion → `FUN_0800c300`:
   - Validates struct fields (type=0x100, burst=6/4, size=8)
   - Checks swap available: `param_1+4` (manager buffer) vs desc offset 0x26
   - If swap available: changes cycle_type to 0x200, swaps source/dest buffers, **resubmits** same handle
   - If cycle_type == 0x200: sends UDP response (command 0x43, "output complete")
3. `FUN_0800c828`: Simple descriptor for status confirmations (count=8)

### Timer Config
- **One-Pulse Mode** (OPM) enabled: `CR1 |= 2` in `FUN_0800323c`
- **Counter enabled**: `CR1 |= 1`
- 12 channel entries configured with trigger source (offset 0x0c |= 0x40000000)
- Manager `state + 0x24` = **0x5DC (1500)** — frame point-count limit
- DMA desc `count` = **0x608 (1544)** — elements per cycle

### Key State Fields (Manager Struct at param_1)
```
Offset  Field
0x04    Current buffer handle/pointer
0x24    Frame point-count limit (1500)
0x26    0x06 (DMA config byte)
0x27    0x20 (first byte from DAT_0800ead0)
0x28-0x2c  Remaining 5 bytes from DAT_0800ead0
0x2d    State flags (bit 0: output active, bit 4: output pending)
```

### Key Constants
| Constant | Value | Meaning |
|----------|-------|---------|
| DAT_0800c824 | 0x08012f4a | Points to 0x00000000 (dest addr constant) |
| DAT_0800c824-6 | 0x08012f44 | Points to 0xFFFFFFFF (src addr constant) |
| DAT_0800cad0 | RAM array | 3 entries × 0x230 byte allocs |
| DAT_0800cad4 | RAM array | 2 × 0x22c + 1 × 0x200 byte allocs |
| DAT_0800ca18 / DAT_0800eae0 | 0x2400355c | Hardware abstraction struct |
| DAT_0800ead0 | 0x24037d20 | DAC manager struct addr |
| DAT_0800ead4 | 0x30040200 | DMA channel buffer base (SRAM4) |
| DAT_0800ead8 | 0x0800fd27 | Flash config pointer |
| DAT_0800eadc | 0x24037e68 | Pipeline manager struct |
| chunk_size | 0x1200 (4608) | Bytes per UDP chunk |
| pts_per_chunk | 575 | Real points per full chunk |

### ⚠️ CORRECTIONS (2026-07-10)

**Previous findings from ShowBridge.bin were correct for the firmware, but key misunderstandings existed:**

#### 1. FUN_0800AEB8 is DEAD CODE
The function at `0x0800AEB8` that was labeled as "build 0x43 status response" is **never called, never referenced** anywhere in the binary. It was a static copy sitting in the firmware but unreachable. All "status response builder" notes referencing `FUN_0800AEB8` are incorrect.

#### 2. REAL Response Path: FUN_0800AA48 → FUN_0800ACDC
The actual gatekeeping and response sending logic is:
- `FUN_0800AA48`: 4 gatekeeping checks (DMA desc valid, context exists, **context->byte[0xc]==8**, sequence matches)
- `FUN_0800ACDC`: builds and sends status response via `FUN_08012CE8`
- Called **only** from `FUN_0800C300` DMA completion handler **when `cycle_type == 0x200`**

#### 3. The `17 32` Response IS NOT a Data-Receipt ACK
The `17 32 01 01 00 48 00 2e...` response we receive is the **heartbeat/discovery response**, NOT a data-receipt acknowledgment:
- `0x17` = pbuf `tot_len` field (23 bytes, computed by LWIP)
- `0x32` = first data byte at payload offset `0xF0`
- Sent in response to 6-byte heartbeat packets (type 0x03) or 16-byte discovery packets (type 0x04)
- The response stores sender IP from the heartbeat packet, then replies with firmware status

#### 4. No Buffer Overrun with 5-Chunk Format
With the formula `copy_size = 0x4E24 - chunk_index * 0x1200`:
- 5 chunks: last copy = 0x0624 bytes, source fits within 0x1204-byte reassembly buffer ✓
- **BUT 3 chunks**: last copy = 0x2A24 (10788) bytes, reads 6180 bytes past the 0x1204 reassembly buffer ✗
- This means Truwave's 3-chunk format causes an overrun READ (reads garbage into frame buffer tail)
- The overrun explains why 5-chunk test caused DAC to go silent (corrupted state), while 3 chunks "work" (laser still fires from first 4608 bytes of valid data)

#### 5. The 0x43 "Type" is a Send-Function Parameter, Not a Wire Byte
At `0x0800AD24`: `movs r3, #0x43` passes `0x43` as parameter `r3` to `FUN_08012CE8` (the network send wrapper). It's used as a **connection/port identifier** internally, NOT written as a byte in the UDP payload.

#### 6. Why the DAC Never Sends 0x43 Responses (Revealed)
The 4 gatekeeping checks in `FUN_0800AA48`:
1. `r0 != NULL` — DMA descriptor valid (should pass)
2. `r0->offset_0x20 != NULL` — context exists (should pass)  
3. **`context->byte[0xc] == 8`** — **LIKELY FAILS** — requires channel to be configured with type=8
4. `*r1 == context->offset_0x24` — sequence match (not reached if #3 fails)

The channel must be pre-configured with type=8 via a settings packet (type 0x02). Our data packets don't do this configuration. Additionally, even if properly configured, the response only fires on `cycle_type == 0x200` DMA cycles, and the 3-chunk buffer overrun could corrupt the context struct needed for check #2 or #3.

#### 7. Both Firmware Binaries are Identical
`ShowbridgeFirmware.bin` (128KB) and `showbridge\ShowBridge.bin` (77KB) are **identical** for the first 78,836 bytes. The extra 52KB in `ShowbridgeFirmware.bin` is all `0xFF` (erased flash padding). All previous analysis of `ShowBridge.bin` applies to the actual DAC firmware.

#### 8. Working 3-Chunk Format (Truwave Actual)
Truwave sends 3 chunks per frame, each `0x1204` bytes:
- **8-byte header**: `[total_chunks(1)][chunk_index(1)][seq(2 LE)][const(4)]`
  - Chunk 0: `03 00 <seq> fe 03 00 1e`
  - Chunk 1: `03 01 <seq> 00 ff ff ff`
  - Chunk 2: `03 02 <seq> 00 00 00 00`
- **575 points per chunk** (4600 bytes): each 8 bytes = `X(2 LE) Y(2 LE) BL(1) R(1) G(1) B(1)`
- **BL=0** = visible (laser ON), **BL≠0** = blanked (laser OFF)
- **12-bit coordinates** (0-4095), center at 2048
- **4-byte footer**: `a3 1f 00 00` at offset 4608
- Total per chunk: `8 + 4600 + 4 = 4612 = 0x1204`

### 575-Point Limit Hypothesis
Most likely cause: Timer **OPM** repetition counter (RCR) set for 575 triggers only. The `state+0x24=1500` may not be the active RCR — the actual repetition count could be computed from chunk/point count at DMA start. If only chunk 0 data has arrived by the time the 1-second poll loop triggers output, RCR = 574.

**Verification test**: Wireshark capture to confirm chunk timing; or send all 5 chunks concatenated in a single ~23KB UDP packet to ensure all data is present before DMA start.

### Console / Boot Info
- UART: COM3, 115200 8N1
- Chinese firmware, DHCP timeout after ~54 attempts → fallback IP 192.168.1.118
- User reports using 169.254.25.118 (likely set via heartbeat)
- UDP port: 0x1F99 (8089)
- Console fields: lwip_comm_init_status=0, udp_demo_init_status=0, linkState=2

---

## Testing

### test_showbridge.py
- Sends 2-channel (type 0x00/0x01), 5 chunks, 2496 points
- Fixed: struct.pack("BBBB") for header, removed heartbeat
- IP: 169.254.25.118:8089
