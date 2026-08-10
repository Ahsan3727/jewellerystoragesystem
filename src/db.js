// src/db.js
//
// IndexedDB layer for the shop. Two stores:
//   - "articles": every jewelry piece (a tagged block on a catalog
//     photo) — name, category, weight in grams, description, image
//     data + block position.
//   - "settings": one row, the gold rate (Rs per tola) you update from
//     the Gold Rate screen. Every article's price is calculated live
//     from weight × this rate, never stored — so changing the rate
//     once updates every price in the app immediately.
//
// v1 of this app shipped a "jewelry_products" store (tagged items) and
// an unrelated "articles" store (a shop-blog CMS: title/author/status).
// v2 drops the blog store and turns "articles" into the real jewelry
// item table, carrying over anything that was in "jewelry_products".

const DB_NAME = 'jewelry_business';
const DB_VERSION = 2;
const GOLD_RATE_KEY = 'gold_rate_per_tola';

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

/* ---------------------------- Articles (jewelry pieces) ---------------------------- */

export async function addArticle(article) {
  const database = await getDb();
  const store = tx(database, 'articles', 'readwrite');
  const row = {
    name: article.name,
    category: article.category || 'Other',
    weight_grams: Number(article.weight_grams) || 0,
    description: article.description || '',
    image_uri: article.image_uri,
    image_id: article.image_id,
    top_percent: article.top_percent,
    left_percent: article.left_percent,
    width_percent: article.width_percent ?? 15,
    height_percent: article.height_percent ?? 15,
    export_uri: null,
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
    description: article.description || '',
  };
  await promisify(store.put(updated));
}

export async function setExportUri(id, export_uri) {
  const database = await getDb();
  const store = tx(database, 'articles', 'readwrite');
  const existing = await promisify(store.get(id));
  if (!existing) return;
  await promisify(store.put({ ...existing, export_uri }));
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
  const totalWeight = all.reduce((sum, a) => sum + (Number(a.weight_grams) || 0), 0);
  return { total: all.length, totalWeight };
}
