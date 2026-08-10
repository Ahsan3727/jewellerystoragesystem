import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getArticles, deleteArticle, setExportUri, getGoldRate } from '../db';
import { cropImage, downloadDataUrl } from '../imageUtils';
import { computePrice, formatPKR, formatGrams } from '../priceUtils';

export default function ArticleList() {
  const navigate = useNavigate();
  const [articles, setArticles] = useState([]);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [rate, setRate] = useState(0);

  const load = useCallback(async (term = '') => {
    setArticles(await getArticles(term));
    const r = await getGoldRate();
    setRate(r.rate);
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
    await deleteArticle(id);
    load(search);
  };

  const onExport = async (item) => {
    try {
      const croppedDataUrl = await cropImage(item.image_uri, item);
      await setExportUri(item.id, croppedDataUrl);
      downloadDataUrl(croppedDataUrl, `article_${item.id}.jpg`);
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
        placeholder="Search articles..."
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />

      {rate === 0 && (
        <p className="rate-warning" onClick={() => navigate('/rate')}>
          No gold rate set — prices below are Rs 0 until you set today's rate.
        </p>
      )}

      {articles.length === 0 && <p className="empty">No articles tagged yet.</p>}

      {articles.map((item) => (
        <div className="list-row" key={item.id}>
          <img className="thumb" src={item.export_uri || item.image_uri} alt={item.name} />
          <div className="row-info">
            <div className="row-name">
              {item.name} <span className="cat-tag">{item.category}</span>
            </div>
            <div className="row-meta">
              {formatGrams(item.weight_grams)} · {formatPKR(computePrice(item.weight_grams, rate))}
            </div>
          </div>
          <div className="row-actions">
            <button className="link-btn link-edit" onClick={() => navigate(`/articles/${item.id}`)}>
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
