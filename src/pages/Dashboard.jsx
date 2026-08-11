// src/pages/Dashboard.jsx  (was Home.jsx)
//
// The old Home screen was a rate ticker + stats, then a vertical stack
// of five nav buttons — the entire main navigation lived inside the
// scrollable page content. Now that navigation is a persistent
// sidebar/bottom-bar (see AppShell), this screen can actually earn its
// place as a dashboard: quick actions for the two most common tasks,
// a per-category weight breakdown (useful the moment a shop has more
// than a handful of pieces), and a peek at what was tagged most
// recently.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getArticles, getArticleStats, getGoldRate } from '../db';
import { computePrice, formatPKR, formatGrams } from '../priceUtils';

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ inStockCount: 0, inStockWeight: 0, soldCount: 0 });
  const [rate, setRate] = useState({ rate: 0, updated_at: null });
  const [breakdown, setBreakdown] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getArticleStats().then(setStats);
    getGoldRate().then(setRate);
    getArticles().then((all) => {
      setRecent(all.slice(0, 4));

      const byCategory = new Map();
      for (const a of all) {
        if (a.status === 'sold') continue; // breakdown reflects what's on the floor right now
        const cat = a.category || 'Other';
        const entry = byCategory.get(cat) || { category: cat, count: 0, weight: 0 };
        entry.count += 1;
        entry.weight += Number(a.weight_grams) || 0;
        byCategory.set(cat, entry);
      }
      setBreakdown(Array.from(byCategory.values()).sort((a, b) => b.weight - a.weight));
      setLoaded(true);
    });
  }, []);

  const inStockValue = computePrice(stats.inStockWeight, rate.rate);
  const maxWeight = breakdown.length ? Math.max(...breakdown.map((b) => b.weight)) : 0;

  return (
    <div>
      <button className="rate-ticker" onClick={() => navigate('/rate')} type="button">
        <div>
          <span className="rate-ticker-label">Today's Gold Rate</span>
          <span className="rate-ticker-value">
            {rate.rate ? `${formatPKR(rate.rate)} / tola` : 'Not set yet'}
          </span>
        </div>
        <span className="rate-ticker-edit">Edit →</span>
      </button>

      <div className="stats-row">
        <StatCard label="In Stock" value={stats.inStockCount} />
        <StatCard label="Stock Weight" value={formatGrams(stats.inStockWeight)} small />
        <StatCard label="Stock Value" value={formatPKR(inStockValue)} small />
        <StatCard label="Sold" value={stats.soldCount} accent="muted" />
      </div>

      <div className="quick-actions">
        <button className="quick-action quick-action-primary" onClick={() => navigate('/tag')} type="button">
          <span className="quick-action-icon">💎</span>
          <span>Tag New Article</span>
        </button>
        <button className="quick-action" onClick={() => navigate('/inventory/list')} type="button">
          <span className="quick-action-icon">📦</span>
          <span>View Inventory</span>
        </button>
        <button className="quick-action" onClick={() => navigate('/inventory/board')} type="button">
          <span className="quick-action-icon">🗂️</span>
          <span>Photo Boards</span>
        </button>
      </div>

      {loaded && breakdown.length === 0 && recent.length === 0 && (
        <div className="panel">
          <p className="empty" style={{ marginTop: 0 }}>
            Nothing tagged yet — start with "Tag New Article" above.
          </p>
        </div>
      )}

      {breakdown.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">In Stock, By Category</h2>
          <div className="category-bars">
            {breakdown.map((b) => (
              <div className="category-bar-row" key={b.category}>
                <div className="category-bar-head">
                  <span>{b.category}</span>
                  <span className="category-bar-meta">
                    {b.count} · {formatGrams(b.weight)}
                  </span>
                </div>
                <div className="category-bar-track">
                  <div
                    className="category-bar-fill"
                    style={{ width: `${maxWeight ? (b.weight / maxWeight) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="panel">
          <div className="panel-head-row">
            <h2 className="panel-title">Recently Tagged</h2>
            <button className="link-btn link-edit" onClick={() => navigate('/inventory/list')} type="button">
              See all
            </button>
          </div>
          {recent.map((item) => (
            <button
              key={item.id}
              className="list-row list-row-link"
              onClick={() => navigate(`/articles/${item.id}`)}
              type="button"
            >
              <img className="thumb" src={item.export_uri || item.image_uri} alt={item.name} />
              <div className="row-info">
                <div className="row-name">
                  {item.name} <span className="cat-tag">{item.category}</span>
                  {item.status === 'sold' && <span className="sold-badge">Sold</span>}
                </div>
                <div className="row-meta">
                  {formatGrams(item.weight_grams)} · {formatPKR(computePrice(item.weight_grams, rate.rate))}
                </div>
              </div>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, small, accent }) {
  const valueClass = ['stat-value', small && 'stat-value-small', accent === 'muted' && 'stat-value-muted']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="stat-card">
      <div className={valueClass}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
