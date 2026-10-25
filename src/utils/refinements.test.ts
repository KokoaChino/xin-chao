import { describe, expect, it } from 'vitest';
import type { CharacterSummary, Voice } from '../types';
import { groupRoster } from './display';
import { exportRanking, importRanking } from './backup';
import { createDefaultPreferences, validatePreferences } from '../data/preferences';
import { filterRoster } from './roster';
import { posterLayout } from './poster';
import { uniqueVoices } from './voices';

function role(id: string, name: string, identityId = id, element = '气动', weapon = '迅刀'): CharacterSummary {
  return {
    id, name, displayName: name, identityId, romanizedName: name === '今汐' ? 'JINHSI' : 'YANGYANG',
    element, weapon, affiliation: '今州、军策府', gender: '女', origin: '瑝珑',
    avatar: { url: 'https://example.test/avatar.png' }, hero: null, poster: null,
    description: '', resonanceName: '', releaseVersion: '', hasOutfits: false,
    voiceCount: 0, isPreview: false, sourceUrl: '', fetchedAt: '',
  };
}
const roles = [role('base', '秧秧'), role('form', '秧秧·玄翎', 'base', '衍射', '长刃'), role('jinxi', '今汐')];

describe('精简榜单与名称备份', () => {
  it('秧秧切换只占一个名额，持久化验证与名称备份往返保留形态和排序', () => {
    const prefs = validatePreferences({ ...createDefaultPreferences(), title: '测试XP排行榜', order: ['jinxi', 'base'], selectedVariants: { base: 'form' } });
    const entries = groupRoster(roles, prefs.selectedVariants);
    expect(entries).toHaveLength(2);
    expect(entries[0].character.name).toBe('秧秧·玄翎');
    const json = exportRanking(prefs, entries);
    expect(JSON.parse(json)).toEqual({ version: 2, title: '测试XP排行榜', characters: [
      { name: '今汐', form: '今汐' }, { name: '秧秧', form: '秧秧·玄翎' },
    ] });
    expect(json).not.toContain('jinxi');
    const restored = importRanking(json, groupRoster(roles));
    expect(restored.order).toEqual(prefs.order);
    expect(restored.selectedVariants).toEqual({ base: 'form', jinxi: 'jinxi' });
  });
  it('拒绝未知角色、重复名额、不属于角色的形态以及危险数据，不进行部分导入', () => {
    const backup = (characters: unknown[]) => JSON.stringify({ version: 2, title: '测试', characters });
    const entries = groupRoster(roles);
    expect(() => importRanking(backup([{ name: '未知角色' }]), entries)).toThrow('未找到角色');
    expect(() => importRanking(backup([{ name: '秧秧' }, { name: '秧秧' }]), entries)).toThrow('角色重复');
    expect(() => importRanking(backup([{ name: '秧秧', form: '今汐' }]), entries)).toThrow('这一形态');
    expect(() => importRanking('{"version":2,"title":"测试","characters":[],"__proto__":{}}', entries)).toThrow('格式不正确');
    expect(() => validatePreferences({ ...createDefaultPreferences(), selectedVariants: { base: '__proto__' } })).toThrow('无效');
  });
});
describe('常驻筛选', () => {
  const filters = { query: '', scope: '', element: '', weapon: '', gender: '', releaseVersion: '' };
  it('实装版本筛选且属性武器在同一形态成立，已入榜秧秧不能被过滤器切换', () => {
    const entries = groupRoster(roles);
    expect(filterRoster(entries, { ...filters, releaseVersion: 'V3.5' }, new Set())).toHaveLength(0);
    expect(filterRoster(entries, { ...filters, element: '衍射', weapon: '迅刀' }, new Set())).toHaveLength(0);
    const found = filterRoster(entries, { ...filters, element: '衍射', weapon: '长刃' }, new Set());
    expect(found).toHaveLength(1);
    expect(found[0].character.name).toBe('秧秧·玄翎');
    expect(filterRoster(entries, { ...filters, element: '衍射' }, new Set(['base']))).toHaveLength(0);
    expect(filterRoster(entries, { ...filters, query: 'jinhsi' }, new Set()).map(e => e.id)).toEqual(['jinxi']);
  });
});
describe('固定单列海报', () => {
  it('不再接受布局参数，保留全部排名，检查空榜和异常数量', () => {
    expect(posterLayout(58)).toMatchObject({ columns: 1, width: 1080, avatarSize: 230 });
    expect(() => posterLayout(0)).toThrow();
    expect(() => posterLayout(1.5)).toThrow();
  });
  it('序号、头像和资料各占独立的水平空间，文字右边距始终留在卡片内', () => {
    const layout = posterLayout(58);
    expect(layout.numberOffset + layout.numberWidth).toBeLessThan(layout.avatarOffset);
    expect(layout.avatarOffset + layout.avatarSize).toBeLessThan(layout.textOffset);
    expect(layout.textOffset + layout.textWidth).toBeLessThan(layout.cardWidth);
  });
});
describe('语音去重', () => {
  it('同语种同类别重复URL合并但不同语言/类别仍独立，保留补充的台词', () => {
    const voice: Voice = { id: '1', title: '问候', text: '', cv: '', language: '中文', category: 'personality', url: 'https://example.test/voice.wav' };
    const result = uniqueVoices([voice, { ...voice, id: '2', text: '你好' }, { ...voice, id: '3', language: '英文' }, { ...voice, id: '4', category: 'combat' }]);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ id: '1', text: '你好' });
  });
});
