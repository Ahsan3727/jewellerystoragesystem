import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getArticles, getArticleStats, deleteArticle } from '../db';

export default function ArticleManager() {
  const navigate = useNavigate();
  const [articles, setArticles] = useState([]);
  const [stats, setStats] = useState({ total: 0, published: 0, drafts: 0 });
  const [search, setSearch] = useState('');

  const load = useCallback(async (term = '') => {
    setArticles(await getArticles(term));
    setStats(await getArticleStats());
  }, []);

  useEffect(() => {
    load(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const onSearch = (text) => {
    setSearch(text);
    load(text);
  };

  const onDelete = async (e, id, title) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${title}"?`)) return;
    await deleteArticle(id);
    load(search);
  };

  return (
    <div>
      <div className="stats-row">
        <Stat label="Total" value={stats.total} />
        <Stat label="Published" value={stats.published} />
        <Stat label="Drafts" value={stats.drafts} />
      </div>

      <input
        className="field search-field"
        placeholder="Search articles..."
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />

      {articles.length === 0 && <p className="empty">No articles yet.</p>}

      {articles.map((item) => (
        <div className="article-row" key={item.id} onClick={() => navigate(`/articles/${item.id}`)}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row-name">{item.title}</div>
            <div className="row-meta">
              {item.category} · {item.author}
            </div>
          </div>
          <span className={`badge ${item.status === 'published' ? 'badge-published' : 'badge-draft'}`}>
            {item.status}
          </span>
          <button className="link-btn link-delete" onClick={(e) => onDelete(e, item.id, item.title)}>
            Delete
          </button>
        </div>
      ))}

      <button className="btn btn-gold btn-block" style={{ marginTop: 10 }} onClick={() => navigate('/articles/new')}>
        + Add New Article
      </button>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
