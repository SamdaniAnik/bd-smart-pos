/**
 * IndexedDB cache for offline-first POS operation.
 * Stores products, customers, and the offline sale queue with more capacity
 * than localStorage alone.
 */

const DB_NAME = "bd_pos_offline_v1";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("products")) {
        db.createObjectStore("products", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("offlineQueue")) {
        const q = db.createObjectStore("offlineQueue", { keyPath: "localRef" });
        q.createIndex("status", "status", { unique: false });
      }
    };
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    Promise.resolve(fn(store))
      .then((result) => {
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
      })
      .catch(reject);
  });
}

export async function cacheProducts(products) {
  if (!Array.isArray(products) || !products.length) return 0;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["products", "meta"], "readwrite");
    const productStore = tx.objectStore("products");
    productStore.clear();
    for (const p of products) productStore.put(p);
    tx.objectStore("meta").put({ key: "products", cachedAt: Date.now(), count: products.length });
    tx.oncomplete = () => resolve(products.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function readCachedProducts() {
  try {
    const rows = await withStore("products", "readonly", (store) => {
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function getProductsCacheMeta() {
  try {
    return await withStore("meta", "readonly", (store) => {
      return new Promise((resolve) => {
        const req = store.get("products");
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });
  } catch {
    return null;
  }
}

export async function persistOfflineQueueItem(item) {
  return withStore("offlineQueue", "readwrite", (store) => {
    store.put(item);
    return item;
  });
}

export async function readOfflineQueueFromDb() {
  try {
    const rows = await withStore("offlineQueue", "readonly", (store) => {
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function removeOfflineQueueItem(localRef) {
  return withStore("offlineQueue", "readwrite", (store) => {
    store.delete(localRef);
  });
}

export async function clearResolvedOfflineQueue() {
  const rows = await readOfflineQueueFromDb();
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("offlineQueue", "readwrite");
    const store = tx.objectStore("offlineQueue");
    for (const row of rows) {
      const status = String(row.status || "").toUpperCase();
      if (status === "RESOLVED" || status === "REVIEWING") store.delete(row.localRef);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
