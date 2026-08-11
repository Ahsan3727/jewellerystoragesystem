// src/pages/ArticleList.jsx
//
// The "All Articles" tab of Inventory. On top of the original
// edit/export/delete actions:
//   - Filter by In Stock / Sold / All, and by category — chips built
//     from whatever's actually in the current status scope.
//   - Sort control + list/grid view toggle (grid matters for a visual
//     product like jewelry).
//   - A one-tap status pill next to each item's category to mark it
//     sold or bring it back in stock, no need to open the edit screen.
//   - Duplicate, for cloning a near-identical piece.
//   - Delete no longer needs a confirm dialog — it removes instantly
//     and offers a 5-second "Undo" toast instead, which is both safer
//     (nothing is gone until the toast disappears) and faster (no
//     "Are you sure?" popup breaking your flow).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getArticles, deleteArticle, setExportUri, getGoldRate, duplicateArticle, setArticleStatus } from '../db';
import { cropImage, downloadDataUrl } from '../imageUtils';
import { getDisplayPrice, formatPKR, formatGrams } from '../priceUtils';
import { CATEGORIES } from './ArticleTagger';

const SORTS = [
  { value: 'newest', label: 'Sort: Newest first' },
  { value: 'oldest', label: 'Sort: Oldest first' },
  { value: 'name', label: 'Sort: Name A–Z' },
  { value: 'weight', label: 'Sort: Weight high–low' },
  { value: 'price', label: 'Sort: Price high–low' },
];

const STATUS_TABS = [
  { value: 'in_stock', label: 'In Stock' },
  { value: 'sold', label: 'Sold' },
  { value: 'all', label: 'All' },
];

const UNDO_DELAY_MS = 5000;

export default function ArticleList() {
  const navigate = useNavigate();
  const [articles, setArticles] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('in_stock');
  const [category, setCategory] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [view, setView] = useState('list');
  const [toast, setToast] = useState(null); // { message, undo? }
  const [rate, setRate] = useState(0);
  const pendingDeleteRef = useRef(null); // { id, timer }

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
    setCategory('All');
  }, [statusFilter]);

  useEffect(() => {
    if (!toast || toast.undo) return; // undo toasts clear themselves on their own timer
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // If the screen unmounts (navigated away) while a delete is still
  // "undoable", commit it rather than leaving it in limbo.
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timer);
        deleteArticle(pendingDeleteRef.current.id);
      }
    };
  }, []);

  const onSearch = (text) => {
    setSearch(text);
    load(text);
  };

  const onDelete = (item) => {
    // A second delete while one is already pending commits the first
    // immediately instead of silently dropping it.
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timer);
      deleteArticle(pendingDeleteRef.current.id);
    }
    setArticles((prev) => prev.filter((a) => a.id !== item.id));
    const timer = setTimeout(async () => {
      await deleteArticle(item.id);
      pendingDeleteRef.current = null;
      setToast(null);
    }, UNDO_DELAY_MS);
    pendingDeleteRef.current = { id: item.id, timer };
    setToast({ message: `Deleted "${item.name}".`, undo: true });
  };

  const onUndoDelete = () => {
    if (!pendingDeleteRef.current) return;
    clearTimeout(pendingDeleteRef.current.timer);
    pendingDeleteRef.current = null;
    setToast(null);
    load(search);
  };

  const onDuplicate = async (item) => {
    await duplicateArticle(item.id);
    await load(search);
    setToast({ message: `Duplicated "${item.name}".` });
  };

  const onToggleStatus = async (item) => {
    await setArticleStatus(item.id, item.status === 'sold' ? 'in_stock' : 'sold');
    load(search);
  };

  const onExport = async (item) => {
    try {
      const croppedDataUrl = await cropImage(item.image_uri, item);
      await setExportUri(item.id, croppedDataUrl);
      downloadDataUrl(croppedDataUrl, `article_${item.id}.jpg`);
      setToast({ message: `Exported "${item.name}" — check your downloads.` });
      load(search);
    } catch (e) {
      setToast({ message: `Export failed: ${e.message}` });
    }
  };

  const statusScoped = useMemo(() => {
    if (statusFilter === 'all') return articles;
    return articles.filter((a) => (a.status === 'sold' ? 'sold' : 'in_stock') === statusFilter);
  }, [articles, statusFilter]);

  const categoriesPresent = useMemo(() => {
    const set = new Set(statusScoped.map((a) => a.category || 'Other'));
    return CATEGORIES.filter((c) => set.has(c));
  }, [statusScoped]);

  const visible = useMemo(() => {
    const filtered =
      category === 'All' ? statusScoped : statusScoped.filter((a) => (a.category || 'Other') === category);
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
        rows.sort((a, b) => getDisplayPrice(b, rate) - getDisplayPrice(a, rate));
        break;
      default:
        rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    }
    return rows;
  }, [statusScoped, category, sortBy, rate]);

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

      <div className="segmented">
        {STATUS_TABS.map((s) => (
          <button
            key={s.value}
            className={statusFilter === s.value ? 'active' : ''}
            onClick={() => setStatusFilter(s.value)}
            type="button"
          >
            {s.label}
          </button>
        ))}
      </div>

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
            <div className={`list-row ${item.status === 'sold' ? 'is-sold' : ''}`} key={item.id}>
              <img className="thumb" src={item.export_uri || item.image_uri} alt={item.name} />
              <div className="row-info">
                <div className="row-name">
                  {item.name} <span className="cat-tag">{item.category}</span>
                </div>
                <div className="row-meta">
                  {formatGrams(item.weight_grams)} · {formatPKR(getDisplayPrice(item, rate))}
                </div>
                <button
                  className={`status-pill ${item.status === 'sold' ? 'is-sold' : ''}`}
                  onClick={() => onToggleStatus(item)}
                  type="button"
                >
                  {item.status === 'sold' ? '✓ Sold — tap to restock' : 'Mark as Sold'}
                </button>
              </div>
              <div className="row-actions">
                <button className="link-btn link-edit" onClick={() => navigate(`/articles/${item.id}`)}>
                  Edit
                </button>
                <button className="link-btn link-duplicate" onClick={() => onDuplicate(item)}>
                  Duplicate
                </button>
                <button className="link-btn link-export" onClick={() => onExport(item)}>
                  Export
                </button>
                <button className="link-btn link-delete" onClick={() => onDelete(item)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="article-grid">
          {visible.map((item) => (
            <div className={`article-card ${item.status === 'sold' ? 'is-sold' : ''}`} key={item.id}>
              <div className="article-card-img">
                <img src={item.export_uri || item.image_uri} alt={item.name} />
                {item.status === 'sold' && <span className="sold-ribbon">Sold</span>}
              </div>
              <div className="article-card-body">
                <div className="row-name">{item.name}</div>
                <span className="cat-tag">{item.category}</span>
                <div className="row-meta">
                  {formatGrams(item.weight_grams)} · {formatPKR(getDisplayPrice(item, rate))}
                </div>
                <button
                  className={`status-pill ${item.status === 'sold' ? 'is-sold' : ''}`}
                  onClick={() => onToggleStatus(item)}
                  type="button"
                >
                  {item.status === 'sold' ? '✓ Sold — tap to restock' : 'Mark as Sold'}
                </button>
                <div className="article-card-actions">
                  <button className="link-btn link-edit" onClick={() => navigate(`/articles/${item.id}`)}>
                    Edit
                  </button>
                  <button className="link-btn link-duplicate" onClick={() => onDuplicate(item)}>
                    Duplicate
                  </button>
                  <button className="link-btn link-export" onClick={() => onExport(item)}>
                    Export
                  </button>
                  <button className="link-btn link-delete" onClick={() => onDelete(item)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="toast">
          <span>{toast.message}</span>
          {toast.undo && (
            <button className="toast-undo-btn" onClick={onUndoDelete} type="button">
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
