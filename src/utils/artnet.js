// This file now acts as a renderer-side wrapper for Art-Net IPC calls
// The actual DMXNet logic resides in the Electron main process (index.js)

export const initializeArtnet = async () => {
  if (window.electronAPI?.initializeArtnet) {
    return window.electronAPI.initializeArtnet();
  }
  console.warn("electronAPI not available. Cannot initialize Art-Net. Running in web mode?");
  return { success: false, error: "electronAPI not available" };
};

export const getArtnetUniverses = async () => {
  if (window.electronAPI?.getArtnetUniverses) {
    return window.electronAPI.getArtnetUniverses();
  }
  return [];
};

export const sendArtnetData = (universe, channel, value) => {
  if (window.electronAPI?.sendArtnetData) {
    window.electronAPI.sendArtnetData(universe, channel, value);
  }
};

export const closeArtnet = () => {
  if (window.electronAPI?.closeArtnet) {
    window.electronAPI.closeArtnet();
  }
};
