import '../index.css';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAudio } from '../contexts/AudioContext';

const WavePlayer = ({ audioFile, layerIndex, onSeek, onLoadError }) => {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const { audioCtx, getAudioInfo } = useAudio();
    const [audioBuffer, setAudioBuffer] = useState(null);
    const [themeColor, setThemeColor] = useState('rgb(255, 94, 0)'); // Default orange
    const rafRef = useRef(null);
    const isDraggingRef = useRef(false);
    const barDataRef = useRef([]); // Pre-calculated min/max for bars
    const offscreenCanvasRef = useRef(null); // Cached background waveform

    // 1. Resolve Theme Color
    const resolveThemeColor = useCallback(() => {
        const temp = document.createElement('div');
        temp.style.display = 'none';
        temp.style.color = 'var(--theme-color)';
        document.body.appendChild(temp);
        const color = getComputedStyle(temp).color;
        document.body.removeChild(temp);
        if (color && color !== 'rgba(0, 0, 0, 0)') {
            setThemeColor(color);
        }
    }, []);

    useEffect(() => {
        resolveThemeColor();
        const observer = new MutationObserver(resolveThemeColor);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
        return () => observer.disconnect();
    }, [resolveThemeColor]);

    // 2. Fetch and Decode Audio
    useEffect(() => {
        if (!audioFile?.path || !audioCtx) return;

        let active = true;
        
        const loadAudio = async () => {
            try {
                if (window.electronAPI && window.electronAPI.checkFileExists) {
                    const exists = await window.electronAPI.checkFileExists(audioFile.path);
                    if (!exists) {
                        throw new Error(`File not found: ${audioFile.path}`);
                    }
                }

                // Fetch local file
                const response = await fetch(`file:///${audioFile.path}`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                
                if (!active) return;
                
                // Decode
                const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                
                if (active) {
                    // PRE-CALCULATE BARS (Only once per file load)
                    const data = decodedBuffer.getChannelData(0);
                    const bars = [];
                    const samplesPerBar = Math.max(1, Math.floor(data.length / 500)); // Constant resolution
                    for (let i = 0; i < data.length; i += samplesPerBar) {
                        let min = 1.0;
                        let max = -1.0;
                        for (let j = 0; j < samplesPerBar && (i + j) < data.length; j++) {
                            const val = data[i + j];
                            if (val < min) min = val;
                            if (val > max) max = val;
                        }
                        bars.push({ min, max });
                    }
                    barDataRef.current = bars;
                    offscreenCanvasRef.current = null; // Clear cache
                    setAudioBuffer(decodedBuffer);
                }
            } catch (err) {
                if (!active) return;
                console.error("Failed to load/decode audio for waveform:", err);
                if (onLoadError) onLoadError(err);
            }
        };

        setAudioBuffer(null); // Clear previous
        loadAudio();

        return () => { active = false; };
    }, [audioFile, audioCtx, onLoadError]);

    // 3. Draw Waveform Helper (Optimized)
    const drawWaveform = useCallback((ctx, width, height, progress) => {
        const bars = barDataRef.current;
        if (!bars || bars.length === 0) return;

        const amp = height / 2;
        const barWidth = 2;
        const barGap = 1;
        const totalBarWidth = barWidth + barGap;

        // Cache background if needed
        if (!offscreenCanvasRef.current || offscreenCanvasRef.current.width !== width || offscreenCanvasRef.current.height !== height) {
            const offscreen = document.createElement('canvas');
            offscreen.width = width;
            offscreen.height = height;
            const octx = offscreen.getContext('2d');
            
            let faintColor = themeColor;
            if (themeColor.startsWith('rgb(')) {
                faintColor = themeColor.replace('rgb', 'rgba').replace(')', ', 0.2)');
            }
            
            octx.fillStyle = faintColor;
            const barCount = Math.ceil(width / totalBarWidth);
            for (let i = 0; i < barCount; i++) {
                const barIdx = Math.floor((i / barCount) * bars.length);
                const bar = bars[barIdx];
                const y = (1 + bar.min) * amp;
                const h = Math.max(1, (bar.max - bar.min) * amp);
                octx.fillRect(i * totalBarWidth, y, barWidth, h);
            }
            offscreenCanvasRef.current = offscreen;
        }

        ctx.clearRect(0, 0, width, height);
        
        // 1. Draw cached background
        ctx.drawImage(offscreenCanvasRef.current, 0, 0);

        // 2. Draw active foreground (progress)
        const progressX = width * progress;
        if (progressX > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, progressX, height);
            ctx.clip();
            
            ctx.fillStyle = themeColor;
            const barCount = Math.ceil(width / totalBarWidth);
            for (let i = 0; i < barCount; i++) {
                const x = i * totalBarWidth;
                if (x > progressX) break; // Early exit
                
                const barIdx = Math.floor((i / barCount) * bars.length);
                const bar = bars[barIdx];
                const y = (1 + bar.min) * amp;
                const h = Math.max(1, (bar.max - bar.min) * amp);
                ctx.fillRect(x, y, barWidth, h);
            }
            ctx.restore();
        }
        
        // 3. Draw cursor line
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(progressX, 0, 1, height);

    }, [themeColor]);

    // 4. Animation Loop
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !audioBuffer) return;

        const ctx = canvas.getContext('2d');
        
        const render = () => {
            const rect = canvas.getBoundingClientRect();
            if (canvas.width !== rect.width || canvas.height !== rect.height) {
                canvas.width = rect.width;
                canvas.height = rect.height;
                offscreenCanvasRef.current = null; // Invalidate cache on resize
            }

            const width = canvas.width;
            const height = canvas.height;

            let progress = 0;
            if (layerIndex !== null && layerIndex !== undefined) {
                const info = getAudioInfo(layerIndex);
                if (info && info.duration > 0) {
                    progress = info.currentTime / info.duration;
                }
            }

            drawWaveform(ctx, width, height, Math.max(0, Math.min(1, progress)));
            rafRef.current = requestAnimationFrame(render);
        };

        render();

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [audioBuffer, layerIndex, getAudioInfo, drawWaveform]);

    // 5. Handle Interaction
    const handleMouseDown = (e) => {
        isDraggingRef.current = true;
        handleMouseMove(e);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('mousemove', handleMouseMove);
    };

    const handleMouseUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('mousemove', handleMouseMove);
    };

    const handleMouseMove = (e) => {
        if (!canvasRef.current || !audioBuffer) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        
        const progress = Math.max(0, Math.min(1, x / width));
        const time = progress * audioBuffer.duration;
        
        if (onSeek) onSeek(time);
    };

    return (
        <div 
            ref={containerRef} 
            className="wave-player-container" 
            style={{ width: '100%', height: '35px', marginBottom: '10px', background: 'transparent', borderRadius: '4px', overflow: 'hidden' }}
            onMouseDown={handleMouseDown}
        >
            <canvas 
                ref={canvasRef} 
                style={{ width: '100%', height: '100%', display: 'block', cursor: 'pointer' }}
            />
        </div>
    );
};

export default WavePlayer;
