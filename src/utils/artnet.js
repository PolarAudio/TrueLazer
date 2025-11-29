// This file now acts as a renderer-side wrapper for Art-Net IPC calls
// The actual DMXNet logic resides in the Electron main process (index.js)

export const initializeArtnet = async () => {
  if (window.electronAPI) {
    return window.electronAPI.initializeArtnet();
  }
  console.error("electronAPI not available. Cannot initialize Art-Net.");
  return { success: false, error: "electronAPI not available" };
};

export const getArtnetUniverses = async () => {
  if (window.electronAPI) {
    return window.electronAPI.getArtnetUniverses();
  }
  console.error("electronAPI not available. Cannot get Art-Net universes.");
  return [];
};

export const sendArtnetData = (universe, channel, value) => {
  if (window.electronAPI) {
    window.electronAPI.sendArtnetData(universe, channel, value);
  } else {
    console.error("electronAPI not available. Cannot send Art-Net data.");
  }
};

export const closeArtnet = () => {
  if (window.electronAPI) {
    window.electronAPI.closeArtnet();
  } else {
    console.error("electronAPI not available. Cannot close Art-Net.");
  }
};
