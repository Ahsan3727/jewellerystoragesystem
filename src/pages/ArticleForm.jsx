import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getArticle, updateArticle, getGoldRate } from '../db';
import { computePrice, formatPKR } from '../priceUtils';
import { CATEGORIES } from './ArticleTagger';

export default function ArticleForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [image, setImage] = useState(null);
  const [rate, setRate] = useState(0);
  const [error, setError] = useState(null);

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
      setImage(article.export_uri || article.image_uri);
    });
    getGoldRate().then((r) => setRate(r.rate));
  }, [id]);

  const save = async () => {
    if (!form.name || !form.weight_grams) {
      setError('Name and weight are required.');
      return;
    }
    await updateArticle(Number(id), form);
    navigate(-1);
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
    </div>
  );
}
