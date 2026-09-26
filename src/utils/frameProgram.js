// Frame -> laser program.
//
// This module is the single place where "a shape" becomes "points the laser
// visits". Both consumers go through it:
//
//   * the ILDA export, which maps the returned points into -1..1 / RGB and
//     writes an .ild file;
//   * the editor preview, which reads the same per-shape pattern decisions so
//     the picture on screen is the picture that burns.
//
// Everything order-sensitive lives here, in one order, for both consumers:
//
//   1. hidden shapes are skipped;
//   2. the outline is resampled to the requested point density, because a bare
//      4-corner square gives a per-point beam style nothing to draw;
//   3. a group applies its OWN scale/rotation to each child's outline (this is
//      what makes a scaled group preview and export identically);
//   4. the frame point budget decimates the outline;
//   5. a shape effect is baked in;
//   6. the beam style (solid / dashed / dotted / points) is measured in arc
//      length and fitted to what is left of the budget;
//   7. the beam is charged back to the budget IN SAMPLED POINTS, the same unit
//      the budget is denominated in.
//
// The geometry helpers are injected rather than imported because they live with
// the editor's shape model. Injecting them keeps this module pure and testable,
// and guarantees the preview and the export run byte-identical geometry.

import { createPointBudgetOptimizer, DEFAULT_POINT_BUDGET } from './exportOptimizer';
import { buildBeamProgram, isClosedType, DEFAULT_DOT_PITCH } from './beamProgram';

// Auto-density for the per-point beam styles. They need a dense outline to have
// anything to draw, so a dotted/dashed/points shape gets this even when the user
// has not chosen a point density. Solid shapes keep their sparse, editable
// outline so the editor stays responsive and the point count stays low.
export const BEAM_AUTO_SPACING = 8;

const BEAM_STYLES = new Set(['dotted', 'dashed', 'points']);

// The density a shape is sampled at, honouring an explicit user choice first.
export function effectiveSpacingFor(shape, pointSpacing) {
  if (pointSpacing > 0) return pointSpacing;
  const mode = (shape && shape.renderMode) || 'simple';
  return BEAM_STYLES.has(mode) ? BEAM_AUTO_SPACING : 0;
}

// Editor pixels -> ILDA's -1..1 space with y flipped (ILDA's origin is bottom
// left, the editor's is top left).
export function toIldaPoint(p) {
  return { x: (p.x - 500) / 500, y: 1 - p.y / 500 };
}

// Build the ordered point stream for one frame, in editor coordinates.
//
// Returns { points, entries, remaining }:
//   points  - every point the beam visits, in order, each flagged `blanking`
//             when the beam is off (a pen-up move). Repeated identical
//             positions are a dwell, which is what makes a dot visible.
//   entries - one record per top-level shape (and per group child), carrying the
//             pattern the budget settled on so the preview can draw the same
//             dashes and dots. Children live in `entries[i].children`.
//   remaining - the sampled-point budget left after the frame.
export function buildFrameProgram(shapes, opts = {}) {
  const {
    pointSpacing = 0,
    budget = DEFAULT_POINT_BUDGET,
    effect = null,
    effectPos = 0,
    bakeEffects = false,
    getSampledPoints,
    resampleShapeBySpacing,
    applyTransformations,
    applyEffectToPoints,
  } = opts;

  if (typeof getSampledPoints !== 'function') {
    throw new Error('buildFrameProgram requires a getSampledPoints(shape) function');
  }

  const budgeter = createPointBudgetOptimizer({ budget });
  const points = [];

  // Start a shape with the beam off so the laser lifts, travels to the new
  // shape, and drops back down. Without this the beam drags a live line from
  // the previous shape into this one.
  const append = (program) => {
    if (!program || program.length < 2) return false;
    const first = program[0];
    if (points.length > 0 && !first.blanking) points.push({ ...first, blanking: true });
    for (const p of program) points.push(p);
    return true;
  };

  const processShape = (shape, group) => {
    // A hole in the shape list is legal (shapes are tombstoned, not spliced),
    // and a hidden shape is an authoring-only concept: it must not burn.
    if (!shape || shape.hidden) return null;

    if (shape.type === 'group') {
      const children = [];
      const list = shape.shapes || [];
      for (let i = 0; i < list.length; i++) {
        const child = processShape(list[i], shape);
        if (child) children.push(child);
      }
      return { type: 'group', children };
    }

    const mode = shape.renderMode || 'simple';
    const spacing = effectiveSpacingFor(shape, pointSpacing);
    const dense = resampleShapeBySpacing ? resampleShapeBySpacing(shape, spacing) : shape;
    const wasResampled = dense !== shape;

    // Sample, then fold in the parent group's transform. Order matters: the
    // beam pattern is measured in arc length AFTER the group scale, so a group
    // scaled 2x gets 2x-long dashes, matching the preview.
    let sampled = getSampledPoints(dense);
    if (group && applyTransformations) sampled = applyTransformations(sampled, group);
    if (!sampled || sampled.length < 2) return null;

    // Corner/anchor points the user pinned must survive decimation.
    const preserve = new Set();
    const passThrough = shape.type === 'pen' || shape.type === 'polygon' || shape.type === 'polyline';
    if (passThrough && Array.isArray(dense.anchorIndexes)) {
      dense.anchorIndexes.forEach((i) => preserve.add(i));
    }

    const optimized = budgeter.processShape(sampled, {
      preserve,
      // A resampled outline is an explicit request (chosen density, or the
      // auto-density a beam style needs). Decimating it would collapse the
      // resampled points straight back to the sparse outline.
      keepAll: wasResampled,
      minPoints: shape.type === 'line' ? 2 : 4,
    });

    let outline = optimized.points;
    if (effect && effect.type && bakeEffects && applyEffectToPoints) {
      outline = applyEffectToPoints(outline, effect, effectPos, { globalCenter: { x: 500, y: 500 } }).points;
    }

    const closed = isClosedType(shape.type);
    const program = buildBeamProgram(outline, {
      closed,
      mode,
      pitch: spacing > 0 ? spacing : DEFAULT_DOT_PITCH,
      color: shape.color,
      // Whatever is left of the frame budget, so a dense shape stretches its
      // pattern instead of overrunning the DAC's point clock.
      maxPoints: Math.max(8, budgeter.remaining),
    });

    if (!append(program.points)) return null;

    // Charge the budget in SAMPLED points. The allowance is denominated in
    // sampled points (one sampled segment emits two ILDA points), so charging
    // the emitted program length here over-charged every dotted shape — whose
    // program is the outline PLUS a dwell per dot — and starved later shapes.
    budgeter.accountFor(outline.length);

    return {
      type: shape.type,
      mode,
      closed,
      // The outline the beam was actually measured on, after density, group
      // transform, budget decimation and effect bake. The preview strokes this
      // so the editor shows the decimated/exported geometry, not a denser
      // approximation of it.
      outline,
      stats: program.stats,
      sampled: outline.length,
      emitted: program.points.length,
    };
  };

  const entries = [];
  const list = shapes || [];
  for (let i = 0; i < list.length; i++) {
    const entry = processShape(list[i], null);
    entries.push(entry);
  }

  return { points, entries, remaining: budgeter.remaining };
}
