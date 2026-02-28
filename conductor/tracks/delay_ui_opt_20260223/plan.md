# Implementation Plan: Delay Effect Refinement & UI Performance Optimization

## Phase 1: Delay Effect Refinement
- [ ] Task: Write Failing Tests for Delay Frame Mode Blanking (connecting lines fix)
- [ ] Task: Implement automatic blanking between frames in Delay 'frame' mode
- [ ] Task: Write Failing Tests for Segment Mode Threshold (5 points)
- [ ] Task: Implement Segment Mode Threshold logic in `effects.js`
- [ ] Task: Implement UI warning message in `EffectEditor.jsx` or `EffectPanel.jsx`
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Delay Effect Refinement' (Protocol in workflow.md)

## Phase 2: UI Performance Optimization
- [ ] Task: Implement deep `React.memo` for Deck and Clip components
- [ ] Task: Refactor Sliders and RadialKnobs to use local state/Refs for drag isolation
- [ ] Task: Decouple World Preview and IldaPlayer rendering from React state (Direct Canvas updates)
- [ ] Task: Conductor - User Manual Verification 'Phase 2: UI Performance Optimization' (Protocol in workflow.md)

## Phase 3: Final Verification
- [ ] Task: Verify fix for connecting lines in Delay effect
- [ ] Task: Verify 60Hz UI responsiveness during rapid MIDI/Art-Net changes
- [ ] Task: Final code coverage check (>80%) and linting
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Final Verification' (Protocol in workflow.md)
