export const effectDefinitions = [
  {
    id: 'rotate',
    name: 'Rotate',
    type: 'transform',
    description: 'Rotates the shape around its center.',
    defaultParams: {
      angle: 0,
      speed: 0,
      direction: 'CW', // 'CW' or 'CCW'
    },
    paramControls: [
      { id: 'angle', label: 'Angle', type: 'range', min: 0, max: 360, step: 1 },
      { id: 'speed', label: 'Speed', type: 'range', min: 0, max: 10, step: 0.1 },
      { id: 'direction', label: 'Direction', type: 'select', options: ['CW', 'CCW'] },
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
    description: 'Changes the color of the shape with solid or rainbow modes.',
    defaultParams: {
      mode: 'solid',
      r: 255,
      g: 255,
      b: 255,
      cycleSpeed: 0,
      rainbowSpread: 1.0,
      rainbowOffset: 0,
      rainbowPalette: 'rainbow',
    },
    paramControls: [
      { id: 'mode', label: 'Mode', type: 'select', options: ['solid', 'rainbow'] },
      { id: 'r', label: 'Red', type: 'range', min: 0, max: 255, step: 1, showIf: { mode: 'solid' } },
      { id: 'g', label: 'Green', type: 'range', min: 0, max: 255, step: 1, showIf: { mode: 'solid' } },
      { id: 'b', label: 'Blue', type: 'range', min: 0, max: 255, step: 1, showIf: { mode: 'solid' } },
      { id: 'cycleSpeed', label: 'Cycle Speed', type: 'range', min: 0, max: 10, step: 0.1 },
      { id: 'rainbowSpread', label: 'Rainbow Spread', type: 'range', min: 0.1, max: 10.0, step: 0.1, showIf: { mode: 'rainbow' } },
      { id: 'rainbowOffset', label: 'Rainbow Offset', type: 'range', min: 0, max: 360, step: 1, showIf: { mode: 'rainbow' } },
      { id: 'rainbowPalette', label: 'Palette', type: 'select', options: ['rainbow', 'fire', 'ice', 'cyber'], showIf: { mode: 'rainbow' } },
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
    id: 'warp',
    name: 'Warp',
    type: 'animation',
    description: 'Symmetrical chaotic wave distortion.',
    defaultParams: {
      amount: 0.1,
      chaos: 0.5,
      speed: 1,
    },
    paramControls: [
      { id: 'amount', label: 'Amount', type: 'range', min: 0, max: 1.0, step: 0.01 },
      { id: 'chaos', label: 'Chaos', type: 'range', min: 0, max: 1.0, step: 0.01 },
      { id: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 10, step: 0.1 },
    ],
  },
  {
    id: 'distortion',
    name: 'Distortion',
    type: 'transform',
    description: 'Distorts the point data.',
    defaultParams: {
      amount: 0.1,
      scale: 10,
      speed: 0.5,
    },
    paramControls: [
      { id: 'amount', label: 'Amount', type: 'range', min: 0, max: 1.0, step: 0.01 },
      { id: 'scale', label: 'Scale', type: 'range', min: 1, max: 50, step: 1 },
      { id: 'speed', label: 'Speed', type: 'range', min: 0, max: 5, step: 0.1 },
    ],
  },
  {
    id: 'move',
    name: 'Move (Bounce)',
    type: 'transform',
    description: 'Moves points and bounces them off the borders.',
    defaultParams: {
      speedX: 0.1,
      speedY: 0.1,
    },
    paramControls: [
      { id: 'speedX', label: 'Speed X', type: 'range', min: 0, max: 2.0, step: 0.01 },
      { id: 'speedY', label: 'Speed Y', type: 'range', min: 0, max: 2.0, step: 0.01 },
    ],
  },
  {
    id: 'delay',
    name: 'Delay',
    type: 'effect',
    description: 'Frame or Channel based delay effect.',
    defaultParams: {
      mode: 'frame', // 'frame' or 'channel'
      playstyle: 'repeat', // 'once', 'repeat', 'bounce'
      useCustomOrder: false, 
      delayDirection: 'left_to_right', 
      delayAmount: 5,
      decay: 0.8,
      customOrder: [], 
      enabled: true,
    },
    paramControls: [
      { id: 'mode', label: 'Mode', type: 'select', options: ['frame', 'channel'] },
      { id: 'playstyle', label: 'Playstyle', type: 'select', options: ['once', 'repeat'] },
      { id: 'useCustomOrder', label: 'Custom Order', type: 'checkbox', showIf: { mode: 'channel' } },
      { id: 'delayDirection', label: 'Direction', type: 'select', options: ['center_to_out', 'out_to_center', 'left_to_right', 'right_to_left'], showIf: { useCustomOrder: false } },
      { id: 'delayAmount', label: 'Delay Time', type: 'range', min: 1, max: 60, step: 1 },
      { id: 'decay', label: 'Decay', type: 'range', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    id: 'chase',
    name: 'Chase',
    type: 'effect',
    description: 'Frame or Channel based chase effect.',
    defaultParams: {
        mode: 'frame',
        playstyle: 'repeat',
        steps: 4,
        decay: 0.8,
        speed: 1.0,
        overlap: 1,
        direction: 'left_to_right',
        useCustomOrder: false,
        customOrder: [],
        enabled: true,
    },
    paramControls: [
        { id: 'mode', label: 'Mode', type: 'select', options: ['frame', 'channel'] },
        { id: 'playstyle', label: 'Playstyle', type: 'select', options: ['once', 'repeat', 'bounce'] },
        { id: 'steps', label: 'Steps', type: 'range', min: 2, max: 16, step: 1, showIf: { mode: 'frame' } },
        { id: 'decay', label: 'Decay', type: 'range', min: 0, max: 1, step: 0.01 },
        { id: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 5.0, step: 0.1 },
        { id: 'overlap', label: 'Overlap', type: 'range', min: 1, max: 4, step: 1 },
        { id: 'useCustomOrder', label: 'Custom Order', type: 'checkbox', showIf: { mode: 'channel' } },
        { id: 'direction', label: 'Direction', type: 'select', options: ['center_to_out', 'out_to_center', 'left_to_right', 'right_to_left'], showIf: { useCustomOrder: false } },
    ]
  },
  {
    id: 'blanking',
    name: 'Blanking',
    type: 'animation',
    description: 'Controls the blanking of the laser output.',
    defaultParams: {
      blankingInterval: 0, 
      spacing: 0,
    },
    paramControls: [
      { id: 'blankingInterval', label: 'Blanking Interval', type: 'range', min: 0, max: 10, step: 1 },
      { id: 'spacing', label: 'Spacing', type: 'range', min: 0, max: 20, step: 1 },
    ],
  },
  {
    id: 'strobe',
    name: 'Strobe',
    type: 'animation',
    description: 'Applies a strobe effect to the laser output.',
    defaultParams: {
      strobeSpeed: 100,
      strobeAmount: 0.5,
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
    description: 'Mirrors the shape from the center.',
    defaultParams: {
      mode: 'none', 
    },
    paramControls: [
      { id: 'mode', label: 'Mirror Mode', type: 'select', options: ['none', 'x+', 'x-', 'y+', 'y-'] },
    ],
  },
];