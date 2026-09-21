import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTimeline, getChannelOutputs, getChannelDisplayName } from '../../contexts/TimelineContext';
import { flipPoints } from '../../hooks/useTimelinePlayback';
import { applyOutputProcessing } from '../../utils/effects';

function scaleRgb(points, factor) {
    if (!points || factor === 1) return points;
    const out = new Float32Array(points);
    const n = points.length / 8;
    for (let i = 0; i < n; i++) {
        const off = i * 8;
        out[off + 3] = points[off + 3] * factor;
        out[off + 4] = points[off + 4] * factor;
        out[off + 5] = points[off + 5] * factor;
    }
    return out;
}

/**
 * Selected-track playback preview. Renders the exact compiled 8-float points
 * the DAC path would send for the currently selected channel at the live
 * playhead (cues, automation lanes, intensity, blackout honored). For a single
 * routed output its x/y invert is applied so the canvas is WYSIWYG vs. the
 * laser; multi-output zones show the native frame.
 *
 * Paused transport still previews: compile is transport-independent and only
 * needs the playhead time.
 */
const TimelinePreview = ({ previewFrame, playheadSec }) => {
    const { state, dacOutputSettings } = useTimeline();
    const canvasRef = useRef(null);
    const wrapRef = useRef(null);
    const frameRef = useRef(null);
    const lastKeyRef = useRef('');
    const flipRef = useRef(null);
    const [size, setSize] = useState({ w: 340, h: 260 });

    const selectedId =
        state.settings.selectedChannelId && state.channels[state.settings.selectedChannelId]
            ? state.settings.selectedChannelId
            : state.channelOrder[0] || null;
    const channel = selectedId ? state.channels[selectedId] : null;
    const outputs = channel ? getChannelOutputs(channel) : [];
    flipRef.current = outputs.length === 1 ? outputs[0] : null;
    // Mirror the per-output DAC settings that the fan-out applies on playback
    // (dimmer, output-area scale/crop, safety-zone blanking) so the editor canvas
    // stays WYSIWYG with what the DAC actually receives.
    const singleSettings = outputs.length === 1 && dacOutputSettings
        ? dacOutputSettings[`${outputs[0].ip}:${outputs[0].channel}`] || null
        : null;

    // Keep the backing store DPR-aware and matched to the wrapper size.
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const update = () => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) setSize({ w: rect.width, h: rect.height });
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const { w, h } = size;
        const dpr = window.devicePixelRatio || 1;
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0b0d10';
        ctx.fillRect(0, 0, w, h);

        // Center crosshair
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, h);
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        const frame = frameRef.current;
        if (!frame) {
            ctx.fillStyle = '#4a5161';
            ctx.font = '12px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('no active cue on this track', w / 2, h / 2);
            return;
        }

        const n = frame.length / 8;
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        let lastX = null;
        let lastY = null;
        let lastBlank = true;
        for (let i = 0; i < n; i++) {
            const x = frame[i * 8];
            const y = frame[i * 8 + 1];
            const r = Math.floor(Math.max(0, Math.min(255, frame[i * 8 + 3])));
            const g = Math.floor(Math.max(0, Math.min(255, frame[i * 8 + 4])));
            const b = Math.floor(Math.max(0, Math.min(255, frame[i * 8 + 5])));
            const blank = frame[i * 8 + 6] > 0.5;
            const sx = (x + 1) * 0.5 * w;
            const sy = (1 - (y + 1) * 0.5) * h;
            if (!blank && !lastBlank && lastX !== null) {
                ctx.beginPath();
                ctx.moveTo(lastX, lastY);
                ctx.lineTo(sx, sy);
                ctx.strokeStyle = `rgb(${r},${g},${b})`;
                ctx.stroke();
            }
            if (!blank) {
                lastX = sx;
                lastY = sy;
            }
            lastBlank = blank;
        }
    }, [size]);

    // Compile the selected channel at the live playhead each frame. Idle-gated:
    // a stable key (channel + playhead) skips recompiling the same result.
    useEffect(() => {
        let raf;
        const loop = () => {
            if (channel) {
                const key = `${channel.id}:${playheadSec.toFixed(3)}`;
                if (key !== lastKeyRef.current) {
                    lastKeyRef.current = key;
                    let frame = previewFrame(channel.id, playheadSec);
                    const single = flipRef.current;
                    if (frame && single && (single.flipX || single.flipY)) {
                        frame = flipPoints(frame, !!single.flipX, !!single.flipY);
                    }
                    if (frame && singleSettings) {
                        if (singleSettings.dimmer !== undefined && singleSettings.dimmer < 1) {
                            frame = scaleRgb(frame, Math.max(0, singleSettings.dimmer));
                        }
                        if (singleSettings.transformationEnabled || (singleSettings.safetyZones && singleSettings.safetyZones.length > 0)) {
                            frame = applyOutputProcessing(
                                { points: frame, isTypedArray: !Array.isArray(frame) },
                                singleSettings,
                                false
                            ).points;
                        }
                    }
                    frameRef.current = frame;
                }
            } else {
                frameRef.current = null;
            }
            draw();
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [channel, playheadSec, previewFrame, draw]);

    return (
        <div className="timeline-preview">
            <div className="timeline-preview-head">
                <span className="timeline-preview-title">Preview</span>
                {channel ? (
                    <>
                        <span className="timeline-preview-track" title={getChannelDisplayName(channel, dacOutputSettings)}>
                            {getChannelDisplayName(channel, dacOutputSettings)}
                        </span>
                        <span className={`timeline-preview-outputs ${outputs.length > 1 ? 'zone' : ''}`}>
                            {outputs.length > 1 ? `${outputs.length} outputs` : outputs.length === 1 ? 'routed' : 'no DAC'}
                        </span>
                    </>
                ) : (
                    <span className="timeline-preview-track muted">no track</span>
                )}
            </div>
            <div className="timeline-preview-canvas" ref={wrapRef}>
                <canvas ref={canvasRef} />
            </div>
        </div>
    );
};

export default TimelinePreview;