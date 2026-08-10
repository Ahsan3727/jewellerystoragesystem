import React, { useEffect, useState } from 'react';
import { getGoldRate, setGoldRate } from '../db';
import { GRAMS_PER_TOLA, formatPKR } from '../priceUtils';

export default function GoldRate() {
  const [rate, setRate] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [toast, setToast] = useState(null);

  const load = async () => {
    const r = await getGoldRate();
    setRate(r.rate ? String(r.rate) : '');
    setUpdatedAt(r.updated_at);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const save = async () => {
    const value = parseFloat(rate) || 0;
    if (value <= 0) {
      setToast('Enter a rate above 0.');
      return;
    }
    const row = await setGoldRate(value);
    setUpdatedAt(row.updated_at);
    setToast('Gold rate updated — every article price just recalculated.');
  };

  const perGram = rate ? (parseFloat(rate) || 0) / GRAMS_PER_TOLA : 0;

  return (
    <div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 18 }}>
        This is the one rate every article's price is calculated from
        (weight ÷ {GRAMS_PER_TOLA} × rate). Update it whenever the market
        rate changes — every article updates instantly, nothing to
        re-save one by one.
      </p>

      <label className="field-label">Gold Rate (Rs per tola)</label>
      <input
        className="field rate-input"
        type="number"
        inputMode="decimal"
        placeholder="e.g. 285000"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
        autoFocus
      />

      {rate && (
        <div className="price-preview" style={{ marginBottom: 18 }}>
          <span>≈ per gram</span>
          <strong>{formatPKR(perGram)}</strong>
        </div>
      )}

      <button className="btn btn-gold btn-block" onClick={save}>
        Save Today's Rate
      </button>

      {updatedAt && (
        <p className="hint">
          Last updated {new Date(updatedAt).toLocaleString('en-PK', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </p>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
