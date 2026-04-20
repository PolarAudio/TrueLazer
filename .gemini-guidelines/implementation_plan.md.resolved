# Project Health Scan & Remediation Plan

I have completed a thorough scan of the project by running a production build (`npm run build`) and analyzing the codebase for common anti-patterns, console error logs, and structural warnings. 

Here are the key problems that need to be addressed soon:

## 1. Vite Build Errors & Chunk Size Warnings
- **Mixed Imports of `ilda-writer.js`**: Vite is throwing a warning because `src/utils/ilda-writer.js` is imported dynamically in `App.jsx` but statically in `ShapeBuilder.jsx`. This breaks Vite's ability to cleanly split code into chunks.
- **Large Bundle Size**: The main JavaScript chunk is over `850 kB`. We should update `vite.config.js` to implement `manualChunks` to separate large vendor dependencies (like React, Material UI, and Laser DAC packages) from application code.
- **OutDir Warning**: Vite complains that the `dist` directory is outside the project root and won't be emptied. We should add `emptyOutDir: true` to the config.

## 2. Drag & Drop Defect Risks
- **Missing Payload Arguments**: Similar to the bug we just fixed in `Clip.jsx` and `LayerControls.jsx`, we should comprehensively audit all `onDropX` handlers across the application (e.g., `onDropDac`, `onDropGenerator`) to ensure `layerIndex` and `colIndex` are consistently passed as scalar values, avoiding `[object Object]` reducer crashes.

## 3. Web Worker Stability
- **Silent Worker Failures**: `ilda-parser.worker.js` and `generators.worker.js` have multiple `console.error` logs on uncaught exceptions. These should be wrapped in robust `try/catch` blocks that use `postMessage({ type: 'error', message: ... })` to communicate failures back to the main UI gracefully.

## 4. Electron API Hardcodings
- **Web-Environment Failures**: In `osc.js`, `midi.js`, and `artnet.js`, `window.electronAPI` is assumed to exist. When running purely in a web browser context (`start-renderer`), this logs raw console errors. We should implement safe fallbacks.

> [!IMPORTANT]
> **User Review Required**
> Please review this list. Once you approve, I will generate a formal Task List (TODO list) from these findings and systematically execute the patches. Are there any other specific areas you'd like me to investigate before proceeding?

## Proposed Changes

### Configuration
#### [MODIFY] [vite.config.js](file:///c:/Users/MAXQON/Documents/GitHub/TrueLazer/vite.config.js)
- Add `emptyOutDir: true`.
- Implement `build.rollupOptions.output.manualChunks` to split vendor dependencies.

### Application Logic
#### [MODIFY] [ShapeBuilder.jsx](file:///c:/Users/MAXQON/Documents/GitHub/TrueLazer/src/components/ShapeBuilder.jsx)
- Convert the static import of `ilda-writer` to a dynamic import to align with `App.jsx` and fix chunking.

#### [MODIFY] [App.jsx](file:///c:/Users/MAXQON/Documents/GitHub/TrueLazer/src/App.jsx)
- Audit `handleDropX` references.

#### [MODIFY] [ilda-parser.worker.js](file:///c:/Users/MAXQON/Documents/GitHub/TrueLazer/src/utils/ilda-parser.worker.js)
- Refactor error handling in `onmessage` to `postMessage` errors back to the main thread.

#### [MODIFY] [generators.worker.js](file:///c:/Users/MAXQON/Documents/GitHub/TrueLazer/src/utils/generators.worker.js)
- Refactor error handling in `onmessage` to `postMessage` errors back to the main thread.

## Verification Plan
1. Re-run `npm run build` to verify that all Vite warnings have disappeared.
2. Confirm that the application loads and runs via `npm run start` without `electronAPI` unhandled exceptions breaking initialization.
3. Test drag and drop for DACs and Generators to ensure no further Reducer errors occur.
