import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getArticleStats, getGoldRate } from '../db';
import { computePrice, formatPKR, formatGrams } from '../priceUtils';

export default function Home() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ total: 0, totalWeight: 0 });
  const [rate, setRate] = useState({ rate: 0, updated_at: null });

  useEffect(() => {
    getArticleStats().then(setStats);
    getGoldRate().then(setRate);
  }, []);

  const totalValue = computePrice(stats.totalWeight, rate.rate);

  return (
    <div>
      <button className="rate-ticker" onClick={() => navigate('/rate')}>
        <div>
          <span className="rate-ticker-label">Today's Gold Rate</span>
          <span className="rate-ticker-value">
            {rate.rate ? `${formatPKR(rate.rate)} / tola` : 'Not set yet'}
          </span>
        </div>
        <span className="rate-ticker-edit">Edit →</span>
      </button>

      <div className="stats-row">
        <StatCard label="Articles" value={stats.total} />
        <StatCard label="Total Weight" value={formatGrams(stats.totalWeight)} small />
        <StatCard label="Inventory Value" value={formatPKR(totalValue)} small />
      </div>

      <button className="nav-card" onClick={() => navigate('/tag')}>
        <div className="nav-card-title">💎 Tag a New Article</div>
        <div className="nav-card-sub">Take a photo or upload one, then drop blocks on each piece</div>
      </button>

      <button className="nav-card" onClick={() => navigate('/articles')}>
        <div className="nav-card-title">📦 View Articles</div>
        <div className="nav-card-sub">Browse, edit, export, or delete tagged pieces</div>
      </button>

      <button className="nav-card" onClick={() => navigate('/rate')}>
        <div className="nav-card-title">💰 Gold Rate</div>
        <div className="nav-card-sub">Set today's rate — every price updates automatically</div>
      </button>
    </div>
  );
}

function StatCard({ label, value, small }) {
  return (
    <div className="stat-card">
      <div className={small ? 'stat-value stat-value-small' : 'stat-value'}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
