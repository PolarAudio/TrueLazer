import { useState, useEffect, useCallback, useRef } from 'react';

export const useAudioOutput = () => {
    const [devices, setDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState('default');
    const audioRefs = useRef({}); // layerIndex -> Audio object

    const updateDevices = useCallback(async () => {
        try {
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            const audioOutputs = allDevices.filter(device => device.kind === 'audiooutput');
            setDevices(audioOutputs);
            
            // Sync with main process for menu
            if (window.electronAPI && window.electronAPI.setAudioDevices) {
                // Serializing to avoid IPC issues with MediaDeviceInfo objects
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

    const playAudio = useCallback(async (layerIndex, filePath, autoPlay = true) => {
        // Stop existing audio on this layer
        if (audioRefs.current[layerIndex]) {
            audioRefs.current[layerIndex].pause();
            audioRefs.current[layerIndex].src = '';
            delete audioRefs.current[layerIndex];
        }

        if (!filePath) return;

        const audio = new Audio(`file://${filePath}`);
        if (selectedDeviceId && audio.setSinkId) {
            try {
                await audio.setSinkId(selectedDeviceId);
            } catch (error) {
                console.error('Error setting audio sink ID:', error);
            }
        }
        
        audioRefs.current[layerIndex] = audio;
        
        if (autoPlay) {
            try {
                await audio.play();
            } catch (error) {
                console.error('Error playing audio:', error);
            }
        }

        return audio;
    }, [selectedDeviceId]);

    const stopAudio = useCallback((layerIndex) => {
        if (audioRefs.current[layerIndex]) {
            audioRefs.current[layerIndex].pause();
            audioRefs.current[layerIndex].src = '';
            delete audioRefs.current[layerIndex];
        }
    }, []);

    const pauseAudio = useCallback((layerIndex) => {
        if (audioRefs.current[layerIndex]) {
            audioRefs.current[layerIndex].pause();
        }
    }, []);

    const resumeAudio = useCallback(async (layerIndex) => {
        if (audioRefs.current[layerIndex] && audioRefs.current[layerIndex].paused) {
            try {
                await audioRefs.current[layerIndex].play();
            } catch (error) {
                console.error('Error resuming audio:', error);
            }
        }
    }, []);

    const setPlaybackRate = useCallback((rate) => {
        Object.values(audioRefs.current).forEach(audio => {
            audio.playbackRate = rate;
        });
    }, []);

    const resetAudio = useCallback((layerIndex) => {
        if (audioRefs.current[layerIndex]) {
            audioRefs.current[layerIndex].currentTime = 0;
        }
    }, []);

    const stopAllAudio = useCallback(() => {
        Object.keys(audioRefs.current).forEach(layerIndex => {
            stopAudio(layerIndex);
        });
    }, [stopAudio]);

    const pauseAllAudio = useCallback(() => {
        Object.keys(audioRefs.current).forEach(layerIndex => {
            pauseAudio(layerIndex);
        });
    }, [pauseAudio]);

    const resumeAllAudio = useCallback(() => {
        Object.keys(audioRefs.current).forEach(layerIndex => {
            resumeAudio(layerIndex);
        });
    }, [resumeAudio]);

    const resetAllAudio = useCallback(() => {
        Object.keys(audioRefs.current).forEach(layerIndex => {
            resetAudio(layerIndex);
        });
    }, [resetAudio]);

    const getAudioInfo = useCallback((layerIndex) => {
        const audio = audioRefs.current[layerIndex];
        if (!audio) return null;
        return {
            currentTime: audio.currentTime,
            duration: audio.duration,
            paused: audio.paused
        };
    }, []);

    return {
        devices,
        selectedDeviceId,
        setSelectedDeviceId,
        playAudio,
        stopAudio,
        pauseAudio,
        resumeAudio,
        setPlaybackRate,
        resetAudio,
        stopAllAudio,
        pauseAllAudio,
        resumeAllAudio,
        resetAllAudio,
        getAudioInfo
    };
};
