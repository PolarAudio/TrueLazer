// This file now acts as a renderer-side wrapper for OSC IPC calls
// The actual OSC logic resides in the Electron main process (index.js)

export const initializeOsc = async (options = {}) => {
  if (window.electronAPI?.initializeOsc) {
    return window.electronAPI.initializeOsc(options);
  }
  console.warn("electronAPI not available. Cannot initialize OSC. Running in web mode?");
  return { success: false, error: "electronAPI not available" };
};

export const sendOscMessage = (address, args) => {
  if (window.electronAPI?.sendOscMessage) {
    window.electronAPI.sendOscMessage(address, args);
  }
};

export const addOscMessageListener = (callback) => {
  if (window.electronAPI?.onOscMessageReceived) {
    return window.electronAPI.onOscMessageReceived((oscMessage, timeTag, info) => {
      callback(oscMessage, timeTag, info);
    });
  }
  console.warn("electronAPI not available. Cannot add OSC message listener.");
  return () => {};
};

export const removeOscMessageListener = (callback) => {
    // This function is a placeholder. In the current IPC setup,
    // listeners are managed by the cleanup function returned by addOscMessageListener.
    // To remove a specific listener, you would typically use the cleanup function
    // returned when adding the listener.
};

export const closeOsc = () => {
  if (window.electronAPI?.closeOsc) {
    window.electronAPI.closeOsc();
  }
};
