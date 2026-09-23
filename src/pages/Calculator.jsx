// src/pages/Calculator.jsx
//
// Standalone karat-purity quote tool, ported in spirit from
// jewellery-calculator's calculator screen — for a walk-in customer
// asking "what would this piece go for?" before anything is tagged or
// sold. Every number here comes from computeLineItem() in
// priceUtils.js, the same formula the Billing line editor will use, so
// a quote given here always matches what a real bill would total.
//
// Deliberately has no DB writes: nothing typed here is saved anywhere.
// The rate field is prefilled from getGoldRate() for convenience but
// is freely editable — a shop owner can quote a "what if the rate
// were X" scenario without touching the official rate on /rate.

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGoldRate } from '../db';
import { KARAT_OPTIONS, computeLineItem, formatPKR, formatGrams } from '../priceUtils';

// 21K is the karat jewellery-calculator itself opens with (its default
// kaat multiplier of 1 works out to 24 - 3(1) = 21K) — the most common
// local billing standard, so it's the sanest default here too.
const DEFAULT_KARAT = '21';

export default function Calculator() {
  const navigate = useNavigate();
  const [weight, setWeight] = useState('');
  const [stoneWeight, setStoneWeight] = useState('');
  const [karat, setKarat] = useState(DEFAULT_KARAT);
  const [rate, setRate] = useState('');
  const [makingCharge, setMakingCharge] = useState('');
  const [wastagePercent, setWastagePercent] = useState('');

  useEffect(() => {
    getGoldRate().then((r) => {
      if (r.rate) setRate(String(r.rate));
    });
  }, []);

  const result = useMemo(
    () =>
      computeLineItem({
        weight_grams: weight,
        stone_weight_grams: stoneWeight,
        karat,
        rate_per_tola: rate,
        making_charge: makingCharge,
        wastage_percent: wastagePercent,
      }),
    [weight, stoneWeight, karat, rate, makingCharge, wastagePercent]
  );

  return (
    <div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 18 }}>
        A quick quote for a walk-in question — nothing typed here is saved.
        Pick a karat, enter weight and charges, and the total updates as you type.
      </p>

      {!rate && (
        <p className="rate-warning" onClick={() => navigate('/rate')}>
          No gold rate set — enter one below just for this quote, or tap here to set today's official rate.
        </p>
      )}

      <input
        className="field"
        type="number"
        inputMode="decimal"
        step="0.001"
        placeholder="Weight (grams)"
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        autoFocus
      />

      <input
        className="field"
        type="number"
        inputMode="decimal"
        step="0.001"
        placeholder="Stone weight (grams, if any)"
        value={stoneWeight}
        onChange={(e) => setStoneWeight(e.target.value)}
      />

      <label className="field-label">Karat / Purity</label>
      <select className="field" value={karat} onChange={(e) => setKarat(e.target.value)}>
        {KARAT_OPTIONS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>

      <input
        className="field rate-input"
        type="number"
        inputMode="decimal"
        placeholder="Rate per tola (Rs)"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
      />

      <input
        className="field"
        type="number"
        inputMode="decimal"
        placeholder="Making charge (Rs per tola)"
        value={makingCharge}
        onChange={(e) => setMakingCharge(e.target.value)}
      />

      <input
        className="field"
        type="number"
        inputMode="decimal"
        step="0.1"
        placeholder="Wastage % (of gold value)"
        value={wastagePercent}
        onChange={(e) => setWastagePercent(e.target.value)}
      />

      <section className="panel">
        <h2 className="panel-title">Live Result</h2>

        <div className="stats-row">
          <CalcStat label="Gold Weight" value={formatGrams(result.goldWeight)} />
          <CalcStat label="Gold Value" value={formatPKR(result.goldValue)} />
          <CalcStat label="Making" value={formatPKR(result.makingAmount)} />
          <CalcStat label="Wastage" value={formatPKR(result.wastageAmount)} />
        </div>

        <div className="price-preview">
          <span>Total</span>
          <strong>{formatPKR(result.lineTotal)}</strong>
        </div>

        {stoneWeight && (
          <p className="hint">
            Stone weight is excluded from gold weight — only {formatGrams(result.goldWeight)} is priced as gold.
          </p>
        )}
      </section>
    </div>
  );
}

function CalcStat({ label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
