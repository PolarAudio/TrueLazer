import React from 'react';

const ClipExportWarningModal = ({ show, mismatchCount, clipSyncMode, onCancel, onExportAnyway, onAutoCorrect }) => {
  if (!show) return null;

  return (
    <div className="shortcuts-modal-overlay" style={{ pointerEvents: 'auto' }}>
      <div className="shortcuts-modal-content" style={{ maxWidth: '440px' }}>
        <h3>Timing Sync Mismatch</h3>
        <div className="settings-section" style={{ border: 'none' }}>
          <p style={{ margin: '0 0 12px 0', color: '#ccc', fontSize: '13px', lineHeight: 1.5 }}>
            This clip has {mismatchCount} effect parameter(s) synced to a time source that differs from
            the clip&apos;s playback mode (<strong>{clipSyncMode}</strong>). Exporting as-is may bake in
            unexpected timing for those parameters.
          </p>
          <p style={{ margin: '0 0 15px 0', color: '#aaa', fontSize: '13px', lineHeight: 1.5 }}>
            Auto-correcting will re-target those parameters to the clip&apos;s playback time sync for this
            export only (the clip itself is not modified).
          </p>
          <div className="button-row" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button onClick={onCancel}>Cancel</button>
            <button onClick={onExportAnyway}>Export Anyway</button>
            <button
              onClick={onAutoCorrect}
              style={{ backgroundColor: 'var(--theme-color)', color: 'black' }}
            >
              Auto-Correct Timing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClipExportWarningModal;