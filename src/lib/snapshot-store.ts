// Tiny IndexedDB-backed snapshot of every table the warm-up syncs.
// The service worker also reads from this DB to answer offline reads.

const DB_NAME = "rhfield-snapshot";
const DB_VERSION = 1;
const STORE = "tables"; // key = table name, value = array of rows

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putTable(name: string, rows: unknown[]) {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rows, name);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function getTable<T = unknown>(name: string): Promise<T[] | null> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).get(name);
    r.onsuccess = () => res((r.result as T[]) ?? null);
    r.onerror = () => rej(r.error);
  });
}

export async function getMeta(key: string): Promise<unknown> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).get(`__meta__:${key}`);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function setMeta(key: string, value: unknown) {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, `__meta__:${key}`);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
