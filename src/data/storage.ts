import type { Character, CharacterSummary, Preferences } from '../types';

export interface StoredCatalog {
  schemaVersion: 1;
  characters: CharacterSummary[];
  checkedAt: string | null;
  lastSuccess: string | null;
}

export interface StorageStatus {
  persistent: boolean;
  reason: string | null;
}

export interface PreferencesRecord {
  preferences: Preferences | null;
  revision: number;
}

export class PreferencesConflictError extends Error {
  constructor() {
    super('另一标签页刚刚更新了排行榜，本次整份替换未保存。已载入最新内容，请确认后重试。');
    this.name = 'PreferencesConflictError';
  }
}

export interface BrowserStorage {
  getCatalog(): Promise<StoredCatalog | null>;
  saveCatalog(catalog: StoredCatalog): Promise<void>;
  getCharacter(id: string): Promise<Character | null>;
  saveCharacter(character: Character): Promise<void>;
  getPreferences(): Promise<Preferences | null>;
  savePreferences(preferences: Preferences): Promise<void>;
  getPreferencesRecord(): Promise<PreferencesRecord>;
  updatePreferences(
    updater: (current: Preferences | null) => Preferences,
    expectedRevision?: number,
  ): Promise<PreferencesRecord>;
  subscribePreferences(listener: (record: PreferencesRecord) => void): () => void;
  getStatus(): StorageStatus;
  subscribeStatus(listener: () => void): () => void;
}

interface StorageOptions {
  name?: string;
  indexedDB?: IDBFactory | null;
  openTimeout?: number;
  broadcast?: boolean;
}

const STORE_NAME = 'records';

export function createBrowserStorage(options: StorageOptions = {}): BrowserStorage {
  const factory = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  const memory = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  const preferencesListeners = new Set<(record: PreferencesRecord) => void>();
  let status: StorageStatus = { persistent: true, reason: null };
  let database: Promise<IDBDatabase | null> | null = null;
  let writes: Promise<void> = Promise.resolve();
  const name = options.name ?? 'xin-chao-browser-v1';
  const channel = options.broadcast !== false
    && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(`${name}:preferences`) : null;

  function degrade() {
    if (!status.persistent) return;
    status = {
      persistent: false,
      reason: '浏览器未能保存本地数据，本次操作仅保留在当前页面。请及时导出你的排行榜。',
    };
    listeners.forEach((listener) => listener());
  }

  function open(): Promise<IDBDatabase | null> {
    if (!status.persistent) return Promise.resolve(null);
    if (database) return database;
    if (!factory) {
      degrade();
      return Promise.resolve(null);
    }
    database = new Promise((resolve) => {
      let settled = false;
      const finish = (db: IDBDatabase | null) => {
        if (settled) {
          db?.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (!db) degrade();
        resolve(db);
      };
      const timer = setTimeout(() => finish(null), options.openTimeout ?? 2500);
      try {
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            degrade();
          };
          finish(db);
        };
        request.onerror = () => finish(null);
        request.onblocked = () => finish(null);
      } catch {
        finish(null);
      }
    });
    return database;
  }

  async function read<T>(key: string): Promise<T | null> {
    await writes;
    const db = await open();
    if (db && status.persistent) {
      try {
        const result = await new Promise<T | undefined>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const request = tx.objectStore(STORE_NAME).get(key);
          request.onsuccess = () => resolve(request.result as T | undefined);
          request.onerror = () => reject(request.error);
          tx.onabort = () => reject(tx.error);
        });
        if (result !== undefined) {
          memory.set(key, structuredClone(result));
          return structuredClone(result);
        }
      } catch {
        degrade();
      }
    }
    return memory.has(key) ? structuredClone(memory.get(key) as T) : null;
  }

  function write<T>(key: string, value: T): Promise<void> {
    const snapshot = structuredClone(value);
    memory.set(key, snapshot);
    writes = writes.then(async () => {
      const db = await open();
      if (!db || !status.persistent) return;
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(snapshot, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } catch {
        degrade();
      }
    });
    return writes;
  }

  function memoryPreferences(): PreferencesRecord {
    return {
      preferences: memory.has('preferences') ? structuredClone(memory.get('preferences') as Preferences) : null,
      revision: Number(memory.get('preferences:revision')) || 0,
    };
  }

  function rememberPreferences(record: PreferencesRecord) {
    if (record.preferences) memory.set('preferences', structuredClone(record.preferences));
    memory.set('preferences:revision', record.revision);
  }

  async function getPreferencesRecord(): Promise<PreferencesRecord> {
    await writes;
    const db = await open();
    if (db && status.persistent) {
      try {
        const record = await new Promise<PreferencesRecord>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const preferences = store.get('preferences');
          const revision = store.get('preferences:revision');
          tx.oncomplete = () => resolve({
            preferences: preferences.result as Preferences | undefined ?? null,
            revision: Number(revision.result) || 0,
          });
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        rememberPreferences(record);
        return structuredClone(record);
      } catch {
        degrade();
      }
    }
    return memoryPreferences();
  }

  function updatePreferences(
    updater: (current: Preferences | null) => Preferences,
    expectedRevision?: number,
  ): Promise<PreferencesRecord> {
    const operation = writes.then(async () => {
      const apply = (current: PreferencesRecord): PreferencesRecord => {
        if (expectedRevision !== undefined && expectedRevision !== current.revision) {
          throw new PreferencesConflictError();
        }
        return {
          preferences: structuredClone(updater(structuredClone(current.preferences))),
          revision: current.revision + 1,
        };
      };
      const db = await open();
      let result: PreferencesRecord | null = null;
      let mutationError: unknown;
      if (db && status.persistent) {
        try {
          result = await new Promise<PreferencesRecord>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const preferences = store.get('preferences');
            const revision = store.get('preferences:revision');
            let reads = 0;
            let updated: PreferencesRecord;
            const onRead = () => {
              reads += 1;
              if (reads !== 2) return;
              try {
                const current = {
                  preferences: preferences.result as Preferences | undefined ?? null,
                  revision: Number(revision.result) || 0,
                };
                rememberPreferences(current);
                updated = apply(current);
                store.put(updated.preferences, 'preferences');
                store.put(updated.revision, 'preferences:revision');
              } catch (error) {
                mutationError = error;
                tx.abort();
              }
            };
            preferences.onsuccess = onRead;
            revision.onsuccess = onRead;
            tx.oncomplete = () => resolve(updated);
            tx.onerror = () => reject(mutationError ?? tx.error);
            tx.onabort = () => reject(mutationError ?? tx.error);
          });
        } catch (error) {
          if (mutationError !== undefined) throw error;
          degrade();
        }
      }
      result ??= apply(memoryPreferences());
      rememberPreferences(result);
      preferencesListeners.forEach((listener) => listener(structuredClone(result)));
      if (status.persistent) channel?.postMessage({ type: 'preferences-changed', revision: result.revision });
      return structuredClone(result);
    });
    // A rejected user mutation must not poison subsequent writes.
    writes = operation.then(() => undefined, () => undefined);
    return operation;
  }

  channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: string } | null;
    if (data?.type !== 'preferences-changed') return;
    void getPreferencesRecord().then((record) => {
      preferencesListeners.forEach((listener) => listener(record));
    });
  });

  return {
    getCatalog: () => read<StoredCatalog>('catalog'),
    saveCatalog: (catalog) => write('catalog', catalog),
    getCharacter: (id) => read<Character>(`character:${id}`),
    saveCharacter: (character) => write(`character:${character.id}`, character),
    getPreferences: async () => (await getPreferencesRecord()).preferences,
    savePreferences: async (preferences) => { await updatePreferences(() => preferences); },
    getPreferencesRecord,
    updatePreferences,
    subscribePreferences: (listener) => {
      preferencesListeners.add(listener);
      return () => preferencesListeners.delete(listener);
    },
    getStatus: () => status,
    subscribeStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const browserStorage = createBrowserStorage();
