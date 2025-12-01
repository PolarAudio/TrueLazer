// This file now acts as a renderer-side wrapper for OSC IPC calls
// The actual OSC logic resides in the Electron main process (index.js)

export const initializeOsc = async (options = {}) => {
  if (window.electronAPI) {
    return window.electronAPI.initializeOsc(options);
  }
  console.error("electronAPI not available. Cannot initialize OSC.");
  return { success: false, error: "electronAPI not available" };
};

export const sendOscMessage = (address, args) => {
  if (window.electronAPI) {
    window.electronAPI.sendOscMessage(address, args);
  } else {
    console.error("electronAPI not available. Cannot send OSC message.");
  }
};

export const addOscMessageListener = (callback) => {
  if (window.electronAPI) {
    return window.electronAPI.onOscMessageReceived((oscMessage, timeTag, info) => {
      callback(oscMessage, timeTag, info);
    });
  }
  console.error("electronAPI not available. Cannot add OSC message listener.");
  return () => {};
};

export const removeOscMessageListener = (callback) => {
    // This function is a placeholder. In the current IPC setup,
    // listeners are managed by the cleanup function returned by addOscMessageListener.
    // To remove a specific listener, you would typically use the cleanup function
    // returned when adding the listener.
    console.warn("Removing specific OSC message listeners requires managing cleanup functions returned by addOscMessageListener.");
};

export const closeOsc = () => {
  if (window.electronAPI) {
    window.electronAPI.closeOsc();
  } else {
    console.error("electronAPI not available. Cannot close OSC.");
  }
};
