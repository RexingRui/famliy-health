// Minimal promise wrapper over IndexedDB for the drafts store.

const DB_NAME = 'healthlog'
const STORE = 'drafts'
const VERSION = 1

let opening: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => {
      // Let a newer version (another tab after an upgrade) take over instead of blocking it.
      req.result.onversionchange = () => {
        req.result.close()
        opening = null
      }
      resolve(req.result)
    }
    req.onerror = () => {
      opening = null
      reject(req.error)
    }
  })
  return opening
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

export const idbGetAll = <T>() => run<T[]>('readonly', (s) => s.getAll() as IDBRequest<T[]>)
export const idbGet = <T>(id: string) => run<T | undefined>('readonly', (s) => s.get(id) as IDBRequest<T | undefined>)
export const idbPut = <T>(value: T) => run('readwrite', (s) => s.put(value)).then(() => undefined)
export const idbDelete = (id: string) => run('readwrite', (s) => s.delete(id)).then(() => undefined)

/** Test hook: forget the cached connection (fake-indexeddb is reset between tests). */
export function resetIdbConnection() {
  opening = null
}
