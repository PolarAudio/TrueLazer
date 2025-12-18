# ILDA Digital Network (IDN) Stream Protocol Summary

This document summarizes the key aspects of the ILDA Digital Network (IDN) stream protocol, focusing on packet structure and byte order as defined in `ILDA-IDN-Stream-rev002.pdf`.

## 1. Endianness

All multi-octet data words use **network byte order (big-endian)**.

## 2. IDN Message Structure

All IDN messages follow a generic header structure.

| Octet | 0-1                  | 2-3                  | 4...         |
|-------|----------------------|----------------------|--------------|
| Field | **Total Size** (16-bit)| **Content ID** (16-bit)| **Data** (optional) |

-   **Total Size**: Total size of the message in octets (header + data).
-   **Content ID**:
    -   `0x0000` - `0x7FFF`: Control information or metadata.
    -   `0x8000` - `0xFFFF`: Channel messages (used for streaming).

## 3. Channel Message Header

Channel messages are a specific type of IDN message, identified by a Content ID >= `0x8000`. They have an extended header.

| Octet  | 0-1                  | 2                      | 3                      | 4-7                  | 8...                       |
|--------|----------------------|------------------------|------------------------|----------------------|----------------------------|
| Field  | **Total Size** (16-bit)| **CNL** (8-bit)        | **Chunk Type** (8-bit) | **Timestamp** (32-bit) | **Channel Config** (optional) |

-   **CNL (Channel-config, last-fragment, channel-ID)**:
-   **Chunk Type**: Type of data in the message.
-   **Timestamp**: Message timestamp in microseconds.

### 3.1. Channel Configuration and Routing (CNL)

The CNL octet is the most significant octet of the Content ID.

| Bit   | 7 (MSB) | 6       | 5-0         |
|-------|---------|---------|-------------|
| Field | 1       | **CCLF**| **Channel ID**|

-   **Bit 7**: Always `1` for channel messages.
-   **CCLF (Channel Config and Last Fragment)**:
    -   If `1`: A channel configuration header is present. For fragmented data, this also marks the last fragment.
    -   If `0`: No configuration header is present.
-   **Channel ID**: An arbitrary ID (`0`-`63`) to identify the channel.

### 3.2. Chunk Types

Identifies the data in the message.

| Type   | Description                               |
|--------|-------------------------------------------|
| `0x00` | Void (no data)                            |
| `0x01` | Laser Projector Wave Samples              |
| `0x02` | Laser Projector Frame Samples (entire)    |
| `0x03` | Laser Projector Frame Samples (first frag)|
| `0xC0` | Laser Projector Frame Samples (sequel frag)|
| `0x10` | Octet Segment                             |
| `0x18` | Dimmer Levels                             |

## 4. Channel Configuration Header

This header is present if the `CCLF` bit is `1`. It follows the Channel Message Header.

| Octet | 0          | 1          | 2-3            | 4-5              |
|-------|------------|------------|----------------|------------------|
| Field | **SCWC** (8-bit) | **CFL** (8-bit)| **Service ID** (16-bit) | **Service Mode** (16-bit) |

-   **SCWC (Service Configuration Word Count)**: Number of 32-bit words of service-specific config data that follow this header.
-   **CFL (Channel and service configuration Flags)**:
-   **Service ID**: The service the channel is connected to (e.g., `0x80` for Laser Projector).
-   **Service Mode**: The mode the service should operate in.

### 4.1. CFL (Channel and service configuration Flags)

| Bit   | 7-6  | 5-4       | 3-2  | 1       | 0         |
|-------|------|-----------|------|---------|-----------|
| Field | `00` | **SDM**   | `00` | **Close** | **Routing** |

-   **SDM (Service Data Match)**: A value that must match in data chunks to ensure configuration compatibility.
-   **Close**: If `1`, closes the channel after this message.
-   **Routing**: If `1`, opens and routes the channel to the specified `Service ID` and `Service Mode`.

### 4.2. Service Modes

| Mode   | Description                        |
|--------|------------------------------------|
| `0x01` | Laser Projector Graphic (Continuous) |
| `0x02` | Laser Projector Graphic (Discrete)   |
| `0x03` | Laser Projector Effects (Continuous) |
| `0x04` | Laser Projector Effects (Discrete)   |
| `0x05` | DMX512 (Continuous)                |
| `0x06` | DMX512 (Discrete)                  |

## 5. Laser Projector Service (`Service ID = 0x80`)

### 5.1. Graphic Mode Configuration (Dictionary)

The configuration for graphic modes is a "dictionary" of 16-bit tags that describe the structure of a single sample point.

**Generic Tag Structure:**

| Nibble | 3 (MSB)      | 2            | 1          | 0 (LSB)     |
|--------|--------------|--------------|------------|-------------|
| Field  | **Category** | **Subcategory**| **Identifier** | **Parameter** |

**Example Tags:**

| Tag (Hex) | Description                   | Category | Data Type in Sample |
|-----------|-------------------------------|----------|---------------------|
| `0x420*`  | X Coordinate                  | 4        | Signed 8-bit        |
| `0x421*`  | Y Coordinate                  | 4        | Signed 8-bit        |
| `0x4010`  | 16-bit precision modifier     | 4        | -                   |
| `0x5***`  | Color (R, G, B, etc.)         | 5        | Unsigned 8-bit      |
| `0x4101`  | Shutter control in sample     | 4        | 1-bit (in an octet) |

A typical sample structure for a simple X/Y/R/G/B frame would be defined by a dictionary of tags like `[X, Y, R, G, B]`, meaning each point in the data chunk consists of 5 octets. If 16-bit precision is needed, a precision tag (`0x4010`) follows the coordinate tag. For example: `[X, 16-bit-prec, Y, 16-bit-prec, R, G, B]`.

### 5.2. Data Chunks

#### Laser Projector Frame Samples (`Chunk Type = 0x02`)

Used in **Discrete Graphic Mode**. Contains a full frame.

| Octet | 0-3        | 4...             |
|-------|------------|------------------|
| Field | **Header** | **Sample Array** |

**Header:**

| Octet | 0        | 1-3        |
|-------|----------|------------|
| Field | **Flags**| **Duration** (µs) |

-   **Flags**:
    -   Bit 0 (`Once`): If `1`, draw the frame only once.
-   **Duration**: Duration of the frame in microseconds.
-   **Sample Array**: An array of points. The structure of each point is defined by the graphic mode configuration dictionary.
    -   The **first sample** is the *start position* (invisible "move").
    -   The remaining samples are the vertices of the frame to be drawn.

#### Laser Projector Wave Samples (`Chunk Type = 0x01`)

Used in **Continuous Graphic Mode**. Contains a gapless stream of points.

| Octet | 0-3        | 4...             |
|-------|------------|------------------|
| Field | **Header** | **Sample Array** |

**Header:**

| Octet | 0        | 1-3        |
|-------|----------|------------|
| Field | **Flags**| **Duration** (µs) |

-   **Duration**: Duration of the entire sample array interval in µs. The point rate is `(number of samples) / Duration`.
-   **Sample Array**: A continuous array of points.
