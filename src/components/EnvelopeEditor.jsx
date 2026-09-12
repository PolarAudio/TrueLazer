import { useRef, useEffect } from 'react';
import { easeCurve } from '../utils/shapeEffects';

// Resolume-style envelope editor: a drawn line in a box whose breakpoints can
// be click-dragged. Click on empty space adds a point, double-click a handle
// removes it (down to 2 points). The drawn curve matches the evaluated easing.
const EnvelopeEditor = ({ points = [], curve = 'linear', onChange }) => {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const latestRef = useRef({ points, curve, onChange });
  latestRef.current = { points, curve, onChange };

  const drawRef = useRef(null);

  useEffect(() => {
    const draw = () => {
      const wrap = wrapRef.current, canvas = canvasRef.current;
      if (!wrap || !canvas) return;
      const { width, height } = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = '#151515';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 4; i++) { const gx = width * i / 4; ctx.moveTo(gx, 0); ctx.lineTo(gx, height); }
      for (let j = 1; j < 4; j++) { const gy = height * j / 4; ctx.moveTo(0, gy); ctx.lineTo(width, gy); }
      ctx.stroke();
      ctx.strokeStyle = '#3a3a3a';
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

      const pts = latestRef.current.points;
      const crv = latestRef.current.curve;
      const n = pts.length;
      const px = p => ({ x: p.t * width, y: (1 - p.v) * height });
      if (n >= 2) {
        ctx.beginPath();
        const start = px(pts[0]);
        ctx.moveTo(start.x, start.y);
        for (let i = 0; i < n - 1; i++) {
          const A = pts[i], B = pts[i + 1];
          const steps = 32;
          for (let s = 1; s <= steps; s++) {
            const eased = easeCurve(s / steps, crv);
            const P = { x: (A.t + (B.t - A.t) * eased) * width, y: (1 - (A.v + (B.v - A.v) * eased)) * height };
            ctx.lineTo(P.x, P.y);
          }
        }
        ctx.strokeStyle = 'var(--theme-color)';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      pts.forEach((pt, i) => {
        const P = px(pt);
        ctx.save();
        ctx.beginPath();
        ctx.arc(P.x, P.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = (i === 0 || i === n - 1) ? '#4de1ff' : 'var(--theme-color)';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      });
    };

    draw();
    drawRef.current = draw;
    const ro = new ResizeObserver(draw);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (drawRef.current) drawRef.current();
  }, [points, curve]);

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const normCoords = (clientX, clientY) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      t: clamp((clientX - rect.left) / rect.width, 0, 1),
      v: clamp(1 - (clientY - rect.top) / rect.height, 0, 1)
    };
  };

  const hitIndex = (clientX, clientY) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const pad = 12;
    return latestRef.current.points.findIndex(p =>
      Math.abs(p.t * rect.width - (clientX - rect.left)) < pad &&
      Math.abs((1 - p.v) * rect.height - (clientY - rect.top)) < pad);
  };

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    const { t, v } = normCoords(e.clientX, e.clientY);
    const hit = hitIndex(e.clientX, e.clientY);
    if (hit >= 0) {
      dragRef.current = { mode: 'move', index: hit };
      return;
    }
    const next = [...latestRef.current.points, { t, v }].sort((a, b) => a.t - b.t);
    const index = next.findIndex(p => p.t === t && p.v === v);
    dragRef.current = { mode: 'move', index };
    latestRef.current.onChange(next);
  };

  const onDoubleClick = (e) => {
    const hit = hitIndex(e.clientX, e.clientY);
    const pts = latestRef.current.points;
    if (hit >= 0 && pts.length > 2) {
      latestRef.current.onChange(pts.filter((_, i) => i !== hit));
    }
  };

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const t = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const v = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
      const pts = latestRef.current.points.map(p => ({ ...p }));
      if (d.mode === 'move' && pts[d.index]) {
        const i = d.index;
        const lo = i > 0 ? pts[i - 1].t : 0;
        const hi = i < pts.length - 1 ? pts[i + 1].t : 1;
        pts[i] = { t: clamp(t, lo, hi), v };
        latestRef.current.onChange(pts);
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height: '110px', background: '#151515', border: '1px solid #333', borderRadius: '4px', cursor: 'crosshair', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
      />
      <span style={{ position: 'absolute', top: '2px', left: '4px', fontSize: '0.55rem', color: '#666', pointerEvents: 'none' }}>0</span>
      <span style={{ position: 'absolute', bottom: '2px', right: '4px', fontSize: '0.55rem', color: '#666', pointerEvents: 'none' }}>1</span>
    </div>
  );
};

export default EnvelopeEditor;