# Implementation Plan: Effects & Generators Update (Track 1)

## Phase 1: Shape & Effect Refinements (Triangle & Mirror) [checkpoint: f0a85db]
- [x] Task: Refactor Triangle Generator for equilateral symmetry
    - [x] Write unit tests for vertex calculation symmetry
    - [x] Implement new coordinate logic in `src/utils/generators.js`
    - [x] Verify generator output matches tests
- [x] Task: Implement Mirror Effect axisOffset and planeRotation
    - [x] Write unit tests for offset and rotated mirroring math
    - [x] Update `applyMirror` in `src/utils/effects.js` to handle new params
    - [x] Add parameter definitions to `src/utils/effectDefinitions.js`
    - [x] Verify blanking integrity remains intact during rotation
- [x] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Delay Effect Restructuring [checkpoint: 8ec26ed]
- [x] Task: Rename Delay 'Frame' mode to 'Segment'
    - [x] Update all references in `src/utils/effects.js` and `src/utils/effectDefinitions.js`
    - [x] Ensure existing project data migration (if applicable) or compatibility
- [x] Task: Implement new 'Frame' mode for Delay
    - [x] Write unit tests for full-buffer history sampling
    - [x] Implement sampling logic in `applyDelay` to use the entire history frame as a unit
    - [x] Verify smooth temporal trailing of complex shapes
- [x] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: High-Resolution Waveform Generator
- [x] Task: Implement Multi-Bin FFT Data Provider
    - [x] Update `AudioContext.jsx` or relevant worker to provide higher resolution FFT bins (e.g., 64/128)
    - [x] Ensure low latency and minimal CPU impact
- [x] Task: Create Waveform Generator
    - [x] Write unit tests for point generation based on frequency levels
    - [x] Implement `generateWaveform` in `src/utils/generators.js`
    - [x] Add sub-modes: Candle Bar, Waveform, and Spectrum
    - [x] Add parameter definitions to `src/utils/generatorDefinitions.js`
- [x] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Timer & Clock Generator
- [x] Task: Implement Timer Generator Logic
    - [x] Write unit tests for time formatting and mode transitions (Clock vs Count-down)
    - [x] Implement `generateTimer` in `src/utils/generators.js`
    - [x] Support Clock, Count-up, and Count-down modes
    - [x] Implement string-to-points logic for selected formats (HH:MM:SS, etc.)
    - [x] Add parameter definitions to `src/utils/generatorDefinitions.js`
- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)

## Phase 5: UI Integration & Final Polish
- [x] Task: Update UI Panels for new parameters
    - [x] Ensure all new generator and effect properties are correctly displayed in SettingsPanels
    - [x] Verify responsiveness of Waveform reactivity in the World Preview
- [x] Task: Final Quality Gate & Verification
    - [x] Run full test suite
    - [x] Check code coverage for new modules (>80%)
- [x] Task: Conductor - User Manual Verification 'Phase 5' (Protocol in workflow.md)

## Phase: Review Fixes
- [x] Task: Apply review suggestions feab877

