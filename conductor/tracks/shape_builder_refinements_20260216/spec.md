# Specification: Shape Builder and Timeline Enhancements

## Overview
This track focuses on critical refinements to the Shape Builder tool and Timeline system. It addresses long-standing usability issues with spline curves, point selection in multi-layer compositions, and group transformation logic. Additionally, it introduces a new Triangle shape and improves the Timeline's visual feedback for different playback modes.

## Functional Requirements

### Shape Builder Enhancements
- **New Triangle Shape:** Implement a parametric Triangle tool with independent controls for base width and height.
- **Spline Curve Fixes:**
    - **Continuous Mode:** Ensure spline curves are correctly calculated during drawing instead of defaulting to straight lines.
    - **Bezier Handles:** Implement standard dual-handle control points for adjusting curve radii in continuous mode.
    - **Finishing Logic:** Fix the right-click behavior so it finishes the current shape without adding an extra unintended line segment.
    - **Interaction Collision:** Resolve the overlap issue where the spline's curvature handle is blocked by the line's center point, making it difficult to adjust the curve without moving the entire line.
- **Layer & Selection Logic:**
    - **Geometry-Only Collision:** Refine hit detection so clicks in empty spaces pass through to lower layers.
    - **Selection Drill-Down:** Implement a mechanism to cycle through overlapping shapes when multiple points exist at the same coordinate.
- **Grouping & Anchors:**
    - **Global Group Transform:** Ensure that child shapes correctly transform relative to the group's center point while maintaining their individual local anchor points for independent adjustments.

### Timeline Refinements
- **Dynamic Grid & Dividers:** The timeline ruler and grid should automatically switch between beat/bar intervals (BPM mode) and seconds/milliseconds (Time mode).
- **Mode-Aware Playhead:** Display the playhead's current position in the format appropriate for the active mode (e.g., "Bar 1, Beat 2" or "00:02.500").
- **Contextual Snapping:** Implement a snap-to-grid feature that aligns with the active mode's dividers.

## Acceptance Criteria
- [ ] Triangle shape can be created and adjusted for width/height.
- [ ] Spline curves in continuous mode render as curves during the drawing process.
- [ ] Right-clicking to finish a shape does not create an additional point.
- [ ] Spline curvature handles can be dragged independently of the line's center point.
- [ ] Points in lower layers can be selected even if a larger layer is above them.
- [ ] Grouped objects rotate and scale around the group's center point correctly.
- [ ] Timeline dividers and playhead labels update instantly when switching playback modes.
