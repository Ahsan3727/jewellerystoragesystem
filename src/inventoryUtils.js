// src/inventoryUtils.js
//
// Pure functions over the article list Dashboard.jsx already fetches —
// no DB, no React — same spirit as salesUtils.js/billUtils.js: one
// shared place this logic lives so Dashboard's nudges (and any other
// screen that needs the same numbers later) always compute them the
// same way, rather than each screen re-filtering the article list
// inline.

const DAY_MS = 24 * 60 * 60 * 1000;

// Every in_stock article whose created_at is older than `days` ago,
// oldest first. Sold articles are irrelevant here — an aging nudge is
// about what's still sitting unsold, not about what already moved (a
// piece that sold the day it was tagged shouldn't count against it).
export function getAgingArticles(articles, days = 60) {
  const cutoff = Date.now() - days * DAY_MS;
  return (articles || [])
    .filter((a) => a.status !== 'sold' && a.created_at && new Date(a.created_at).getTime() < cutoff)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

// Categories whose in_stock count is at or below `threshold`, most
// depleted first — the same byCategory grouping shape Dashboard.jsx
// already builds inline for its "In Stock, By Category" bars, just
// extracted here so it's testable on its own and reusable without
// duplicating the grouping logic a second time.
export function getLowStockCategories(articles, threshold = 2) {
  const counts = new Map();
  for (const a of articles || []) {
    if (a.status === 'sold') continue;
    const category = a.category || 'Other';
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .filter((c) => c.count <= threshold)
    .sort((a, b) => a.count - b.count);
}
