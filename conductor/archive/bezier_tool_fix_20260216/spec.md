# Specification: Bezier Curve Tool Logic Refinement

## Overview
This track addresses a logic error in the Bezier curve tool where segments start with a pre-applied curvature. The goal is to implement a dynamic curvature calculation that starts straight and only curves as more points are added or when the shape is closed, following a smooth, automatic spline logic with optional manual overrides.

## Functional Requirements
- **Dynamic Curvature Initialization:**
    - The first segment (between point 1 and point 2) must remain straight initially.
    - Curvature should only be calculated once a 3rd point is added, allowing for a smooth path through the 3-point sequence.
- **Hybrid Spline Logic:**
    - **Automatic Smoothing:** By default, the tool calculates control point positions to create a smooth, continuous curve through all clicked points.
    - **Local Manual Override:** Users can manually drag handles to adjust curvature for specific points. Manual adjustments only affect the immediate adjacent segments.
- **Automatic Closing Logic:**
    - When closing the shape (clicking back on the first point), the tool must automatically calculate the smooth curve radius between the last point and the first point to complete the loop seamlessly.
- **Interaction Logic:**
    - Handles should initialize "collinear" (on the line) for the first two points to ensure they start straight.

## Acceptance Criteria
- [ ] Drawing the first two points results in a straight line segment.
- [ ] Adding a third point causes the segment between points 1 and 2 to automatically curve to maintain smoothness.
- [ ] Closing a shape results in a smooth curve between the last and first points without manual intervention.
- [ ] Manually adjusting a handle on one point does not force the rest of the shape's points into a manual state.
