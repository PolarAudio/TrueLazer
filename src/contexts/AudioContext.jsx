import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const AudioContext = createContext();

export const useAudio = () => useContext(AudioContext);

export const AudioProvider = ({ children }) => {
    const [audioCtx, setAudioCtx] = useState(null);
    const [analyser, setAnalyser] = useState(null);
    const [externalSource, setExternalSource] = useState(null);
    const [fftSettings, setFftSettings] = useState({
        source: 'external', // 'clip' or 'external'
        lowRange: [20, 250],
        midRange: [250, 4000],
        highRange: [4000, 20000],
        gain: 1.0,
        holdTime: 100, // ms
        fallTime: 500, // ms
        calculationMode: 'average', // 'average' or 'peak'
        smoothingTimeConstant: 0.8
    });

    const [fftLevels, setFftLevels] = useState({ low: 0, mid: 0, high: 0 });
    const fftDataRef = useRef(new Uint8Array(0));
    const timeDataRef = useRef(new Uint8Array(0));
    const levelsRef = useRef({ low: 0, mid: 0, high: 0 });
    const lastLevelsRef = useRef({ 
        low: 0, mid: 0, high: 0, 
        lastUpdateTime: Date.now(),
        peakTimes: { low: 0, mid: 0, high: 0 } // Track when the last peak occurred for hold
    });

    // Audio Output Logic (Migrated from useAudioOutput)
    const [devices, setDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState('default');
    const [globalVolume, setGlobalVolume] = useState(1.0);
    const audioRefs = useRef({}); // layerIndex -> Audio object
    const sourceRefs = useRef({}); // layerIndex -> MediaElementSourceNode
    const clipVolumesRef = useRef({}); // layerIndex -> clipVolume

    const updateDevices = useCallback(async () => {
        try {
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            const audioOutputs = allDevices.filter(device => device.kind === 'audiooutput');
            setDevices(audioOutputs);
            
            if (window.electronAPI && window.electronAPI.setAudioDevices) {
                const serializedDevices = audioOutputs.map(d => ({
                    deviceId: d.deviceId,
                    label: d.label,
                    groupId: d.groupId
                }));
                window.electronAPI.setAudioDevices(serializedDevices);
            }
        } catch (error) {
            console.error('Error enumerating audio devices:', error);
        }
    }, []);

    useEffect(() => {
        updateDevices();
        let unsubscribe;
        if (window.electronAPI && window.electronAPI.onUpdateAudioDeviceId) {
            unsubscribe = window.electronAPI.onUpdateAudioDeviceId((deviceId) => {
                setSelectedDeviceId(deviceId);
            });
        }
        navigator.mediaDevices.addEventListener('devicechange', updateDevices);
        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
            if (unsubscribe) unsubscribe();
        };
    }, [updateDevices]);

    const connectMediaElement = useCallback((element) => {
        if (!audioCtx || !analyser) return null;
        try {
            const source = audioCtx.createMediaElementSource(element);
            source.connect(analyser);
            source.connect(audioCtx.destination);
            return source;
        } catch (e) {
            console.warn("MediaElementSource already connected?", e);
            return null;
        }
    }, [audioCtx, analyser]);

    const playAudio = useCallback(async (layerIndex, filePath, volume = 1.0, autoPlay = true) => {
        // Stop existing audio on this layer
        if (audioRefs.current[layerIndex]) {
            audioRefs.current[layerIndex].pause();
            audioRefs.current[layerIndex].src = '';
        }

        // Update stored clip volume
        clipVolumesRef.current[layerIndex] = volume;

        if (!filePath) return;

        if (window.electronAPI && window.electronAPI.checkFileExists) {
            const exists = await window.electronAPI.checkFileExists(filePath);
            if (!exists) {
                // If we know it doesn't exist, stop here and let caller handle it (via try/catch)
                // We need to reject to trigger the caller's catch block.
                throw new Error(`Audio file not found: ${filePath}`);
            }
        }

        // Use 3 slashes for Windows local file support
        const audio = new Audio(`file:///${filePath}`);
        audio.volume = volume * globalVolume;

        if (selectedDeviceId && audio.setSinkId) {
            try {
                await audio.setSinkId(selectedDeviceId);
            } catch (error) {
                console.error('Error setting audio sink ID:', error);
            }
        }
        
        audioRefs.current[layerIndex] = audio;

        if (audioCtx) {
            if (audioCtx.state === 'suspended') await audioCtx.resume();
            const source = connectMediaElement(audio);
            if (source) sourceRefs.current[layerIndex] = source;
        }
        
        if (autoPlay) {
            try {
                await audio.play();
            } catch (error) {
                console.error('Error playing audio:', error);
                throw error; // Re-throw to allow caller to handle missing file
            }
        }

        return audio;
    }, [selectedDeviceId, connectMediaElement, globalVolume, audioCtx]);

    const setVolume = useCallback((volume) => {
        setGlobalVolume(volume);
        Object.keys(audioRefs.current).forEach(layerIndex => {
            const audio = audioRefs.current[layerIndex];
            const clipVol = clipVolumesRef.current[layerIndex] ?? 1.0;
            if (audio) audio.volume = volume * clipVol;
        });
    }, []);

    const setClipVolume = useCallback((layerIndex, volume) => {
        clipVolumesRef.current[layerIndex] = volume;
        const audio = audioRefs.current[layerIndex];
        if (audio) {
            audio.volume = volume * globalVolume;
        }
    }, [globalVolume]);

    const stopAudio = useCallback((layerIndex) => {
        if (audioRefs.current[layerIndex]) {
            audioRefs.current[layerIndex].pause();
            audioRefs.current[layerIndex].src = '';
            delete audioRefs.current[layerIndex];
            if (sourceRefs.current[layerIndex]) {
                try { sourceRefs.current[layerIndex].disconnect(); } catch(e){}
                delete sourceRefs.current[layerIndex];
            }
        }
    }, []);

    const pauseAudio = useCallback((layerIndex) => {
        if (audioRefs.current[layerIndex]) audioRefs.current[layerIndex].pause();
    }, []);

    const resumeAudio = useCallback(async (layerIndex) => {
        if (audioRefs.current[layerIndex] && audioRefs.current[layerIndex].paused) {
            try { await audioRefs.current[layerIndex].play(); } catch (error) { console.error('Error resuming:', error); }
        }
    }, []);

    const setPlaybackRate = useCallback((rate) => {
        const clampedRate = Math.max(0.0625, Math.min(rate, 16.0));
        Object.values(audioRefs.current).forEach(audio => {
            try { audio.playbackRate = clampedRate; } catch (e) { console.warn('Failed to set playbackRate:', e); }
        });
    }, []);

    const resetAudio = useCallback((layerIndex) => {
        if (audioRefs.current[layerIndex]) audioRefs.current[layerIndex].currentTime = 0;
    }, []);

    const seekAudio = useCallback((layerIndex, time) => {
        if (audioRefs.current[layerIndex]) {
            audioRefs.current[layerIndex].currentTime = time;
        }
    }, []);

    const stopAllAudio = useCallback(() => Object.keys(audioRefs.current).forEach(stopAudio), [stopAudio]);
    const pauseAllAudio = useCallback(() => Object.keys(audioRefs.current).forEach(pauseAudio), [pauseAudio]);
    const resumeAllAudio = useCallback(() => Object.keys(audioRefs.current).forEach(resumeAudio), [resumeAudio]);
    const resetAllAudio = useCallback(() => Object.keys(audioRefs.current).forEach(resetAudio), [resetAudio]);

    const getAudioInfo = useCallback((layerIndex) => {
        const audio = audioRefs.current[layerIndex];
        if (!audio) return null;
        return {
            currentTime: audio.currentTime,
            duration: audio.duration,
            paused: audio.paused
        };
    }, []);

    // Initialize AudioContext on first user interaction
    const initAudio = useCallback(async () => {
        if (audioCtx) return;
        
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const node = ctx.createAnalyser();
        node.fftSize = 2048; // Increased for better resolution, especially if 'peak' mode is used
        node.smoothingTimeConstant = fftSettings.smoothingTimeConstant;
        fftDataRef.current = new Uint8Array(node.frequencyBinCount);
        timeDataRef.current = new Uint8Array(node.frequencyBinCount);
        
        if (ctx.state === 'suspended') {
            await ctx.resume();
        }

        setAudioCtx(ctx);
        setAnalyser(node);
    }, [audioCtx, fftSettings.smoothingTimeConstant]);

    useEffect(() => {
        const handleInteraction = () => {
            initAudio();
            window.removeEventListener('mousedown', handleInteraction);
            window.removeEventListener('keydown', handleInteraction);
        };
        window.addEventListener('mousedown', handleInteraction);
        window.addEventListener('keydown', handleInteraction);
        return () => {
            window.removeEventListener('mousedown', handleInteraction);
            window.removeEventListener('keydown', handleInteraction);
        };
    }, [initAudio]);

    // Apply smoothing when it changes
    useEffect(() => {
        if (analyser) {
            analyser.smoothingTimeConstant = fftSettings.smoothingTimeConstant;
        }
    }, [analyser, fftSettings.smoothingTimeConstant]);

    // Handle External Audio Source
    useEffect(() => {
        if (!audioCtx || !analyser || fftSettings.source !== 'external') {
            if (externalSource) {
                externalSource.disconnect();
                setExternalSource(null);
            }
            return;
        }

        let stream = null;
        const startExternal = async () => {
            try {
                if (audioCtx.state === 'suspended') await audioCtx.resume();
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const source = audioCtx.createMediaStreamSource(stream);
                source.connect(analyser);
                setExternalSource(source);
            } catch (err) {
                console.error("Failed to get external audio stream:", err);
            }
        };

        startExternal();

        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [audioCtx, analyser, fftSettings.source]);

    // FFT Analysis Loop
    useEffect(() => {
        if (!analyser) return;

        let animationFrameId;
        const analyze = () => {
            analyser.getByteFrequencyData(fftDataRef.current);
            analyser.getByteTimeDomainData(timeDataRef.current);
            
            const sampleRate = audioCtx.sampleRate;
            const binCount = analyser.frequencyBinCount;
            const freqPerBin = sampleRate / analyser.fftSize;

            const getValue = (range) => {
                const startBin = Math.floor(range[0] / freqPerBin);
                const endBin = Math.floor(range[1] / freqPerBin);
                
                if (fftSettings.calculationMode === 'peak') {
                    let max = 0;
                    for (let i = startBin; i <= endBin && i < binCount; i++) {
                        if (fftDataRef.current[i] > max) max = fftDataRef.current[i];
                    }
                    return max / 255;
                } else {
                    // Average mode
                    let sum = 0;
                    let count = 0;
                    for (let i = startBin; i <= endBin && i < binCount; i++) {
                        sum += fftDataRef.current[i];
                        count++;
                    }
                    return count > 0 ? (sum / count) / 255 : 0;
                }
            };

            const rawLow = getValue(fftSettings.lowRange);
            const rawMid = getValue(fftSettings.midRange);
            const rawHigh = getValue(fftSettings.highRange);

            const now = Date.now();
            const dt = Math.max(0, now - lastLevelsRef.current.lastUpdateTime);
            lastLevelsRef.current.lastUpdateTime = now;

            const processLevel = (raw, key) => {
                let current = raw * fftSettings.gain;
                const last = lastLevelsRef.current[key];
                const lastPeakTime = lastLevelsRef.current.peakTimes[key] || 0;
                
                if (current >= last) {
                    // Peak/Rise
                    lastLevelsRef.current.peakTimes[key] = now;
                    return current;
                } else {
                    // Hold and Fall
                    const timeSincePeak = now - lastPeakTime;
                    if (timeSincePeak < fftSettings.holdTime) {
                        return last; // Hold
                    }

                    // Fall
                    if (fftSettings.fallTime <= 0) return 0; // Instant fall
                    
                    const fallAmount = dt / fftSettings.fallTime;
                    const nextVal = last - fallAmount;
                    return Math.max(0, isNaN(nextVal) ? 0 : nextVal);
                }
            };

            const processedLevels = {
                low: processLevel(rawLow, 'low'),
                mid: processLevel(rawMid, 'mid'),
                high: processLevel(rawHigh, 'high'),
            };

            levelsRef.current = processedLevels;
            lastLevelsRef.current = { 
                ...processedLevels, 
                lastUpdateTime: now,
                peakTimes: lastLevelsRef.current.peakTimes 
            };
            
            animationFrameId = requestAnimationFrame(analyze);
        };

        analyze();
        return () => cancelAnimationFrame(animationFrameId);
    }, [audioCtx, analyser, fftSettings]);

    return (
        <AudioContext.Provider value={{
            audioCtx,
            analyser,
            fftSettings,
            setFftSettings,
            fftLevels: levelsRef.current, // Keep for React components
            fftLevelsRef: levelsRef, // Add this for animation loops
            fftDataRef: fftDataRef, // Expose raw FFT data array
            timeDataRef: timeDataRef, // Expose raw time-domain data array
            getFftLevels: () => levelsRef.current, // Add helper
            connectMediaElement,
            initAudio,
            // Audio System Exports
            devices, selectedDeviceId, setSelectedDeviceId, globalVolume, setVolume, setClipVolume,
            playAudio, stopAudio, pauseAudio, resumeAudio, setPlaybackRate, resetAudio, seekAudio,
            stopAllAudio, pauseAllAudio, resumeAllAudio, resetAllAudio, getAudioInfo
        }}>
            {children}
        </AudioContext.Provider>
    );
};
/*
<html>
  <style>
    #waveform {
      cursor: pointer;
      position: relative;
    }
    #hover {
      position: absolute;
      left: 0;
      top: 0;
      z-index: 10;
      pointer-events: none;
      height: 100%;
      width: 0;
      mix-blend-mode: overlay;
      background: rgba(255, 255, 255, 0.5);
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    #waveform:hover #hover {
      opacity: 1;
    }
    #time,
    #duration {
      position: absolute;
      z-index: 11;
      top: 50%;
      margin-top: -1px;
      transform: translateY(-50%);
      font-size: 11px;
      background: rgba(0, 0, 0, 0.75);
      padding: 2px;
      color: #ddd;
    }
    #time {
      left: 0;
    }
    #duration {
      right: 0;
    }
  </style>
  <div id="waveform">
    <div id="time">0:00</div>
    <div id="duration">0:00</div>
    <div id="hover"></div>
  </div>
</html>
*/