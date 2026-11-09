import React, { useCallback, useEffect, useRef, useState } from 'react';

// Touch canvas for zones + output area. Mirrors the desktop
// OutputSettingsWindow canvas (grid, blue area, red zones, green test
// lines, dashed outlines) but uses Pointer Events and big handles so
// it works with a thumb at arm's length.
const HANDLE_R = 0.055; // hit radius in 0..1 — generous for touch

function toLocal(e, el) {
  const rect = el.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / Math.max(1, rect.width),
    y: (e.clientY - rect.top) / Math.max(1, rect.height),
  };
}

function hitHandle(x, y, r) {
  if (!r) return null;
  const corners = [
    ['nw', r.x, r.y],
    ['ne', r.x + r.w, r.y],
    ['sw', r.x, r.y + r.h],
    ['se', r.x + r.w, r.y + r.h],
  ];
  for (const [name, hx, hy] of corners) {
    if (Math.abs(x - hx) < HANDLE_R && Math.abs(y - hy) < HANDLE_R) return name;
  }
  if (Math.abs(y - r.y) < HANDLE_R && x >= r.x && x <= r.x + r.w) return 'n';
  if (Math.abs(y - (r.y + r.h)) < HANDLE_R && x >= r.x && x <= r.x + r.w) return 's';
  if (Math.abs(x - r.x) < HANDLE_R && y >= r.y && y <= r.y + r.h) return 'w';
  if (Math.abs(x - (r.x + r.w)) < HANDLE_R && y >= r.y && y <= r.y + r.h) return 'e';
  return null;
}

function inside(x, y, r) {
  return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function applyDrag(original, handle, dx, dy) {
  let r = { ...original };
  if (handle === 'move') {
    r.x = original.x + dx;
    r.y = original.y + dy;
  } else {
    if (handle.includes('w')) {
      const nx = original.x + dx;
      r.w = original.x + original.w - nx;
      r.x = nx;
    }
    if (handle.includes('e')) r.w = original.x + original.w + dx - r.x;
    if (handle.includes('n')) {
      const ny = original.y + dy;
      r.h = original.y + original.h - ny;
      r.y = ny;
    }
    if (handle.includes('s')) r.h = original.y + original.h + dy - r.y;
  }
  if (r.w < 0.01) r.w = 0.01;
  if (r.h < 0.01) r.h = 0.01;
  // Keep inside 0..1 like the server will.
  r.x = Math.min(Math.max(r.x, 0), 1 - r.w);
  r.y = Math.min(Math.max(r.y, 0), 1 - r.h);
  return r;
}

// Scale mode: zones are content-relative and follow the scaled output area
// (same mapping as the server blanking + laser outline + desktop canvas).
function mapZoneToCanvas(zone, settings) {
  if (settings?.transformationEnabled && settings?.outputArea && settings?.transformationMode === 'scale') {
    const a = settings.outputArea;
    return {
      x: a.x + zone.x * a.w,
      y: a.y + zone.y * a.h,
      w: zone.w * a.w,
      h: zone.h * a.h,
    };
  }
  return zone;
}

function canvasToZoneSpace(x, y, settings) {
  if (settings?.transformationEnabled && settings?.outputArea && settings?.transformationMode === 'scale') {
    const a = settings.outputArea;
    return { x: (x - a.x) / a.w, y: (y - a.y) / a.h };
  }
  return { x, y };
}

export default function StudioCanvas({
  settings,
  selectedZoneIndex,
  onSelectZone,
  onUpdateZone,
  onUpdateArea,
  editable = true,
  onDragStart = () => {},
  onDragCommit = () => {},
}) {
  const canvasRef = useRef(null);
  const draggingRef = useRef(null);
  const [dragging, setDragging] = useState(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0b0e13';
    ctx.fillRect(0, 0, width, height);

    // Grid (10x10 — coarser than desktop 20x20 so it reads on a phone).
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const p = (i / 10) * width;
      ctx.moveTo(p, 0); ctx.lineTo(p, height);
      ctx.moveTo(0, (i / 10) * height); ctx.lineTo(width, (i / 10) * height);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height);
    ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
    ctx.stroke();

    const zones = Array.isArray(settings?.safetyZones) ? settings.safetyZones : [];
    const area = settings?.outputArea;
    const showArea = !!(settings?.transformationEnabled && area);

    const rect = (r, fill, stroke, dashed) => {
      const x = r.x * width, y = r.y * height, w = r.w * width, h = r.h * height;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
      ctx.save();
      if (dashed) ctx.setLineDash([6, 4]);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    };

    const handles = (r, big) => {
      const s = big ? 12 : 8;
      ctx.fillStyle = '#fff';
      const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
      for (const [hx, hy] of pts) {
        ctx.fillRect(hx * width - s / 2, hy * height - s / 2, s, s);
      }
    };

    if (showArea) {
      rect(area, 'rgba(0,137,255,0.16)', '#0089ff', false);
    }
    const mappedZones = zones.map((z) => mapZoneToCanvas(z, settings));
    zones.forEach((z, i) => {
      const sel = i === selectedZoneIndex;
      const m = mappedZones[i];
      rect(m, 'rgba(255,51,51,0.28)', sel ? '#ffffff' : (settings.zoneOutlineEnabled ? '#ff6666' : '#ff3333'), !!settings.zoneOutlineEnabled);
    });

    // Test lines: content-relative under scale, holes at mapped zones.
    const mapLinePos = (pos, horizontal) => {
      if (settings?.transformationEnabled && area && settings?.transformationMode === 'scale') {
        return horizontal ? area.y + pos * area.h : area.x + pos * area.w;
      }
      return pos;
    };
    const segments = (fixed, horizontal) => {
      let start = 0, end = 1;
      if (showArea && settings.transformationEnabled) {
        if (settings.transformationMode === 'scale') {
          if (horizontal) { start = area.x; end = area.x + area.w; }
          else { start = area.y; end = area.y + area.h; }
        } else if (settings.transformationMode === 'crop') {
          if (horizontal) {
            if (fixed < area.y || fixed > area.y + area.h) return [];
            start = Math.max(0, area.x); end = Math.min(1, area.x + area.w);
          } else {
            if (fixed < area.x || fixed > area.x + area.w) return [];
            start = Math.max(0, area.y); end = Math.min(1, area.y + area.h);
          }
        }
      }
      let segs = [[start, end]];
      for (const z of mappedZones) {
        if (horizontal) {
          if (fixed < z.y || fixed > z.y + z.h) continue;
          segs = segs.flatMap(([s, e]) => {
            const a = z.x, b = z.x + z.w;
            if (b <= s || a >= e) return [[s, e]];
            const out = [];
            if (a > s) out.push([s, a]);
            if (b < e) out.push([b, e]);
            return out;
          });
        } else {
          if (fixed < z.x || fixed > z.x + z.w) continue;
          segs = segs.flatMap(([s, e]) => {
            const a = z.y, b = z.y + z.h;
            if (b <= s || a >= e) return [[s, e]];
            const out = [];
            if (a > s) out.push([s, a]);
            if (b < e) out.push([b, e]);
            return out;
          });
        }
      }
      return segs;
    };

    ctx.strokeStyle = '#00ff66';
    ctx.lineWidth = 2;
    if (settings.testLineEnabled && typeof settings.testLineY === 'number') {
      const mappedY = mapLinePos(settings.testLineY, true);
      const y = mappedY * height;
      ctx.beginPath();
      for (const [s, e] of segments(mappedY, true)) {
        ctx.moveTo(s * width, y);
        ctx.lineTo(e * width, y);
      }
      ctx.stroke();
    }
    if (settings.verticalTestLineEnabled && typeof settings.testLineX === 'number') {
      const mappedX = mapLinePos(settings.testLineX, false);
      const x = mappedX * width;
      ctx.beginPath();
      for (const [s, e] of segments(mappedX, false)) {
        ctx.moveTo(x, s * height);
        ctx.lineTo(x, e * height);
      }
      ctx.stroke();
    }

    // Selected handles on top.
    if (selectedZoneIndex !== null && zones[selectedZoneIndex]) handles(mappedZones[selectedZoneIndex], true);
    if (showArea && selectedZoneIndex === null) handles(area, true);

    // Flip badge (visual reminder — canvas stays logical pre-flip).
    if (settings.flipX || settings.flipY) {
      ctx.fillStyle = 'rgba(255,213,0,0.95)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(`${settings.flipX ? 'FLIP X' : ''}${settings.flipX && settings.flipY ? ' · ' : ''}${settings.flipY ? 'FLIP Y' : ''}`, 10, 18);
    }
  }, [settings, selectedZoneIndex]);

  // Resize observer keeps the canvas crisp on phone rotation/resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const side = Math.min(parent?.clientWidth || 320, parent?.clientHeight || 320);
      canvas.width = Math.round(side * dpr);
      canvas.height = Math.round(side * dpr);
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      canvas.style.aspectRatio = '1 / 1';
      draw();
    };
    size();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null;
    if (ro) ro.observe(parent || canvas);
    window.addEventListener('orientationchange', size);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('orientationchange', size);
    };
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  const onPointerDown = (e) => {
    if (!editable) return;
    const el = canvasRef.current;
    if (!el) return;
    const { x, y } = toLocal(e, el);
    const zs = canvasToZoneSpace(x, y, settings);
    const zones = Array.isArray(settings?.safetyZones) ? settings.safetyZones : [];
    const area = settings?.outputArea;

    // Selected zone handles first (same priority as desktop).
    if (selectedZoneIndex !== null && zones[selectedZoneIndex]) {
      const z = zones[selectedZoneIndex];
      const handle = hitHandle(zs.x, zs.y, z);
      if (handle) {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        const drag = { type: 'zone', index: selectedZoneIndex, handle, startX: zs.x, startY: zs.y, original: { ...z } };
        draggingRef.current = drag;
        setDragging(drag);
        onDragStart();
        return;
      }
    }
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      if (z && inside(zs.x, zs.y, z)) {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        onSelectZone(i);
        const drag = { type: 'zone', index: i, handle: hitHandle(zs.x, zs.y, z) || 'move', startX: zs.x, startY: zs.y, original: { ...z } };
        draggingRef.current = drag;
        setDragging(drag);
        onDragStart();
        return;
      }
    }
    if (settings?.transformationEnabled && area) {
      const handle = hitHandle(x, y, area);
      if (handle || inside(x, y, area)) {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        onSelectZone(null);
        const drag = { type: 'output', index: null, handle: handle || 'move', startX: x, startY: y, original: { ...area } };
        draggingRef.current = drag;
        setDragging(drag);
        onDragStart();
        return;
      }
    }
    onSelectZone(null);
  };

  const onPointerMove = (e) => {
    const drag = draggingRef.current;
    if (!drag) return;
    const el = canvasRef.current;
    if (!el) return;
    const { x, y } = toLocal(e, el);
    const cur = drag.type === 'zone' ? canvasToZoneSpace(x, y, settings) : { x, y };
    const next = applyDrag(drag.original, drag.handle, cur.x - drag.startX, cur.y - drag.startY);
    if (drag.type === 'zone') onUpdateZone(drag.index, next);
    else onUpdateArea(next);
  };

  const onPointerUp = () => {
    if (draggingRef.current) {
      draggingRef.current = null;
      setDragging(null);
      onDragCommit();
    }
  };

  return (
    <div className="studio-canvas-wrap">
      <canvas
        ref={canvasRef}
        className={`studio-canvas ${editable ? '' : 'locked'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Zone canvas"
      />
      {!editable && <div className="studio-canvas-banner">Locked by another device</div>}
      {dragging && <div className="studio-canvas-drag">Dragging…</div>}
    </div>
  );
}
