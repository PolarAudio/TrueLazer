# TrueLazer User Manual

Welcome to TrueLazer. This manual is a tour of the application: what each
window does, how the three editors relate, and where to find the controls that
matter during a show.

The application has three separate editors, and each one owns its own document:

| Editor | Document | Typical use |
| --- | --- | --- |
| **Show Control** | Show project (`.tlp`) | Live clip triggering, layers, columns, pages |
| **Timeline Editor** | Timeline project (`.json`) | Timecoded shows, cue placement, automation |
| **Shape Builder** | Shape project (`.tls`) | Drawing and exporting custom ILDA shapes |

The window title always names the active editor and the open project, so a
show project can never be mistaken for a timeline or shape project.

---

## 1. Getting started

1. Start TrueLazer. Show Control opens by default.
2. The **Files** tab at the bottom lists the ILDA files in your user folder
   (`Documents/TrueLazer/ILDA-FILES`).
3. Drag a file from the file browser onto a clip cell in the grid.
4. Click the clip thumbnail to trigger it. The **Selected Preview** and
   **World Preview** panels show what the laser will draw.
5. Connect a DAC in the DAC panel and enable output when you are ready.

The application is non-destructive while you are editing: unsaved work is
guarded when you close the window or switch away from the Shape Builder.

---

## 2. Show Control

Show Control is the live performance page. It is built around a grid of clips.

### Layers, columns and pages

- **Layer** – one horizontal row of clips. Each layer has its own effects,
  intensity, blend mode and DAC assignment.
- **Column** – one vertical stack of clips. A column header can trigger every
  clip in that column at once.
- **Page** – a complete grid. Use pages to keep different songs, looks or
  performers separate without rebuilding the deck.

### Clips

A clip cell can contain an ILDA file, a generator, or a generated shape. It can
also carry its own effects and playback settings.

- **Click** the thumbnail to trigger the clip according to its trigger style.
- **Hover** the thumbnail to preview it when *Thumbnail Hover Render* is the
  active render mode.
- **Right-click** the thumbnail for trigger style, thumbnail, cut/copy/paste,
  rename and clear commands.
- **Drag** a file from the File Browser onto the clip to load it.
- **Drag** a generator or effect from the bottom panel onto a clip.
- **Drag** a song from the DJ-Link display onto a clip to bind it to that track.

Trigger styles:

| Style | Behaviour |
| --- | --- |
| Normal | Starts on click and stays active until another clip takes the layer |
| Toggle | Click to start, click again to stop |
| Flash | Active only while the mouse button is held |
| Temp | Held like Flash, but keeps running briefly after release |

The **Clip** settings panel controls volume, playback speed, sync source,
looping, start/end frames and trigger behaviour. Layer settings are separate
and apply to the whole row.

### Bottom panel

The bottom panel has three tabs:

- **Files** – the File Browser. See section 5.
- **Generators** – built-in animated generators and NDI sources.
- **Effects** – effect definitions that can be dragged onto clips or layers.

### Render modes

The View menu offers three thumbnail render modes:

- **Still Frame** – cheapest; shows a cached still image.
- **Live Render** – every thumbnail animates at the project frame rate.
- **Hover Render** – thumbnails stay still until you hover them.

The same menu contains beam display options (points, lines, or both) and beam
alpha. These control the on-screen preview, not the laser output.

---

## 3. Timeline Editor

The Timeline Editor arranges clips on a shared time axis.

- **Channels / tracks** – each row is an output channel, usually a DAC or a
  zone. Clips placed on a track are sent to that output.
- **Ruler** – drag or click the ruler to move the playhead.
- **Transport** – play, pause, stop, seek, and set the FPS/BPM grid.
- **Inspector** – the right-hand panel for the selected clip: colour, name,
  timing, looping, source file, generator parameters, output settings and
  clip-level effects.
- **Automation lanes** – expand a channel to add lanes that animate an effect
  or generator parameter over time. Keyframes can be dragged and their tension
  adjusted.
- **File drawer** – opens the same File Browser used by Show Control, so files
  can be dragged straight onto the timeline.
- **Preview** – the inspector preview renders the exact compiled frame for the
  selected track at the playhead.

### Timeline shortcuts

| Shortcut | Action |
| --- | --- |
| Space | Play / pause (replays from the last parked position) |
| Left / Right | Move the playhead by one frame |
| Shift + Arrow | Jump to the previous / next beat line |
| Ctrl/Cmd + Arrow | Jump to the previous / next clip boundary |
| Ctrl/Cmd + A | Select every clip |
| Shift + click / drag | Add to the selection |
| Ctrl/Cmd + C / X / V | Copy / cut / paste selected cues and automation clips |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| Alt + wheel | Vertical zoom (row heights) |
| Ctrl/Cmd + wheel | Horizontal zoom (time) |
| Shift + wheel on a cue | Nudge the cue by one frame |
| Wheel | Scroll the timeline horizontally |

New, Open, Save and Save As are application-wide commands and always target the
active editor.

---

## 4. Shape Builder

Shape Builder is a vector editor for laser artwork.

- Draw lines, curves, circles, rectangles and polygons.
- Select points or segments and move, add, remove or adjust them.
- Use frames and onion skinning to build multi-frame animations.
- Apply shape effects and preview them before export.
- Save the working document as a `.tls` shape project.
- Export the finished artwork as an ILDA file for use in Show Control or the
  Timeline.

The Shape Builder keeps its document in memory. Leaving the page with unsaved
changes prompts you first, and closing the application does the same.

---

## 5. File Browser

The File Browser appears in Show Control (Files tab) and in the Timeline file
drawer. Both are the same component, so they behave identically.

- **Open Folder** – choose a different folder of `.ild` files.
- **List view** – compact filenames.
- **Thumbnail view** – renders the first frame of each file.
- **Hover preview** – rest the pointer on any file to see an enlarged preview.
  In list view the preview is generated on demand.
- **Drag** a file onto a clip cell or a timeline track to load it.

Thumbnails are cached on disk and reused until the file changes. *Settings >
Clear Thumbnail Cache* removes them if a file ever shows a stale image.

---

## 6. Effects

Effects are applied per clip or per layer. The Effects tab lists them by type:

- **Colour** – solid colour, gradients and colour cycling.
- **Transform** – move, scale, rotate, mirror, grow, warp and similar geometry.
- **Animation** – effects that change over time, including blanking, strobe
  and chase.
- **Effect** – utility effects such as delay, threshold and noise.

Drag an effect onto a clip or layer, then select the clip to edit its
parameters. Every parameter can be animated, and most can be mapped to MIDI,
Art-Net, OSC or a keyboard shortcut.

### Blanking

Blanking divides a shape into segments and turns the beam off between them.
This creates dashed, dotted or broken outlines without changing the underlying
geometry.

| Parameter | Meaning |
| --- | --- |
| **Blanking Interval** | Number of blanking segments spread across the shape. `0` disables the effect. |
| **Spacing** | Width of each blanked gap in points. `0` produces the smallest cut. |
| **Position** | Where the blank sits inside each segment. `0` places it at the segment start, `0.5` in the middle, and `1` at the segment end (the default). |

Because the gap is kept inside its own segment, the first and last segments
look the same as the ones in between. Use **Position** to make dashes travel
along the shape or to align gaps with corners and joins.

---

## 7. Outputs and DACs

The DAC panel discovers supported hardware on the network. Each output can be
assigned a channel, grouped with other outputs, and given its own settings.

- **DAC groups** – treat several projectors as one logical output.
- **Output Settings** – dimmer, output area, transformation mode.
- **Safety zones** – rectangular areas where the beam is forced off.
- **Output Processing** – blanking start/end dwell, path dwell, corner dwell
  and other scanner-timing controls. These affect physical beam behaviour and
  should be tuned per projector.
- **World Preview** – shows the combined output of every active layer.

Output settings can be exported and imported as a standalone `.tlo` document,
so one projector configuration can be reused across shows and machines.

---

## 8. Audio, BPM and DJ-Link

- The audio player follows the show clock and supports FFT analysis.
- Effects and generators can sync to **FPS**, **BPM**, or a master timeline.
- BPM can be tapped manually, received over Art-Net timecode, or read from
  Pioneer PRO DJ LINK / Denon StageLinq devices.
- DJ-Link can bind a clip to a loaded track so the clip follows deck playback.
  The Clip DJ-Link settings control follow mode, loop length and trigger.

---

## 9. Shortcuts and external control

*Shortcuts* in the application menu enables and configures:

- **MIDI** – map controls and feedback to almost any parameter.
- **Art-Net / DMX** – map DMX channels to parameters.
- **OSC** – send and receive OSC messages.
- **Keyboard** – map keys to parameters and clip actions.

Each mapping is stored with the application settings and can be enabled or
disabled independently.

---

## 10. Projects and settings

Each editor has its own New / Open / Save / Save As commands:

- **Show Control** – `.tlp` show project.
- **Timeline Editor** – `.json` timeline project.
- **Shape Builder** – `.tls` shape project.

Save the project for the page you are on. The title bar and the application
menu both name the active page so it is clear which document a command will
touch. Attempting to close the application with unsaved work asks for
confirmation.

### Language

*Settings > General Settings* contains the interface language selector. The
translation table lives in `src/i18n/translations.js`. Adding a language means
adding a block with the same keys; missing entries automatically fall back to
English.

---

## 11. Troubleshooting

- **A DAC is not found** – check that the computer and DAC are on the same
  network and that the correct network interface is selected.
- **A file has no preview** – the ILDA file may be invalid or use an
  unsupported format. The File Browser skips invalid files.
- **A thumbnail looks stale** – use *Settings > Clear Thumbnail Cache*.
- **The beam draws unwanted lines** – enable or increase blanking dwell in
  Output Processing, and check safety zones and the output area.
- **Nothing reaches the laser** – confirm the clip is assigned to a DAC, the
  output is started, and the master intensity is above zero.
- **Something crashed** – *Help > Report a Bug* attaches the redacted
  application log so the problem can be diagnosed.
