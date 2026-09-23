// src/pages/BillingHome.jsx
//
// Replaces Sales.jsx (Phase 3). Where Sales.jsx inferred a sale record
// from whichever articles happened to be marked "sold", this screen
// reads the real, itemized `bills` rows Phase 0 introduced — searchable
// by customer name/phone/bill number, filterable by status and payment
// state, and grouped Daily / Weekly / Monthly the same way Sales.jsx
// grouped sold articles, with Today / This Week / This Month / All
// Time totals up top.
//
// Every revenue figure comes from billUtils.js, which reads a bill's
// own locked `total` (see createBill() in db.js) rather than
// recomputing anything off today's gold rate, and — for the KPI cards
// specifically — always excludes voided bills, since a voided sale
// didn't happen (see billUtils.js for the exact count-vs-revenue
// distinction it draws for the browsable list below).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getBills } from '../db';
import { formatPKR } from '../priceUtils';
import { groupBillsByPeriod, summarizeBillRange } from '../billUtils';
import { todayStart, thisWeekStart, thisMonthStart } from '../salesUtils';

const PERIODS = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

const STATUS_TABS = [
  { value: 'active', label: 'Active' },
  { value: 'voided', label: 'Voided' },
  { value: 'all', label: 'All' },
];

const PAYMENT_LABELS = { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid' };

const EPOCH = new Date(0);

export default function BillingHome() {
  const navigate = useNavigate();
  const [bills, setBills] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [period, setPeriod] = useState('day');
  const [expandedKey, setExpandedKey] = useState(null);

  const load = useCallback(async () => {
    setBills(await getBills());
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A payment filter chosen while looking at "Active" may no longer
  // make sense once switching to "Voided"/"All" — reset it along with
  // whatever group happened to be expanded, same as ArticleList.jsx
  // resets its category chip whenever the status tab changes.
  useEffect(() => {
    setPaymentFilter('All');
    setExpandedKey(null);
  }, [statusFilter]);

  const today = useMemo(() => summarizeBillRange(bills, todayStart()), [bills]);
  const week = useMemo(() => summarizeBillRange(bills, thisWeekStart()), [bills]);
  const month = useMemo(() => summarizeBillRange(bills, thisMonthStart()), [bills]);
  const allTime = useMemo(() => summarizeBillRange(bills, EPOCH), [bills]);

  const statusScoped = useMemo(() => {
    if (statusFilter === 'all') return bills;
    return bills.filter((b) => b.status === statusFilter);
  }, [bills, statusFilter]);

  const paymentsPresent = useMemo(() => {
    const set = new Set(statusScoped.map((b) => b.payment_status));
    return ['paid', 'partial', 'unpaid'].filter((p) => set.has(p));
  }, [statusScoped]);

  const visible = useMemo(() => {
    let rows = statusScoped;
    if (paymentFilter !== 'All') rows = rows.filter((b) => b.payment_status === paymentFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (b) =>
          (b.customer_name || '').toLowerCase().includes(q) ||
          (b.customer_phone || '').includes(search) ||
          String(b.bill_no).includes(search)
      );
    }
    return rows;
  }, [statusScoped, paymentFilter, search]);

  const groups = useMemo(() => groupBillsByPeriod(visible, period), [visible, period]);
  const maxRevenue = groups.length ? Math.max(...groups.map((g) => g.revenue)) : 0;

  return (
    <div>
      <div className="stats-row">
        <BillStat label="Today" count={today.count} revenue={today.revenue} />
        <BillStat label="This Week" count={week.count} revenue={week.revenue} />
        <BillStat label="This Month" count={month.count} revenue={month.revenue} />
        <BillStat label="All Time" count={allTime.count} revenue={allTime.revenue} accent="muted" />
      </div>

      <button
        className="btn btn-gold btn-block"
        onClick={() => navigate('/billing/new')}
        type="button"
        style={{ marginBottom: 18 }}
      >
        + New Bill
      </button>

      {loaded && bills.length === 0 && (
        <div className="panel">
          <p className="empty" style={{ marginTop: 0 }}>
            No bills yet — create one above to start recording real, itemized sales instead of a single "Mark as
            Sold" tap.
          </p>
        </div>
      )}

      {bills.length > 0 && (
        <>
          <input
            className="field search-field"
            placeholder="Search by customer name, phone, or bill #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="segmented">
            {STATUS_TABS.map((s) => (
              <button
                key={s.value}
                className={statusFilter === s.value ? 'active' : ''}
                onClick={() => setStatusFilter(s.value)}
                type="button"
              >
                {s.label}
              </button>
            ))}
          </div>

          {paymentsPresent.length > 0 && (
            <div className="chip-row scroll-x">
              <button
                className={`chip ${paymentFilter === 'All' ? 'active' : ''}`}
                onClick={() => setPaymentFilter('All')}
                type="button"
              >
                All
              </button>
              {paymentsPresent.map((p) => (
                <button
                  key={p}
                  className={`chip ${paymentFilter === p ? 'active' : ''}`}
                  onClick={() => setPaymentFilter(p)}
                  type="button"
                >
                  {PAYMENT_LABELS[p]}
                </button>
              ))}
            </div>
          )}

          <div className="tab-row">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                className={`tab-btn ${period === p.value ? 'active' : ''}`}
                onClick={() => {
                  setPeriod(p.value);
                  setExpandedKey(null);
                }}
                type="button"
              >
                {p.label}
              </button>
            ))}
          </div>

          {visible.length === 0 && <p className="empty">No bills match your filters.</p>}

          {groups.length > 0 && (
            <section className="panel">
              <h2 className="panel-title">
                {period === 'day'
                  ? 'Daily Billing Record'
                  : period === 'week'
                  ? 'Weekly Billing Record'
                  : 'Monthly Billing Record'}
              </h2>
              <div className="sales-groups">
                {groups.map((g) => {
                  const isOpen = expandedKey === g.key;
                  return (
                    <div className="sales-group" key={g.key}>
                      <button
                        className="sales-group-head"
                        onClick={() => setExpandedKey(isOpen ? null : g.key)}
                        type="button"
                      >
                        <span className="sales-group-label">{g.label}</span>
                        <span className="sales-group-caret">{isOpen ? '▲' : '▼'}</span>
                      </button>
                      <div className="category-bar-track">
                        <div
                          className="category-bar-fill"
                          style={{ width: `${maxRevenue ? (g.revenue / maxRevenue) * 100 : 0}%` }}
                        />
                      </div>
                      <div className="sales-group-meta">
                        {g.count} bill{g.count === 1 ? '' : 's'} · <strong>{formatPKR(g.revenue)}</strong>
                      </div>

                      {isOpen && (
                        <div className="sales-group-items">
                          {g.bills
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
                                    Bill #{bill.bill_no} <span className="cat-tag">{bill.customer_name}</span>
                                    {bill.status === 'voided' && (
                                      <span className="badge badge-voided" style={{ marginLeft: 6 }}>
                                        Voided
                                      </span>
                                    )}
                                  </div>
                                  <div className="row-meta">
                                    {bill.items.length} item{bill.items.length === 1 ? '' : 's'} ·{' '}
                                    {formatPKR(bill.total)} ·{' '}
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
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function BillStat({ label, count, revenue, accent }) {
  const valueClass = ['stat-value', accent === 'muted' && 'stat-value-muted'].filter(Boolean).join(' ');
  return (
    <div className="stat-card">
      <div className={valueClass}>{count}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-sub">{formatPKR(revenue)}</div>
    </div>
  );
}
