import { IDBFactory } from 'fake-indexeddb';
import { DOMParser } from 'linkedom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createDefaultPreferences } from '../data/preferences';
import { createBrowserStorage } from '../data/storage';
import { toSummary } from '../data/wiki';
import type { CatalogIndex, Character } from '../types';
import { createCatalogStore } from './useCatalog';

beforeAll(() => Object.assign(globalThis, { DOMParser }));

const NOW = Date.parse('2026-10-23T12:00:00.000Z');
const OLD = '2026-10-21T12:00:00.000Z';

function character(id: string, overrides: Partial<Character> = {}): Character {
  return {
    id, identityId: id, name: id, displayName: id, romanizedName: id,
    description: '角色简介', resonanceName: '共鸣能力', gender: '女', origin: '今州',
    affiliation: '今州', weapon: '迅刀', element: '衍射', releaseVersion: 'V1.0',
    avatar: { url: `https://example.test/${id}.png` }, hero: null, poster: null,
    hasOutfits: false, voiceCount: 0, isPreview: false,
    sourceUrl: `https://wiki.kurobbs.com/mc/item/${id}`, fetchedAt: OLD,
    identity: '', specialty: '', cv: {}, artworks: [], archives: [], treasures: [],
    stories: [], outfits: [], voices: [], syncWarnings: [], ...overrides,
  };
}

function index(characters: Character[], generatedAt = OLD): CatalogIndex {
  return { schemaVersion: 1, generatedAt, characters: characters.map(toSummary) };
}

describe('角色资料自动同步', () => {
  it('旧缓存详情和目录都应用头像修正，不篡改内容的拉取时间', async () => {
    const storage = createBrowserStorage({ indexedDB: new IDBFactory() });
    const existing = character('1543075487722901504', { name: '锁暝', fetchedAt: new Date(NOW).toISOString() });
    await storage.saveCatalog({ schemaVersion: 1, characters: [toSummary(existing)], checkedAt: null, lastSuccess: existing.fetchedAt });
    await storage.saveCharacter(existing);
    const fetchCatalog = vi.fn();
    const store = createCatalogStore({
      storage, loadIndex: async () => index([existing], existing.fetchedAt),
      loadSnapshot: async () => existing, fetchCatalog, now: () => NOW,
    });
    await store.refresh();
    const expected = 'https://prod-alicdn-community.kurobbs.com/avatar/20261012/3321d723398a4507b6f9e3fcf32cbc2c20261012.png';
    expect(store.getSnapshot().characters[0].avatar.url).toBe(expected);
    const detail = await store.getCharacter(existing.id);
    expect(detail.avatar.url).toBe(expected);
    expect(detail.fetchedAt).toBe(existing.fetchedAt);
    expect(fetchCatalog).not.toHaveBeenCalled();
  });
  it('打开时距上次成功拉取未满24小时不请求，达到24小时才拉取', async () => {
    let clock = NOW;
    const existing = character('one', { fetchedAt: new Date(NOW).toISOString() });
    const fetchCatalog = vi.fn(async () => [{ id: 'one', name: 'one' }]);
    const store = createCatalogStore({
      storage: createBrowserStorage({ indexedDB: new IDBFactory() }),
      loadIndex: async () => index([existing], new Date(NOW).toISOString()),
      loadSnapshot: async () => existing,
      fetchCatalog,
      fetchCharacter: async () => ({ ...existing, fetchedAt: new Date(clock).toISOString() }),
      now: () => clock,
    });
    clock += 24 * 60 * 60 * 1000 - 1;
    await store.refresh();
    expect(fetchCatalog).not.toHaveBeenCalled();
    clock += 1;
    await store.refresh();
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    await store.refresh();
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });
  it('基础资料仍新鲜时不请求全量 Wiki，详情优先使用快照', async () => {
    const existing = character('one', { fetchedAt: new Date(NOW).toISOString() });
    const fetchCatalog = vi.fn();
    const fetchCharacter = vi.fn();
    const store = createCatalogStore({
      storage: createBrowserStorage({ indexedDB: new IDBFactory() }),
      loadIndex: async () => index([existing], new Date(NOW).toISOString()),
      loadSnapshot: async () => existing,
      fetchCatalog,
      fetchCharacter,
      now: () => NOW,
    });
    await store.refresh();
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(await store.getCharacter('one')).toEqual(existing);
    expect(fetchCharacter).not.toHaveBeenCalled();
    expect(store.getSnapshot().characters).toHaveLength(1);
  });

  it('同时触发共享一次同步、并发不超过2，部分失败和目录缺项均保留旧资料', async () => {
    const storage = createBrowserStorage({ indexedDB: new IDBFactory() });
    const existing = [character('one'), character('two'), character('retired')];
    await storage.savePreferences({ ...createDefaultPreferences(), order: ['retired', 'one'] });
    await storage.saveCatalog({
      schemaVersion: 1, characters: existing.map(toSummary), checkedAt: null, lastSuccess: OLD,
    });
    let concurrent = 0;
    let peak = 0;
    const fetchCharacter = vi.fn(async (item: { id: string }) => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
      if (item.id === 'two') throw new Error('temporary failure');
      return character(item.id, { name: '新名称', fetchedAt: new Date(NOW).toISOString() });
    });
    const fetchCatalog = vi.fn(async () => [{ id: 'one', name: 'one' }, { id: 'two', name: 'two' }, { id: 'new', name: 'new' }]);
    const store = createCatalogStore({
      storage,
      loadIndex: async () => index(existing),
      loadSnapshot: async (id) => existing.find((entry) => entry.id === id)!,
      fetchCatalog, fetchCharacter, now: () => NOW,
    });
    const first = store.refresh(true);
    const second = store.refresh(true);
    expect(first).toBe(second);
    await first;
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(peak).toBe(2);
    expect(store.getSnapshot().characters.map((entry) => entry.id)).toEqual(['one', 'two', 'retired', 'new']);
    expect(store.getSnapshot().characters.find((entry) => entry.id === 'two')?.fetchedAt).toBe(OLD);
    expect(store.getSnapshot().sync).toMatchObject({ phase: 'error', completed: 3, total: 3, lastSuccess: OLD });
    expect((await storage.getPreferences())?.order).toEqual(['retired', 'one']);
    expect((await storage.getCatalog())?.characters).toHaveLength(4);
  });

  it('成功同步推进日期，但异常空目录不会清空现有数据', async () => {
    const storage = createBrowserStorage({ indexedDB: new IDBFactory() });
    const existing = character('one');
    const fetchCatalog = vi.fn()
      .mockResolvedValueOnce([{ id: 'one', name: 'one' }])
      .mockResolvedValueOnce([]);
    const store = createCatalogStore({
      storage,
      loadIndex: async () => index([existing]),
      loadSnapshot: async () => existing,
      fetchCatalog,
      fetchCharacter: async () => character('one', { fetchedAt: new Date(NOW).toISOString() }),
      now: () => NOW,
    });
    await store.refresh();
    expect(store.getSnapshot().sync).toMatchObject({ phase: 'done', lastSuccess: new Date(NOW).toISOString() });
    await store.refresh(true);
    expect(store.getSnapshot().sync.phase).toBe('error');
    expect(store.getSnapshot().characters).toHaveLength(1);
    expect((await storage.getCatalog())?.characters).toHaveLength(1);
  });

  it('新响应丢失既有角色故事时保留上次内容，并报告部分更新', async () => {
    const existing = character('one', {
      stories: [{ id: 'story-1', title: '旧日故事', html: '<p>原本完整的角色故事</p>' }],
    });
    const store = createCatalogStore({
      storage: createBrowserStorage({ indexedDB: new IDBFactory() }),
      loadIndex: async () => index([existing]),
      loadSnapshot: async () => existing,
      fetchCatalog: async () => [{ id: 'one', name: 'one' }],
      fetchCharacter: async () => character('one', { fetchedAt: new Date(NOW).toISOString() }),
      now: () => NOW,
    });
    await store.refresh(true);
    expect((await store.getCharacter('one')).stories).toEqual(existing.stories);
    expect(store.getSnapshot().sync.phase).toBe('error');
    expect(store.getSnapshot().sync.lastSuccess).toBe(OLD);
    expect(store.getSnapshot().sync.message).toContain('栏目异常缺失');
  });

  it('静态快照延迟失败时，不把刷新期间取得的新详情反向覆盖成旧缓存', async () => {
    const storage = createBrowserStorage({ indexedDB: new IDBFactory() });
    const old = character('one');
    const seed = character('one', { name: '基线', fetchedAt: '2026-10-22T12:00:00.000Z' });
    const fresh = character('one', { name: '最新资料', fetchedAt: new Date(NOW).toISOString() });
    await storage.saveCharacter(old);
    let rejectSnapshot!: (error: Error) => void;
    let started!: () => void;
    const snapshotStarted = new Promise<void>((resolve) => { started = resolve; });
    const pendingSnapshot = new Promise<Character>((_resolve, reject) => { rejectSnapshot = reject; });
    const loadSnapshot = vi.fn()
      .mockImplementationOnce(() => { started(); return pendingSnapshot; })
      .mockResolvedValue(seed);
    const store = createCatalogStore({
      storage,
      loadIndex: async () => index([seed], seed.fetchedAt),
      loadSnapshot,
      fetchCatalog: async () => [{ id: 'one', name: 'one' }],
      fetchCharacter: async () => fresh,
      now: () => NOW,
    });
    const openedDetail = store.getCharacter('one');
    await snapshotStarted;
    await store.refresh(true);
    rejectSnapshot(new Error('static snapshot failed'));
    expect((await openedDetail).name).toBe('最新资料');
    expect((await store.getCharacter('one')).name).toBe('最新资料');
    expect((await storage.getCharacter('one'))?.name).toBe('最新资料');
  });
});
