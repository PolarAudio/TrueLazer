import React, { useState } from 'react';

const AboutWindow = ({ show, onClose, initialTab = 'output' }) => {
    const [activeTab, setActiveTab] = useState(initialTab);

    // Update active tab when opening if initialTab changes
    React.useEffect(() => {
        if (show) {
            setActiveTab(initialTab);
        }
    }, [show, initialTab]);

    if (!show) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content audio-settings-window" style={{ minWidth: '400px' }}>
                <div className="modal-header">
                    <h3>About</h3>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>
                <div className="tab-header" style={{ display: 'flex', gap: '10px', marginBottom: '15px', borderBottom: '1px solid #444' }}>
				
                </div>
                <div className="modal-body">
                    <div className="audio-output-settings">
                    </div>
                </div>
            </div>
            <style>{`
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 10000;
                }
                .modal-content {
                    background: #222;
                    color: white;
                    border-radius: 8px;
                    border: 1px solid #444;
                    padding: 0;
                    overflow: hidden;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                }
                .modal-header {
                    background: #333;
                    padding: 10px 15px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .modal-body {
                    padding: 20px;
                }
                .close-btn {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 24px;
                    cursor: pointer;
                }
                .close-btn:hover {
                    color: white;
                }
                .param-select, input {
                    background: #111;
                    border: 1px solid #444;
                    color: white;
                    border-radius: 4px;
                }
            `}</style>
        </div>
    );
};

export default AboutWindow;
