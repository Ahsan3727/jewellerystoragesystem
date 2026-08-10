import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProducts, deleteProduct, setExportUri } from '../db';
import { cropImage, downloadDataUrl } from '../imageUtils';

export default function ProductList() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  const load = useCallback(async (term = '') => {
    setProducts(await getProducts(term));
  }, []);

  useEffect(() => {
    load(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const onSearch = (text) => {
    setSearch(text);
    load(text);
  };

  const onDelete = async (id, name) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await deleteProduct(id);
    load(search);
  };

  // Crops out just the tagged region of the source photo and saves it as
  // its own file — the browser equivalent of the old server-side
  // images/exports/ step, using the real photo dimensions.
  const onExport = async (item) => {
    try {
      const croppedDataUrl = await cropImage(item.image_uri, item);
      await setExportUri(item.id, croppedDataUrl);
      downloadDataUrl(croppedDataUrl, `tag_${item.id}.jpg`);
      setToast(`Exported "${item.name}" — check your downloads.`);
      load(search);
    } catch (e) {
      setToast(`Export failed: ${e.message}`);
    }
  };

  return (
    <div>
      <input
        className="field search-field"
        placeholder="Search products..."
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />

      {products.length === 0 && <p className="empty">No products tagged yet.</p>}

      {products.map((item) => (
        <div className="list-row" key={item.id}>
          <img className="thumb" src={item.export_uri || item.image_uri} alt={item.name} />
          <div className="row-info">
            <div className="row-name">{item.name}</div>
            <div className="row-meta">
              {item.material} · Rs {item.price}
            </div>
          </div>
          <div className="row-actions">
            <button className="link-btn link-edit" onClick={() => navigate(`/products/${item.id}`)}>
              Edit
            </button>
            <button className="link-btn link-export" onClick={() => onExport(item)}>
              Export
            </button>
            <button className="link-btn link-delete" onClick={() => onDelete(item.id, item.name)}>
              Delete
            </button>
          </div>
        </div>
      ))}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
