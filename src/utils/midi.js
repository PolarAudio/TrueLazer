import { WebMidi } from 'webmidi';

let isInitializing = false;

/**
 * Initializes the WebMidi library with a retry mechanism and timeout.
 * @param {number} [retries=3] - Number of attempts to initialize.
 * @return {Promise<WebMidi>} The initialized WebMidi instance.
 */
export const initializeMidi = async (retries = 3) => {
  if (WebMidi.enabled) {
    console.log("MIDI: WebMidi is already enabled.");
    return WebMidi;
  }

  if (isInitializing) {
    console.log("MIDI: Initialization already in progress, waiting...");
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return WebMidi;
  }

  isInitializing = true;

  try {
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`MIDI: Attempting to enable (Attempt ${i + 1})...`);
        
        // Use a 5-second timeout for the enable call to prevent hanging
        const enablePromise = WebMidi.enable({ sysex: true });
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Timeout (5s)")), 5000)
        );

        await Promise.race([enablePromise, timeoutPromise]);
        
        console.log("MIDI: WebMidi enabled successfully with SysEx support!");
        return WebMidi;
      } catch (err) {
        console.warn(`MIDI: Attempt ${i + 1} failed: ${err.message || err}`);
        
        // If it's the last attempt, try one more time WITHOUT SysEx as a safety fallback
        if (i === retries - 1) {
            console.log("MIDI: Final attempt - trying without SysEx...");
            try {
                await WebMidi.enable({ sysex: false });
                console.log("MIDI: WebMidi enabled (fallback mode, NO SysEx).");
                return WebMidi;
            } catch (fallbackErr) {
                console.error("MIDI: All initialization attempts failed.", fallbackErr);
                throw fallbackErr;
            }
        }
        
        // Wait before retrying (exponential backoff or simple delay)
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  } finally {
    isInitializing = false;
  }
};

/**
 * Gets all available MIDI input devices.
 * @return {Array<{id: string, name: string}>} List of inputs.
 */
export const getMidiInputs = () => {
  if (WebMidi.enabled) {
    return WebMidi.inputs.map(input => ({
      id: input.id,
      name: input.name,
    }));
  }
  return [];
};

/**
 * Sets up listeners for a specific MIDI input.
 * @param {string} inputId - The ID of the MIDI device.
 * @param {Function} callback - The event handler.
 * @return {Function} A cleanup function to remove listeners.
 */
export const listenToMidiInput = (inputId, callback) => {
  if (WebMidi.enabled) {
    const input = WebMidi.getInputById(inputId);
    if (input) {
      const noteOnListener = (e) => {
        callback({ 
            type: 'noteon', 
            note: e.note.identifier, 
            velocity: e.velocity, 
            controller: null,
            channel: e.message.channel
        });
      };

      const noteOffListener = (e) => {
        callback({ 
            type: 'noteoff', 
            note: e.note.identifier, 
            velocity: 0, 
            controller: null,
            channel: e.message.channel
        });
      };

      const ccListener = (e) => {
        callback({ 
            type: 'controlchange', 
            controller: e.controller.number, 
            value: e.rawValue, 
            note: null,
            channel: e.message.channel
        });
      };

      input.addListener('noteon', noteOnListener);
      input.addListener('noteoff', noteOffListener);
      input.addListener('controlchange', ccListener);

      return () => {
        input.removeListener('noteon', noteOnListener);
        input.removeListener('noteoff', noteOffListener);
        input.removeListener('controlchange', ccListener);
      };
    }
  }
  return () => {};
};

/**
 * Listens for hardware connection/disconnection changes.
 * @param {Function} callback - The event handler.
 * @return {Function} A cleanup function.
 */
export const listenToStateChange = (callback) => {
    if (WebMidi.enabled) {
        const listener = (e) => {
            callback(e);
        };
        WebMidi.addListener('connected', listener);
        WebMidi.addListener('disconnected', listener);
        return () => {
            WebMidi.removeListener('connected', listener);
            WebMidi.removeListener('disconnected', listener);
        };
    }
    return () => {};
};

/**
 * Serialises the current device list for comparison (avoids unnecessary updates
 * when only the underlying JS object reference changes).
 * @param {Array<{id: string, name: string}>} inputs
 * @return {string}
 */
const deviceListKey = (inputs) =>
    inputs.map(i => `${i.id}:${i.name}`).sort().join('|');

/**
 * Polls the current MIDI input list and calls the callback only when the set of
 * connected devices actually changes.  This is a reliable fallback for
 * environments where the Web MIDI API's statechange event doesn't fire
 * dependably (e.g. Electron after window focus changes).
 *
 * @param {Function} callback  Called with the new device list on change.
 * @param {number}  [intervalMs=2000]  Polling interval.
 * @return {Function} Cleanup function that stops polling.
 */
export const pollMidiInputs = (callback, intervalMs = 2000) => {
    if (!WebMidi.enabled) return () => {};
    let lastKey = deviceListKey(getMidiInputs());
    const id = setInterval(() => {
        const current = getMidiInputs();
        const key = deviceListKey(current);
        if (key !== lastKey) {
            lastKey = key;
            callback(current);
        }
    }, intervalMs);
    return () => clearInterval(id);
};

/**
 * Stops all listeners for a specific MIDI input.
 * @param {string} inputId - The device ID.
 */
export const stopListeningToMidiInput = (inputId) => {
  if (WebMidi.enabled) {
    const input = WebMidi.getInputById(inputId);
    if (input) {
      input.removeListener();
    }
  }
};

/**
 * Sends a SysEx message to a MIDI device.
 * @param {string} inputId - The device ID (mapped to output).
 * @param {Array<number>} sysexData - The message data bytes (excluding F0/F7/Manufacturer).
 */
export const sendSysex = (inputId, sysexData) => {
    if (WebMidi.enabled) {
        const input = WebMidi.getInputById(inputId);
        if (input) {
            const output = WebMidi.outputs.find(o => o.name === input.name);
            if (output) {
                output.sendSysex(0x47, sysexData); 
            }
        }
    }
};

/**
 * Sends a MIDI Note On message.
 * @param {string} inputId - The device ID.
 * @param {string|number} note - The note identifier or number.
 * @param {number} velocity - Velocity (0-127).
 * @param {number} channel - MIDI channel (1-16).
 */
export const sendNote = (inputId, note, velocity, channel) => {
    if (WebMidi.enabled) {
        const input = WebMidi.getInputById(inputId);
        if (input) {
            const output = WebMidi.outputs.find(o => o.name === input.name);
            if (output) {
                output.sendNoteOn(note, { attack: velocity / 127, channels: channel });
            }
        }
    }
};
