// Keeps the open photos in this browser (IndexedDB), so a reload or a closed tab doesn't lose them.
// Photos stay on this computer: nothing here is uploaded.
import type { Crop } from './canvas';
import type { Settings } from './types';

const DB_NAME = 'negative-studio', DB_VERSION = 1;

/** One open photo, without its pixels. `key` names its file in the `files` store. */
export type StoredTab = {
  key: string; name: string; info: string; rot: number; flip: boolean; crop: Crop | null;
  settings: Partial<Settings>;
};
/** The open photos of one user, in tab order. */
export type StoredSession = { tabs: StoredTab[]; activeKey: string | null };

let opening: Promise<IDBDatabase> | undefined;
function open() {
  opening ??= new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('sessions');
      req.result.createObjectStore('files');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => { opening = undefined; rej(req.error); };
  });
  return opening;
}

async function run<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(stores, mode), req = fn(tx);
    tx.oncomplete = () => res(req ? req.result : undefined);
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
}

const fileKey = (userId: string, key: string) => `${userId}/${key}`;

/** The saved photos with their files; photos whose file is missing are left out. Files no photo uses are deleted. */
export async function loadSession(userId: string): Promise<{ session: StoredSession; files: Map<string, Blob> } | null> {
  const session = await run<StoredSession | undefined>(['sessions'], 'readonly', tx => tx.objectStore('sessions').get(userId));
  const used = new Set(session?.tabs.map(t => fileKey(userId, t.key)));
  const all = await run(['files'], 'readonly', tx => tx.objectStore('files').getAllKeys(IDBKeyRange.bound(`${userId}/`, `${userId}/￿`)));
  const unused = (all ?? []).filter(k => !used.has(String(k)));
  if (unused.length) await run(['files'], 'readwrite', tx => { for (const k of unused) tx.objectStore('files').delete(k); });
  if (!session?.tabs.length) return null;
  const files = new Map<string, Blob>();
  for (const t of session.tabs) {
    const blob = await run<Blob | undefined>(['files'], 'readonly', tx => tx.objectStore('files').get(fileKey(userId, t.key)));
    if (blob) files.set(t.key, blob);
  }
  return { session: { ...session, tabs: session.tabs.filter(t => files.has(t.key)) }, files };
}

export const saveSession = (userId: string, session: StoredSession) =>
  run(['sessions'], 'readwrite', tx => { tx.objectStore('sessions').put(session, userId); });

export const saveFile = (userId: string, key: string, file: Blob) =>
  run(['files'], 'readwrite', tx => { tx.objectStore('files').put(file, fileKey(userId, key)); });

export const deleteFile = (userId: string, key: string) =>
  run(['files'], 'readwrite', tx => { tx.objectStore('files').delete(fileKey(userId, key)); });
