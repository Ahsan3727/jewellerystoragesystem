// src/billUtils.js
//
// Turns a flat list of bills into the daily / weekly / monthly revenue
// records shown on BillingHome.jsx — mirrors salesUtils.js's spirit
// (pure functions only, no DB, no React, one shared place this math
// happens) but reads from real `bills` rows instead of inferring a
// sale record from whichever articles happen to be marked "sold".
// Sales.jsx (and salesUtils.js) had to infer everything from an
// article's own sold_at/sold_price; a bill is the real, itemized,
// auditable record Phase 0 introduced, so this is what BillingHome
// reads from instead.
//
// Revenue always comes from a bill's own locked `total` (see
// createBill() in db.js) — never recomputed off today's gold rate —
// so a bucket's revenue for last week doesn't shift just because the
// rate changed today. The date-bucketing helpers below (startOfDay /
// startOfWeek / startOfMonth / the fmt* label functions) are a small,
// stable, intentional duplication of the private helpers already in
// salesUtils.js rather than an import from it — bills and sold
// articles are different domains that just happen to bucket by the
// same calendar math; todayStart()/thisWeekStart()/thisMonthStart()
// themselves are already exported from salesUtils.js and reused as-is
// (see BillingHome.jsx), since those really are just "what is today"
// with no sales-specific meaning at all.

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Monday-start week — same convention salesUtils.js uses, so a shop
// owner sees the same week boundaries on both screens.
function startOfWeek(d) {
  const s = startOfDay(d);
  const mondayIndexedDay = (s.getDay() + 6) % 7; // Mon=0 ... Sun=6
  s.setDate(s.getDate() - mondayIndexedDay);
  return s;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function fmtDay(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMonth(d) {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function fmtWeekRange(start) {
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: sameMonth ? undefined : 'short',
  });
  const endStr = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

// period: 'day' | 'week' | 'month'
// Returns buckets sorted newest-first, each:
//   { key, start (Date), label, count, revenue, bills: [bill, ...] }
//
// Every bill passed in still lands in its bucket's `bills` list and
// counts toward `count` — including a voided one, so it stays visible
// while browsing (voiding doesn't erase the audit trail; see
// voidBill() in db.js) — but a voided bill is never added to the
// bucket's `revenue`, since that sale didn't happen.
export function groupBillsByPeriod(bills, period) {
  const buckets = new Map();

  for (const bill of bills || []) {
    if (!bill.created_at) continue;
    const billDate = new Date(bill.created_at);
    if (Number.isNaN(billDate.getTime())) continue;

    let start;
    let label;
    if (period === 'week') {
      start = startOfWeek(billDate);
      label = fmtWeekRange(start);
    } else if (period === 'month') {
      start = startOfMonth(billDate);
      label = fmtMonth(start);
    } else {
      start = startOfDay(billDate);
      label = fmtDay(start);
    }

    const key = start.getTime();
    if (!buckets.has(key)) {
      buckets.set(key, { key, start, label, count: 0, revenue: 0, bills: [] });
    }
    const bucket = buckets.get(key);
    bucket.count += 1;
    if (bill.status !== 'voided') bucket.revenue += Number(bill.total) || 0;
    bucket.bills.push(bill);
  }

  return Array.from(buckets.values()).sort((a, b) => b.start - a.start);
}

// Totals for bills created on/after `sinceDate` — the building block
// for "Today / This Week / This Month / All Time" quick stats.
//
// Unlike groupBillsByPeriod above, a voided bill is excluded entirely
// here (from both count and revenue) rather than just from revenue —
// these are the headline KPI cards, and a voided sale shouldn't
// inflate "3 bills today" any more than it should inflate the rupee
// figure next to it.
export function summarizeBillRange(bills, sinceDate) {
  let count = 0;
  let revenue = 0;
  for (const bill of bills || []) {
    if (bill.status === 'voided') continue;
    if (!bill.created_at) continue;
    const billDate = new Date(bill.created_at);
    if (Number.isNaN(billDate.getTime()) || billDate < sinceDate) continue;
    count += 1;
    revenue += Number(bill.total) || 0;
  }
  return { count, revenue };
}
