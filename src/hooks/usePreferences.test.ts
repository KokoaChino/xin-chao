import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createDefaultPreferences } from '../data/preferences';
import { createBrowserStorage } from '../data/storage';
import { createPreferencesStore } from './usePreferences';

describe('个人偏好状态', () => {
  it('坏导入不覆盖已有排名，刷新资料也不触碰偏好', async () => {
    const storage = createBrowserStorage({ indexedDB: new IDBFactory() });
    const store = createPreferencesStore(storage);
    await store.initialize();
    store.actions.add('jinxi');
    store.actions.setNote('jinxi', '心动无需解释');
    store.actions.setTier('jinxi', 's');
    const before = store.getSnapshot().preferences;
    expect(() => store.actions.importPreferences('{broken')).toThrow();
    expect(store.getSnapshot().preferences).toBe(before);
    await store.whenIdle();
    await storage.saveCatalog({ schemaVersion: 1, characters: [], checkedAt: null, lastSuccess: null });
    expect((await storage.getPreferences())?.order).toEqual(['jinxi']);
    expect((await storage.getPreferences())?.notes.jinxi).toBe('心动无需解释');
  });

  it('列表局部重排不丢未展示的角色，移出排名保留理由与收藏', async () => {
    const storage = createBrowserStorage({ indexedDB: new IDBFactory() });
    const store = createPreferencesStore(storage);
    await store.initialize();
    store.actions.importPreferences({
      ...createDefaultPreferences(),
      order: ['jinxi', 'future-role', 'shorekeeper'],
      notes: { 'future-role': '还想保留这段记忆' },
      favorites: ['future-role'],
    });
    store.actions.reorder(['shorekeeper', 'jinxi']);
    expect(store.getSnapshot().preferences.order).toEqual(['shorekeeper', 'jinxi', 'future-role']);
    store.actions.remove('future-role');
    expect(store.getSnapshot().preferences.favorites).toContain('future-role');
    expect(store.getSnapshot().preferences.notes['future-role']).toBe('还想保留这段记忆');
    await store.whenIdle();
    const reopened = createPreferencesStore(storage);
    await reopened.initialize();
    expect(reopened.getSnapshot().preferences).toEqual(store.getSnapshot().preferences);
  });

  it('没有广播通知时，两标签并发添加和编辑仍在事务内合并，不丢失另一标签的偏好', async () => {
    const indexedDB = new IDBFactory();
    const storageA = createBrowserStorage({ indexedDB, broadcast: false });
    const storageB = createBrowserStorage({ indexedDB, broadcast: false });
    const tabA = createPreferencesStore(storageA);
    const tabB = createPreferencesStore(storageB);
    await Promise.all([tabA.initialize(), tabB.initialize()]);
    tabA.actions.add('jinxi');
    tabB.actions.add('rover');
    tabA.actions.setNote('jinxi', '今汐的理由');
    tabB.actions.setTier('rover', 's');
    await Promise.all([tabA.whenIdle(), tabB.whenIdle()]);
    const saved = await storageA.getPreferences();
    expect(new Set(saved?.order)).toEqual(new Set(['jinxi', 'rover']));
    expect(saved?.notes.jinxi).toBe('今汐的理由');
    expect(saved?.tiers.rover).toBe('s');
    expect((await storageA.getPreferencesRecord()).revision).toBe(4);
  });

  it.each(['import', 'reset'] as const)('过期标签的整份替换 %s 会 reject，不覆盖另一标签已保存的排行榜', async (action) => {
    const indexedDB = new IDBFactory();
    const storageA = createBrowserStorage({ indexedDB, broadcast: false });
    const storageB = createBrowserStorage({ indexedDB, broadcast: false });
    const tabA = createPreferencesStore(storageA);
    const tabB = createPreferencesStore(storageB);
    await Promise.all([tabA.initialize(), tabB.initialize()]);
    tabA.actions.add('jinxi');
    await tabA.whenIdle();
    const result = action === 'import'
      ? tabB.actions.importPreferences({ ...createDefaultPreferences(), order: ['rover'] })
      : tabB.actions.reset();
    await expect(result).rejects.toThrow('本次整份替换未保存');
    await tabB.whenIdle();
    expect((await storageA.getPreferences())?.order).toEqual(['jinxi']);
    expect(tabB.getSnapshot().preferences.order).toEqual(['jinxi']);
    expect(tabB.getSnapshot().error).toContain('本次整份替换未保存');
    expect(storageB.getStatus().persistent).toBe(true);
    tabB.actions.add('rover');
    await tabB.whenIdle();
    expect((await storageA.getPreferences())?.order).toEqual(['jinxi', 'rover']);
  });
});
