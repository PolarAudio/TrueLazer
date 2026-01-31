import React, { useState } from 'react';

const CollapsiblePanel = ({ title, children, icon, defaultCollapsed = false, headerActions, onToggle, isCollapsed }) => {
    const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);

    const collapsed = onToggle !== undefined ? isCollapsed : internalCollapsed;

    const handleToggle = () => {
        if (onToggle) {
            onToggle(!collapsed);
        } else {
            setInternalCollapsed(!collapsed);
        }
    };

    return (
        <div className={`settings-card ${collapsed ? 'collapsed' : ''}`}>
            <div 
                className="settings-card-header" 
                onClick={handleToggle} 
                style={{ userSelect: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}
            >
                <div style={{display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer'}}>
                     {/* Playhead Arrow */}
                     <svg 
                        xmlns="http://www.w3.org/2000/svg" 
                        width="12" 
                        height="12" 
                        fill="currentColor" 
                        viewBox="0 0 16 16"
                        style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 0.2s' }}
                     >
                        <path d="m12.14 8.753-5.482 4.796c-.646.566-1.658.106-1.658-.753V3.204a1 1 0 0 1 1.659-.753l5.48 4.796a1 1 0 0 1 0 1.506z"/>
                     </svg>
                     {icon && <span className={`bi ${icon}`}></span>}
                     <h4>{title}</h4>
                </div>
                {headerActions && (
                    <div onClick={(e) => e.stopPropagation()}>
                        {headerActions}
                    </div>
                )}
            </div>
            {!collapsed && <div className="settings-card-content">{children}</div>}
        </div>
    );
};

export default CollapsiblePanel;