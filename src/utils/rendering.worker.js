import { WebGLRenderer } from './WebGLRenderer.jsx';

const renderers = new Map();

function animateRenderer(id, lastFrameTime = 0) {
    const state = renderers.get(id);
    if (!state) return;

    const currentTime = performance.now();
    // The animation loop should run as fast as possible, point drawing speed is simulated in WebGLRenderer
    // if (currentTime - lastFrameTime > state.data.drawSpeed) {
        state.renderer.render(state.data);
        lastFrameTime = currentTime;
    // }

    state.animationFrameId = requestAnimationFrame(() => animateRenderer(id, lastFrameTime));
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
            state.data = data;
            // The continuous loop will pick up the new data.
        }
    } else if (action === 'clear') {
        const { id } = payload;
        const state = renderers.get(id);
        if (state) {
            state.renderer.clearCanvas();
        }
    }
};
