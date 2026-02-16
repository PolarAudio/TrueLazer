# Implementation Plan: Shape Builder and Timeline Enhancements

## Phase 1: New Triangle Shape
- [ ] Task: Parametric Triangle Implementation
    - [ ] Write unit tests for Triangle point generation logic.
    - [ ] Implement `Triangle` shape class with `width` and `height` parameters.
    - [ ] Add Triangle tool to the Shape Builder UI.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: New Triangle Shape' (Protocol in workflow.md)

## Phase 2: Spline Curve Fixes & Improvements
- [ ] Task: Continuous Mode & Bezier Handles
    - [ ] Write tests for spline point calculation in continuous drawing mode.
    - [ ] Update `Spline` logic to calculate curves during the drawing process.
    - [ ] Implement dual Bezier handles for point radius adjustment.
- [ ] Task: Interaction and Finishing Logic
    - [ ] Write tests for right-click finishing behavior (no extra point).
    - [ ] Refactor finishing logic to prevent unintended line segment creation.
    - [ ] Adjust curvature handle hitboxes to prevent overlap with line center points.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Spline Curve Fixes & Improvements' (Protocol in workflow.md)

## Phase 3: Selection and Layer Logic
- [ ] Task: Improved Hit Detection
    - [ ] Write tests for geometry-only collision (empty space transparency).
    - [ ] Refactor hit detection logic to ignore empty space within shape bounding boxes.
- [ ] Task: Selection Drill-Down
    - [ ] Implement hotkey/click logic to cycle through overlapping points across layers.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Selection and Layer Logic' (Protocol in workflow.md)

## Phase 4: Grouping and Anchor Points
- [ ] Task: Global Group Transformations
    - [ ] Write tests for group rotation/scale relative to group center.
    - [ ] Implement logic to transform grouped children relative to the group origin without resetting local anchors.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Grouping and Anchor Points' (Protocol in workflow.md)

## Phase 5: Timeline Mode Refinements
- [ ] Task: Dynamic Grid and Playhead
    - [ ] Write tests for timeline divider calculations in BPM and Time modes.
    - [ ] Update Timeline UI to switch between beat/bar grid and second/millisecond grid.
    - [ ] Implement mode-aware playhead labels and snapping logic.
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Timeline Mode Refinements' (Protocol in workflow.md)
