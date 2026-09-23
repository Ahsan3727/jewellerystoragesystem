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

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getArticles, getArticleStats, getGoldRate, getBills, getInventoryThresholds } from '../db';
import { computePrice, getDisplayPrice, getGoldWeight, formatPKR, formatGrams } from '../priceUtils';
import { summarizeRange, todayStart, thisWeekStart } from '../salesUtils';
import { summarizeBillRange } from '../billUtils';
import { getAgingArticles, getLowStockCategories } from '../inventoryUtils';

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ inStockCount: 0, inStockWeight: 0, inStockGoldWeight: 0, soldCount: 0 });
  const [rate, setRate] = useState({ rate: 0, updated_at: null });
  const [breakdown, setBreakdown] = useState([]);
  const [recent, setRecent] = useState([]);
  const [allArticles, setAllArticles] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // Real, itemized bills (Phase 0+) — separate from the article-level
  // "Sold Today" ticker further down, which reads whichever articles
  // happen to carry status 'sold' (still true even for a piece marked
  // sold outside Billing entirely — see getSoldArticles() in db.js).
  // This card is the Billing-specific view: what actually got billed,
  // sourced from billUtils.js the same way BillingHome.jsx is.
  const [bills, setBills] = useState([]);
  // Low-stock / aging thresholds (Phase 5C) — user-editable on
  // Settings.jsx, defaults applied defensively there if the shop owner
  // never visits that panel (see getInventoryThresholds() in db.js).
  const [thresholds, setThresholds] = useState({ low_stock_count: 2, aging_days: 60 });

  useEffect(() => {
    getArticleStats().then(setStats);
    getGoldRate().then(setRate);
    getBills().then(setBills);
    getInventoryThresholds().then(setThresholds);
    getArticles().then((all) => {
      setRecent(all.slice(0, 4));
      setAllArticles(all);

      const byCategory = new Map();
      for (const a of all) {
        if (a.status === 'sold') continue; // breakdown reflects what's on the floor right now
        const cat = a.category || 'Other';
        const entry = byCategory.get(cat) || { category: cat, count: 0, weight: 0, goldWeight: 0 };
        entry.count += 1;
        // weight: what the scale actually reads (gold + any stones).
        entry.weight += Number(a.weight_grams) || 0;
        // goldWeight: stone_weight_grams subtracted out — the part of
        // this category that's actually gold, and so the only part
        // that should ever be priced at the gold rate. See
        // priceUtils.getGoldWeight for the shared deduction logic used
        // everywhere else in the app (Stock Value above, Sales, the
        // article list, etc.) so this bar's value line matches them.
        entry.goldWeight += getGoldWeight(a.weight_grams, a.stone_weight_grams);
        byCategory.set(cat, entry);
      }
      setBreakdown(Array.from(byCategory.values()).sort((a, b) => b.weight - a.weight));
      setLoaded(true);
    });
  }, []);

  // Stock Value is priced off gold weight only (scale weight minus any
  // stone weight) — see priceUtils.getGoldWeight — so stone-set pieces
  // aren't valued as if their stones were gold too.
  const inStockValue = computePrice(stats.inStockGoldWeight, rate.rate);
  const maxWeight = breakdown.length ? Math.max(...breakdown.map((b) => b.weight)) : 0;

  const soldToday = useMemo(() => {
    const soldOnly = allArticles.filter((a) => a.status === 'sold');
    return summarizeRange(soldOnly, todayStart(), rate.rate);
  }, [allArticles, rate.rate]);

  // Bills Today / This Week (Phase 4) — a bill's own locked `total`,
  // same as BillingHome.jsx's KPI cards, so this figure never drifts
  // from what the Billing screen itself shows for the same range.
  const billsToday = useMemo(() => summarizeBillRange(bills, todayStart()), [bills]);
  const billsThisWeek = useMemo(() => summarizeBillRange(bills, thisWeekStart()), [bills]);

  // Nudges (Phase 5C) — pure filtering over the same allArticles list
  // already fetched above, via inventoryUtils.js so this math lives in
  // exactly one place. Recomputes automatically whenever the thresholds
  // change on Settings.jsx and this screen is next loaded.
  const aging = useMemo(
    () => getAgingArticles(allArticles, thresholds.aging_days),
    [allArticles, thresholds.aging_days]
  );
  const lowStock = useMemo(
    () => getLowStockCategories(allArticles, thresholds.low_stock_count),
    [allArticles, thresholds.low_stock_count]
  );

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
        <button className="quick-action" onClick={() => navigate('/billing')} type="button">
          <span className="quick-action-icon">🧾</span>
          <span>Billing</span>
        </button>
      </div>

      <button className="rate-ticker rate-ticker-sales" onClick={() => navigate('/billing')} type="button">
        <div>
          <span className="rate-ticker-label">Sold Today</span>
          <span className="rate-ticker-value">
            {soldToday.count} item{soldToday.count === 1 ? '' : 's'} · {formatPKR(soldToday.revenue)}
          </span>
        </div>
        <span className="rate-ticker-edit">Billing →</span>
      </button>

      <section className="panel">
        <div className="panel-head-row">
          <h2 className="panel-title">Billing</h2>
          <button className="link-btn link-edit" onClick={() => navigate('/billing')} type="button">
            See all
          </button>
        </div>
        <div className="stats-row">
          <StatCard label="Bills Today" value={billsToday.count} sub={formatPKR(billsToday.revenue)} />
          <StatCard label="Bills This Week" value={billsThisWeek.count} sub={formatPKR(billsThisWeek.revenue)} />
        </div>
      </section>

      {/* Only renders when there's actually something to flag — same
          "nothing extra for a healthy shop" instinct as the empty state
          just below. */}
      {loaded && (aging.length > 0 || lowStock.length > 0) && (
        <section className="panel">
          <h2 className="panel-title">Nudges</h2>
          {lowStock.map((c) => (
            <button
              key={c.category}
              className="list-row list-row-link"
              onClick={() => navigate('/inventory/list')}
              type="button"
            >
              <div className="row-info">
                <div className="row-name">
                  ⚠️ Only {c.count} {c.category} left in stock.
                </div>
              </div>
            </button>
          ))}
          {aging.length > 0 && (
            <button className="list-row list-row-link" onClick={() => navigate('/inventory/list')} type="button">
              <div className="row-info">
                <div className="row-name">
                  ⚠️ {aging.length} piece{aging.length === 1 ? '' : 's'} have been in stock over{' '}
                  {thresholds.aging_days} days.
                </div>
              </div>
            </button>
          )}
        </section>
      )}

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
            {breakdown.map((b) => {
              const hasStones = b.goldWeight < b.weight;
              // Same computePrice() the rest of the app uses, fed the
              // stone-deducted weight — so this figure always matches
              // what these pieces would actually total on Stock Value.
              const categoryValue = computePrice(b.goldWeight, rate.rate);
              return (
                <div className="category-bar-row" key={b.category}>
                  <div className="category-bar-head">
                    <span>{b.category}</span>
                    <span className="category-bar-meta">
                      {b.count} · {formatGrams(b.weight)}
                      {hasStones ? ` (${formatGrams(b.goldWeight)} gold)` : ''}
                    </span>
                  </div>
                  <div className="category-bar-track">
                    <div
                      className="category-bar-fill"
                      style={{ width: `${maxWeight ? (b.weight / maxWeight) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="category-bar-value">{formatPKR(categoryValue)}</div>
                </div>
              );
            })}
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
                  {formatGrams(item.weight_grams)} · {formatPKR(getDisplayPrice(item, rate.rate))}
                </div>
              </div>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, small, accent, sub }) {
  const valueClass = ['stat-value', small && 'stat-value-small', accent === 'muted' && 'stat-value-muted']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="stat-card">
      <div className={valueClass}>{value}</div>
      <div className="stat-label">{label}</div>
      {/* sub is optional (Phase 4's Billing card uses it for revenue,
          matching BillingHome.jsx's own BillStat) — every earlier
          caller of StatCard omits it, so this renders nothing there. */}
      {sub != null && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
