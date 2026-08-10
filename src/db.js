// src/db.js
//
// Browser equivalent of the original expo-sqlite `db.js`. There is still
// no server and no network call — IndexedDB is a real database built into
// every browser that persists on the visitor's own device (survives page
// reloads and closing the tab, cleared only if they clear site data).
// The function names below intentionally match the original file so the
// rest of the app ports over with almost no logic changes.

const DB_NAME = 'jewelry_business';
const DB_VERSION = 1;

let dbPromise;

export function getDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains('jewelry_products')) {
          const products = database.createObjectStore('jewelry_products', {
            keyPath: 'id',
            autoIncrement: true,
          });
          products.createIndex('image_id', 'image_id');
          products.createIndex('created_at', 'created_at');
        }

        if (!database.objectStoreNames.contains('articles')) {
          const articles = database.createObjectStore('articles', {
            keyPath: 'id',
            autoIncrement: true,
          });
          articles.createIndex('created_at', 'created_at');
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

// Equivalent of running the schema once. Safe to call every launch.
export async function initDatabase() {
  await getDb();
}

function tx(database, storeName, mode) {
  const transaction = database.transaction(storeName, mode);
  return transaction.objectStore(storeName);
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ---------------- Products (tagged jewelry items) ---------------- */

export async function addProduct(product) {
  const database = await getDb();
  const store = tx(database, 'jewelry_products', 'readwrite');
  const row = {
    name: product.name,
    price: product.price,
    material: product.material || '',
    description: product.description || '',
    image_uri: product.image_uri,
    image_id: product.image_id,
    top_percent: product.top_percent,
    left_percent: product.left_percent,
    width_percent: product.width_percent ?? 15,
    height_percent: product.height_percent ?? 15,
    export_uri: null,
    created_at: new Date().toISOString(),
  };
  return promisify(store.add(row));
}

export async function getProducts(searchTerm = '') {
  const database = await getDb();
  const store = tx(database, 'jewelry_products', 'readonly');
  const all = await promisify(store.getAll());
  const filtered = searchTerm
    ? all.filter((p) => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : all;
  return filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function getProductsForImage(image_id) {
  const database = await getDb();
  const store = tx(database, 'jewelry_products', 'readonly');
  const index = store.index('image_id');
  return promisify(index.getAll(image_id));
}

export async function updateProduct(id, product) {
  const database = await getDb();
  const store = tx(database, 'jewelry_products', 'readwrite');
  const existing = await promisify(store.get(id));
  if (!existing) return;
  const updated = {
    ...existing,
    name: product.name,
    price: product.price,
    material: product.material || '',
    description: product.description || '',
  };
  await promisify(store.put(updated));
}

export async function setExportUri(id, export_uri) {
  const database = await getDb();
  const store = tx(database, 'jewelry_products', 'readwrite');
  const existing = await promisify(store.get(id));
  if (!existing) return;
  await promisify(store.put({ ...existing, export_uri }));
}

export async function getProduct(id) {
  const database = await getDb();
  const store = tx(database, 'jewelry_products', 'readonly');
  return promisify(store.get(id));
}

// Same behavior as the old delete-product.php, just local and instant.
export async function deleteProduct(id) {
  const database = await getDb();
  const store = tx(database, 'jewelry_products', 'readwrite');
  await promisify(store.delete(id));
}

export async function getProductStats() {
  const database = await getDb();
  const store = tx(database, 'jewelry_products', 'readonly');
  const count = await promisify(store.count());
  return { total: count };
}

/* ---------------------------- Articles ---------------------------- */

export async function addArticle(article) {
  const database = await getDb();
  const store = tx(database, 'articles', 'readwrite');
  const row = {
    title: article.title,
    category: article.category,
    author: article.author || '',
    status: article.status || 'draft',
    content: article.content || '',
    created_at: new Date().toISOString(),
  };
  return promisify(store.add(row));
}

export async function getArticles(searchTerm = '') {
  const database = await getDb();
  const store = tx(database, 'articles', 'readonly');
  const all = await promisify(store.getAll());
  const filtered = searchTerm
    ? all.filter((a) => a.title.toLowerCase().includes(searchTerm.toLowerCase()))
    : all;
  return filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
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
  await promisify(
    store.put({
      ...existing,
      title: article.title,
      category: article.category,
      author: article.author || '',
      status: article.status || 'draft',
      content: article.content || '',
    })
  );
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
  return {
    total: all.length,
    published: all.filter((a) => a.status === 'published').length,
    drafts: all.filter((a) => a.status === 'draft').length,
  };
}
