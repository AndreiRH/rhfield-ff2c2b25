// IndexedDB snapshot used by both the client warm-up and the SW.
// Three stores:
//   - tables: key=table name, value=row[]
//   - blobs:  key="<bucket>/<path>", value={ blob, type, savedAt }
//   - meta:   key=string, value=anything (lastSync, etc.)

const DB_NAME = "rhfield-snapshot";
const DB_VERSION = 2;
const TABLES = "tables";
const BLOBS  = "blobs";
const META   = "meta";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TABLES)) db.createObjectStore(TABLES);
      if (!db.objectStoreNames.contains(BLOBS))  db.createObjectStore(BLOBS);
      if (!db.objectStoreNames.contains(META))   db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(store: string, key: string, value: unknown) {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function get<T>(store: string, key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readonly");
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => res((r.result as T) ?? null);
    r.onerror = () => rej(r.error);
  });
}

export async function putTable(name: string, rows: unknown[]) { await put(TABLES, name, rows); }
export async function getTable<T = unknown>(name: string): Promise<T[] | null> {
  return await get<T[]>(TABLES, name);
}

export async function putBlob(bucket: string, path: string, blob: Blob) {
  await put(BLOBS, `${bucket}/${path}`, { blob, type: blob.type || "application/octet-stream", savedAt: Date.now() });
}
export async function hasBlob(bucket: string, path: string): Promise<boolean> {
  const v = await get<{ blob: Blob }>(BLOBS, `${bucket}/${path}`);
  return !!v?.blob;
}

export async function getMeta(key: string) { return await get<unknown>(META, key); }
export async function setMeta(key: string, value: unknown) { await put(META, key, value); }
