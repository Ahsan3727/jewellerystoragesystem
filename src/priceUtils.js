// src/priceUtils.js
//
// One shared formula so every screen (tagger, list, edit form, home
// stats) always computes price the exact same way. Nothing here is
// stored pre-calculated in the database — price is always derived live
// from an article's weight and today's gold rate, so changing the rate
// on the Gold Rate screen instantly updates every article's price
// everywhere in the app.

// 1 tola = 11.664 grams. Gold rate in Pakistan is quoted per tola;
// jewelry weight is measured in grams — this is the standard shop
// conversion between the two.
export const GRAMS_PER_TOLA = 11.664;

// price (Rs) = (weight in grams ÷ 11.664) × rate per tola
export function computePrice(weightGrams, ratePerTola) {
  const w = Number(weightGrams) || 0;
  const r = Number(ratePerTola) || 0;
  if (w <= 0 || r <= 0) return 0;
  return Math.round((w / GRAMS_PER_TOLA) * r);
}

// The weight that actually gets priced as gold.
//
// A piece's total weight_grams is whatever it reads on the scale —
// gold *and* any stones set into it together. Stones aren't gold, so
// pricing the full scale weight at the gold rate overstates every
// stone-set piece. stone_weight_grams (optional, defaults to 0 for
// pieces with no stones / saved before this field existed) is
// subtracted out first so only the actual gold gets priced. Clamped
// at 0 so a stone weight mistakenly entered larger than the total
// weight can't flip the price negative.
export function getGoldWeight(weightGrams, stoneWeightGrams) {
  const w = Number(weightGrams) || 0;
  const s = Number(stoneWeightGrams) || 0;
  return Math.max(0, w - s);
}

// The price to actually show for an article, anywhere in the app.
//
// In-stock pieces float with the market — always priced off today's
// live gold rate, same as computePrice() above.
//
// Sold pieces are different: once a piece is gone, its sale price
// shouldn't keep changing just because today's gold rate moved. So a
// sold article's price is locked to whatever weight × the gold rate
// was on the day it was actually marked sold (setArticleStatus() in
// db.js stores that rate + the resulting price at the moment of sale).
// This is what makes daily/weekly/monthly sales totals stable —
// yesterday's sales stay yesterday's numbers even if you update the
// rate today.
//
// `liveRatePerTola` is only used as a fallback, for sold articles
// saved before this was tracked (no sold_price / sold_rate_per_tola on
// the record yet).
export function getDisplayPrice(article, liveRatePerTola) {
  const goldWeight = getGoldWeight(article?.weight_grams, article?.stone_weight_grams);
  if (article && article.status === 'sold') {
    if (article.sold_price != null) return article.sold_price;
    if (article.sold_rate_per_tola != null) {
      return computePrice(goldWeight, article.sold_rate_per_tola);
    }
  }
  return computePrice(goldWeight, liveRatePerTola);
}

// Rs 123,456 style formatting for PKR, no decimals (shop pricing is
// always whole rupees).
export function formatPKR(amount) {
  const n = Math.round(Number(amount) || 0);
  return `Rs ${n.toLocaleString('en-PK')}`;
}

// Formats a bill's number for display, honoring the shop's optional
// invoice prefix (Settings → Shop Details → Invoice Prefix, Phase 4)
// — e.g. prefix "INV-" turns bill_no 42 into "INV-42". Display-only:
// the stored bill_no itself stays a plain sequential integer (see
// getNextBillNumber()/createBill() in db.js), so the counter never has
// to parse or strip a prefix that might be changed or cleared later.
// Called everywhere a bill number is shown — BillView's invoice header
// and printed bill, BillingHome's bill list — so it's only ever
// formatted in this one place (same discipline as formatPKR() above).
export function formatBillNo(billNo, prefix) {
  const p = (prefix || '').trim();
  return `${p}${billNo}`;
}

export function formatGrams(weightGrams) {
  const n = Number(weightGrams) || 0;
  // trim trailing zeros but keep up to 3 decimal places (jewelry scales
  // usually read to 0.001g)
  return `${parseFloat(n.toFixed(3))} g`;
}

/* ---------------------------- Karat pricing (Calculator + Billing) ---------------------------- */
//
// Everything below is ported from jewellery-calculator's standalone
// karat-purity math (app/(tabs)/calculator.jsx) so both this app's
// Calculator page and Billing use the exact same numbers a shop owner
// already trusts from that app — karat/making-charge/wastage are never
// stored on an article itself (chosen per line, at billing time or in
// the Calculator), so this is the one place that math lives.

// Common local karats, 24K (pure) down through 14K — ported verbatim
// from jewellery-calculator's KARAT_LIST.
export const KARAT_OPTIONS = [
  { label: '24K (Pure)', value: 24 },
  { label: '23.5K', value: 23.5 },
  { label: '23K', value: 23 },
  { label: '22.5K', value: 22.5 },
  { label: '22K', value: 22 },
  { label: '21.5K', value: 21.5 },
  { label: '21K', value: 21 },
  { label: '20.5K', value: 20.5 },
  { label: '20K', value: 20 },
  { label: '19.5K', value: 19.5 },
  { label: '19K', value: 19 },
  { label: '18.5K', value: 18.5 },
  { label: '18K', value: 18 },
  { label: '17.5K', value: 17.5 },
  { label: '17K', value: 17 },
  { label: '16.5K', value: 16.5 },
  { label: '16K', value: 16 },
  { label: '15K', value: 15 },
  { label: '14K', value: 14 },
];

// karat → purity fraction (0–1), e.g. 21K → 0.875.
//
// jewellery-calculator computes this via the traditional Pakistani
// "kaat" system (a deduction expressed in masha/ratti per tola) rather
// than a plain fraction: multiplier = (24 - karat) / 3, kaatRatti =
// multiplier * 12, purity = (96 - kaatRatti) / 96. That's algebraically
// identical to karat / 24 for every value on KARAT_OPTIONS (checked:
// 21K → 0.875 either way, 18K → 0.75 either way, 23.5K → 0.979166...
// either way) — using the plain fraction here keeps this file free of
// masha/ratti units, which nothing else in this app uses.
export function purityFromKarat(karat) {
  const k = Number(karat) || 0;
  return Math.max(0, Math.min(1, k / 24));
}

// The one place gold value / making amount / wastage amount / line
// total get computed for a billing line — the Calculator page, the
// bill line editor, and the bill total all call this rather than
// re-implementing the math inline (see point 6 of the implementation
// plan). Mirrors computePrice() above, but at the karat actually sold
// at (not always 24K) and with making charge (Rs per tola, same unit
// as rate_per_tola) and wastage % (of gold value) layered on.
//
// weight_grams / stone_weight_grams: same meaning as getGoldWeight()
// above — gold weight excludes any stone weight, so a stone-set piece
// isn't priced as if the stones were gold too.
export function computeLineItem({
  weight_grams,
  stone_weight_grams,
  karat,
  rate_per_tola,
  making_charge,
  wastage_percent,
}) {
  const goldWeight = getGoldWeight(weight_grams, stone_weight_grams);
  const weightInTola = goldWeight / GRAMS_PER_TOLA;
  const purity = purityFromKarat(karat);
  const rate = Number(rate_per_tola) || 0;
  const making = Number(making_charge) || 0;
  const wastagePercent = Number(wastage_percent) || 0;

  const effectiveRatePerTola = rate * purity;
  const goldValue = Math.round(weightInTola * effectiveRatePerTola);
  const makingAmount = Math.round(weightInTola * making);
  const wastageAmount = Math.round(goldValue * (wastagePercent / 100));
  // Sum the already-rounded components rather than rounding one raw
  // sum (point 7) — this is what keeps a printed bill's total matching
  // the sum of its printed lines to the rupee.
  const lineTotal = goldValue + makingAmount + wastageAmount;

  return { goldWeight, goldValue, makingAmount, wastageAmount, lineTotal };
}
