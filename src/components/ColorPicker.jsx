import React, { useRef, useEffect, useState, useCallback } from 'react';

// Helper to convert HSV to Hex
const hsvToHex = (h, s, v) => {
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    const toHex = x => {
        const hex = Math.round(x * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

// Helper to convert Hex to HSV
const hexToHsv = (hex) => {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;

    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;

    let d = max - min;
    s = max === 0 ? 0 : d / max;

    if (max === min) {
        h = 0;
    } else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h, s, v };
};

const ColorPicker = ({ color = '#ffffff', onChange }) => {
    const canvasRef = useRef(null);
    const [hsv, setHsv] = useState(() => hexToHsv(color));
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        const newHsv = hexToHsv(color);
        if (hsvToHex(newHsv.h, newHsv.s, newHsv.v) !== hsvToHex(hsv.h, hsv.s, hsv.v)) {
            setHsv(newHsv);
        }
    }, [color]);

    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        ctx.fillStyle = hsvToHex(hsv.h, 1, 1);
        ctx.fillRect(0, 0, width, height);

        const whiteGrad = ctx.createLinearGradient(0, 0, width, 0);
        whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
        whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = whiteGrad;
        ctx.fillRect(0, 0, width, height);

        const blackGrad = ctx.createLinearGradient(0, 0, 0, height);
        blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
        blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = blackGrad;
        ctx.fillRect(0, 0, width, height);

        // Draw selection circle
        const x = hsv.s * width;
        const y = (1 - hsv.v) * height;
        ctx.strokeStyle = hsv.v > 0.5 ? '#000' : '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.stroke();
    }, [hsv]);

    useEffect(() => {
        drawCanvas();
    }, [drawCanvas]);

    const handleCanvasInteraction = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        
        const newHsv = { ...hsv, s: x, v: 1 - y };
        setHsv(newHsv);
        onChange && onChange(hsvToHex(newHsv.h, newHsv.s, newHsv.v));
    };

    const handleMouseDown = (e) => {
        setDragging(true);
        handleCanvasInteraction(e);
    };

    useEffect(() => {
        if (!dragging) return;
        const handleMouseMove = (e) => handleCanvasInteraction(e);
        const handleMouseUp = () => setDragging(false);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragging, hsv]);

    return (
        <div className="custom-color-picker" style={{ padding: '5px', background: '#222', borderRadius: '4px' }}>
            <canvas 
                ref={canvasRef}
                width={150}
                height={100}
                style={{ width: '100%', height: '100px', cursor: 'crosshair', borderRadius: '2px' }}
                onMouseDown={handleMouseDown}
            />
            <div className="hue-slider-container" style={{ marginTop: '8px' }}>
                <input 
                    type="range"
                    min="0" max="1" step="0.001"
                    value={hsv.h}
                    onChange={(e) => {
                        const newHsv = { ...hsv, h: parseFloat(e.target.value) };
                        setHsv(newHsv);
                        onChange && onChange(hsvToHex(newHsv.h, newHsv.s, newHsv.v));
                    }}
                    style={{ 
                        width: '100%', 
                        height: '10px', 
                        appearance: 'none',
                        background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
                        borderRadius: '5px'
                    }}
                />
            </div>
        </div>
    );
};

export default ColorPicker;
