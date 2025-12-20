export const effectDefinitions = [
  {
    id: 'rotate',
    name: 'Rotate',
    type: 'transform',
    description: 'Rotates the shape around its center.',
    defaultParams: {
      angle: 0,
      rotationSpeed: 0, // Added rotation speed
    },
    paramControls: [
      { id: 'angle', label: 'Angle', type: 'range', min: 0, max: 360, step: 1 },
      { id: 'rotationSpeed', label: 'Rotation Speed', type: 'range', min: -10, max: 10, step: 0.1 },
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    type: 'transform',
    description: 'Scales the shape.',
    defaultParams: {
      scaleX: 1,
      scaleY: 1,
    },
    paramControls: [
      { id: 'scaleX', label: 'Scale X', type: 'range', min: 0.01, max: 5.0, step: 0.01 },
      { id: 'scaleY', label: 'Scale Y', type: 'range', min: 0.01, max: 5.0, step: 0.01 },
    ],
  },
  {
    id: 'translate',
    name: 'Translate',
    type: 'transform',
    description: 'Moves the shape.',
    defaultParams: {
      translateX: 0,
      translateY: 0,
    },
    paramControls: [
      { id: 'translateX', label: 'Translate X', type: 'range', min: -1.0, max: 1.0, step: 0.01 },
      { id: 'translateY', label: 'Translate Y', type: 'range', min: -1.0, max: 1.0, step: 0.01 },
    ],
  },
  {
    id: 'color',
    name: 'Color',
    type: 'color',
    description: 'Changes the color of the shape.',
    defaultParams: {
      r: 255,
      g: 255,
      b: 255,
    },
    paramControls: [
      { id: 'r', label: 'Red', type: 'range', min: 0, max: 255, step: 1 },
      { id: 'g', label: 'Green', type: 'range', min: 0, max: 255, step: 1 },
      { id: 'b', label: 'Blue', type: 'range', min: 0, max: 255, step: 1 },
    ],
  },
  {
    id: 'wave',
    name: 'Wave',
    type: 'animation',
    description: 'Applies a wave distortion to the shape.',
    defaultParams: {
      amplitude: 0.1,
      frequency: 10,
      speed: 1,
      direction: 'x', // 'x' or 'y'
    },
    paramControls: [
      { id: 'amplitude', label: 'Amplitude', type: 'range', min: 0.01, max: 1.0, step: 0.01 },
      { id: 'frequency', label: 'Frequency', type: 'range', min: 1, max: 50, step: 1 },
      { id: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 10, step: 0.1 },
      { id: 'direction', label: 'Direction', type: 'select', options: ['x', 'y'] },
    ],
  },
  {
    id: 'blanking',
    name: 'Blanking',
    type: 'animation',
    description: 'Controls the blanking of the laser output.',
    defaultParams: {
      blankingInterval: 0, // Interval for blanking points (e.g., 0 for no blanking, 1 for every other point)
    },
    paramControls: [
      { id: 'blankingInterval', label: 'Blanking Interval', type: 'range', min: 0, max: 10, step: 1 },
    ],
  },
  {
    id: 'strobe',
    name: 'Strobe',
    type: 'animation',
    description: 'Applies a strobe effect to the laser output.',
    defaultParams: {
      strobeSpeed: 100, // Speed of the strobe effect in milliseconds
      strobeAmount: 0.5, // How much of the time the laser is blanked (0-1)
    },
    paramControls: [
      { id: 'strobeSpeed', label: 'Strobe Speed (ms)', type: 'range', min: 10, max: 1000, step: 10 },
      { id: 'strobeAmount', label: 'Strobe Amount (0-1)', type: 'range', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    id: 'mirror',
    name: 'Mirror',
    type: 'transform',
    description: 'Mirrors the shape along the X or Y axis.',
    defaultParams: {
      mirrorX: false,
      mirrorY: false,
    },
    paramControls: [
      { id: 'mirrorX', label: 'Mirror X', type: 'checkbox' },
      { id: 'mirrorY', label: 'Mirror Y', type: 'checkbox' },
    ],
  },
];