# Implementation Plan: Bezier Curve Tool Logic Refinement

## Phase 1: Dynamic Curvature Engine
- [ ] Task: Implement Auto-Smooth Logic
    - [ ] Write unit tests for smooth spline-to-bezier conversion.
    - [ ] Implement `calculateSmoothHandles` helper function to derive cubic bezier control points from a sequence of anchor points.
- [ ] Task: Update Bezier Drawing Lifecycle
    - [ ] Refactor `startDrawing` and `draw` in `ShapeBuilder.jsx` to start with straight segments.
    - [ ] Update `activeShape` logic to trigger handle recalculation when points are added.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Dynamic Curvature Engine' (Protocol in workflow.md)

## Phase 2: Hybrid Interaction & Closing
- [ ] Task: Manual Override Support
    - [ ] Update `isHit` and `draw` to allow manual handle dragging without breaking the "auto" state of other points.
    - [ ] Implement a `manualHandles` flag/map within the shape object to track which points have been overridden.
- [ ] Task: Smooth Closing Logic
    - [ ] Update the `finishMultiPointShape` or closing logic to correctly calculate the wrap-around handles between P_last and P_first.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Hybrid Interaction & Closing' (Protocol in workflow.md)
