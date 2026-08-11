import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getArticle, updateArticle, getGoldRate, setArticleStatus, duplicateArticle } from '../db';
import { computePrice, formatPKR } from '../priceUtils';
import { CATEGORIES } from './ArticleTagger';

export default function ArticleForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState('in_stock');
  const [image, setImage] = useState(null);
  const [rate, setRate] = useState(0);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    getArticle(Number(id)).then((article) => {
      if (!article) {
        setError('Article not found.');
        return;
      }
      setForm({
        name: article.name,
        category: article.category || 'Other',
        weight_grams: String(article.weight_grams ?? ''),
        description: article.description || '',
      });
      setStatus(article.status === 'sold' ? 'sold' : 'in_stock');
      setImage(article.export_uri || article.image_uri);
    });
    getGoldRate().then((r) => setRate(r.rate));
  }, [id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const save = async () => {
    if (!form.name || !form.weight_grams) {
      setError('Name and weight are required.');
      return;
    }
    await updateArticle(Number(id), form);
    navigate(-1);
  };

  const toggleStatus = async () => {
    const next = status === 'sold' ? 'in_stock' : 'sold';
    await setArticleStatus(Number(id), next);
    setStatus(next);
    setToast(next === 'sold' ? 'Marked as sold.' : 'Back in stock.');
  };

  const duplicate = async () => {
    await duplicateArticle(Number(id));
    setToast('Duplicated — find the copy in Inventory.');
  };

  if (error) return <p className="empty">{error}</p>;
  if (!form) return null;

  const livePrice = computePrice(form.weight_grams, rate);

  return (
    <div>
      {image && (
        <div className="edit-photo-wrap">
          <img src={image} alt={form.name} />
        </div>
      )}

      <button className={`status-pill ${status === 'sold' ? 'is-sold' : ''}`} onClick={toggleStatus} type="button">
        {status === 'sold' ? '✓ Sold — tap to restock' : 'Mark as Sold'}
      </button>

      <input
        className="field"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="Article name"
      />

      <label className="field-label">Category / Tag</label>
      <div className="chip-row">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`chip ${form.category === c ? 'active' : ''}`}
            onClick={() => setForm({ ...form, category: c })}
            type="button"
          >
            {c}
          </button>
        ))}
      </div>

      <input
        className="field"
        value={form.weight_grams}
        onChange={(e) => setForm({ ...form, weight_grams: e.target.value })}
        placeholder="Weight (grams)"
        type="number"
        inputMode="decimal"
        step="0.001"
      />

      <div className="price-preview">
        <span>Price at today's rate</span>
        <strong>{formatPKR(livePrice)}</strong>
      </div>

      <textarea
        className="field"
        style={{ minHeight: 110 }}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        placeholder="Description"
      />
      <button className="btn btn-gold btn-block" onClick={save}>
        Save Changes
      </button>
      <button className="btn btn-outline btn-block" style={{ marginTop: 10 }} onClick={duplicate}>
        Duplicate This Article
      </button>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
