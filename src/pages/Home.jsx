import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProductStats, getArticleStats } from '../db';

export default function Home() {
  const navigate = useNavigate();
  const [productStats, setProductStats] = useState({ total: 0 });
  const [articleStats, setArticleStats] = useState({ total: 0, published: 0, drafts: 0 });

  useEffect(() => {
    getProductStats().then(setProductStats);
    getArticleStats().then(setArticleStats);
  }, []);

  return (
    <div>
      <div className="stats-row">
        <StatCard label="Products" value={productStats.total} />
        <StatCard label="Articles" value={articleStats.total} />
        <StatCard label="Published" value={articleStats.published} />
      </div>

      <button className="nav-card" onClick={() => navigate('/tag')}>
        <div className="nav-card-title">💎 Tag a New Product</div>
        <div className="nav-card-sub">Pick a photo and drop price tags on items</div>
      </button>

      <button className="nav-card" onClick={() => navigate('/products')}>
        <div className="nav-card-title">📦 View Products</div>
        <div className="nav-card-sub">Browse, edit, export, or delete tagged items</div>
      </button>

      <button className="nav-card" onClick={() => navigate('/articles')}>
        <div className="nav-card-title">📝 Article Manager</div>
        <div className="nav-card-sub">Create and manage shop blog articles</div>
      </button>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
