// src/pages/BillView.jsx
//
// Read-only itemized invoice for one bill — what BillNew.jsx creates
// and BillingHome.jsx's list links into. Nothing here is editable or
// recomputed: every number on a bill is a locked snapshot from the
// moment createBill() ran (see the "Never let a bill's math be
// recomputed later" rule at the top of the implementation plan), so
// this screen only ever displays what's already stored in the bill
// row itself.
//
// Print uses the browser's native window.print() against the
// .bill-invoice-scoped @media print rules in index.css — no PDF
// library, consistent with this app's zero-new-dependencies rule
// (point 11 of the plan).

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getBill, voidBill } from '../db';
import { formatPKR, formatGrams } from '../priceUtils';

const PAYMENT_LABELS = { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid' };

export default function BillView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bill, setBill] = useState(undefined); // undefined = loading, null = not found
  const [toast, setToast] = useState(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voiding, setVoiding] = useState(false);

  const load = useCallback(async () => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      setBill(null);
      return;
    }
    const row = await getBill(numericId);
    setBill(row || null);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const onPrint = () => window.print();

  const onVoid = async () => {
    setVoiding(true);
    try {
      await voidBill(bill.id);
      setConfirmVoid(false);
      await load();
      setToast('Bill voided — every article on it is back in stock.');
    } catch (e) {
      setToast(e.message || 'Could not void that bill.');
    } finally {
      setVoiding(false);
    }
  };

  if (bill === undefined) {
    return <p className="empty">Loading bill…</p>;
  }

  if (bill === null) {
    return (
      <div>
        <p className="empty">That bill no longer exists.</p>
        <button className="btn btn-outline btn-block" onClick={() => navigate('/billing')} type="button">
          Back to Billing
        </button>
      </div>
    );
  }

  const isVoided = bill.status === 'voided';
  // amount_paid/total are both already-rounded whole rupees (see
  // createBill()), so this subtraction never needs its own rounding.
  const balanceDue = Math.max(0, bill.total - (bill.amount_paid || 0));

  return (
    <div>
      <section className="panel bill-invoice">
        <header className="invoice-header">
          <div>
            {/* Shop name is hardcoded for now — Phase 4 adds
                configurable shop name/address/phone/invoice-prefix
                fields in Settings.jsx that this header will read
                from instead. */}
            <div className="invoice-shop-name">💎 Jewelry Shop</div>
            <div className="invoice-shop-sub">Inventory Manager</div>
          </div>
          <div className="invoice-meta">
            <strong>Bill #{bill.bill_no}</strong>
            {new Date(bill.created_at).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
            <div style={{ marginTop: 6 }}>
              <span className={`badge badge-${bill.payment_status}`}>
                {PAYMENT_LABELS[bill.payment_status] || bill.payment_status}
              </span>
              {isVoided && (
                <span className="badge badge-voided" style={{ marginLeft: 6 }}>
                  Voided
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="invoice-customer">
          <p className="invoice-section-title">Billed To</p>
          <div className="row-name">{bill.customer_name}</div>
          {bill.customer_phone && <div className="row-meta">{bill.customer_phone}</div>}
        </div>

        <p className="invoice-section-title">Items</p>
        <div className="invoice-table-wrap">
          <table className="invoice-table">
            <thead>
              <tr>
                <th>Article</th>
                <th>Karat</th>
                <th className="num">Gold Wt</th>
                <th className="num">Gold Value</th>
                <th className="num">Making</th>
                <th className="num">Wastage</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {bill.items.map((line) => (
                <tr key={line.article_id}>
                  <td>
                    {line.name}
                    <span className="cat-tag">{line.category}</span>
                  </td>
                  <td>{line.karat}K</td>
                  <td className="num">{formatGrams(line.gold_weight_grams)}</td>
                  <td className="num">{formatPKR(line.gold_value)}</td>
                  <td className="num">{formatPKR(line.making_amount)}</td>
                  <td className="num">{formatPKR(line.wastage_amount)}</td>
                  <td className="num">{formatPKR(line.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="invoice-totals">
          <TotalsRow label="Subtotal" value={formatPKR(bill.subtotal)} />
          <TotalsRow
            label={
              bill.discount?.type === 'percent' && bill.discount?.value
                ? `Discount (${bill.discount.value}%)`
                : 'Discount'
            }
            value={`− ${formatPKR(bill.discount_amount)}`}
          />
          <TotalsRow label="Amount Paid" value={formatPKR(bill.amount_paid)} />
          {bill.payment_status === 'partial' && <TotalsRow label="Balance Due" value={formatPKR(balanceDue)} />}
          <div
            className={`price-preview ${bill.payment_status === 'paid' ? 'price-preview-sold' : ''}`}
            style={{ marginTop: 10, marginBottom: 0 }}
          >
            <span>Total</span>
            <strong>{formatPKR(bill.total)}</strong>
          </div>
        </div>

        {bill.notes && (
          <div style={{ marginTop: 14 }}>
            <p className="invoice-section-title">Notes</p>
            <p className="row-meta">{bill.notes}</p>
          </div>
        )}
      </section>

      <div className="invoice-actions">
        <button className="btn btn-gold" onClick={onPrint} type="button">
          🖨️ Print
        </button>
        {!isVoided && (
          <button className="btn btn-outline" onClick={() => setConfirmVoid(true)} type="button">
            Void Bill
          </button>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}

      {confirmVoid && (
        <div className="modal-overlay" onClick={() => setConfirmVoid(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Void Bill #{bill.bill_no}?</div>
            <p className="hint" style={{ marginTop: 0 }}>
              Every article on this bill goes back to "in stock" and the bill is marked voided — it stays in the
              record for the audit trail, just no longer counted as revenue. This can't be undone from here.
            </p>
            <div className="modal-actions" style={{ flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-gold btn-block" onClick={onVoid} disabled={voiding} type="button">
                {voiding ? 'Voiding…' : 'Void This Bill'}
              </button>
              <button
                className="btn btn-ghost btn-block"
                onClick={() => setConfirmVoid(false)}
                disabled={voiding}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
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
