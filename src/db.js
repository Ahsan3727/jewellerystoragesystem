// src/db.js
//
// IndexedDB layer for the shop. Six stores:
//   - "articles": every jewelry piece (a tagged block on a catalog
//     photo) — name, category, weight in grams, description, its own
//     copy of image_uri (kept in sync, see "photos" below) + block
//     position.
//   - "settings": a handful of key/value rows — the gold rate (Rs per
//     tola) you update from the Gold Rate screen, the sequential
//     bill-number counter (from v4), and (Phase 4) the shop's own
//     name/address/phone/invoice-prefix, edited from Settings.jsx and
//     shown on the printed bill header. Every in-stock article's price
//     is calculated live from weight × the gold rate, never stored —
//     so changing the rate once updates every price in the app
//     immediately.
//   - "photos": one row per image_id — the actual photo everyone's
//     blocks sit on top of right now. This is the source of truth for
//     "what does this photo look like"; articles just carry a synced
//     copy of image_uri for convenience (crop exports, the edit-article
//     preview). Changing the photo on the block board updates this one
//     row instead of every article that happens to reference it.
//   - "photo_history": every photo a given image_id used to show
//     before it was replaced, so "Add Photo" never throws the old
//     picture away — it's saved and can be brought back later.
//   - "customers" (added in v4): one row per customer, looked up by
//     phone number at billing time.
//   - "bills" (added in v4): one row per finalized sale — itemized,
//     with every price a frozen snapshot of what was true at the
//     moment of sale (see createBill() below). Never deleted, only
//     ever voided.
//
// v1 of this app shipped a "jewelry_products" store (tagged items) and
// an unrelated "articles" store (a shop-blog CMS: title/author/status).
// v2 drops the blog store and turns "articles" into the real jewelry
// item table, carrying over anything that was in "jewelry_products".
// v3 adds "photos" / "photo_history" and backfills "photos" from
// whatever image_uri each existing article was already carrying.
// v4 adds "customers" and "bills" for the Billing feature — purely
// additive, nothing existing is touched or backfilled (there's no
// prior data to migrate: pre-v4 sales were a single "mark as sold" tap
// with no itemized bill or customer record behind them at all).

import { computeLineItem, computePrice, formatPKR, getGoldWeight } from './priceUtils';

const DB_NAME = 'jewelry_business';
const DB_VERSION = 4;
const GOLD_RATE_KEY = 'gold_rate_per_tola';
// Sequential bill-number counter, stored as its own row in "settings"
// (same pattern as GOLD_RATE_KEY) — see getNextBillNumber() and
// createBill() below.
const BILL_COUNTER_KEY = 'bill_counter';
// Shop name/address/phone/invoice-prefix, stored as one more row in
// "settings" (added in Phase 4) — same pattern again: one key, one
// row, read/written as a whole. See getShopInfo()/setShopInfo() below.
const SHOP_INFO_KEY = 'shop_info';
// Low-stock / aging-inventory nudge thresholds (Phase 5C) — one more
// "settings" row, same exact pattern as SHOP_INFO_KEY above. A new
// settings row is just a new key in an existing key/value store, so —
// unlike "customers"/"bills" in v4 — this needs no DB_VERSION bump and
// no onupgradeneeded change at all.
const INVENTORY_THRESHOLDS_KEY = 'inventory_thresholds';

let dbPromise;

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const database = request.result;
        const upgradeTx = request.transaction;
        const oldVersion = event.oldVersion;

        // --- settings store (gold rate) ---
        if (!database.objectStoreNames.contains('settings')) {
          database.createObjectStore('settings', { keyPath: 'key' });
        }

        // --- photos store (source of truth for each photo's CURRENT
        // image — one row per image_id, added in v3) ---
        if (!database.objectStoreNames.contains('photos')) {
          database.createObjectStore('photos', { keyPath: 'image_id' });
        }

        // --- photo_history store (every image a photo used to be,
        // kept whenever "Add Photo" replaces it — added in v3) ---
        if (!database.objectStoreNames.contains('photo_history')) {
          const history = database.createObjectStore('photo_history', {
            keyPath: 'id',
            autoIncrement: true,
          });
          history.createIndex('image_id', 'image_id');
        }

        // --- customers store (added in v4 — one row per customer,
        // looked up by phone at billing time; see findCustomerByPhone()
        // below) ---
        if (!database.objectStoreNames.contains('customers')) {
          const customers = database.createObjectStore('customers', {
            keyPath: 'id',
            autoIncrement: true,
          });
          customers.createIndex('phone', 'phone');
        }

        // --- bills store (added in v4 — one row per finalized sale;
        // see createBill()/voidBill() below) ---
        if (!database.objectStoreNames.contains('bills')) {
          const bills = database.createObjectStore('bills', {
            keyPath: 'id',
            autoIncrement: true,
          });
          bills.createIndex('created_at', 'created_at');
          bills.createIndex('bill_no', 'bill_no');
          bills.createIndex('customer_id', 'customer_id');
        }

        // --- migrate v1 "jewelry_products" (tagged items) forward ---
        let carriedOverProducts = [];
        if (database.objectStoreNames.contains('jewelry_products')) {
          const oldStore = upgradeTx.objectStore('jewelry_products');
          const getAllReq = oldStore.getAll();
          getAllReq.onsuccess = () => {
            carriedOverProducts = getAllReq.result || [];
          };
        }

        // --- drop the old v1 "articles" store (that was a blog/CMS
        // table — title/author/status — unrelated to jewelry) ---
        if (oldVersion < 2 && database.objectStoreNames.contains('articles')) {
          database.deleteObjectStore('articles');
        }

        // --- create the real jewelry "articles" store ---
        if (!database.objectStoreNames.contains('articles')) {
          const articles = database.createObjectStore('articles', {
            keyPath: 'id',
            autoIncrement: true,
          });
          articles.createIndex('image_id', 'image_id');
          articles.createIndex('created_at', 'created_at');
          articles.createIndex('category', 'category');
        }

        if (database.objectStoreNames.contains('jewelry_products')) {
          database.deleteObjectStore('jewelry_products');
        }

        // Carry over any v1 tagged items as articles with weight 0 (no
        // weight existed in v1, so the shop owner just needs to fill it
        // in once) — done on the upgrade transaction itself so it's
        // part of the same atomic migration.
        upgradeTx.oncomplete = () => {
          // no-op; actual insert happens below once the store exists
        };
        if (carriedOverProducts.length) {
          // articles store now exists on this same upgrade transaction
          const newStore = upgradeTx.objectStore('articles');
          for (const p of carriedOverProducts) {
            newStore.add({
              name: p.name,
              category: p.material || 'Other',
              weight_grams: 0,
              description: p.description || '',
              image_uri: p.image_uri,
              image_id: p.image_id,
              top_percent: p.top_percent,
              left_percent: p.left_percent,
              width_percent: p.width_percent ?? 15,
              height_percent: p.height_percent ?? 15,
              export_uri: p.export_uri || null,
              created_at: p.created_at || new Date().toISOString(),
            });
          }
        }

        // --- backfill "photos" from articles' own embedded image_uri
        // (every article used to carry its own copy — v3 pulls that
        // into one shared row per image_id so a photo only has to be
        // changed in one place instead of on every article that uses
        // it). Only needed once, moving up from an older version. ---
        if (oldVersion < 3 && database.objectStoreNames.contains('articles')) {
          const articleStore = upgradeTx.objectStore('articles');
          const photoStore = upgradeTx.objectStore('photos');
          const getAllArticlesReq = articleStore.getAll();
          getAllArticlesReq.onsuccess = () => {
            const seen = new Set();
            for (const a of getAllArticlesReq.result || []) {
              if (a.image_id == null || seen.has(a.image_id) || !a.image_uri) continue;
              seen.add(a.image_id);
              photoStore.put({
                image_id: a.image_id,
                uri: a.image_uri,
                created_at: a.created_at || new Date().toISOString(),
                updated_at: a.created_at || new Date().toISOString(),
              });
            }
          };
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

export async function initDatabase() {
  await getDb();
}

function tx(database, storeName, mode) {
  const transaction = database.transaction(storeName, mode);
  return transaction.objectStore(storeName);
}

/* ---------------------------- Settings / Gold rate ---------------------------- */

export async function getGoldRate() {
  const database = await getDb();
  const store = tx(database, 'settings', 'readonly');
  const row = await promisify(store.get(GOLD_RATE_KEY));
  return row ? { rate: row.value, updated_at: row.updated_at } : { rate: 0, updated_at: null };
}

export async function setGoldRate(rate) {
  const database = await getDb();
  const store = tx(database, 'settings', 'readwrite');
  const row = {
    key: GOLD_RATE_KEY,
    value: Number(rate) || 0,
    updated_at: new Date().toISOString(),
  };
  await promisify(store.put(row));
  return row;
}

/* ---------------------------- Settings / Shop info ---------------------------- */
//
// The shop's own name/address/phone/invoice-prefix (Phase 4) — set once
// on Settings.jsx and read by BillView.jsx's printed invoice header, so
// a printed bill shows the shop's real details instead of a hardcoded
// "Jewelry Shop" placeholder. Same single-row-in-"settings" pattern as
// the gold rate above, just with an object for `value` instead of a
// number.
//
// Deliberately NOT part of a bill's own locked snapshot (unlike
// karat/rate/making/wastage — see the "Never let a bill's math be
// recomputed later" rule) — the shop's letterhead is meant to reflect
// whoever prints the bill today, not whoever it was at the moment the
// original sale happened. Reprinting an old bill after a shop
// rebrands/moves premises should show the current details, same as a
// paper letterhead would.
export async function getShopInfo() {
  const database = await getDb();
  const store = tx(database, 'settings', 'readonly');
  const row = await promisify(store.get(SHOP_INFO_KEY));
  // Defaults defensively (point 5) for a fresh install with no row yet
  // — matches the "Jewelry Shop" text every screen already hardcoded
  // before this existed, so nothing changes visually until a shop
  // owner actually fills these in.
  return {
    name: row?.value?.name || 'Jewelry Shop',
    address: row?.value?.address || '',
    phone: row?.value?.phone || '',
    invoice_prefix: row?.value?.invoice_prefix || '',
    updated_at: row?.updated_at || null,
  };
}

export async function setShopInfo({ name, address, phone, invoice_prefix } = {}) {
  const database = await getDb();
  const store = tx(database, 'settings', 'readwrite');
  const row = {
    key: SHOP_INFO_KEY,
    value: {
      name: (name || '').trim() || 'Jewelry Shop',
      address: (address || '').trim(),
      phone: (phone || '').trim(),
      invoice_prefix: (invoice_prefix || '').trim(),
    },
    updated_at: new Date().toISOString(),
  };
  await promisify(store.put(row));
  return row;
}

/* ---------------------------- Settings / Inventory nudge thresholds ---------------------------- */
//
// Low-stock-count and aging-days thresholds (Phase 5C) that drive the
// Dashboard's nudge panel — edited on Settings.jsx, read by
// Dashboard.jsx alongside getArticles(). Same single-row-in-"settings"
// pattern as getShopInfo()/setShopInfo() above. Defaults (2 pieces / 60
// days) apply defensively whenever the row doesn't exist yet — a shop
// that never opens this panel still gets sensible nudges out of the
// box, same "default defensively" instinct as everywhere else old rows
// are read (point 5 of the original plan).
export async function getInventoryThresholds() {
  const database = await getDb();
  const store = tx(database, 'settings', 'readonly');
  const row = await promisify(store.get(INVENTORY_THRESHOLDS_KEY));
  return {
    low_stock_count: row?.value?.low_stock_count ?? 2,
    aging_days: row?.value?.aging_days ?? 60,
    updated_at: row?.updated_at || null,
  };
}

export async function setInventoryThresholds({ low_stock_count, aging_days } = {}) {
  const database = await getDb();
  const store = tx(database, 'settings', 'readwrite');
  const row = {
    key: INVENTORY_THRESHOLDS_KEY,
    value: {
      low_stock_count: Number(low_stock_count) || 2,
      aging_days: Number(aging_days) || 60,
    },
    updated_at: new Date().toISOString(),
  };
  await promisify(store.put(row));
  return row;
}

/* ---------------------------- Articles (jewelry pieces) ---------------------------- */

export async function addArticle(article) {
  const database = await getDb();
  const store = tx(database, 'articles', 'readwrite');
  const row = {
    name: article.name,
    category: article.category || 'Other',
    weight_grams: Number(article.weight_grams) || 0,
    stone_weight_grams: Number(article.stone_weight_grams) || 0,
    description: article.description || '',
    image_uri: article.image_uri,
    image_id: article.image_id,
    top_percent: article.top_percent,
    left_percent: article.left_percent,
    width_percent: article.width_percent ?? 15,
    height_percent: article.height_percent ?? 15,
    export_uri: null,
    status: article.status === 'sold' ? 'sold' : 'in_stock',
    sold_at: article.status === 'sold' ? new Date().toISOString() : null,
    sold_rate_per_tola: null,
    sold_price: null,
    created_at: new Date().toISOString(),
  };
  return promisify(store.add(row));
}

export async function getArticles(searchTerm = '') {
  const database = await getDb();
  const store = tx(database, 'articles', 'readonly');
  const all = await promisify(store.getAll());
  const filtered = searchTerm
    ? all.filter(
        (a) =>
          a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (a.category || '').toLowerCase().includes(searchTerm.toLowerCase())
      )
    : all;
  return filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function getArticlesForImage(image_id) {
  const database = await getDb();
  const store = tx(database, 'articles', 'readonly');
  const index = store.index('image_id');
  return promisify(index.getAll(image_id));
}

export async function getArticle(id) {
  const database = await getDb();
  const store = tx(database, 'articles', 'readonly');
  return promisify(store.get(id));
}

export async function updateArticle(id, article) {
  const database = await getDb();
  const store = tx(database, 'articles', 'readwrite');
  const existing = await promisify(store.get(id));
  if (!existing) return;
  const updated = {
    ...existing,
    name: article.name,
    category: article.category || 'Other',
    weight_grams: Number(article.weight_grams) || 0,
    stone_weight_grams: Number(article.stone_weight_grams) || 0,
    description: article.description || '',
  };
  await promisify(store.put(updated));
}

// Patches only a block's position/size on its photo (used by the block
// view/manage screen when a block is dragged or resized) without
// touching the article's name/category/weight/description.
export async function updateArticleBlock(id, patch) {
  const database = await getDb();
  const store = tx(database, 'articles', 'readwrite');
  const existing = await promisify(store.get(id));
  if (!existing) return;
  const updated = {
    ...existing,
    top_percent: patch.top_percent ?? existing.top_percent,
    left_percent: patch.left_percent ?? existing.left_percent,
    width_percent: patch.width_percent ?? existing.width_percent,
    height_percent: patch.height_percent ?? existing.height_percent,
  };
  await promisify(store.put(updated));
  return updated;
}

export async function setExportUri(id, export_uri) {
  const database = await getDb();
  const store = tx(database, 'articles', 'readwrite');
  const existing = await promisify(store.get(id));
  if (!existing) return;
  await promisify(store.put({ ...existing, export_uri }));
}

// Toggles an article between 'in_stock' and 'sold'. Sold pieces stay in
// the catalog (nothing here deletes anything) but drop out of the
// dashboard's in-stock weight/value totals and render dimmed on the
// photo board, so a shop owner can tell what's still available to sell
// at a glance without losing the record of what moved.
//
// The moment a piece is marked sold, this also locks in *how* it was
// priced: today's gold rate (sold_rate_per_tola) and the resulting
// price (sold_price = gold weight × that rate — weight minus any
// stone_weight_grams, via the same computePrice()/getGoldWeight()
// every other screen uses). That snapshot is what Dashboard's "Sold
// Today" figure and every "sold" price display read from afterwards,
// instead of
// recalculating off whatever the gold rate happens to be today — so a
// sale's recorded value stays put even after the rate moves. Restocking
// clears the snapshot; if it's marked sold again later, it gets priced
// fresh at that day's rate.
export async function setArticleStatus(id, status) {
  const database = await getDb();
  const transaction = database.transaction(['articles', 'settings'], 'readwrite');
  const articleStore = transaction.objectStore('articles');
  const settingsStore = transaction.objectStore('settings');

  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Could not update that article.'));
  });

  const existing = await promisify(articleStore.get(id));
  if (!existing) return;

  let updated;
  if (status === 'sold') {
    const rateRow = await promisify(settingsStore.get(GOLD_RATE_KEY));
    const ratePerTola = rateRow ? Number(rateRow.value) || 0 : 0;
    updated = {
      ...existing,
      status: 'sold',
      sold_at: new Date().toISOString(),
      sold_rate_per_tola: ratePerTola,
      sold_price: computePrice(getGoldWeight(existing.weight_grams, existing.stone_weight_grams), ratePerTola),
    };
  } else {
    updated = {
      ...existing,
      status: 'in_stock',
      sold_at: null,
      sold_rate_per_tola: null,
      sold_price: null,
    };
  }
  articleStore.put(updated);

  await done;
  return updated;
}

// Every sold article, most-recently-sold first — the raw material for
// Dashboard's "Sold Today" figure (via salesUtils.js). Kept as its own
// query (rather than making every caller of getArticles() filter it
// out) since "what sold, and when" is a different question from "what's
// in the catalog". BillingHome.jsx's own revenue breakdowns read real
// bills instead (see getBills() below) — this is article-level sold
// status, a different and older signal that still exists because
// setArticleStatus() above can flip an article to sold outside of
// Billing too (the one-tap "Mark as Sold" pill still works everywhere
// it always has).
export async function getSoldArticles() {
  const database = await getDb();
  const store = tx(database, 'articles', 'readonly');
  const all = await promisify(store.getAll());
  return all
    .filter((a) => a.status === 'sold' && a.sold_at)
    .sort((a, b) => (a.sold_at < b.sold_at ? 1 : -1));
}

// Clones an article — same photo, category, weight, description — as a
// fresh in-stock piece placed just next to the original block so it's
// easy to spot and re-drag into place. Handy when several near-identical
// items (a set of bangles, matching earrings) get tagged one after another.
export async function duplicateArticle(id) {
  const database = await getDb();
  const store = tx(database, 'articles', 'readwrite');
  const existing = await promisify(store.get(id));
  if (!existing) return null;
  const { id: _oldId, ...rest } = existing;
  const width = rest.width_percent ?? 15;
  const height = rest.height_percent ?? 15;
  const row = {
    ...rest,
    name: `${existing.name} (Copy)`,
    status: 'in_stock',
    sold_at: null,
    sold_rate_per_tola: null,
    sold_price: null,
    export_uri: null,
    created_at: new Date().toISOString(),
    left_percent: Math.min(100 - width, (rest.left_percent || 0) + 4),
    top_percent: Math.min(100 - height, (rest.top_percent || 0) + 4),
  };
  return promisify(store.add(row));
}

export async function deleteArticle(id) {
  const database = await getDb();
  const store = tx(database, 'articles', 'readwrite');
  await promisify(store.delete(id));
}

export async function getArticleStats() {
  const database = await getDb();
  const store = tx(database, 'articles', 'readonly');
  const all = await promisify(store.getAll());
  const inStock = all.filter((a) => a.status !== 'sold');
  const sold = all.filter((a) => a.status === 'sold');
  // Scale weight — gold + stones together, exactly what's physically in
  // the piece. Used for the "Stock Weight" display, which should show
  // what's really sitting in the shop.
  const sumWeight = (rows) => rows.reduce((sum, a) => sum + (Number(a.weight_grams) || 0), 0);
  // Gold-only weight — stone_weight_grams subtracted out. Used for
  // anything priced off the gold rate, so stone-set pieces aren't
  // valued as if the stones were gold too.
  const sumGoldWeight = (rows) =>
    rows.reduce((sum, a) => sum + getGoldWeight(a.weight_grams, a.stone_weight_grams), 0);
  return {
    total: all.length,
    totalWeight: sumWeight(all),
    inStockCount: inStock.length,
    inStockWeight: sumWeight(inStock),
    inStockGoldWeight: sumGoldWeight(inStock),
    soldCount: sold.length,
    soldWeight: sumWeight(sold),
  };
}

/* ---------------------------- Customers ---------------------------- */
//
// One row per customer. Looked up by phone number at billing time —
// BillNew.jsx's customer section calls findCustomerByPhone() as the
// phone field is typed, autofilling name/address if this person has
// bought before, so repeat customers accumulate one growing purchase
// history instead of a fresh row every visit.

export async function addCustomer({ name, phone, address } = {}) {
  const database = await getDb();
  const store = tx(database, 'customers', 'readwrite');
  const row = {
    name: name || 'Walk-in Customer',
    phone: phone || '',
    address: address || '',
    created_at: new Date().toISOString(),
  };
  const id = await promisify(store.add(row));
  return { id, ...row };
}

export async function findCustomerByPhone(phone) {
  if (!phone) return undefined;
  const database = await getDb();
  const store = tx(database, 'customers', 'readonly');
  return promisify(store.index('phone').get(phone));
}

// Single customer by id — CustomerDetail.jsx's own lookup (Phase 4),
// separate from findCustomerByPhone() above since that one's for
// billing-time autofill and this one's for a direct drill-down link
// from a bill's "Billed To" section.
export async function getCustomer(id) {
  const database = await getDb();
  const store = tx(database, 'customers', 'readonly');
  return promisify(store.get(id));
}

// Looks the phone number up first so the same person's repeat visits
// stay one customer row; creates a fresh row only if nothing matched.
export async function findOrCreateCustomer({ name, phone, address } = {}) {
  const existing = await findCustomerByPhone(phone);
  if (existing) return existing;
  return addCustomer({ name, phone, address });
}

export async function getCustomers(search = '') {
  const database = await getDb();
  const store = tx(database, 'customers', 'readonly');
  const all = await promisify(store.getAll());
  const q = search.toLowerCase();
  const filtered = search
    ? all.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(search))
    : all;
  return filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/* ---------------------------- Bills ---------------------------- */
//
// A bill is the locked, auditable record of one sale: itemized line
// snapshots, a customer, totals, and a payment status. Once
// createBill() runs, none of its numbers are ever recomputed — exactly
// like an article's own sold_price/sold_rate_per_tola snapshot. If the
// gold rate moves tomorrow or the article itself is later edited or
// deleted, the bill still shows exactly what was true at the moment of
// sale. Bills are voided, never deleted (voidBill(), below) — the
// audit trail matters more than a clean list.

// Peeks at what the next bill number will be, WITHOUT consuming it —
// used by BillNew.jsx to show "Bill #124" before Finalize is pressed.
// createBill() does its own increment inside its own transaction
// (below) rather than calling this, so a number is only ever actually
// consumed atomically together with the bill it belongs to.
export async function getNextBillNumber() {
  const database = await getDb();
  const store = tx(database, 'settings', 'readonly');
  const row = await promisify(store.get(BILL_COUNTER_KEY));
  return (row?.value || 0) + 1;
}

export async function getBill(id) {
  const database = await getDb();
  const store = tx(database, 'bills', 'readonly');
  return promisify(store.get(id));
}

// filter: { status?, customer_id?, search? } — search matches
// customer name/phone/bill number, same loose-substring style already
// used by getArticles()/getCustomers().
export async function getBills(filter = {}) {
  const database = await getDb();
  const store = tx(database, 'bills', 'readonly');
  const all = await promisify(store.getAll());
  let filtered = all;
  if (filter.status) {
    filtered = filtered.filter((b) => b.status === filter.status);
  }
  if (filter.customer_id != null) {
    filtered = filtered.filter((b) => b.customer_id === filter.customer_id);
  }
  if (filter.search) {
    const q = filter.search.toLowerCase();
    filtered = filtered.filter(
      (b) =>
        (b.customer_name || '').toLowerCase().includes(q) ||
        (b.customer_phone || '').includes(filter.search) ||
        String(b.bill_no).includes(filter.search)
    );
  }
  return filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// Creates a bill: one atomic transaction across bills + articles +
// customers + settings. Writes the bill's locked line-item snapshots,
// flips every included article to 'sold' at the bill's own computed
// price (not the plain 24K figure), resolves/creates the customer, and
// consumes the next bill number — all four together, or none of them
// (see point 2 of the implementation plan: no exceptions).
//
// payload shape:
//   {
//     rate_per_tola: number,           // today's 24K rate, snapshotted once for the whole bill
//     items: [{ article_id, karat, making_charge, wastage_percent }],
//     customer: { id? , name?, phone?, address? },
//     discount: { type: 'flat' | 'percent', value: number },
//     amount_paid: number,
//     payment_status?: 'paid' | 'partial' | 'unpaid',  // auto-derived from amount_paid vs total if omitted
//     notes?: string,
//   }
export async function createBill(payload) {
  const database = await getDb();
  const transaction = database.transaction(['bills', 'articles', 'customers', 'settings'], 'readwrite');
  const billStore = transaction.objectStore('bills');
  const articleStore = transaction.objectStore('articles');
  const customerStore = transaction.objectStore('customers');
  const settingsStore = transaction.objectStore('settings');

  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Could not create the bill.'));
  });
  // If we reject below via a manual transaction.abort() (see the catch
  // block further down), "done" rejects too but nothing may be awaiting
  // it at that point — attach a no-op handler so that rejection never
  // surfaces as a spurious "unhandled promise rejection" alongside the
  // real error we throw to the caller.
  done.catch(() => {});

  const ratePerTola = Number(payload?.rate_per_tola) || 0;
  const items = Array.isArray(payload?.items) ? payload.items : [];

  // Same "block Finalize" guards ArticleList.jsx already uses for a
  // zero rate (point 10) — enforced here too, since db.js is the last
  // gate regardless of what the UI already checked.
  if (ratePerTola <= 0) {
    throw new Error("Set today's gold rate before creating a bill.");
  }
  if (items.length === 0) {
    throw new Error('Select at least one article for this bill.');
  }

  // Re-validate every article's status INSIDE this transaction — the
  // picker's list may be stale by the time Finalize is pressed (point
  // 3: another tab, or a teammate, could have sold one of these
  // articles in the meantime). Only reads happen in this loop, so if
  // something here throws, nothing has been written yet and the
  // transaction just closes on its own with no effect — no manual
  // abort needed.
  const lineItems = [];
  let subtotal = 0;
  for (const item of items) {
    const article = await promisify(articleStore.get(item.article_id));
    if (!article) {
      throw new Error(`Article #${item.article_id} no longer exists.`);
    }
    if (article.status !== 'in_stock') {
      throw new Error(
        `"${article.name}" is no longer in stock — someone else may have already sold it. Refresh the article list and try again.`
      );
    }

    // The one shared formula (point 6) — never re-implemented inline
    // here, in the Calculator, or in the bill line editor.
    const computed = computeLineItem({
      weight_grams: article.weight_grams,
      stone_weight_grams: article.stone_weight_grams,
      karat: item.karat,
      rate_per_tola: ratePerTola,
      making_charge: item.making_charge,
      wastage_percent: item.wastage_percent,
    });

    lineItems.push({
      article_id: article.id,
      name: article.name,
      category: article.category,
      weight_grams: Number(article.weight_grams) || 0,
      stone_weight_grams: Number(article.stone_weight_grams) || 0,
      gold_weight_grams: computed.goldWeight,
      karat: Number(item.karat) || 24,
      rate_per_tola: ratePerTola,
      making_charge: Number(item.making_charge) || 0,
      wastage_percent: Number(item.wastage_percent) || 0,
      gold_value: computed.goldValue,
      making_amount: computed.makingAmount,
      wastage_amount: computed.wastageAmount,
      line_total: computed.lineTotal,
    });
    subtotal += computed.lineTotal;
  }

  // Discount: flat rupees or a percent of the subtotal, rounded once
  // here rather than accumulated across unrounded intermediates (point
  // 7 — that's how a printed total quietly stops matching its lines).
  const discount = payload?.discount || { type: 'flat', value: 0 };
  const discountAmount =
    discount.type === 'percent'
      ? Math.round(subtotal * ((Number(discount.value) || 0) / 100))
      : Math.round(Number(discount.value) || 0);
  const total = Math.max(0, subtotal - discountAmount);

  const amountPaid = Math.round(Number(payload?.amount_paid) || 0);
  const paymentStatus =
    payload?.payment_status || (amountPaid <= 0 ? 'unpaid' : amountPaid >= total ? 'paid' : 'partial');

  let billId;
  try {
    // Customer — resolve to an existing row (by id, then by phone) or
    // create one, inside this same transaction: a brand-new customer's
    // first bill can't half-succeed (customer saved but bill not, or
    // vice versa).
    let customer = null;
    const customerInput = payload?.customer || {};
    if (customerInput.id != null) {
      customer = await promisify(customerStore.get(customerInput.id));
    }
    if (!customer && customerInput.phone) {
      customer = await promisify(customerStore.index('phone').get(customerInput.phone));
    }
    if (!customer && (customerInput.name || customerInput.phone)) {
      const newCustomerId = await promisify(
        customerStore.add({
          name: customerInput.name || 'Walk-in Customer',
          phone: customerInput.phone || '',
          address: customerInput.address || '',
          created_at: new Date().toISOString(),
        })
      );
      customer = {
        id: newCustomerId,
        name: customerInput.name || 'Walk-in Customer',
        phone: customerInput.phone || '',
        address: customerInput.address || '',
      };
    }

    // Bill number — the sequential counter row in "settings",
    // incremented inside this same transaction so a number is never
    // consumed without a bill existing for it, or vice versa.
    const counterRow = await promisify(settingsStore.get(BILL_COUNTER_KEY));
    const nextNumber = (counterRow?.value || 0) + 1;
    settingsStore.put({ key: BILL_COUNTER_KEY, value: nextNumber });

    const billRow = {
      bill_no: nextNumber,
      customer_id: customer?.id ?? null,
      // Denormalized on purpose — same reasoning as an article's own
      // image_uri copy (point 1): if the customer's name gets corrected
      // later, this bill should still show what was true at the time.
      customer_name: customer?.name || 'Walk-in Customer',
      customer_phone: customer?.phone || '',
      items: lineItems,
      subtotal: Math.round(subtotal),
      discount,
      discount_amount: discountAmount,
      total,
      amount_paid: amountPaid,
      payment_status: paymentStatus,
      status: 'active',
      notes: payload?.notes || '',
      created_at: new Date().toISOString(),
    };
    billId = await promisify(billStore.add(billRow));

    // Flip every included article to sold, priced at THIS bill's own
    // computed line total (gold value + making + wastage at the karat
    // actually sold at) — not the plain weight × 24K-rate figure
    // computePrice() would give. Karat/making/wastage themselves are
    // NOT written onto the article (per the confirmed schema decision
    // at the top of the plan) — they live only on the bill's line item;
    // bill_id is, so a sold piece can still be traced back to the bill
    // that priced it.
    for (const line of lineItems) {
      const article = await promisify(articleStore.get(line.article_id));
      articleStore.put({
        ...article,
        status: 'sold',
        sold_at: billRow.created_at,
        sold_rate_per_tola: ratePerTola,
        sold_price: line.line_total,
        bill_id: billId,
      });
    }

    await done;
    return { ...billRow, id: billId };
  } catch (err) {
    // Roll back everything above — the bill row, the article status
    // flips, the counter increment, any new-customer row — so a
    // rejected bill never leaves a half-finished trace (point 2).
    try {
      transaction.abort();
    } catch {
      /* transaction already finished; nothing to roll back */
    }
    throw err;
  }
}

// Reverses createBill(): flips the bill to 'voided' (never deleted —
// point 9) and restocks every article it contains, clearing their
// sold_* snapshot exactly the way setArticleStatus('in_stock') already
// does for a single article. One atomic transaction across both
// stores, same as createBill().
export async function voidBill(id) {
  const database = await getDb();
  const transaction = database.transaction(['bills', 'articles'], 'readwrite');
  const billStore = transaction.objectStore('bills');
  const articleStore = transaction.objectStore('articles');

  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Could not void that bill.'));
  });

  const bill = await promisify(billStore.get(id));
  if (!bill) {
    throw new Error('That bill no longer exists.');
  }
  if (bill.status === 'voided') {
    throw new Error('That bill has already been voided.');
  }

  billStore.put({ ...bill, status: 'voided', voided_at: new Date().toISOString() });

  for (const line of bill.items || []) {
    const article = await promisify(articleStore.get(line.article_id));
    // The article itself may have since been deleted outright — nothing
    // to restock in that case, but the bill still voids cleanly.
    if (!article) continue;
    articleStore.put({
      ...article,
      status: 'in_stock',
      sold_at: null,
      sold_rate_per_tola: null,
      sold_price: null,
      bill_id: null,
    });
  }

  await done;
  return { ...bill, status: 'voided' };
}

// Records one payment against an already-created bill — a running
// ledger for partial payments / advances ("bayana") collected across
// several visits.
//
// This is a deliberate, narrow exception to "never let a bill's math
// be recomputed later": every OTHER locked field on a bill (items,
// subtotal, discount, discount_amount, total, karat/rate/making/
// wastage on each line) stays exactly what createBill() wrote, forever
// — this function never touches any of them. amount_paid and
// payment_status are different in kind: they describe how much of an
// already-fixed total has been collected so far, which is allowed to
// move over time the same way a real ledger's running balance does.
//
// Single transaction over "bills" only — unlike createBill()/voidBill()
// above, nothing else needs to change when a payment is recorded, so
// there's no second store to keep in sync.
export async function addPayment(billId, amount, note = '') {
  const database = await getDb();
  const store = tx(database, 'bills', 'readwrite');

  const existing = await promisify(store.get(billId));
  if (!existing) {
    throw new Error('That bill no longer exists.');
  }
  if (existing.status === 'voided') {
    throw new Error('This bill has been voided — no further payments can be recorded against it.');
  }

  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) {
    throw new Error('Enter an amount greater than zero.');
  }

  // Defensive default: every bill created before this phase has no
  // "payments" array at all (point 5 of the original plan / point 14
  // of the Phase 5 plan — a new optional array field needs no
  // DB_VERSION bump). Seed one synthetic entry from whatever
  // amount_paid was recorded at billing time, so the ledger reads
  // correctly from the bill's very first rupee instead of starting
  // blank the moment this feature happened to ship.
  const payments = Array.isArray(existing.payments)
    ? [...existing.payments]
    : existing.amount_paid > 0
    ? [{ amount: existing.amount_paid, paid_at: existing.created_at, note: 'Recorded at billing' }]
    : [];

  const alreadyPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const balanceDue = Math.max(0, existing.total - alreadyPaid);

  // Block bad state the same way the app already blocks it elsewhere
  // (point 10 of the original plan) — reject an overpayment outright,
  // with the actual balance in the message, rather than silently
  // clamping it to whatever room is left.
  if (amt > balanceDue) {
    const overBy = amt - balanceDue;
    throw new Error(`That would overpay this bill by ${formatPKR(overBy)} — enter ${formatPKR(balanceDue)} or less.`);
  }

  payments.push({ amount: amt, paid_at: new Date().toISOString(), note: (note || '').trim() });

  // Recompute the running total from the ledger itself (rounding once,
  // at the point of storage — point 7), then derive payment_status the
  // exact same way createBill() does: unpaid / partial / paid.
  const newAmountPaid = Math.round(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
  const paymentStatus = newAmountPaid <= 0 ? 'unpaid' : newAmountPaid >= existing.total ? 'paid' : 'partial';

  const updated = { ...existing, payments, amount_paid: newAmountPaid, payment_status: paymentStatus };
  await promisify(store.put(updated));
  return updated;
}

/* ---------------------------- Photos (one row per image_id) ---------------------------- */
//
// The "photos" store is the source of truth for what a photo actually
// looks like right now. Articles still carry their own image_uri copy
// (cropImage() and the edit-article preview read it directly), but
// every function below keeps that copy in sync automatically — so
// changing a photo here never leaves an article pointing at a stale
// picture.

export async function getPhoto(image_id) {
  const database = await getDb();
  const store = tx(database, 'photos', 'readonly');
  return promisify(store.get(image_id));
}

// Registers a brand-new photo — called the moment a photo is taken or
// uploaded on the Tag screen, before any article/block exists for it.
// No history entry: there's nothing to keep yet, this *is* the first
// version.
export async function createPhoto(image_id, uri) {
  const database = await getDb();
  const store = tx(database, 'photos', 'readwrite');
  const existing = await promisify(store.get(image_id));
  const now = new Date().toISOString();
  const row = {
    image_id,
    uri,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  await promisify(store.put(row));
  return row;
}

// Every earlier version of this photo, most-recently-replaced first.
export async function getPhotoHistory(image_id) {
  const database = await getDb();
  const store = tx(database, 'photo_history', 'readonly');
  const index = store.index('image_id');
  const rows = await promisify(index.getAll(image_id));
  return rows.sort((a, b) => (a.replaced_at < b.replaced_at ? 1 : -1));
}

// Swaps a photo's current image for a new one — the "Add Photo" button
// on the block board. Block positions/sizes (top/left/width/height
// percent, stored on each article) are never touched here, only the
// picture underneath them changes. Whatever was showing before is kept
// in photo_history instead of being thrown away, and every article on
// this photo gets its own image_uri copy refreshed to match.
export async function replacePhoto(image_id, newUri) {
  const database = await getDb();
  const transaction = database.transaction(['photos', 'photo_history', 'articles'], 'readwrite');
  const photoStore = transaction.objectStore('photos');
  const historyStore = transaction.objectStore('photo_history');
  const articleStore = transaction.objectStore('articles');

  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Could not save the new photo.'));
  });

  const existing = await promisify(photoStore.get(image_id));
  const now = new Date().toISOString();

  if (existing?.uri && existing.uri !== newUri) {
    historyStore.add({ image_id, uri: existing.uri, replaced_at: now });
  }

  photoStore.put({
    image_id,
    uri: newUri,
    created_at: existing?.created_at || now,
    updated_at: now,
  });

  // Refresh every article's own image_uri copy so exports and the
  // article edit screen show the new photo instead of the old one.
  const cursorReq = articleStore.index('image_id').openCursor(IDBKeyRange.only(image_id));
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    cursor.update({ ...cursor.value, image_uri: newUri });
    cursor.continue();
  };

  await done;
  return { image_id, uri: newUri, created_at: existing?.created_at || now, updated_at: now };
}

// Brings back a specific previous photo from history and makes it
// current again. Whatever is showing right now gets pushed into
// history in its place, and the restored version's own history row is
// removed (it's current now, not "previous").
export async function restorePhoto(image_id, historyId) {
  const database = await getDb();
  const transaction = database.transaction(['photos', 'photo_history', 'articles'], 'readwrite');
  const photoStore = transaction.objectStore('photos');
  const historyStore = transaction.objectStore('photo_history');
  const articleStore = transaction.objectStore('articles');

  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Could not restore that photo.'));
  });

  const historyEntry = await promisify(historyStore.get(historyId));
  if (!historyEntry || historyEntry.image_id !== image_id) {
    throw new Error('That photo is no longer available.');
  }
  const existing = await promisify(photoStore.get(image_id));
  const now = new Date().toISOString();

  historyStore.delete(historyId);

  if (existing?.uri && existing.uri !== historyEntry.uri) {
    historyStore.add({ image_id, uri: existing.uri, replaced_at: now });
  }

  photoStore.put({
    image_id,
    uri: historyEntry.uri,
    created_at: existing?.created_at || now,
    updated_at: now,
  });

  const cursorReq = articleStore.index('image_id').openCursor(IDBKeyRange.only(image_id));
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    cursor.update({ ...cursor.value, image_uri: historyEntry.uri });
    cursor.continue();
  };

  await done;
  return { image_id, uri: historyEntry.uri };
}

/* ---------------------------- Backup (export / import everything) ---------------------------- */

// Bumped whenever the shape of the export changes, so a future version
// of the app can tell an old backup file apart from a new one. v2 adds
// "photos" + "photo_history" alongside articles/settings. v3 adds
// "customers" + "bills".
const BACKUP_FORMAT_VERSION = 3;

// Dumps every store (articles + settings + photos + photo_history +
// customers + bills) into one plain JSON-safe object. This is the
// entire catalog — the thing that disappears if the browser clears
// storage — so it's deliberately store-agnostic: add a new object
// store later and it still needs to be added here explicitly (kept
// simple on purpose rather than "clever").
export async function exportDatabase() {
  const database = await getDb();
  const articles = await promisify(tx(database, 'articles', 'readonly').getAll());
  const settingsRows = await promisify(tx(database, 'settings', 'readonly').getAll());
  const photos = await promisify(tx(database, 'photos', 'readonly').getAll());
  const photoHistory = await promisify(tx(database, 'photo_history', 'readonly').getAll());
  const customers = await promisify(tx(database, 'customers', 'readonly').getAll());
  const bills = await promisify(tx(database, 'bills', 'readonly').getAll());

  return {
    app: 'jewelry_business',
    format_version: BACKUP_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    counts: { articles: articles.length, photos: photos.length, customers: customers.length, bills: bills.length },
    data: {
      articles,
      settings: settingsRows,
      photos,
      photo_history: photoHistory,
      customers,
      bills,
    },
  };
}

// Restores a backup produced by exportDatabase(). mode:
//   - 'replace' (default): wipes both stores first, then loads the
//     backup — use for "restore this catalog on a new device/browser".
//   - 'merge': keeps existing rows and adds the backup's articles as
//     new rows (their old numeric ids are dropped so they don't clash
//     with anything already here); the settings/gold-rate row is only
//     written if none exists yet.
// Runs as a single readwrite transaction across both stores so a
// failure partway through doesn't leave the catalog half-restored.
export async function importDatabase(backup, { mode = 'replace' } = {}) {
  if (!backup || typeof backup !== 'object' || !backup.data || !Array.isArray(backup.data.articles)) {
    throw new Error('That file doesn\u2019t look like a jewelry shop backup.');
  }

  const database = await getDb();
  const transaction = database.transaction(
    ['articles', 'settings', 'photos', 'photo_history', 'customers', 'bills'],
    'readwrite'
  );
  const articleStore = transaction.objectStore('articles');
  const settingsStore = transaction.objectStore('settings');
  const photoStore = transaction.objectStore('photos');
  const historyStore = transaction.objectStore('photo_history');
  const customerStore = transaction.objectStore('customers');
  const billStore = transaction.objectStore('bills');

  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Restore was aborted.'));
  });

  // Backup files saved before v2 (format_version 1) don't have a
  // "photos" section at all — rebuild one from each article's own
  // image_uri so the restored catalog still gets a proper photos store.
  const backupPhotos = Array.isArray(backup.data.photos) ? backup.data.photos : null;
  const backupHistory = Array.isArray(backup.data.photo_history) ? backup.data.photo_history : [];
  const loadPhotos = (articles) => {
    if (backupPhotos) {
      for (const p of backupPhotos) photoStore.put(p);
      for (const h of backupHistory) {
        const { id, ...rest } = h;
        historyStore.add(rest);
      }
      return;
    }
    const seen = new Set();
    for (const a of articles) {
      if (a.image_id == null || seen.has(a.image_id) || !a.image_uri) continue;
      seen.add(a.image_id);
      photoStore.put({
        image_id: a.image_id,
        uri: a.image_uri,
        created_at: a.created_at || new Date().toISOString(),
        updated_at: a.created_at || new Date().toISOString(),
      });
    }
  };

  // Backups saved before v4 (format_version < 3) predate "customers"
  // and "bills" entirely. Unlike photos — which always existed
  // conceptually, just embedded on each article, so v2's importer can
  // rebuild the photos store from them — there's no equivalent prior
  // data a bill or customer could be reconstructed from: pre-v4 sales
  // were a single "mark as sold" tap with nothing itemized behind it.
  // An old backup therefore just restores with none of either.
  const backupCustomers = Array.isArray(backup.data.customers) ? backup.data.customers : [];
  const backupBills = Array.isArray(backup.data.bills) ? backup.data.bills : [];
  // NOTE (merge mode only): bills/customers are re-added with fresh
  // autoIncrement ids here, same as articles — so a merged bill's own
  // customer_id may no longer point at the right row. Each bill still
  // displays correctly regardless, since customer_name/customer_phone
  // are denormalized onto it (point 1); only the customer_id link and
  // bill_no's uniqueness are best-effort under merge, same class of
  // limitation "merge" already has for article names/photos today.
  const loadCustomersAndBills = () => {
    for (const customer of backupCustomers) {
      const { id, ...rest } = customer;
      customerStore.add(rest);
    }
    for (const bill of backupBills) {
      const { id, ...rest } = bill;
      billStore.add(rest);
    }
  };

  if (mode === 'replace') {
    articleStore.clear();
    settingsStore.clear();
    photoStore.clear();
    historyStore.clear();
    customerStore.clear();
    billStore.clear();
    for (const article of backup.data.articles) {
      const { id, ...rest } = article;
      articleStore.add(rest);
    }
    for (const row of backup.data.settings || []) {
      settingsStore.put(row);
    }
    loadPhotos(backup.data.articles);
    loadCustomersAndBills();
  } else {
    // merge
    for (const article of backup.data.articles) {
      const { id, ...rest } = article;
      articleStore.add(rest);
    }
    const existingRate = await promisify(settingsStore.get(GOLD_RATE_KEY));
    if (!existingRate) {
      const incomingRate = (backup.data.settings || []).find((r) => r.key === GOLD_RATE_KEY);
      if (incomingRate) settingsStore.put(incomingRate);
    }
    loadPhotos(backup.data.articles);
    loadCustomersAndBills();
  }

  await done;
  return {
    articlesImported: backup.data.articles.length,
    customersImported: backupCustomers.length,
    billsImported: backupBills.length,
    mode,
  };
}
