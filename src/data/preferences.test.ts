import { describe, expect, it } from 'vitest';
import {
  createDefaultPreferences, exportPreferences, MAX_NOTE_LENGTH, validatePreferences,
} from './preferences';

describe('个人排行榜备份', () => {
  it('往返保留尚未收录的角色，不导出官方角色正文', () => {
    const backup = {
      ...createDefaultPreferences(),
      order: ['jinxi', 'future-role-999'],
      notes: { 'future-role-999': '等待下一次相遇' },
      tiers: { jinxi: 's' as const },
      favorites: ['future-role-999'],
      officialArchives: '不应放入偏好备份的官方正文',
    };
    const exported = exportPreferences(backup);
    expect(validatePreferences(exported).order).toEqual(['jinxi', 'future-role-999']);
    expect(exported).not.toContain('officialArchives');
  });

  it.each([
    { order: ['jinxi', 'jinxi'] },
    { tiers: { jinxi: 'invalid' } },
    { notes: { jinxi: 'x'.repeat(MAX_NOTE_LENGTH + 1) } },
    { schemaVersion: 2 },
    { updatedAt: 'not-a-date' },
  ])('拒绝无效备份字段 %j', (fields) => {
    expect(() => validatePreferences({ ...createDefaultPreferences(), ...fields })).toThrow();
  });

  it('拒绝原型污染字段及超大文件', () => {
    const valid = exportPreferences(createDefaultPreferences());
    const dangerous = valid.replace('"notes": {}', '"notes": {"__proto__":"bad"}');
    expect(() => validatePreferences(dangerous)).toThrow('不安全');
    expect(() => validatePreferences(' '.repeat(1024 * 1024 + 1))).toThrow('过大');
    expect(({} as Record<string, unknown>).bad).toBeUndefined();
  });
});
