import React, { useMemo, useCallback } from 'react';
import { rulerTicks, beatGridLines, timeToPx } from '../../utils/timelineTime';
import { RULER_H } from './layout';

/**
 * Top ruler strip for the timeline grid. Renders second ticks plus faint beat
 * markers. Clicking a tick seeks the playhead.
 */
const TimelineRuler = ({ width, pxPerSecond, bpm, timeSignature, fps, snapMode, onSeek, onZoom }) => {
    const { ticks } = useMemo(
        () => rulerTicks(0, width / pxPerSecond, pxPerSecond, { fps }),
        [width, pxPerSecond, fps]
    );
    const beatLines = useMemo(
        () => beatGridLines(0, width / pxPerSecond, { bpm, timeSignature }),
        [width, pxPerSecond, bpm, timeSignature]
    );

    const handleClick = useCallback(
        (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const sec = Math.max(0, px / pxPerSecond);
            onSeek && onSeek(sec);
        },
        [pxPerSecond, onSeek]
    );

    const handleWheel = useCallback(
        (e) => {
            if (!e.ctrlKey || !onZoom) return;
            e.preventDefault();
            const factor = e.deltaY > 0 ? 0.85 : 1.18;
            onZoom(pxPerSecond * (factor > 1 ? Math.min(1.5, factor) : factor));
        },
        [pxPerSecond, onZoom]
    );

    return (
        <div
            className="timeline-ruler"
            style={{ width, height: RULER_H }}
            onClick={handleClick}
            onWheel={handleWheel}
            title="Click to seek · Ctrl+wheel to zoom"
        >
            {beatLines.map((line, i) => (
                <div
                    key={`b${line.time}-${i}`}
                    className={`timeline-ruler-beat ${line.isBarStart ? 'bar' : ''}`}
                    style={{ left: timeToPx(line.time, pxPerSecond) }}
                />
            ))}
            {ticks.map((tick) => (
                <div
                    key={tick.time}
                    className="timeline-ruler-tick"
                    style={{ left: timeToPx(tick.time, pxPerSecond) }}
                >
                    <span className="timeline-ruler-label">{tick.label}</span>
                    <span className="timeline-ruler-line" />
                </div>
            ))}
        </div>
    );
};

export default TimelineRuler;