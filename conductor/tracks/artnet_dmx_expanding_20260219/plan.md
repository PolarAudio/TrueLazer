# Implementation Plan: Art-Net/DMX Expanding (Track 4)

## Phase 1: Fixed DMX Personalities Engine
- [x] Task: Implement Master Section Handlers
    - [x] Update `ArtnetContext.jsx` to process hardcoded "Master Section" channels (1-10)
    - [x] Link Master Intensity, Global Blackout, Page Select, and Transport to application actions
- [x] Task: Implement Layer Footprint Logic
    - [x] Create a "fixed-patch" processor that maps Layer 1-5 to sequential footprints (start channel 11)
    - [x] Implement range-based clip triggers (0-10 Off, 11-20 Clip 1, etc.)
- [x] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: DMX Monitor & UI Enhancements
- [ ] Task: Create DMX Monitor Component
    - [ ] Build a 16x32 grid UI to visualize 512 channels of real-time data
    - [ ] Update Art-Net settings window to include this monitor
- [ ] Task: Universe Filtering & List Management
    - [ ] Add `universeFilter` state to `ArtnetContext`
    - [ ] Update the mapping overlay UI to support filtering by universe
- [ ] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: Performance & Integration
- [ ] Task: Main Process Art-Net Optimization
    - [ ] Update Art-Net listener in `main.js` to use a buffer-based approach for high-frequency updates
    - [ ] Ensure DMX events are correctly throttled before being sent to the renderer
- [ ] Task: End-to-End Hybrid Mapping Test
    - [ ] Verify that custom mapped effect parameters still work while fixed layer controls are active
- [ ] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Testing & Final Sync
- [ ] Task: Final Quality Gate
    - [ ] Test with professional DMX software (e.g. QLC+, MA2/3 onPC)
    - [ ] Run full automated test suite
- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)
