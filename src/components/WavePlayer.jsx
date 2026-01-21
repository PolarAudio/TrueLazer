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
                const response = await fetch(`file://${audioFile.path}`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                
                if (!active) return;
                
                // Decode
                const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                
                if (active) {
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

    // 3. Draw Waveform Helper
    const drawWaveform = useCallback((ctx, width, height, buffer, progress) => {
        if (!buffer) return;

        const data = buffer.getChannelData(0); // Left channel
        const amp = height / 2;
        
        // Bar configuration
        const barWidth = 2;
        const barGap = 2;
        const totalBarWidth = barWidth + barGap;

        ctx.clearRect(0, 0, width, height);

        const drawBars = (color) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            
            for (let i = 0; i < width; i += totalBarWidth) {
                // Map current pixel to audio data samples
                const startSample = Math.floor(i * (data.length / width));
                const endSample = Math.floor((i + barWidth) * (data.length / width));
                
                let min = 1.0;
                let max = -1.0;
                
                for (let j = startSample; j < endSample && j < data.length; j++) {
                    const datum = data[j];
                    if (datum < min) min = datum;
                    if (datum > max) max = datum;
                }
                
                const y = (1 + min) * amp;
                const h = Math.max(1, (max - min) * amp);
                
                // Draw rounded bar if supported, otherwise rect
                if (ctx.roundRect) {
                    ctx.roundRect(i, y, barWidth, h, 1);
                } else {
                    ctx.rect(i, y, barWidth, h);
                }
            }
            ctx.fill();
        };

        const progressX = width * progress;

        // 1. Draw Background (faint)
        let faintColor = themeColor;
        if (themeColor.startsWith('rgb(')) {
            faintColor = themeColor.replace('rgb', 'rgba').replace(')', ', 0.25)');
        }
        drawBars(faintColor);

        // 2. Draw Foreground (solid theme color) with clipping
        if (progress > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, progressX, height);
            ctx.clip();
            drawBars(themeColor);
            ctx.restore();
        }
        
        // Draw cursor line
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(progressX, 0, 1, height);

    }, [themeColor]);

    // 4. Animation Loop
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !audioBuffer) return;

        const ctx = canvas.getContext('2d');
        
        const render = () => {
            // Match canvas internal resolution to CSS display size for crispness
            const rect = canvas.getBoundingClientRect();
            if (canvas.width !== rect.width || canvas.height !== rect.height) {
                canvas.width = rect.width;
                canvas.height = rect.height;
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

            progress = Math.max(0, Math.min(1, progress));
            drawWaveform(ctx, width, height, audioBuffer, progress);
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
