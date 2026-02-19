# Specification: Presets, Paging & MIDI Refinement (Track 3)

## Overview
This track focuses on three pillars of professional workflow: **Content Management** (Presets), **Organization** (Pagination), and **Hardware Integration** (Enhanced MIDI Feedback). It aims to make TrueLazer more efficient for complex live performances by allowing artists to save their favorite effect settings, organize larger sets of clips, and gain better visual control over their hardware.

## Functional Requirements

### 1. Preset System (Effects & Generators)
- **Scoped Storage**: Implement a system to save and load presets unique to each effect and generator.
- **File-Based Persistence**: Presets will be stored as individual JSON files in a dedicated `presets/` folder. This folder will be protected from being overwritten during application updates.
- **Project Portability**: When a project is saved, all *used* preset data must be embedded within the project file to ensure it loads correctly on different machines.
- **User Library**: Support a global library of presets available across all projects.
- **UI Integration**:
    - Add a preset dropdown menu to the header of every `EffectEditor` and `GeneratorSettingsPanel`.
    - Include "Save" (disk icon) and "Delete" (trash icon) buttons for quick management.

### 2. Clip Panel Pagination
- **Multiple Pages**: Extend the clip deck to support multiple pages (e.g., Page 1, 2, 3...).
- **State Logic**: Clip and Layer IDs will remain consistent, with the addition of a `pageId` to distinguish between sets of content.
- **Page Awareness**: MIDI mappings in "By Position" or "Selected Layer" modes must function across pages (controlling the content on the *active* page).
- **Navigation UI**: Add a numeric page selection bar (1, 2, 3...) into the **Middle-bar** of the application.

### 3. MIDI Refinement & APC40 Feedback
- **Velocity Prefabs**:
    - Implement an icon-based dropdown in the MIDI mapping configuration showing color swatches for APC40 LEDs.
    - Use the `APC40_RGB_Button_Colors.md` as the source of truth for color-to-velocity mapping.
- **Blinking Modes**: Add an independent "MIDI Channel / Blink Mode" dropdown next to each velocity input to control LED behavior (Static, Pulse, Blink at various rates).
- **Context-Aware Defaults**:
    - Automatically select the most appropriate Feedback Mode when mapping (e.g., Clips default to "Clip" mode, Sliders default to "Slider" mode).
- **Theme-Aware Defaults**: Default feedback velocities should follow the application's theme color while remaining fully customizable.

### 4. UI/UX Polishing
- **Slider Tooltips**: Add a hover/drag tooltip above slider handles in `RangeSlider` and `DualRangeSlider` to display the precise numeric value during adjustment.
- **DAC Scan Styling**: Apply styling refinements to the "Scan" button in the DAC panel for better visual consistency.

## Acceptance Criteria
- Presets can be created, switched, and deleted for all effects and generators.
- Loading a project on a fresh install correctly restores all effect parameters.
- Switching clip pages updates the deck UI instantly while keeping background audio/rendering active.
- MIDI feedback correctly sets APC40 LEDs to chosen colors and blink rates.
- Users can select APC40 colors visually from a dropdown instead of entering numbers.
- Sliders show real-time values in a floating box when dragged.

## Out of Scope
- Automatic preset synchronization via cloud.
- Advanced "Scene" logic (beyond simple clip pagination).
