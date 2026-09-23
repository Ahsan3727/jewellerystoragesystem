// src/pages/BillNew.jsx
//
// The Billing core: pick in-stock articles, price each line at
// whatever karat it's actually sold at, attach a customer, and
// Finalize — one call to createBill() in db.js, which locks every
// number on the bill and flips the selected articles to sold, all in
// one atomic transaction. Nothing on this screen recomputes a bill
// after the fact; that's the whole point of a bill being a snapshot
// (see the "Never let a bill's math be recomputed later" rule at the
// top of the implementation plan).
//
// Finalize redirects straight to BillView.jsx (the bill's own
// printable invoice, added in Phase 3) rather than showing an inline
// success summary here — that invoice is the one true "here's what
// was just saved" view, so there's no reason for this screen to keep
// its own copy of it.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getArticles, getGoldRate, getNextBillNumber, findCustomerByPhone, createBill } from '../db';
import { KARAT_OPTIONS, computeLineItem, getDisplayPrice, formatPKR, formatGrams } from '../priceUtils';
import { CATEGORIES } from './ArticleTagger';

// Same "most common local billing standard" default the Calculator
// opens with (see Calculator.jsx) — kept as a string so it matches a
// <select>'s value directly without a number/string mismatch.
const DEFAULT_KARAT = '21';

function emptyLineConfig() {
  return { karat: DEFAULT_KARAT, making_charge: '', wastage_percent: '' };
}

export default function BillNew() {
  const navigate = useNavigate();

  // Picker
  const [articles, setArticles] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [rate, setRate] = useState(0);
  const [nextBillNo, setNextBillNo] = useState(null);

  // Selection + per-line pricing
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [lineConfig, setLineConfig] = useState({}); // { [article_id]: { karat, making_charge, wastage_percent } }

  // Customer
  const [phone, setPhone] = useState('');
  const [customerMatch, setCustomerMatch] = useState(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerAddress, setNewCustomerAddress] = useState('');

  // Totals
  const [discountType, setDiscountType] = useState('flat'); // 'flat' | 'percent'
  const [discountValue, setDiscountValue] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [amountPaidTouched, setAmountPaidTouched] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    const [all, r, nb] = await Promise.all([getArticles(), getGoldRate(), getNextBillNumber()]);
    setArticles(all.filter((a) => a.status === 'in_stock'));
    setRate(r.rate);
    setNextBillNo(nb);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // Phone lookup — a plain exact-match index read (same as
  // findCustomerByPhone's own contract), so this only resolves once the
  // full number is typed. Cheap local IndexedDB read, no debounce needed.
  useEffect(() => {
    if (!phone) {
      setCustomerMatch(null);
      return;
    }
    let cancelled = false;
    findCustomerByPhone(phone).then((c) => {
      if (!cancelled) setCustomerMatch(c || null);
    });
    return () => {
      cancelled = true;
    };
  }, [phone]);

  const categoriesPresent = useMemo(() => {
    const set = new Set(articles.map((a) => a.category || 'Other'));
    return CATEGORIES.filter((c) => set.has(c));
  }, [articles]);

  const visibleArticles = useMemo(() => {
    let rows = articles;
    if (category !== 'All') rows = rows.filter((a) => (a.category || 'Other') === category);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((a) => a.name.toLowerCase().includes(q) || (a.category || '').toLowerCase().includes(q));
    }
    return rows;
  }, [articles, category, search]);

  const toggleSelect = (article) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(article.id)) next.delete(article.id);
      else next.add(article.id);
      return next;
    });
    // Seed sensible defaults the first time an article is selected;
    // leave its config alone if it's just being re-added after removal.
    setLineConfig((prev) => (prev[article.id] ? prev : { ...prev, [article.id]: emptyLineConfig() }));
  };

  const removeLine = (articleId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(articleId);
      return next;
    });
  };

  const updateLineConfig = (articleId, patch) => {
    setLineConfig((prev) => ({ ...prev, [articleId]: { ...prev[articleId], ...patch } }));
  };

  const selectedArticles = useMemo(() => articles.filter((a) => selectedIds.has(a.id)), [articles, selectedIds]);

  // The one shared formula (computeLineItem, in priceUtils.js) — the
  // exact same call createBill() makes inside its transaction, so what
  // this screen previews is guaranteed to match what actually gets
  // saved.
  const computedLines = useMemo(
    () =>
      selectedArticles.map((article) => {
        const cfg = lineConfig[article.id] || emptyLineConfig();
        const computed = computeLineItem({
          weight_grams: article.weight_grams,
          stone_weight_grams: article.stone_weight_grams,
          karat: cfg.karat,
          rate_per_tola: rate,
          making_charge: cfg.making_charge,
          wastage_percent: cfg.wastage_percent,
        });
        return { article, cfg, computed };
      }),
    [selectedArticles, lineConfig, rate]
  );

  const subtotal = useMemo(() => computedLines.reduce((sum, l) => sum + l.computed.lineTotal, 0), [computedLines]);

  // Mirrors createBill()'s own discount math exactly (round once, here,
  // rather than off unrounded intermediates — point 7) so this preview
  // never drifts from what Finalize will actually save.
  const discountAmount = useMemo(() => {
    const v = Number(discountValue) || 0;
    return discountType === 'percent' ? Math.round(subtotal * (v / 100)) : Math.round(v);
  }, [discountType, discountValue, subtotal]);

  const total = Math.max(0, subtotal - discountAmount);

  // Defaults amount paid to "paid in full" whenever the total changes,
  // until the shop owner actually edits the field themselves — a
  // partial/unpaid sale is the exception, not the rule.
  useEffect(() => {
    if (!amountPaidTouched) setAmountPaid(total > 0 ? String(total) : '');
  }, [total, amountPaidTouched]);

  const paymentStatus = useMemo(() => {
    const paid = Math.round(Number(amountPaid) || 0);
    if (paid <= 0) return 'unpaid';
    if (paid >= total) return 'paid';
    return 'partial';
  }, [amountPaid, total]);

  const canFinalize = rate > 0 && selectedArticles.length > 0 && !submitting;

  const onFinalize = async () => {
    if (!canFinalize) return;
    setSubmitting(true);
    try {
      const items = selectedArticles.map((article) => {
        const cfg = lineConfig[article.id] || emptyLineConfig();
        return {
          article_id: article.id,
          karat: cfg.karat,
          making_charge: cfg.making_charge,
          wastage_percent: cfg.wastage_percent,
        };
      });
      // Matched an existing customer → resolve by id, so createBill()
      // trusts the db's own copy of their name rather than anything
      // retyped here. No phone at all → {} on purpose: createBill()
      // leaves customer_id null and labels the bill "Walk-in Customer"
      // rather than creating a blank customer row for every walk-in.
      const customerPayload = customerMatch
        ? { id: customerMatch.id }
        : phone
        ? { name: newCustomerName, phone, address: newCustomerAddress }
        : {};

      const bill = await createBill({
        rate_per_tola: rate,
        items,
        customer: customerPayload,
        discount: { type: discountType, value: discountValue },
        amount_paid: amountPaid,
        // payment_status intentionally omitted — db.js derives it from
        // amount_paid vs. total itself, so there's exactly one place
        // that decides paid/partial/unpaid, matching what this screen
        // already previews above.
      });
      // The bill is already fully saved at this point — every article
      // on it already flipped to sold inside createBill()'s own
      // transaction. Navigating away doesn't risk losing anything;
      // BillView.jsx reads the same row straight back out of "bills".
      navigate(`/billing/${bill.id}`);
      return;
    } catch (err) {
      // Most likely cause: one of these articles was sold elsewhere
      // between selection and Finalize (point 3) — createBill() already
      // re-checked and rejected cleanly, so just refresh the picker and
      // surface its message.
      setToast(err.message || 'Could not create the bill.');
      load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        This will be <strong>Bill #{nextBillNo ?? '…'}</strong>. Pick articles, price each line, attach a customer,
        then Finalize — every number locks in and the selected articles are marked sold, all in one step.
      </p>

      {rate === 0 && (
        <p className="rate-warning" onClick={() => navigate('/rate')}>
          No gold rate set — set today's rate before creating a bill.
        </p>
      )}

      <h2 className="panel-title">1. Select Articles</h2>

      <input
        className="field search-field"
        placeholder="Search in-stock articles..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {categoriesPresent.length > 0 && (
        <div className="chip-row scroll-x">
          <button className={`chip ${category === 'All' ? 'active' : ''}`} onClick={() => setCategory('All')} type="button">
            All
          </button>
          {categoriesPresent.map((c) => (
            <button
              key={c}
              className={`chip ${category === c ? 'active' : ''}`}
              onClick={() => setCategory(c)}
              type="button"
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {visibleArticles.length === 0 && (
        <p className="empty">
          {articles.length === 0 ? 'Nothing in stock to bill — tag some articles first.' : 'No articles match.'}
        </p>
      )}

      <div>
        {visibleArticles.map((item) => {
          const selected = selectedIds.has(item.id);
          return (
            <div className="list-row" key={item.id}>
              <img className="thumb" src={item.export_uri || item.image_uri} alt={item.name} />
              <div className="row-info">
                <div className="row-name">
                  {item.name} <span className="cat-tag">{item.category}</span>
                </div>
                <div className="row-meta">
                  {formatGrams(item.weight_grams)} · {formatPKR(getDisplayPrice(item, rate))}
                </div>
                <button
                  className={`status-pill ${selected ? 'is-selected' : ''}`}
                  onClick={() => toggleSelect(item)}
                  type="button"
                >
                  {selected ? '✓ Added — tap to remove' : 'Add to Bill'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {computedLines.length > 0 && (
        <>
          <h2 className="panel-title" style={{ marginTop: 22 }}>
            2. Line Items ({computedLines.length})
          </h2>
          {computedLines.map(({ article, cfg, computed }) => (
            <div className="panel" key={article.id} style={{ marginBottom: 10 }}>
              <div className="panel-head-row">
                <div>
                  <div className="row-name">
                    {article.name} <span className="cat-tag">{article.category}</span>
                  </div>
                  <div className="row-meta">
                    {formatGrams(article.weight_grams)}
                    {article.stone_weight_grams ? ` · ${formatGrams(computed.goldWeight)} gold` : ''}
                  </div>
                </div>
                <button className="link-btn link-delete" onClick={() => removeLine(article.id)} type="button">
                  Remove
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <select
                  className="field"
                  style={{ flex: '1 1 120px', marginBottom: 0 }}
                  value={cfg.karat}
                  onChange={(e) => updateLineConfig(article.id, { karat: e.target.value })}
                >
                  {KARAT_OPTIONS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <input
                  className="field"
                  style={{ flex: '1 1 100px', marginBottom: 0 }}
                  type="number"
                  inputMode="decimal"
                  placeholder="Making (Rs/tola)"
                  value={cfg.making_charge}
                  onChange={(e) => updateLineConfig(article.id, { making_charge: e.target.value })}
                />
                <input
                  className="field"
                  style={{ flex: '1 1 100px', marginBottom: 0 }}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  placeholder="Wastage %"
                  value={cfg.wastage_percent}
                  onChange={(e) => updateLineConfig(article.id, { wastage_percent: e.target.value })}
                />
              </div>

              <div className="price-preview" style={{ marginTop: 10, marginBottom: 0 }}>
                <span>Line total</span>
                <strong>{formatPKR(computed.lineTotal)}</strong>
              </div>
            </div>
          ))}
        </>
      )}

      <h2 className="panel-title" style={{ marginTop: 22 }}>
        3. Customer
      </h2>

      <input
        className="field"
        type="tel"
        inputMode="tel"
        placeholder="Phone number"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />

      {phone && customerMatch && (
        <p className="hint" style={{ marginTop: -6 }}>
          Returning customer — <strong>{customerMatch.name}</strong>
          {customerMatch.address ? `, ${customerMatch.address}` : ''}
        </p>
      )}

      {phone && !customerMatch && (
        <>
          <input
            className="field"
            placeholder="Customer name"
            value={newCustomerName}
            onChange={(e) => setNewCustomerName(e.target.value)}
          />
          <input
            className="field"
            placeholder="Address (optional)"
            value={newCustomerAddress}
            onChange={(e) => setNewCustomerAddress(e.target.value)}
          />
        </>
      )}

      {!phone && (
        <p className="hint" style={{ marginTop: -6 }}>
          No phone — this bill will be recorded for a walk-in customer.
        </p>
      )}

      <h2 className="panel-title" style={{ marginTop: 22 }}>
        4. Totals
      </h2>

      <div className="segmented">
        <button className={discountType === 'flat' ? 'active' : ''} onClick={() => setDiscountType('flat')} type="button">
          Flat Discount
        </button>
        <button
          className={discountType === 'percent' ? 'active' : ''}
          onClick={() => setDiscountType('percent')}
          type="button"
        >
          % Discount
        </button>
      </div>

      <input
        className="field"
        type="number"
        inputMode="decimal"
        placeholder={discountType === 'percent' ? 'Discount %' : 'Discount (Rs)'}
        value={discountValue}
        onChange={(e) => setDiscountValue(e.target.value)}
      />

      <input
        className="field"
        type="number"
        inputMode="decimal"
        placeholder="Amount paid (Rs)"
        value={amountPaid}
        onChange={(e) => {
          setAmountPaid(e.target.value);
          setAmountPaidTouched(true);
        }}
      />

      <section className="panel">
        <TotalsRow label="Subtotal" value={formatPKR(subtotal)} />
        <TotalsRow
          label={discountType === 'percent' && discountValue ? `Discount (${discountValue}%)` : 'Discount'}
          value={`− ${formatPKR(discountAmount)}`}
        />
        <div className="price-preview" style={{ marginTop: 10, marginBottom: 0 }}>
          <span>Total · {paymentStatus.toUpperCase()}</span>
          <strong>{formatPKR(total)}</strong>
        </div>
      </section>

      {selectedArticles.length === 0 && <p className="hint">Select at least one article above to enable Finalize.</p>}

      <button
        className="btn btn-gold btn-block"
        disabled={!canFinalize}
        onClick={onFinalize}
        type="button"
        style={{ marginTop: 8 }}
      >
        {submitting ? 'Creating Bill…' : `Finalize — ${formatPKR(total)}`}
      </button>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function TotalsRow({ label, value }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '4px 0',
        color: 'var(--text-muted)',
        fontSize: 13,
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
