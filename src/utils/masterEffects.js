/**
 * Master effects are universal, but they are applied independently to each
 * preview/output clip. Give every application its own instanceId so shared
 * animation-state maps (rotate phase, delay history, etc.) advance once per
 * clip instead of once per clip per frame.
 *
 * Speed-sync settings are keyed by `${instanceId}.${param}`, so they must be
 * remapped to the scoped id or a master effect would silently lose its
 * FPS/Timeline/BPM/FFT animation.
 */
export function scopeMasterEffects(effects, scope, syncSettings = {}) {
    if (!effects || effects.length === 0) {
        return { effects: [], syncSettings };
    }

    const scopedEffects = [];
    const scopedSyncSettings = { ...syncSettings };

    for (const effect of effects) {
        const baseId = effect.instanceId || effect.id;
        const instanceId = `${baseId}::master::${scope}`;
        scopedEffects.push({ ...effect, instanceId });

        const prefix = `${baseId}.`;
        for (const [paramKey, settings] of Object.entries(syncSettings)) {
            if (paramKey.startsWith(prefix)) {
                scopedSyncSettings[`${instanceId}.${paramKey.slice(prefix.length)}`] = settings;
            }
        }
    }

    return { effects: scopedEffects, syncSettings: scopedSyncSettings };
}
