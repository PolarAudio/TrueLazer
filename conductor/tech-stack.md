# Tech Stack: TrueLazer

## Core Environment
- **Runtime:** Electron (Node.js) - Provides the desktop application container and access to system resources.
- **Frontend Framework:** React - Used for building the component-based user interface.
- **Build Tool:** Vite - Provides a fast development environment and optimized production builds.
- **Primary Language:** JavaScript (ES Modules) - Used for the majority of the application logic and UI.

## UI & Styling
- **Component Library:** Material UI (MUI) - Used for standard UI components and layout.
- **Styling Engine:** Emotion - Used for CSS-in-JS styling within the React components.
- **Iconography:** Bootstrap Icons - Provides a consistent set of icons for the UI.

## Laser & Show Control
- **Laser Communication:**
    - `@laser-dac/core` & `@laser-dac/ether-dream` - For EtherDream DAC support.
    - Custom IDN implementation - For high-performance IDN DAC communication.
- **Protocols:**
    - `webmidi` - For MIDI hardware integration and mapping.
    - `osc` - For Open Sound Control integration.
    - `dmxnet` - For Artnet/DMX communication.

## Native Integration
- **NDI Integration:** Custom C++ wrapper linked against the NDI 6 SDK, integrated via `node-addon-api` and `node-gyp`. This is used for receiving and rendering NDI video sources as laser content.

## Utilities & Data
- **Data Persistence:** `electron-store` - Used for saving user settings, mappings, and configuration.
- **Font Handling:** `opentype.js`, `font-list`, `get-system-fonts` - For text-to-laser generation.
