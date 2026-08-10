import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addArticle, updateArticle, getArticle } from '../db';

const CATEGORIES = [
  'Diamond Guides',
  'Ring Care',
  'Necklace Styles',
  'Visual Merchandising',
  'Pricing Strategies',
  'Inventory Management',
];

export default function ArticleForm() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '',
    category: CATEGORIES[0],
    author: '',
    status: 'draft',
    content: '',
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isNew) return;
    getArticle(Number(id)).then((article) => {
      if (!article) {
        setError('Article not found.');
        return;
      }
      setForm({
        title: article.title,
        category: article.category,
        author: article.author || '',
        status: article.status,
        content: article.content || '',
      });
    });
  }, [id, isNew]);

  const save = async () => {
    if (!form.title) {
      setError('Title is required.');
      return;
    }
    if (isNew) {
      await addArticle(form);
    } else {
      await updateArticle(Number(id), form);
    }
    navigate(-1);
  };

  if (error) return <p className="empty">{error}</p>;

  return (
    <div>
      <input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" />
      <input className="field" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} placeholder="Author" />

      <label className="field-label">Category</label>
      <div className="chip-row">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`chip ${form.category === c ? 'active' : ''}`}
            onClick={() => setForm({ ...form, category: c })}
          >
            {c}
          </button>
        ))}
      </div>

      <label className="field-label">Status</label>
      <div className="chip-row">
        {['draft', 'published'].map((s) => (
          <button
            key={s}
            className={`chip ${form.status === s ? 'active' : ''}`}
            onClick={() => setForm({ ...form, status: s })}
          >
            {s}
          </button>
        ))}
      </div>

      <textarea
        className="field"
        style={{ minHeight: 170 }}
        value={form.content}
        onChange={(e) => setForm({ ...form, content: e.target.value })}
        placeholder="Article content..."
      />

      <button className="btn btn-gold btn-block" style={{ marginTop: 8, marginBottom: 20 }} onClick={save}>
        {isNew ? 'Create Article' : 'Save Changes'}
      </button>
    </div>
  );
}
