# Implementation Plan: Bezier Curve Tool Logic Refinement

## Phase 1: Dynamic Curvature Engine
- [x] Task: Implement Auto-Smooth Logic
    - [x] Write unit tests for smooth spline-to-bezier conversion.
    - [x] Implement `calculateSmoothHandles` helper function to derive cubic bezier control points from a sequence of anchor points.
- [x] Task: Update Bezier Drawing Lifecycle
    - [x] Refactor `startDrawing` and `draw` in `ShapeBuilder.jsx` to start with straight segments.
    - [x] Update `activeShape` logic to trigger handle recalculation when points are added.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Dynamic Curvature Engine' (Protocol in workflow.md)

## Phase 2: Hybrid Interaction & Closing
- [x] Task: Manual Override Support
    - [x] Update `isHit` and `draw` to allow manual handle dragging without breaking the "auto" state of other points.
    - [x] Implement a `manualHandles` flag/map within the shape object to track which points have been overridden.
- [x] Task: Smooth Closing Logic
    - [x] Update the `finishMultiPointShape` or closing logic to correctly calculate the wrap-around handles between P_last and P_first.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Hybrid Interaction & Closing' (Protocol in workflow.md)
