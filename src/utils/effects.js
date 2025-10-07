export function applyEffects(frame, effects) {
  let modifiedFrame = { ...frame };

  for (const effect of effects) {
    switch (effect.name) {
      case 'rotate':
        modifiedFrame = applyRotate(modifiedFrame, effect.params);
        break;
      case 'scale':
        modifiedFrame = applyScale(modifiedFrame, effect.params);
        break;
      case 'translate':
        modifiedFrame = applyTranslate(modifiedFrame, effect.params);
        break;
      case 'color':
        modifiedFrame = applyColor(modifiedFrame, effect.params);
        break;
      case 'wave':
        modifiedFrame = applyWave(modifiedFrame, effect.params);
        break;
      // Add other effects here
      default:
        break;
    }
  }

  return modifiedFrame;
}

function applyRotate(frame, params) {
  const angle = params.angle || 0;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);

  const newPoints = frame.points.map(point => {
    const x = point.x * cos - point.y * sin;
    const y = point.x * sin + point.y * cos;
    return { ...point, x, y };
  });

  return { ...frame, points: newPoints };
}

function applyScale(frame, params) {
  const scaleX = params.scaleX || 1;
  const scaleY = params.scaleY || 1;

  const newPoints = frame.points.map(point => {
    const x = point.x * scaleX;
    const y = point.y * scaleY;
    return { ...point, x, y };
  });

  return { ...frame, points: newPoints };
}

function applyTranslate(frame, params) {
  const translateX = params.translateX || 0;
  const translateY = params.translateY || 0;

  const newPoints = frame.points.map(point => {
    const x = point.x + translateX;
    const y = point.y + translateY;
    return { ...point, x, y };
  });

  return { ...frame, points: newPoints };
}

function applyColor(frame, params) {
  const r = params.r || 255;
  const g = params.g || 255;
  const b = params.b || 255;

  const newPoints = frame.points.map(point => {
    return { ...point, r, g, b };
  });

  return { ...frame, points: newPoints };
}

function applyWave(frame, params) {
  const amplitude = params.amplitude || 0.1;
  const frequency = params.frequency || 10;
  const speed = params.speed || 1;
  const direction = params.direction || 'x';

  const newPoints = frame.points.map(point => {
    let x = point.x;
    let y = point.y;

    if (direction === 'x') {
      y += amplitude * Math.sin(point.x * frequency + Date.now() * 0.001 * speed);
    } else if (direction === 'y') {
      x += amplitude * Math.sin(point.y * frequency + Date.now() * 0.001 * speed);
    }

    return { ...point, x, y };
  });

  return { ...frame, points: newPoints };
}
