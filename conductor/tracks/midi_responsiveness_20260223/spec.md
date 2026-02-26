# Specification: MIDI & Control Responsiveness Optimization

## Overview
This track aims to eliminate perceived lag in MIDI and Art-Net control by refactoring the command dispatch mechanism from a "debouncing" strategy to a high-frequency "throttling" strategy. It also includes architectural optimizations to the MIDI context to reduce CPU overhead and prevent unnecessary listener re-binding.

## Functional Requirements
- **Global 60Hz Throttling:** Replace the current 30ms `debouncedDispatch` in `App.jsx` with a global 16.6ms (60Hz) throttled dispatch for all incoming MIDI, Art-Net, and Keyboard commands.
- **Leading & Trailing Execution:** Ensure that the throttled dispatch fires immediately on the first event (leading) and fires one final time after the events stop (trailing) to guarantee state accuracy.
- **Stable MIDI Listeners:** Refactor `MidiContext.jsx` to use `Refs` for mappings and state flags. This prevents the WebMidi listener from being torn down and rebuilt whenever mappings change or "Learn Mode" is toggled.
- **Feedback Lookup Optimization:** Replace the O(N) array iteration in `sendFeedback` with a pre-computed lookup Map to handle high-density MIDI feedback without dropping frames.
- **Art-Net Parity:** Apply the same throttling logic to incoming Art-Net data in `ArtnetContext.jsx` to ensure UI consistency across all control protocols.

## Non-Functional Requirements
- **Low Latency:** UI sliders and feedback should respond within one frame (16.6ms) of hardware movement.
- **CPU Efficiency:** Minimize unnecessary React re-renders caused by frequent MIDI/DMX state updates.

## Acceptance Criteria
- MIDI sliders in the UI follow hardware movement smoothly at 60fps.
- Rapid fader movements no longer experience "delayed" updates (the 30ms pause-to-fire behavior).
- MIDI feedback (LEDs) remains in sync with the UI even during dense control traffic.
- Adding or removing MIDI mappings no longer causes a brief "hiccup" or listener re-binding log in the console.

## Out of Scope
- Support for MIDI Clock / MTC (MIDI Time Code) synchronization.
- Optimization of the core laser rendering engine (already operating at high frequency via Refs).
