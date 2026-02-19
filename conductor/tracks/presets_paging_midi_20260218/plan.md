# Implementation Plan: Presets, Paging & MIDI Refinement (Track 3)

## Phase 1: Preset System Architecture
- [x] Task: Create Preset Persistence Layer
    - [x] Update `main.js` to handle `presets/` folder creation and file management
    - [x] Implement IPC handlers `get-presets`, `save-preset`, `delete-preset`
- [~] Task: Embed Presets in Project Data
    - [ ] Update project save/load logic to include used preset configurations
- [ ] Task: UI - Preset Dropdown & Management
    - [ ] Create `PresetSelector` component with "Save" and "Delete" actions
    - [ ] Integrate `PresetSelector` into `EffectEditor.jsx` and `GeneratorSettingsPanel.jsx`
- [x] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Clip Deck Pagination
- [~] Task: Extend Application State for Paging
    - [ ] Update `reducer` to support `activePageId` and hierarchical `clipContents`
    - [ ] Ensure `clipNames` and `thumbnailFrameIndexes` are also page-aware
- [ ] Task: Implement Navigation UI
    - [ ] Add `PageNavigation` component to the `Middle-bar`
    - [ ] Implement page-switching logic (preserving background audio/rendering)
- [ ] Task: Page-Aware MIDI Routing
    - [ ] Update `handleMidiCommand` in `App.jsx` to resolve target IDs based on `activePageId` for "By Position" mappings
- [ ] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: Enhanced MIDI Feedback (APC40 Focus)
- [ ] Task: Implement Velocity Prefab Dropdown
    - [ ] Create `MidiColorPicker` component with color icons/swatches
    - [ ] Map swatch selections to velocity values using `APC40_RGB_Button_Colors.md`
- [ ] Task: Implement Blink Mode Logic
    - [ ] Add `blinkMode` field to MIDI assignments
    - [ ] Update `sendFeedback` in `MidiContext.jsx` to correctly map `blinkMode` to the MIDI Channel (0-15)
- [ ] Task: Context-Aware Defaults
    - [ ] Update `learningId` logic to auto-set `feedbackMode` based on the UI component type
- [ ] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: UI Polishing & UX
- [ ] Task: Slider Value Tooltips
    - [ ] Update `RangeSlider.jsx` and `DualRangeSlider.jsx` to show a tooltip on handle hover/drag
- [ ] Task: DAC Scan Button Styling
    - [ ] Refine the "Scan" checkbox/button in `DacPanel.jsx` to match the professional theme
- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)

## Phase 5: Testing & Final Sync
- [ ] Task: Final Quality Gate
    - [ ] Verify preset portability across project files
    - [ ] Test MIDI feedback with complex blink/color combinations
    - [ ] Run full automated test suite
- [ ] Task: Conductor - User Manual Verification 'Phase 5' (Protocol in workflow.md)
