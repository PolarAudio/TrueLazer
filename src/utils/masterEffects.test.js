import { describe, expect, it } from 'vitest';
import { scopeMasterEffects } from './masterEffects';

describe('scopeMasterEffects', () => {
    const effect = {
        id: 'rotate',
        instanceId: 'master-1',
        params: { enabled: true, angle: 45 },
    };

    it('qualifies the instance id so each clip owns its animation state', () => {
        const scoped = scopeMasterEffects([effect], 'world:abc');
        expect(scoped.effects).toHaveLength(1);
        expect(scoped.effects[0].instanceId).toBe('master-1::master::world:abc');
        expect(scoped.effects[0].params).toEqual(effect.params);
    });

    it('remaps speed-sync settings to the scoped instance id', () => {
        const syncSettings = {
            'master-1.angle': { syncMode: 'fps', speedMultiplier: 2 },
            'other.angle': { syncMode: 'bpm' },
        };
        const scoped = scopeMasterEffects([effect], 'dac:abc', syncSettings);

        expect(scoped.syncSettings['master-1::master::dac:abc.angle']).toEqual(syncSettings['master-1.angle']);
        expect(scoped.syncSettings['other.angle']).toEqual(syncSettings['other.angle']);
    });

    it('returns the original sync settings when nothing is assigned', () => {
        const syncSettings = { 'other.angle': { syncMode: 'fps' } };
        const scoped = scopeMasterEffects([], 'world:abc', syncSettings);
        expect(scoped.effects).toEqual([]);
        expect(scoped.syncSettings).toBe(syncSettings);
    });
});
