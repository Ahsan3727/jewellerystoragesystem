// src/pages/Sales.jsx
//
// The shop's sale record. Everything marked "Sold" (from Inventory,
// the photo board, or an article's own edit screen) shows up here,
// grouped Daily / Weekly / Monthly, with Today / This Week / This
// Month / All Time totals up top.
//
// Every revenue number here comes from getDisplayPrice() — each sale's
// own weight × the gold rate on the day it was actually sold — not
// today's rate. That's what makes these records stable: last month's
// total won't quietly shift just because the gold rate changed today.

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSoldArticles, getGoldRate } from '../db';
import { getDisplayPrice, formatPKR, formatGrams } from '../priceUtils';
import { groupSoldArticles, summarizeRange, todayStart, thisWeekStart, thisMonthStart } from '../salesUtils';

const PERIODS = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

const EPOCH = new Date(0);

export default function Sales() {
  const navigate = useNavigate();
  const [sold, setSold] = useState([]);
  const [rate, setRate] = useState(0);
  const [period, setPeriod] = useState('day');
  const [expandedKey, setExpandedKey] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([getSoldArticles(), getGoldRate()]).then(([soldArticles, r]) => {
      setSold(soldArticles);
      setRate(r.rate);
      setLoaded(true);
    });
  }, []);

  const today = useMemo(() => summarizeRange(sold, todayStart(), rate), [sold, rate]);
  const week = useMemo(() => summarizeRange(sold, thisWeekStart(), rate), [sold, rate]);
  const month = useMemo(() => summarizeRange(sold, thisMonthStart(), rate), [sold, rate]);
  const allTime = useMemo(() => summarizeRange(sold, EPOCH, rate), [sold, rate]);

  const groups = useMemo(() => groupSoldArticles(sold, period, rate), [sold, period, rate]);
  const maxRevenue = groups.length ? Math.max(...groups.map((g) => g.revenue)) : 0;

  return (
    <div>
      <div className="stats-row">
        <SaleStat label="Today" count={today.count} revenue={today.revenue} />
        <SaleStat label="This Week" count={week.count} revenue={week.revenue} />
        <SaleStat label="This Month" count={month.count} revenue={month.revenue} />
        <SaleStat label="All Time" count={allTime.count} revenue={allTime.revenue} accent="muted" />
      </div>

      <div className="tab-row">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            className={`tab-btn ${period === p.value ? 'active' : ''}`}
            onClick={() => {
              setPeriod(p.value);
              setExpandedKey(null);
            }}
            type="button"
          >
            {p.label}
          </button>
        ))}
      </div>

      {loaded && sold.length === 0 && (
        <div className="panel">
          <p className="empty" style={{ marginTop: 0 }}>
            Nothing sold yet — mark an article "Sold" from Inventory and it'll show up here.
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">
            {period === 'day' ? 'Daily Sale Record' : period === 'week' ? 'Weekly Sale Record' : 'Monthly Sale Record'}
          </h2>
          <div className="sales-groups">
            {groups.map((g) => {
              const isOpen = expandedKey === g.key;
              return (
                <div className="sales-group" key={g.key}>
                  <button
                    className="sales-group-head"
                    onClick={() => setExpandedKey(isOpen ? null : g.key)}
                    type="button"
                  >
                    <span className="sales-group-label">{g.label}</span>
                    <span className="sales-group-caret">{isOpen ? '▲' : '▼'}</span>
                  </button>
                  <div className="category-bar-track">
                    <div
                      className="category-bar-fill"
                      style={{ width: `${maxRevenue ? (g.revenue / maxRevenue) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="sales-group-meta">
                    {g.count} sold · {formatGrams(g.weight)} · <strong>{formatPKR(g.revenue)}</strong>
                  </div>

                  {isOpen && (
                    <div className="sales-group-items">
                      {g.items
                        .slice()
                        .sort((a, b) => (a.sold_at < b.sold_at ? 1 : -1))
                        .map((item) => (
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
                              </div>
                              <div className="row-meta">
                                {formatGrams(item.weight_grams)} · {formatPKR(getDisplayPrice(item, rate))}
                              </div>
                              <div className="row-meta">
                                Sold{' '}
                                {new Date(item.sold_at).toLocaleDateString('en-GB', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </div>
                            </div>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function SaleStat({ label, count, revenue, accent }) {
  const valueClass = ['stat-value', accent === 'muted' && 'stat-value-muted'].filter(Boolean).join(' ');
  return (
    <div className="stat-card">
      <div className={valueClass}>{count}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-sub">{formatPKR(revenue)}</div>
    </div>
  );
}
