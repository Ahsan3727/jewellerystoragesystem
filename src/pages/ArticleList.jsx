// src/pages/ArticleList.jsx
//
// The "All Articles" tab of Inventory. Same edit/export/delete actions
// as before, plus three additions that a growing catalog actually
// needs: filter by category (chips, built from whatever categories
// are actually in use), a sort control, and a grid view — jewelry is a
// visual product, and browsing thumbnails is often faster than reading
// a list once there are more than a dozen pieces.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getArticles, deleteArticle, setExportUri, getGoldRate } from '../db';
import { cropImage, downloadDataUrl } from '../imageUtils';
import { computePrice, formatPKR, formatGrams } from '../priceUtils';
import { CATEGORIES } from './ArticleTagger';

const SORTS = [
  { value: 'newest', label: 'Sort: Newest first' },
  { value: 'oldest', label: 'Sort: Oldest first' },
  { value: 'name', label: 'Sort: Name A–Z' },
  { value: 'weight', label: 'Sort: Weight high–low' },
  { value: 'price', label: 'Sort: Price high–low' },
];

export default function ArticleList() {
  const navigate = useNavigate();
  const [articles, setArticles] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [view, setView] = useState('list');
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

  const categoriesPresent = useMemo(() => {
    const set = new Set(articles.map((a) => a.category || 'Other'));
    return CATEGORIES.filter((c) => set.has(c));
  }, [articles]);

  const visible = useMemo(() => {
    const filtered = category === 'All' ? articles : articles.filter((a) => (a.category || 'Other') === category);
    const rows = [...filtered];
    switch (sortBy) {
      case 'oldest':
        rows.sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
        break;
      case 'name':
        rows.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'weight':
        rows.sort((a, b) => (Number(b.weight_grams) || 0) - (Number(a.weight_grams) || 0));
        break;
      case 'price':
        rows.sort((a, b) => computePrice(b.weight_grams, rate) - computePrice(a.weight_grams, rate));
        break;
      default:
        rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    }
    return rows;
  }, [articles, category, sortBy, rate]);

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

      {categoriesPresent.length > 0 && (
        <div className="chip-row scroll-x">
          <button className={`chip ${category === 'All' ? 'active' : ''}`} onClick={() => setCategory('All')} type="button">
            All
          </button>
          {categoriesPresent.map((c) => (
            <button
              key={c}
              className={`chip ${category === c ? 'active' : ''}`}
              onClick={() => setCategory(c)}
              type="button"
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="list-toolbar">
        <select className="field select-field" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="view-toggle">
          <button
            className={view === 'list' ? 'active' : ''}
            onClick={() => setView('list')}
            aria-label="List view"
            type="button"
          >
            ☰
          </button>
          <button
            className={view === 'grid' ? 'active' : ''}
            onClick={() => setView('grid')}
            aria-label="Grid view"
            type="button"
          >
            ▦
          </button>
        </div>
      </div>

      {visible.length === 0 && <p className="empty">No articles match.</p>}

      {view === 'list' ? (
        <div>
          {visible.map((item) => (
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
        </div>
      ) : (
        <div className="article-grid">
          {visible.map((item) => (
            <div className="article-card" key={item.id}>
              <div className="article-card-img">
                <img src={item.export_uri || item.image_uri} alt={item.name} />
              </div>
              <div className="article-card-body">
                <div className="row-name">{item.name}</div>
                <span className="cat-tag">{item.category}</span>
                <div className="row-meta">
                  {formatGrams(item.weight_grams)} · {formatPKR(computePrice(item.weight_grams, rate))}
                </div>
                <div className="article-card-actions">
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
            </div>
          ))}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
