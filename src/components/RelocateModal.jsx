import React from 'react';

const RelocateModal = ({ missingFiles, onRelocate, onClose }) => {
    if (!missingFiles || missingFiles.length === 0) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ width: '500px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                <div className="modal-header">
                    <h3>Missing Files</h3>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>
                <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
                    <p style={{ marginBottom: '15px', color: '#ccc', fontSize: '0.9em' }}>
                        The following files could not be found. Please locate one of them to update the path for all matching files in the same directory.
                    </p>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {missingFiles.map((file, index) => (
                            <li key={index} style={{ 
                                background: '#333', 
                                padding: '10px', 
                                marginBottom: '5px', 
                                borderRadius: '4px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}>
                                <div style={{ overflow: 'hidden' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.9em' }}>{file.fileName}</div>
                                    <div style={{ fontSize: '0.8em', color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '350px' }}>
                                        {file.filePath}
                                    </div>
                                </div>
                                <button 
                                    className="small-btn" 
                                    onClick={() => onRelocate(file)}
                                    style={{ marginLeft: '10px', whiteSpace: 'nowrap' }}
                                >
                                    Locate
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
            <style>{`
                .modal-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex; justify-content: center; align-items: center;
                    z-index: 10000;
                }
                .modal-content {
                    background: #222;
                    color: white;
                    border-radius: 8px;
                    border: 1px solid #444;
                    padding: 0;
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
                .small-btn {
                    background: var(--theme-color);
                    color: black;
                    border: none;
                    padding: 5px 10px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-weight: bold;
                }
                .small-btn:hover {
                    opacity: 0.9;
                }
            `}</style>
        </div>
    );
};

export default RelocateModal;