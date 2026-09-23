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
import { getBill, voidBill, addPayment, getShopInfo } from '../db';
import { formatPKR, formatGrams, formatBillNo } from '../priceUtils';
import { formatBillAsText } from '../billUtils';

const PAYMENT_LABELS = { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid' };

// Best-effort normalization of a Pakistani phone number for a
// wa.me link — strips everything but digits and swaps a local "0"
// prefix for the "92" country code (0300-1234567 → 923001234567).
// Anything that doesn't look like a real number after that (too
// short, empty) returns null so the caller can fall back to WhatsApp's
// own contact picker instead of guessing wrong and silently messaging
// the wrong person.
function normalizePhoneForWhatsApp(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const normalized = digits.startsWith('0') ? `92${digits.slice(1)}` : digits;
  if (normalized.length < 10) return null;
  return normalized;
}

export default function BillView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bill, setBill] = useState(undefined); // undefined = loading, null = not found
  const [toast, setToast] = useState(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voiding, setVoiding] = useState(false);
  // Record Payment (Phase 5A) — a confirmation-modal-style form, same
  // .modal-overlay/.modal-card pattern as the void-confirmation modal
  // just above.
  const [showPayment, setShowPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [recordingPayment, setRecordingPayment] = useState(false);
  // Read fresh every time this screen loads (rather than cached) so
  // reprinting an old bill always shows the shop's CURRENT letterhead
  // — see the comment on getShopInfo() in db.js for why that's
  // intentional and not a bug.
  const [shop, setShop] = useState({ name: 'Jewelry Shop', address: '', phone: '', invoice_prefix: '' });

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
    getShopInfo().then(setShop);
  }, []);

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
  const paymentAmountNum = Math.round(Number(paymentAmount) || 0);
  const paymentValid = paymentAmountNum > 0 && paymentAmountNum <= balanceDue;

  const openPaymentModal = () => {
    // Sensible default (rule: "restate the balance due if left
    // untouched") — the field opens pre-filled with the full balance,
    // since paying a bill off in one go is the common case; the shop
    // owner only has to type something different for a partial top-up.
    setPaymentAmount(balanceDue > 0 ? String(balanceDue) : '');
    setPaymentNote('');
    setShowPayment(true);
  };

  const onRecordPayment = async () => {
    if (!paymentValid) return;
    setRecordingPayment(true);
    try {
      const updated = await addPayment(bill.id, paymentAmountNum, paymentNote);
      setShowPayment(false);
      await load();
      const newBalance = Math.max(0, updated.total - (updated.amount_paid || 0));
      setToast(newBalance <= 0 ? 'Bill fully paid.' : `Payment recorded — balance is now ${formatPKR(newBalance)}.`);
    } catch (e) {
      setToast(e.message || 'Could not record that payment.');
    } finally {
      setRecordingPayment(false);
    }
  };

  // Web Share API first (most mobile browsers) — hands off to whatever
  // the device's own share sheet offers, WhatsApp included but not
  // WhatsApp-exclusive. Falls back to a wa.me deep link on desktop or
  // wherever navigator.share isn't available. Both paths are wrapped in
  // try/catch with the same toast-fallback pattern every other action
  // on this screen already uses.
  const onShare = async () => {
    const text = formatBillAsText(bill, shop);
    const title = `Bill #${formatBillNo(bill.bill_no, shop.invoice_prefix)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
      } catch (e) {
        // Cancelling the native share sheet also lands here
        // (AbortError) — that's the person changing their mind, not a
        // failure, so it gets no toast.
        if (e?.name !== 'AbortError') {
          setToast('Could not open the share sheet — copy the text instead.');
        }
      }
      return;
    }
    try {
      const waPhone = normalizePhoneForWhatsApp(bill.customer_phone);
      // No usable phone (walk-in, or something malformed) → wa.me's own
      // contact picker rather than guessing wrong and silently
      // messaging the wrong number.
      const url = waPhone
        ? `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`
        : `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setToast('Could not open the share sheet — copy the text instead.');
    }
  };

  return (
    <div>
      <section className="panel bill-invoice">
        <header className="invoice-header">
          <div>
            <div className="invoice-shop-name">💎 {shop.name}</div>
            {shop.address && <div className="invoice-shop-sub">{shop.address}</div>}
            {shop.phone && <div className="invoice-shop-sub">{shop.phone}</div>}
          </div>
          <div className="invoice-meta">
            <strong>Bill #{formatBillNo(bill.bill_no, shop.invoice_prefix)}</strong>
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
          {/* Walk-ins (no phone given at billing time) never get a
              customer row — see BillNew.jsx's customer section — so
              customer_id is null and the name just displays as plain
              text instead of a dead link. */}
          {bill.customer_id != null ? (
            <button
              className="link-btn link-edit"
              style={{ padding: 0, fontSize: 'inherit', fontWeight: 600 }}
              onClick={() => navigate(`/customers/${bill.customer_id}`)}
              type="button"
            >
              {bill.customer_name} →
            </button>
          ) : (
            <div className="row-name">{bill.customer_name}</div>
          )}
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

        {/* Payment History (Phase 5A) — only shown once there's more
            than one entry to review. A bill paid in full at billing
            time (the common case) has exactly one synthetic/ledger
            entry and shows nothing extra here. */}
        {bill.payments?.length > 1 && (
          <div style={{ marginTop: 14 }}>
            <p className="invoice-section-title">Payment History</p>
            {[...bill.payments].reverse().map((p, i) => (
              <div
                className="row-meta"
                key={i}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}
              >
                <span>
                  {new Date(p.paid_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                  {p.note ? ` · ${p.note}` : ''}
                </span>
                <span>{formatPKR(p.amount)}</span>
              </div>
            ))}
          </div>
        )}

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
        <button className="btn btn-outline" onClick={onShare} type="button">
          📤 Share
        </button>
        {!isVoided && bill.payment_status !== 'paid' && (
          <button className="btn btn-outline" onClick={openPaymentModal} type="button">
            💰 Record Payment
          </button>
        )}
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
            <div className="modal-title">Void Bill #{formatBillNo(bill.bill_no, shop.invoice_prefix)}?</div>
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

      {showPayment && (
        <div className="modal-overlay" onClick={() => !recordingPayment && setShowPayment(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Record Payment</div>
            <p className="hint" style={{ marginTop: 0, marginBottom: 14, textAlign: 'left' }}>
              Balance due: {formatPKR(balanceDue)}
            </p>

            <label className="field-label">Amount (Rs)</label>
            <input
              className="field"
              type="number"
              inputMode="decimal"
              placeholder={`Balance due: ${formatPKR(balanceDue)}`}
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              style={{ marginBottom: 12 }}
            />

            <label className="field-label">Note (optional)</label>
            <input
              className="field"
              type="text"
              placeholder="e.g. Bayana / advance"
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
              style={{ marginBottom: 12 }}
            />

            {paymentAmountNum > balanceDue && (
              <p className="hint" style={{ color: 'var(--danger)', marginTop: 0, textAlign: 'left' }}>
                That's more than the balance due ({formatPKR(balanceDue)}).
              </p>
            )}

            <div className="modal-actions" style={{ flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <button
                className="btn btn-gold btn-block"
                onClick={onRecordPayment}
                disabled={!paymentValid || recordingPayment}
                type="button"
              >
                {recordingPayment ? 'Recording…' : 'Record Payment'}
              </button>
              <button
                className="btn btn-ghost btn-block"
                onClick={() => setShowPayment(false)}
                disabled={recordingPayment}
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
