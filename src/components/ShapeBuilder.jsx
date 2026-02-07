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

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const isMovingPointRef = useRef(false);
  const isMovingShapeRef = useRef(false);
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

  const getBoundingBox = (shape) => {
      const pts = getShapePoints(shape);
      if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
      const minX = Math.min(...pts.map(p => p.x));
      const maxX = Math.max(...pts.map(p => p.x));
      const minY = Math.min(...pts.map(p => p.y));
      const maxY = Math.max(...pts.map(p => p.y));
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  const groupShapes = () => {
      if (selectedShapeIndexes.length < 2) return;
      const newFrames = [...frames];
      const currentShapes = [...newFrames[currentFrameIndex]];
      const selected = selectedShapeIndexes.sort((a, b) => b - a).map(idx => currentShapes.splice(idx, 1)[0]);
      currentShapes.push({
          type: 'group',
          shapes: selected.reverse(),
          color: selected[0].color,
          scaleX: 1, scaleY: 1, rotationX: 0, rotationY: 0, rotationZ: 0
      });
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
      currentShapes.push(...group.shapes);
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

  const getShapeCenter = (shape) => {
      if (!shape) return { x: 500, y: 500 };
      if (shape.type === 'rect') return { x: shape.start.x + shape.width / 2, y: shape.start.y + shape.height / 2 };
      if (shape.type === 'circle' || shape.type === 'star') return shape.start;
      if (shape.type === 'line') return { x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 };
      if (shape.type === 'group') {
          if (!shape.shapes || shape.shapes.length === 0) return { x: 500, y: 500 };
          const centers = shape.shapes.map(getShapeCenter).filter(c => !!c);
          if (centers.length === 0) return { x: 500, y: 500 };
          return {
              x: centers.reduce((sum, c) => sum + (c.x || 0), 0) / centers.length,
              y: centers.reduce((sum, c) => sum + (c.y || 0), 0) / centers.length
          };
      }
      if (shape.points && shape.points.length > 0) {
          const validPoints = shape.points.filter(p => !!p);
          if (validPoints.length === 0) return { x: 500, y: 500 };
          const sum = validPoints.reduce((acc, p) => ({ x: acc.x + (p.x || 0), y: acc.y + (p.y || 0) }), { x: 0, y: 0 });
          return { x: sum.x / validPoints.length, y: sum.y / validPoints.length };
      }
      return { x: 500, y: 500 };
  };

  const applyTransformations = useCallback((pts, shape) => {
    if (!pts || pts.length === 0 || !shape) return pts;
    
    const center = getShapeCenter(shape);
    const sX = shape.scaleX ?? 1;
    const sY = shape.scaleY ?? 1;
    const rotX = shape.rotationX || 0;
    const rotY = shape.rotationY || 0;
    const rotZ = shape.rotationZ || shape.rotation || 0;

    if (sX === 1 && sY === 1 && rotX === 0 && rotY === 0 && rotZ === 0) return pts;

    return pts.map(p => {
        let x = p.x - center.x;
        let y = p.y - center.y;
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

        return { ...p, x: center.x + x, y: center.y + y, z };
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

  const getShapePoints = useCallback((shape) => {
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
        shape.shapes.forEach(s => pts.push(...getShapePoints(s)));
    }

    // IMPORTANT: For points (handles), we WANT transformed coordinates so they overlap with the rendered lines
    return applyTransformations(pts, shape);
  }, [applyTransformations]);

  const isHit = (shape, mouse, isSelected) => {
      const threshold = 15 / zoom; 
      const center = getShapeCenter(shape);
      
      // High-priority hit test for center handle (if selected)
      if (isSelected && getDistance(center, mouse) < 20 / zoom) return { type: 'shape' };

      const pts = getShapePoints(shape);
      
      // Check points (handles)
      for (let i = 0; i < pts.length; i++) {
          if (getDistance(pts[i], mouse) < threshold) return { type: 'point', index: i };
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

  const snap = useCallback((val) => snapToGrid ? Math.round(val / gridSize) * gridSize : val, [snapToGrid, gridSize]);

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
          const hit = isHit(shapes[i], mouse, selectedShapeIndexes.includes(i));
          if (hit) {
              setContextMenu({ visible: true, x: e.clientX, y: e.clientY, target: { ...hit, shapeIndex: i } });
              if (!selectedShapeIndexes.includes(i)) setSelectedShapeIndexes([i]);
              return;
          }
      }
      setContextMenu({ visible: true, x: e.clientX, y: e.clientY, target: { type: 'canvas' } });
  };

  const deletePoint = () => {
      if (!contextMenu.target || contextMenu.target.type !== 'point') return;
      const { shapeIndex, index: pointIndex } = contextMenu.target;
      const newFrames = [...frames]; const currentShapes = [...newFrames[currentFrameIndex]];
      const shape = { ...currentShapes[shapeIndex] };
      
      if (shape.points) {
          let newPts = [...shape.points];
          if (shape.type === 'bezier') {
              // Beziers are tricky. If we delete a point, we should probably delete the segment it belongs to.
              // Or if it's an endpoint, remove it and its control point.
              if (pointIndex % 2 === 0) { // Endpoint
                  if (pointIndex === 0) {
                      newPts.splice(0, 2); // Remove start and first CP
                  } else {
                      newPts.splice(pointIndex - 1, 2); // Remove end and its CP
                  }
              } else { // Control point
                  newPts.splice(pointIndex - 1, 2); // Remove CP and following end point
              }
          } else {
              newPts = shape.points.filter((_, idx) => idx !== pointIndex);
          }

          if (newPts.length < 2) { 
              currentShapes.splice(shapeIndex, 1);
              setSelectedShapeIndexes([]); 
          } else { 
              shape.points = newPts; 
              currentShapes[shapeIndex] = shape; 
          }
      } else { 
          currentShapes.splice(shapeIndex, 1);
          setSelectedShapeIndexes([]); 
      }
      
      newFrames[currentFrameIndex] = currentShapes;
      setFrames(newFrames);
      recordHistory(newFrames);
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
      // We need exactly 2 points selected to join them
      if (selectedPointIndexes.length !== 2) {
          alert("Select exactly 2 points to join them (Shift+Click)");
          return;
      }

      // This is complex because selectedPointIndexes refers to points within a SINGLE selected shape.
      // If the user selects points from DIFFERENT shapes, our current state doesn't track that well.
      // Let's assume for now they are in the same shape, or we need to update selection state.
      
      // RE-THINK: To join points from different shapes, the user must have multiple shapes selected
      // and points selected from them. Our current selection state only allows selecting points
      // from the LAST clicked shape.
      
      if (selectedShapeIndexes.length === 1) {
          const shapeIdx = selectedShapeIndexes[0];
          const newFrames = [...frames];
          const shape = { ...newFrames[currentFrameIndex][shapeIdx] };
          
          if (shape.type === 'polyline' || shape.type === 'pen' || shape.type === 'polygon') {
              const p1Idx = selectedPointIndexes[0];
              const p2Idx = selectedPointIndexes[1];
              
              // If it's a polyline and they selected start and end, make it a polygon
              const isStartEnd = (p1Idx === 0 && p2Idx === shape.points.length - 1) || (p2Idx === 0 && p1Idx === shape.points.length - 1);
              
              if (isStartEnd && shape.type !== 'polygon') {
                  shape.type = 'polygon';
                  newFrames[currentFrameIndex][shapeIdx] = shape;
                  setFrames(newFrames);
                  recordHistory(newFrames);
                  return;
              }
              
              // Otherwise, just draw a line between them? That's what the tool usually does.
              // For now, let's just support the start-end join to close shapes.
          }
      } else if (selectedShapeIndexes.length === 2) {
          // Join two different shapes
          const idx1 = selectedShapeIndexes[0];
          const idx2 = selectedShapeIndexes[1];
          const newFrames = [...frames];
          const currentShapes = [...newFrames[currentFrameIndex]];
          
          const s1 = currentShapes[idx1];
          const s2 = currentShapes[idx2];
          
          if ((s1.type === 'polyline' || s1.type === 'pen') && (s2.type === 'polyline' || s2.type === 'pen')) {
              // Merge points. We might need to reverse one to join them at the closest ends.
              const p1Start = s1.points[0];
              const p1End = s1.points[s1.points.length - 1];
              const p2Start = s2.points[0];
              const p2End = s2.points[s2.points.length - 1];
              
              const dEndStart = getDistance(p1End, p2Start);
              const dEndEnd = getDistance(p1End, p2End);
              const dStartStart = getDistance(p1Start, p2Start);
              const dStartEnd = getDistance(p1Start, p2End);
              
              let mergedPoints = [];
              if (dEndStart <= dEndEnd && dEndStart <= dStartStart && dEndStart <= dStartEnd) {
                  mergedPoints = [...s1.points, ...s2.points];
              } else if (dEndEnd <= dEndStart && dEndEnd <= dStartStart && dEndEnd <= dStartEnd) {
                  mergedPoints = [...s1.points, ...[...s2.points].reverse()];
              } else if (dStartStart <= dEndStart && dStartStart <= dEndEnd && dStartStart <= dStartEnd) {
                  mergedPoints = [...[...s1.points].reverse(), ...s2.points];
              } else {
                  mergedPoints = [...s2.points, ...s1.points];
              }
              
              const mergedShape = { ...s1, points: mergedPoints };
              
              // Remove old shapes and add merged one
              const highIdx = Math.max(idx1, idx2);
              const lowIdx = Math.min(idx1, idx2);
              currentShapes.splice(highIdx, 1);
              currentShapes.splice(lowIdx, 1);
              currentShapes.push(mergedShape);
              
              newFrames[currentFrameIndex] = currentShapes;
              setFrames(newFrames);
              recordHistory(newFrames);
              setSelectedShapeIndexes([currentShapes.length - 1]);
              setSelectedPointIndexes([]);
          }
      }
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
      const { data, sourceFrameIndex } = shapeClipboard;
      const newItems = Array.isArray(data) ? JSON.parse(JSON.stringify(data)) : [JSON.parse(JSON.stringify(data))];
      
      const newFrames = [...frames]; 
      const ns = [...(newFrames[currentFrameIndex] || [])]; 
      
      newItems.forEach(s => {
          if (sourceFrameIndex === currentFrameIndex) {
              if (s.points) s.points.forEach(p => { p.x += 20; p.y += 20; }); 
              else if (s.start) { s.start.x += 20; s.start.y += 20; s.end.x += 20; s.end.y += 20; }
          }
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
          recordHistory(newFrames);
          return newFrames;
      });
  };

  const updatePointColor = (c) => { 
      if (selectedShapeIndexes.length !== 1 || selectedPointIndexes.length === 0) return; 
      setFrames(prev => {
          const newFrames = [...prev]; 
          const ns = [...newFrames[currentFrameIndex]];
          const idx = selectedShapeIndexes[0];
          if (!ns[idx]) return prev;
          const s = { ...ns[idx] }; 
          selectedPointIndexes.forEach(pIdx => { 
              if (s.points) { 
                  s.points = [...s.points]; 
                  if (s.points[pIdx]) {
                      s.points[pIdx] = { ...s.points[pIdx], color: c }; 
                  }
              } 
              else if (s.type === 'line') { if (pIdx === 0) s.startColor = c; else s.endColor = c; } 
              else if (s.type === 'rect') { s.cornerColors = s.cornerColors || [s.color, s.color, s.color, s.color]; const cc = [...s.cornerColors]; cc[pIdx] = c; s.cornerColors = cc; } 
              else if (s.type === 'circle' || s.type === 'star') { if (pIdx === 0) s.centerColor = c; else s.outerColor = c; } 
          }); 
          ns[idx] = s; 
          newFrames[currentFrameIndex] = ns; 
          recordHistory(newFrames);
          return newFrames;
      });
  };

  const saveAsClip = async () => {
      if (frames.every(f => f.length === 0)) return; setIsExporting(true);
      try {
          const ildaFramesData = frames.map(frameShapes => {
              const pts = []; frameShapes.forEach(s => {
                  const mode = s.renderMode || 'simple';
                  const sampledPts = getSampledPoints(s);
                  const process = (p) => ({ ...p, x: (p.x - 500) / 500, y: (1 - p.y / 500) });
                  
                  if (s.type === 'pen' || s.type === 'polyline' || s.type === 'polygon' || s.type === 'bezier' || s.type === 'rect' || s.type === 'line') {
                      const processed = sampledPts.map(process);
                      for (let i = 0; i < processed.length - 1; i++) {
                          pts.push(...interpolatePoints(processed[i], processed[i+1], mode));
                      }
                      if (s.type === 'polygon' || s.type === 'rect') {
                          pts.push(...interpolatePoints(processed[processed.length-1], processed[0], mode));
                      }
                  } else if (s.type === 'circle' || s.type === 'star') {
                      const processed = sampledPts.map(process);
                      for (let i = 0; i < processed.length - 1; i++) {
                          const p = processed[i];
                          const c = hexToRgb(p.color || s.color);
                          pts.push({ ...p, r: c.r, g: c.g, b: c.b, blanking: (mode === 'dotted' && i % 2 !== 0) });
                      }
                  }
                  if (pts.length > 0) pts[pts.length-1].blanking = true;
              }); return { points: pts, frameName: 'SHAPE' };
          });
          const buffer = framesToIlda(ildaFramesData); await window.electronAPI.saveIldaFile(buffer, 'built_shape.ild');
      } catch (e) { console.error(e); } finally { setIsExporting(false); }
  };

  const interpolatePoints = (p1, p2, mode, spacing = 0.01) => {
      const dist = getDistance(p1, p2); const points = []; const numPoints = Math.max(2, Math.floor(dist / spacing));
      const c1 = hexToRgb(p1.color || color), c2 = hexToRgb(p2.color || color);
      for (let i = 0; i < numPoints; i++) {
          const t = i / (numPoints - 1); let b = false; if (mode === 'dotted') b = (i % 2 !== 0); else if (mode === 'dashed') b = (Math.floor(i / 4) % 2 !== 0); else if (mode === 'points') b = (i > 0 && i < numPoints - 1);
          points.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t, r: c1.r + (c2.r - c1.r) * t, g: c1.g + (c2.g - c1.g) * t, b: c1.b + (c2.b - c1.b) * t, blanking: b });
      } return points;
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
    
    const mouse = screenToWorld(e.clientX, e.clientY); const sx = snap(mouse.x), sy = snap(mouse.y); setContextMenu({ visible: false });
    if (tool === 'select') {
        let hitIdx = -1;
        let hitType = null;
        let ptIdx = -1;

        for (let i = shapes.length - 1; i >= 0; i--) {
            const hit = isHit(shapes[i], mouse, selectedShapeIndexes.includes(i));
            if (hit) {
                hitIdx = i;
                hitType = hit.type;
                ptIdx = hit.index;
                break;
            }
        }

        if (hitIdx !== -1) {
            if (hitType === 'point') {
                if (!e.shiftKey) {
                    // Clicking a point without shift: Select ONLY this point
                    setSelectedPointIndexes([ptIdx]);
                    setSelectedShapeIndexes([hitIdx]);
                } else {
                    // Shift+Click: Toggle point in selection
                    // But ONLY if it's the same shape
                    if (selectedShapeIndexes.includes(hitIdx)) {
                        setSelectedPointIndexes(prev => prev.includes(ptIdx) ? prev.filter(i => i !== ptIdx) : [...prev, ptIdx]);
                    } else {
                        // Different shape: select new shape and this point
                        setSelectedShapeIndexes([hitIdx]);
                        setSelectedPointIndexes([ptIdx]);
                    }
                }
                isMovingPointRef.current = true;
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
      if (shape.type === 'group') {
          shape.shapes = shape.shapes.map(s => moveShape({ ...s }, dx, dy));
      } else {
          if (shape.points) shape.points = shape.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
          if (shape.start) { shape.start.x += dx; shape.start.y += dy; }
          if (shape.end) { shape.end.x += dx; shape.end.y += dy; }
      }
      return shape;
  }, []);

  const draw = (e) => {
    const mouse = screenToWorld(e.clientX, e.clientY);
    if (isPanningRef.current) { const dx = (e.clientX - startPosRef.current.x) / zoom, dy = (e.clientY - startPosRef.current.y) / zoom; setPan(prev => ({ x: prev.x + dx, y: prev.y + dy })); startPosRef.current = { x: e.clientX, y: e.clientY }; return; }
    if (isRotatingRef.current && selectedShapeIndexes.length > 0) { const center = getShapeCenter(shapes[selectedShapeIndexes[0]]); updateSelectedShape({ rotationZ: Math.atan2(mouse.y - center.y, mouse.x - center.x) + Math.PI / 2 }); return; }
    if (isSelectingBoxRef.current) { selectionBoxRef.current = { x: Math.min(startPosRef.current.x, mouse.x), y: Math.min(startPosRef.current.y, mouse.y), w: Math.abs(mouse.x - startPosRef.current.x), h: Math.abs(mouse.y - startPosRef.current.y) }; return; }
    
    if (isMovingShapeRef.current) {
        const dx = mouse.x - startPosRef.current.x, dy = mouse.y - startPosRef.current.y;
        let actualDx = 0;
        let actualDy = 0;

        if (snapToGrid) {
            actualDx = Math.round(dx / gridSize) * gridSize;
            actualDy = Math.round(dy / gridSize) * gridSize;
        } else {
            actualDx = dx;
            actualDy = dy;
        }

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
            
            if (snapToGrid) {
                startPosRef.current.x += actualDx;
                startPosRef.current.y += actualDy;
            } else {
                startPosRef.current = mouse;
            }
        }
        return;
    }

    if (isMovingPointRef.current && selectedShapeIndexes.length === 1) {
        const dx = mouse.x - startPosRef.current.x, dy = mouse.y - startPosRef.current.y;
        let actualDx = 0;
        let actualDy = 0;

        if (snapToGrid) {
            actualDx = Math.round(dx / gridSize) * gridSize;
            actualDy = Math.round(dy / gridSize) * gridSize;
        } else {
            actualDx = dx;
            actualDy = dy;
        }

        if (actualDx !== 0 || actualDy !== 0) {
            setFrames(prev => {
                const nf = [...prev], ns = [...nf[currentFrameIndex]], s = { ...ns[selectedShapeIndexes[0]] };
                selectedPointIndexes.forEach(idx => {
                    // For point movement, we directly add the actual delta
                    if (s.type === 'line') { 
                        if (idx === 0) { s.start.x += actualDx; s.start.y += actualDy; } 
                        else { s.end.x += actualDx; s.end.y += actualDy; } 
                    }
                    else if (s.type === 'rect') { 
                        if (idx === 0) { s.start.x += actualDx; s.start.y += actualDy; s.width -= actualDx; s.height -= actualDy; } 
                        else if (idx === 1) { s.start.y += actualDy; s.width += actualDx; s.height -= actualDy; } 
                        else if (idx === 2) { s.width += actualDx; s.height += actualDy; } 
                        else if (idx === 3) { s.start.x += actualDx; s.width -= actualDx; s.height += actualDy; } 
                    }
                    else if (s.type === 'circle' || s.type === 'star') { 
                        if (idx === 0) { s.start.x += actualDx; s.start.y += actualDy; } 
                        else if (idx === 1) s.end.x += actualDx; 
                        else if (idx === 2) s.end.y += actualDy; 
                    }
                    else if (s.points) { 
                        s.points = [...s.points]; 
                        if (s.points[idx]) {
                            s.points[idx] = { ...s.points[idx], x: s.points[idx].x + actualDx, y: s.points[idx].y + actualDy }; 
                        }
                    }
                });
                ns[selectedShapeIndexes[0]] = s; nf[currentFrameIndex] = ns; return nf;
            });

            if (snapToGrid) {
                startPosRef.current.x += actualDx;
                startPosRef.current.y += actualDy;
            } else {
                startPosRef.current = mouse;
            }
        }
        return;
    }
    if (!isDrawing) return;
    const x = snap(mouse.x), y = snap(mouse.y);
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

  const stopDrawing = () => {
    if (isSelectingBoxRef.current && selectionBoxRef.current) {
        const box = selectionBoxRef.current;
        if (box.w < 5/zoom && box.h < 5/zoom) {
            setSelectedShapeIndexes([]);
            setSelectedPointIndexes([]);
        } else {
            // Select shapes intersecting with box
            const newSelection = [];
            shapes.forEach((s, i) => {
                const bb = getBoundingBox(s);
                if (bb.x < box.x + box.w && bb.x + bb.w > box.x && bb.y < box.y + box.h && bb.y + bb.h > box.y) {
                    newSelection.push(i);
                }
            });
            setSelectedShapeIndexes(newSelection);
        }
    }
    
    if (isMovingPointRef.current || isMovingShapeRef.current) {
        recordHistory(frames);
    }

    isMovingPointRef.current = false; isMovingShapeRef.current = false; isRotatingRef.current = false; isSelectingBoxRef.current = false; isPanningRef.current = false; selectionBoxRef.current = null;
    
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
  const drawShape = (ctx, shape, isSelected, isOnion = false) => {
    if (!shape) return; ctx.save(); 
    
    // Group handling
    if (shape.type === 'group') {
        shape.shapes.forEach(child => drawShape(ctx, child, isSelected, isOnion));
        ctx.restore();
        return;
    }

    const center = getShapeCenter(shape);
    ctx.lineWidth = (isSelected ? 2.5 : 1.5) / zoom;
    
    // Batch drawing optimization
    const drawPoly = (pts, closed) => {
        if (!pts || pts.length < 2) return;
        let pendingStroke = false;
        
        ctx.beginPath();
        if (pts[0]) ctx.moveTo(pts[0].x, pts[0].y);
        
        for (let i = 0; i < pts.length - 1; i++) {
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
             const pLast = pts[pts.length - 1];
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
        } else if (pendingStroke) {
            ctx.stroke();
        }
    };

    const ds = (p1, p2) => {
        if (!p1 || !p2) return;
        const c1 = isOnion ? '#444' : (p1.color || shape.color), c2 = isOnion ? '#444' : (p2.color || shape.color);
        if (c1 === c2) ctx.strokeStyle = c1; else { const g = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.strokeStyle = g; }
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    };

    if (shape.renderMode === 'points') { getSampledPoints({...shape, rotation: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1}).forEach(p => { ctx.fillStyle = isOnion ? '#444' : (p.color || shape.color); ctx.beginPath(); ctx.arc(p.x, p.y, 3 / zoom, 0, Math.PI * 2); ctx.fill(); }); ctx.restore(); return; }
    
    switch (shape.type) {
        case 'pen': case 'polyline': case 'bezier': { 
            const pts = getSampledPoints(shape);
            drawPoly(pts, false);
            break; 
        }
        case 'polygon': {
            const pts = getSampledPoints(shape);
            drawPoly(pts, true);
            break;
        }
        case 'line': {
            const pts = getSampledPoints(shape);
            ds(pts[0], pts[1]); 
            break;
        }
        case 'rect': { const pts = getSampledPoints(shape); drawPoly(pts, true); break; }
        case 'circle': { 
            const pts = getSampledPoints(shape);
            drawPoly(pts, true);
            break; 
        }
        case 'star': { 
            const pts = getSampledPoints(shape);
            drawPoly(pts, true);
            break; 
        }
    }
    if (isSelected && !isOnion) {
        const actualPts = getShapePoints(shape); actualPts.forEach((p, i) => { 
            const isPointSelected = selectedPointIndexes.includes(i);
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
            ctx.fillStyle = 'rgba(0, 137, 255, 0.15)';
            ctx.fillRect(selectionBoxRef.current.x, selectionBoxRef.current.y, selectionBoxRef.current.w, selectionBoxRef.current.h);
            ctx.strokeStyle = '#0089ff'; 
            ctx.lineWidth = 1/zoom; 
            ctx.setLineDash([]);
            ctx.strokeRect(selectionBoxRef.current.x, selectionBoxRef.current.y, selectionBoxRef.current.w, selectionBoxRef.current.h); 
        }
        ctx.restore();
    };
    drawLoop();
  }, [frames, currentFrameIndex, activeShape, isDrawing, backgroundImage, showGrid, gridSize, selectedShapeIndexes, selectedPointIndexes, onionSkin, isPlaying, zoom, pan]);

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
          <ToolButton active={tool === 'pen'} onClick={() => { setTool('pen'); setIsDrawing(false); setActiveShape(null); }} icon="bi-pencil" />
          <ToolButton active={tool === 'bezier'} onClick={() => { setTool('bezier'); setIsDrawing(false); setActiveShape(null); }} icon="bi-bezier2" />
          <ToolButton active={tool === 'line'} onClick={() => { setTool('line'); setIsDrawing(false); setActiveShape(null); }} icon="bi-slash-lg" />
          <ToolButton active={tool === 'rect'} onClick={() => { setTool('rect'); setIsDrawing(false); setActiveShape(null); }} icon="bi-square" />
          <ToolButton active={tool === 'circle'} onClick={() => { setTool('circle'); setIsDrawing(false); setActiveShape(null); }} icon="bi-circle" />
          <ToolButton active={tool === 'polygon'} onClick={() => { setTool('polygon'); setIsDrawing(false); setActiveShape(null); }} icon="bi-pentagon" />
          <ToolButton active={tool === 'star'} onClick={() => { setTool('star'); setIsDrawing(false); setActiveShape(null); }} icon="bi-star" />
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
            <input type="color" value={ensureHex(color)} onChange={(e) => { setColor(e.target.value); if (selectedShapeIndexes.length > 0) updateSelectedShape({ color: e.target.value }); }} style={{ width: '30px', height: '30px', border: 'none', background: 'none', cursor: 'pointer' }} />
          </div>
        </aside>

        <main style={{ flex: 1, background: '#050505', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          <div ref={containerRef} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <canvas ref={canvasRef} width={window.innerWidth - 300} height={window.innerHeight - 130} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onContextMenu={handleContextMenu} onDoubleClick={finishMultiPointShape}
                style={{ background: 'transparent' }} />
            {contextMenu.visible && (
                <div className="context-menu" style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, background: '#222', border: '1px solid #444', borderRadius: '4px', padding: '5px 0', zIndex: 10000 }}>
                    {contextMenu.target?.type === 'point' && <div className="menu-item" onClick={deletePoint}>Delete Point</div>}
                    {contextMenu.target?.type === 'segment' && (
                        <>
                            <div className="menu-item" onClick={deleteSegment}>Delete Line</div>
                            <div className="menu-item" onClick={splitSegment}>Split Line</div>
                        </>
                    )}
                    {contextMenu.target?.type === 'shape' && <div className="menu-item" onClick={() => { setFrames(prev => { const nf = [...prev]; nf[currentFrameIndex] = nf[currentFrameIndex].filter((_, idx) => idx !== contextMenu.target.shapeIndex); return nf; }); setContextMenu({ visible: false }); }}>Delete Shape</div>}
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
          <h3 style={{ fontSize: '0.9rem', color: '#888', margin: '0 0 10px 0', borderBottom: '1px solid #333', paddingBottom: '5px' }}>PROPERTIES</h3>
          
          {selectedShapeIndexes.length > 1 && (
              <div className="group-actions" style={{ marginBottom: '15px' }}>
                  <button className="primary-btn" style={{ width: '100%' }} onClick={groupShapes}>GROUP SELECTED ({selectedShapeIndexes.length})</button>
              </div>
          )}

          {selectedShapeIndexes.length === 1 && shapes[selectedShapeIndexes[0]]?.type === 'group' && (
              <div className="group-actions" style={{ marginBottom: '15px' }}>
                  <button onClick={ungroupShapes} style={{ width: '100%' }}>UNGROUP</button>
              </div>
          )}

          {selectedShapeIndexes.length > 0 ? (
              <div className="shape-properties" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <label style={{ fontSize: '0.8rem', color: '#666', display: 'block' }}>
                      {selectedShapeIndexes.length === 1 ? `TYPE: ${shapes[selectedShapeIndexes[0]]?.type?.toUpperCase()}` : `${selectedShapeIndexes.length} SHAPES SELECTED`}
                  </label>
                  
                  <div className="property-group">
                      <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '5px' }}>COLOR</label>
                      <input type="color" value={ensureHex(shapes[selectedShapeIndexes[0]]?.color || '#ffffff')} onChange={(e) => updateSelectedShape({ color: e.target.value })} style={{ width: '100%', height: '30px', background: 'none', border: '1px solid #444', cursor: 'pointer' }} />
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