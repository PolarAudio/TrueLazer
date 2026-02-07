import React from 'react';

const TimelineEditor = ({ onBack }) => {
  return (
    <div className="timeline-editor-page" style={{ 
      width: '100vw', 
      height: '100vh', 
      background: '#111', 
      color: 'white',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <header style={{ 
        padding: '10px 20px', 
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <h2>Timeline Editor (Coming Soon)</h2>
        <button 
          onClick={onBack}
          style={{
            padding: '8px 16px',
            background: '#ff5e00',
            border: 'none',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Back to Show Control
        </button>
      </header>
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <p>This is the Timeline Editor placeholder.</p>
          <p>Goal: Arrange clips on a timeline for synchronized playback.</p>
        </div>
      </main>
    </div>
  );
};

export default TimelineEditor;
