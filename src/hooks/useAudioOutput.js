import { useAudio } from '../contexts/AudioContext.jsx';

export const useAudioOutput = () => {
    const context = useAudio();
    if (!context) {
        // Fallback or error if context is missing (should be handled by app structure)
        return {};
    }
    return context; // context now has all the methods and state
};
