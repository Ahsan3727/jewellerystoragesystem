// src/components/ImageCropModal.jsx
//
// "Adjust Photo" — shown right after a photo is taken/uploaded, before
// it's saved anywhere. Lets the shop owner drag a crop box over the
// full-resolution original (move it, resize from any corner, or lock
// it to a preset aspect ratio) so photos can be straightened up —
// stray background cropped out, tilted framing fixed — before they
// become the article/board photo.
//
// The stage is sized in JS to exactly match the photo's own aspect
// ratio (object-fit: contain, computed by hand) instead of leaving a
// letterboxed image inside a taller fixed box. That matters on
// mobile: with a fixed-height box + CSS object-fit, the visible image
// is smaller than the box and offset inside it, so any rounding
// mismatch between that offset and where the crop math thinks the
// image starts makes the crop preview look shifted/zoomed into the
// wrong region. Sizing the box itself to the image removes the
// offset entirely — the stage's bounding rect IS the image's bounding
// rect, so drag math and what's on screen can't drift apart.

import React, { useEffect, useRef, useState } from 'react';
import { cropDataUrl } from '../imageUtils';

const MIN_CROP_PERCENT = 10;
const CORNERS = ['nw', 'ne', 'sw', 'se'];
const ASPECTS = [
  { label: 'Free', value: null },
  { label: 'Square', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
];
const DEFAULT_CROP = { top: 10, left: 10, width: 80, height: 80 };
const MAX_STAGE_HEIGHT = 460;
const MAX_STAGE_HEIGHT_VH = 0.55; // of the viewport, whichever is smaller

function clamp(value, min, max) {
  if (max < min) max = min;
  return Math.min(Math.max(value, min), max);
}

// Largest box at the given aspect ratio that fits within 80% of the
// photo, centered — used whenever an aspect preset is tapped. Works in
// real stage pixels (renderedW/renderedH) so the ratio is exact
// regardless of the image's own aspect ratio, then converts back to
// percent for storage/rendering.
function rectForAspect(aspect, renderedW, renderedH) {
  if (!aspect || !renderedW || !renderedH) return DEFAULT_CROP;
  const boxW = renderedW * 0.8;
  const boxH = renderedH * 0.8;
  let w = boxW;
  let h = w / aspect;
  if (h > boxH) {
    h = boxH;
    w = h * aspect;
  }
  const width = (w / renderedW) * 100;
  const height = (h / renderedH) * 100;
  return { width, height, left: (100 - width) / 2, top: (100 - height) / 2 };
}

export default function ImageCropModal({ sourceDataUrl, onCancel, onConfirm }) {
  const [crop, setCrop] = useState(DEFAULT_CROP);
  const [aspect, setAspect] = useState(null);
  const [ready, setReady] = useState(false);
  const [stageSize, setStageSize] = useState(null); // { width, height } in px — exact rendered image size
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const imgRef = useRef(null);
  const stageWrapRef = useRef(null);
  const stageRef = useRef(null);
  const dragInfo = useRef(null);

  const computeStageSize = () => {
    const wrap = stageWrapRef.current;
    const img = imgRef.current;
    if (!wrap || !img || !img.naturalWidth) return;
    const maxW = wrap.clientWidth;
    const maxH = Math.min(MAX_STAGE_HEIGHT, window.innerHeight * MAX_STAGE_HEIGHT_VH);
    const ratio = img.naturalWidth / img.naturalHeight;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    setStageSize({ width: Math.round(w), height: Math.round(h) });
  };

  const onImageLoad = () => {
    setReady(true);
    // Run after paint so wrap.clientWidth reflects the final layout.
    requestAnimationFrame(computeStageSize);
  };

  useEffect(() => {
    if (!ready) return;
    const onResize = () => computeStageSize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [ready]);

  // With the stage sized exactly to the image, its own bounding rect
  // is the image's rendered box — no letterbox offset to account for.
  const getMetrics = () => {
    if (!stageSize) return null;
    return { renderedW: stageSize.width, renderedH: stageSize.height };
  };

  const applyAspect = (value) => {
    setAspect(value);
    if (!value || !stageSize) {
      setCrop(DEFAULT_CROP);
      return;
    }
    setCrop(rectForAspect(value, stageSize.width, stageSize.height));
  };

  const reset = () => {
    setAspect(null);
    setCrop(DEFAULT_CROP);
  };

  const startDrag = (evt, mode, corner) => {
    evt.stopPropagation();
    evt.preventDefault();
    const m = getMetrics();
    if (!m) return;
    dragInfo.current = {
      mode,
      corner,
      pointerId: evt.pointerId,
      startX: evt.clientX,
      startY: evt.clientY,
      startTop: crop.top,
      startLeft: crop.left,
      startWidth: crop.width,
      startHeight: crop.height,
      renderedW: m.renderedW,
      renderedH: m.renderedH,
    };
    evt.currentTarget.setPointerCapture(evt.pointerId);
  };

  const onDragMove = (evt) => {
    const d = dragInfo.current;
    if (!d || d.pointerId !== evt.pointerId) return;
    const dxPct = ((evt.clientX - d.startX) / d.renderedW) * 100;
    const dyPct = ((evt.clientY - d.startY) / d.renderedH) * 100;

    if (d.mode === 'move') {
      setCrop((prev) => ({
        ...prev,
        left: clamp(d.startLeft + dxPct, 0, 100 - d.startWidth),
        top: clamp(d.startTop + dyPct, 0, 100 - d.startHeight),
      }));
      return;
    }

    // Resize: whichever edges the grabbed corner touches move; the
    // opposite edges stay anchored (mirrors BlockBoard's resize).
    const touchesLeft = d.corner === 'nw' || d.corner === 'sw';
    const touchesTop = d.corner === 'nw' || d.corner === 'ne';

    let left = d.startLeft;
    let width = d.startWidth;
    if (touchesLeft) {
      const rightEdge = d.startLeft + d.startWidth;
      left = clamp(d.startLeft + dxPct, 0, rightEdge - MIN_CROP_PERCENT);
      width = rightEdge - left;
    } else {
      width = clamp(d.startWidth + dxPct, MIN_CROP_PERCENT, 100 - d.startLeft);
    }

    let top = d.startTop;
    let height = d.startHeight;
    if (aspect) {
      // Derive height from the new width so the box keeps the locked
      // ratio. renderedW/renderedH are the stage's exact pixel size
      // (== the image's), so this maps 1:1 to real image pixels.
      const heightPx = ((width / 100) * d.renderedW) / aspect;
      height = clamp((heightPx / d.renderedH) * 100, MIN_CROP_PERCENT, 100);
      if (touchesTop) {
        top = d.startTop + d.startHeight - height;
      }
    } else if (touchesTop) {
      const bottomEdge = d.startTop + d.startHeight;
      top = clamp(d.startTop + dyPct, 0, bottomEdge - MIN_CROP_PERCENT);
      height = bottomEdge - top;
    } else {
      height = clamp(d.startHeight + dyPct, MIN_CROP_PERCENT, 100 - d.startTop);
    }

    // Keep the box on the photo even when an aspect lock pushes an edge
    // past it (e.g. resizing a 1:1 box from a corner near the border).
    if (top < 0) { height += top; top = 0; }
    if (top + height > 100) height = 100 - top;
    if (left < 0) { width += left; left = 0; }
    if (left + width > 100) width = 100 - left;

    setCrop({ top, left, width, height });
  };

  const onDragEnd = (evt) => {
    const d = dragInfo.current;
    if (!d || d.pointerId !== evt.pointerId) return;
    dragInfo.current = null;
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await cropDataUrl(sourceDataUrl, {
        top_percent: crop.top,
        left_percent: crop.left,
        width_percent: crop.width,
        height_percent: crop.height,
      });
      onConfirm(result);
    } catch (err) {
      setBusy(false);
      setError(err.message || 'Could not crop that photo.');
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal-card crop-modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Adjust Photo</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          Drag the box to frame the shot, or a corner to resize it.
        </p>

        <div className="chip-row">
          {ASPECTS.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`chip ${aspect === a.value ? 'active' : ''}`}
              onClick={() => applyAspect(a.value)}
              disabled={busy}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="crop-stage-wrap" ref={stageWrapRef}>
          {/* Kept off-screen (not display:none, so it still loads/measures)
              until we know its real size, to avoid a flash of the old
              letterboxed layout. */}
          <img
            ref={imgRef}
            src={sourceDataUrl}
            alt=""
            onLoad={onImageLoad}
            draggable={false}
            style={{ display: 'none' }}
          />
          {ready && stageSize && (
            <div
              className="crop-stage"
              ref={stageRef}
              style={{ width: stageSize.width, height: stageSize.height }}
            >
              <img src={sourceDataUrl} alt="" draggable={false} />
              <div
                className="crop-rect"
                style={{
                  top: `${crop.top}%`,
                  left: `${crop.left}%`,
                  width: `${crop.width}%`,
                  height: `${crop.height}%`,
                }}
                onPointerDown={(e) => startDrag(e, 'move')}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
              >
                {CORNERS.map((corner) => (
                  <span
                    key={corner}
                    className={`resize-handle ${corner}`}
                    onPointerDown={(e) => startDrag(e, 'resize', corner)}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragEnd}
                    onPointerCancel={onDragEnd}
                  />
                ))}
              </div>
            </div>
          )}
          {!(ready && stageSize) && (
            <div className="crop-stage crop-stage-loading">
              <span className="empty-state">Loading photo…</span>
            </div>
          )}
        </div>

        {error && (
          <p className="hint" style={{ color: '#e2867a', marginBottom: 0 }}>
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} type="button" disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-outline" onClick={reset} type="button" disabled={busy}>
            Reset
          </button>
          <button className="btn btn-gold" onClick={confirm} type="button" disabled={!ready || busy}>
            {busy ? 'Saving…' : 'Use Photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
