# Implementation Plan: Shape Builder and Timeline Enhancements

## Phase 1: New Triangle Shape
- [x] Task: Parametric Triangle Implementation
    - [x] Write unit tests for Triangle point generation logic.
    - [x] Implement `Triangle` shape class with `width` and `height` parameters in Shape Builder.
    - [x] Add parametric Triangle tool to the Shape Builder UI.
    - [x] Add symmetrical Triangle generator to the Generator Panel.
- [x] Task: Conductor - User Manual Verification 'Phase 1: New Triangle Shape' (Protocol in workflow.md)

## Phase 2: Spline Curve Fixes & Improvements
- [x] Task: Continuous Mode & Bezier Handles
    - [x] Update `Spline` logic to calculate cubic bezier curves (4 points per segment).
    - [x] Implement dual Bezier handles for point radius adjustment.
    - [x] Visualize control lines and handle types (square vs circle).
- [x] Task: Interaction and Finishing Logic
    - [x] Refactor start/draw logic for better bezier creation.
    - [x] Prioritize point hit detection over shape center to prevent blocked handles.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Spline Curve Fixes & Improvements' (Protocol in workflow.md)

## Phase 3: Selection and Layer Logic
- [x] Task: Improved Hit Detection
    - [x] Refactor hit detection logic to ignore empty space (geometry-only).
    - [x] Remove center-based selection to allow transparency for lower layers.
- [x] Task: Selection Drill-Down
    - [x] Implement selection cycling logic to reach overlapping shapes/points.
- [x] Task: Conductor - User Manual Verification 'Phase 3: Selection and Layer Logic' (Protocol in workflow.md)

## Phase 4: Grouping and Anchor Points
- [x] Task: Global Group Transformations
    - [x] Update `groupShapes` to preserve child transforms and anchors.
    - [x] Ensure `applyTransformations` correctly handles group hierarchies.
- [x] Task: Conductor - User Manual Verification 'Phase 4: Grouping and Anchor Points' (Protocol in workflow.md)

## Phase 5: Timeline Mode Refinements
- [x] Task: Dynamic Grid and Playhead
    - [x] Implement `TimelineRuler` component with mode-aware markers.
    - [x] Update Timeline UI to switch between beat/bar grid and second/millisecond grid.
    - [x] Implement mode-aware playhead labels and snapping logic.
- [x] Task: Conductor - User Manual Verification 'Phase 5: Timeline Mode Refinements' (Protocol in workflow.md)
