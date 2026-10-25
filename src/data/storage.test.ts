import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createDefaultPreferences } from './preferences';
import { createBrowserStorage } from './storage';

describe('浏览器持久化', () => {
  it('在新的存储实例中恢复偏好，并按提交顺序保存最后一次修改', async () => {
    const indexedDB = new IDBFactory();
    const storage = createBrowserStorage({ indexedDB });
    const initial = createDefaultPreferences();
    const first = storage.savePreferences({ ...initial, order: ['future-role', 'jinxi'] });
    const second = storage.savePreferences({ ...initial, order: ['jinxi', 'future-role'], notes: { jinxi: '喜欢她的故事' } });
    await Promise.all([first, second]);

    const reopened = createBrowserStorage({ indexedDB });
    expect(await reopened.getPreferences()).toMatchObject({
      order: ['jinxi', 'future-role'],
      notes: { jinxi: '喜欢她的故事' },
    });
    expect(reopened.getStatus().persistent).toBe(true);
  });

  it('IndexedDB 不可用时仍可读写本次会话，并明确报告无法持久化', async () => {
    const storage = createBrowserStorage({ indexedDB: null });
    const preferences = { ...createDefaultPreferences(), order: ['jinxi'] };
    await storage.savePreferences(preferences);
    expect(await storage.getPreferences()).toEqual(preferences);
    expect(storage.getStatus()).toMatchObject({
      persistent: false,
      reason: expect.stringContaining('仅保留在当前页面'),
    });
    const read = await storage.getPreferences();
    read?.order.push('unintended-mutation');
    expect((await storage.getPreferences())?.order).toEqual(['jinxi']);
  });
});
