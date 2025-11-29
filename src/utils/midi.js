import * as WebMidi from 'webmidi';

export const initializeMidi = async () => {
  return new Promise((resolve, reject) => {
    WebMidi.enable(function (err) {
      if (err) {
        console.error("WebMidi could not be enabled.", err);
        reject(err);
      } else {
        console.log("WebMidi is enabled!");
        resolve(WebMidi);
      }
    });
  });
};

export const getMidiInputs = () => {
  if (WebMidi.enabled) {
    return WebMidi.inputs.map(input => ({
      id: input.id,
      name: input.name,
    }));
  }
  return [];
};

export const listenToMidiInput = (inputId, callback) => {
  if (WebMidi.enabled) {
    const input = WebMidi.getInputById(inputId);
    if (input) {
      input.addListener('noteon', 'all', (e) => {
        callback({ type: 'noteon', note: e.note.name + e.note.octave, velocity: e.velocity, controller: null });
      });
      input.addListener('controlchange', 'all', (e) => {
        callback({ type: 'controlchange', controller: e.controller.name, value: e.value, note: null });
      });
      // Add other listeners as needed (e.g., 'noteoff', 'programchange')
      return () => {
        input.removeListener('noteon');
        input.removeListener('controlchange');
      };
    }
  }
  return () => {};
};

export const stopListeningToMidiInput = (inputId) => {
  if (WebMidi.enabled) {
    const input = WebMidi.getInputById(inputId);
    if (input) {
      input.removeListener('noteon');
      input.removeListener('controlchange');
    }
  }
};
