import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addArticle, createPhoto, getArticlesForImage, getGoldRate } from '../db';
import { fileToDataUrl } from '../imageUtils';
import { computePrice, formatPKR } from '../priceUtils';

export const CATEGORIES = ['Ring', 'Necklace', 'Bangle', 'Earring', 'Chain', 'Bracelet', 'Set', 'Other'];

const emptyForm = { name: '', category: CATEGORIES[0], weight_grams: '', description: '' };

export default function ArticleTagger() {
  const navigate = useNavigate();
  const [imageUri, setImageUri] = useState(null);
  const [imageId, setImageId] = useState(null); // stable id per source photo — groups every block on this photo
  const [tags, setTags] = useState([]);
  const [pendingTag, setPendingTag] = useState(null); // {top_percent, left_percent}
  const [form, setForm] = useState(emptyForm);
  const [toast, setToast] = useState(null);
  const [rate, setRate] = useState(0);
  const imgRef = useRef(null);
  const uploadInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    getGoldRate().then((r) => setRate(r.rate));
  }, []);

  const loadFromFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setToast('Please choose an image file.');
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    const newImageId = Date.now();
    await createPhoto(newImageId, dataUrl); // registers it in the shared photos store right away
    setImageUri(dataUrl);
    setImageId(newImageId);
    setTags([]);
  };

  const onUploadChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    await loadFromFile(file);
  };

  const onCameraChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    await loadFromFile(file);
  };

  // Maps a click to a percentage position on the actual photo, accounting
  // for the letterboxing that object-fit: contain adds around the image.
  const onImageClick = (evt) => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;

    const box = img.getBoundingClientRect();
    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const renderedW = img.naturalWidth * scale;
    const renderedH = img.naturalHeight * scale;
    const offsetX = (box.width - renderedW) / 2;
    const offsetY = (box.height - renderedH) / 2;

    const clickX = evt.clientX - box.left - offsetX;
    const clickY = evt.clientY - box.top - offsetY;

    if (clickX < 0 || clickY < 0 || clickX > renderedW || clickY > renderedH) return; // clicked in the letterbox padding

    setPendingTag({
      left_percent: (clickX / renderedW) * 100,
      top_percent: (clickY / renderedH) * 100,
    });
    setForm(emptyForm);
  };

  const saveTag = async () => {
    if (!form.name || !form.weight_grams) {
      setToast('Name and weight are required.');
      return;
    }
    await addArticle({
      name: form.name,
      category: form.category,
      weight_grams: parseFloat(form.weight_grams) || 0,
      description: form.description,
      image_uri: imageUri,
      image_id: imageId,
      top_percent: pendingTag.top_percent,
      left_percent: pendingTag.left_percent,
      width_percent: 15,
      height_percent: 15,
    });
    const refreshed = await getArticlesForImage(imageId);
    setTags(refreshed);
    setPendingTag(null);
    setToast(`"${form.name}" tagged.`);
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const livePrice = computePrice(form.weight_grams, rate);

  return (
    <div>
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        onChange={onUploadChange}
        style={{ display: 'none' }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onCameraChange}
        style={{ display: 'none' }}
      />

      <div className="button-pair">
        <button className="btn btn-outline btn-block" onClick={() => cameraInputRef.current?.click()}>
          📷 Take Photo
        </button>
        <button className="btn btn-outline btn-block" onClick={() => uploadInputRef.current?.click()}>
          🖼️ Upload Photo
        </button>
      </div>

      {rate === 0 && (
        <p className="rate-warning" onClick={() => navigate('/rate')}>
          No gold rate set yet — tap here to set today's rate first.
        </p>
      )}

      <div style={{ marginTop: 12 }}>
        {imageUri ? (
          <div className="image-wrap" onClick={onImageClick}>
            <img ref={imgRef} src={imageUri} alt="Catalog item" draggable={false} />
            {tags.map((t) => (
              <div
                key={t.id}
                className="tag-marker"
                style={{ top: `${t.top_percent}%`, left: `${t.left_percent}%` }}
              >
                <span className="tag-marker-cat">{t.category}</span> {t.name}
              </div>
            ))}
          </div>
        ) : (
          <div className="image-wrap">
            <span className="empty-state">No photo yet — take one or upload one to start tagging</span>
          </div>
        )}
      </div>

      {imageUri && <p className="hint">Tap anywhere on the photo to drop a block for a new article</p>}

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

            <div className="price-preview">
              <span>Price at today's rate</span>
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
              <button className="btn btn-gold" onClick={saveTag}>
                Save Article
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
