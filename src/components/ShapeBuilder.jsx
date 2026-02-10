import React, { useState, useRef, useEffect, useCallback } from 'react';
import { framesToIlda } from '../utils/ilda-writer';
import { parseIldaFile } from '../utils/ilda-parser';

const ShapeBuilder = ({ onBack }) => {
  // --- STATE ---
  const [tool, setTool] = useState('select');
  const [color, setColor] = useState('#00ff00');
  const [renderMode, setRenderMode] = useState('simple'); 
  const [isDrawing, setIsDrawing] = useState(false);
  const [frameCount, setFrameCount] = useState(1);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [onionSkin, setOnionSkin] = useState(true);
  const [frames, setFrames] = useState([[]]); 
  const [activeShape, setActiveShape] = useState(null);
  const [history, setHistory] = useState([ [ [] ] ]);
  const [historyStep, setHistoryStep] = useState(0);
  const [selectedShapeIndexes, setSelectedShapeIndexes] = useState([]); 
  const [selectedPointIndexes, setSelectedPointIndexes] = useState([]); 
  const [backgroundImage, setBackgroundImage] = useState(null);
  const [shapeClipboard, setShapeClipboard] = useState(null);
  const [zoom, setZoom] = useState(0.6); 
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [gridSize, setGridSize] = useState(25);
  const [continuousDrawing, setContinuousDrawing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, target: null });
  const [renderTrigger, setRenderTrigger] = useState(0);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const isMovingPointRef = useRef(false);
  const isMovingShapeRef = useRef(false);
  const isMovingPivotRef = useRef(false);
  const isRotatingRef = useRef(false);
  const isPanningRef = useRef(false);
  const isSelectingBoxRef = useRef(false);
  const selectionBoxRef = useRef(null);
  const playbackTimerRef = useRef(null);

  const CANVAS_SIZE = 1000;
  const shapes = frames[currentFrameIndex] || [];

  // --- HELPERS ---
  const recordHistory = (newFrames) => {
      const newHistory = history.slice(0, historyStep + 1);
      newHistory.push(JSON.parse(JSON.stringify(newFrames)));
      if (newHistory.length > 30) newHistory.shift();
      setHistory(newHistory);
      setHistoryStep(newHistory.length - 1);
  };

  const getBoundingBox = (shape, includeTransform = true) => {
      const pts = getShapePoints(shape, includeTransform);
      if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
      const minX = Math.min(...pts.map(p => p.x));
      const maxX = Math.max(...pts.map(p => p.x));
      const minY = Math.min(...pts.map(p => p.y));
      const maxY = Math.max(...pts.map(p => p.y));
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  const bakeTransform = (shape) => {
      const pts = getSampledPoints(shape);
      const baked = {
          ...shape,
          type: (shape.type === 'rect' || shape.type === 'circle' || shape.type === 'star') ? 'polygon' : shape.type,
          points: pts,
          rotationX: 0, rotationY: 0, rotationZ: 0,
          scaleX: 1, scaleY: 1
      };
      if (baked.start) delete baked.start;
      if (baked.end) delete baked.end;
      if (baked.width) delete baked.width;
      if (baked.height) delete baked.height;
      if (baked.pivotX) delete baked.pivotX;
      if (baked.pivotY) delete baked.pivotY;
      return baked;
  };

  const groupShapes = () => {
      if (selectedShapeIndexes.length < 2) return;
      const newFrames = [...frames];
      const currentShapes = [...newFrames[currentFrameIndex]];
      
      // Bake transforms of selected shapes before grouping so they move as one relative to the group
      const selected = selectedShapeIndexes
          .sort((a, b) => b - a)
          .map(idx => bakeTransform(currentShapes.splice(idx, 1)[0]));
      
      const newGroup = {
          type: 'group',
          shapes: selected.reverse(),
          color: selected[0].color,
          scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0, rotationZ: 0
      };

      // Calculate initial pivot at collective center
      const center = getShapeCenter(newGroup);
      newGroup.pivotX = center.x;
      newGroup.pivotY = center.y;

      currentShapes.push(newGroup);
      newFrames[currentFrameIndex] = currentShapes;
      setFrames(newFrames);
      recordHistory(newFrames);
      setSelectedShapeIndexes([currentShapes.length - 1]);
  };

  const ungroupShapes = () => {
      if (selectedShapeIndexes.length !== 1) return;
      const group = shapes[selectedShapeIndexes[0]];
      if (group.type !== 'group') return;
      const newFrames = [...frames];
      const currentShapes = [...newFrames[currentFrameIndex]];
      currentShapes.splice(selectedShapeIndexes[0], 1);
      
      // When ungrouping, we might want to keep the group's transforms? 
      // For now, let's keep it simple: ungrouping results in shapes with group transforms baked in.
      const bakedSubShapes = group.shapes.map(s => {
          // Temporarily apply group transforms to child and bake
          const pts = applyTransformations(getSampledPoints(s), group);
          return {
              ...s,
              points: pts,
              rotationX: 0, rotationY: 0, rotationZ: 0,
              scaleX: 1, scaleY: 1
          };
      });

      currentShapes.push(...bakedSubShapes);
      newFrames[currentFrameIndex] = currentShapes;
      setFrames(newFrames);
      recordHistory(newFrames);
      setSelectedShapeIndexes([]);
  };
  const getDistance = (p1, p2) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

  const hexToRgb = (hex) => { 
      if (hex.startsWith('rgb')) {
          const parts = hex.match(/\d+/g);
          return { r: parseInt(parts[0]), g: parseInt(parts[1]), b: parseInt(parts[2]) };
      }
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); 
      return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 0, g: 0, b: 0 }; 
  };

  const ensureHex = (color) => {
      if (!color) return '#ffffff';
      if (color.startsWith('#')) return color;
      if (color.startsWith('rgb')) {
          const rgb = hexToRgb(color);
          const r = rgb.r.toString(16).padStart(2, '0');
          const g = rgb.g.toString(16).padStart(2, '0');
          const b = rgb.b.toString(16).padStart(2, '0');
          return `#${r}${g}${b}`;
      }
      return '#ffffff';
  };

  const distToSegment = (p, v, w) => {
    const l2 = Math.pow(getDistance(v, w), 2);
    if (l2 === 0) return getDistance(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return getDistance(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
  };

  const isPointInPoly = (p, poly) => {
      let isInside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          if (((poly[i].y > p.y) !== (poly[j].y > p.y)) &&
              (p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)) {
              isInside = !isInside;
          }
      }
      return isInside;
  };

  const getShapeCenter = (shape, includeTransform = false) => {
      if (!shape) return { x: 500, y: 500 };
      if (shape.type === 'rect' && !includeTransform) return { x: shape.start.x + shape.width / 2, y: shape.start.y + shape.height / 2 };
      if ((shape.type === 'circle' || shape.type === 'star') && !includeTransform) return shape.start;
      if (shape.type === 'line' && !includeTransform) return { x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 };
      
      const pts = getShapePoints(shape, includeTransform);
      if (pts.length === 0) return { x: 500, y: 500 };
      const sum = pts.reduce((acc, p) => ({ x: acc.x + (p.x || 0), y: acc.y + (p.y || 0) }), { x: 0, y: 0 });
      return { x: sum.x / pts.length, y: sum.y / pts.length };
  };

  const getPointByPath = (shape, path) => {
      if (!path || !shape) return null;
      const p = Array.isArray(path) ? path : [path];
      if (shape.type === 'group') {
          return getPointByPath(shape.shapes[p[0]], p.slice(1));
      }
      const idx = p[0];
      if (shape.type === 'line') return idx === 0 ? shape.start : shape.end;
      if (shape.type === 'rect') {
          const pts = [
              shape.start, 
              { x: shape.start.x + shape.width, y: shape.start.y },
              { x: shape.start.x + shape.width, y: shape.start.y + shape.height },
              { x: shape.start.x, y: shape.start.y + shape.height }
          ];
          return pts[idx];
      }
      if (shape.type === 'circle' || shape.type === 'star') {
          const pts = [shape.start, { x: shape.end.x, y: shape.start.y }, { x: shape.start.x, y: shape.end.y }];
          return pts[idx];
      }
      return shape.points ? shape.points[idx] : null;
  };

  const getShapePivot = (shape) => {
      if (!shape) return { x: 500, y: 500 };
      if (shape.pivotX !== undefined && shape.pivotY !== undefined) {
          return { x: shape.pivotX, y: shape.pivotY };
      }
      return getShapeCenter(shape);
  };

  const applyTransformations = useCallback((pts, shape) => {
    if (!pts || pts.length === 0 || !shape) return pts;
    
    const pivot = getShapePivot(shape);
    const sX = shape.scaleX ?? 1;
    const sY = shape.scaleY ?? 1;
    const rotX = shape.rotationX || 0;
    const rotY = shape.rotationY || 0;
    const rotZ = shape.rotationZ || shape.rotation || 0;

    if (sX === 1 && sY === 1 && rotX === 0 && rotY === 0 && rotZ === 0) return pts;

    return pts.map(p => {
        let x = p.x - pivot.x;
        let y = p.y - pivot.y;
        let z = p.z || 0;

        // Scale
        x *= sX;
        y *= sY;

        // Rotation Z (2D Rotation)
        if (rotZ !== 0) {
            const nx = x * Math.cos(rotZ) - y * Math.sin(rotZ);
            const ny = x * Math.sin(rotZ) + y * Math.cos(rotZ);
            x = nx; y = ny;
        }

        // Rotation X
        if (rotX !== 0) {
            const ny = y * Math.cos(rotX) - z * Math.sin(rotX);
            const nz = y * Math.sin(rotX) + z * Math.cos(rotX);
            y = ny; z = nz;
        }

        // Rotation Y
        if (rotY !== 0) {
            const nx = x * Math.cos(rotY) + z * Math.sin(rotY);
            const nz = -x * Math.sin(rotY) + z * Math.cos(rotY);
            x = nx; z = nz;
        }

        return { ...p, x: pivot.x + x, y: pivot.y + y, z };
    });
  }, []);

  const getSampledPoints = useCallback((shape) => {
    if (!shape) return [];
    let pts = [];
    if (shape.type === 'pen' || shape.type === 'polygon' || shape.type === 'polyline') pts = shape.points || [];
    else if (shape.type === 'bezier') {
        const points = (shape.points || []).filter(p => !!p);
        if (points.length >= 3) {
            for (let j = 0; j <= points.length - 3; j += 2) {
                const p0 = points[j], cp = points[j+1], p1 = points[j+2];
                if (p0 && cp && p1) {
                    const startIdx = j === 0 ? 0 : 1;
                    for (let i = startIdx; i <= 20; i++) {
                        const t = i / 20, it = 1 - t;
                        pts.push({
                            x: it * it * p0.x + 2 * it * t * cp.x + t * t * p1.x,
                            y: it * it * p0.y + 2 * it * t * cp.y + t * t * p1.y,
                            color: p0.color
                        });
                    }
                }
            }
        } else pts = points;
    }
    else if (shape.type === 'line') pts = [{ x: shape.start.x, y: shape.start.y, color: shape.startColor || shape.color }, { x: shape.end.x, y: shape.end.y, color: shape.endColor || shape.color }];
    else if (shape.type === 'rect') {
        const c = shape.color; const colors = shape.cornerColors || [c, c, c, c];
        pts = [{ x: shape.start.x, y: shape.start.y, color: colors[0] }, { x: shape.start.x + shape.width, y: shape.start.y, color: colors[1] }, { x: shape.start.x + shape.width, y: shape.start.y + shape.height, color: colors[2] }, { x: shape.start.x, y: shape.start.y + shape.height, color: colors[3] }];
    }
    else if (shape.type === 'circle') {
        const rx = Math.abs(shape.end.x - shape.start.x); const ry = Math.abs(shape.end.y - shape.start.y); const c = shape.color;
        for (let i = 0; i <= 32; i++) {
            const angle = (i / 32) * Math.PI * 2;
            pts.push({ x: shape.start.x + Math.cos(angle) * rx, y: shape.start.y + Math.sin(angle) * ry, color: c });
        }
    }
    else if (shape.type === 'star') {
        const rx = Math.abs(shape.end.x - shape.start.x); const ry = Math.abs(shape.end.y - shape.start.y); const c = shape.color;
        const spikes = 5; const outerRadius = rx; const innerRadius = rx / 2.5;
        let rot = Math.PI / 2 * 3; const step = Math.PI / spikes;
        for (let i = 0; i < spikes; i++) {
            pts.push({ x: shape.start.x + Math.cos(rot) * outerRadius, y: shape.start.y + Math.sin(rot) * ry, color: c });
            rot += step;
            pts.push({ x: shape.start.x + Math.cos(rot) * innerRadius, y: shape.start.y + Math.sin(rot) * (ry / 2.5), color: c });
            rot += step;
        }
        pts.push({ ...pts[0] });
    }
    else if (shape.type === 'group') {
        shape.shapes.forEach(s => pts.push(...getSampledPoints(s)));
    }

    return applyTransformations(pts, shape);
  }, [applyTransformations]);

  const getShapePoints = useCallback((shape, includeTransform = true) => {
    if (!shape) return [];
    let pts = [];
    if (shape.type === 'pen' || shape.type === 'polygon' || shape.type === 'polyline' || shape.type === 'bezier') pts = shape.points || [];
    else if (shape.type === 'line') pts = [{ x: shape.start.x, y: shape.start.y, color: shape.startColor || shape.color }, { x: shape.end.x, y: shape.end.y, color: shape.endColor || shape.color }];
    else if (shape.type === 'rect') {
        const c = shape.color; const colors = shape.cornerColors || [c, c, c, c];
        pts = [{ x: shape.start.x, y: shape.start.y, color: colors[0] }, { x: shape.start.x + shape.width, y: shape.start.y, color: colors[1] }, { x: shape.start.x + shape.width, y: shape.start.y + shape.height, color: colors[2] }, { x: shape.start.x, y: shape.start.y + shape.height, color: colors[3] }];
    }
    else if (shape.type === 'circle' || shape.type === 'star') {
        // Return raw control points
        pts = [shape.start, { x: shape.end.x, y: shape.start.y }, { x: shape.start.x, y: shape.end.y }];
    }
    else if (shape.type === 'group') {
        shape.shapes.forEach(s => pts.push(...getShapePoints(s, true)));
    }

    if (!includeTransform) return pts;
    return applyTransformations(pts, shape);
  }, [applyTransformations]);

  const isHit = (shape, mouse, isSelected, pointSelection = [], pathPrefix = []) => {
      if (shape.hidden || shape.locked) return null;
      const threshold = 15 / zoom; 
      const center = getShapeCenter(shape);
      const pivot = getShapePivot(shape);
      
      // High-priority hit test for pivot handle (if selected)
      if (isSelected && getDistance(pivot, mouse) < 15 / zoom) return { type: 'pivot' };

      // High-priority hit test for center handle (if selected)
      if (isSelected && getDistance(center, mouse) < 20 / zoom) return { type: 'shape' };

      // Recursively check for point hits in groups
      if (shape.type === 'group') {
          for (let i = shape.shapes.length - 1; i >= 0; i--) {
              const hit = isHit(shape.shapes[i], mouse, true, pointSelection, [...pathPrefix, i]);
              if (hit && hit.type === 'point') return hit;
          }
      }

      const pts = getShapePoints(shape);
      // Check points (handles) - skip for groups as we handled it above recursively
      if (shape.type !== 'group') {
          const hits = [];
          for (let i = 0; i < pts.length; i++) {
              if (getDistance(pts[i], mouse) < threshold) {
                  hits.push({ type: 'point', index: i, path: [...pathPrefix, i] });
              }
          }
          
          if (hits.length > 0) {
              // Selection Cycling: Prefer first point that is NOT already selected
              const unselected = hits.find(h => !pointSelection.some(sel => JSON.stringify(sel) === JSON.stringify(h.path)));
              return unselected || hits[0];
          }
      }

      // Check shape body/segments using sampled points for curves
      const sampled = getSampledPoints(shape);
      if (shape.type === 'rect') {
          for (let i = 0; i < sampled.length - 1; i++) {
              if (distToSegment(mouse, sampled[i], sampled[i+1]) < threshold) return { type: 'segment', index: i };
          }
          if (isPointInPoly(mouse, sampled)) return { type: 'shape' };
      } else if (shape.type === 'circle' || shape.type === 'star' || shape.type === 'polyline' || shape.type === 'polygon' || shape.type === 'group' || shape.type === 'pen' || shape.type === 'bezier') {
          for (let i = 0; i < sampled.length - 1; i++) {
              if (distToSegment(mouse, sampled[i], sampled[i+1]) < threshold) return { type: 'segment', index: i };
          }
          if (shape.type === 'polygon' && sampled.length > 2) {
              if (distToSegment(mouse, sampled[sampled.length-1], sampled[0]) < threshold) return { type: 'segment', index: sampled.length - 1 };
          }
          if (getDistance(center, mouse) < threshold * 1.5) return { type: 'shape' };
      } else if (shape.type === 'line') {
          if (distToSegment(mouse, sampled[0], sampled[1]) < threshold) return { type: 'segment', index: 0 };
      }
      return null;
  };

  const screenToWorld = useCallback((clientX, clientY) => {
      if (!canvasRef.current) return { x: 500, y: 500 };
      const rect = canvasRef.current.getBoundingClientRect();
      const x = clientX - rect.left; const y = clientY - rect.top;
      return { 
          x: (x - rect.width / 2) / zoom + CANVAS_SIZE / 2 - pan.x, 
          y: (y - rect.height / 2) / zoom + CANVAS_SIZE / 2 - pan.y 
      };
  }, [zoom, pan]);

  const snap = useCallback((x, y, excludePaths = []) => {
      if (!snapToGrid) return { x, y };
      
      const pointSnapThreshold = 10 / zoom;
      let bestPoint = null;
      let minPointDist = pointSnapThreshold;

      // 1. Try snapping to other points
      shapes.forEach((shape, sIdx) => {
          if (shape.hidden) return;
          const pts = getShapePoints(shape);
          pts.forEach((p, pIdx) => {
              const ptPath = [sIdx, pIdx];
              const isExcluded = excludePaths.some(ep => JSON.stringify(ep) === JSON.stringify(ptPath));
              if (isExcluded) return;

              const d = getDistance({ x, y }, p);
              if (d < minPointDist) {
                  minPointDist = d;
                  bestPoint = { x: p.x, y: p.y };
              }
          });
      });

      if (bestPoint) return bestPoint;

      // 2. Fallback to absolute grid snapping
      return {
          x: Math.round(x / gridSize) * gridSize,
          y: Math.round(y / gridSize) * gridSize
      };
  }, [snapToGrid, gridSize, shapes, zoom, getShapePoints]);

  // --- ACTIONS ---
  const handleWheel = (e) => { 
      e.preventDefault(); 
      const factor = Math.pow(1.1, -e.deltaY / 100); 
      setZoom(prev => Math.max(0.1, Math.min(10, prev * factor))); 
  };

  const handleContextMenu = (e) => {
      e.preventDefault();
      if (isDrawing && activeShape) {
          finishMultiPointShape();
          return;
      }
      const mouse = screenToWorld(e.clientX, e.clientY);
      for (let i = shapes.length - 1; i >= 0; i--) {
          const hit = isHit(shapes[i], mouse, selectedShapeIndexes.includes(i), selectedPointIndexes);
          if (hit) {
              setContextMenu({ visible: true, x: e.clientX, y: e.clientY, target: { ...hit, shapeIndex: i, pos: mouse } });
              if (!selectedShapeIndexes.includes(i)) setSelectedShapeIndexes([i]);
              return;
          }
      }
      setContextMenu({ visible: true, x: e.clientX, y: e.clientY, target: { type: 'canvas' } });
  };

  const deletePoint = () => {
      const pointSelection = selectedPointIndexes.length > 0 ? selectedPointIndexes : (contextMenu.target?.type === 'point' ? [contextMenu.target.path || [contextMenu.target.index]] : []);
      if (pointSelection.length === 0) return;

      const newFrames = [...frames];
      const currentShapes = [...newFrames[currentFrameIndex]];
      
      // Group selection by top-level shape index
      const selectionByShape = {};
      pointSelection.forEach(p => {
          const path = Array.isArray(p) ? p : [p];
          if (selectedShapeIndexes.length === 1) {
              const sIdx = selectedShapeIndexes[0];
              if (!selectionByShape[sIdx]) selectionByShape[sIdx] = [];
              selectionByShape[sIdx].push(path);
          } else if (contextMenu.target?.shapeIndex !== undefined) {
              const sIdx = contextMenu.target.shapeIndex;
              if (!selectionByShape[sIdx]) selectionByShape[sIdx] = [];
              selectionByShape[sIdx].push(path);
          }
      });

      const deepDelete = (item, paths) => {
          if (item.type === 'group') {
              item.shapes = item.shapes.map((s, i) => {
                  const subPaths = paths.filter(p => p[0] === i).map(p => p.slice(1));
                  if (subPaths.length > 0) return deepDelete({ ...s }, subPaths);
                  return s;
              }).filter(s => !!s);
              return item.shapes.length > 0 ? item : null;
          } else {
              if (!item.points) return null;
              const indicesToDelete = paths.map(p => p[0]);
              const newPts = item.points.filter((_, i) => !indicesToDelete.includes(i));
              if (newPts.length < 2) return null;
              return { ...item, points: newPts };
          }
      };

      let changed = false;
      Object.keys(selectionByShape).forEach(sIdx => {
          const idx = parseInt(sIdx);
          const result = deepDelete(currentShapes[idx], selectionByShape[sIdx]);
          if (result) {
              currentShapes[idx] = result;
          } else {
              currentShapes.splice(idx, 1);
          }
          changed = true;
      });

      if (changed) {
          newFrames[currentFrameIndex] = currentShapes;
          setFrames(newFrames);
          recordHistory(newFrames);
          setSelectedPointIndexes([]);
      }
      setContextMenu({ visible: false, x: 0, y: 0, target: null });
  };

  const deleteSegment = () => {
      if (!contextMenu.target || contextMenu.target.type !== 'segment') return;
      const { shapeIndex, index: segmentIndex } = contextMenu.target;
      const newFrames = [...frames];
      const currentShapes = [...newFrames[currentFrameIndex]];
      const shape = { ...currentShapes[shapeIndex] };

      if (shape.type === 'line' || shape.type === 'rect' || shape.type === 'circle' || shape.type === 'star') {
          // Primitives: just delete the whole shape
          currentShapes.splice(shapeIndex, 1);
          setSelectedShapeIndexes([]);
      } else if (shape.points) {
          if (shape.type === 'polygon') {
              // Convert polygon to polyline and re-order points to make the deleted segment the "gap"
              const newPts = [];
              for (let i = 0; i < shape.points.length; i++) {
                  newPts.push(shape.points[(segmentIndex + 1 + i) % shape.points.length]);
              }
              shape.points = newPts;
              shape.type = 'polyline';
              currentShapes[shapeIndex] = shape;
          } else if (shape.type === 'polyline' || shape.type === 'pen') {
              // Split polyline into two shapes
              const points1 = shape.points.slice(0, segmentIndex + 1);
              const points2 = shape.points.slice(segmentIndex + 1);
              
              currentShapes.splice(shapeIndex, 1);
              if (points1.length > 1) currentShapes.push({ ...shape, points: points1 });
              if (points2.length > 1) currentShapes.push({ ...shape, points: points2 });
              setSelectedShapeIndexes([]);
          } else if (shape.type === 'bezier') {
              // For bezier, deleting a segment means removing the control point and end point
              const newPts = [...shape.points];
              newPts.splice(segmentIndex, 2); 
              if (newPts.length < 3) {
                  currentShapes.splice(shapeIndex, 1);
              } else {
                  shape.points = newPts;
                  currentShapes[shapeIndex] = shape;
              }
              setSelectedShapeIndexes([]);
          }
      }

      newFrames[currentFrameIndex] = currentShapes;
      setFrames(newFrames);
      recordHistory(newFrames);
      setContextMenu({ visible: false, x: 0, y: 0, target: null });
  };

  const splitSegment = () => {
      if (!contextMenu.target || contextMenu.target.type !== 'segment') return;
      const { shapeIndex, segmentIndex, pos } = contextMenu.target;
      const newFrames = [...frames]; const shape = { ...newFrames[currentFrameIndex][shapeIndex] };
      if (shape.points) {
          const newPts = [...shape.points]; newPts.splice(segmentIndex + 1, 0, { ...pos, color }); shape.points = newPts; newFrames[currentFrameIndex][shapeIndex] = shape;
      } else if (shape.type === 'line') {
          newFrames[currentFrameIndex][shapeIndex] = { type: 'polyline', color: shape.color, renderMode: shape.renderMode, points: [{ x: shape.start.x, y: shape.start.y, color: shape.startColor || shape.color }, { x: pos.x, y: pos.y, color }, { x: shape.end.x, y: shape.end.y, color: shape.endColor || shape.color }], rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1 };
      }
      setFrames(newFrames);
      recordHistory(newFrames);
      setContextMenu({ visible: false, x: 0, y: 0, target: null });
  };

  const convertToPoints = () => {
      if (!contextMenu.target || contextMenu.target.shapeIndex === undefined) return;
      const { shapeIndex } = contextMenu.target;
      const newFrames = [...frames]; const currentShapes = [...newFrames[currentFrameIndex]];
      const shape = currentShapes[shapeIndex];
      
      if (['rect', 'circle', 'star', 'line'].includes(shape.type)) {
          const sampled = getSampledPoints(shape);
          const newShape = {
              type: shape.type === 'line' ? 'polyline' : 'polygon',
              color: shape.color,
              renderMode: shape.renderMode || 'simple',
              points: sampled,
              rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1
          };
          currentShapes[shapeIndex] = newShape;
          newFrames[currentFrameIndex] = currentShapes;
          setFrames(newFrames);
          recordHistory(newFrames);
      }
      setContextMenu({ visible: false, x: 0, y: 0, target: null });
  };

  const resetPivot = () => {
      if (selectedShapeIndexes.length === 0) return;
      const newFrames = [...frames];
      const currentShapes = [...newFrames[currentFrameIndex]];
      selectedShapeIndexes.forEach(idx => {
          const shape = { ...currentShapes[idx] };
          delete shape.pivotX;
          delete shape.pivotY;
          currentShapes[idx] = shape;
      });
      newFrames[currentFrameIndex] = currentShapes;
      setFrames(newFrames);
      recordHistory(newFrames);
      setContextMenu({ visible: false, x: 0, y: 0, target: null });
  };

  const selectOddPoints = () => {
      if (selectedShapeIndexes.length !== 1) return;
      const shape = shapes[selectedShapeIndexes[0]];
      if (!shape || !shape.points) return;
      const newSelection = [];
      for (let i = 1; i < shape.points.length; i += 2) newSelection.push(i);
      setSelectedPointIndexes(newSelection);
  };

  const selectEvenPoints = () => {
      if (selectedShapeIndexes.length !== 1) return;
      const shape = shapes[selectedShapeIndexes[0]];
      if (!shape || !shape.points) return;
      const newSelection = [];
      for (let i = 0; i < shape.points.length; i += 2) newSelection.push(i);
      setSelectedPointIndexes(newSelection);
  };

  const invertPointSelection = () => {
      if (selectedShapeIndexes.length !== 1) return;
      const shape = shapes[selectedShapeIndexes[0]];
      if (!shape || !shape.points) return;
      const newSelection = [];
      for (let i = 0; i < shape.points.length; i++) {
          if (!selectedPointIndexes.includes(i)) newSelection.push(i);
      }
      setSelectedPointIndexes(newSelection);
  };

  const expandPointSelection = () => {
      if (selectedShapeIndexes.length !== 1 || selectedPointIndexes.length === 0) return;
      const shape = shapes[selectedShapeIndexes[0]];
      if (!shape || !shape.points) return;
      const newSelection = new Set(selectedPointIndexes);
      selectedPointIndexes.forEach(idx => {
          if (idx > 0) newSelection.add(idx - 1);
          if (idx < shape.points.length - 1) newSelection.add(idx + 1);
          if (shape.type === 'polygon' || shape.type === 'rect' || shape.type === 'circle' || shape.type === 'star') {
              if (idx === 0) newSelection.add(shape.points.length - 1);
              if (idx === shape.points.length - 1) newSelection.add(0);
          }
      });
      setSelectedPointIndexes(Array.from(newSelection).sort((a,b) => a-b));
  };

  const shrinkPointSelection = () => {
      if (selectedShapeIndexes.length !== 1 || selectedPointIndexes.length === 0) return;
      const shape = shapes[selectedShapeIndexes[0]];
      if (!shape || !shape.points) return;
      const newSelection = selectedPointIndexes.filter(idx => {
          const prev = (idx === 0 && (shape.type === 'polygon' || shape.type === 'rect')) ? shape.points.length - 1 : idx - 1;
          const next = (idx === shape.points.length - 1 && (shape.type === 'polygon' || shape.type === 'rect')) ? 0 : idx + 1;
          return selectedPointIndexes.includes(prev) && selectedPointIndexes.includes(next);
      });
      setSelectedPointIndexes(newSelection);
  };

  const handleImportImage = async () => {
      if (!window.electronAPI) return;
      const path = await window.electronAPI.showOpenDialog({ 
          title: 'Select Background Image', 
          filters: [{ name: 'Images', extensions: ['jpg', 'png', 'png', 'webp', 'bmp'] }], 
          properties: ['openFile'] 
      });
      if (!path) return;
      
      const img = new Image();
      img.onload = () => {
          setBackgroundImage(img);
      };
      img.src = `file://${path}`;
  };

  const joinPoints = () => {
      if (selectedShapeIndexes.length === 0) return;
      
      const newFrames = [...frames];
      const currentShapes = [...newFrames[currentFrameIndex]];
      const JOIN_THRESHOLD = 15 / zoom; // Use a visual threshold
      
      // Helper to ensure a shape is point-based and open (for merging)
      const toOpenPath = (s) => {
          let pts = [];
          if (s.points) {
              pts = [...s.points];
          } else {
              pts = getSampledPoints(s);
          }
          return {
              ...s,
              type: 'polyline',
              points: pts,
              rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1
          };
      };

      if (selectedShapeIndexes.length === 1) {
          // Join within a single shape
          const idx = selectedShapeIndexes[0];
          const shape = { ...currentShapes[idx] };
          
          // Ensure it's point-based
          if (!shape.points) {
              shape.points = getSampledPoints(shape);
              shape.rotationX = 0; shape.rotationY = 0; shape.rotationZ = 0; shape.scaleX = 1; shape.scaleY = 1;
          }

          if (selectedPointIndexes.length === 2) {
              // Connect two specific points by making them the "closing" segment
              const [i1, i2] = [...selectedPointIndexes].sort((a, b) => a - b);
              const newPts = [];
              const len = shape.points.length;
              // Reorder so the gap is between i2 and i1
              for (let i = 0; i < len; i++) {
                  newPts.push(shape.points[(i1 + i) % len]);
              }
              shape.points = newPts;
              shape.type = 'polygon';
          } else {
              // Just close the shape
              shape.type = 'polygon';
          }
          currentShapes[idx] = shape;
      } else {
          // Join multiple shapes
          const sortedSelectedIdxs = [...selectedShapeIndexes].sort((a, b) => b - a);
          const shapesToMerge = sortedSelectedIdxs.map(idx => toOpenPath(currentShapes.splice(idx, 1)[0]));
          
          if (shapesToMerge.length > 0) {
              let merged = shapesToMerge.pop();
              
              while (shapesToMerge.length > 0) {
                  let bestDist = Infinity;
                  let bestIdx = -1;
                  let mergeType = 'end-end'; // 'end-end' or 'mid-insert'
                  let reverseMerged = false;
                  let reverseTarget = false;
                  let insertIndex = -1;

                  const p1Start = merged.points[0];
                  const p1End = merged.points[merged.points.length - 1];

                  shapesToMerge.forEach((s, idx) => {
                      const p2Start = s.points[0];
                      const p2End = s.points[s.points.length - 1];

                      // 1. Check Endpoint to Endpoint
                      const dES = getDistance(p1End, p2Start);
                      const dEE = getDistance(p1End, p2End);
                      const dSS = getDistance(p1Start, p2Start);
                      const dSE = getDistance(p1Start, p2End);

                      if (dES < bestDist) { bestDist = dES; bestIdx = idx; mergeType = 'end-end'; reverseMerged = false; reverseTarget = false; }
                      if (dEE < bestDist) { bestDist = dEE; bestIdx = idx; mergeType = 'end-end'; reverseMerged = false; reverseTarget = true; }
                      if (dSS < bestDist) { bestDist = dSS; bestIdx = idx; mergeType = 'end-end'; reverseMerged = true; reverseTarget = false; }
                      if (dSE < bestDist) { bestDist = dSE; bestIdx = idx; mergeType = 'end-end'; reverseMerged = true; reverseTarget = true; }

                      // 2. Check Endpoint (Target) to Midpoint (Merged) - Only if end-to-end is not super close
                      if (bestDist > JOIN_THRESHOLD) {
                          for (let i = 0; i < merged.points.length; i++) {
                              const p = merged.points[i];
                              const dMidStart = getDistance(p, p2Start);
                              const dMidEnd = getDistance(p, p2End);

                              if (dMidStart < bestDist) { bestDist = dMidStart; bestIdx = idx; mergeType = 'mid-insert'; insertIndex = i; reverseTarget = false; }
                              if (dMidEnd < bestDist) { bestDist = dMidEnd; bestIdx = idx; mergeType = 'mid-insert'; insertIndex = i; reverseTarget = true; }
                          }
                      }
                  });

                  if (bestIdx === -1) break; // Should not happen given logic, but safety

                  const target = shapesToMerge.splice(bestIdx, 1)[0];
                  
                  if (mergeType === 'end-end') {
                      if (reverseMerged) merged.points.reverse();
                      if (reverseTarget) target.points.reverse();
                      merged.points = [...merged.points, ...target.points];
                  } else {
                      // Mid-Insert: Insert target loop into merged at insertIndex
                      // Path: ... -> P_insert -> [Target Shape] -> P_insert -> ...
                      if (reverseTarget) target.points.reverse();
                      
                      // Construct the spur: Target Points + Back to Start of Target (which is at insertIndex)
                      // Ideally, laser goes: ... -> P[i] -> T[0] -> ... -> T[last] -> T[...back?] -> P[i] -> ...
                      // We need to retrace the target shape back to the junction to continue the main path
                      // Simplified: Just insert the target points, then add the junction point again.
                      // ... P[i], T[0], T[1]...T[last], P[i], P[i+1] ...
                      
                      // Note: We need a 'retrace' of the target if it's a dead end line.
                      // If Target is A-B, and we attach A to M. Path: M -> A -> B -> A -> M.
                      // For now, let's just insert: M, T[0]...T[N], T[N-1]...T[0], M (Full retrace)
                      // Or just: M, T[0]...T[N], M. (Jump back? No, laser must draw)
                      
                      // Let's implement full retrace for the inserted segment to ensure continuity
                      const retrace = [...target.points].reverse();
                      // Remove first point of retrace (same as last of target) to avoid double point
                      retrace.shift(); 
                      
                      const spur = [...target.points, ...retrace];
                      
                      // Insert spur at insertIndex + 1
                      const head = merged.points.slice(0, insertIndex + 1);
                      const tail = merged.points.slice(insertIndex + 1);
                      merged.points = [...head, ...spur, ...tail];
                  }
              }
              
              currentShapes.push(merged);
          }
      }

      newFrames[currentFrameIndex] = currentShapes;
      setFrames(newFrames);
      recordHistory(newFrames);
      setSelectedShapeIndexes([currentShapes.length - 1]);
      setSelectedPointIndexes([]);
  };

  const subdividePoints = (points, smooth = false, closed = false) => {
      if (!points || points.length < 2) return points;
      const newPoints = [];
      
      const getPoint = (i) => {
          if (closed) return points[(i + points.length) % points.length];
          return points[Math.max(0, Math.min(points.length - 1, i))];
      };

      for (let i = 0; i < points.length; i++) {
          if (!closed && i === points.length - 1) {
              newPoints.push(points[i]);
              break;
          }

          const p0 = getPoint(i - 1);
          const p1 = getPoint(i);
          const p2 = getPoint(i + 1);
          const p3 = getPoint(i + 2);

          newPoints.push(p1);

          if (smooth) {
              // Catmull-Rom spline interpolation at t=0.5
              // P(t) = 0.5 * ( (2*P1) + (-P0 + P2)*t + (2*P0 - 5*P1 + 4*P2 - P3)*t^2 + (-P0 + 3*P1 - 3*P2 + P3)*t^3 )
              // For t=0.5:
              // P(0.5) = 0.5 * ( 2*P1 + 0.5*(-P0 + P2) + 0.25*(2*P0 - 5*P1 + 4*P2 - P3) + 0.125*(-P0 + 3*P1 - 3*P2 + P3) )
              // Simplified weights:
              // P0: -0.5*0.5 + 0.25*2 - 0.125 = -0.25 + 0.5 - 0.125 = 0.125 ?? No
              // Let's use standard basis functions for Catmull-Rom at t=0.5
              // w0 = -0.5*t^3 + t^2 - 0.5*t
              // w1 = 1.5*t^3 - 2.5*t^2 + 1
              // w2 = -1.5*t^3 + 2*t^2 + 0.5*t
              // w3 = 0.5*t^3 - 0.5*t^2
              
              // t = 0.5:
              // w0 = -0.0625 + 0.25 - 0.25 = -0.0625
              // w1 = 0.1875 - 0.625 + 1 = 0.5625
              // w2 = -0.1875 + 0.5 + 0.25 = 0.5625
              // w3 = 0.0625 - 0.125 = -0.0625
              
              const w0 = -0.0625;
              const w1 = 0.5625;
              const w2 = 0.5625;
              const w3 = -0.0625;
              
              const x = w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x;
              const y = w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y;
              
              // Interpolate color linearly
              const c1 = hexToRgb(p1.color || '#ffffff');
              const c2 = hexToRgb(p2.color || '#ffffff');
              const r = Math.round((c1.r + c2.r) / 2);
              const g = Math.round((c1.g + c2.g) / 2);
              const b = Math.round((c1.b + c2.b) / 2);
              const color = `rgb(${r},${g},${b})`; // Or hex
              
              newPoints.push({ x, y, color: p1.color }); // Simplified color inheritance
          } else {
              // Linear midpoint
              const midX = (p1.x + p2.x) / 2;
              const midY = (p1.y + p2.y) / 2;
              newPoints.push({ x: midX, y: midY, color: p1.color });
          }
      }
      return newPoints;
  };

  const subdivideShape = (smooth = false) => {
      if (selectedShapeIndexes.length === 0) return;
      
      const newFrames = [...frames];
      const currentShapes = [...newFrames[currentFrameIndex]];
      let changed = false;

      // Helper to check if a segment between i and i+1 should be subdivided
      const shouldSubdivideSegment = (i, len, selectedIndices) => {
          if (!selectedIndices || selectedIndices.length === 0) return true; // No selection -> all
          const idx1 = i;
          const idx2 = (i + 1) % len;
          // Check if both points of the segment are selected
          return selectedIndices.includes(idx1) && selectedIndices.includes(idx2);
      };

      selectedShapeIndexes.forEach(idx => {
          const shape = { ...currentShapes[idx] };
          
          // Get selected point indices for this shape
          let selectedIndices = [];
          if (selectedPointIndexes.length > 0) {
              selectedPointIndexes.forEach(p => {
                  const path = Array.isArray(p) ? p : [p];
                  // Assuming top level shape or need recursive check? 
                  // For simple shapes, path is [index].
                  // For now let's handle simple top level shapes.
                  if (path.length === 1) selectedIndices.push(path[0]);
              });
          }

          if (shape.type === 'pen' || shape.type === 'polyline' || shape.type === 'polygon') {
              // Custom subdivision logic based on selection
              if (selectedIndices.length > 0) {
                  const oldPts = shape.points;
                  const newPts = [];
                  const closed = shape.type === 'polygon';
                  const len = oldPts.length;
                  
                  for (let i = 0; i < len; i++) {
                      if (!closed && i === len - 1) {
                          newPts.push(oldPts[i]);
                          break;
                      }
                      
                      newPts.push(oldPts[i]);
                      
                      if (shouldSubdivideSegment(i, len, selectedIndices)) {
                          const p1 = oldPts[i];
                          const p2 = oldPts[(i + 1) % len];
                          
                          if (smooth) {
                              // Catmull-Rom logic for single point insert
                              const getP = (k) => oldPts[(k + len) % len];
                              const p0 = closed ? getP(i - 1) : (i > 0 ? oldPts[i - 1] : p1); 
                              const p3 = closed ? getP(i + 2) : (i < len - 2 ? oldPts[i + 2] : p2);

                              // Same weights as before for t=0.5
                              const w0 = -0.0625, w1 = 0.5625, w2 = 0.5625, w3 = -0.0625;
                              const x = w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x;
                              const y = w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y;
                              newPts.push({ x, y, color: p1.color });
                          } else {
                              const midX = (p1.x + p2.x) / 2;
                              const midY = (p1.y + p2.y) / 2;
                              newPts.push({ x: midX, y: midY, color: p1.color });
                          }
                      }
                  }
                  shape.points = newPts;
                  currentShapes[idx] = shape;
                  changed = true;
              } else {
                  // No specific points selected, subdivide all
                  const closed = shape.type === 'polygon';
                  shape.points = subdividePoints(shape.points, smooth, closed);
                  currentShapes[idx] = shape;
                  changed = true;
              }
          } else if (shape.type === 'circle' || shape.type === 'star' || shape.type === 'rect') {
              // Convert to polygon first
              const sampled = getSampledPoints(shape);
              const newShape = {
                  type: 'polygon',
                  color: shape.color,
                  renderMode: shape.renderMode,
                  points: subdividePoints(sampled, smooth, true), 
                  rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1
              };
              currentShapes[idx] = newShape;
              changed = true;
          }
      });

      if (changed) {
          newFrames[currentFrameIndex] = currentShapes;
          setFrames(newFrames);
          recordHistory(newFrames);
      }
  };

  const decimateShape = () => {
      if (selectedShapeIndexes.length === 0) return;
      const newFrames = [...frames];
      const currentShapes = [...newFrames[currentFrameIndex]];
      let changed = false;

      selectedShapeIndexes.forEach(idx => {
          const shape = { ...currentShapes[idx] };
          
          // Get selected point indices for this shape
          let selectedIndices = [];
          if (selectedPointIndexes.length > 0) {
              selectedPointIndexes.forEach(p => {
                  const path = Array.isArray(p) ? p : [p];
                  if (path.length === 1) selectedIndices.push(path[0]);
              });
          }

          if (shape.type === 'pen' || shape.type === 'polyline' || shape.type === 'polygon') {
              if (selectedIndices.length > 0) {
                  // Sort to ensure alternating logic works
                  selectedIndices.sort((a, b) => a - b);
                  // Decimate selection: remove every 2nd point AMONG the selected ones
                  const toRemove = selectedIndices.filter((_, i) => i % 2 === 1);
                  
                  if (shape.points.length - toRemove.length >= 2) {
                      shape.points = shape.points.filter((_, i) => !toRemove.includes(i));
                      currentShapes[idx] = shape;
                      changed = true;
                  }
              } else if (shape.points.length > 2) {
                  shape.points = shape.points.filter((_, i) => i % 2 === 0);
                  currentShapes[idx] = shape;
                  changed = true;
              }
          } else if (shape.type === 'circle' || shape.type === 'star' || shape.type === 'rect') {
              const sampled = getSampledPoints(shape);
              let newPoints = [];
              
              if (selectedIndices.length > 0) {
                  selectedIndices.sort((a, b) => a - b);
                  const toRemove = selectedIndices.filter((_, i) => i % 2 === 1);
                  newPoints = sampled.filter((_, i) => !toRemove.includes(i));
              } else {
                  newPoints = sampled.filter((_, i) => i % 2 === 0);
              }

              if (newPoints.length >= 2) {
                  const newShape = {
                      type: 'polygon',
                      color: shape.color,
                      renderMode: shape.renderMode,
                      points: newPoints,
                      rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1
                  };
                  currentShapes[idx] = newShape;
                  changed = true;
              }
          }
      });

      if (changed) {
          newFrames[currentFrameIndex] = currentShapes;
          setFrames(newFrames);
          recordHistory(newFrames);
          if (selectedPointIndexes.length > 0) setSelectedPointIndexes([]);
      }
  };

  const mergePointsInShape = () => {
      if (selectedShapeIndexes.length === 0) return;
      const newFrames = [...frames];
      const currentShapes = [...newFrames[currentFrameIndex]];
      let changed = false;
      const threshold = 0.5; // Distance threshold for merging

      selectedShapeIndexes.forEach(idx => {
          const shape = { ...currentShapes[idx] };
          let pts = [];
          
          if (shape.type === 'pen' || shape.type === 'polyline' || shape.type === 'polygon') {
              pts = shape.points;
          } else if (shape.type === 'circle' || shape.type === 'star' || shape.type === 'rect') {
              pts = getSampledPoints(shape);
              shape.type = 'polygon';
              shape.rotationX = 0; shape.rotationY = 0; shape.rotationZ = 0; shape.scaleX = 1; shape.scaleY = 1;
          }

          // Get selected indices
          let selectedIndices = [];
          if (selectedPointIndexes.length > 0) {
              selectedPointIndexes.forEach(p => {
                  const path = Array.isArray(p) ? p : [p];
                  if (path.length === 1) selectedIndices.push(path[0]);
              });
          }

          if (pts.length > 1) {
              const merged = [pts[0]];
              for (let i = 1; i < pts.length; i++) {
                  // If selection is active, ONLY merge if the current point is selected
                  // If no selection, merge everything
                  const isCandidate = selectedIndices.length === 0 || selectedIndices.includes(i);
                  
                  if (!isCandidate) {
                      merged.push(pts[i]);
                  } else {
                      if (getDistance(pts[i], merged[merged.length - 1]) > threshold) {
                          merged.push(pts[i]);
                      }
                  }
              }
              // Check last vs first if closed
              if (shape.type === 'polygon' && merged.length > 2) {
                  // Only merge last point if it is a candidate
                  const isLastCandidate = selectedIndices.length === 0 || selectedIndices.includes(pts.length - 1); // Mapping might be off if we removed points, but we use original index logic conceptually. 
                  // Actually, 'merged' contains new points. We should check if the LAST point in 'merged' is close to FIRST.
                  // And we only remove it if it was originally selected? That's hard to track.
                  // Simplified: Just check distance.
                  if (getDistance(merged[merged.length - 1], merged[0]) < threshold) {
                      // Remove last point if we are allowed to
                      if (selectedIndices.length === 0) {
                          merged.pop();
                      } else {
                          // Check if the original point corresponding to this last point was selected
                          // This is complex because 'i' is gone.
                          // Let's just allow it for now or skip. 
                          // Better: Re-run strict selection check?
                          // Let's just pop it. Merging start/end is usually desired.
                          merged.pop();
                      }
                  }
              }
              
              if (merged.length !== pts.length) {
                  shape.points = merged;
                  currentShapes[idx] = shape;
                  changed = true;
              }
          }
      });

      if (changed) {
          newFrames[currentFrameIndex] = currentShapes;
          setFrames(newFrames);
          recordHistory(newFrames);
          if (selectedPointIndexes.length > 0) setSelectedPointIndexes([]);
      }
  };

  const addCornerPoints = () => {
      if (selectedShapeIndexes.length === 0) return;
      const newFrames = [...frames];
      const currentShapes = [...newFrames[currentFrameIndex]];
      let changed = false;
      const thresholdAngle = 150 * (Math.PI / 180); // 150 degrees in radians

      const getAngle = (p1, p2, p3) => {
          const a = Math.atan2(p1.y - p2.y, p1.x - p2.x);
          const b = Math.atan2(p3.y - p2.y, p3.x - p2.x);
          let diff = Math.abs(a - b);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          return diff; // Returns angle in radians (0 to PI)
      };

      selectedShapeIndexes.forEach(idx => {
          const shape = { ...currentShapes[idx] };
          let pts = [];
          
          if (shape.type === 'pen' || shape.type === 'polyline' || shape.type === 'polygon') {
              pts = shape.points;
          } else if (shape.type === 'circle' || shape.type === 'star' || shape.type === 'rect') {
              pts = getSampledPoints(shape);
              shape.type = 'polygon';
              shape.rotationX = 0; shape.rotationY = 0; shape.rotationZ = 0; shape.scaleX = 1; shape.scaleY = 1;
          }

          // Get selected indices
          let selectedIndices = [];
          if (selectedPointIndexes.length > 0) {
              selectedPointIndexes.forEach(p => {
                  const path = Array.isArray(p) ? p : [p];
                  if (path.length === 1) selectedIndices.push(path[0]);
              });
          }

          if (pts.length > 2) {
              const newPts = [];
              const closed = shape.type === 'polygon' || shape.type === 'rect' || shape.type === 'circle' || shape.type === 'star';
              
              for (let i = 0; i < pts.length; i++) {
                  newPts.push(pts[i]);
                  
                  // If selection is active, only check this vertex if selected
                  if (selectedIndices.length > 0 && !selectedIndices.includes(i)) continue;

                  // Calculate angle
                  let pPrev, pNext;
                  if (i === 0) {
                      if (closed) pPrev = pts[pts.length - 1];
                      else continue; // Open path start has no angle
                  } else {
                      pPrev = pts[i - 1];
                  }
                  
                  if (i === pts.length - 1) {
                      if (closed) pNext = pts[0];
                      else continue; // Open path end has no angle
                  } else {
                      pNext = pts[i + 1];
                  }

                  const angle = getAngle(pPrev, pts[i], pNext);
                  // Check if angle is sharp (smaller means sharper turn)
                  // Straight line is PI (180). Sharp turn is < threshold.
                  if (angle < thresholdAngle) {
                      // Add duplicate point for dwell
                      newPts.push({ ...pts[i] });
                  }
              }
              
              if (newPts.length !== pts.length) {
                  shape.points = newPts;
                  currentShapes[idx] = shape;
                  changed = true;
              }
          }
      });

      if (changed) {
          newFrames[currentFrameIndex] = currentShapes;
          setFrames(newFrames);
          recordHistory(newFrames);
      }
      setContextMenu({ visible: false, x: 0, y: 0, target: null });
  };

  const importClip = async () => {
      if (!window.electronAPI) return;
      const path = await window.electronAPI.showOpenDialog({ title: 'Import ILDA', filters: [{ name: 'ILDA Files', extensions: ['ild'] }], properties: ['openFile'] });
      if (!path) return; setIsLoading(true);
      try {
          const buffer = await window.electronAPI.readFileAsBinary(path); const { frames: parsedFrames } = parseIldaFile(buffer);
          if (parsedFrames && parsedFrames.length > 0) {
              const newFrames = parsedFrames.map(pf => {
                  const shapesInFrame = []; let currentPath = [];
                  pf.points.forEach(p => {
                      const cx = (p.x * 500) + 500, cy = ((1 - p.y) * 500); const col = `rgb(${p.r},${p.g},${p.b})`;
                      if (p.blanking) { 
                          if (currentPath.length > 1) {
                              const pStart = currentPath[0];
                              // Check if THIS blanked point is at the same position as the start
                              const distToStart = Math.sqrt(Math.pow(pStart.x - cx, 2) + Math.pow(pStart.y - cy, 2));
                              
                              if (distToStart < 2) { 
                                  shapesInFrame.push({ type: 'polygon', points: currentPath, color: currentPath[0].color, renderMode: 'simple', rotation: 0 });
                              } else {
                                  shapesInFrame.push({ type: 'polyline', points: currentPath, color: currentPath[0].color, renderMode: 'simple', rotation: 0 });
                              }
                          }
                          currentPath = []; 
                      }
                      else currentPath.push({ x: cx, y: cy, color: col });
                  });
                  if (currentPath.length > 1) {
                      const pStart = currentPath[0];
                      const pEnd = currentPath[currentPath.length - 1];
                      const dist = Math.sqrt(Math.pow(pStart.x - pEnd.x, 2) + Math.pow(pStart.y - pEnd.y, 2));
                      if (dist < 2) {
                          shapesInFrame.push({ type: 'polygon', points: currentPath, color: currentPath[0].color, renderMode: 'simple', rotation: 0 });
                      } else {
                          shapesInFrame.push({ type: 'polyline', points: currentPath, color: currentPath[0].color, renderMode: 'simple', rotation: 0 });
                      }
                  }
                  return shapesInFrame;
              });
              setFrames(newFrames);
              recordHistory(newFrames);
              setFrameCount(newFrames.length); setCurrentFrameIndex(0);
          }
      } catch (e) { console.error(e); } finally { setIsLoading(false); }
  };

  const drawStarPath = (ctx, shape) => {
      const center = getShapeCenter(shape);
      const rx = Math.abs(shape.end.x - shape.start.x);
      const ry = Math.abs(shape.end.y - shape.start.y);
      const spikes = 5;
      const outerRadius = rx;
      const innerRadius = rx / 2.5;
      let rot = Math.PI / 2 * 3;
      const step = Math.PI / spikes;
      ctx.moveTo(center.x, center.y - outerRadius);
      for (let i = 0; i < spikes; i++) {
          ctx.lineTo(center.x + Math.cos(rot) * outerRadius, center.y + Math.sin(rot) * ry);
          rot += step;
          ctx.lineTo(center.x + Math.cos(rot) * innerRadius, center.y + Math.sin(rot) * (ry / 2.5));
          rot += step;
      }
      ctx.lineTo(center.x, center.y - outerRadius);
  };

  const importSVG = async () => {
      if (!window.electronAPI) return;
      const path = await window.electronAPI.showOpenDialog({ title: 'Import SVG', filters: [{ name: 'SVG Files', extensions: ['svg'] }], properties: ['openFile'] });
      if (!path) return; setIsLoading(true);
      try {
          const content = await window.electronAPI.readFileContent(path);
          const parser = new DOMParser(); 
          const svgText = new TextDecoder().decode(content);
          const doc = parser.parseFromString(svgText, 'image/svg+xml');
          const svgEl = doc.querySelector('svg');
          if (!svgEl) throw new Error('Invalid SVG');

          // Try to get viewBox or width/height for scaling
          let viewBox = svgEl.getAttribute('viewBox')?.split(/[\s,]+/).map(parseFloat);
          if (!viewBox || viewBox.length !== 4) {
              const w = parseFloat(svgEl.getAttribute('width')) || 1000;
              const h = parseFloat(svgEl.getAttribute('height')) || 1000;
              viewBox = [0, 0, w, h];
          }

          const [vbX, vbY, vbW, vbH] = viewBox;
          const scale = Math.min(CANVAS_SIZE / vbW, CANVAS_SIZE / vbH) * 0.8;
          const offsetX = (CANVAS_SIZE - vbW * scale) / 2 - vbX * scale;
          const offsetY = (CANVAS_SIZE - vbH * scale) / 2 - vbY * scale;

          const newShapes = [];
          
          // Temporary hidden SVG to use browser's path API
          const tempContainer = document.createElement('div');
          tempContainer.style.display = 'none';
          tempContainer.innerHTML = svgText;
          document.body.appendChild(tempContainer);
          const svgInDom = tempContainer.querySelector('svg');

          const processElement = (el, parentTransform = new DOMMatrix()) => {
              let pathStr = '';
              const tag = el.tagName.toLowerCase();
              let localTransform = new DOMMatrix(el.getAttribute('transform') || '');
              const combinedTransform = parentTransform.multiply(localTransform);

              if (tag === 'g') {
                  Array.from(el.children).forEach(child => processElement(child, combinedTransform));
                  return;
              }

              if (tag === 'path') pathStr = el.getAttribute('d');
              else if (tag === 'rect') {
                  const x = parseFloat(el.getAttribute('x')) || 0, y = parseFloat(el.getAttribute('y')) || 0;
                  const w = parseFloat(el.getAttribute('width')) || 0, h = parseFloat(el.getAttribute('height')) || 0;
                  pathStr = `M${x},${y} h${w} v${h} h${-w} z`;
              } else if (tag === 'circle' || tag === 'ellipse') {
                  const cx = parseFloat(el.getAttribute('cx')) || 0, cy = parseFloat(el.getAttribute('cy')) || 0;
                  const rx = parseFloat(el.getAttribute('rx')) || parseFloat(el.getAttribute('r')) || 0;
                  const ry = parseFloat(el.getAttribute('ry')) || parseFloat(el.getAttribute('r')) || 0;
                  pathStr = `M${cx-rx},${cy} a${rx},${ry} 0 1,0 ${rx*2},0 a${rx},${ry} 0 1,0 ${-rx*2},0 z`;
              } else if (tag === 'line') {
                  pathStr = `M${el.getAttribute('x1')},${el.getAttribute('y1')} L${el.getAttribute('x2')},${el.getAttribute('y2')}`;
              } else if (tag === 'polyline' || tag === 'polygon') {
                  pathStr = `M${el.getAttribute('points')}${tag === 'polygon' ? ' z' : ''}`;
              }

              if (!pathStr) return;

              const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              pathEl.setAttribute('d', pathStr);
              svgInDom.appendChild(pathEl);

              const length = pathEl.getTotalLength();
              if (length > 0) {
                  const pts = [];
                  const visualLength = length * scale * Math.max(combinedTransform.a, combinedTransform.d);
                  const steps = Math.min(1000, Math.max(10, Math.floor(visualLength / 5)));
                  
                  for (let i = 0; i <= steps; i++) {
                      const p = pathEl.getPointAtLength((i / steps) * length);
                      const tp = new DOMPoint(p.x, p.y).matrixTransform(combinedTransform);
                      pts.push({ x: tp.x * scale + offsetX, y: tp.y * scale + offsetY, color });
                  }
                  newShapes.push({ type: 'polyline', points: pts, color, renderMode: 'simple', rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1 });
              }
          };

          Array.from(svgEl.children).forEach(el => processElement(el));
          document.body.removeChild(tempContainer);

          if (newShapes.length > 0) {
              const newFrames = [...frames];
              newFrames[currentFrameIndex] = [...(newFrames[currentFrameIndex] || []), ...newShapes];
              setFrames(newFrames);
              recordHistory(newFrames);
          }
      } catch (e) { 
          console.error('SVG Import Error:', e); 
          alert('Error importing SVG: ' + e.message);
      } finally { 
          setIsLoading(false); 
      }
  };

  const clearAll = () => {
    if (confirm('Clear all shapes in this frame?')) {
        const newFrames = [...frames];
        newFrames[currentFrameIndex] = [];
        setFrames(newFrames);
        recordHistory(newFrames);
        setSelectedShapeIndexes([]); setSelectedPointIndexes([]);
    }
  };

  const copyShape = () => { 
      if (selectedShapeIndexes.length === 0) return; 
      
      let dataToCopy;
      if (selectedPointIndexes.length > 0 && selectedShapeIndexes.length === 1) {
          const sourceShape = shapes[selectedShapeIndexes[0]];
          const allPts = getShapePoints(sourceShape);
          const copiedPts = selectedPointIndexes.map(idx => ({ ...allPts[idx] }));
          dataToCopy = { type: 'polyline', points: copiedPts, color: sourceShape.color, renderMode: sourceShape.renderMode || 'simple', rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1 };
      } else {
          dataToCopy = selectedShapeIndexes.map(idx => JSON.parse(JSON.stringify(shapes[idx])));
      }

      setShapeClipboard({ data: dataToCopy, sourceFrameIndex: currentFrameIndex }); 
      setContextMenu({visible:false}); 
  };

  const pasteShape = () => { 
      if (!shapeClipboard) return; 
      const { data } = shapeClipboard;
      const newItems = Array.isArray(data) ? JSON.parse(JSON.stringify(data)) : [JSON.parse(JSON.stringify(data))];
      
      const newFrames = [...frames]; 
      const ns = [...(newFrames[currentFrameIndex] || [])]; 
      
      newItems.forEach(s => {
          ns.push(s);
      });

      newFrames[currentFrameIndex] = ns; 
      setFrames(newFrames); 
      recordHistory(newFrames); 
      
      setSelectedShapeIndexes(newItems.map((_, i) => ns.length - newItems.length + i)); 
      setSelectedPointIndexes([]);
      setContextMenu({visible:false}); 
  };
  const duplicateFrame = () => { const nf = [...frames]; nf.splice(currentFrameIndex + 1, 0, JSON.parse(JSON.stringify(frames[currentFrameIndex]))); setFrames(nf); recordHistory(nf); setFrameCount(prev => prev + 1); setCurrentFrameIndex(prev => prev + 1); };
  const undo = () => {
      if (historyStep > 0 && history[historyStep - 1]) {
          const prevStep = historyStep - 1;
          setHistoryStep(prevStep);
          setFrames(JSON.parse(JSON.stringify(history[prevStep])));
      }
  };
  const redo = () => {
      if (historyStep < history.length - 1 && history[historyStep + 1]) {
          const nextStep = historyStep + 1;
          setHistoryStep(nextStep);
          setFrames(JSON.parse(JSON.stringify(history[nextStep])));
      }
  };
  const updateSelectedShape = (props) => { 
      if (selectedShapeIndexes.length === 0) return; 
      
      const applyPropsToShape = (shape, properties) => {
          let updated = { ...shape, ...properties };
          
          if (properties.color) {
              if (updated.points) updated.points = updated.points.map(p => ({ ...p, color: properties.color }));
              if (updated.startColor) updated.startColor = properties.color;
              if (updated.endColor) updated.endColor = properties.color;
              if (updated.cornerColors) updated.cornerColors = updated.cornerColors.map(() => properties.color);
              if (updated.centerColor) updated.centerColor = properties.color;
              if (updated.outerColor) updated.outerColor = properties.color;
          }

          if (updated.type === 'group' && updated.shapes) {
              updated.shapes = updated.shapes.map(s => applyPropsToShape(s, properties));
          }
          
          return updated;
      };

      setFrames(prev => {
          const newFrames = [...prev]; 
          const ns = [...newFrames[currentFrameIndex]]; 
          selectedShapeIndexes.forEach(idx => {
              if (!ns[idx]) return;
              ns[idx] = applyPropsToShape(ns[idx], props);
          });
          newFrames[currentFrameIndex] = ns; 
          return newFrames;
      });
      // recordHistory will be called by useEffect or manually after the state is settled
      // But for simple property changes, we should record it.
      setTimeout(() => {
          setFrames(f => { recordHistory(f); return f; });
      }, 0);
  };

  const updatePointColor = (c) => { 
      if (selectedShapeIndexes.length !== 1 || selectedPointIndexes.length === 0) return; 
      setFrames(prev => {
          const newFrames = [...prev]; 
          const ns = [...newFrames[currentFrameIndex]];
          const idx = selectedShapeIndexes[0];
          if (!ns[idx]) return prev;
          
          let s = { ...ns[idx] }; 
          selectedPointIndexes.forEach(pData => {
              const path = Array.isArray(pData) ? pData : [pData];
              
              const deepColorUpdate = (item, ptPath, color) => {
                  if (ptPath.length === 1) {
                      const pIdx = ptPath[0];
                      const updated = { ...item };
                      if (updated.points) {
                          updated.points = [...updated.points];
                          updated.points[pIdx] = { ...updated.points[pIdx], color };
                      } else if (updated.type === 'line') {
                          if (pIdx === 0) updated.startColor = color;
                          else updated.endColor = color;
                      } else if (updated.type === 'rect') {
                          updated.cornerColors = [...(updated.cornerColors || [updated.color, updated.color, updated.color, updated.color])];
                          updated.cornerColors[pIdx] = color;
                      } else if (updated.type === 'circle' || updated.type === 'star') {
                          if (pIdx === 0) updated.centerColor = color;
                          else updated.outerColor = color;
                      }
                      return updated;
                  } else {
                      const [currIdx, ...rest] = ptPath;
                      const updated = { ...item };
                      updated.shapes = [...updated.shapes];
                      updated.shapes[currIdx] = deepColorUpdate(updated.shapes[currIdx], rest, color);
                      return updated;
                  }
              };
              
              s = deepColorUpdate(s, path, c);
          }); 
          
          ns[idx] = s; 
          newFrames[currentFrameIndex] = ns; 
          return newFrames;
      });
      
      setTimeout(() => {
          setFrames(f => { recordHistory(f); return f; });
      }, 0);
  };

  const saveAsClip = async () => {
      if (frames.every(f => f.length === 0)) return; setIsExporting(true);
      try {
          const ildaFramesData = frames.map(frameShapes => {
              const pts = []; 
              frameShapes.forEach((s, shapeIdx) => {
                  const mode = s.renderMode || 'simple';
                  const sampledPts = getSampledPoints(s);
                  const process = (p) => ({ ...p, x: (p.x - 500) / 500, y: (1 - p.y / 500) });
                  const processed = sampledPts.map(process);
                  
                  if (processed.length < 2) return;

                  const shapePts = [];
                  for (let i = 0; i < processed.length - 1; i++) {
                      let segmentMode = mode;
                      if (mode === 'dashed' && i % 2 === 1) segmentMode = 'blanked';

                      const segmentPoints = interpolatePoints(processed[i], processed[i+1], segmentMode);
                      
                      // Add all points except the last one of the segment, unless it's the last segment
                      if (i < processed.length - 2) {
                          shapePts.push(...segmentPoints.slice(0, -1));
                      } else {
                          shapePts.push(...segmentPoints);
                      }
                  }

                  if (s.type === 'polygon' || s.type === 'rect' || s.type === 'circle' || s.type === 'star') {
                      // Close the shape
                      let segmentMode = mode;
                      if (mode === 'dashed' && (processed.length - 1) % 2 === 1) segmentMode = 'blanked';

                      const closingPoints = interpolatePoints(processed[processed.length-1], processed[0], segmentMode);
                      if (closingPoints.length > 1) {
                          shapePts.push(...closingPoints.slice(1));
                      }
                  }

                  // Add shape points to the main list
                  if (shapePts.length > 0) {
                      // Add a blanked move-to point at the start of each shape to jump to it
                      pts.push({ ...shapePts[0], blanking: true });
                      pts.push(...shapePts);
                  }
              }); 
              return { points: pts, frameName: 'SHAPE' };
          });
          const buffer = framesToIlda(ildaFramesData); await window.electronAPI.saveIldaFile(buffer, 'built_shape.ild');
      } catch (e) { console.error(e); } finally { setIsExporting(false); }
  };

  const interpolatePoints = (p1, p2, mode) => {
      const c1 = hexToRgb(p1.color || color), c2 = hexToRgb(p2.color || color);
      
      if (mode === 'dotted') {
          return [
              { x: p1.x, y: p1.y, r: c1.r, g: c1.g, b: c1.b, blanking: false },
              { x: p1.x, y: p1.y, r: c1.r, g: c1.g, b: c1.b, blanking: false }
          ];
      }

      const isBlanked = mode === 'blanked';
      
      // Return just the start and end points, creating a single vector segment.
      // No extra points are added between p1 and p2.
      return [
          { x: p1.x, y: p1.y, r: c1.r, g: c1.g, b: c1.b, blanking: isBlanked },
          { x: p2.x, y: p2.y, r: c2.r, g: c2.g, b: c2.b, blanking: isBlanked }
      ];
  };

  const finishMultiPointShape = () => {
      if (activeShape && (activeShape.type === 'polygon' || activeShape.type === 'polyline' || activeShape.type === 'bezier')) {
          let finalShape = { ...activeShape };
          if (activeShape.type === 'polygon' || activeShape.type === 'polyline') {
              finalShape.points = activeShape.points.slice(0, -1);
          } else if (activeShape.type === 'bezier' && continuousDrawing) {
              // For bezier, we added 2 points on each click. The last segment might be incomplete (just dragging).
              // Actually startDrawing adds 2 points, and draw() updates them.
              // If we want to "finish" it, we keep the points as they are since they are already valid.
          }
          
          if (finalShape.points.length > 1) { 
              const newFrames = [...frames];
              newFrames[currentFrameIndex] = [...(newFrames[currentFrameIndex] || []), finalShape];
              setFrames(newFrames);
              recordHistory(newFrames);
              setSelectedShapeIndexes([newFrames[currentFrameIndex].length - 1]); 
          }
      }
      setIsDrawing(false); setActiveShape(null);
  };

  const startDrawing = (e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) { isPanningRef.current = true; startPosRef.current = { x: e.clientX, y: e.clientY }; return; }
    if (e.button !== 0) return; // Only respond to left-clicks for drawing and selection
    
    const mouse = screenToWorld(e.clientX, e.clientY); 
    const snapped = snap(mouse.x, mouse.y);
    const sx = snapped.x, sy = snapped.y;
    setContextMenu({ visible: false });
    if (tool === 'select') {
        let hitIdx = -1;
        let bestHit = null;

        for (let i = shapes.length - 1; i >= 0; i--) {
            const hit = isHit(shapes[i], mouse, selectedShapeIndexes.includes(i), selectedPointIndexes);
            if (hit) {
                hitIdx = i;
                bestHit = hit;
                break;
            }
        }

        if (bestHit) {
            if (bestHit.type === 'point') {
                const ptPath = bestHit.path || [bestHit.index];
                if (!e.shiftKey) {
                    // Clicking a point without shift: Select ONLY this point
                    setSelectedPointIndexes([ptPath]);
                    setSelectedShapeIndexes([hitIdx]);
                } else {
                    // Shift+Click: Toggle point in selection
                    if (selectedShapeIndexes.includes(hitIdx)) {
                        setSelectedPointIndexes(prev => {
                            const isSelected = prev.some(p => JSON.stringify(p) === JSON.stringify(ptPath));
                            if (isSelected) {
                                return prev.filter(p => JSON.stringify(p) !== JSON.stringify(ptPath));
                            } else {
                                return [...prev, ptPath];
                            }
                        });
                    } else {
                        // Different shape: select new shape and this point
                        setSelectedShapeIndexes([hitIdx]);
                        setSelectedPointIndexes([ptPath]);
                    }
                }
                isMovingPointRef.current = true;
            } else if (bestHit.type === 'pivot') {
                isMovingPivotRef.current = true;
            } else {
                if (!e.shiftKey && !selectedShapeIndexes.includes(hitIdx)) setSelectedShapeIndexes([hitIdx]);
                else if (e.shiftKey) setSelectedShapeIndexes(prev => prev.includes(hitIdx) ? prev.filter(i => i !== hitIdx) : [...prev, hitIdx]);
                isMovingShapeRef.current = true;
            }
            startPosRef.current = mouse;
        } else {
            isSelectingBoxRef.current = true;
            startPosRef.current = mouse;
            selectionBoxRef.current = { x: mouse.x, y: mouse.y, w: 0, h: 0 };
        }
        return;
    }
    setIsDrawing(true); startPosRef.current = mouse;
    if (tool === 'polygon' || (tool === 'polyline') || ((tool === 'line' || tool === 'bezier') && continuousDrawing)) {
        if (!activeShape) {
            if (tool === 'bezier') {
                setActiveShape({ type: 'bezier', color, renderMode, points: [{ x: sx, y: sy, color }, { x: sx, y: sy, color }, { x: sx, y: sy, color }], rotation: 0 });
            } else {
                setActiveShape({ type: tool === 'polygon' ? 'polygon' : 'polyline', color, renderMode, points: [{ x: sx, y: sy, color }, { x: sx, y: sy, color }], rotation: 0 });
            }
        } else {
            if (tool === 'bezier') {
                // For continuous bezier, we add a control point and a new end point.
                // The current last point becomes the start of the next segment.
                setActiveShape(prev => ({ ...prev, points: [...prev.points, { x: sx, y: sy, color }, { x: sx, y: sy, color }] }));
            } else {
                setActiveShape(prev => ({ ...prev, points: [...prev.points, { x: sx, y: sy, color }] }));
            }
        }
    } else {
        const newShape = { type: tool, color, renderMode, start: { x: sx, y: sy }, end: { x: sx, y: sy }, width: 0, height: 0, rotation: 0, scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0, rotationZ: 0 };
        if (tool === 'pen') newShape.points = [{ x: sx, y: sy, color }, { x: sx, y: sy, color }];
        else if (tool === 'bezier') newShape.points = [{ x: sx, y: sy, color }, { x: sx, y: sy, color }, { x: sx, y: sy, color }];
        setActiveShape(newShape);
    }
  };

  const moveShape = useCallback((shape, dx, dy) => {
      const updated = { ...shape };
      if (shape.type === 'group') {
          updated.shapes = shape.shapes.map(s => moveShape(s, dx, dy));
      } else {
          if (shape.points) updated.points = shape.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
          if (shape.start) updated.start = { ...shape.start, x: shape.start.x + dx, y: shape.start.y + dy };
          if (shape.end) updated.end = { ...shape.end, x: shape.end.x + dx, y: shape.end.y + dy };
      }
      
      if (shape.pivotX !== undefined) updated.pivotX = shape.pivotX + dx;
      if (shape.pivotY !== undefined) updated.pivotY = shape.pivotY + dy;
      
      return updated;
  }, []);

  const draw = (e) => {
    const mouse = screenToWorld(e.clientX, e.clientY);
    if (isPanningRef.current) { const dx = (e.clientX - startPosRef.current.x) / zoom, dy = (e.clientY - startPosRef.current.y) / zoom; setPan(prev => ({ x: prev.x + dx, y: prev.y + dy })); startPosRef.current = { x: e.clientX, y: e.clientY }; return; }
    if (isRotatingRef.current && selectedShapeIndexes.length > 0) { 
        const pivot = getShapePivot(shapes[selectedShapeIndexes[0]]); 
        updateSelectedShape({ rotationZ: Math.atan2(mouse.y - pivot.y, mouse.x - pivot.x) + Math.PI / 2 }); 
        return; 
    }
    if (isSelectingBoxRef.current) { 
        selectionBoxRef.current = { x: Math.min(startPosRef.current.x, mouse.x), y: Math.min(startPosRef.current.y, mouse.y), w: Math.abs(mouse.x - startPosRef.current.x), h: Math.abs(mouse.y - startPosRef.current.y) }; 
        setRenderTrigger(prev => prev + 1);
        return; 
    }
    
    if (isMovingShapeRef.current) {
        const dx = mouse.x - startPosRef.current.x, dy = mouse.y - startPosRef.current.y;
        
        // Use first selected shape's center as snap reference
        const refShape = shapes[selectedShapeIndexes[0]];
        const center = getShapeCenter(refShape);
        const snappedTarget = snap(center.x + dx, center.y + dy);
        const actualDx = snappedTarget.x - center.x;
        const actualDy = snappedTarget.y - center.y;

        if (actualDx !== 0 || actualDy !== 0) {
            setFrames(prev => {
                const newFrames = [...prev];
                const ns = [...newFrames[currentFrameIndex]];
                selectedShapeIndexes.forEach(idx => {
                    ns[idx] = moveShape({ ...ns[idx] }, actualDx, actualDy);
                });
                newFrames[currentFrameIndex] = ns;
                return newFrames;
            });
            startPosRef.current.x += actualDx;
            startPosRef.current.y += actualDy;
        }
        return;
    }

    if (isMovingPivotRef.current && selectedShapeIndexes.length === 1) {
        const snapped = snap(mouse.x, mouse.y);
        setFrames(prev => {
            const nf = [...prev], ns = [...nf[currentFrameIndex]];
            ns[selectedShapeIndexes[0]] = { ...ns[selectedShapeIndexes[0]], pivotX: snapped.x, pivotY: snapped.y };
            nf[currentFrameIndex] = ns;
            return nf;
        });
        return;
    }

    if (isMovingPointRef.current && selectedShapeIndexes.length === 1) {
        const dx = mouse.x - startPosRef.current.x, dy = mouse.y - startPosRef.current.y;
        
        const shape = shapes[selectedShapeIndexes[0]];
        const refPath = selectedPointIndexes[0];
        const refPoint = getPointByPath(shape, refPath);

        if (refPoint) {
            const snappedTarget = snap(refPoint.x + dx, refPoint.y + dy, selectedPointIndexes);
            const actualDx = snappedTarget.x - refPoint.x;
            const actualDy = snappedTarget.y - refPoint.y;

            if (actualDx !== 0 || actualDy !== 0) {
                const deepUpdate = (item, path, dX, dY) => {
                    if (path.length === 1) {
                        const idx = path[0];
                        const s = { ...item };
                        if (s.type === 'line') {
                            if (idx === 0) { s.start = { ...s.start, x: s.start.x + dX, y: s.start.y + dY }; }
                            else { s.end = { ...s.end, x: s.end.x + dX, y: s.end.y + dY }; }
                        } else if (s.type === 'rect') {
                            if (idx === 0) { s.start = { ...s.start, x: s.start.x + dX, y: s.start.y + dY }; s.width -= dX; s.height -= dY; }
                            else if (idx === 1) { s.start = { ...s.start, y: s.start.y + dY }; s.width += dX; s.height -= dY; }
                            else if (idx === 2) { s.width += dX; s.height += dY; }
                            else if (idx === 3) { s.start = { ...s.start, x: s.start.x + dX }; s.width -= dX; s.height += dY; }
                        } else if (s.type === 'circle' || s.type === 'star') {
                            if (idx === 0) { s.start = { ...s.start, x: s.start.x + dX, y: s.start.y + dY }; }
                            else if (idx === 1) s.end = { ...s.end, x: s.end.x + dX };
                            else if (idx === 2) s.end = { ...s.end, y: s.end.y + dY };
                        } else if (s.points) {
                            s.points = [...s.points];
                            if (s.points[idx]) {
                                s.points[idx] = { ...s.points[idx], x: s.points[idx].x + dX, y: s.points[idx].y + dY };
                            }
                        }
                        return s;
                    } else {
                        const [currentIdx, ...rest] = path;
                        const s = { ...item };
                        s.shapes = [...s.shapes];
                        s.shapes[currentIdx] = deepUpdate(s.shapes[currentIdx], rest, dX, dY);
                        return s;
                    }
                };

                setFrames(prev => {
                    const nf = [...prev], ns = [...nf[currentFrameIndex]];
                    let shape = { ...ns[selectedShapeIndexes[0]] };
                    selectedPointIndexes.forEach(pData => {
                        const path = Array.isArray(pData) ? pData : [pData];
                        shape = deepUpdate(shape, path, actualDx, actualDy);
                    });
                    ns[selectedShapeIndexes[0]] = shape; nf[currentFrameIndex] = ns; return nf;
                });

                startPosRef.current.x += actualDx;
                startPosRef.current.y += actualDy;
            }
        }
        return;
    }
    if (!isDrawing) return;
    const snappedMouse = snap(mouse.x, mouse.y);
    const x = snappedMouse.x, y = snappedMouse.y;
    setActiveShape(prev => {
        if (!prev) return null; const updated = { ...prev }, isShift = e.shiftKey;
        if (tool === 'pen') updated.points = [...prev.points, { x, y, color }];
        else if (tool === 'bezier') { 
            const pts = [...updated.points];
            if (pts.length >= 3) {
                // Update the current last control point and end point
                const p0 = pts[pts.length - 3];
                const p1 = { x: (p0.x + x) / 2, y: (p0.y + y) / 2 }; 
                pts[pts.length - 2] = { x: p1.x, y: p1.y, color };
                pts[pts.length - 1] = { x, y, color };
            }
            updated.points = pts;
        }
        else if (updated.type === 'polyline' || updated.type === 'polygon') { const pts = [...updated.points]; let tx = x, ty = y; if (isShift) { const p = pts[pts.length - 2]; Math.abs(x - p.x) > Math.abs(y - p.y) ? ty = p.y : tx = p.x; } pts[pts.length - 1] = { x: tx, y: ty, color }; updated.points = pts; }
        else if (tool === 'line') { let tx = x, ty = y; if (isShift) { Math.abs(x-startPosRef.current.x) > Math.abs(y-startPosRef.current.y) ? ty=startPosRef.current.y : tx=startPosRef.current.x; } updated.end = { x: tx, y: ty }; }
        else if (tool === 'circle' || tool === 'star') { let tx = x, ty = y; if (isShift) { const d = Math.max(Math.abs(x-startPosRef.current.x), Math.abs(y-startPosRef.current.y)); tx=startPosRef.current.x+(x>=startPosRef.current.x?d:-d); ty=startPosRef.current.y+(y>=startPosRef.current.y?d:-d); } updated.end = { x: tx, y: ty }; }
        else if (tool === 'rect') { let w = x-startPosRef.current.x, h = y-startPosRef.current.y; if (isShift) { const s = Math.max(Math.abs(w), Math.abs(h)); w = w>0?s:-s; h = h>0?s:-s; } updated.width = w; updated.height = h; }
        return updated;
    });
  };

  const stopDrawing = (e) => {
    if (isSelectingBoxRef.current && selectionBoxRef.current) {
        const box = selectionBoxRef.current;
        const isShift = e.shiftKey;
        if (box.w < 5/zoom && box.h < 5/zoom) {
            if (!isShift) {
                setSelectedShapeIndexes([]);
                setSelectedPointIndexes([]);
            }
        } else {
            // If exactly one shape is selected, box selection selects POINTS of that shape
            if (selectedShapeIndexes.length === 1) {
                const shapeIdx = selectedShapeIndexes[0];
                const shape = shapes[shapeIdx];
                const pts = getShapePoints(shape);
                const caughtPoints = [];
                pts.forEach((p, i) => {
                    if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) {
                        caughtPoints.push(i);
                    }
                });
                
                if (caughtPoints.length > 0) {
                    if (isShift) {
                        setSelectedPointIndexes(prev => Array.from(new Set([...prev, ...caughtPoints])).sort((a,b) => a-b));
                    } else {
                        setSelectedPointIndexes(caughtPoints);
                    }
                } else {
                    // Fallback to shape selection if no points were caught
                    const caughtShapes = [];
                    shapes.forEach((s, i) => {
                        if (s.hidden || s.locked) return;
                        const bb = getBoundingBox(s);
                        if (bb.x < box.x + box.w && bb.x + bb.w > box.x && bb.y < box.y + box.h && bb.y + bb.h > box.y) {
                            caughtShapes.push(i);
                        }
                    });
                    if (isShift) {
                        setSelectedShapeIndexes(prev => Array.from(new Set([...prev, ...caughtShapes])));
                    } else {
                        setSelectedShapeIndexes(caughtShapes);
                        setSelectedPointIndexes([]);
                    }
                }
            } else {
                // Select shapes intersecting with box
                const caughtShapes = [];
                shapes.forEach((s, i) => {
                    if (s.hidden || s.locked) return;
                    const bb = getBoundingBox(s);
                    if (bb.x < box.x + box.w && bb.x + bb.w > box.x && bb.y < box.y + box.h && bb.y + bb.h > box.y) {
                        caughtShapes.push(i);
                    }
                });
                if (isShift) {
                    setSelectedShapeIndexes(prev => Array.from(new Set([...prev, ...caughtShapes])));
                } else {
                    setSelectedShapeIndexes(caughtShapes);
                    setSelectedPointIndexes([]);
                }
            }
        }
    }
    
    if (isMovingPointRef.current || isMovingShapeRef.current || isMovingPivotRef.current) {
        recordHistory(frames);
    }

    isMovingPointRef.current = false; isMovingShapeRef.current = false; isMovingPivotRef.current = false; isRotatingRef.current = false; isSelectingBoxRef.current = false; isPanningRef.current = false; selectionBoxRef.current = null;
    
    if (!isDrawing) return;
    
    // Determine if this shape should be finalized immediately on mouseUp
    // Rect, Circle, Star, and Line (if not continuous) should finish immediately.
    // Polygon, Polyline, and Bezier (if continuous) should wait for finishMultiPointShape (double click / right click).
    
    const isMultiPointTool = activeShape.type === 'polygon' || activeShape.type === 'polyline';
    const isContinuousCurve = activeShape.type === 'bezier' && continuousDrawing;
    
    if (activeShape && !isMultiPointTool && !isContinuousCurve) {
        const newFrames = [...frames];
        newFrames[currentFrameIndex] = [...(newFrames[currentFrameIndex] || []), activeShape];
        setFrames(newFrames);
        recordHistory(newFrames);
        
        setSelectedShapeIndexes([newFrames[currentFrameIndex].length - 1]); 
        setIsDrawing(false); 
        setActiveShape(null);
    }
  };

  // --- RENDERING ---
  const drawShape = (ctx, shape, isSelected, isOnion = false, path = []) => {
    if (!shape || shape.hidden) return; ctx.save(); 
    
    // Group handling
    if (shape.type === 'group') {
        shape.shapes.forEach((child, i) => drawShape(ctx, child, false, isOnion, [...path, i]));
        ctx.restore();
        
        // After drawing children, if the group itself is selected, draw ITS handles
        if (isSelected && !isOnion) {
            ctx.save();
            const groupCenter = getShapeCenter(shape);
            const groupPivot = getShapePivot(shape);
            
            // Re-apply same handle drawing logic but specifically for this group object
            // Center handle
            ctx.fillStyle = '#0089ff';
            ctx.beginPath(); ctx.arc(groupCenter.x, groupCenter.y, 6/zoom, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = 'white'; ctx.lineWidth = 1/zoom; ctx.stroke();

            // Rotation handle (using bounding box topmost point for groups)
            const bb = getBoundingBox(shape);
            ctx.beginPath(); ctx.moveTo(groupCenter.x, bb.y); ctx.lineTo(groupCenter.x, bb.y - 30/zoom); ctx.strokeStyle = 'white'; ctx.stroke();
            ctx.beginPath(); ctx.arc(groupCenter.x, bb.y - 30/zoom, 6/zoom, 0, Math.PI*2); ctx.fillStyle = '#0089ff'; ctx.fill(); ctx.stroke();

            // Pivot Handle
            ctx.strokeStyle = 'var(--theme-color)';
            ctx.lineWidth = 2/zoom;
            ctx.beginPath();
            ctx.moveTo(groupPivot.x - 10/zoom, groupPivot.y); ctx.lineTo(groupPivot.x + 10/zoom, groupPivot.y);
            ctx.moveTo(groupPivot.x, groupPivot.y - 10/zoom); ctx.lineTo(groupPivot.x, groupPivot.y + 10/zoom);
            ctx.stroke();
            ctx.beginPath(); ctx.arc(groupPivot.x, groupPivot.y, 5/zoom, 0, Math.PI*2); ctx.stroke();
            ctx.restore();
        }
        return;
    }

    const center = getShapeCenter(shape);
    ctx.lineWidth = (isSelected ? 2.5 : 1.5) / zoom;
    
    // Batch drawing optimization
    const drawPoly = (pts, closed, mode = 'simple') => {
        if (!pts || pts.length < 2) return;
        
        let pendingStroke = false;
        ctx.beginPath();
        if (pts[0]) ctx.moveTo(pts[0].x, pts[0].y);
        
        for (let i = 0; i < pts.length - 1; i++) {
            if (mode === 'dashed' && i % 2 === 1) {
                if (pendingStroke) { ctx.stroke(); pendingStroke = false; }
                ctx.moveTo(pts[i+1].x, pts[i+1].y);
                continue;
            }

            const p1 = pts[i];
            const p2 = pts[i+1];
            if (!p1 || !p2) continue;

            const c1 = isOnion ? '#444' : (p1.color || shape.color);
            const c2 = isOnion ? '#444' : (p2.color || shape.color);

            if (c1 !== c2) {
                if (pendingStroke) { ctx.stroke(); pendingStroke = false; }
                const g = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
                g.addColorStop(0, c1); g.addColorStop(1, c2);
                ctx.strokeStyle = g;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(p2.x, p2.y);
            } else {
                if (ctx.strokeStyle !== c1) {
                    if (pendingStroke) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(p1.x, p1.y); }
                    ctx.strokeStyle = c1;
                }
                ctx.lineTo(p2.x, p2.y);
                pendingStroke = true;
            }
        }

        if (closed && pts.length > 2) {
             const iLast = pts.length - 1;
             if (mode === 'dashed' && iLast % 2 === 1) {
                 if (pendingStroke) ctx.stroke();
             } else {
                 const pLast = pts[iLast];
                 const pFirst = pts[0];
                 const c1 = isOnion ? '#444' : (pLast.color || shape.color);
                 const c2 = isOnion ? '#444' : (pFirst.color || shape.color);
                 
                 if (c1 !== c2) {
                     if (pendingStroke) { ctx.stroke(); }
                     const g = ctx.createLinearGradient(pLast.x, pLast.y, pFirst.x, pFirst.y);
                     g.addColorStop(0, c1); g.addColorStop(1, c2);
                     ctx.strokeStyle = g;
                     ctx.beginPath(); ctx.moveTo(pLast.x, pLast.y); ctx.lineTo(pFirst.x, pFirst.y); ctx.stroke();
                 } else {
                     if (ctx.strokeStyle !== c1 && pendingStroke) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(pLast.x, pLast.y); ctx.strokeStyle = c1; }
                     ctx.lineTo(pFirst.x, pFirst.y);
                     ctx.stroke();
                     pendingStroke = false;
                 }
             }
        } else if (pendingStroke) {
            ctx.stroke();
        }

        if (mode === 'dotted') {
            pts.forEach(p => {
                ctx.fillStyle = isOnion ? '#444' : (p.color || shape.color);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3 / zoom, 0, Math.PI * 2);
                ctx.fill();
            });
        }
    };

    const ds = (p1, p2, mode = 'simple') => {
        if (!p1 || !p2) return;
        if (mode === 'dotted') {
            [p1, p2].forEach(p => {
                ctx.fillStyle = isOnion ? '#444' : (p.color || shape.color);
                ctx.beginPath(); ctx.arc(p.x, p.y, 3 / zoom, 0, Math.PI * 2); ctx.fill();
            });
            return;
        }
        if (mode === 'dashed') {
            // Only draw the segment (it's segment 0)
            // Wait, for a single line, it has 1 segment (index 0). So it's always drawn.
            // If the user wants dashed lines to mean something else for single segments, we'd need more info.
        }
        const c1 = isOnion ? '#444' : (p1.color || shape.color), c2 = isOnion ? '#444' : (p2.color || shape.color);
        if (c1 === c2) ctx.strokeStyle = c1; else { const g = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.strokeStyle = g; }
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    };

    if (shape.renderMode === 'points') { getSampledPoints({...shape, rotation: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1}).forEach(p => { ctx.fillStyle = isOnion ? '#444' : (p.color || shape.color); ctx.beginPath(); ctx.arc(p.x, p.y, 3 / zoom, 0, Math.PI * 2); ctx.fill(); }); ctx.restore(); return; }
    
    const mode = shape.renderMode || 'simple';

    switch (shape.type) {
        case 'pen': case 'polyline': case 'bezier': { 
            const pts = getSampledPoints(shape);
            drawPoly(pts, false, mode);
            break; 
        }
        case 'polygon': {
            const pts = getSampledPoints(shape);
            drawPoly(pts, true, mode);
            break;
        }
        case 'line': {
            const pts = getSampledPoints(shape);
            ds(pts[0], pts[1], mode); 
            break;
        }
        case 'rect': { const pts = getSampledPoints(shape); drawPoly(pts, true, mode); break; }
        case 'circle': { 
            const pts = getSampledPoints(shape);
            drawPoly(pts, true, mode);
            break; 
        }
        case 'star': { 
            const pts = getSampledPoints(shape);
            drawPoly(pts, true, mode);
            break; 
        }
    }
    if (isSelected && !isOnion) {
        const actualPts = getShapePoints(shape); actualPts.forEach((p, i) => { 
            const ptPath = [...path, i];
            // Normalize selectedPointIndexes items to paths for comparison
            const isPointSelected = selectedPointIndexes.some(sel => {
                const selPath = Array.isArray(sel) ? sel : [sel];
                return JSON.stringify(selPath) === JSON.stringify(ptPath);
            });
            ctx.fillStyle = isPointSelected ? 'var(--theme-color)' : 'white'; 
            ctx.beginPath(); 
            ctx.arc(p.x, p.y, 5/zoom, 0, Math.PI*2); 
            ctx.fill(); 
            ctx.strokeStyle = isPointSelected ? 'white' : 'black'; 
            ctx.lineWidth = 1/zoom; 
            ctx.stroke(); 
        });
        
        // Rotation handle line should start from the topmost point of the shape or its bounding box
        const minY = Math.min(...actualPts.map(p => p.y));
        ctx.beginPath(); ctx.moveTo(center.x, minY); ctx.lineTo(center.x, minY - 30/zoom); ctx.strokeStyle = 'white'; ctx.stroke();
        ctx.beginPath(); ctx.arc(center.x, minY - 30/zoom, 6/zoom, 0, Math.PI*2); ctx.fillStyle = '#0089ff'; ctx.fill(); ctx.stroke();

        // Draw Pivot Handle (Anchor)
        const pivot = getShapePivot(shape);
        ctx.strokeStyle = 'var(--theme-color)';
        ctx.lineWidth = 2/zoom;
        ctx.beginPath();
        // Crosshair
        ctx.moveTo(pivot.x - 10/zoom, pivot.y); ctx.lineTo(pivot.x + 10/zoom, pivot.y);
        ctx.moveTo(pivot.x, pivot.y - 10/zoom); ctx.lineTo(pivot.x, pivot.y + 10/zoom);
        ctx.stroke();
        // Circle around crosshair
        ctx.beginPath(); ctx.arc(pivot.x, pivot.y, 5/zoom, 0, Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  };

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); 
    const drawLoop = () => {
        if (!canvasRef.current) return;
        ctx.save(); ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.translate(canvas.width / 2, canvas.height / 2); ctx.scale(zoom, zoom); ctx.translate(-CANVAS_SIZE / 2 + pan.x, -CANVAS_SIZE / 2 + pan.y);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        if (showGrid) {
          ctx.beginPath(); ctx.strokeStyle = '#222'; ctx.lineWidth = 0.5 / zoom;
          for (let x = 0; x <= CANVAS_SIZE; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_SIZE); }
          for (let y = 0; y <= CANVAS_SIZE; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(CANVAS_SIZE, y); }
          ctx.stroke();
          ctx.beginPath(); ctx.strokeStyle = '#444'; ctx.lineWidth = 1 / zoom; ctx.moveTo(CANVAS_SIZE/2, 0); ctx.lineTo(CANVAS_SIZE/2, CANVAS_SIZE); ctx.moveTo(0, CANVAS_SIZE/2); ctx.lineTo(CANVAS_SIZE, CANVAS_SIZE/2); ctx.stroke();
        }
        if (backgroundImage) { ctx.globalAlpha = 0.3; ctx.drawImage(backgroundImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE); ctx.globalAlpha = 1.0; }
        if (onionSkin && currentFrameIndex > 0 && !isPlaying) { ctx.globalAlpha = 0.15; frames[currentFrameIndex - 1].forEach(s => drawShape(ctx, s, false, true)); ctx.globalAlpha = 1.0; }
        if (shapes.length > 0) shapes.forEach((s, i) => drawShape(ctx, s, selectedShapeIndexes.includes(i)));
        if (isDrawing && activeShape) drawShape(ctx, activeShape, false);
        if (isSelectingBoxRef.current && selectionBoxRef.current) { 
            ctx.fillStyle = 'rgba(0, 137, 255, 0.3)';
            ctx.fillRect(selectionBoxRef.current.x, selectionBoxRef.current.y, selectionBoxRef.current.w, selectionBoxRef.current.h);
            ctx.strokeStyle = '#0089ff'; 
            ctx.lineWidth = 2/zoom; 
            ctx.setLineDash([]);
            ctx.strokeRect(selectionBoxRef.current.x, selectionBoxRef.current.y, selectionBoxRef.current.w, selectionBoxRef.current.h); 
        }
        ctx.restore();
    };
    drawLoop();
  }, [frames, currentFrameIndex, activeShape, isDrawing, backgroundImage, showGrid, gridSize, selectedShapeIndexes, selectedPointIndexes, onionSkin, isPlaying, zoom, pan, renderTrigger]);

  useEffect(() => {
      const container = containerRef.current; if (!container) return;
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
  }, [zoom]);

  // --- LIFECYCLE ---
  useEffect(() => { setFrames(p => { const nf = [...p]; if (frameCount > p.length) { for (let i = p.length; i < frameCount; i++) nf.push([]); } else if (frameCount < p.length) return nf.slice(0, frameCount); return nf; }); }, [frameCount]);
  useEffect(() => { if (isPlaying) playbackTimerRef.current = setInterval(() => setCurrentFrameIndex(p => (p + 1) % frameCount), 1000 / 12); else clearInterval(playbackTimerRef.current); return () => clearInterval(playbackTimerRef.current); }, [isPlaying, frameCount]);
  
  useEffect(() => { 
      const h = (e) => {
          setContextMenu({ visible: false, x: 0, y: 0, target: null });
          if (isDrawing && activeShape && e.target !== canvasRef.current) {
              finishMultiPointShape();
          }
      }; 
      window.addEventListener('click', h); 
      return () => window.removeEventListener('click', h); 
  }, [isDrawing, activeShape]);

  useEffect(() => {
    setSelectedShapeIndexes([]);
    setSelectedPointIndexes([]);
  }, [currentFrameIndex]);
  
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); copyShape(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); pasteShape(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { 
          if (selectedShapeIndexes.length > 0 && document.activeElement.tagName !== 'INPUT') { 
              const newFrames = [...frames];
              newFrames[currentFrameIndex] = newFrames[currentFrameIndex].filter((_, i) => !selectedShapeIndexes.includes(i));
              setFrames(newFrames);
              recordHistory(newFrames);
              setSelectedShapeIndexes([]); 
              setSelectedPointIndexes([]); 
          } 
      }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [frames, currentFrameIndex, selectedShapeIndexes, shapeClipboard, history, historyStep]);

  const ToolButton = ({ active, onClick, icon }) => (
    <button onClick={onClick} style={{ width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? 'var(--theme-color)' : '#222', color: active ? 'black' : '#888', border: 'none', borderRadius: '4px', fontSize: '1.2rem', padding: 0 }}><i className={`bi ${icon}`}></i></button>
  );

  const ModeButton = ({ active, onClick, children }) => (
    <button onClick={onClick} style={{ background: active ? '#444' : '#222', color: active ? 'var(--theme-color)' : '#888', border: active ? '1px solid var(--theme-color)' : '1px solid #333', fontSize: '0.7rem', padding: '5px' }}>{children}</button>
  );

  const selectedPointColor = (selectedShapeIndexes.length === 1 && shapes[selectedShapeIndexes[0]] && selectedPointIndexes.length > 0) ? (getShapePoints(shapes[selectedShapeIndexes[0]])[selectedPointIndexes[0]]?.color || shapes[selectedShapeIndexes[0]].color) : '#000000';

  return (
    <div className="shape-builder" style={{ width: '100vw', height: '100vh', background: '#111', color: 'white', display: 'flex', flexDirection: 'column', userSelect: 'none' }}>
      {isLoading && <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 20000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><h3>WORKING...</h3></div>}
      <header style={{ height: '50px', padding: '0 20px', background: '#1a1a1a', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: '15px' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', color: 'var(--theme-color)', width: '180px' }}>SHAPE BUILDER</h2>
        <div className="action-group" style={{ display: 'flex', gap: '8px' }}>
          <button onClick={undo} title="Undo"><i className="bi bi-arrow-counterclockwise"></i></button>
          <button onClick={redo} title="Redo"><i className="bi bi-arrow-clockwise"></i></button>
          <div className="separator" style={{ width: '1px', height: '20px', background: '#333' }} />
          <button onClick={copyShape} title="Copy"><i className="bi bi-clipboard"></i></button>
          <button onClick={pasteShape} title="Paste"><i className="bi bi-clipboard-check"></i></button>
          <button onClick={joinPoints} title="Join Points / Shapes"><i className="bi bi-share"></i></button>
          <button onClick={groupShapes} title="Group" disabled={selectedShapeIndexes.length < 2}><i className="bi bi-intersect"></i></button>
          <button onClick={ungroupShapes} title="Ungroup" disabled={selectedShapeIndexes.length !== 1 || shapes[selectedShapeIndexes[0]]?.type !== 'group'}><i className="bi bi-exclude"></i></button>
          <div className="separator" style={{ width: '1px', height: '20px', background: '#333' }} />
          <button onClick={() => subdivideShape(false)} title="Subdivide (Linear)" disabled={selectedShapeIndexes.length === 0}><i className="bi bi-grid-3x3"></i></button>
          <button onClick={() => subdivideShape(true)} title="Subdivide (Smooth)" disabled={selectedShapeIndexes.length === 0}><i className="bi bi-bezier"></i></button>
          <button onClick={decimateShape} title="Decimate (Reduce Points)" disabled={selectedShapeIndexes.length === 0}><i className="bi bi-filter-left"></i></button>
          <button onClick={mergePointsInShape} title="Merge Overlapping Points" disabled={selectedShapeIndexes.length === 0}><i className="bi bi-node-plus"></i></button>
          <button onClick={importSVG} title="Import SVG"><i className="bi bi-vector-pen"></i></button>
          <button onClick={importClip} title="Import ILDA"><i className="bi bi-folder2-open"></i></button>
          <button onClick={handleImportImage} title="Import Background Image"><i className="bi bi-image"></i></button>
          <div className="separator" style={{ width: '1px', height: '20px', background: '#333' }} />
          <button onClick={clearAll} title="Clear All"><i className="bi bi-trash"></i></button>
          <button onClick={() => { setZoom(0.6); setPan({x:0, y:0}); }} title="Recenter"><i className="bi bi-aspect-ratio"></i></button>
        </div>
        <div className="grid-controls" style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '0.8rem', marginLeft: '15px' }}>
          <label><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Grid</label>
          <label><input type="checkbox" checked={snapToGrid} onChange={e => setSnapToGrid(e.target.checked)} /> Snap</label>
          {(tool === 'line' || tool === 'bezier') && <label><input type="checkbox" checked={continuousDrawing} onChange={e => setContinuousDrawing(e.target.checked)} /> Continuous</label>}
          <select value={gridSize} onChange={e => setGridSize(parseInt(e.target.value))} style={{ background: '#222', color: 'white', border: '1px solid #444', borderRadius: '3px' }}>
            <option value="10">10px</option><option value="25">25px</option><option value="50">50px</option><option value="100">100px</option>
          </select>
        </div>
        <button onClick={onBack} style={{ marginLeft: 'auto' }}>Back to Show Control</button>
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <aside style={{ width: '60px', background: '#1a1a1a', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: '10px' }}>
          <ToolButton active={tool === 'select'} onClick={() => { setTool('select'); setIsDrawing(false); setActiveShape(null); }} icon="bi-cursor" />
          
          {tool === 'select' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: '#222', padding: '4px', borderRadius: '4px', border: '1px solid #333' }}>
                  <button onClick={selectOddPoints} title="Select Odd Points" style={{ padding: '4px', fontSize: '0.7rem' }}>ODD</button>
                  <button onClick={selectEvenPoints} title="Select Even Points" style={{ padding: '4px', fontSize: '0.7rem' }}>EVN</button>
                  <button onClick={invertPointSelection} title="Invert Selection" style={{ padding: '4px' }}><i className="bi bi-arrow-left-right"></i></button>
                  <button onClick={expandPointSelection} title="Expand Selection" style={{ padding: '4px' }}><i className="bi bi-plus-lg"></i></button>
                  <button onClick={shrinkPointSelection} title="Shrink Selection" style={{ padding: '4px' }}><i className="bi bi-dash-lg"></i></button>
              </div>
          )}

          <ToolButton active={tool === 'pen'} onClick={() => { setTool('pen'); setIsDrawing(false); setActiveShape(null); }} icon="bi-pencil" />
          <ToolButton active={tool === 'bezier'} onClick={() => { setTool('bezier'); setIsDrawing(false); setActiveShape(null); }} icon="bi-bezier2" />
          <ToolButton active={tool === 'line'} onClick={() => { setTool('line'); setIsDrawing(false); setActiveShape(null); }} icon="bi-slash-lg" />
          <ToolButton active={tool === 'rect'} onClick={() => { setTool('rect'); setIsDrawing(false); setActiveShape(null); }} icon="bi-square" />
          <ToolButton active={tool === 'circle'} onClick={() => { setTool('circle'); setIsDrawing(false); setActiveShape(null); }} icon="bi-circle" />
          <ToolButton active={tool === 'polygon'} onClick={() => { setTool('polygon'); setIsDrawing(false); setActiveShape(null); }} icon="bi-pentagon" />
          <ToolButton active={tool === 'star'} onClick={() => { setTool('star'); setIsDrawing(false); setActiveShape(null); }} icon="bi-star" />
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', paddingBottom: '10px' }}>
            <input type="color" value={ensureHex(color)} onChange={(e) => { setColor(e.target.value); if (selectedShapeIndexes.length > 0) updateSelectedShape({ color: e.target.value }); }} title="Custom Color" style={{ width: '35px', height: '35px', border: '2px solid #333', background: 'none', cursor: 'pointer', marginBottom: '5px' }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }}>
              {[
                { name: 'Red', hex: '#ff0000' },
                { name: 'Orange', hex: '#ff6400' },
                { name: 'Yellow', hex: '#ffff00' },
                { name: 'Green', hex: '#00ff00' },
                { name: 'Cyan', hex: '#00ffff' },
                { name: 'Blue', hex: '#0000ff' },
                { name: 'Violette', hex: '#8000ff' },
                { name: 'Pink', hex: '#ff6496' },
                { name: 'Magenta', hex: '#ff00ff' },
                { name: 'White', hex: '#ffffff' }
              ].map(c => (
                <button
                  key={c.hex}
                  onClick={() => { setColor(c.hex); if (selectedShapeIndexes.length > 0) updateSelectedShape({ color: c.hex }); }}
                  title={c.name}
                  style={{
                    width: '18px',
                    height: '18px',
                    background: c.hex,
                    border: color === c.hex ? '2px solid white' : '1px solid #444',
                    borderRadius: '2px',
                    padding: 0,
                    cursor: 'pointer'
                  }}
                />
              ))}
            </div>
          </div>
        </aside>

        <main style={{ flex: 1, background: '#050505', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          <div ref={containerRef} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <canvas ref={canvasRef} width={window.innerWidth - 300} height={window.innerHeight - 130} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onContextMenu={handleContextMenu} onDoubleClick={finishMultiPointShape}
                style={{ background: 'transparent' }} />
            {contextMenu.visible && (
                <div className="context-menu" style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, background: '#222', border: '1px solid #444', borderRadius: '4px', padding: '5px 0', zIndex: 10000 }}>
                    {(contextMenu.target?.type === 'point' || selectedPointIndexes.length > 0) && (
                        <div className="menu-item" onClick={deletePoint}>Delete {selectedPointIndexes.length > 1 ? 'Points' : 'Point'}</div>
                    )}
                    {contextMenu.target?.type === 'segment' && (
                        <>
                            <div className="menu-item" onClick={deleteSegment}>Delete Line</div>
                            <div className="menu-item" onClick={splitSegment}>Split Line</div>
                        </>
                    )}
                    {(contextMenu.target?.type === 'shape' || selectedShapeIndexes.length > 0) && (
                        <>
                            <div className="menu-item" onClick={() => subdivideShape(false)}>Subdivide (Linear)</div>
                            <div className="menu-item" onClick={() => subdivideShape(true)}>Subdivide (Smooth)</div>
                            <div className="menu-item" onClick={decimateShape}>Decimate</div>
                            <div className="menu-item" onClick={mergePointsInShape}>Merge Points</div>
                            <div className="menu-item" onClick={addCornerPoints}>Add Corner Points</div>
                            <div className="menu-item" onClick={resetPivot}>Reset Anchor Point</div>
                            <div className="separator" style={{ height: '1px', background: '#444', margin: '5px 0' }} />
                            {selectedShapeIndexes.length === 1 && ['rect', 'circle', 'star', 'line'].includes(shapes[selectedShapeIndexes[0]]?.type) && (
                                <div className="menu-item" onClick={convertToPoints}>Convert to Points</div>
                            )}
                            <div className="menu-item" onClick={() => { 
                                const newFrames = [...frames]; 
                                const toDel = selectedShapeIndexes.length > 0 ? selectedShapeIndexes : [contextMenu.target.shapeIndex];
                                newFrames[currentFrameIndex] = newFrames[currentFrameIndex].filter((_, idx) => !toDel.includes(idx)); 
                                setFrames(newFrames); 
                                setSelectedShapeIndexes([]);
                                setSelectedPointIndexes([]);
                                setContextMenu({ visible: false }); 
                            }}>Delete Shape(s)</div>
                        </>
                    )}
                    {backgroundImage && <div className="menu-item" onClick={() => { setBackgroundImage(null); setContextMenu({ visible: false }); }}>Clear Background</div>}
                    <div className="separator" style={{ height: '1px', background: '#444', margin: '5px 0' }} />
                    <div className="menu-item" onClick={copyShape}>Copy</div>
                    <div className="menu-item" onClick={pasteShape}>Paste</div>
                </div>
            )}
          </div>
          <div className="timeline-bar" style={{ height: '80px', background: '#1a1a1a', borderTop: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 20px', gap: '20px' }}>
              <div className="playback-controls" style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setIsPlaying(!isPlaying)} style={{ width: '40px', height: '40px', borderRadius: '50%', background: isPlaying ? 'var(--theme-color)' : '#333', color: isPlaying ? 'black' : 'white' }}><i className={`bi ${isPlaying ? 'bi-pause-fill' : 'bi-play-fill'}`}></i></button>
                  <button onClick={() => setCurrentFrameIndex(prev => Math.max(0, prev - 1))}><i className="bi bi-chevron-left"></i></button>
                  <button onClick={() => setCurrentFrameIndex(prev => Math.min(frameCount - 1, prev + 1))}><i className="bi bi-chevron-right"></i></button>
                  <button onClick={duplicateFrame} title="Duplicate Frame"><i className="bi bi-layers-half"></i></button>
              </div>
              <div className="frame-slider-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666' }}><span>FRAME {currentFrameIndex + 1} / {frameCount}</span><label><input type="checkbox" checked={onionSkin} onChange={e => setOnionSkin(e.target.checked)} /> Onion Skin</label></div>
                  <input type="range" min="0" max={frameCount - 1} value={currentFrameIndex} onChange={e => setCurrentFrameIndex(parseInt(e.target.value))} />
              </div>
              <div className="timeline-settings" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><label style={{ fontSize: '0.8rem', color: '#888' }}>LENGTH:</label><input type="number" min="1" max="999" value={frameCount} onChange={e => setFrameCount(Math.max(1, parseInt(e.target.value) || 1))} style={{ width: '60px', background: '#111', border: '1px solid #444', color: 'white', padding: '4px', borderRadius: '3px' }} /></div>
          </div>
        </main>

        <aside style={{ width: '240px', background: '#1a1a1a', borderLeft: '1px solid #333', padding: '15px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div className="layers-panel" style={{ display: 'flex', flexDirection: 'column', maxHeight: '40%', overflowY: 'auto', borderBottom: '1px solid #333', paddingBottom: '15px' }}>
              <h3 style={{ fontSize: '0.9rem', color: '#888', margin: '0 0 10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  LAYERS
                  <div style={{ display: 'flex', gap: '5px' }}>
                      <button onClick={groupShapes} title="Group" disabled={selectedShapeIndexes.length < 2} style={{ padding: '2px 5px', fontSize: '0.7rem' }}><i className="bi bi-intersect"></i></button>
                      <button onClick={ungroupShapes} title="Ungroup" disabled={selectedShapeIndexes.length !== 1 || shapes[selectedShapeIndexes[0]]?.type !== 'group'} style={{ padding: '2px 5px', fontSize: '0.7rem' }}><i className="bi bi-exclude"></i></button>
                  </div>
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {shapes.map((s, i) => ({ s, i })).reverse().map(({ s, i }) => (
                      <div key={i} 
                           style={{ 
                               display: 'flex', 
                               alignItems: 'center', 
                               padding: '5px', 
                               background: selectedShapeIndexes.includes(i) ? '#333' : 'transparent', 
                               borderRadius: '3px',
                               cursor: 'pointer',
                               border: selectedShapeIndexes.includes(i) ? '1px solid var(--theme-color)' : '1px solid transparent'
                           }}
                           onClick={(e) => {
                               if (s.locked && !s.hidden) return; // Can't select locked shapes via click? Actually layer panel should allow selecting even if locked to unlock it? 
                               // Convention: Layer panel selection usually bypasses canvas lock for properties, but canvas interaction is disabled.
                               // Let's allow selection in layer panel so user can UNLOCK it.
                               if (!e.shiftKey) setSelectedShapeIndexes([i]);
                               else setSelectedShapeIndexes(prev => prev.includes(i) ? prev.filter(idx => idx !== i) : [...prev, i]);
                           }}
                      >
                          <div style={{ width: '10px', height: '10px', background: s.color, marginRight: '8px', borderRadius: '2px' }}></div>
                          <span style={{ fontSize: '0.8rem', color: '#ccc', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {s.type.toUpperCase()} {i}
                          </span>
                          <button 
                              onClick={(e) => { 
                                  e.stopPropagation(); 
                                  const newFrames = [...frames]; 
                                  newFrames[currentFrameIndex][i] = { ...s, hidden: !s.hidden }; 
                                  setFrames(newFrames); 
                                  recordHistory(newFrames); 
                              }} 
                              style={{ background: 'none', border: 'none', padding: '2px', color: s.hidden ? '#555' : '#ccc' }}
                              title={s.hidden ? "Show" : "Hide"}
                          >
                              <i className={`bi ${s.hidden ? 'bi-eye-slash' : 'bi-eye'}`}></i>
                          </button>
                          <button 
                              onClick={(e) => { 
                                  e.stopPropagation(); 
                                  const newFrames = [...frames]; 
                                  newFrames[currentFrameIndex][i] = { ...s, locked: !s.locked }; 
                                  setFrames(newFrames); 
                                  recordHistory(newFrames); 
                              }} 
                              style={{ background: 'none', border: 'none', padding: '2px', color: s.locked ? 'var(--theme-color)' : '#555' }}
                              title={s.locked ? "Unlock" : "Lock"}
                          >
                              <i className={`bi ${s.locked ? 'bi-lock-fill' : 'bi-unlock'}`}></i>
                          </button>
                      </div>
                  ))}
              </div>
          </div>

          <h3 style={{ fontSize: '0.9rem', color: '#888', margin: '0 0 10px 0', borderBottom: '1px solid #333', paddingBottom: '5px' }}>PROPERTIES</h3>
          
          {/* Removed old group-actions as they are now in the header of layers */}

          {selectedShapeIndexes.length > 0 ? (
              <div className="shape-properties" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <label style={{ fontSize: '0.8rem', color: '#666', display: 'block' }}>
                      {selectedShapeIndexes.length === 1 ? `TYPE: ${shapes[selectedShapeIndexes[0]]?.type?.toUpperCase()}` : `${selectedShapeIndexes.length} SHAPES SELECTED`}
                  </label>
                  
                  <div className="property-group">
                      <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '5px' }}>COLOR</label>
                      <input type="color" value={ensureHex(shapes[selectedShapeIndexes[0]]?.color || '#ffffff')} onChange={(e) => updateSelectedShape({ color: e.target.value })} style={{ width: '100%', height: '30px', background: 'none', border: '1px solid #444', cursor: 'pointer' }} />
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginTop: '8px' }}>
                        {['#ff0000', '#ff6400', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#8000ff', '#ff6496', '#ff00ff', '#ffffff'].map(c => (
                            <button key={c} onClick={() => updateSelectedShape({ color: c })} style={{ width: '100%', height: '20px', background: c, border: '1px solid #444', borderRadius: '2px', padding: 0 }} />
                        ))}
                      </div>
                  </div>

                  <div className="property-group">
                      <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '5px' }}>SCALE X / Y</label>
                      <div style={{ display: 'flex', gap: '5px' }}>
                          <input type="number" step="0.1" value={shapes[selectedShapeIndexes[0]]?.scaleX || 1} onChange={(e) => updateSelectedShape({ scaleX: parseFloat(e.target.value) || 1 })} style={{ width: '50%', background: '#111', border: '1px solid #444', color: 'white', padding: '4px' }} />
                          <input type="number" step="0.1" value={shapes[selectedShapeIndexes[0]]?.scaleY || 1} onChange={(e) => updateSelectedShape({ scaleY: parseFloat(e.target.value) || 1 })} style={{ width: '50%', background: '#111', border: '1px solid #444', color: 'white', padding: '4px' }} />
                      </div>
                  </div>

                  <div className="property-group">
                      <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '5px' }}>ROTATION X / Y / Z (DEG)</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {['rotationX', 'rotationY', 'rotationZ'].map(axis => {
                              const valRad = shapes[selectedShapeIndexes[0]]?.[axis] || 0;
                              const valDeg = Math.round((valRad * 180 / Math.PI) * 100) / 100;
                              return (
                                <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#555', width: '10px' }}>{axis.slice(-1)}</span>
                                    <input 
                                        type="range" 
                                        min="-180" 
                                        max="180" 
                                        step="1" 
                                        value={valDeg} 
                                        onChange={(e) => updateSelectedShape({ [axis]: parseFloat(e.target.value) * Math.PI / 180 })} 
                                        style={{ flex: 1 }} 
                                    />
                                    <input 
                                        type="number" 
                                        value={valDeg} 
                                        onChange={(e) => updateSelectedShape({ [axis]: (parseFloat(e.target.value) || 0) * Math.PI / 180 })}
                                        style={{ width: '50px', background: '#111', border: '1px solid #444', color: 'white', padding: '2px', fontSize: '0.7rem' }}
                                    />
                                </div>
                              );
                          })}
                      </div>
                  </div>

                  <div className="property-group">
                      <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '5px' }}>RENDER MODE</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                          {['simple', 'dotted', 'dashed', 'points'].map(m => <ModeButton key={m} active={shapes[selectedShapeIndexes[0]]?.renderMode === m} onClick={() => updateSelectedShape({ renderMode: m })}>{m}</ModeButton>)}
                      </div>
                  </div>
              </div>
          ) : <p style={{ fontSize: '0.8rem', color: '#555', textAlign: 'center', marginTop: '20px' }}>Select shapes or drag a box to begin.</p>}

          {selectedPointIndexes.length > 0 && selectedShapeIndexes.length === 1 && (
              <div className="point-properties" style={{ background: '#222', padding: '10px', borderRadius: '4px', border: '1px solid var(--theme-color)' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--theme-color)', display: 'block', marginBottom: '5px' }}>{selectedPointIndexes.length} POINTS SELECTED</label>
                  <input type="color" value={ensureHex(selectedPointColor)} onChange={(e) => updatePointColor(e.target.value)} style={{ width: '100%', height: '40px', background: 'none', border: '1px solid #444', cursor: 'pointer' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginTop: '8px' }}>
                    {['#ff0000', '#ff6400', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#8000ff', '#ff6496', '#ff00ff', '#ffffff'].map(c => (
                        <button key={c} onClick={() => updatePointColor(c)} style={{ width: '100%', height: '20px', background: c, border: '1px solid #444', borderRadius: '2px', padding: 0 }} />
                    ))}
                  </div>
              </div>
          )}
          
          <div style={{ marginTop: 'auto' }}>
              <button className="primary-btn" style={{ width: '100%', padding: '12px' }} onClick={saveAsClip} disabled={frames.every(f => f.length === 0) || isExporting}>
                  {isExporting ? 'EXPORTING...' : 'SAVE AS CLIP'}
              </button>
          </div>
        </aside>
      </div>
      <style>{`
        button { padding: 4px 10px; background: #333; border: 1px solid #444; color: #ccc; border-radius: 3px; cursor: pointer; font-size: 0.8rem; display: flex; align-items: center; justify-content: center; }
        button:hover:not(:disabled) { background: #444; color: white; }
        .primary-btn { background: var(--theme-color) !important; color: black !important; font-weight: bold; border: none !important; }
        .context-menu { background: #222; border: 1px solid #444; border-radius: 4px; padding: 5px 0; box-shadow: 0 5px 15px rgba(0,0,0,0.5); min-width: 120px; }
        .context-menu .menu-item { padding: 8px 15px; font-size: 0.8rem; cursor: pointer; color: #ccc; }
        .context-menu .menu-item:hover { background: var(--theme-color); color: black; }
        input[type="range"] { -webkit-appearance: none; background: #333; height: 4px; border-radius: 2px; width: 100%; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; background: var(--theme-color); border-radius: 50%; cursor: pointer; }
      `}</style>
    </div>
  );
};

export default ShapeBuilder;