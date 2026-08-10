import React, { useRef, useState } from 'react';
import { addProduct, getProductsForImage } from '../db';
import { fileToDataUrl } from '../imageUtils';

export default function ProductTagger() {
  const [imageUri, setImageUri] = useState(null);
  const [imageId, setImageId] = useState(null); // stable id per source photo
  const [tags, setTags] = useState([]);
  const [pendingTag, setPendingTag] = useState(null); // {top_percent, left_percent}
  const [form, setForm] = useState({ name: '', price: '', material: 'Gold', description: '' });
  const [toast, setToast] = useState(null);
  const imgRef = useRef(null);
  const fileInputRef = useRef(null);

  const pickImage = () => fileInputRef.current?.click();

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again later
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setToast('Please choose an image file.');
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setImageUri(dataUrl);
    setImageId(Date.now());
    setTags([]);
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
    setForm({ name: '', price: '', material: 'Gold', description: '' });
  };

  const saveTag = async () => {
    if (!form.name || !form.price) {
      setToast('Name and price are required.');
      return;
    }
    await addProduct({
      name: form.name,
      price: parseFloat(form.price) || 0,
      material: form.material,
      description: form.description,
      image_uri: imageUri,
      image_id: imageId,
      top_percent: pendingTag.top_percent,
      left_percent: pendingTag.left_percent,
      width_percent: 15,
      height_percent: 15,
    });
    const refreshed = await getProductsForImage(imageId);
    setTags(refreshed);
    setPendingTag(null);
    setToast(`"${form.name}" tagged.`);
  };

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onFileChange}
        style={{ display: 'none' }}
      />
      <button className="btn btn-outline btn-block" onClick={pickImage}>
        {imageUri ? 'Change Photo' : 'Pick Catalog Photo'}
      </button>

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
                {t.name}
              </div>
            ))}
          </div>
        ) : (
          <div className="image-wrap">
            <span className="empty-state">No photo yet — pick one to start tagging</span>
          </div>
        )}
      </div>

      {imageUri && <p className="hint">Tap anywhere on the photo to drop a price tag</p>}

      {pendingTag && (
        <div className="modal-overlay" onClick={() => setPendingTag(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">New Tag</h2>
            <input
              className="field"
              placeholder="Item name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
            <input
              className="field"
              placeholder="Price"
              type="number"
              inputMode="decimal"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
            <input
              className="field"
              placeholder="Material (Gold, Silver...)"
              value={form.material}
              onChange={(e) => setForm({ ...form, material: e.target.value })}
            />
            <textarea
              className="field"
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setPendingTag(null)}>
                Cancel
              </button>
              <button className="btn btn-gold" onClick={saveTag}>
                Save Tag
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
