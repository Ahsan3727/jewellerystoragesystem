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
  if (article && article.status === 'sold') {
    if (article.sold_price != null) return article.sold_price;
    if (article.sold_rate_per_tola != null) {
      return computePrice(article.weight_grams, article.sold_rate_per_tola);
    }
  }
  return computePrice(article?.weight_grams, liveRatePerTola);
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
