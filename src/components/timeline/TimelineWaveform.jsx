import React, { useEffect, useRef } from 'react';
import { timeToPx } from '../../utils/timelineTime';

/**
 * Full-width audio waveform backdrop drawn on a <canvas>. Re-draws whenever
 * peaks / layout change; cheap because it only paints the visible strip.
 */
const TimelineWaveform = ({ peaks, duration, pxPerSecond, height, width, color = 'rgba(255,255,255,0.6)' }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, width);
        const h = Math.max(1, height);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
        const bars = Math.min(peaks.length, Math.max(1, Math.floor(w / 2)));
        for (let i = 0; i < bars; i++) {
            const t = (i / bars) * peakDur;
            const px = timeToPx(t, pxPerSecond);
            const idx = Math.floor(i / bars * peaks.length);
            const bar = peaks[idx] || { min: -0.1, max: 0.1 };
            const top = Math.max(0, mid - Math.max(0, bar.max) * amp);
            const bottom = Math.min(h, mid + Math.max(0, -bar.min) * amp);
            const bw = Math.max(1, (w / bars) * 0.7);
            ctx.fillRect(px, top, bw, Math.max(1, bottom - top));
        }
    }, [peaks, duration, pxPerSecond, height, width, color]);

    return <canvas ref={canvasRef} className="timeline-waveform-canvas" />;
};

export default TimelineWaveform;