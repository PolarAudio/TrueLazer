import React, { useEffect, useRef } from 'react';
import { timeToPx } from '../../utils/timelineTime';

// Hard cap on the canvas backing-store width (device px). Browsers refuse
// 2D surfaces wider than ~32767px (or they clamp them), which silently blanks
// the waveform on very long timelines at deep zoom. We stay well below that
// and let CSS stretch the rare overflow instead of the wave disappearing.
const MAX_DEV_PX = 24000;

/**
 * Full-width audio waveform backdrop drawn on a <canvas>. Peak resolution
 * scales with the timeline (extractAudioPeaks stores a dense bucket set), so
 * the waveform keeps its detail when zoomed in instead of collapsing into a
 * coarse fixed-column texture.
 */
const TimelineWaveform = ({ peaks, duration, pxPerSecond, height, width, color = 'rgba(255,255,255,0.6)' }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, width);
        const h = Math.max(1, height);
        const devW = Math.min(Math.round(w * dpr), MAX_DEV_PX);
        canvas.width = devW;
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        // Device px per CSS px on the x axis (== dpr until MAX_DEV_PX caps it).
        const kx = devW / w;
        ctx.setTransform(kx, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const mid = h / 2;
        const amp = h * 0.42;

        if (!peaks || peaks.length === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillRect(0, 0, w, h);
            return;
        }

        const peakDur = duration > 0 ? duration : 1;
        ctx.fillStyle = color;
        // One 2px column per available device pixel, up to the bucket count.
        const cols = Math.max(1, Math.floor(devW / 2));
        const bars = Math.min(peaks.length, cols);
        const bwPx = (w / bars) * 0.7;
        for (let i = 0; i < bars; i++) {
            const t = (i / bars) * peakDur;
            const px = timeToPx(t, pxPerSecond);
            const idx = Math.floor(i / bars * peaks.length);
            const bar = peaks[idx] || { min: -0.1, max: 0.1 };
            const top = Math.max(0, mid - Math.max(0, bar.max) * amp);
            const bottom = Math.min(h, mid + Math.max(0, -bar.min) * amp);
            ctx.fillRect(px, top, Math.max(1, bwPx), Math.max(1, bottom - top));
        }
    }, [peaks, duration, pxPerSecond, height, width, color]);

    return <canvas ref={canvasRef} className="timeline-waveform-canvas" />;
};

export default TimelineWaveform;