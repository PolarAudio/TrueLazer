import React from 'react';
import CollapsiblePanel from './CollapsiblePanel';
import { useTranslation } from '../i18n';
import EffectEditor from './EffectEditor';

const MasterSettingsPanel = ({
    masterEffects = [],
    onAddEffect,
    onRemoveEffect,
    onParamChange,
    onSetParamSync,
    syncSettings = {},
    onRegisterPreset,
    uiState,
    onUpdateUiState,
    progressRef,
    getFftLevels,
    bpm
}) => {
    const { t } = useTranslation();
    const collapsedPanels = uiState?.collapsedPanels || {};

    const togglePanel = (panelId, val) => {
        if (onUpdateUiState) {
            onUpdateUiState({ collapsedPanels: { [panelId]: val } });
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            const effectData = JSON.parse(e.dataTransfer.getData('application/json'));
            if (effectData && effectData.id) {
                onAddEffect && onAddEffect(effectData);
            }
        } catch (err) {
            console.error("Failed to drop effect:", err);
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };

    return (
        <div className="settings-panel-base" onDrop={handleDrop} onDragOver={handleDragOver}>
            <CollapsiblePanel
                title={t('masterSettings.masterEffects')}
                isCollapsed={!!collapsedPanels['effects']}
                onToggle={(val) => togglePanel('effects', val)}
            >
                <div className="master-effects-list" style={{ minHeight: '50px' }}>
                    {masterEffects && masterEffects.length > 0 ? (
                        masterEffects.map((effect, index) => (
                            <div key={effect.instanceId || index} style={{ marginBottom: '4px' }}>
                                <EffectEditor
                                    effect={effect}
                                    assignedDacs={[]}
                                    dacSettings={{}}
                                    onRemove={() => onRemoveEffect(index)}
                                    onParamChange={(paramId, val) => onParamChange(index, paramId, val)}
                                    syncSettings={syncSettings}
                                    onSetParamSync={onSetParamSync}
                                    context={{ targetType: 'masterEffect', effectIndex: index }}
                                    progressRef={progressRef}
                                    clipDuration={1}
                                    bpm={bpm}
                                    getFftLevels={getFftLevels}
                                    uiState={uiState}
                                    onUpdateUiState={onUpdateUiState}
                                    onRegisterPreset={onRegisterPreset}
                                />
                            </div>
                        ))
                    ) : (
                        <div className="info-text" style={{ padding: '20px', border: '1px dashed #444', borderRadius: '5px' }}>
                            Drag Effects Here
                        </div>
                    )}
                </div>
            </CollapsiblePanel>
        </div>
    );
};

export default React.memo(MasterSettingsPanel);