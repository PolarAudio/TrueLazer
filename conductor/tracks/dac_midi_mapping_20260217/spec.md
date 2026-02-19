# Specification: DAC Grouping & Advanced MIDI Mapping (Track 2)

## Overview
This track enhances the professional integration capabilities of TrueLazer by introducing DAC grouping for streamlined hardware management and a major overhaul of the MIDI mapping system. The goal is to provide granular control over MIDI input/output, supporting multiple assignments per button and detailed visual feedback (LED control) for various control states.

## Functional Requirements

### 1. DAC Channel Grouping
- **Grouping System**: Implement a way to create and name "DAC Groups" (e.g., "Left Wing", "Main Floor").
- **Quick Assigning**: Add a UI element in the DAC panel to select a group, which immediately assigns all channels in that group to the currently selected layer or project.
- **Persistence**: Store DAC group definitions in the global settings.

### 2. Advanced MIDI Mapping
- **Multiple Mappings per Control**: 
    - Allow a single hardware button/fader to be linked to multiple UI parameters.
    - Support mapping individual items in a dropdown menu to specific MIDI buttons.
    - Update the Mapping Overlay to display a list of all active assignments for a selected hardware control.
- **Targeting & Routing**: 
    - Add **Target** settings for each mapping: `By Position` (Static), `This Clip`, or `Selected Layer` (Dynamic).
    - Add **Input/Output** filtering: Restrict mappings to specific devices or "Any Device".

### 3. MIDI Out Velocity (Visual Feedback)
Implement a fully individual feedback configuration panel for every mapping, supporting status-to-velocity rules:
- **Toggle Buttons**: Define velocities for "ON" and "OFF" states.
- **Clips**: Define velocities for `EMPTY`, `INACTIVE`, `PREVIEWING`, `ACTIVE`, and various trigger-style active/inactive combinations.
- **Sliders**: 
    - Modes: `BUTTON`, `ABSOLUTE`, `RELATIVE`, `FAKE_RELATIVE`.
    - Range: Fixed `0 TO 1` for laser parameters.
- **Dropdowns**:
    - Modes: `SELECT_NEXT`, `SELECT_PREVIOUS`, `RANDOM`, or direct links to specific options.

## Acceptance Criteria
- DAC Groups can be created, saved, and used to quickly assign hardware to layers.
- Multiple UI controls can be triggered by a single MIDI button press without conflicts.
- Dropdown options can be individually mapped to unique MIDI notes.
- MIDI feedback correctly updates hardware LEDs based on the fine-grained status rules (e.g., active clip turns green, previewing clip blinks orange).
- Mapping settings (Target, Device, Velocity) are persisted correctly in the user configuration.

## Out of Scope
- DMX/Artnet Feedback (This track focuses strictly on MIDI).
- Automatic hardware discovery/profile generation (Manual mapping remains the standard).
