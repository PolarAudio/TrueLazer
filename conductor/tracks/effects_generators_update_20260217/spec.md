# Specification: Effects & Generators Update (Track 1)

## Overview
This track focuses on expanding the generative and effects capabilities of TrueLazer. It includes enhancements to the Mirror and Delay effects, refinement of the Triangle generator, and the addition of two new generators: Waveform (Audio Analysis) and Timer.

## Functional Requirements

### 1. Effects Enhancements
- **Mirror Effect**:
    - Add `axisOffset` parameter (Range: -1.0 to 1.0). If mirroring on X, this moves the vertical axis left/right. If mirroring on Y, it moves the horizontal axis up/down.
    - Add `planeRotation` parameter (Range: 0-360 degrees). This rotates the mirror line/plane around the center point.
- **Delay Effect**:
    - Rename the existing "Frame" mode to **"Segment"** mode.
    - Implement a new **"Frame"** mode: This mode will behave similarly to the step-based segment delay but will sample from the full frame history buffer, allowing for temporal delays across the entire shape rather than just within it.

### 2. Generator Enhancements
- **Triangle Generator**:
    - Adjust the vertex calculation to produce a perfectly equilateral (symmetrical) triangle by default.
- **Waveform Generator (New)**:
    - Implement a detailed audio spectrum data provider (multi-bin FFT).
    - Provide visualization options:
        - **Candle Bar**: Standard vertical bars representing frequency bins.
        - **Waveform**: Time-domain representation of the audio signal.
        - **Spectrum**: Continuous line connecting frequency bin levels.
- **Timer Generator (New)**:
    - Support three core modes:
        - **Clock**: Displays the current system time.
        - **Count-up**: A stopwatch starting from 0.
        - **Count-down**: A countdown from a user-defined time.
    - Configurable formats: `HH:MM:SS`, `MM:SS`, and `SS.mm`.

## Acceptance Criteria
- Mirror axis offset and rotation work correctly without introducing visible artifacts or broken geometry.
- Delay "Frame" mode correctly trails the history of the full input shape.
- Triangle generator produces a symmetrical shape.
- Waveform generator reacts in real-time to audio input with high-resolution frequency data.
- Timer generator displays accurate time/countdown values in the selected format.
- All new parameters are correctly exposed in the UI panels.

## Out of Scope
- MIDI/OSC Mapping (Reserved for Track 2).
- DAC Channel Grouping (Reserved for Track 2).
