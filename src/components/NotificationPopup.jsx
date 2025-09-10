import React from 'react';

const NotificationPopup = ({ message, visible }) => {
  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      backgroundColor: '#333',
      color: 'white',
      padding: '10px 20px',
      borderRadius: '5px',
      zIndex: 1000,
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.5s ease-in-out',
    }}>
      {message}
    </div>
  );
};

export default NotificationPopup;
