import { WebGLRenderer } from './WebGLRenderer.jsx';
import { optimizePoints } from './optimizer.js';

const renderers = new Map();

function animateRenderer(id, lastFrameTime = 0) {
    const state = renderers.get(id);
    if (!state) return;

    const currentTime = performance.now();
    // Re-arm the rAF BEFORE rendering so a frame that throws in render() cannot
    // kill the animation loop permanently (a dead rAF chain froze previews mid
    // playback forever). A single bad frame should drop out, not stop the show.
    state.animationFrameId = requestAnimationFrame(() => animateRenderer(id, lastFrameTime));
    try {
        state.renderer.render(state.data);
        lastFrameTime = currentTime;
    } catch (err) {
        console.error('[rendering.worker] render error for', id, err);
    }
}

self.onmessage = (e) => {
    const { action, payload } = e.data;

    if (action === 'register') {
        const { id, canvas, type, data } = payload;
        const renderer = new WebGLRenderer(canvas, type);
        const animationFrameId = requestAnimationFrame(() => animateRenderer(id));
        renderers.set(id, { renderer, type, data, animationFrameId });
    } else if (action === 'deregister') {
        const { id } = payload;
        const state = renderers.get(id);
        if (state) {
            cancelAnimationFrame(state.animationFrameId);
            renderers.delete(id);
        }
    } else if (action === 'update') {
        const { id, data } = payload;
        const state = renderers.get(id);
        if (state) {
            // Legacy full-replace update (used by IldaPlayer.jsx)
            if (state.data && state.data.effectStates && data.effectStates) {
                data.effectStates = state.data.effectStates;
            } else if (state.data && state.data.worldData && state.data.worldData.length > 0) {
                 const firstOldItem = state.data.worldData[0];
                 if (firstOldItem && firstOldItem.effectStates && data.worldData) {
                     const persistentMap = firstOldItem.effectStates;
                     for (const item of data.worldData) {
                         item.effectStates = persistentMap;
                     }
                 }
            }
            state.data = data;
        }
    } else if (action === 'update-frames') {
        // Frame-data-only update: replace worldData without touching render settings
        const { id, data } = payload;
        const state = renderers.get(id);
        if (state) {
            if (state.data && state.data.worldData && state.data.worldData.length > 0) {
                const firstOldItem = state.data.worldData[0];
                if (firstOldItem && firstOldItem.effectStates && data.worldData) {
                    const persistentMap = firstOldItem.effectStates;
                    for (const item of data.worldData) {
                        item.effectStates = persistentMap;
                    }
                }
            }
            state.data = { ...state.data, worldData: data.worldData };
        }
    } else if (action === 'update-settings') {
        // Settings-only update: merge render settings without cloning frame data
        const { id, data } = payload;
        const state = renderers.get(id);
        if (state) {
            state.data = { ...state.data, ...data };
        }
    } else if (action === 'clear') {
        const { id } = payload;
        const state = renderers.get(id);
        if (state) {
            state.renderer.clearCanvas();
        }
    }
};
