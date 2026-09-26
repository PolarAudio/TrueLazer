# Shape Builder — how it is meant to work

A plain-language guide for people who know timelines (FL Studio, video editing) and
live show control (Resolume, Light Consoles) but not graphic design.

---

## 1. The one idea that makes it make sense

**A shape in the editor is a recipe, not a picture.**

When you draw a square, the editor does not store 4 glowing dots. It stores:

```
rectangle, corner at (200,200), 200 wide, 100 tall, red, solid style, scale 1, no rotation
```

That recipe is tiny, editable, and resolution-independent. Turning it into actual
laser points happens only at the very end, in one fixed order, in one place.

This is exactly how a video editor works: you keep the clip, and the render pass
makes the pixels. Or how a lighting desk works: you keep the cue, and the playback
engine makes the DMX values.

**Consequence:** changing the recipe is instant and lossless. The recipe is also
what gets saved to a `.clip` file, so a project can be re-opened and re-rendered at
a different point density or budget.

---

## 2. The pipeline: recipe → laser

Every shape, in the preview and in the export, goes through these six steps **in
this order**. The order matters; changing it changes the picture.

| # | Step | What it does | Why |
|---|------|--------------|-----|
| 1 | **Hidden check** | Skipped if the shape is hidden | Hiding is an authoring idea, not a laser instruction |
| 2 | **Density** | Resamples the outline so no two points are more than *N* px apart | A 4-corner square has nothing to draw a dashed or dotted style with |
| 3 | **Group transform** | A group's scale/rotation is applied to each child's outline | A scaled group must burn scaled |
| 4 | **Budget** | Caps the points in this frame, thinning collinear runs | The DAC has a points-per-second clock; overrunning it stutters |
| 5 | **Effect bake** | Applies a shape effect (chase, strobe, audio…) if enabled | Keeps the effect non-destructive |
| 6 | **Beam style** | Turns the outline into laser behaviour: solid / dashed / dotted / points | This is the actual "look" |

Then the resulting point list is mapped from editor pixels into ILDA's `-1..1`
space and written to the `.ild`.

**The single most important property:** steps 1–6 live in exactly one function,
`buildFrameProgram` in `src/utils/frameProgram.js`. The preview calls it and draws
the answer. The export calls it and writes the answer. There is no second
implementation to fall out of sync — which is the entire reason the editor can be
trusted to be WYSIWYG.

---

## 3. The four beam styles

Think of these as four different ways a pen can behave along one path:

- **Solid** — draw the whole outline. The normal choice.
- **Dashed** — draw 16 px, lift, skip 10 px, repeat. Measured by *arc length*, so
  the dashes stay 16 px whether the shape is a coarse square or a dense curve.
- **Dotted** — draw the whole outline *and* dwell on a dot every 8 px. The dots are
  brighter because the beam sits still for ~1 ms.
- **Points** — draw nothing but the dwell dots, lifting between them. A constellation.

A **dwell** is what makes a dot visible: the beam holds the same coordinate for
~20 points. Same trick as holding a MIDI note or a shutter open.

---

## 4. The point budget — the thing that surprises people

`Max pts/frame` (default 1200) is the hard ceiling on points in one exported frame.
It exists because the DAC can only fire so many points per second; a frame that
tries to draw 20,000 points will visibly stutter or drop.

The budget is **shared across every shape in a frame**, spent in order, like a
memory budget in a video encoder: the first shape spends what it needs, and the next
shape gets what's left.

When a shape wants more than the budget allows, the pattern **stretches** rather
than truncating. A shape that cannot afford a dot every 8 px gets a dot every 14 px
instead of a clipped, half-drawn pattern. Same for dashes.

**Why this used to look broken:** the preview assumed every shape got the *full*
budget while the export spent a *shrinking* one. So the second shape on a frame
previewed with 16 px dashes and exported with 40 px ones. The preview now reads the
resolved pattern from the shared program, so they are the same by construction.

---

## 5. Point density

- **0 (default)** — solid shapes keep their sparse, editable outline. Dashed /
  dotted / points shapes auto-densify to 8 px, because those styles need points to
  work with.
- **A number you set** — everything is resampled to that spacing. Use it when you
  want a visibly denser curve, or when a specific look depends on point placement.

Density is applied *before* the budget, so requesting a very dense outline can eat
the budget and force the later shapes in the frame to stretch their patterns.

---

## 6. Transforms

`Scale X/Y` and `Rotation X/Y/Z` are stored on the recipe and applied to the sampled
outline at draw time, around the shape's **pivot** (the crosshair handle).

The pivot is the shape's untransformed centre, so scaling does not make the shape
drift across the canvas. Drag the pivot handle to change what it scales around.

For a **group**, the group's own transform is applied *on top of* each child's.
Group transform props are deliberately not pushed down into children — otherwise
each child would scale around its own centre and the group would come apart.

---

## 7. How to check that the editor is telling you the truth

1. Draw a shape. Set a style. Look at the preview.
2. Export the `.ild`.
3. Reload the `.ild` — it re-imports as frames, and its outlines are drawn by the
   same code path as the preview.

If the preview and the reloaded file disagree, that is a bug in the shared program,
not a misunderstanding on your part. That is the bar this codebase now holds.

---

## 8. Glossary

| Term | Meaning |
|------|---------|
| **Outline** | The recipe's points before budget thinning |
| **Sample** | Turning a curve/primitive into a list of straight-line points |
| **Resample / density** | Inserting points so none are further apart than *N* px |
| **Arc length** | Distance along the path. Patterns are measured in arc length, never by point index |
| **Dwell** | Holding the beam on one spot for ~20 points; this is what makes a dot |
| **Blanking** | Beam off. A blanked point is a pen-up: the laser travels without burning |
| **Point budget** | Max points per exported frame; protects the DAC's point clock |
| **Beam style** | Solid / dashed / dotted / points |
| **WYSIWYG** | What you see is what you get — preview equals export |

---

## 9. Where the code lives

| Concern | File |
|---------|------|
| Recipe → laser pipeline (shared by preview and export) | `src/utils/frameProgram.js` |
| Outline → beam behaviour (dashes, dots, dwell, budget fitting) | `src/utils/beamProgram.js` |
| Point budget + collinear thinning | `src/utils/exportOptimizer.js` |
| Editor, sampling, transforms, handles, timeline | `src/components/ShapeBuilder.jsx` |
| Shape effects (chase, strobe, audio) | `src/utils/shapeEffects.js` |
| ILDA file writing | `src/utils/ilda-writer.js` |

When changing anything about how a shape *looks*, change it in `frameProgram.js` or
`beamProgram.js` — not in the preview code. The preview deliberately has no
independent styling logic left to disagree with.
