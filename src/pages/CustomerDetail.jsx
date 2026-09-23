// src/pages/CustomerDetail.jsx
//
// One customer's full purchase history — a drill-down screen (back
// arrow, no nav entry of its own) reached by tapping a customer's name
// on BillView.jsx's "Billed To" section. Read-only, same spirit as
// BillView.jsx itself: nothing here is editable, it just displays what
// createBill() already recorded (see db.js).
//
// Bills read via getBills({ customer_id }) — already existed as a
// general-purpose filter in db.js since Phase 0, unused until now.
// Lifetime totals exclude voided bills, same convention
// summarizeBillRange() (billUtils.js) already uses for its KPI cards —
// a voided sale didn't happen, so it shouldn't inflate a customer's
// lifetime spend any more than it inflates "This Month" on
// BillingHome.jsx.

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getCustomer, getBills, getShopInfo } from '../db';
import { formatPKR, formatBillNo } from '../priceUtils';

const PAYMENT_LABELS = { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid' };

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(undefined); // undefined = loading, null = not found
  const [bills, setBills] = useState([]);
  const [invoicePrefix, setInvoicePrefix] = useState('');

  const load = useCallback(async () => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      setCustomer(null);
      return;
    }
    const [row, customerBills] = await Promise.all([getCustomer(numericId), getBills({ customer_id: numericId })]);
    setCustomer(row || null);
    setBills(customerBills);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getShopInfo().then((info) => setInvoicePrefix(info.invoice_prefix));
  }, []);

  if (customer === undefined) {
    return <p className="empty">Loading customer…</p>;
  }

  if (customer === null) {
    return (
      <div>
        <p className="empty">That customer no longer exists.</p>
        <button className="btn btn-outline btn-block" onClick={() => navigate('/billing')} type="button">
          Back to Billing
        </button>
      </div>
    );
  }

  // Lifetime totals — voided bills stay listed below (audit trail, same
  // as BillingHome.jsx's own list) but never count toward spend/count
  // here, same reasoning as summarizeBillRange() in billUtils.js.
  const activeBills = bills.filter((b) => b.status !== 'voided');
  const lifetimeCount = activeBills.length;
  const lifetimeSpend = activeBills.reduce((sum, b) => sum + (Number(b.total) || 0), 0);

  return (
    <div>
      <section className="panel">
        <h2 className="panel-title">{customer.name}</h2>
        {customer.phone && <p className="row-meta" style={{ marginTop: 0 }}>{customer.phone}</p>}
        {customer.address && <p className="row-meta" style={{ marginTop: 0 }}>{customer.address}</p>}

        <div className="stats-row" style={{ marginTop: 14 }}>
          <div className="stat-card">
            <div className="stat-value">{lifetimeCount}</div>
            <div className="stat-label">Bill{lifetimeCount === 1 ? '' : 's'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value stat-value-small">{formatPKR(lifetimeSpend)}</div>
            <div className="stat-label">Lifetime Spend</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Purchase History</h2>
        {bills.length === 0 && (
          <p className="empty" style={{ marginTop: 0 }}>
            No bills for this customer yet.
          </p>
        )}
        {bills
          .slice()
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .map((bill) => (
            <button
              key={bill.id}
              className="list-row list-row-link"
              onClick={() => navigate(`/billing/${bill.id}`)}
              type="button"
            >
              <div className="row-info">
                <div className="row-name">
                  Bill #{formatBillNo(bill.bill_no, invoicePrefix)}
                  {bill.status === 'voided' && (
                    <span className="badge badge-voided" style={{ marginLeft: 6 }}>
                      Voided
                    </span>
                  )}
                </div>
                <div className="row-meta">
                  {bill.items.length} item{bill.items.length === 1 ? '' : 's'} · {formatPKR(bill.total)} ·{' '}
                  <span className={`badge badge-${bill.payment_status}`}>
                    {PAYMENT_LABELS[bill.payment_status] || bill.payment_status}
                  </span>
                </div>
                <div className="row-meta">
                  {new Date(bill.created_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </div>
              </div>
            </button>
          ))}
      </section>
    </div>
  );
}
