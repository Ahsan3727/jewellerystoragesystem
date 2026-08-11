// src/db.js
//
// IndexedDB layer for the shop. Four stores:
//   - "articles": every jewelry piece (a tagged block on a catalog
//     photo) — name, category, weight in grams, description, its own
//     copy of image_uri (kept in sync, see "photos" below) + block
//     position.
//   - "settings": one row, the gold rate (Rs per tola) you update from
//     the Gold Rate screen. Every article's price is calculated live
//     from weight × this rate, never stored — so changing the rate
//     once updates every price in the app immediately.
//   - "photos": one row per image_id — the actual photo everyone's
//     blocks sit on top of right now. This is the source of truth for
//     "what does this photo look like"; articles just carry a synced
//     copy of image_uri for convenience (crop exports, the edit-article
//     preview). Changing the photo on the block board updates this one
//     row instead of every article that happens to reference it.
//   - "photo_history": every photo a given image_id used to show
//     before it was replaced, so "Add Photo" never throws the old
//     picture away — it's saved and can be brought back later.
//
// v1 of this app shipped a "jewelry_products" store (tagged items) and
// an unrelated "articles" store (a shop-blog CMS: title/author/status).
// v2 drops the blog store and turns "articles" into the real jewelry
// item table, carrying over anything that was in "jewelry_products".
// v3 adds "photos" / "photo_history" and backfills "photos" from
// whatever image_uri each existing article was already carrying.

const DB_NAME = 'jewelry_business';
const DB_VERSION = 3;
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
    status: article.status === 'sold' ? 'sold' : 'in_stock',
    sold_at: article.status === 'sold' ? new Date().toISOString() : null,
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
export async function setArticleStatus(id, status) {
  const database = await getDb();
  const store = tx(database, 'articles', 'readwrite');
  const existing = await promisify(store.get(id));
  if (!existing) return;
  const updated = {
    ...existing,
    status: status === 'sold' ? 'sold' : 'in_stock',
    sold_at: status === 'sold' ? new Date().toISOString() : null,
  };
  await promisify(store.put(updated));
  return updated;
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
  const sumWeight = (rows) => rows.reduce((sum, a) => sum + (Number(a.weight_grams) || 0), 0);
  return {
    total: all.length,
    totalWeight: sumWeight(all),
    inStockCount: inStock.length,
    inStockWeight: sumWeight(inStock),
    soldCount: sold.length,
    soldWeight: sumWeight(sold),
  };
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
// "photos" + "photo_history" alongside articles/settings.
const BACKUP_FORMAT_VERSION = 2;

// Dumps every store (articles + settings + photos + photo_history)
// into one plain JSON-safe object. This is the entire catalog — the
// thing that disappears if the browser clears storage — so it's
// deliberately store-agnostic: add a new object store later and it
// still needs to be added here explicitly (kept simple on purpose
// rather than "clever").
export async function exportDatabase() {
  const database = await getDb();
  const articles = await promisify(tx(database, 'articles', 'readonly').getAll());
  const settingsRows = await promisify(tx(database, 'settings', 'readonly').getAll());
  const photos = await promisify(tx(database, 'photos', 'readonly').getAll());
  const photoHistory = await promisify(tx(database, 'photo_history', 'readonly').getAll());

  return {
    app: 'jewelry_business',
    format_version: BACKUP_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    counts: { articles: articles.length, photos: photos.length },
    data: {
      articles,
      settings: settingsRows,
      photos,
      photo_history: photoHistory,
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
  const transaction = database.transaction(['articles', 'settings', 'photos', 'photo_history'], 'readwrite');
  const articleStore = transaction.objectStore('articles');
  const settingsStore = transaction.objectStore('settings');
  const photoStore = transaction.objectStore('photos');
  const historyStore = transaction.objectStore('photo_history');

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

  if (mode === 'replace') {
    articleStore.clear();
    settingsStore.clear();
    photoStore.clear();
    historyStore.clear();
    for (const article of backup.data.articles) {
      const { id, ...rest } = article;
      articleStore.add(rest);
    }
    for (const row of backup.data.settings || []) {
      settingsStore.put(row);
    }
    loadPhotos(backup.data.articles);
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
  }

  await done;
  return { articlesImported: backup.data.articles.length, mode };
}
