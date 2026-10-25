import { useEffect, useSyncExternalStore } from 'react';
import { browserStorage } from '../data/storage';
import { applyAssetOverrides } from '../data/assets';
import type { BrowserStorage, StoredCatalog } from '../data/storage';
import { fetchWikiCatalog, fetchWikiCharacter, toSummary, validateCharacterUpdate } from '../data/wiki';
import type {
  CatalogController,
  CatalogIndex,
  Character,
  CharacterSummary,
  SyncState,
  WikiCatalogItem,
} from '../types';

export const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
const RETRY_DELAY = 5 * 60 * 1000;

interface CatalogSnapshot {
  characters: CharacterSummary[];
  loading: boolean;
  error: string | null;
  sync: SyncState;
}

interface CatalogDependencies {
  storage?: BrowserStorage;
  loadIndex?: () => Promise<CatalogIndex>;
  loadSnapshot?: (id: string) => Promise<Character>;
  fetchCatalog?: (signal?: AbortSignal) => Promise<WikiCatalogItem[]>;
  fetchCharacter?: (item: WikiCatalogItem, signal?: AbortSignal) => Promise<Character>;
  now?: () => number;
  refreshInterval?: number;
}

function timestamp(value: string | null | undefined): number {
  return value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
}

async function loadJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/${path}`, {
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!response.ok) throw new Error(`本地资料读取失败 (${response.status})`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

function validSummary(value: CharacterSummary): boolean {
  return !!value
    && typeof value.id === 'string' && /^[A-Za-z0-9_.:-]+$/.test(value.id)
    && typeof value.identityId === 'string'
    && typeof value.name === 'string'
    && typeof value.fetchedAt === 'string'
    && !!value.avatar && typeof value.avatar.url === 'string';
}

function assertCharacter(character: Character, id: string): void {
  if (!validSummary(character) || character.id !== id
    || !['artworks', 'archives', 'treasures', 'stories', 'outfits', 'voices', 'syncWarnings']
      .every((key) => Array.isArray(character[key as keyof Character]))) {
    throw new Error('角色资料结构不完整，已保留之前的资料。');
  }
}

export function createCatalogStore(dependencies: CatalogDependencies = {}) {
  const storage = dependencies.storage ?? browserStorage;
  const loadIndex = dependencies.loadIndex ?? (() => loadJson<CatalogIndex>('index.json'));
  const loadSnapshot = dependencies.loadSnapshot
    ?? ((id: string) => loadJson<Character>(`characters/${encodeURIComponent(id)}.json`));
  const fetchCatalog = dependencies.fetchCatalog ?? fetchWikiCatalog;
  const fetchCharacter = dependencies.fetchCharacter ?? fetchWikiCharacter;
  const now = dependencies.now ?? Date.now;
  const refreshInterval = dependencies.refreshInterval ?? UPDATE_INTERVAL;
  const summaries = new Map<string, CharacterSummary>();
  const seedSummaries = new Map<string, CharacterSummary>();
  const details = new Map<string, Character>();
  const requests = new Map<string, Promise<Character>>();
  const listeners = new Set<() => void>();
  let initialization: Promise<void> | null = null;
  let refreshing: Promise<void> | null = null;
  let seedGeneratedAt = 0;
  let lastAttemptAt = 0;
  let dataError: string | null = null;
  let snapshot: CatalogSnapshot = {
    characters: [],
    loading: true,
    error: null,
    sync: {
      phase: 'idle', completed: 0, total: 0, lastSuccess: null,
      message: '正在读取已保存的角色资料',
    },
  };

  function publish(changes: Partial<CatalogSnapshot> = {}) {
    snapshot = {
      ...snapshot,
      ...changes,
      error: [dataError, storage.getStatus().reason].filter(Boolean).join(' ') || null,
    };
    listeners.forEach((listener) => listener());
  }

  storage.subscribeStatus(() => publish());

  function mergeCharacters(characters: CharacterSummary[]) {
    for (const character of characters) {
      if (!validSummary(character)) continue;
      const current = summaries.get(character.id);
      if (!current || timestamp(character.fetchedAt) > timestamp(current.fetchedAt)) {
        summaries.set(character.id, applyAssetOverrides({
          ...character,
          wikiBadge: character.wikiBadge ?? seedSummaries.get(character.id)?.wikiBadge ?? '',
        }));
      }
    }
    publish({ characters: [...summaries.values()] });
  }

  function persistedCatalog(): StoredCatalog {
    return {
      schemaVersion: 1,
      characters: [...summaries.values()],
      checkedAt: lastAttemptAt ? new Date(lastAttemptAt).toISOString() : null,
      lastSuccess: snapshot.sync.lastSuccess,
    };
  }

  function rememberLatest(id: string, candidate: Character | null = null): Character | null {
    const current = details.get(id);
    if (current && (!candidate || timestamp(current.fetchedAt) >= timestamp(candidate.fetchedAt))) {
      return current;
    }
    if (candidate) {
      const corrected = applyAssetOverrides(candidate);
      details.set(id, corrected);
      return corrected;
    }
    return null;
  }

  async function previousCharacter(id: string): Promise<Character | null> {
    const known = details.get(id);
    if (known) return known;
    let saved = await storage.getCharacter(id);
    if (saved) {
      try { assertCharacter(saved, id); } catch { saved = null; }
    }
    const seed = seedSummaries.get(id);
    if (!seed || (saved && timestamp(saved.fetchedAt) >= timestamp(seed.fetchedAt))) return saved;
    try {
      const character = await loadSnapshot(id);
      assertCharacter(character, id);
      return character;
    } catch {
      return saved;
    }
  }

  function initialize(): Promise<void> {
    if (initialization) return initialization;
    initialization = (async () => {
      const results = await Promise.allSettled([
        (async () => {
          const index = await loadIndex();
          if (index.schemaVersion !== 1 || !Array.isArray(index.characters) || !index.characters.length) {
            throw new Error('基础资料目录无效');
          }
          seedGeneratedAt = timestamp(index.generatedAt);
          for (const character of index.characters) {
            if (validSummary(character)) seedSummaries.set(character.id, character);
          }
          mergeCharacters(index.characters);
          publish({ loading: false });
        })(),
        (async () => {
          const saved = await storage.getCatalog();
          if (saved?.schemaVersion === 1 && Array.isArray(saved.characters)) {
            lastAttemptAt = timestamp(saved.checkedAt);
            mergeCharacters(saved.characters);
            publish({
              loading: false,
              sync: { ...snapshot.sync, lastSuccess: saved.lastSuccess },
            });
          }
        })(),
      ]);
      if (!summaries.size) {
        dataError = results.some((result) => result.status === 'rejected')
          ? '暂时无法读取基础资料。正在尝试从鸣潮 Wiki 获取角色。'
          : '尚无本地角色资料，正在检查鸣潮 Wiki。';
      }
      publish({
        loading: false,
        sync: {
          ...snapshot.sync,
          lastSuccess: Math.max(seedGeneratedAt, timestamp(snapshot.sync.lastSuccess)) > 0
            ? new Date(Math.max(seedGeneratedAt, timestamp(snapshot.sync.lastSuccess))).toISOString()
            : null,
          message: summaries.size ? '角色资料已就绪' : '等待获取角色资料',
        },
      });
    })();
    return initialization;
  }

  function refresh(force = false): Promise<void> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      await initialize();
      const currentTime = now();
      const freshAt = Math.max(seedGeneratedAt, timestamp(snapshot.sync.lastSuccess));
      if (!force && summaries.size && currentTime - freshAt < refreshInterval) return;
      const attemptInterval = summaries.size ? refreshInterval : RETRY_DELAY;
      if (!force && lastAttemptAt && currentTime - lastAttemptAt < attemptInterval) return;
      lastAttemptAt = currentTime;
      dataError = null;
      publish({
        sync: { ...snapshot.sync, phase: 'checking', completed: 0, total: 0, message: '正在检查官方角色目录' },
      });
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 180_000);
      try {
        const catalog = await fetchCatalog(controller.signal);
        if (!Array.isArray(catalog) || !catalog.length || catalog.length > 2000
          || catalog.some((item) => !item || typeof item.id !== 'string' || !item.name)
          || new Set(catalog.map((item) => item.id)).size !== catalog.length) {
          throw new Error('官方目录校验未通过，已保留已有资料。');
        }
        let next = 0;
        let completed = 0;
        let succeeded = 0;
        let warned = 0;
        let protectedUpdates = 0;
        const failures: string[] = [];
        publish({
          sync: {
            ...snapshot.sync, phase: 'updating', completed: 0, total: catalog.length,
            message: `正在更新 ${catalog.length} 条角色资料`,
          },
        });
        async function worker() {
          while (next < catalog.length) {
            const item = catalog[next++];
            try {
              if (controller.signal.aborted) throw new Error('同步超时');
              const [incoming, previous] = await Promise.all([
                fetchCharacter(item, controller.signal),
                previousCharacter(item.id),
              ]);
              assertCharacter(incoming, item.id);
              const validated = previous ? validateCharacterUpdate(previous, incoming) : { character: incoming, warnings: [] };
              const character = rememberLatest(item.id, validated.character)!;
              if (validated.warnings.length) protectedUpdates += 1;
              mergeCharacters([toSummary(character)]);
              await storage.saveCharacter(character);
              succeeded += 1;
              if (character.syncWarnings.length) warned += 1;
            } catch {
              failures.push(item.name);
            }
            completed += 1;
            publish({
              sync: {
                ...snapshot.sync, completed,
                message: `正在更新角色资料 ${completed} / ${catalog.length}`,
              },
            });
          }
        }
        await Promise.all([worker(), worker()]);
        if (failures.length || protectedUpdates) {
          const names = failures.slice(0, 3).join('、');
          const failedMessage = failures.length
            ? `${names}${failures.length > 3 ? '等' : ''}共 ${failures.length} 条暂时无法更新`
            : '';
          const protectedMessage = protectedUpdates ? `${protectedUpdates} 条资料的部分栏目异常缺失` : '';
          publish({
            sync: {
              ...snapshot.sync, phase: 'error',
              message: `已更新 ${succeeded} 条资料；${[failedMessage, protectedMessage].filter(Boolean).join('，')}，已保留已有内容。`,
            },
          });
        } else {
          publish({
            sync: {
              ...snapshot.sync,
              phase: 'done',
              lastSuccess: new Date(now()).toISOString(),
              message: `已更新全部 ${succeeded} 条角色资料${warned ? `，其中 ${warned} 条仍有官方资料待补齐` : ''}。`,
            },
          });
        }
        dataError = null;
      } catch (error) {
        const message = error instanceof Error ? error.message : '暂时无法连接官方资料来源';
        publish({
          sync: {
            ...snapshot.sync, phase: 'error',
            message: `${message}。已有资料仍可使用，可稍后重试。`,
          },
        });
        if (!summaries.size) dataError = '暂时无法获取角色资料，请检查网络连接后点击刷新资料。';
      } finally {
        clearTimeout(deadline);
        if (summaries.size) await storage.saveCatalog(persistedCatalog());
        publish({ loading: false });
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  function getCharacter(id: string): Promise<Character> {
    const known = details.get(id);
    if (known) return Promise.resolve(known);
    const existing = requests.get(id);
    if (existing) return existing;
    const request = (async () => {
      await initialize();
      const live = details.get(id);
      if (live) return live;
      let saved = await storage.getCharacter(id);
      if (saved) {
        try {
          assertCharacter(saved, id);
        } catch {
          saved = null;
        }
      }
      const seed = seedSummaries.get(id);
      if (saved && (!seed || timestamp(saved.fetchedAt) >= timestamp(seed.fetchedAt))) {
        return rememberLatest(id, saved)!;
      }
      if (seed) {
        try {
          const character = await loadSnapshot(id);
          assertCharacter(character, id);
          const latest = rememberLatest(id, character)!;
          await storage.saveCharacter(latest);
          return rememberLatest(id, latest)!;
        } catch {
          const fallback = rememberLatest(id, saved);
          if (fallback) return fallback;
        }
      }
      const summary = summaries.get(id);
      if (!summary) throw new Error('未找到该角色，请刷新资料后再试。');
      try {
        const character = await fetchCharacter({ id, name: summary.name, iconUrl: summary.avatar.url });
        assertCharacter(character, id);
        const latest = rememberLatest(id, character)!;
        mergeCharacters([toSummary(latest)]);
        await storage.saveCharacter(latest);
        await storage.saveCatalog(persistedCatalog());
        return rememberLatest(id, latest)!;
      } catch (error) {
        const fallback = rememberLatest(id, saved);
        if (fallback) return fallback;
        throw error;
      }
    })().finally(() => { requests.delete(id); });
    requests.set(id, request);
    return request;
  }

  return {
    initialize,
    refresh,
    getCharacter,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const catalogStore = createCatalogStore();

export function useCatalog(): CatalogController {
  const snapshot = useSyncExternalStore(catalogStore.subscribe, catalogStore.getSnapshot, catalogStore.getSnapshot);
  useEffect(() => {
    void catalogStore.initialize().then(() => catalogStore.refresh());
  }, [catalogStore]);
  return { ...snapshot, refresh: catalogStore.refresh, getCharacter: catalogStore.getCharacter };
}
