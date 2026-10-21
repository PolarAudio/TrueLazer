// The GPU string is the one piece of environment information the main process
// cannot supply - it only exists inside a WebGL context, which lives in the
// renderer. Read it from a throwaway context so no visible canvas is
// disturbed, and release the context immediately afterwards.

export const getGpuInfo = () => {
    try {
        if (typeof document === 'undefined') return '';
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) return '';
        try {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            const renderer = ext
                ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                : gl.getParameter(gl.RENDERER);
            const vendor = ext
                ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)
                : gl.getParameter(gl.VENDOR);
            return [vendor, renderer].filter(Boolean).join(' - ');
        } finally {
            // Throwing the context away keeps the browser from holding on to
            // a second GL context for the lifetime of the app.
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
        }
    } catch {
        return '';
    }
};
