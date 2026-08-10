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

// Rs 123,456 style formatting for PKR, no decimals (shop pricing is
// always whole rupees).
export function formatPKR(amount) {
  const n = Math.round(Number(amount) || 0);
  return `Rs ${n.toLocaleString('en-PK')}`;
}

export function formatGrams(weightGrams) {
  const n = Number(weightGrams) || 0;
  // trim trailing zeros but keep up to 3 decimal places (jewelry scales
  // usually read to 0.001g)
  return `${parseFloat(n.toFixed(3))} g`;
}
