import { WebMidi } from 'webmidi';

export const initializeMidi = async () => {
  if (WebMidi.enabled) return WebMidi;
  try {
    // Request SysEx access
    await WebMidi.enable({ sysex: true });
    console.log("WebMidi is enabled with SysEx support!");
    return WebMidi;
  } catch (err) {
    console.error("WebMidi could not be enabled.", err);
    throw err;
  }
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
      const noteOnListener = (e) => {
        callback({ 
            type: 'noteon', 
            note: e.note.identifier, // e.g. "C4"
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

export const stopListeningToMidiInput = (inputId) => {
  if (WebMidi.enabled) {
    const input = WebMidi.getInputById(inputId);
    if (input) {
      input.removeListener(); // Removes all listeners
    }
  }
};

export const sendSysex = (inputId, sysexData) => {
    if (WebMidi.enabled) {
        const input = WebMidi.getInputById(inputId);
        if (input) {
            const output = WebMidi.outputs.find(o => o.name === input.name);
            if (output) {
                // In WebMidi v3, sendSysex(manufacturer, data)
                // 0x47 is Akai. sysexData should not include F0, 47, or F7.
                // Our current initData in MidiContext.jsx is: [0x7F, 0x29, 0x60, 0x00, 0x04, 0x41, 0x01, 0x01, 0x01]
                output.sendSysex(0x47, sysexData); 
                console.log(`Sent SysEx to ${output.name}`);
            } else {
                console.warn("Could not find matching MIDI Output for SysEx");
            }
        }
    }
};

export const sendNote = (inputId, note, velocity, channel) => {
    if (WebMidi.enabled) {
        const input = WebMidi.getInputById(inputId);
        if (input) {
            const output = WebMidi.outputs.find(o => o.name === input.name);
            if (output) {
                // velocity 0-127 mapped to attack
                output.sendNoteOn(note, { rawAttack: true, attack: velocity, channels: channel });
            }
        }
    }
};