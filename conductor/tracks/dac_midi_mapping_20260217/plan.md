# Implementation Plan: DAC Grouping & Advanced MIDI Mapping (Track 2)

## Phase 1: DAC Channel Grouping [checkpoint: 66fcec8]
- [x] Task: Implement DAC Group Data Structure
    - [x] Update `electron-store` schema in `main.js` to include `dacGroups`
    - [x] Create utility methods for adding/removing/renaming groups
- [x] Task: Create DAC Grouping UI
    - [x] Add "Groups" section to `DacPanel.jsx`
    - [x] Implement "Add to Group" and "Apply Group" functionality
    - [x] Verify quick-assignment logic correctly updates `layerAssignedDacs`
- [x] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Multi-Mapping Engine Overhaul
- [ ] Task: Update MIDI Mapping Data Structure
    - [ ] Modify `midiMappings` format to support arrays of assignments per key (note/cc)
    - [ ] Add `targetType` (`position`, `selectedLayer`, `thisClip`), `inputDeviceId`, and `outputDeviceId` fields
- [ ] Task: Implement Multi-Trigger Logic
    - [ ] Update `MidiContext.jsx` to iterate through all assignments for a received MIDI message
    - [ ] Ensure correct value resolution for dynamic targets (Selected Layer)
- [ ] Task: Enhanced Mapping Overlay UI
    - [ ] Update `MidiMappingOverlay.jsx` to show a list of mappings for the current selection
    - [ ] Add "Add Assignment" button to allow stacking multiple UI links on one hardware control
- [ ] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: MIDI Visual Feedback (MIDI Out)
- [ ] Task: Implement Velocity Mapping Logic
    - [ ] Create a comprehensive status-to-velocity resolver in `MidiContext.jsx`
    - [ ] Support all specified statuses: `ACTIVE`, `PREVIEWING`, `EMPTY`, `TRIGGER_STYLE_...`, etc.
- [ ] Task: Advanced Feedback Config Panel
    - [ ] Create a detailed sub-panel in the Mapping Overlay for individual assignment feedback rules
    - [ ] Add support for Toggle, Clip, Slider, and Dropdown feedback modes
- [ ] Task: Real-time Feedback Loop
    - [ ] Ensure `MidiFeedbackHandler` correctly triggers updates on state changes (clip activation, transport status)
    - [ ] Optimize feedback frequency to avoid MIDI bus saturation
- [ ] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Special Control Support (Dropdowns & Sliders)
- [ ] Task: Map Individual Dropdown Items
    - [ ] Extend mapping logic to allow specific MIDI messages to trigger specific values in a dropdown
    - [ ] Add "Dropdown Value" selector to the mapping config UI
- [ ] Task: Advanced Slider Modes
    - [ ] Implement `RELATIVE` and `FAKE_RELATIVE` (delta-based) slider handling in `MidiContext.jsx`
    - [ ] Verify `0 TO 1` range mapping for all laser-relevant parameters
- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)

## Phase 5: Persistence & Final Polish
- [ ] Task: Final Data Migration & Cleanup
    - [ ] Ensure existing single-assignment mappings are migrated to the new array-based structure
    - [ ] Verify cross-device mapping integrity (Any Device vs Specific ID)
- [ ] Task: Final Quality Gate
    - [ ] Run full test suite
    - [ ] Perform stress test with high-density MIDI feedback (e.g., APC40 grid update)
- [ ] Task: Conductor - User Manual Verification 'Phase 5' (Protocol in workflow.md)
