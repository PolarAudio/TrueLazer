# TrueLazer

## Laser Show Software Inspired by Resolume

TrueLazer is an ambitious source-available project aiming to create a powerful and flexible laser show control
software, drawing inspiration from the intuitive workflow and extensive features of Resolume Arena.
Built with JavaScript, TrueLazer is designed to provide artists and technicians with a versatile tool for live
ILDA mixing, generative content, and advanced laser projection.

## What Makes TrueLazer Special?

While many software solutions exist for video mixing, TrueLazer carves its niche by focusing specifically on
ILDA (International Laser Display Association) control with a user experience akin to industry-leading VJ
software. Here's what sets us apart:

- **Resolume-Inspired UI for ILDA:** We're building a familiar deck-based layout with layers and columns, but
  tailored for ILDA clips. This intuitive interface allows for dynamic organization and mixing of laser
  content in real-time.

- **ILDA's IDN Integration:** Our core focus is seamless integration with IDN DACs, ensuring reliable and
  high-performance communication with your laser hardware.

- **Generative ILDA Content:** Beyond playing pre-made ILDA files, TrueLazer features a robust generator
  system to create dynamic laser visuals on the fly, including basic shapes, text, and complex generative
  patterns.

- **Extensive Effects Library:** Manipulate your laser content with a rich set of built-in effects (transform,
  wave, warp, noise, delay, chase, color palettes, blanking, strobe, etc.).

- **Comprehensive Control Options:** Designed for professional use, TrueLazer supports MIDI, HOTKEYS, NDI and
  DMX/Artnet for seamless integration with existing show control systems and external hardware.

- **JavaScript Core:** Leveraging JavaScript provides maximum versatility, allowing for a broad developer
  community and easy extensibility.

- **Familiar 8x5 Deck-Layout for perfect Usability via MIDI-Hardware like Akai APC-40 series.**

## Features

- **Clip Deck & Composition**
  - 8x5 clip deck with dynamic layer and column management (edit/clear/rename).
  - Layer controls: Blackout, Solo, Blend Mode, Intensity sliders, Layer Effects and assigned DACs.
  - Master intensity slider, Laser On/Off button and composition label.
  - Clip attributes: Play Style (Once/Repeat), Trigger (Normal/Flash/Toggle), Transport (Timeline/BPM-Sync),
    Beat Snap (None/8/4/2/1/1/2/1/4/1/8), Audio Track.
  - Clip and World previews: render preview, beam rendering (points/lines) and scan-rate display.

- **Effects System (Clip & Layer Effects)**
  - Transform: Translate, Scale, Rotate, Move (Bounce), Invert, Mirror.
  - Spatial/Point: Wave, Warp, Noise, Grow, Threshold.
  - Temporal/Channel: Delay, Chase with configurable channel order for assigned DACs.
  - Color: Solid, Rainbow and Palette modes with presets.
  - Output: Blanking and Strobe.
  - **Warp** is a "black hole" effect — signed positional gravity that pulls or pushes points toward/away from
    its center within a radius, with a distance falloff; it is not time-based by itself.
  - **Speed-Sync animation:** every parameter can be animated via FPS, Timeline, BPM or FFT speed-sync with
    style (Loop/Bounce/Once) and direction (Forward/Backward/Pause) control.
  - **Linked X/Y axes:** effects with paired axis parameters (Warp Position, Grow Center, Move Speed,
    Translate, Scale) keep both axes in lockstep by default — a chain icon on the second axis unlinks them.
  - **Layer Effect Speed Control:** layer effects can be timed from the global BPM, the global FPS target or a
    fixed timeline duration, so clip effects and layer effects play in sync.

- **Generative Content System**
  - Shape generators (dots, lines, circles, text, and more) as base layers.
  - Clock/Countdown/Timer sources and NDI sources in the Generator Panel.

- **DAC Communication**
  - The ILDA Standard IDN communication protocol, re-written in JavaScript.
  - Showbridge DAC communication (discovery, SDK queries, UDP frame streaming).
  - EtherDream driver being ported to JavaScript (in progress).
  - Assign DAC channels to clips/layers via drag-and-drop; channel reordering with custom Delay/Chase order.

- **Control Integration**
  - MIDI mapping (pre-made & custom), HOTKEYS mapping, DMX/Artnet mapping.
  - General Settings, Output Settings and Output Processing windows, Shortcuts window.

## Why Support TrueLazer?

The laser show community often relies on proprietary software or complex custom solutions. TrueLazer aims to
fill a critical gap by offering:

- **A Source Available Alternative:** Empowering artists and developers with a transparent, community-driven
  platform for laser control.
- **Innovation:** By combining the best UI/UX practices from video mixing with dedicated laser control, we aim
  to push the boundaries of what's possible in live laser performances.
- **Flexibility:** A modular design and JavaScript core mean TrueLazer can adapt to diverse needs and
  integrate with various hardware and software ecosystems.

Your support, whether through contributions, feedback, or spreading the word, helps us build a powerful tool
for the entire laser show community.

Creative minds should not be slowed down by a paywall. That is why we believe in this project being Source
Available and free of charge for everyone. In the future, support for significantly more hardware will be
added, either by us or by the community; for now we focus on developing with the hardware we have on hand.

## Development Status

TrueLazer is in active development. The foundation is in place and core functionality is implemented and
usable, with continuous improvements to performance, DAC communication and the effects system.

### Progress Legend

- ☐ Not yet done
- ☒ Partially done
- ☑ Finished

### Current Progress

- ☑ Project scaffolding and basic file structure are in place.
- ☑ Initial UI components for the clip deck, layers, and controls.
- ☒ ILDA file parsing and rendering.
- ☒ Showbridge DAC communication protocol (analyzed, communication works, trailing-line issues being fixed).
- ☒ EtherDream DAC communication protocol re-written to JavaScript, needs further adjustments.
- ☑ IDN communication protocol re-written in JavaScript and working great with the LaserVR test application.

### NDI Integration

NDI (Network Device Interface) is integrated via a custom native wrapper linking against the NDI 6 SDK.
To keep the repository size manageable and comply with licensing, only the essential build files from the NDI 6 SDK are included in the `sdk/NDI 6 SDK/` directory:

- Headers in `Include/`
- Linker library in `Libv6/x64/`
- Runtime DLL in `Bin/x64/`

Discovered NDI sources can be dragged from the Generator Panel onto the clip grid for real-time laser rendering.

> The current implementation of NDI has a big performance impact on the application. If you plan to use NDI in
> these early builds, use a workstation with serious compute power. The NDI integration will be optimized in
> future releases.

## Next Steps

1. **UI Development**
   - ☑ Full clip deck with layers, columns, and associated controls (Clear Clips, Blackout, Solo, Blend-mode,
     Intensity Sliders).
   - ☑ Composition Label, Master Intensity Slider, and Laser On/Off Button.
   - ☑ "Selected Clip Preview" and "World Preview" windows.
   - ☑ File browser for ILDA files with drag-and-drop functionality.
   - ☑ Dynamic layer and column management (edit/clear/rename).
   - ☒ Custom title bar with menu options (TrueLazer Info, Settings, Layer, Column, Clip, Output, Shortcuts,
     View).

2. **Generative Content System**
   - ☑ Simple set of shape generators (dots, lines, circles, text) as base layers.
   - ☒ Generator Panel (NDI-Source, Clock/Countdown/Timer).

3. **Effects System**
   - ☑ Core transform, spatial, temporal/channel and color effects.
   - ☑ Drag-and-drop mechanism for applying effects to clips and layers.
   - ☑ Layer effects with Effect Speed Control and per-parameter speed-sync animation.
   - ☑ Linked X/Y axis controls for symmetric adjustments.
   - ☑ Effect presets (saving/loading effect parameter presets).

4. **Control Integration**
   - ☑ MIDI and HOTKEYS mapping (pre-made & custom).
   - ☒ DMX/Artnet mapping.
   - ☐ OSC control.

5. **DAC Communication**
   - ☑ ILDA Standard IDN Communication Protocol.
   - ☑ Drag-and-drop functionality for assigning DAC channels to clips/layers.
   - ☑ Showbridge DAC implementation.
   - ☒ EtherDream DAC implementation finalized.

6. **Remaining Roadmap**
   - ☐ "Global intensity" slider (dark to light color fade).
   - ☑ "Speed" select (speed source: BPM, manual, midi-clock).
   - ☑ Timeline Editor Window.
   - ☑ Show Editor Window.
   - ☑ Projector Setup (Info, Rendering, Color-Balance, Safety-Zones, Test-Image) per channel/DAC.
   - ☑ Audio Settings (Input and Output).
   - ☑ General Settings (Save, Load, Update Check, Animate Thumbnail Always/Hover/Off, Show FPS, ILDA Scan
     Safety).
   - ☐ Reset Functions (DAC assignment, Slider Value, Speed Value, Clip Deck, Effects etc.).
   - ☐ Bug report feature.

## Contributing to TrueLazer

We welcome contributions from developers, laser artists, and enthusiasts! Here's how you can get started:

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (LTS version recommended)
- **npm** (Node Package Manager) or **yarn**
- **Windows build tools** (Visual Studio Build Tools / C++ toolchain + Python) — required because the
  `postinstall` step compiles the native NDI wrapper via `node-gyp`.

### Getting Started

1. **Clone the Repository**

   ```
   git clone https://github.com/PolarAudio/TrueLazer.git
   cd TrueLazer
   ```

2. **Install Dependencies**

   ```
   npm install
   ```

   This also builds the native NDI wrapper (`npm run build-native` runs automatically via `postinstall`).

3. **Run the Development Server**

   TrueLazer uses Vite for a fast development experience.

   ```
   npm run start
   ```

   This starts the Vite dev server and launches an Electron window with a dev console. In most cases this is
   already fully functional and supports the complete UI interaction.

4. **Run the Tests**

   ```
   npm test
   ```

   Runs the Vitest suite (effects and processors).

5. **Build the Executable**

   ```
   npm run build
   ```

   Runs `vite build` followed by `electron-builder` to produce an installer in `release/`.

### Project Structure Overview

- `src/` — Frontend source code (React components, contexts, utilities, workers).
- `src/utils/` — Effect definitions/processors, generators, ILDA parsing/writing and rendering.
- `src/ILDA-FILE-FORMAT-FILES/` — Default ILDA files for testing/development (unpacked to the chosen install
  location during installation).
- `main/` + `main.js` + `preload.js` — Electron main process and IPC.
- `native/` — Native addon source for the NDI wrapper (`build-native`).
- `sdk/` — DAC/SDK information: EtherDream reference code, Showbridge driver & protocol docs, NDI 6 SDK.
- `dist/` — Vite production build output.
- `release/` — Packaged installers.

### How to Contribute

1. Fork the repository.
2. Create a new branch for your feature or bug fix: `git checkout -b feature/your-feature-name` or
   `git checkout -b bugfix/issue-description`.
3. Make your changes.
4. Commit your changes with a clear and concise message.
5. Push your branch to your forked repository.
6. Open a Pull Request to the main branch of the original TrueLazer repository, describing your changes in
   detail.

We appreciate your help in making TrueLazer the ultimate Laser Show Software!

> **Notice:** This project is Source-Available, not Open-Source. You are welcome to view and modify the code for
> personal use or contributions, but you are not permitted to redistribute the code or binaries on other
> platforms. Please read the LICENSE for full details.
>
> Forking this repository on GitHub is permitted for the sole purpose of submitting Pull Requests to this
> project. Redistribution of the code outside of this GitHub organization is prohibited.