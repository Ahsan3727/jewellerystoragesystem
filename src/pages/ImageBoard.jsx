// src/pages/ImageBoard.jsx
//
// "Inventory · By Photo" — two views live in this one file:
//   - PhotoGallery  (/inventory/board)        — every photo that has at
//                                                least one tagged block,
//                                                grouped by image_id.
//   - BlockBoard    (/inventory/board/:id)     — one photo with all its
//                                                blocks drawn on top,
//                                                each labeled with the
//                                                article's category +
//                                                name.
//
// Each block can be:
//   - dragged to move
//   - resized from any of its 4 corners (drag the corner you want to
//     move — the opposite corner stays anchored), not just the one
//     bottom-right handle it used to have
//   - marked sold / back in stock with a single tap
//   - duplicated, for a near-identical piece
//   - removed — instantly, with a 5-second "Undo" toast instead of a
//     confirm dialog
//
// Sizes/positions are stored as percentages of the photo (top_percent,
// left_percent, width_percent, height_percent) — same fields the Tag
// screen already writes, just editable here after the fact.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getArticles,
  getArticlesForImage,
  addArticle,
  updateArticle,
  updateArticleBlock,
  deleteArticle,
  duplicateArticle,
  setArticleStatus,
  getGoldRate,
  getPhoto,
  getPhotoHistory,
  replacePhoto,
  restorePhoto,
} from '../db';
import { CATEGORIES } from './ArticleTagger';
import { computePrice, getDisplayPrice, getGoldWeight, formatPKR, formatGrams } from '../priceUtils';
import { readFileAsDataUrl } from '../imageUtils';
import ImageCropModal from '../components/ImageCropModal';

const emptyForm = { name: '', category: CATEGORIES[0], weight_grams: '', stone_weight_grams: '', description: '' };
const MIN_BLOCK_PERCENT = 4;
const UNDO_DELAY_MS = 5000;
const CORNERS = ['nw', 'ne', 'sw', 'se'];

function clamp(value, min, max) {
  if (max < min) max = min;
  return Math.min(Math.max(value, min), max);
}

export default function ImageBoard() {
  const { imageId } = useParams();
  if (imageId) return <BlockBoard imageId={Number(imageId)} />;
  return <PhotoGallery />;
}

/* ---------------------------- Gallery ---------------------------- */

function PhotoGallery() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getArticles().then((all) => {
      const byImage = new Map();
      for (const a of all) {
        if (!byImage.has(a.image_id)) {
          byImage.set(a.image_id, {
            image_id: a.image_id,
            thumb: a.export_uri || a.image_uri,
            count: 0,
            soldCount: 0,
            names: [],
          });
        }
        const g = byImage.get(a.image_id);
        g.count += 1;
        if (a.status === 'sold') g.soldCount += 1;
        if (g.names.length < 3) g.names.push(a.name);
      }
      setGroups(Array.from(byImage.values()));
      setLoaded(true);
    });
  }, []);

  return (
    <div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
        Tap a photo to see its blocks, resize them, or add new ones.
      </p>

      {loaded && groups.length === 0 && (
        <p className="empty">No tagged photos yet — tag an article first.</p>
      )}

      <div className="photo-gallery-grid">
        {groups.map((g) => (
          <button
            key={g.image_id}
            className="photo-gallery-card"
            onClick={() => navigate(`/inventory/board/${g.image_id}`)}
          >
            <img src={g.thumb} alt="" />
            <div className="photo-gallery-info">
              <strong>
                {g.count} block{g.count === 1 ? '' : 's'}
                {g.soldCount > 0 && <span className="photo-gallery-sold"> · {g.soldCount} sold</span>}
              </strong>
              <span>
                {g.names.join(', ')}
                {g.count > g.names.length ? '…' : ''}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------- Block board ---------------------------- */

function BlockBoard({ imageId }) {
  const navigate = useNavigate();
  const [blocks, setBlocks] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [photoHistory, setPhotoHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [addMode, setAddMode] = useState(false);
  const [pendingTag, setPendingTag] = useState(null); // {top_percent, left_percent}
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(null); // {name, category, weight_grams, stone_weight_grams, description} for the selected block
  const [toast, setToast] = useState(null); // { message, undo? }
  const [rate, setRate] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState(null); // raw data URL awaiting the crop-adjustment step
  const imgRef = useRef(null);
  const dragInfo = useRef(null);
  const pendingDeleteRef = useRef(null); // { id, timer }
  const photoInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const load = useCallback(async () => {
    const [rows, photoRow, historyRows] = await Promise.all([
      getArticlesForImage(imageId),
      getPhoto(imageId),
      getPhotoHistory(imageId),
    ]);
    setBlocks(rows);
    setPhoto(photoRow);
    setPhotoHistory(historyRows);
    setLoaded(true);
  }, [imageId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getGoldRate().then((r) => setRate(r.rate));
  }, []);

  useEffect(() => {
    if (!toast || toast.undo) return; // undo toasts clear themselves on their own timer
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  // If the screen unmounts (photo switched, navigated away) while a
  // remove is still "undoable", commit it rather than leaving it in limbo.
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timer);
        deleteArticle(pendingDeleteRef.current.id);
      }
    };
  }, []);

  // "photos" is the source of truth now; fall back to an article's own
  // copy only if the photo row somehow hasn't loaded yet.
  const photoUri = photo?.uri || blocks[0]?.image_uri;
  const selected = blocks.find((b) => b.id === selectedId) || null;

  // Same letterbox math as the Tag screen: maps a client point to a
  // percentage position on the actual photo, ignoring the padding
  // object-fit: contain adds around it.
  const getMetrics = () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return null;
    const box = img.getBoundingClientRect();
    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const renderedW = img.naturalWidth * scale;
    const renderedH = img.naturalHeight * scale;
    const offsetX = (box.width - renderedW) / 2;
    const offsetY = (box.height - renderedH) / 2;
    return { box, renderedW, renderedH, offsetX, offsetY };
  };

  const onWrapClick = (evt) => {
    if (!addMode) return;
    if (evt.target.closest('.photo-block')) return; // don't place under an existing block
    const m = getMetrics();
    if (!m) return;
    const x = evt.clientX - m.box.left - m.offsetX;
    const y = evt.clientY - m.box.top - m.offsetY;
    if (x < 0 || y < 0 || x > m.renderedW || y > m.renderedH) return; // clicked the letterbox padding

    setPendingTag({
      left_percent: clamp((x / m.renderedW) * 100, 0, 100 - 15),
      top_percent: clamp((y / m.renderedH) * 100, 0, 100 - 15),
    });
    setForm(emptyForm);
  };

  // mode: 'move' | 'resize'. corner (resize only): 'nw' | 'ne' | 'sw' | 'se'
  // — whichever corner's handle was grabbed; the opposite corner of the
  // block stays anchored while that one moves.
  const startDrag = (evt, block, mode, corner) => {
    if (addMode) return;
    evt.stopPropagation();
    evt.preventDefault();
    const m = getMetrics();
    if (!m) return;
    dragInfo.current = {
      mode,
      corner,
      id: block.id,
      pointerId: evt.pointerId,
      startX: evt.clientX,
      startY: evt.clientY,
      startTop: block.top_percent,
      startLeft: block.left_percent,
      startWidth: block.width_percent,
      startHeight: block.height_percent,
      lastTop: block.top_percent,
      lastLeft: block.left_percent,
      lastWidth: block.width_percent,
      lastHeight: block.height_percent,
      renderedW: m.renderedW,
      renderedH: m.renderedH,
      moved: false,
    };
    evt.currentTarget.setPointerCapture(evt.pointerId);
  };

  const onDragMove = (evt) => {
    const d = dragInfo.current;
    if (!d || d.pointerId !== evt.pointerId) return;
    const dxPct = ((evt.clientX - d.startX) / d.renderedW) * 100;
    const dyPct = ((evt.clientY - d.startY) / d.renderedH) * 100;
    if (Math.abs(evt.clientX - d.startX) > 3 || Math.abs(evt.clientY - d.startY) > 3) {
      d.moved = true;
    }

    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== d.id) return b;

        if (d.mode === 'move') {
          const left = clamp(d.startLeft + dxPct, 0, 100 - b.width_percent);
          const top = clamp(d.startTop + dyPct, 0, 100 - b.height_percent);
          d.lastLeft = left;
          d.lastTop = top;
          return { ...b, left_percent: left, top_percent: top };
        }

        // Resize: whichever edges the grabbed corner touches move;
        // the opposite edges stay put, so the block resizes from that
        // corner instead of always growing toward bottom-right.
        const touchesLeft = d.corner === 'nw' || d.corner === 'sw';
        const touchesTop = d.corner === 'nw' || d.corner === 'ne';

        let left = d.startLeft;
        let width = d.startWidth;
        if (touchesLeft) {
          const rightEdge = d.startLeft + d.startWidth;
          left = clamp(d.startLeft + dxPct, 0, rightEdge - MIN_BLOCK_PERCENT);
          width = rightEdge - left;
        } else {
          width = clamp(d.startWidth + dxPct, MIN_BLOCK_PERCENT, 100 - d.startLeft);
        }

        let top = d.startTop;
        let height = d.startHeight;
        if (touchesTop) {
          const bottomEdge = d.startTop + d.startHeight;
          top = clamp(d.startTop + dyPct, 0, bottomEdge - MIN_BLOCK_PERCENT);
          height = bottomEdge - top;
        } else {
          height = clamp(d.startHeight + dyPct, MIN_BLOCK_PERCENT, 100 - d.startTop);
        }

        d.lastLeft = left;
        d.lastTop = top;
        d.lastWidth = width;
        d.lastHeight = height;
        return { ...b, left_percent: left, top_percent: top, width_percent: width, height_percent: height };
      })
    );
  };

  const onDragEnd = async (evt) => {
    const d = dragInfo.current;
    if (!d || d.pointerId !== evt.pointerId) return;
    dragInfo.current = null;

    if (!d.moved) {
      setSelectedId(d.id); // it was a tap, not a drag — just select it
      return;
    }
    await updateArticleBlock(d.id, {
      top_percent: d.lastTop,
      left_percent: d.lastLeft,
      width_percent: d.lastWidth,
      height_percent: d.lastHeight,
    });
  };

  const saveNewBlock = async () => {
    if (!form.name || !form.weight_grams) {
      setToast({ message: 'Name and weight are required.' });
      return;
    }
    const newId = await addArticle({
      name: form.name,
      category: form.category,
      weight_grams: parseFloat(form.weight_grams) || 0,
      stone_weight_grams: parseFloat(form.stone_weight_grams) || 0,
      description: form.description,
      image_uri: photoUri,
      image_id: imageId,
      top_percent: pendingTag.top_percent,
      left_percent: pendingTag.left_percent,
      width_percent: 15,
      height_percent: 15,
    });
    await load();
    setPendingTag(null);
    setAddMode(false);
    setSelectedId(newId);
    setToast({ message: `"${form.name}" added — drag a corner handle to resize.` });
  };

  const removeSelected = () => {
    if (!selected) return;
    const item = selected;
    // A second removal while one is already pending commits the first
    // immediately instead of silently dropping it.
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timer);
      deleteArticle(pendingDeleteRef.current.id);
    }
    setBlocks((prev) => prev.filter((b) => b.id !== item.id));
    setSelectedId(null);
    const timer = setTimeout(async () => {
      await deleteArticle(item.id);
      pendingDeleteRef.current = null;
      setToast(null);
    }, UNDO_DELAY_MS);
    pendingDeleteRef.current = { id: item.id, timer };
    setToast({ message: `Removed "${item.name}".`, undo: true });
  };

  const onUndoRemove = () => {
    if (!pendingDeleteRef.current) return;
    clearTimeout(pendingDeleteRef.current.timer);
    pendingDeleteRef.current = null;
    setToast(null);
    load();
  };

  const toggleSelectedStatus = async () => {
    if (!selected) return;
    const next = selected.status === 'sold' ? 'in_stock' : 'sold';
    await setArticleStatus(selected.id, next);
    await load();
    setToast({ message: next === 'sold' ? 'Marked as sold.' : 'Back in stock.' });
  };

  const duplicateSelected = async () => {
    if (!selected) return;
    const name = selected.name;
    const newId = await duplicateArticle(selected.id);
    await load();
    setSelectedId(newId);
    setToast({ message: `Duplicated "${name}" — drag the copy into place.` });
  };

  // Opens the edit form pre-filled with the selected block's current
  // name/category/weight/description. Position and size on the photo
  // are untouched here — this only edits the article's own data.
  const startEditSelected = () => {
    if (!selected) return;
    setEditForm({
      name: selected.name,
      category: selected.category,
      weight_grams: String(selected.weight_grams ?? ''),
      stone_weight_grams: String(selected.stone_weight_grams ?? ''),
      description: selected.description || '',
    });
  };

  const saveEditedBlock = async () => {
    if (!selected || !editForm) return;
    if (!editForm.name || !editForm.weight_grams) {
      setToast({ message: 'Name and weight are required.' });
      return;
    }
    await updateArticle(selected.id, {
      name: editForm.name,
      category: editForm.category,
      weight_grams: parseFloat(editForm.weight_grams) || 0,
      stone_weight_grams: parseFloat(editForm.stone_weight_grams) || 0,
      description: editForm.description,
    });
    await load();
    setEditForm(null);
    setToast({ message: `"${editForm.name}" updated.` });
  };

  // Swaps the photo under every block for a new one. Block positions
  // and sizes are stored as percentages on each article and are never
  // touched here — only the picture changes. The old photo is kept in
  // photo_history, not lost.
  const onPhotoFileChange = async (evt) => {
    const file = evt.target.files?.[0];
    evt.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setToast({ message: 'Please choose an image file.' });
      return;
    }
    if (
      blocks.length > 0 &&
      !window.confirm(
        `Replace this photo? All ${blocks.length} block${blocks.length === 1 ? '' : 's'} stay exactly where they are — only the picture underneath changes. The current photo will be saved so you can bring it back later.`
      )
    ) {
      return;
    }
    setAddMode(false);
    setPendingTag(null);
    setSelectedId(null);
    try {
      const rawDataUrl = await readFileAsDataUrl(file);
      setPendingPhoto(rawDataUrl); // opens the Adjust Photo crop step; replacePhoto happens once that's confirmed
    } catch (err) {
      setToast({ message: err.message || 'Could not read that image file.' });
    }
  };

  // Called once the crop-adjustment modal is confirmed — this is what
  // actually swaps the photo in. Block positions/sizes are untouched;
  // the old photo is kept in photo_history, same as before.
  const finishPhotoCrop = async (croppedDataUrl) => {
    setPendingPhoto(null);
    setPhotoBusy(true);
    try {
      await replacePhoto(imageId, croppedDataUrl);
      await load();
      setToast({ message: 'Photo updated — the previous one was saved below.' });
    } catch (err) {
      setToast({ message: err.message || 'Could not update the photo.' });
    } finally {
      setPhotoBusy(false);
    }
  };

  const onRestorePhoto = async (entry) => {
    if (
      !window.confirm('Use this earlier photo again? The photo currently showing will be saved in its place.')
    ) {
      return;
    }
    setPhotoBusy(true);
    try {
      await restorePhoto(imageId, entry.id);
      await load();
      setToast({ message: 'Previous photo restored.' });
    } catch (err) {
      setToast({ message: err.message || 'Could not restore that photo.' });
    } finally {
      setPhotoBusy(false);
    }
  };

  const liveGoldWeight = getGoldWeight(form.weight_grams, form.stone_weight_grams);
  const livePrice = computePrice(liveGoldWeight, rate);
  const editLiveGoldWeight = getGoldWeight(editForm?.weight_grams, editForm?.stone_weight_grams);
  const editLivePrice = computePrice(editLiveGoldWeight, rate);

  if (loaded && blocks.length === 0) {
    return (
      <div>
        <p className="empty">This photo has no blocks left.</p>
        <button className="btn btn-outline btn-block" onClick={() => navigate('/inventory/board')}>
          ← Back to photos
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPhotoFileChange}
        style={{ display: 'none' }}
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        onChange={onPhotoFileChange}
        style={{ display: 'none' }}
      />

      <button
        className={`btn ${addMode ? 'btn-gold' : 'btn-outline'} btn-block`}
        onClick={() => {
          setAddMode((v) => !v);
          setSelectedId(null);
        }}
      >
        {addMode ? '✕ Cancel' : '➕ Create Block'}
      </button>

      {addMode && <p className="hint">Tap anywhere on the photo to drop a new block</p>}

      <div className="button-pair" style={{ marginTop: 10 }}>
        <button
          className="btn btn-outline btn-block"
          onClick={() => cameraInputRef.current?.click()}
          disabled={photoBusy}
        >
          {photoBusy ? 'Saving…' : '📷 Take Photo'}
        </button>
        <button
          className="btn btn-outline btn-block"
          onClick={() => photoInputRef.current?.click()}
          disabled={photoBusy}
        >
          {photoBusy ? 'Saving…' : '🖼️ Upload Photo'}
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        {photoUri ? (
          <div className={`image-wrap ${addMode ? 'placing' : ''}`} onClick={onWrapClick}>
            <img ref={imgRef} src={photoUri} alt="Catalog item" draggable={false} />
            {blocks.map((b) => (
              <div
                key={b.id}
                className={`photo-block ${selectedId === b.id ? 'selected' : ''} ${
                  b.status === 'sold' ? 'is-sold' : ''
                }`}
                style={{
                  top: `${b.top_percent}%`,
                  left: `${b.left_percent}%`,
                  width: `${b.width_percent}%`,
                  height: `${b.height_percent}%`,
                }}
                onPointerDown={(e) => startDrag(e, b, 'move')}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
              >
                <span className="photo-block-label">
                  <span className="tag-marker-cat">{b.category}</span> {b.name}
                  {b.status === 'sold' && <span className="photo-block-sold"> · Sold</span>}
                </span>
                {selectedId === b.id &&
                  CORNERS.map((corner) => (
                    <span
                      key={corner}
                      className={`resize-handle ${corner}`}
                      onPointerDown={(e) => startDrag(e, b, 'resize', corner)}
                      onPointerMove={onDragMove}
                      onPointerUp={onDragEnd}
                      onPointerCancel={onDragEnd}
                    />
                  ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="image-wrap">
            <span className="empty-state">Loading photo…</span>
          </div>
        )}
      </div>

      {photoHistory.length > 0 && (
        <div className="prev-photos">
          <div className="prev-photos-label">
            Previous photo{photoHistory.length === 1 ? '' : 's'} ({photoHistory.length})
          </div>
          <div className="prev-photos-strip">
            {photoHistory.map((h) => (
              <button
                key={h.id}
                className="prev-photo-thumb"
                onClick={() => onRestorePhoto(h)}
                disabled={photoBusy}
                title="Tap to use this photo again"
                type="button"
              >
                <img src={h.uri} alt="Earlier version of this photo" />
              </button>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div className="block-inspector">
          <div className="row-name">
            {selected.name} <span className="cat-tag">{selected.category}</span>
          </div>
          <div className="row-meta">
            {formatGrams(selected.weight_grams)}
            {selected.stone_weight_grams ? ` (${formatGrams(getGoldWeight(selected.weight_grams, selected.stone_weight_grams))} gold)` : ''}
            {' · '}
            {formatPKR(getDisplayPrice(selected, rate))}
          </div>
          <div className="row-meta">
            Block size: {Math.round(selected.width_percent)}% × {Math.round(selected.height_percent)}% of photo
          </div>
          <button
            className={`status-pill ${selected.status === 'sold' ? 'is-sold' : ''}`}
            onClick={toggleSelectedStatus}
            type="button"
          >
            {selected.status === 'sold' ? '✓ Sold — tap to restock' : 'Mark as Sold'}
          </button>
          <p className="hint" style={{ marginTop: 6 }}>
            Drag the block to move it, or any corner handle to resize it.
          </p>
          <div className="modal-actions" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <button className="link-btn link-delete" onClick={removeSelected}>
              Remove block
            </button>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="link-btn link-duplicate" onClick={duplicateSelected}>
                Duplicate
              </button>
              <button className="link-btn link-edit" onClick={startEditSelected}>
                Edit details
              </button>
              <button className="btn btn-ghost" onClick={() => setSelectedId(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingTag && (
        <div className="modal-overlay" onClick={() => setPendingTag(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">New Article</h2>
            <input
              className="field"
              placeholder="Article name (e.g. Gold Ring)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />

            <label className="field-label">Category / Tag</label>
            <div className="chip-row">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  className={`chip ${form.category === c ? 'active' : ''}`}
                  onClick={() => setForm({ ...form, category: c })}
                  type="button"
                >
                  {c}
                </button>
              ))}
            </div>

            <input
              className="field"
              placeholder="Weight (grams)"
              type="number"
              inputMode="decimal"
              step="0.001"
              value={form.weight_grams}
              onChange={(e) => setForm({ ...form, weight_grams: e.target.value })}
            />

            <input
              className="field"
              placeholder="Stone weight (grams, if any)"
              type="number"
              inputMode="decimal"
              step="0.001"
              value={form.stone_weight_grams}
              onChange={(e) => setForm({ ...form, stone_weight_grams: e.target.value })}
            />

            <div className="price-preview">
              <span>
                Price at today's rate
                {form.stone_weight_grams ? ` · ${formatGrams(liveGoldWeight)} gold` : ''}
              </span>
              <strong>{formatPKR(livePrice)}</strong>
            </div>

            <textarea
              className="field"
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setPendingTag(null)}>
                Cancel
              </button>
              <button className="btn btn-gold" onClick={saveNewBlock}>
                Save Article
              </button>
            </div>
          </div>
        </div>
      )}

      {editForm && (
        <div className="modal-overlay" onClick={() => setEditForm(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Edit Article</h2>
            <input
              className="field"
              placeholder="Article name (e.g. Gold Ring)"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              autoFocus
            />

            <label className="field-label">Category / Tag</label>
            <div className="chip-row">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  className={`chip ${editForm.category === c ? 'active' : ''}`}
                  onClick={() => setEditForm({ ...editForm, category: c })}
                  type="button"
                >
                  {c}
                </button>
              ))}
            </div>

            <input
              className="field"
              placeholder="Weight (grams)"
              type="number"
              inputMode="decimal"
              step="0.001"
              value={editForm.weight_grams}
              onChange={(e) => setEditForm({ ...editForm, weight_grams: e.target.value })}
            />

            <input
              className="field"
              placeholder="Stone weight (grams, if any)"
              type="number"
              inputMode="decimal"
              step="0.001"
              value={editForm.stone_weight_grams}
              onChange={(e) => setEditForm({ ...editForm, stone_weight_grams: e.target.value })}
            />

            <div className="price-preview">
              <span>
                Price at today's rate
                {editForm.stone_weight_grams ? ` · ${formatGrams(editLiveGoldWeight)} gold` : ''}
              </span>
              <strong>{formatPKR(editLivePrice)}</strong>
            </div>

            <textarea
              className="field"
              placeholder="Description (optional)"
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditForm(null)}>
                Cancel
              </button>
              <button className="btn btn-gold" onClick={saveEditedBlock}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingPhoto && (
        <ImageCropModal
          sourceDataUrl={pendingPhoto}
          onCancel={() => setPendingPhoto(null)}
          onConfirm={finishPhotoCrop}
        />
      )}

      {toast && (
        <div className="toast">
          <span>{toast.message}</span>
          {toast.undo && (
            <button className="toast-undo-btn" onClick={onUndoRemove} type="button">
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
