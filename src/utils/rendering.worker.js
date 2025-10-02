import { WebGLRenderer } from './WebGLRenderer.js';

const renderers = new Map();

self.onmessage = (e) => {
    const { action, payload } = e.data;

    if (action === 'register') {
        const { id, canvas, type, data } = payload;
        const renderer = new WebGLRenderer(canvas, type);
        renderers.set(id, { renderer, type, data });
        renderer.render(data);
    } else if (action === 'deregister') {
        const { id } = payload;
        const state = renderers.get(id);
        if (state) {
            state.renderer.destroy();
            renderers.delete(id);
        }
    } else if (action === 'update') {
        const { id, data } = payload;
        const state = renderers.get(id);
        if (state) {
            state.data = data;
            state.renderer.render(data);
        }
    }
};
