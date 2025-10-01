import { useMemo } from 'react';

const calculateBounds = (points) => {
  if (!points || points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, maxX, minY, maxY };
};

export const useFrameOptimizer = (frames) => {
  return useMemo(() => {
    if (frames && frames.length > 0) {
      return frames.map(frame => ({
        ...frame,
        bounds: calculateBounds(frame.points)
      }));
    } else {
      return [];
    }
  }, [frames]);
};