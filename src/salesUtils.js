// src/salesUtils.js
//
// Turns a flat list of sold articles into the daily / weekly / monthly
// sale records shown on the Sales screen. Pure functions only — no DB,
// no React — same spirit as priceUtils.js: one shared place this math
// happens so the numbers can't drift apart between screens.
//
// Revenue always comes from getDisplayPrice() (priceUtils.js), which
// prefers each article's own locked-in sale price over today's live
// gold rate — so a sales record for last week doesn't change just
// because the rate changed today.

import { getDisplayPrice } from './priceUtils';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Monday-start week.
function startOfWeek(d) {
  const s = startOfDay(d);
  const mondayIndexedDay = (s.getDay() + 6) % 7; // Mon=0 ... Sun=6
  s.setDate(s.getDate() - mondayIndexedDay);
  return s;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function fmtDay(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMonth(d) {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function fmtWeekRange(start) {
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: sameMonth ? undefined : 'short',
  });
  const endStr = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

// period: 'day' | 'week' | 'month'
// Returns buckets sorted newest-first, each:
//   { key, start (Date), label, count, weight, revenue, items: [article, ...] }
export function groupSoldArticles(soldArticles, period, liveRatePerTola) {
  const buckets = new Map();

  for (const article of soldArticles || []) {
    if (!article.sold_at) continue;
    const soldDate = new Date(article.sold_at);
    if (Number.isNaN(soldDate.getTime())) continue;

    let start;
    let label;
    if (period === 'week') {
      start = startOfWeek(soldDate);
      label = fmtWeekRange(start);
    } else if (period === 'month') {
      start = startOfMonth(soldDate);
      label = fmtMonth(start);
    } else {
      start = startOfDay(soldDate);
      label = fmtDay(start);
    }

    const key = start.getTime();
    if (!buckets.has(key)) {
      buckets.set(key, { key, start, label, count: 0, weight: 0, revenue: 0, items: [] });
    }
    const bucket = buckets.get(key);
    bucket.count += 1;
    bucket.weight += Number(article.weight_grams) || 0;
    bucket.revenue += getDisplayPrice(article, liveRatePerTola);
    bucket.items.push(article);
  }

  return Array.from(buckets.values()).sort((a, b) => b.start - a.start);
}

// Totals for every sold article on/after `sinceDate` — the building
// block for "Today / This Week / This Month / All Time" quick stats.
export function summarizeRange(soldArticles, sinceDate, liveRatePerTola) {
  let count = 0;
  let weight = 0;
  let revenue = 0;
  for (const article of soldArticles || []) {
    if (!article.sold_at) continue;
    const soldDate = new Date(article.sold_at);
    if (Number.isNaN(soldDate.getTime()) || soldDate < sinceDate) continue;
    count += 1;
    weight += Number(article.weight_grams) || 0;
    revenue += getDisplayPrice(article, liveRatePerTola);
  }
  return { count, weight, revenue };
}

export function todayStart() {
  return startOfDay(new Date());
}

export function thisWeekStart() {
  return startOfWeek(new Date());
}

export function thisMonthStart() {
  return startOfMonth(new Date());
}
