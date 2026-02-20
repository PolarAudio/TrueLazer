# Specification: Art-Net/DMX Expanding (Track 4)

## Overview
This track aims to transform TrueLazer into a professional Art-Net/DMX compatible visual server. It introduces a "Hybrid Mapping" system that combines a high-performance fixed footprint for core application controls with the flexibility of custom DMX patching for individual effects and generators. This allows lighting designers to control the entire application from a console with minimal setup time.

## Functional Requirements

### 1. Fixed DMX Personalities (Hybrid System)
- **Master Section (Channels 1-10)**: 
    - Master Intensity (0-255)
    - Global Blackout (0-127 Off, 128-255 On)
    - Page Selection (0-31 Page 1, 32-63 Page 2...)
    - transport Play/Pause/Stop
- **Layer Footprint (20 Channels per Layer)**:
    - Channel 1: Layer Intensity
    - Channel 2: Blackout/Solo/Autopilot
    - Channel 3: Clip Trigger (Range-based: 0-10 Off, 11-20 Clip 1, 21-30 Clip 2...)
    - Channel 4: Speed Multiplier
    - Channels 5-20: Reserved/Custom Patching for effects
- **Modular Patching**: Maintain the existing ability to "Learn" DMX channels for specific parameters that are not part of the fixed footprint.

### 2. Enhanced Art-Net Management UI
- **DMX Monitor**: Implement a visual 16x32 grid showing the real-time numeric values (0-255) of all 512 channels in the active Art-Net universe.
- **Universe Filtering**: Add a filter to the Art-Net mapping list to allow users to view assignments by Universe.
- **Auto-Patching**: Streamline the assignment process for the fixed footprint.

### 3. Core Integration
- **Context Awareness**: Ensure DMX triggers for clips and layers respect the `activePageId`.
- **Latency Optimization**: Optimize the Art-Net message processing in the main process to handle high-frequency DMX streams (e.g. 44Hz) without impacting laser output.

## Acceptance Criteria
- TrueLazer responds correctly to fixed Master and Layer DMX channels.
- Switching pages via DMX updates the UI and MIDI feedback instantly.
- A functional DMX Monitor grid is visible in the Art-Net settings window.
- Custom mapped parameters coexist peacefully with the fixed layer personalities.
- Real-time performance remains stable under full Art-Net load.

## Out of Scope
- DMX Output (TrueLazer as a console).
- RDM support.
- Pixel mapping via DMX (direct control of every point).
