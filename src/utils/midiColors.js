/**
 * @fileoverview APC40 RGB LED Color Definitions and utilities.
 * This file provides a mapping between MIDI velocity values and HEX color codes for the APC40 Mk2.
 */

/**
 * List of available APC40 colors with their names, hex codes, and MIDI velocity values.
 * @type {Array<{name: string, hex: string, velocity: number}>}
 */
export const APC40_COLORS = [
  { name: 'Off', hex: '#000000', velocity: 0 },
  { name: 'Grey Dark', hex: '#1E1E1E', velocity: 1 },
  { name: 'Grey Mid', hex: '#7F7F7F', velocity: 2 },
  { name: 'White', hex: '#FFFFFF', velocity: 3 },
  { name: 'Red Light', hex: '#FF4C4C', velocity: 4 },
  { name: 'Red', hex: '#FF0000', velocity: 5 },
  { name: 'Red Dark', hex: '#590000', velocity: 6 },
  { name: 'Red Very Dark', hex: '#190000', velocity: 7 },
  { name: 'Orange Light', hex: '#FFBD6C', velocity: 8 },
  { name: 'Orange', hex: '#FF5400', velocity: 9 },
  { name: 'Orange Dark', hex: '#591D00', velocity: 10 },
  { name: 'Orange Very Dark', hex: '#271B00', velocity: 11 },
  { name: 'Yellow Light', hex: '#FFFF4C', velocity: 12 },
  { name: 'Yellow', hex: '#FFFF00', velocity: 13 },
  { name: 'Yellow Dark', hex: '#595900', velocity: 14 },
  { name: 'Yellow Very Dark', hex: '#191900', velocity: 15 },
  { name: 'Lime Light', hex: '#88FF4C', velocity: 16 },
  { name: 'Lime', hex: '#54FF00', velocity: 17 },
  { name: 'Lime Dark', hex: '#1D5900', velocity: 18 },
  { name: 'Lime Very Dark', hex: '#142B00', velocity: 19 },
  { name: 'Green Light', hex: '#4CFF4C', velocity: 20 },
  { name: 'Green', hex: '#00FF00', velocity: 21 },
  { name: 'Green Dark', hex: '#005900', velocity: 22 },
  { name: 'Green Very Dark', hex: '#001900', velocity: 23 },
  { name: 'Spring Light', hex: '#4CFF5E', velocity: 24 },
  { name: 'Spring', hex: '#00FF19', velocity: 25 },
  { name: 'Spring Dark', hex: '#00590D', velocity: 26 },
  { name: 'Spring Very Dark', hex: '#001902', velocity: 27 },
  { name: 'Turquoise Light', hex: '#4CFF88', velocity: 28 },
  { name: 'Turquoise', hex: '#00FF55', velocity: 29 },
  { name: 'Turquoise Dark', hex: '#00591D', velocity: 30 },
  { name: 'Turquoise Very Dark', hex: '#001F12', velocity: 31 },
  { name: 'Cyan Light', hex: '#4CFFB7', velocity: 32 },
  { name: 'Cyan', hex: '#00FF99', velocity: 33 },
  { name: 'Cyan Dark', hex: '#005935', velocity: 34 },
  { name: 'Cyan Very Dark', hex: '#001912', velocity: 35 },
  { name: 'Sky Light', hex: '#4CC3FF', velocity: 36 },
  { name: 'Sky', hex: '#00A9FF', velocity: 37 },
  { name: 'Sky Dark', hex: '#004152', velocity: 38 },
  { name: 'Sky Very Dark', hex: '#001019', velocity: 39 },
  { name: 'Ocean Light', hex: '#4C88FF', velocity: 40 },
  { name: 'Ocean', hex: '#0055FF', velocity: 41 },
  { name: 'Ocean Dark', hex: '#001D59', velocity: 42 },
  { name: 'Ocean Very Dark', hex: '#000819', velocity: 43 },
  { name: 'Blue Light', hex: '#4C4CFF', velocity: 44 },
  { name: 'Blue', hex: '#0000FF', velocity: 45 },
  { name: 'Blue Dark', hex: '#000059', velocity: 46 },
  { name: 'Blue Very Dark', hex: '#000019', velocity: 47 },
  { name: 'Orchid Light', hex: '#874CFF', velocity: 48 },
  { name: 'Orchid', hex: '#5400FF', velocity: 49 },
  { name: 'Orchid Dark', hex: '#190064', velocity: 50 },
  { name: 'Orchid Very Dark', hex: '#0F0030', velocity: 51 },
  { name: 'Magenta Light', hex: '#FF4CFF', velocity: 52 },
  { name: 'Magenta', hex: '#FF00FF', velocity: 53 },
  { name: 'Magenta Dark', hex: '#590059', velocity: 54 },
  { name: 'Magenta Very Dark', hex: '#190019', velocity: 55 },
  { name: 'Pink Light', hex: '#FF4C87', velocity: 56 },
  { name: 'Pink', hex: '#FF0054', velocity: 57 },
  { name: 'Pink Dark', hex: '#59001D', velocity: 58 },
  { name: 'Pink Very Dark', hex: '#220013', velocity: 59 },
  { name: 'Bright Red', hex: '#FF1500', velocity: 60 },
  { name: 'Bright Orange', hex: '#993500', velocity: 61 },
  { name: 'Gold', hex: '#795100', velocity: 62 },
  { name: 'Moss', hex: '#436400', velocity: 63 },
  { name: 'Grass', hex: '#033900', velocity: 64 },
  { name: 'Sea', hex: '#005735', velocity: 65 },
  { name: 'Navy Ocean', hex: '#00547F', velocity: 66 },
  { name: 'Pure Blue', hex: '#0000FF', velocity: 67 },
  { name: 'Slate', hex: '#00454F', velocity: 68 },
  { name: 'Indigo', hex: '#2500CC', velocity: 69 },
  { name: 'Grey Bright', hex: '#7F7F7F', velocity: 70 },
  { name: 'Charcoal', hex: '#202020', velocity: 71 },
  { name: 'Strong Red', hex: '#FF0000', velocity: 72 },
  { name: 'Neon Green', hex: '#BDFF2D', velocity: 73 },
  { name: 'Lime Strong', hex: '#AFED06', velocity: 74 },
  { name: 'Green Strong', hex: '#64FF09', velocity: 76 },
  { name: 'Mint Strong', hex: '#00FF87', velocity: 77 },
  { name: 'Cyan Strong', hex: '#00A9FF', velocity: 78 },
  { name: 'Blue Strong', hex: '#002AFF', velocity: 79 },
  { name: 'Purple Strong', hex: '#3F00FF', velocity: 80 },
  { name: 'Violet Strong', hex: '#7A00FF', velocity: 81 },
  { name: 'Rose Strong', hex: '#B21A7D', velocity: 82 },
  { name: 'Brown', hex: '#402100', velocity: 83 },
  { name: 'Fire', hex: '#FF4A00', velocity: 84 },
  { name: 'Acid Green', hex: '#88E106', velocity: 85 },
  { name: 'Spring Strong', hex: '#72FF15', velocity: 86 },
  { name: 'Vibrant Green', hex: '#00FF00', velocity: 87 },
  { name: 'Aqua', hex: '#3BFF26', velocity: 88 },
  { name: 'Vibrant Cyan', hex: '#59FF71', velocity: 89 },
  { name: 'Sky Strong', hex: '#38FFCC', velocity: 90 },
  { name: 'Deep Sky', hex: '#5B8AFF', velocity: 91 },
  { name: 'Indigo Dark', hex: '#3151C6', velocity: 92 },
  { name: 'Deep Purple', hex: '#877FE9', velocity: 93 },
  { name: 'Deep Magenta', hex: '#D31DFF', velocity: 94 },
  { name: 'Deep Rose', hex: '#FF005D', velocity: 95 },
  { name: 'Vibrant Orange', hex: '#FF7F00', velocity: 96 },
  { name: 'Deep Yellow', hex: '#B9B000', velocity: 97 },
  { name: 'Neon Lime', hex: '#90FF00', velocity: 98 },
  { name: 'Dark Gold', hex: '#835D07', velocity: 99 },
  { name: 'Tan', hex: '#392b00', velocity: 100 },
  { name: 'Forest', hex: '#144C10', velocity: 101 },
  { name: 'Teal', hex: '#0D5038', velocity: 102 },
  { name: 'Night', hex: '#15152A', velocity: 103 },
  { name: 'Midnight', hex: '#16205A', velocity: 104 },
  { name: 'Mud', hex: '#693C1C', velocity: 105 },
  { name: 'Dark Red', hex: '#A8000A', velocity: 106 },
  { name: 'Soft Red', hex: '#DE513D', velocity: 107 },
  { name: 'Soft Orange', hex: '#D86A1C', velocity: 108 },
  { name: 'Soft Yellow', hex: '#FFE126', velocity: 109 },
  { name: 'Soft Lime', hex: '#9EE12F', velocity: 110 },
  { name: 'Soft Green', hex: '#67B50F', velocity: 111 },
  { name: 'Soft Grey', hex: '#1E1E30', velocity: 112 },
  { name: 'Mint Light', hex: '#DCFF6B', velocity: 113 },
  { name: 'Cyan Pale', hex: '#80FFBD', velocity: 114 },
  { name: 'Lavender', hex: '#9A99FF', velocity: 115 },
  { name: 'Mauve', hex: '#8E66FF', velocity: 116 },
  { name: 'Grey Soft', hex: '#404040', velocity: 117 },
  { name: 'Grey Pale', hex: '#757575', velocity: 118 },
  { name: 'Pure White', hex: '#E0FFFF', velocity: 119 },
  { name: 'Red Hardware', hex: '#A00000', velocity: 120 },
  { name: 'Red Half', hex: '#350000', velocity: 121 },
  { name: 'Green Hardware', hex: '#1AD000', velocity: 122 },
  { name: 'Green Half', hex: '#074200', velocity: 123 },
  { name: 'Yellow Hardware', hex: '#B9B000', velocity: 124 },
  { name: 'Yellow Half', hex: '#3F3100', velocity: 125 },
  { name: 'Amber Hardware', hex: '#B35F00', velocity: 126 },
  { name: 'Amber Half', hex: '#4B1502', velocity: 127 },
];

/**
 * Finds the MIDI velocity value for a given color name.
 * @param {string} name - The name of the color.
 * @return {number} The velocity value.
 */
export const getVelocityForColorName = (name) => {
  const color = APC40_COLORS.find(c => c.name.toLowerCase() === name.toLowerCase());
  return color ? color.velocity : 0;
};

/**
 * Finds the color object for a given MIDI velocity value.
 * @param {number} vel - The velocity value.
 * @return {Object} The color object {name, hex, velocity}.
 */
export const getColorForVelocity = (vel) => {
  return APC40_COLORS.find(c => c.velocity === vel) || APC40_COLORS[0];
};

/**
 * Mapping of application UI themes to MIDI velocity values for APC40 feedback.
 * @type {Object<string, {full: number, dim: number}>}
 */
export const THEME_COLORS = {
  'orange': { full: 96, dim: 10 }, // Vibrant Orange / Orange Dark
  'yellow': { full: 13, dim: 15 }, // Yellow / Yellow Very Dark
  'cyan': { full: 33, dim: 35 }, // Cyan / Cyan Very Dark
  'light-blue': { full: 37, dim: 39 }, // Sky / Sky Very Dark
  'blue': { full: 45, dim: 47 }, // Blue / Blue Very Dark
  'magenta': { full: 53, dim: 55 }, // Magenta / Magenta Very Dark
  'red': { full: 5, dim: 7 }, // Red / Red Very Dark
  'green': { full: 21, dim: 23 }, // Green / Green Very Dark
  'white': { full: 119, dim: 1 }, // Pure White / Grey Dark
};

