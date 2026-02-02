import React, { useRef, useEffect } from 'react';

const StaticIldaThumbnail = ({ frame, width = 50, height = 50 }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !frame || !frame.points) return;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        const points = frame.points;
        const isTyped = frame.isTypedArray || (points instanceof Float32Array);
        const numPoints = isTyped ? (points.length / 8) : points.length;

        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        
        let lastX = null;
        let lastY = null;

        for (let i = 0; i < numPoints; i++) {
            let x, y, r, g, b, blanking;
            if (isTyped) {
                x = points[i*8];
                y = points[i*8+1];
                r = points[i*8+3];
                g = points[i*8+4];
                b = points[i*8+5];
                blanking = points[i*8+6] > 0.5;
            } else {
                const p = points[i];
                x = p.x;
                y = p.y;
                r = p.r;
                g = p.g;
                b = p.b;
                blanking = p.blanking;
            }

            // Map Normalized Coordinates (-1 to 1) to Canvas (0 to width/height)
            const screenX = (x + 1) * 0.5 * width;
            const screenY = (1 - (y + 1) * 0.5) * height;

            if (!blanking) {
                if (lastX !== null) {
                    ctx.beginPath();
                    ctx.moveTo(lastX, lastY);
                    ctx.lineTo(screenX, screenY);
                    
                    const ir = Math.floor(Math.max(0, Math.min(255, r)));
                    const ig = Math.floor(Math.max(0, Math.min(255, g)));
                    const ib = Math.floor(Math.max(0, Math.min(255, b)));
                    
                    ctx.strokeStyle = `rgb(${ir},${ig},${ib})`;
                    ctx.stroke();
                }
            } else {
                lastX = null;
                lastY = null;
                continue;
            }

            lastX = screenX;
            lastY = screenY;
        }
    }, [frame, width, height]);

    return (
        <canvas 
            ref={canvasRef} 
            width={width} 
            height={height} 
            style={{ width: '100%', height: '100%', backgroundColor: 'black', display: 'block', borderRadius: '5px' }}
        />
    );
};

export default React.memo(StaticIldaThumbnail);
