# Specification: Delay Effect Refinement & UI Performance Optimization

## Overview
This track addresses visual artifacts in the Delay effect when used with generative shapes and optimizes React rendering performance to support high-frequency (60Hz) MIDI and DMX control updates without UI frame drops.

## Functional Requirements
- **Delay Effect (Frame Mode) Blanking:** 
    - Ensure concatenation of frames in Delay 'frame' mode always includes blanked bridge points for Generator-sourced shapes to prevent connecting lines.
    - Implement/Verify `lastPoint` bit detection for Generator shapes to ensure proper shape termination.
- **Delay Effect (Segment Mode) Threshold:**
    - Implement a minimum threshold of 5 points for 'segment' delay mode.
    - If a shape has < 5 points, the delay effect will be bypassed.
    - Display an inline warning message ("Insufficient point count for segment delay") in the Effects Panel when this threshold applies.
- **UI Render Optimization:**
    - **Deck Memoization:** Implement deep `React.memo` on the 8x5 clip grid components to prevent re-renders unless clip content or active status changes.
    - **Slider Isolation:** Refactor parameter sliders/knobs to manage local movement state, preventing global `App.jsx` re-renders during active dragging or MIDI input.
    - **Canvas Decoupling:** Further decouple the World Preview and Ilda Player canvas rendering from the React state cycle to ensure rendering continues at 60fps even if the UI thread is busy.

## Acceptance Criteria
- Delay effect in 'frame' mode shows multiple distinct shapes without connecting lines between them.
- Shapes with < 5 points do not trigger 'segment' delay, and the UI correctly displays the warning.
- UI faders and knobs respond smoothly to 60Hz MIDI input without causing "stutter" or dropping frames in the main application UI.
- System CPU usage remains stable during rapid parameter changes.

## Out of Scope
- Rewriting the core IDN/EtherDream communication logic.
- Adding new generative shapes or unrelated effects.
